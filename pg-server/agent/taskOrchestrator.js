const { ITEM_CATEGORIES, REQUIRED_FIELDS, parseTaskMock, parseNaturalLanguageTask } = require('./taskParser')
const { matchLocation } = require('./locationMatcher')
const { recommendVehicle } = require('./vehicleRules')

const FIELD_LABELS = Object.freeze({
  origin: '起点',
  destination: '终点',
  item_category: '物品类型',
  weight_kg: '重量',
  deadline: '送达时限',
})

const FIELD_QUESTIONS = Object.freeze({
  origin: '请补充任务起点，例如“从图书馆出发”。',
  destination: '请补充任务终点，例如“送到实验中心”。',
  item_category: '请说明运输物品类型，例如文件、餐食或实验材料。',
  weight_kg: '请补充物品重量，单位为公斤。',
  deadline: '请补充期望送达时间。',
})

function normalizeStructuredTask(input = {}) {
  const rawWeight = input.weight_kg === '' || input.weight_kg == null ? null : Number(input.weight_kg)
  const deadline = input.deadline && !Number.isNaN(new Date(input.deadline).getTime()) ? input.deadline : null
  const category = ITEM_CATEGORIES.includes(input.item_category) ? input.item_category : input.item_category ? '其他/无法识别' : null
  const task = {
    input_text: String(input.input_text || '').trim(),
    origin: String(input.origin || '').trim(),
    destination: String(input.destination || '').trim(),
    item_category: category,
    weight_kg: Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : null,
    deadline,
    priority: ['emergency', 'urgent', 'high', 'normal', 'low'].includes(input.priority) ? input.priority : 'normal',
    special_requirements: Array.isArray(input.special_requirements)
      ? [...new Set(input.special_requirements.map((item) => String(item).trim()).filter(Boolean))]
      : [],
  }
  task.missing_fields = REQUIRED_FIELDS.filter((field) => task[field] == null || task[field] === '')
  return task
}

function buildClarifyingQuestions(task, originMatch, destinationMatch) {
  const questions = task.missing_fields.map((field) => FIELD_QUESTIONS[field]).filter(Boolean)
  for (const [label, value, match] of [
    ['起点', task.origin, originMatch],
    ['终点', task.destination, destinationMatch],
  ]) {
    if (!value || match.status === 'matched') continue
    const names = match.candidates.map((item) => item.name).join('、')
    questions.push(names ? `${label}“${value}”是否指${names}？` : `暂未找到${label}“${value}”，请从校园地点中重新选择。`)
  }
  return [...new Set(questions)].slice(0, 4)
}

function workflowStatus(task, originMatch, destinationMatch, vehicleResult) {
  if (task.missing_fields.length) return 'needs_clarification'
  if (originMatch.status !== 'matched' || destinationMatch.status !== 'matched') return 'needs_location_confirmation'
  if (vehicleResult.needs_manual_review) return 'needs_manual_review'
  return 'ready_for_school_review'
}

function formatDeadline(value) {
  if (!value) return '待确认时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function buildExplanation(task, vehicleResult, status) {
  if (status === 'needs_clarification') return `已识别配送需求，但还缺少${task.missing_fields.length}项必要信息。`
  if (status === 'needs_location_confirmation') return '任务字段已基本完整，但起点或终点尚未与校园地点可靠对应。'
  return `我理解这是一项从${task.origin}运送至${task.destination}的${task.item_category}任务，重量约${task.weight_kg}公斤，需在${formatDeadline(task.deadline)}前送达。${vehicleResult.reason}`
}

