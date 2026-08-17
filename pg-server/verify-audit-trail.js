require('dotenv').config()

const assert = require('node:assert/strict')
const auditStore = require('./lib/auditStore')
const operatorWorkflowStore = require('./lib/operatorWorkflowStore')
const restrictionStore = require('./lib/restrictionStore')
const taskWorkflowStore = require('./lib/taskWorkflowStore')
const routeStore = require('./lib/routeStore')
const v3Database = require('./lib/v3Database')

function sampleTask() {
  return {
    input_text: '把800克文件从图书馆送到行政楼，需要防水。',
    requester: { id: 'audit-verify-user', name: '审计链路自测', department: '项目组' },
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
    agent_analysis: { source: 'audit-verification', user_confirmed: true },
  }
}

async function counts(client) {
  return (await client.query(`
    SELECT
      (SELECT COUNT(*) FROM runtime.tasks)::integer AS tasks,
      (SELECT COUNT(*) FROM runtime.audit_events)::integer AS audit_events,
      (SELECT COUNT(*) FROM runtime.no_fly_zones)::integer AS restrictions,
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
      reason: '审计链路自测批准',
      reviewer: { name: '自动审核员', department: '项目组' },
    }, { client, planningAt: '2026-08-11T12:00:00+08:00' })

    const operatorWorkspace = await operatorWorkflowStore.getOperatorWorkspace({ client })
    const drone = operatorWorkspace.drones.find((item) => (
      item.status === 'idle' &&
      (item.battery_percent == null || item.battery_percent >= 20) &&
      (item.payload_kg == null || item.payload_kg >= submitted.weight_kg)
    ))
    const routeNodeId = Number(approved.route?.planning_context?.access_points?.receiving?.node_id)
    const node = operatorWorkspace.nodes.find((item) => item.availability === 'available' && item.id === routeNodeId)
    assert.ok(drone, 'verification needs one available drone')
    assert.ok(node, 'verification needs the planned receiving node to be available')

    await operatorWorkflowStore.dispatchTask(submitted.id, {
      drone_id: drone.id,
      node_id: node.id,
      actor: '自动调度员',
    }, { client })
    await operatorWorkflowStore.advanceTask(submitted.id, { actor: '自动调度员' }, { client })
    await operatorWorkflowStore.advanceTask(submitted.id, { actor: '自动调度员' }, { client })
    await operatorWorkflowStore.advanceTask(submitted.id, { actor: '自动调度员' }, { client })

    const restriction = await restrictionStore.createRestriction({
      name: '审计链路自测限制区',
      reason: '验证安全操作写入统一审计记录',
      center: { lng: 118.9479, lat: 32.1101 },
      radius_m: 150,
      start_at: new Date().toISOString(),
      end_at: new Date(Date.now() + 2 * 3600000).toISOString(),
      created_by: { name: '自动安全员', department: '项目组' },
    }, { client })
    await restrictionStore.setRestrictionActive(restriction.id, false, {
      client,
      actor: '自动安全员',
    })

    const taskEvents = await client.query(
      'SELECT event_type FROM runtime.audit_events WHERE task_id = $1 ORDER BY audit_id',
      [submitted.id]
    )
    assert.deepEqual(taskEvents.rows.map((row) => row.event_type), [
      'task_submitted',
      'task_approved',
      'task_dispatched',
      'task_in_transit',
      'task_arriving',
      'task_delivered',
    ])

    const safetyEvents = await client.query(
      `SELECT event_type FROM runtime.audit_events
       WHERE resource_type = 'restriction' AND resource_id = $1
       ORDER BY audit_id`,
      [String(restriction.id)]
    )
    assert.deepEqual(safetyEvents.rows.map((row) => row.event_type), [
      'restriction_created',
      'restriction_disabled',
    ])

    const workspace = await auditStore.getWorkspace({ client })
    assert.equal(workspace.source, 'v3')
    assert.equal(workspace.persistence, 'database')
    assert.equal(workspace.summary.total, initial.audit_events + 8)
    assert.ok(workspace.records.some((record) => (
      record.task_id === submitted.id && record.event_type === 'task_delivered'
    )))
    assert.ok(workspace.records.some((record) => (
      record.resource.type === 'restriction' && record.resource.id === String(restriction.id)
    )))
    assert.ok(workspace.records.every((record, index, records) => (
      index === 0 || new Date(records[index - 1].created_at) >= new Date(record.created_at)
    )))

    await client.query('ROLLBACK')
    const final = await counts(client)
    assert.deepEqual(final, initial, 'audit verification must not leave runtime rows behind')

    console.log(JSON.stringify({
      ok: true,
      task_events: taskEvents.rows.map((row) => row.event_type),
      safety_events: safetyEvents.rows.map((row) => row.event_type),
      persistence: workspace.persistence,
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
