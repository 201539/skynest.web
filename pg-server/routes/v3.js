const express = require('express')
const v3Database = require('../lib/v3Database')
const dynamicCost = require('../lib/dynamicCost')
const dynamicReplanService = require('../lib/dynamicReplanService')
const routeStore = require('../lib/routeStore')
const restrictionStore = require('../lib/restrictionStore')
const taskWorkflowStore = require('../lib/taskWorkflowStore')
const operatorWorkflowStore = require('../lib/operatorWorkflowStore')
const auditStore = require('../lib/auditStore')
const safetyActionStore = require('../lib/safetyActionStore')
const taskAgentService = require('../agent/agentService')

function parseQueryNumber(value, fieldName) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${fieldName} must be a finite number`)
  return parsed
}

function queryOptions(query) {
  return {
    limit: query.limit,
    offset: query.offset,
    nodeType: query.nodeType,
    status: query.status,
    itemCategory: query.itemCategory,
    weightKg: parseQueryNumber(query.weightKg, 'weightKg'),
    categoryName: query.categoryName,
    vehicleClass: query.vehicleClass,
    minBattery: parseQueryNumber(query.minBattery, 'minBattery'),
  }
}

function sendQueryError(res, error) {
  const invalidInput = error instanceof TypeError || error instanceof RangeError
  const notFound = [
    'RESTRICTION_NOT_FOUND', 'TASK_NOT_FOUND', 'DRONE_NOT_FOUND', 'NODE_NOT_FOUND',
  ].includes(error.code)
  const conflict = [
    'TASK_ALREADY_REVIEWED', 'TASK_NOT_DISPATCHABLE', 'TASK_ROUTE_MISSING',
    'DRONE_UNAVAILABLE', 'DRONE_BATTERY_LOW', 'DRONE_PAYLOAD_EXCEEDED',
    'NODE_UNAVAILABLE', 'NODE_TYPE_INVALID', 'TASK_NOT_ADVANCEABLE',
    'TASK_ASSIGNMENT_MISSING', 'TASK_NOT_REPLANNABLE', 'TASK_ROUTE_CONTEXT_MISSING',
    'RESTRICTION_NOT_ACTIVE', 'ROUTE_NO_RESTRICTION_CONFLICT',
    'REPLAN_CONFLICT_REMAINS', 'TASK_NOT_STOPPABLE',
  ].includes(error.code)
  const unprocessable = ['PLACE_NOT_FOUND', 'NO_SAFE_ROUTE'].includes(error.code)
  res.status(invalidInput ? 400 : notFound ? 404 : conflict ? 409 : unprocessable ? 422 : 500).json({
    error: invalidInput
      ? 'invalid_query'
      : error.code?.toLowerCase() || (notFound
        ? 'resource_not_found'
        : conflict
          ? 'resource_conflict'
          : unprocessable
            ? 'task_route_unavailable'
            : 'v3_database_query_failed'),
    detail: error.message,
    ...(error.details ? { details: error.details } : {}),
  })
}

function createV3Router() {
  const router = express.Router()

  router.get('/health', async (_req, res) => {
    try {
      const status = await v3Database.getStatus()
      res.status(status.ok ? 200 : 503).json(status)
    } catch (error) {
      res.status(503).json({ ok: false, error: 'v3_database_unavailable', detail: error.message })
    }
  })

  router.get('/summary', async (_req, res) => {
    try {
      const tables = await v3Database.getSummary()
      res.json({
        database: process.env.PG_V3_DATABASE || v3Database.DEFAULT_DATABASE,
        table_count: tables.length,
        tables,
      })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/nodes', async (req, res) => {
    try {
      const data = await v3Database.listFixedNodes(queryOptions(req.query))
      res.json({ count: data.length, data })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/vehicle-rules', async (req, res) => {
    try {
      const data = await v3Database.listVehicleRules(queryOptions(req.query))
      res.json({ count: data.length, data })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/high-risk-categories', async (req, res) => {
    try {
      const data = await v3Database.listHighRiskCategories(queryOptions(req.query))
      res.json({ count: data.length, data })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/drones', async (req, res) => {
    try {
      const data = await v3Database.listDrones(queryOptions(req.query))
      res.json({ count: data.length, data })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.post('/agent/parse', async (req, res) => {
    try {
      const data = await taskAgentService.parseInput(req.body?.input_text, {
        pool: taskWorkflowStore._pool,
      })
      res.json(data)
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/agent/status', async (_req, res) => {
    try {
      res.json(await taskAgentService.getAgentModelStatus())
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.put('/agent/config', async (req, res) => {
    try {
      res.json(await taskAgentService.updateModelConfig({
        enabled: req.body?.enabled,
        provider: req.body?.provider,
      }))
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/tasks', async (_req, res) => {
    try {
      const data = await taskWorkflowStore.listWorkspace()
      res.json({ count: data.length, data: data.map((item) => item.task) })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.post('/tasks', async (req, res) => {
    try {
      const verified = await taskAgentService.verifyStructuredTask(req.body || {}, {
        pool: taskWorkflowStore._pool,
      })
      const task = await taskWorkflowStore.createTask({
        ...(req.body || {}),
        ...verified,
        requester: req.body?.requester,
      })
      res.status(201).json(task)
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/student/workspace', async (_req, res) => {
    try {
      const tasks = await taskWorkflowStore.listWorkspace()
      res.json({ source: 'v3', updated_at: new Date().toISOString(), tasks })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/tasks/:taskId/route-explanation', async (req, res) => {
    try {
      const workspace = await taskWorkflowStore.getTaskWorkspace(req.params.taskId)
      if (!workspace.route) {
        const error = new Error(`Task ${req.params.taskId} does not have an approved route`)
        error.code = 'TASK_ROUTE_MISSING'
        throw error
      }
      res.json({
        source: 'v3',
        task_id: workspace.task.id,
        route_id: workspace.route.id,
        explanation: workspace.route.explanation,
      })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/reviews', async (_req, res) => {
    try {
      const data = await taskWorkflowStore.listWorkspace()
      res.json(data)
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.post('/tasks/:taskId/review', async (req, res) => {
    try {
      const result = await taskWorkflowStore.reviewTask(req.params.taskId, req.body || {})
      res.json(result)
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/operator/workspace', async (_req, res) => {
    try {
      res.json(await operatorWorkflowStore.getOperatorWorkspace())
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/audit', async (req, res) => {
    try {
      res.json(await auditStore.getWorkspace({ limit: req.query.limit }))
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.post('/operator/tasks/:taskId/dispatch', async (req, res) => {
    try {
      res.json(await operatorWorkflowStore.dispatchTask(req.params.taskId, req.body || {}))
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.post('/operator/tasks/:taskId/advance', async (req, res) => {
    try {
      res.json(await operatorWorkflowStore.advanceTask(req.params.taskId, req.body || {}))
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/grids/bbox', async (req, res) => {
    try {
      const data = await v3Database.listGridCells({
        xMin: parseQueryNumber(req.query.xMin, 'xMin'),
        xMax: parseQueryNumber(req.query.xMax, 'xMax'),
        yMin: parseQueryNumber(req.query.yMin, 'yMin'),
        yMax: parseQueryNumber(req.query.yMax, 'yMax'),
        zMin: parseQueryNumber(req.query.zMin, 'zMin'),
        zMax: parseQueryNumber(req.query.zMax, 'zMax'),
        limit: req.query.limit,
      })
      const effectiveLimit = Math.min(Number.parseInt(req.query.limit, 10) || 5000, 20000)
      res.json({ count: data.length, truncated: data.length === effectiveLimit, data })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.post('/dynamic-cost/evaluate', async (req, res) => {
    try {
      const body = req.body || {}
      const bbox = body.bbox || {}
      const source = await v3Database.listDynamicCostInputs({
        xMin: bbox.xMin,
        xMax: bbox.xMax,
        yMin: bbox.yMin,
        yMax: bbox.yMax,
        zMin: bbox.zMin,
        zMax: bbox.zMax,
        at: body.at,
        timeZone: body.timeZone,
        limit: body.limit,
      })
      const options = {
        profile: body.profile,
        weights: body.weights,
        riskScale: body.riskScale,
        thresholds: body.thresholds,
        overrides: body.overrides,
      }
      const data = dynamicCost.evaluateCells(source.rows, options)
      res.json({
        database: process.env.PG_V3_DATABASE || v3Database.DEFAULT_DATABASE,
        at: source.at,
        time_zone: source.timeZone,
        model: dynamicCost.getModelConfig(options),
        summary: dynamicCost.summarizeCosts(data),
        data,
      })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/replanning/status', (_req, res) => {
    res.json(dynamicReplanService.getStatus())
  })

  router.get('/safety/workspace', async (_req, res) => {
    try {
      const workspace = await restrictionStore.getSafetyWorkspace()
      res.json({
        ...workspace,
        replanning_status: dynamicReplanService.getStatus(),
      })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.post('/safety/restrictions', async (req, res) => {
    try {
      const restriction = await restrictionStore.createRestriction(req.body || {})
      const workspace = await restrictionStore.getSafetyWorkspace()
      res.status(201).json({
        ...workspace,
        changed_restriction: restriction,
        replanning_status: dynamicReplanService.getStatus(),
      })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.patch('/safety/restrictions/:restrictionId', async (req, res) => {
    try {
      const restriction = await restrictionStore.setRestrictionActive(
        req.params.restrictionId,
        req.body?.active
      )
      const workspace = await restrictionStore.getSafetyWorkspace()
      res.json({
        ...workspace,
        changed_restriction: restriction,
        replanning_status: dynamicReplanService.getStatus(),
      })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.delete('/safety/restrictions/:restrictionId', async (req, res) => {
    try {
      const restriction = await restrictionStore.cancelRestriction(req.params.restrictionId)
      const workspace = await restrictionStore.getSafetyWorkspace()
      res.json({
        ...workspace,
        changed_restriction: restriction,
        replanning_status: dynamicReplanService.getStatus(),
      })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.post('/safety/tasks/:taskId/replan', async (req, res) => {
    try {
      const workspace = await safetyActionStore.manualReplanTask(
        req.params.taskId,
        req.body || {}
      )
      res.json({
        ...workspace,
        replanning_status: dynamicReplanService.getStatus(),
      })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.post('/safety/tasks/:taskId/emergency-stop', async (req, res) => {
    try {
      const workspace = await safetyActionStore.emergencyStopTask(
        req.params.taskId,
        req.body || {}
      )
      res.json({
        ...workspace,
        replanning_status: dynamicReplanService.getStatus(),
      })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.post('/replanning/run', async (req, res) => {
    try {
      const result = await dynamicReplanService.processDynamicChanges(
        Array.isArray(req.body?.triggers) ? req.body.triggers : [],
        { force: req.body?.force !== false }
      )
      res.json(result)
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  router.get('/tasks/:taskId/routes', async (req, res) => {
    try {
      const data = await routeStore.listRouteHistory(req.params.taskId)
      res.json({ task_id: Number(req.params.taskId), count: data.length, data })
    } catch (error) {
      sendQueryError(res, error)
    }
  })

  return router
}

module.exports = { createV3Router }
