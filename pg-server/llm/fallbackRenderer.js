function buildFallbackAnalysis(context) {
  const task = context.task
  const needsReview = context.policy.needs_manual_review
  const vehicle = context.vehicle_rule.label || context.vehicle_rule.class || '待校方确定机型'
  return {
    summary: `${task.weight_kg ?? '未知重量'}公斤${task.item_description || task.item_category || '待确认物品'}从${task.origin || '待确认起点'}运往${task.destination || '待确认终点'}。`,
    risk_level: context.policy.risk_level,
    risk_reasons: needsReview
      ? ['任务触发V3高风险或信息核对规则']
      : task.special_requirements.length
        ? task.special_requirements.map((item) => `需要满足${item}运输条件`)
        : ['未触发高风险物品规则'],
    vehicle_explanation: context.vehicle_rule.deterministic_reason || `规则库建议${vehicle}。`,
    planning_advice: context.policy.workflow_status === 'ready_for_school_review'
      ? '任务可提交校方审核；获批后再由动态Cost路径算法生成实际航线。'
      : '应先补齐字段、确认地点或完成专项复核，再进入后续规划。',
    school_advice: needsReview ? '请校方重点核验物品资质、包装和运输条件后决定是否批准。' : '建议校方核验任务信息和接驳条件后审批。',
    operator_requirements: [
      `按规则使用${vehicle}`,
      ...task.special_requirements.map((item) => `落实${item}措施`),
    ],
    student_message: needsReview ? '智能预审已完成，这项任务需要校方重点复核。' : '智能预审已完成，可在确认信息后提交校方审核。',
  }
}

module.exports = { buildFallbackAnalysis }
