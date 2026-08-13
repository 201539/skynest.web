require('dotenv').config()

const assert = require('node:assert/strict')
const auditStore = require('./lib/auditStore')
const operatorWorkflowStore = require('./lib/operatorWorkflowStore')
const restrictionStore = require('./lib/restrictionStore')
const routeStore = require('./lib/routeStore')
const safetyActionStore = require('./lib/safetyActionStore')
const taskWorkflowStore = require('./lib/taskWorkflowStore')
const v3Database = require('./lib/v3Database')

function sampleTask() {
  return {
    input_text: '把800克文件从图书馆送到行政楼，需要防水。',
    requester: { id: 'safety-action-verify', name: '安全操作自测', department: '项目组' },
    origin: '图书馆',
    destination: '行政楼',
    item_category: '文件图书',
    weight_kg: 0.8,
    deadline: new Date(Date.now() + 4 * 3600000).toISOString(),
    priority: 'normal',
    safety_level: 'normal',
    special_requirements: ['防水'],
    recommended_vehicle_class: 'light',
    candidate_node_ids: [],
    needs_manual_review: false,
    missing_fields: [],
    agent_analysis: { source: 'safety-action-verification', user_confirmed: true },
  }
}

function distanceMeters(left, right) {
  const latitude = ((Number(left.lat) + Number(right.lat)) / 2) * Math.PI / 180
  const deltaX = (Number(left.lng) - Number(right.lng)) * 111320 * Math.cos(latitude)
  const deltaY = (Number(left.lat) - Number(right.lat)) * 111320
  return Math.hypot(deltaX, deltaY)
}

function createRestrictionAwareSurface(restriction) {
  return async ({ xMin, xMax, yMin, yMax, cols, rows, at, timeZone }) => {
    const cells = []
    const cellWidthMeters = ((xMax - xMin) / cols) * 111320 * Math.cos(restriction.center.lat * Math.PI / 180)
    const cellHeightMeters = ((yMax - yMin) / rows) * 111320
    const blockedRadius = restriction.radius_m + Math.hypot(cellWidthMeters, cellHeightMeters) / 2 + 20
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < cols; column += 1) {
        const cell = {
          sample_col: column,
          sample_row: row,
          new_id: row * cols + column + 1,
          grid_code: `safety-${column}-${row}`,
          x_min: xMin + (column / cols) * (xMax - xMin),
          x_max: xMin + ((column + 1) / cols) * (xMax - xMin),
          y_min: yMin + (row / rows) * (yMax - yMin),
          y_max: yMin + ((row + 1) / rows) * (yMax - yMin),
          z_min: 20,
          z_max: 40,
          pop: 60,
          static_suitability_score: 0.9,
          sensitivity_level: 0.1,
          privacy_level: 0.1,
          runtime_risk: 0,
          construction_names: [],
          event_names: [],
        }
        const center = {
          lng: (cell.x_min + cell.x_max) / 2,
          lat: (cell.y_min + cell.y_max) / 2,
        }
        cell.no_fly_zone_names = distanceMeters(center, restriction.center) <= blockedRadius
          ? [restriction.name]
          : []
        cells.push(cell)
      }
    }
    return {
      at: at || new Date().toISOString(),
      timeZone: timeZone || 'Asia/Shanghai',
      cols,
      rows,
      cells,
    }
  }
}

async function counts(client) {
  return (await client.query(`
    SELECT
      (SELECT COUNT(*) FROM runtime.tasks)::integer AS tasks,
      (SELECT COUNT(*) FROM runtime.routes)::integer AS routes,
      (SELECT COUNT(*) FROM runtime.no_fly_zones)::integer AS restrictions,
      (SELECT COUNT(*) FROM runtime.operation_events)::integer AS operation_events,
      (SELECT COUNT(*) FROM runtime.audit_events)::integer AS audit_events,
      (SELECT COUNT(*) FROM runtime.node_states WHERE task_id IS NOT NULL)::integer AS reserved_nodes,
      (SELECT COUNT(*) FROM runtime.drones WHERE task_id IS NOT NULL)::integer AS assigned_drones
  `)).rows[0]
}

