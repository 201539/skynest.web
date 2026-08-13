const { Client } = require('pg')
const { planRoute } = require('./routePlanner')
const v3Database = require('./v3Database')
const routeStore = require('./routeStore')
const { getV3DatabaseConfig } = require('./databaseConfig')

const CHANNEL = 'skynest_dynamic_change'
const DEBOUNCE_MS = Number.parseInt(process.env.AUTO_REPLAN_DEBOUNCE_MS || '750', 10)
const COST_CHANGE_THRESHOLD_PERCENT = Number(process.env.AUTO_REPLAN_COST_THRESHOLD_PERCENT || '0.5')

let listener = null
let reconnectTimer = null
let debounceTimer = null
let started = false
let stopping = false
let processing = false
let pendingTriggers = []
let status = {
  enabled: process.env.AUTO_REPLAN_ENABLED !== 'false',
  listening: false,
  processing: false,
  last_notification_at: null,
  last_run_at: null,
  last_result: null,
  last_error: null,
}

function connectionConfig() {
  return getV3DatabaseConfig({
    application_name: 'skynest-dynamic-replan-listener',
  })
}

function bboxIntersects(left, right) {
  if (!left || !right) return true
  return !(
    left.xMax < right.xMin ||
    left.xMin > right.xMax ||
    left.yMax < right.yMin ||
    left.yMin > right.yMax
  )
}

function pointsChanged(previous = [], current = [], tolerance = 1e-7) {
  if (previous.length !== current.length) return true
  return previous.some((point, index) => {
    const next = current[index]
    return !next ||
      Math.abs(Number(point.lng) - Number(next.lng)) > tolerance ||
      Math.abs(Number(point.lat) - Number(next.lat)) > tolerance ||
      Math.abs(Number(point.height || 0) - Number(next.height || 0)) > 0.1
  })
}

function percentDifference(current, previous) {
  const currentValue = Number(current)
  const previousValue = Number(previous)
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return Infinity
  if (previousValue === 0) return currentValue === 0 ? 0 : Infinity
  return Math.abs(((currentValue / previousValue) - 1) * 100)
}

function planOptionsFromContext(context = {}) {
  return {
    searchBBox: context.search_bbox,
    groundHeight: context.ground_height,
    minScore: context.min_score,
    gridSize: context.grid_size,
    simplifyToleranceMeters: context.simplify_tolerance_meters,
    startName: context.start_name,
    endName: context.end_name,
    routeName: context.start_name && context.end_name
      ? `${context.start_name} → ${context.end_name}`
      : '自动重规划航线',
    dynamicCostSurfaceProvider: v3Database.getDynamicCostSurface,
    requireDynamicCost: true,
    planningAt: new Date().toISOString(),
    timeZone: context.time_zone || 'Asia/Shanghai',
    dynamicCostOptions: {
      profile: context.cost_profile || 'balanced',
      weights: context.cost_weights,
      thresholds: {
        ...(context.min_score != null ? { minSuitability: context.min_score } : {}),
        ...(context.cost_thresholds || {}),
      },
    },
  }
}

