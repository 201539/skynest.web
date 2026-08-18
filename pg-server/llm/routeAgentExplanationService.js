const { getLlmConfig } = require('./config')

const riskLabels = {
  static_environment: '静态适航', population_density: '人流密度',
  weather_default_configured: '默认天气参数', realtime_weather: '实时天气',
  runtime_restriction: '实时限制区', dynamic_event: '动态事件',
}

function distanceLabel(value) {
  const number = Number(value)
  return number >= 1000 ? `${(number / 1000).toFixed(2)}公里` : `${Math.round(number)}米`
}

function categoryChecks(category) {
  if (category === '危险化学品') return '校方须核验危化品运输资质、密封防漏包装、接收人员和泄漏应急预案。'
  if (category === '高价值设备') return '校方须核验防震包装、交接责任、接收人身份和设备保全措施。'
  if (category === '医疗样本' || category === '生物材料') return '校方须核验运输资质、冷链连续性、包装和接收条件。'
  return ''
}

function directDistanceMeters(start, end) {
  const rad = Math.PI / 180
  const lat1 = Number(start.lat) * rad
  const lat2 = Number(end.lat) * rad
  const dLat = lat2 - lat1
  const dLng = (Number(end.lng) - Number(start.lng)) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

function buildEvidence(task, plan, places) {
  const summary = plan.dynamicCost?.summary || {}
  const coverage = plan.dynamicCost?.dataCoverage || {}
  const durationSeconds = Math.max(25, Math.min(120, Math.round(Number(plan.totalLengthMeters || 0) / 25)))
  const deadlineMs = new Date(task.deadline).getTime()
  const remainingSeconds = Number.isFinite(deadlineMs) ? Math.round((deadlineMs - Date.now()) / 1000) : null
  const straight = directDistanceMeters(places.start, places.end)
  const detourPercent = straight > 0 ? Math.round((Number(plan.totalLengthMeters) - straight) / straight * 1000) / 10 : null
  return {
    task: { category: task.item_category, weight_kg: task.weight_kg, priority: task.priority, deadline: task.deadline, requirements: task.special_requirements || [] },
    access: { departure: places.start.node_code, receiving: places.end.node_code },
    route: { algorithm: plan.algorithm, cost_model: plan.costModel, waypoints: plan.route.points.length, distance_m: plan.totalLengthMeters, estimated_duration_seconds: durationSeconds, direct_distance_m: straight || null, detour_percent: detourPercent },
    risk_factors: (plan.route.mainRiskFactors || []).map((item) => riskLabels[item] || item),
    avoided_zones: plan.route.avoidedZones || [],
    grid: { sampled: coverage.sampled || null, blocked: summary.blocked ?? null, passable: summary.passable ?? null, default_weather_cells: summary.weather_data?.configured_default || 0, realtime_weather_cells: summary.weather_data?.realtime || 0 },
    sla: {
      remaining_seconds: remainingSeconds,
      estimated_seconds: durationSeconds,
      remaining_text: remainingSeconds == null ? '未记录' : `约${Math.max(0, Math.round(remainingSeconds / 60))}分钟`,
      estimated_text: durationSeconds < 60 ? `约${durationSeconds}秒` : `约${Math.ceil(durationSeconds / 60)}分钟`,
      feasible: remainingSeconds == null ? null : remainingSeconds >= durationSeconds,
    },
    category_checks: categoryChecks(task.item_category),
  }
}

function fallbackSummary(e) {
  const route = e.route
  const grid = e.grid
  const sla = e.sla.feasible == null ? '未获得有效时限' : e.sla.feasible ? `预计${route.estimated_duration_seconds}秒，可在截止时间前完成` : `预计${route.estimated_duration_seconds}秒，可能无法满足截止时间`
  const weather = grid.default_weather_cells ? `当前${grid.default_weather_cells}个采样格网使用默认天气，航线结论为临时结果，执行前必须用实时天气复算` : '已使用实时天气数据'
  const comparison = route.detour_percent == null ? '未保存可用的直线路径对比' : `较节点直线距离变化${route.detour_percent > 0 ? '+' : ''}${route.detour_percent}%`
  return `${route.algorithm}生成L3-${e.access.departure}至L3-${e.access.receiving}的${route.waypoints}个航点，全长${distanceLabel(route.distance_m)}，${comparison}；${grid.sampled || '未记录'}个格网中${grid.blocked ?? '未记录'}个不可通行，主要风险为${e.risk_factors.join('、') || '未记录'}。${sla}；${weather}。${e.category_checks}Agent仅解释结果。`
}

async function explainEvidence(evidence) {
  const config = getLlmConfig()
  const fallback = fallbackSummary(evidence)
  if (!config.enabled || config.provider !== 'deepseek' || !config.apiKey) return { status: 'fallback', summary: fallback, evidence, provider: 'rules', model: null, fallback_used: true }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, signal: controller.signal, body: JSON.stringify({ model: config.model, temperature: 0.1, max_tokens: 500, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, messages: [{ role: 'system', content: '你是航线结果解释器，只能解释给定证据，不得修改或补造任何数字、节点、风险、机型和审批结果。只返回JSON。' }, { role: 'user', content: `请输出{"summary":"一段100至180字自然、专业中文决策摘要"}。必须原样使用sla中的estimated_text和remaining_text，禁止自行换算；必须说明时限是否可达、天气是真实还是默认、路线与直线距离对比。危险或高价值物品有专项要求时才写核验内容。任务要求只代表待执行条件，禁止写成“已核验”“已确认”“符合”“合规”；应写“执行前确认”。绕行数组为空时只能写“未记录明确绕行区域”，禁止写“全程无风险/无规避区域”。禁止出现JSON字段名、英文变量、ISO时间、“为空”或“未提及”等调试语言。最后说明Agent仅解释。证据：${JSON.stringify(evidence)}` }] }) })
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`)
    const payload = await response.json()
    const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || '{}')
    if (typeof parsed.summary !== 'string' || parsed.summary.trim().length < 30) throw new Error('DeepSeek航线解释为空或过短')
    if (!parsed.summary.includes(evidence.sla.estimated_text) || !parsed.summary.includes(distanceLabel(evidence.route.distance_m))) throw new Error('DeepSeek航线解释中的时长或距离与确定性证据不一致')
    return { status: 'generated', summary: parsed.summary.trim(), evidence, provider: 'deepseek', model: config.model, fallback_used: false }
  } catch (error) {
    return { status: 'fallback', summary: fallback, evidence, provider: 'rules', model: config.model, fallback_used: true, error: error.message }
  } finally { clearTimeout(timeout) }
}

async function explainRoute(task, plan, places) {
  return explainEvidence(buildEvidence(task, plan, places))
}

async function generateAndStore(client, routeId, task, plan, places) {
  await client.query(`UPDATE runtime.routes SET explanation_status='generating', explanation_error=NULL WHERE route_id=$1`, [routeId])
  const result = await explainRoute(task, plan, places)
  await client.query(`UPDATE runtime.routes SET agent_explanation=$2::jsonb, explanation_status=$3, explanation_generated_at=now(), explanation_error=$4 WHERE route_id=$1`, [routeId, JSON.stringify(result), result.status, result.error || null])
  return result
}

module.exports = { explainRoute, explainEvidence, generateAndStore, buildEvidence, fallbackSummary }