function buildAnalysis(task, originMatch, destinationMatch, vehicleResult, status, contextSource) {
  const recognized = REQUIRED_FIELDS.filter((field) => task[field] != null && task[field] !== '')
  let confidence = 0.28 + (recognized.length / REQUIRED_FIELDS.length) * 0.55
  confidence += originMatch.status === 'matched' ? 0.08 : 0
  confidence += destinationMatch.status === 'matched' ? 0.08 : 0
  confidence += vehicleResult.vehicle ? 0.05 : 0
  if (task.item_category === '其他/无法识别') confidence -= 0.12
  if (task.origin && task.origin === task.destination) confidence -= 0.2
  const confidenceScore = Math.round(Math.max(0.25, Math.min(0.99, confidence)) * 100)
  const confidenceLevel = confidenceScore >= 85 ? 'high' : confidenceScore >= 65 ? 'medium' : 'low'
  const reasoning = []
  if (task.origin && task.destination) reasoning.push(`识别运输路径：${task.origin} → ${task.destination}`)
  if (task.item_category) reasoning.push(`物品归类为“${task.item_category}”`)
  if (task.weight_kg != null) reasoning.push(`识别载重：${task.weight_kg} kg`)
  if (task.deadline) reasoning.push(`识别送达时限：${formatDeadline(task.deadline)}`)
  if (vehicleResult.vehicle) reasoning.push(vehicleResult.reason)
  if (vehicleResult.required_handling?.length) reasoning.push(`数据库要求：${vehicleResult.required_handling.join('、')}`)
  if (originMatch.selected_building?.nearest_departure) {
    const point = originMatch.selected_building.nearest_departure
    reasoning.push(`起点接入：${originMatch.selected_building.name} → ${point.node_code}（约${Math.round(point.distance_m)}米）`)
  }
  if (destinationMatch.selected_building?.nearest_receiving) {
    const point = destinationMatch.selected_building.nearest_receiving
    reasoning.push(`终点接入：${point.node_code} → ${destinationMatch.selected_building.name}（约${Math.round(point.distance_m)}米）`)
  }

  const manualReasons = []
  if (task.missing_fields.length) manualReasons.push(`仍需补充或核对：${task.missing_fields.map((field) => FIELD_LABELS[field]).join('、')}`)
  if (originMatch.status !== 'matched' || destinationMatch.status !== 'matched') manualReasons.push('至少一个地点尚未可靠匹配到校园地点库')
  if (vehicleResult.needs_manual_review) manualReasons.push(vehicleResult.reason)
  if (confidenceLevel === 'low') manualReasons.push('当前描述信息较少，Agent判断的可靠性偏低')

  return {
    version: 'v3-task-agent-1.0',
    source: 'v3-deterministic-agent',
    data_source: contextSource,
    confidence_score: confidenceScore,
    confidence_level: confidenceLevel,
    explanation: buildExplanation(task, vehicleResult, status),
    reasoning,
    recognized_fields: recognized.map((field) => FIELD_LABELS[field]),
    uncertain_fields: task.missing_fields.map((field) => FIELD_LABELS[field]),
    manual_review_reasons: manualReasons,
    confirmation_required: true,
    confirmation_prompt: manualReasons.length
      ? '请重点核对下列提示及表单内容，确认无误后再提交任务。'
      : '解析结果完整度较高，但仍请核对起终点、物品和时限后进行人工确认。',
    workflow_status: status,
    can_submit_to_algorithm: status === 'ready_for_school_review',
    location_matches: { origin: originMatch, destination: destinationMatch },
    access_point_plan: {
      departure: originMatch.selected_building?.nearest_departure || null,
      receiving: destinationMatch.selected_building?.nearest_receiving || null,
    },
    vehicle_recommendation: vehicleResult,
    clarifying_questions: buildClarifyingQuestions(task, originMatch, destinationMatch),
    safety_boundary: '风险、机型与运输要求由V3数据库和确定性规则决定；语言模型仅负责解释。',
    user_confirmed: false,
    confirmed_at: null,
  }
}

function enrichTask(task, context = {}) {
  const originMatch = matchLocation(task.origin, context.places || [])
  const destinationMatch = matchLocation(task.destination, context.places || [])
  const normalizedLocations = {
    ...task,
    origin: originMatch.status === 'matched' ? originMatch.selected_building.name : task.origin,
    destination: destinationMatch.status === 'matched' ? destinationMatch.selected_building.name : task.destination,
  }
  const vehicleResult = recommendVehicle(normalizedLocations, context)
  const status = workflowStatus(normalizedLocations, originMatch, destinationMatch, vehicleResult)
  const candidateNodeIds = (destinationMatch.selected_building?.receiving_nodes || [])
    .map((item) => Number(item.node_id))
    .filter((id) => Number.isInteger(id) && id > 0)
  const normalizedTask = {
    ...normalizedLocations,
    special_requirements: vehicleResult.required_handling,
    recommended_vehicle_class: vehicleResult.vehicle?.code || null,
    candidate_node_ids: [...new Set(candidateNodeIds)],
    needs_manual_review: vehicleResult.needs_manual_review || status !== 'ready_for_school_review',
    safety_level: vehicleResult.needs_manual_review ? 'high' : 'normal',
  }
  return {
    ...normalizedTask,
    agent_analysis: buildAnalysis(normalizedTask, originMatch, destinationMatch, vehicleResult, status, context.source || 'deterministic_fallback'),
  }
}

function processNaturalLanguage(inputText, context = {}, now = new Date()) {
  const task = parseNaturalLanguageTask(inputText, {
    now,
    placeNames: (context.places || []).map((place) => place.name),
  })
  return enrichTask(task, context)
}

