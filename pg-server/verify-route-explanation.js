require('dotenv').config()

const assert = require('node:assert/strict')
const routeExplanationService = require('./lib/routeExplanationService')
const taskWorkflowStore = require('./lib/taskWorkflowStore')
const routeStore = require('./lib/routeStore')
const v3Database = require('./lib/v3Database')

function sampleRoute(overrides = {}) {
  return {
    id: 88,
    algorithm: 'A*',
    cost_model: 'dynamic-v1',
    route_type: 'replan',
    waypoints: [{ lng: 118.94, lat: 32.11 }, { lng: 118.95, lat: 32.12 }],
    main_risk_factors: ['午间人流'],
    avoided_zones: ['中央主干道'],
    distance_change_percent: 12,
    risk_change_percent: -28,
    ...overrides,
  }
}

function sampleTask() {
  return {
    input_text: '把文件从图书馆送到行政楼。',
    requester: { id: 'route-explanation-verify', name: '解释助手自测用户', department: '项目组' },
    origin: '图书馆',
    destination: '行政楼',
    item_category: '文件图书',
    weight_kg: 0.8,
    deadline: new Date(Date.now() + 4 * 3600000).toISOString(),
    priority: 'normal',
    safety_level: 'normal',
    special_requirements: [],
    recommended_vehicle_class: 'light-cargo',
    candidate_node_ids: [],
    needs_manual_review: false,
    missing_fields: [],
    agent_analysis: { source: 'verification', user_confirmed: true },
  }
}

async function main() {
  const explanation = routeExplanationService.explainRoute(sampleRoute())
  assert.equal(explanation.summary, '算法识别到本航线的主要风险因素包括午间人流。推荐航线已避开中央主干道。与上一版相比，新航线距离增加约12%，综合风险下降约28%。')
  assert.equal(explanation.evidence.distance_change_percent, 12)
  assert.equal(explanation.evidence.risk_change_percent, -28)
  assert.equal(explanation.confidence.confirmation_required, false)
  assert.equal(explanation.guardrails.route_reason_inference_used, false)

  const initialExplanation = routeExplanationService.explainRoute(sampleRoute({
    route_type: 'initial',
    distance_change_percent: null,
    risk_change_percent: null,
  }))
  assert.equal(initialExplanation.summary.includes('%'), false)
  assert.equal(initialExplanation.summary.includes('首版推荐航线'), true)
  assert.equal(initialExplanation.confidence.confirmation_required, false)

  const incompleteExplanation = routeExplanationService.explainRoute(sampleRoute({
    waypoints: [],
    risk_change_percent: null,
  }))
  assert.equal(incompleteExplanation.confidence.confirmation_required, true)
  assert.ok(incompleteExplanation.confidence.missing_fields.includes('waypoints'))
  assert.ok(incompleteExplanation.confidence.missing_fields.includes('risk_change_percent'))
  assert.equal(incompleteExplanation.summary.includes('须经人工确认'), true)

  const client = await taskWorkflowStore._pool.connect()
  try {
    await client.query('BEGIN')
    const submitted = await taskWorkflowStore.createTask(sampleTask(), { client })
    const approved = await taskWorkflowStore.reviewTask(submitted.id, {
      decision: 'approved',
      reason: '解释助手事务自测批准',
      reviewer: { name: '自动审核员', department: '项目组' },
    }, { client })
    assert.ok(approved.route?.explanation)
    assert.equal(approved.route.explanation.route_id, approved.route.id)
    assert.deepEqual(
      approved.route.explanation.evidence.main_risk_factors,
      approved.route.main_risk_factors,
      'explanation must use the stored algorithm risk factors verbatim'
    )
    assert.deepEqual(
      approved.route.explanation.evidence.avoided_zones,
      approved.route.avoided_zones,
      'explanation must use the stored avoided zones verbatim'
    )
    assert.equal(approved.route.explanation.evidence.comparison_available, false)
    assert.equal(approved.route.explanation.summary.includes('%'), false)
    await client.query('ROLLBACK')

    console.log(JSON.stringify({
      ok: true,
      deterministic_example: explanation.summary,
      initial_route_hides_change_percentages: true,
      incomplete_data_requires_confirmation: true,
      workflow_route_explanation_embedded: true,
      transaction_rolled_back: true,
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
