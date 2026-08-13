const AGENT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
    risk_reasons: { type: 'array', items: { type: 'string' } },
    vehicle_explanation: { type: 'string' },
    planning_advice: { type: 'string' },
    school_advice: { type: 'string' },
    operator_requirements: { type: 'array', items: { type: 'string' } },
    student_message: { type: 'string' },
  },
  required: ['summary', 'risk_level', 'risk_reasons', 'vehicle_explanation', 'planning_advice', 'school_advice', 'operator_requirements', 'student_message'],
  additionalProperties: false,
}

function validateAgentOutput(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型输出不是JSON对象')
  const allowed = new Set(Object.keys(AGENT_OUTPUT_SCHEMA.properties))
  const extras = Object.keys(value).filter((key) => !allowed.has(key))
  if (extras.length) throw new Error(`模型输出包含未授权字段：${extras.join(', ')}`)
  for (const field of ['summary', 'vehicle_explanation', 'planning_advice', 'school_advice', 'student_message']) {
    if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error(`模型输出缺少有效字段：${field}`)
  }
  if (value.risk_level !== context.policy.risk_level) throw new Error('模型输出风险等级与确定性规则不一致')
  if (!Array.isArray(value.risk_reasons) || !value.risk_reasons.every((item) => typeof item === 'string')) throw new Error('模型输出风险原因格式无效')
  if (!Array.isArray(value.operator_requirements) || !value.operator_requirements.every((item) => typeof item === 'string')) throw new Error('模型输出运营要求格式无效')
  const forbidden = /无需(?:校方|人工)?(?:审核|审批|复核)|自动(?:审核|审批|批准)|直接批准|绕过(?:审核|审批)|已获批准/
  if (forbidden.test(value.school_advice) || forbidden.test(value.student_message)) throw new Error('模型输出越过了校方审批权限边界')
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    Array.isArray(item) ? item.map((entry) => entry.trim()).filter(Boolean).slice(0, 6) : item.trim(),
  ]))
}

module.exports = { AGENT_OUTPUT_SCHEMA, validateAgentOutput }