const LEGACY_CATEGORIES = new Set([
  'experimental_material', 'document', 'book', 'medicine', 'meal',
  'medical_sample', 'biological_material', 'hazardous_chemical', 'flammable_explosive',
])

const LEGACY_REQUIREMENTS = new Set([
  'shockproof', 'cold_chain', 'temperature_controlled', 'fragile', 'waterproof',
])

function normalizeLegacyDeadline(value) {
  const text = String(value || '').trim()
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(text)) return text
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return `${text}:00+08:00`
  return null
}

function normalizeLegacyStructuredTask(input = {}) {
  const rawWeight = input.weight_kg === '' || input.weight_kg == null ? null : Number(input.weight_kg)
  const task = {
    raw_request: String(input.raw_request || '').trim(),
    origin_text: String(input.origin_text || '').trim() || null,
    destination_text: String(input.destination_text || '').trim() || null,
    origin_node_id: null,
    destination_node_id: null,
    item_category: LEGACY_CATEGORIES.has(input.item_category) ? input.item_category : null,
    weight_kg: Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : null,
    deadline: normalizeLegacyDeadline(input.deadline),
    priority: input.priority === 'high' ? 'high' : 'normal',
    special_requirements: Array.isArray(input.special_requirements)
      ? [...new Set(input.special_requirements.filter((item) => LEGACY_REQUIREMENTS.has(item)))]
      : [],
    recommended_vehicle_class: null,
    candidate_node_ids: [],
    needs_manual_review: false,
    missing_fields: [],
    parse_confidence: 1,
    parse_status: 'structured',
  }
  for (const [field, missingField] of [
    ['origin_text', 'origin'], ['destination_text', 'destination'], ['item_category', 'item_category'],
    ['weight_kg', 'weight_kg'], ['deadline', 'deadline'],
  ]) {
    if (task[field] == null) task.missing_fields.push(missingField)
  }
  if (task.missing_fields.length) {
    task.parse_status = 'needs_clarification'
    task.parse_confidence = 0
  }
  return task
}

function processLegacyTaskDraft(task, places = []) {
  const originMatch = matchLocation(task.origin_text, places)
  const destinationMatch = matchLocation(task.destination_text, places)
  const vehicleResult = recommendVehicle(task)
  const legacyNodeId = (node) => {
    if (!node) return null
    if (node.node_id != null) return node.node_id
    const index = places.indexOf(node)
    return index >= 0 ? `place:${index}` : null
  }
  task.origin_node_id = legacyNodeId(originMatch.selected_node)
  task.destination_node_id = legacyNodeId(destinationMatch.selected_node)
  task.recommended_vehicle_class = vehicleResult.vehicle?.code || null
  task.candidate_node_ids = [...originMatch.candidates, ...destinationMatch.candidates]
    .map(legacyNodeId)
    .filter(Boolean)
  task.needs_manual_review = task.needs_manual_review || vehicleResult.needs_manual_review

  const status = task.missing_fields.length
    ? 'needs_clarification'
    : originMatch.status !== 'matched' || destinationMatch.status !== 'matched'
      ? 'needs_location_confirmation'
      : task.needs_manual_review
        ? 'needs_manual_review'
        : 'ready_for_algorithm'
  const questions = task.missing_fields.map((field) => FIELD_QUESTIONS[field]).filter(Boolean)
  if (task.origin_text && originMatch.status !== 'matched') questions.push(`请确认起点“${task.origin_text}”。`)
  if (task.destination_text && destinationMatch.status !== 'matched') questions.push(`请确认终点“${task.destination_text}”。`)

  return {
    task_draft: task,
    workflow_status: status,
    can_submit_to_algorithm: status === 'ready_for_algorithm',
    location_matches: { origin: originMatch, destination: destinationMatch },
    vehicle_recommendation: vehicleResult,
    clarifying_questions: questions.slice(0, 3),
    explanation: status === 'ready_for_algorithm'
      ? `已匹配起终点并推荐${vehicleResult.vehicle?.label || '适用机型'}，任务可提交路径算法。`
      : '任务仍需补充信息、确认地点或进行人工审核。',
  }
}

function processTask(message, places, now = new Date()) {
  return processLegacyTaskDraft(parseTaskMock(message, now), places)
}

function processStructuredTask(input, context = {}) {
  if (Array.isArray(context) || input?.origin_text != null || input?.destination_text != null) {
    return processLegacyTaskDraft(normalizeLegacyStructuredTask(input), Array.isArray(context) ? context : [])
  }
  return enrichTask(normalizeStructuredTask(input), context)
}

module.exports = { normalizeStructuredTask, processTask, processNaturalLanguage, processStructuredTask }
