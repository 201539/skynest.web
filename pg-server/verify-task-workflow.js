require('dotenv').config()

const assert = require('node:assert/strict')
const taskWorkflowStore = require('./lib/taskWorkflowStore')
const routeStore = require('./lib/routeStore')
const v3Database = require('./lib/v3Database')
const placeResolver = require('./lib/placeResolver')

function sampleTask(overrides = {}) {
  return {
    input_text: '把800克文件从图书馆送到行政楼，需要防水。',
    requester: { id: 'verify-user', name: '流程自测用户', department: '项目组' },
    origin: '图书馆',
    destination: '行政楼',
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
    }, { client })
    assert.equal(approved.task.status, 'approved')
    assert.equal(approved.approval.decision, 'approved')
    assert.equal(approved.approval.reason, '事务自测批准')
    assert.ok(approved.route)
    assert.equal(approved.route.cost_model, 'dynamic-v1')
    assert.ok(approved.route.waypoints.length >= 2)
    assert.ok(approved.route.total_length_meters > 0)

    const rejectedTask = await taskWorkflowStore.createTask(sampleTask({
      origin: '南门入口',
      destination: '食堂',
    }), { client })
    const rejected = await taskWorkflowStore.reviewTask(rejectedTask.id, {
      decision: 'rejected',
      reason: '事务自测驳回',
      reviewer: { name: '自动审核员' },
    }, { client })
    assert.equal(rejected.task.status, 'rejected')
    assert.equal(rejected.route, null)

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
      rejected_status: rejected.task.status,
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
