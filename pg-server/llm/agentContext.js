function riskLevel(task, analysis) {
  if (task.needs_manual_review) return 'high'
  if (['emergency', 'urgent', 'high'].includes(task.priority) || task.special_requirements?.length) return 'medium'
  return 'low'
}

function buildAgentContext(task) {
  const analysis = task.agent_analysis || {}
  const vehicle = analysis.vehicle_recommendation?.vehicle || null
  return {
    task: {
      origin: task.origin || null,
      destination: task.destination || null,
      item_category: task.item_category || null,
      weight_kg: task.weight_kg ?? null,
      deadline: task.deadline || null,
      priority: task.priority || 'normal',
      special_requirements: task.special_requirements || [],
    },
    node_matching: {
      origin: analysis.location_matches?.origin?.selected_building?.name || analysis.location_matches?.origin?.selected_node?.name || null,
      destination: analysis.location_matches?.destination?.selected_building?.name || analysis.location_matches?.destination?.selected_node?.name || null,
      origin_status: analysis.location_matches?.origin?.status || 'unknown',
      destination_status: analysis.location_matches?.destination?.status || 'unknown',
    },
    vehicle_rule: {
      class: vehicle?.code || task.recommended_vehicle_class || null,
      label: vehicle?.label || null,
      deterministic_reason: analysis.vehicle_recommendation?.reason || '',
    },
    policy: {
      workflow_status: analysis.workflow_status || 'unknown',
      risk_level: riskLevel(task, analysis),
      needs_manual_review: Boolean(task.needs_manual_review),
      deterministic_explanation: analysis.explanation || '',
      authority_boundary: 'LLM仅生成解释，不得修改风险等级、机型规则、航线坐标或校方审批结果。',
    },
  }
}

module.exports = { buildAgentContext }
