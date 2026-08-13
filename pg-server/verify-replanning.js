require('dotenv').config()

const assert = require('node:assert/strict')
const { planRoute } = require('./lib/routePlanner')
const routeStore = require('./lib/routeStore')
const dynamicReplanService = require('./lib/dynamicReplanService')

const BBOX = { xMin: 118.94, xMax: 118.96, yMin: 32.108, yMax: 32.12 }
const START = { lng: 118.941, lat: 32.114, height: 80 }
const END = { lng: 118.959, lat: 32.114, height: 80 }

function createSurfaceProvider({ wall = false, blockAll = false, extraRisk = 0 } = {}) {
  return async ({ xMin, xMax, yMin, yMax, cols, rows, at, timeZone }) => {
    const cells = []
    const wallColumn = Math.floor(cols / 2)
    for (let sampleRow = 0; sampleRow < rows; sampleRow++) {
      for (let sampleCol = 0; sampleCol < cols; sampleCol++) {
        const wallBlocked = wall && sampleCol === wallColumn && sampleRow < rows - 2
        cells.push({
          sample_col: sampleCol,
          sample_row: sampleRow,
          new_id: sampleRow * cols + sampleCol + 1,
          grid_code: `verify-${sampleCol}-${sampleRow}`,
          x_min: xMin + (sampleCol / cols) * (xMax - xMin),
          x_max: xMin + ((sampleCol + 1) / cols) * (xMax - xMin),
          y_min: yMin + (sampleRow / rows) * (yMax - yMin),
          y_max: yMin + ((sampleRow + 1) / rows) * (yMax - yMin),
          z_min: 20,
          z_max: 40,
          pop: 80,
          static_suitability_score: 0.9,
          sensitivity_level: 0.1,
          privacy_level: 0.1,
          runtime_risk: extraRisk,
          no_fly_zone_names: blockAll || wallBlocked ? ['验证禁飞区'] : [],
          construction_names: [],
          event_names: [],
        })
      }
    }
    return {
      at: at || '2026-08-12T04:00:00.000Z',
      timeZone: timeZone || 'Asia/Shanghai',
      cols,
      rows,
      cells,
    }
  }
}

function planningOptions(provider) {
  return {
    searchBBox: BBOX,
    groundHeight: 50,
    gridSize: 24,
    dynamicCostSurfaceProvider: provider,
    requireDynamicCost: true,
    dynamicCostOptions: { profile: 'balanced' },
    planningAt: '2026-08-12T12:00:00+08:00',
    timeZone: 'Asia/Shanghai',
    startName: '验证起点',
    endName: '验证终点',
  }
}

function persistenceContext(taskId) {
  return {
    taskId,
    start: START,
    end: END,
    startName: '验证起点',
    endName: '验证终点',
    groundHeight: 50,
    gridSize: 24,
    costProfile: 'balanced',
    planningAt: '2026-08-12T12:00:00+08:00',
    timeZone: 'Asia/Shanghai',
  }
}