async function main() {
  const client = await taskWorkflowStore._pool.connect()
  try {
    const initial = await counts(client)
    await client.query('BEGIN')

    const submitted = await taskWorkflowStore.createTask(sampleTask(), { client })
    const approved = await taskWorkflowStore.reviewTask(submitted.id, {
      decision: 'approved',
      reason: '安全操作自测批准',
      reviewer: { name: '自动审核员', department: '项目组' },
    }, { client })
    const originalWaypoints = approved.route.waypoints
    const midpoint = originalWaypoints[Math.floor(originalWaypoints.length / 2)]
    const restriction = await restrictionStore.createRestriction({
      name: '安全操作自测限制区',
      reason: '验证真实手动重规划',
      center: { lng: midpoint.lng, lat: midpoint.lat },
      radius_m: 55,
      start_at: new Date().toISOString(),
      end_at: new Date(Date.now() + 2 * 3600000).toISOString(),
      created_by: { name: '自动安全员', department: '项目组' },
    }, { client })

    const beforeReplan = await restrictionStore.getSafetyWorkspace({ client })
    const affected = beforeReplan.affected_routes.find((item) => item.task.id === submitted.id)
    assert.ok(affected, 'the test restriction must appear as a route conflict')
    assert.equal(affected.conflicts[0].restriction.id, restriction.id)

    const replannedWorkspace = await safetyActionStore.manualReplanTask(submitted.id, {
      restriction_id: restriction.id,
      actor: '自动安全员',
    }, {
      client,
      surfaceProvider: createRestrictionAwareSurface(restriction),
    })
    const routeRows = await client.query(
      `SELECT route_id, route_type, previous_route_id, is_current, change_trigger
       FROM runtime.routes WHERE task_id = $1 ORDER BY route_id`,
      [submitted.id]
    )
    assert.equal(routeRows.rowCount, 2)
    assert.equal(routeRows.rows[0].is_current, false)
    assert.equal(routeRows.rows[1].route_type, 'replan')
    assert.equal(Number(routeRows.rows[1].previous_route_id), Number(routeRows.rows[0].route_id))
    assert.equal(routeRows.rows[1].change_trigger.type, 'manual_restriction_replan')
    assert.ok(replannedWorkspace.recent_replans.some((item) => item.task.id === submitted.id))
    assert.ok(!replannedWorkspace.affected_routes.some((item) => item.task.id === submitted.id))

    const operatorWorkspace = await operatorWorkflowStore.getOperatorWorkspace({ client })
    const drone = operatorWorkspace.drones.find((item) => (
      item.status === 'idle' &&
      (item.battery_percent == null || item.battery_percent >= 20) &&
      (item.payload_kg == null || item.payload_kg >= submitted.weight_kg)
    ))
    const node = operatorWorkspace.nodes.find((item) => item.availability === 'available')
    assert.ok(drone, 'verification needs one available drone')
    assert.ok(node, 'verification needs one available transfer node')
    await operatorWorkflowStore.dispatchTask(submitted.id, {
      drone_id: drone.id,
      node_id: node.id,
      actor: '自动调度员',
    }, { client })
    await operatorWorkflowStore.advanceTask(submitted.id, { actor: '自动调度员' }, { client })

    const activeWorkspace = await restrictionStore.getSafetyWorkspace({ client })
    const activeTask = activeWorkspace.active_tasks.find((item) => item.task.id === submitted.id)
    assert.ok(activeTask, 'running task must appear in the safety workspace')
    assert.equal(activeTask.assigned_drone.id, drone.id)
    assert.equal(activeTask.assigned_node.id, node.id)

    const stoppedWorkspace = await safetyActionStore.emergencyStopTask(submitted.id, {
      reason: '突发活动进入航线缓冲区',
      actor: '自动安全员',
    }, { client })
    assert.ok(!stoppedWorkspace.active_tasks.some((item) => item.task.id === submitted.id))

    const stoppedTask = (await client.query(
      `SELECT status, exception_reason, suspended_at
       FROM runtime.tasks WHERE task_id = $1`,
      [submitted.id]
    )).rows[0]
    assert.equal(stoppedTask.status, 'suspended')
    assert.equal(stoppedTask.exception_reason, '突发活动进入航线缓冲区')
    assert.ok(stoppedTask.suspended_at)

    const releasedDrone = (await client.query(
      'SELECT status, task_id FROM runtime.drones WHERE drone_id = $1',
      [drone.id]
    )).rows[0]
    const releasedNode = (await client.query(
      `SELECT availability, door_state, delivery_state, task_id
       FROM runtime.node_states WHERE node_id = $1`,
      [node.id]
    )).rows[0]
    assert.deepEqual(releasedDrone, { status: 'returning', task_id: null })
    assert.deepEqual(releasedNode, {
      availability: 'available',
      door_state: 'closed',
      delivery_state: 'interrupted',
      task_id: null,
    })

    const safetyEvents = await client.query(
      `SELECT event_type FROM runtime.audit_events
       WHERE task_id = $1 AND category = 'safety'
       ORDER BY audit_id`,
      [submitted.id]
    )
    assert.deepEqual(safetyEvents.rows.map((row) => row.event_type), [
      'route_replanned',
      'emergency_stop',
    ])
    const operationEvents = await client.query(
      `SELECT event_type FROM runtime.operation_events
       WHERE task_id = $1 ORDER BY event_id`,
      [submitted.id]
    )
    assert.deepEqual(operationEvents.rows.map((row) => row.event_type), [
      'task_dispatched',
      'task_in_transit',
      'emergency_stop',
    ])

    await client.query('ROLLBACK')
    const final = await counts(client)
    assert.deepEqual(final, initial, 'safety action verification must not leave runtime rows behind')

    console.log(JSON.stringify({
      ok: true,
      manual_replan: {
        route_versions: 2,
        conflict_detected: true,
        conflict_cleared: true,
      },
      emergency_stop: {
        task_status: 'suspended',
        drone_released: true,
        node_released: true,
      },
      audit_events: safetyEvents.rows.map((row) => row.event_type),
      transaction_rolled_back: true,
      persisted_test_rows: 0,
    }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
    await Promise.allSettled([
      auditStore.close(),
      restrictionStore.close(),
      taskWorkflowStore.close(),
      routeStore.close(),
      v3Database.close(),
    ])
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
