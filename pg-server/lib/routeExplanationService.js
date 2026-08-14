const RISK_FACTOR_LABELS = Object.freeze({
  static_environment: '静态环境风险',
  population_density: '人流密度',
  weather: '天气条件',
  weather_default_configured: '默认天气参数',
  weather_data_stale: '天气数据过期',
  weather_data_missing: '天气数据缺失',
  construction: '施工影响',
  event: '临时活动',
  data_coverage_gap: '动态数据覆盖不足',
  energy: '飞行能耗',
  no_fly_zone: '禁飞区约束',
  class_period: '上课时段',
  consumption_peak: '食堂营业高峰',
  access_closed: '场馆关闭',
})

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key)
}

function finiteNumber(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function uniqueTextList(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
}

function riskFactorLabel(value) {
  return RISK_FACTOR_LABELS[value] || value
}

function formatPercent(value) {
  const absolute = Math.abs(value)
  return Number.isInteger(absolute) ? String(absolute) : absolute.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function describeChange(subject, value, positiveWord, negativeWord) {
  if (value == null) return null
  if (Math.abs(value) < 0.005) return `${subject}基本不变`
  return `${subject}${value > 0 ? positiveWord : negativeWord}约${formatPercent(value)}%`
}

function buildConfidence(route, comparisonExpected) {
  const missingFields = []
  if (!Number.isInteger(Number(route?.id)) || Number(route.id) <= 0) missingFields.push('route_id')
  if (!String(route?.algorithm || '').trim()) missingFields.push('algorithm')
  if (!String(route?.cost_model || '').trim()) missingFields.push('cost_model')
  if (!Array.isArray(route?.waypoints) || route.waypoints.length < 2) missingFields.push('waypoints')
  if (!hasOwn(route, 'main_risk_factors') || !Array.isArray(route.main_risk_factors)) {
    missingFields.push('main_risk_factors')
  }
  if (!hasOwn(route, 'avoided_zones') || !Array.isArray(route.avoided_zones)) {
    missingFields.push('avoided_zones')
  }
  if (comparisonExpected && finiteNumber(route?.distance_change_percent) == null) {
    missingFields.push('distance_change_percent')
  }
  if (comparisonExpected && finiteNumber(route?.risk_change_percent) == null) {
    missingFields.push('risk_change_percent')
  }

  const score = Math.max(30, 96 - missingFields.length * 18)
  const level = score >= 85 ? 'high' : score >= 65 ? 'medium' : 'low'
  return {
    score,
    level,
    label: level === 'high' ? '证据完整' : level === 'medium' ? '部分证据缺失' : '证据不足',
    confirmation_required: missingFields.length > 0,
    missing_fields: missingFields,
  }
}

function explainRoute(route = {}) {
  const riskFactors = uniqueTextList(route.main_risk_factors)
  const riskFactorLabels = riskFactors.map(riskFactorLabel)
  const avoidedZones = uniqueTextList(route.avoided_zones)
  const comparisonExpected = route.route_type === 'replan'
  const distanceChange = finiteNumber(route.distance_change_percent)
  const riskChange = finiteNumber(route.risk_change_percent)
  const confidence = buildConfidence(route, comparisonExpected)
  const statements = []

  statements.push(riskFactorLabels.length
    ? `算法识别到本航线的主要风险因素包括${riskFactorLabels.join('、')}`
    : '算法结果未标记需要特别说明的主要风险因素')
  statements.push(avoidedZones.length
    ? `推荐航线已避开${avoidedZones.join('、')}`
    : '算法结果未记录明确的绕行区域')

  if (comparisonExpected) {
    const changes = [
      describeChange('新航线距离', distanceChange, '增加', '缩短'),
      describeChange('综合风险', riskChange, '上升', '下降'),
    ].filter(Boolean)
    if (changes.length) statements.push(`与上一版相比，${changes.join('，')}`)
  } else {
    statements.push('这是首版推荐航线，尚无上一版航线可比较')
  }

  if (confidence.confirmation_required) {
    statements.push('结构化算法结果存在缺项，本解释须经人工确认后使用')
  }

  return {
    version: 'route-explanation-v1',
    source: 'stored_algorithm_output',
    generated_from: 'structured_route_result',
    route_id: Number.isInteger(Number(route.id)) ? Number(route.id) : null,
    summary: `${statements.join('。')}。`,
    statements,
    evidence: {
      algorithm: String(route.algorithm || '').trim() || null,
      cost_model: String(route.cost_model || '').trim() || null,
      main_risk_factors: riskFactors,
      main_risk_factor_labels: riskFactorLabels,
      avoided_zones: avoidedZones,
      distance_change_percent: distanceChange,
      risk_change_percent: riskChange,
      comparison_available: comparisonExpected && distanceChange != null && riskChange != null,
    },
    confidence,
    guardrails: {
      route_reason_inference_used: false,
      percentages_only_from_persisted_algorithm_result: true,
    },
  }
}

module.exports = {
  explainRoute,
  riskFactorLabel,
  _private: { buildConfidence, describeChange, finiteNumber, uniqueTextList },
}