async function verifyPersistenceWithRollback() {
  const client = await routeStore._pool.connect()
  try {
    await client.query('BEGIN')
    const initialPlan = await planRoute(null, START, END, planningOptions(createSurfaceProvider()))
    const initial = await routeStore.persistPlan(initialPlan, persistenceContext(null), { client })
    const replannedPlan = await planRoute(
      null,
      START,
      END,
      planningOptions(createSurfaceProvider({ wall: true }))
    )
    const replanned = await routeStore.persistPlan(
      replannedPlan,
      persistenceContext(initial.task_id),
      {
        client,
        previousRouteId: initial.route_id,
        trigger: { type: 'verification' },
      }
    )
    const rows = await client.query(
      `SELECT route_id, route_type, previous_route_id, is_current
       FROM runtime.routes WHERE task_id = $1 ORDER BY route_id`,
      [initial.task_id]
    )
    assert.equal(rows.rowCount, 2)
    assert.equal(rows.rows[0].route_type, 'initial')
    assert.equal(rows.rows[0].is_current, false)
    assert.equal(rows.rows[1].route_type, 'replan')
    assert.equal(Number(rows.rows[1].previous_route_id), initial.route_id)
    assert.equal(rows.rows[1].is_current, true)
    assert.equal(replanned.previous_route_id, initial.route_id)

    const auditEvents = await client.query(
      `SELECT event_type, category FROM runtime.audit_events
       WHERE task_id = $1 ORDER BY audit_id`,
      [initial.task_id]
    )
    assert.deepEqual(auditEvents.rows, [{ event_type: 'route_replanned', category: 'safety' }])

    await assert.rejects(
      routeStore.persistPlan(
        replannedPlan,
        persistenceContext(initial.task_id),
        { client, previousRouteId: initial.route_id }
      ),
      (error) => error.code === 'ROUTE_VERSION_CHANGED',
      'stale concurrent replanning should not create a duplicate route version'
    )
    return { initial, replanned, auditEvents: auditEvents.rows }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

function createFakeStore(currentRoute) {
  const events = { persisted: [], suspended: [] }
  return {
    events,
    async listCurrentDynamicRoutes() { return [currentRoute] },
    async getDynamicChangeImpact() { return null },
    async persistPlan(plan, context, options) {
      events.persisted.push({ plan, context, options })
      return {
        route_id: 102,
        task_id: currentRoute.task_id,
        previous_route_id: currentRoute.route_id,
        distance_change_percent: 10,
        risk_change_percent: -5,
      }
    },
    async suspendTask(taskId, reason) { events.suspended.push({ taskId, reason }) },
  }
}

async function verifyAutomaticReplanning() {
  const initialPlan = await planRoute(null, START, END, planningOptions(createSurfaceProvider()))
  const currentRoute = {
    route_id: 101,
    task_id: 201,
    waypoints: initialPlan.route.points,
    distance_m: initialPlan.totalLengthMeters,
    cost: initialPlan.totalTraversalCost,
    planning_context: {
      start: START,
      end: END,
      start_name: '验证起点',
      end_name: '验证终点',
      search_bbox: BBOX,
      ground_height: 50,
      grid_size: 24,
      cost_profile: 'balanced',
      time_zone: 'Asia/Shanghai',
    },
  }

  const replanStore = createFakeStore(currentRoute)
  const replanResult = await dynamicReplanService.processDynamicChanges(
    [{ table: 'no_fly_zones', operation: 'insert', record_id: '1' }],
    { force: true, store: replanStore, surfaceProvider: createSurfaceProvider({ wall: true }) }
  )
  assert.equal(replanResult.replanned_count, 1)
  assert.equal(replanStore.events.persisted.length, 1)
  assert.equal(replanStore.events.persisted[0].options.previousRouteId, currentRoute.route_id)

  const suspendStore = createFakeStore(currentRoute)
  const suspendResult = await dynamicReplanService.processDynamicChanges(
    [{ table: 'no_fly_zones', operation: 'insert', record_id: '2' }],
    { force: true, store: suspendStore, surfaceProvider: createSurfaceProvider({ blockAll: true }) }
  )
  assert.equal(suspendResult.suspended_count, 1)
  assert.equal(suspendStore.events.suspended.length, 1)
  assert.equal(suspendStore.events.persisted.length, 0)

  return { replanResult, suspendResult }
}

async function main() {
  try {
    const persistence = await verifyPersistenceWithRollback()
    const automatic = await verifyAutomaticReplanning()
    console.log(JSON.stringify({
      ok: true,
      persistence_transaction_rolled_back: true,
      initial_route_type: persistence.initial.route_type,
      replan_route_type: persistence.replanned.route_type,
      version_link_verified: persistence.replanned.previous_route_id === persistence.initial.route_id,
      replan_audit_event: persistence.auditEvents[0].event_type,
      automatic_replanned_count: automatic.replanResult.replanned_count,
      no_safe_route_suspended_count: automatic.suspendResult.suspended_count,
    }, null, 2))
  } finally {
    await dynamicReplanService.stop().catch(() => {})
    await routeStore.close()
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
