require('dotenv').config()

const assert = require('node:assert/strict')
const taskWorkflowStore = require('./lib/taskWorkflowStore')
const routeStore = require('./lib/routeStore')
const v3Database = require('./lib/v3Database')
const placeResolver = require('./lib/placeResolver')

function sampleTask(overrides = {}) {
  return {
    input_text: '把800克文件从杜厦图书馆送到行政南楼，需要防水。',
    requester: { id: 'verify-user', name: '流程自测用户', department: '项目组' },
    origin: '杜厦图书馆',
    destination: '行政南楼',
    item_category: '文件图书',
    weight_kg: 0.8,
    deadline: new Date(Date.now() + 4 * 3600000).toISOString(),
    priority: 'normal',
    safety_level: 'normal',
    special_requirements: ['防水'],
    recommended_vehicle_class: 'light-cargo',
    candidate_node_ids: [],
    needs_manual_review: false,
    missing_fields: [],
    agent_analysis: { source: 'verification', user_confirmed: true },
    ...overrides,
  }
}

async function main() {
  assert.throws(() => taskWorkflowStore.validateTask({}), /weight_kg/)
  assert.ok(placeResolver.supportedPlaceNames().includes('图书馆'))

  const client = await taskWorkflowStore._pool.connect()
  try {
    const initial = (await client.query(`
      SELECT
        (SELECT COUNT(*) FROM runtime.tasks)::integer AS tasks,
        (SELECT COUNT(*) FROM runtime.routes)::integer AS routes,
        (SELECT COUNT(*) FROM runtime.approvals)::integer AS approvals
    `)).rows[0]
    await client.query('BEGIN')

    const submitted = await taskWorkflowStore.createTask(sampleTask(), { client })
    assert.equal(submitted.status, 'pending_review')
    assert.equal(submitted.requester.name, '流程自测用户')
    assert.equal(submitted.input_text.includes('图书馆'), true)

    const queue = await taskWorkflowStore.listWorkspace({ client })
    assert.ok(queue.some((item) => item.task.id === submitted.id))

    const approved = await taskWorkflowStore.reviewTask(submitted.id, {
      decision: 'approved',
      reason: '事务自测批准',
      reviewer: { name: '自动审核员', department: '项目组' },
    }, {
      client,
      planningAt: '2026-08-11T12:00:00+08:00',
    })
    assert.equal(approved.task.status, 'approved')
    assert.equal(approved.approval.decision, 'approved')
    assert.equal(approved.approval.reason, '事务自测批准')
    assert.ok(approved.route)
    assert.equal(approved.route.cost_model, 'dynamic-v1')
    assert.ok(approved.route.waypoints.length >= 2)
    assert.ok(approved.route.total_length_meters > 0)
    assert.equal(approved.route.planning_context.cost_thresholds.minFlightHeight, 40)
    assert.equal(approved.route.planning_context.cost_thresholds.maxFlightHeight, 120)
    assert.equal(approved.route.planning_context.cost_weights.distance, 1)
    assert.equal(approved.route.planning_context.cost_weights.maneuver, 1)
    assert.equal(approved.route.planning_context.access_points.departure.building_name, '杜厦图书馆')
    assert.match(approved.route.planning_context.access_points.departure.node_code, /^[A-G]$/)
    assert.equal(approved.route.planning_context.access_points.receiving.building_name, '行政南楼')
    assert.match(approved.route.planning_context.access_points.receiving.node_code, /^[A-G]$/)

    const rejectedTask = await taskWorkflowStore.createTask(sampleTask({
      origin: '环境学院',
      destination: '杜厦图书馆',
    }), { client })
    const rejected = await taskWorkflowStore.reviewTask(rejectedTask.id, {
      decision: 'rejected',
      reason: '事务自测驳回',
      reviewer: { name: '自动审核员' },
    }, { client })
    assert.equal(rejected.task.status, 'rejected')
    assert.equal(rejected.route, null)

    await assert.rejects(
      () => taskWorkflowStore.resubmitRejectedTask(rejectedTask.id, sampleTask(), {
        client,
        requesterId: 'another-user',
      }),
      (error) => error.code === 'PERMISSION_DENIED'
    )

    const revisedDeadline = new Date(Date.now() + 6 * 3600000).toISOString()
    const resubmitted = await taskWorkflowStore.resubmitRejectedTask(rejectedTask.id, sampleTask({
      origin: '环境学院',
      destination: '杜厦图书馆',
      weight_kg: 0.6,
      deadline: revisedDeadline,
      special_requirements: ['防水', '轻拿轻放'],
    }), {
      client,
      requesterId: 'verify-user',
      requester: { name: '流程自测用户', department: '项目组' },
    })
    assert.equal(resubmitted.task.id, rejectedTask.id, 'resubmission must keep the original task id')
    assert.equal(resubmitted.task.status, 'pending_review')
    assert.equal(resubmitted.task.weight_kg, 0.6)
    assert.deepEqual(resubmitted.task.special_requirements, ['防水', '轻拿轻放'])
    assert.equal(resubmitted.approval.decision, 'rejected', 'previous rejection must remain visible')
    assert.equal(resubmitted.approval.reason, '事务自测驳回')

    await assert.rejects(
      () => taskWorkflowStore.resubmitRejectedTask(rejectedTask.id, sampleTask(), {
        client,
        requesterId: 'verify-user',
      }),
      (error) => error.code === 'TASK_NOT_RESUBMITTABLE'
    )
    const resubmitAudit = await client.query(
      `SELECT event_type FROM runtime.audit_events
       WHERE task_id = $1 AND event_type = 'task_resubmitted'`,
      [rejectedTask.id]
    )
    assert.equal(resubmitAudit.rowCount, 1)

    await client.query('ROLLBACK')
    const final = (await client.query(`
      SELECT
        (SELECT COUNT(*) FROM runtime.tasks)::integer AS tasks,
        (SELECT COUNT(*) FROM runtime.routes)::integer AS routes,
        (SELECT COUNT(*) FROM runtime.approvals)::integer AS approvals
    `)).rows[0]
    assert.deepEqual(final, initial, 'transaction verification must not leave workflow rows behind')

    console.log(JSON.stringify({
      ok: true,
      submitted_status: submitted.status,
      approved_status: approved.task.status,
      approved_route_model: approved.route.cost_model,
      approved_route_points: approved.route.waypoints.length,
      approved_departure_node: approved.route.planning_context.access_points.departure.node_code,
      approved_receiving_node: approved.route.planning_context.access_points.receiving.node_code,
      rejected_status: rejected.task.status,
      resubmitted_status: resubmitted.task.status,
      resubmitted_same_task_id: resubmitted.task.id === rejectedTask.id,
      previous_rejection_preserved: resubmitted.approval.decision === 'rejected',
      ownership_protected: true,
      transaction_rolled_back: true,
      persisted_test_rows: { tasks: 0, routes: 0, approvals: 0 },
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