async function processDynamicChanges(triggers = [], options = {}) {
  if (processing) {
    pendingTriggers.push(...triggers)
    return { queued: true }
  }
  processing = true
  status = { ...status, processing: true, last_error: null }
  try {
    const store = options.store || routeStore
    const surfaceProvider = options.surfaceProvider || v3Database.getDynamicCostSurface
    const currentRoutes = await store.listCurrentDynamicRoutes()
    const impacts = options.force
      ? [null]
      : await Promise.all(triggers.map((trigger) => store.getDynamicChangeImpact(trigger)))
    const results = []

    for (const route of currentRoutes) {
      const context = route.planning_context || {}
      const affected = options.force || impacts.some((impact) => {
        if (!impact?.bbox) return true
        return bboxIntersects(context.search_bbox, impact.bbox)
      })
      if (!affected) {
        results.push({ task_id: route.task_id, route_id: route.route_id, outcome: 'unaffected' })
        continue
      }

      try {
        const planOptions = planOptionsFromContext(context)
        planOptions.dynamicCostSurfaceProvider = surfaceProvider
        const plan = await planRoute(
          null,
          context.start,
          context.end,
          planOptions
        )
        const changedPath = pointsChanged(route.waypoints || [], plan.route.points || [])
        const costChange = percentDifference(plan.totalTraversalCost, route.cost)
        if (!changedPath && costChange < COST_CHANGE_THRESHOLD_PERCENT) {
          results.push({
            task_id: route.task_id,
            route_id: route.route_id,
            outcome: 'recalculated_unchanged',
            cost_change_percent: Math.round(costChange * 100) / 100,
          })
          continue
        }

        const persisted = await store.persistPlan(
          plan,
          {
            taskId: route.task_id,
            start: context.start,
            end: context.end,
            startName: context.start_name,
            endName: context.end_name,
            groundHeight: context.ground_height,
            minScore: context.min_score,
            gridSize: context.grid_size,
            simplifyToleranceMeters: context.simplify_tolerance_meters,
            costProfile: context.cost_profile,
            costWeights: context.cost_weights,
            costThresholds: context.cost_thresholds,
            timeZone: context.time_zone,
            planningAt: plan.dynamicCost?.sampledAt,
          },
          {
            previousRouteId: route.route_id,
            trigger: {
              type: 'dynamic_data_change',
              changes: triggers,
              processed_at: new Date().toISOString(),
            },
          }
        )
        results.push({
          task_id: route.task_id,
          previous_route_id: route.route_id,
          route_id: persisted.route_id,
          outcome: 'replanned',
          distance_change_percent: persisted.distance_change_percent,
          risk_change_percent: persisted.risk_change_percent,
        })
      } catch (error) {
        if (error.code === 'ROUTE_VERSION_CHANGED') {
          results.push({
            task_id: route.task_id,
            route_id: route.route_id,
            outcome: 'superseded_by_newer_route',
            current_route_id: error.current_route_id,
          })
        } else if (error.code === 'NO_SAFE_ROUTE') {
          await store.suspendTask(route.task_id, error.message)
          results.push({
            task_id: route.task_id,
            route_id: route.route_id,
            outcome: 'suspended_no_safe_route',
            reason: error.message,
          })
        } else {
          results.push({
            task_id: route.task_id,
            route_id: route.route_id,
            outcome: 'failed',
            reason: error.message,
          })
        }
      }
    }

    const runResult = {
      triggers,
      route_count: currentRoutes.length,
      affected_count: results.filter((item) => item.outcome !== 'unaffected').length,
      replanned_count: results.filter((item) => item.outcome === 'replanned').length,
      suspended_count: results.filter((item) => item.outcome === 'suspended_no_safe_route').length,
      results,
    }
    status = {
      ...status,
      last_run_at: new Date().toISOString(),
      last_result: runResult,
      last_error: null,
    }
    return runResult
  } catch (error) {
    status = { ...status, last_run_at: new Date().toISOString(), last_error: error.message }
    throw error
  } finally {
    processing = false
    status = { ...status, processing: false }
    if (pendingTriggers.length) {
      const queued = pendingTriggers
      pendingTriggers = []
      setImmediate(() => processDynamicChanges(queued).catch((error) => {
        console.error('Queued automatic replanning failed:', error.message)
      }))
    }
  }
}

function scheduleTrigger(trigger) {
  pendingTriggers.push(trigger)
  status = { ...status, last_notification_at: new Date().toISOString() }
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const triggers = pendingTriggers
    pendingTriggers = []
    processDynamicChanges(triggers).catch((error) => {
      console.error('Automatic replanning failed:', error.message)
    })
  }, DEBOUNCE_MS)
}

async function connectListener() {
  if (stopping || !status.enabled) return
  listener = new Client(connectionConfig())
  listener.on('notification', (message) => {
    if (message.channel !== CHANNEL) return
    try {
      scheduleTrigger(JSON.parse(message.payload || '{}'))
    } catch (error) {
      console.warn('Ignored invalid dynamic change notification:', error.message)
    }
  })
  listener.on('error', (error) => {
    status = { ...status, listening: false, last_error: error.message }
    if (!stopping) {
      clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => connectListener().catch(() => {}), 2000)
    }
  })
  await listener.connect()
  await listener.query(`LISTEN ${CHANNEL}`)
  status = { ...status, listening: true, last_error: null }
}

async function start() {
  if (started || !status.enabled) return getStatus()
  started = true
  stopping = false
  await connectListener()
  return getStatus()
}

async function stop() {
  stopping = true
  started = false
  clearTimeout(reconnectTimer)
  clearTimeout(debounceTimer)
  if (listener) await listener.end().catch(() => {})
  listener = null
  status = { ...status, listening: false, processing: false }
}

function getStatus() {
  return { ...status, pending_notifications: pendingTriggers.length }
}

module.exports = {
  start,
  stop,
  getStatus,
  processDynamicChanges,
  _pointsChanged: pointsChanged,
  _bboxIntersects: bboxIntersects,
}
