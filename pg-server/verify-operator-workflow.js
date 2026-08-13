require('dotenv').config()

const assert = require('node:assert/strict')
const operatorWorkflowStore = require('./lib/operatorWorkflowStore')
const taskWorkflowStore = require('./lib/taskWorkflowStore')
const routeStore = require('./lib/routeStore')
const v3Database = require('./lib/v3Database')

function sampleTask() {
  return {
    input_text: '把800克文件从图书馆送到行政楼，需要防水。',
    requester: { id: 'operator-verify-user', name: '运营闭环自测', department: '项目组' },
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
    agent_analysis: { source: 'operator-verification', user_confirmed: true },
  }
}

function findTask(workspace, taskId) {
  return workspace.tasks.find((item) => item.task.id === taskId)
}

async function counts(client) {
  return (await client.query(`
    SELECT
      (SELECT COUNT(*) FROM runtime.tasks)::integer AS tasks,
      (SELECT COUNT(*) FROM runtime.routes)::integer AS routes,
      (SELECT COUNT(*) FROM runtime.approvals)::integer AS approvals,
      (SELECT COUNT(*) FROM runtime.operation_events)::integer AS operation_events,
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
      reason: '运营闭环自测批准',
      reviewer: { name: '自动审核员', department: '项目组' },
    }, { client })
    assert.equal(approved.task.status, 'approved')
    assert.ok(approved.route)

    const beforeDispatch = await operatorWorkflowStore.getOperatorWorkspace({ client })
    const drone = beforeDispatch.drones.find((item) => (
      item.status === 'idle' &&
      (item.battery_percent == null || item.battery_percent >= 20) &&
      (item.payload_kg == null || item.payload_kg >= submitted.weight_kg)
    ))
    const node = beforeDispatch.nodes.find((item) => item.availability === 'available')
    assert.ok(drone, 'verification needs one available drone')
    assert.ok(node, 'verification needs one available transfer node')

    const dispatched = await operatorWorkflowStore.dispatchTask(submitted.id, {
      drone_id: drone.id,
      node_id: node.id,
      actor: '运营闭环自动测试',
    }, { client })
    const dispatchedTask = findTask(dispatched, submitted.id)
    assert.equal(dispatchedTask.task.status, 'dispatched')
    assert.equal(dispatchedTask.task.assigned_drone_id, drone.id)
    assert.equal(dispatchedTask.task.assigned_node_id, node.id)
    assert.equal(dispatchedTask.assigned_drone.status, 'assigned')
    assert.equal(dispatchedTask.assigned_node.availability, 'reserved')

    const inTransit = await operatorWorkflowStore.advanceTask(
      submitted.id,
      { actor: '运营闭环自动测试' },
      { client }
    )
    assert.equal(findTask(inTransit, submitted.id).task.status, 'in_transit')
    assert.equal(findTask(inTransit, submitted.id).assigned_drone.status, 'in_flight')

    const arriving = await operatorWorkflowStore.advanceTask(
      submitted.id,
      { actor: '运营闭环自动测试' },
      { client }
    )
    assert.equal(findTask(arriving, submitted.id).task.status, 'arriving')
    assert.equal(findTask(arriving, submitted.id).assigned_node.availability, 'occupied')
    assert.equal(findTask(arriving, submitted.id).assigned_node.door_state, 'opening')

    const delivered = await operatorWorkflowStore.advanceTask(
      submitted.id,
      { actor: '运营闭环自动测试' },
      { client }
    )
    const deliveredTask = findTask(delivered, submitted.id)
    assert.equal(deliveredTask.task.status, 'delivered')
    assert.ok(deliveredTask.task.completed_at)
    assert.equal(deliveredTask.assigned_drone.status, 'idle')
    assert.equal(deliveredTask.assigned_drone.task_id, null)
    assert.equal(deliveredTask.assigned_node.availability, 'available')
    assert.equal(deliveredTask.assigned_node.task_id, null)

    const events = await client.query(
      'SELECT event_type FROM runtime.operation_events WHERE task_id = $1 ORDER BY event_id',
      [submitted.id]
    )
    assert.deepEqual(events.rows.map((row) => row.event_type), [
      'task_dispatched', 'task_in_transit', 'task_arriving', 'task_delivered',
    ])

    await client.query('ROLLBACK')
    const final = await counts(client)
    assert.deepEqual(final, initial, 'operator verification must not leave runtime rows behind')

    console.log(JSON.stringify({
      ok: true,
      statuses: ['approved', 'dispatched', 'in_transit', 'arriving', 'delivered'],
      resource_changes: ['drone_assigned', 'node_reserved', 'node_occupied', 'resources_released'],
      events: events.rows.map((row) => row.event_type),
      transaction_rolled_back: true,
      persisted_test_rows: 0,
    }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
    await Promise.allSettled([
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
