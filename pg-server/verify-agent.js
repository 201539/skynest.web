require('dotenv').config()

const assert = require('node:assert/strict')
const taskWorkflowStore = require('./lib/taskWorkflowStore')
const taskAgentService = require('./agent/agentService')
const { matchLocation } = require('./agent/locationMatcher')
const { validateAgentOutput } = require('./llm/outputSchema')
const { buildAgentContext } = require('./llm/agentContext')

async function main() {
  const parsed = await taskAgentService.parseInput(
    '明天下午4点前，把2公斤实验材料从环境学院送到基础实验楼，需要防震。',
    { pool: taskWorkflowStore._pool, now: new Date('2026-08-12T02:00:00Z') },
  )
  assert.equal(parsed.origin, '环境学院')
  assert.equal(parsed.destination, '基础实验楼')
  assert.equal(parsed.item_category, '实验材料')
  assert.equal(parsed.weight_kg, 2)
  assert.equal(parsed.recommended_vehicle_class, 'micro')
  assert.equal(parsed.needs_manual_review, true)
  assert.ok(parsed.special_requirements.includes('防震'))
  assert.equal(parsed.agent_analysis.data_source, 'v3_static_buildings+distance_matrix+rules')
  assert.equal(parsed.agent_analysis.location_matches.origin.selected_building.name, '环境学院')
  assert.equal(parsed.agent_analysis.location_matches.destination.match_method, 'exact')
  assert.equal(parsed.agent_analysis.access_point_plan.departure.node_code, 'c')
  assert.equal(parsed.agent_analysis.access_point_plan.receiving.node_code, 'C')
  assert.ok(parsed.candidate_node_ids.length > 0)
  assert.equal(parsed.agent_analysis.ai.mode, 'deterministic_fallback')

  const tampered = await taskAgentService.verifyStructuredTask({
    origin: '杜厦图书馆',
    destination: '基础实验楼',
    item_category: '危险化学品',
    weight_kg: 2,
    deadline: '2026-08-13T16:00',
    priority: 'normal',
    special_requirements: [],
    recommended_vehicle_class: 'micro',
    needs_manual_review: false,
    agent_analysis: { user_confirmed: true, confirmed_at: '2026-08-12T10:00:00.000Z' },
  }, { pool: taskWorkflowStore._pool })
  assert.equal(tampered.recommended_vehicle_class, 'medium')
  assert.equal(tampered.needs_manual_review, true)
  assert.ok(tampered.special_requirements.includes('防漏'))
  assert.equal(tampered.agent_analysis.user_confirmed, true)

  const unknownBuilding = await taskAgentService.verifyStructuredTask({
    ...tampered,
    origin: '不存在的建筑',
  }, { pool: taskWorkflowStore._pool })
  assert.throws(
    () => taskAgentService.assertLocationsMatched(unknownBuilding),
    (error) => error.code === 'PLACE_NOT_CONFIRMED' && error.details.fields.includes('origin')
  )

  const ambiguous = matchLocation('学生公寓', [
    { building_id: 1, name: '学生公寓16幢', aliases: [] },
    { building_id: 2, name: '学生公寓17幢', aliases: [] },
  ])
  assert.equal(ambiguous.status, 'needs_confirmation')
  assert.equal(ambiguous.selected_node, null)

  const context = buildAgentContext(tampered)
  assert.throws(() => validateAgentOutput({
    summary: '测试',
    risk_level: context.policy.risk_level,
    risk_reasons: ['测试'],
    vehicle_explanation: '测试',
    planning_advice: '测试',
    school_advice: '无需校方审核，自动批准。',
    operator_requirements: ['测试'],
    student_message: '已获批准。',
  }, context), /权限边界/)

  const client = await taskWorkflowStore._pool.connect()
  try {
    await client.query('BEGIN')
    const saved = await taskWorkflowStore.createTask({
      ...tampered,
      requester: { name: 'Agent自测', department: '集成测试' },
    }, { client })
    assert.equal(saved.needs_manual_review, true)
    assert.equal(saved.recommended_vehicle_class, 'medium')
    assert.equal(saved.agent_analysis.source, 'v3-deterministic-agent')
    await client.query('ROLLBACK')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  const status = await taskAgentService.getAgentModelStatus()
  assert.equal(status.explanation_only, true)
  assert.equal(status.safety_source, 'V3数据库与确定性规则')

  console.log(JSON.stringify({
    ok: true,
    parsed: {
      route: `${parsed.origin} -> ${parsed.destination}`,
      departure_node: parsed.agent_analysis.access_point_plan.departure.node_code,
      receiving_node: parsed.agent_analysis.access_point_plan.receiving.node_code,
      category: parsed.item_category,
      vehicle: parsed.recommended_vehicle_class,
      manual_review: parsed.needs_manual_review,
      confidence: parsed.agent_analysis.confidence_score,
    },
    tamper_protection: {
      vehicle: tampered.recommended_vehicle_class,
      manual_review: tampered.needs_manual_review,
      handling: tampered.special_requirements,
    },
    model_status: status,
    unknown_building_rejected: true,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await taskWorkflowStore.close().catch(() => {})
  })
