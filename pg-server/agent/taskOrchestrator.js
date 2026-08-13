const { parseTaskMock } = require('./taskParser')
const { matchLocation } = require('./locationMatcher')
const { recommendVehicle, HIGH_RISK_CATEGORIES } = require('./vehicleRules')

const FIELD_QUESTIONS = {
  origin: '请补充任务起点，例如“从图书馆出发”。',
  destination: '请补充任务终点，例如“送到实验中心”。',
  item_category: '请说明运输物品类型，例如文件、图书或实验材料。',
  weight_kg: '请补充物品重量，单位为公斤。',
  deadline: '请补充期望送达时间。',
}

function buildClarifyingQuestions(task, originMatch, destinationMatch) {
  const questions = task.missing_fields
    .map((field) => FIELD_QUESTIONS[field])
    .filter(Boolean)

  if (task.origin_text && originMatch.status !== 'matched') {
    const names = originMatch.candidates.map((item) => item.name).join('、')
    questions.push(
      names
        ? `起点“${task.origin_text}”是否指${names}？`
        : `暂未找到起点“${task.origin_text}”，请从校园节点中重新选择。`,
    )
  }

  if (task.destination_text && destinationMatch.status !== 'matched') {
    const names = destinationMatch.candidates.map((item) => item.name).join('、')
    questions.push(
      names
        ? `终点“${task.destination_text}”是否指${names}？`
        : `暂未找到终点“${task.destination_text}”，请从校园节点中重新选择。`,
    )
  }

  return questions.slice(0, 3)
}

function determineWorkflowStatus(task, originMatch, destinationMatch, vehicleResult) {
  if (task.missing_fields.length > 0) return 'needs_clarification'

  if (originMatch.status !== 'matched' || destinationMatch.status !== 'matched') {
    return 'needs_location_confirmation'
  }

  if (task.needs_manual_review || vehicleResult.needs_manual_review) {
    return 'needs_manual_review'
  }

  return 'ready_for_algorithm'
}

function buildExplanation(task, originMatch, destinationMatch, vehicleResult, status) {
  if (status === 'needs_clarification') {
    return `已识别配送需求，但还缺少${task.missing_fields.length}项必要信息，补充后才能进入路径规划。`
  }

  if (status === 'needs_location_confirmation') {
    return '任务字段已基本完整，但起点或终点尚未与校园节点可靠对应，需要用户确认。'
  }

  if (status === 'needs_manual_review') {
    return `任务已完成结构化和节点匹配。${vehicleResult.reason}`
  }

  return `已将“${originMatch.selected_node.name}”与“${destinationMatch.selected_node.name}”匹配到校园节点；${vehicleResult.reason}任务可提交路径算法。`
}

const SUPPORTED_CATEGORIES = new Set([
  'experimental_material',
  'document',
  'book',
  'medicine',
  'meal',
  'medical_sample',
  'biological_material',
  'hazardous_chemical',
  'flammable_explosive',
])

const SUPPORTED_REQUIREMENTS = new Set([
  'shockproof',
  'cold_chain',
  'temperature_controlled',
  'fragile',
  'waterproof',
])

function normalizeDeadline(value) {
  const text = String(value || '').trim()
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(text)) {
    return text
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    return `${text}:00+08:00`
  }
  return null
}

function createStructuredTask(input = {}) {
  const itemCategory = SUPPORTED_CATEGORIES.has(input.item_category)
    ? input.item_category
    : null
  const rawWeight = input.weight_kg === '' || input.weight_kg == null
    ? null
    : Number(input.weight_kg)
  const weightKg = Number.isFinite(rawWeight) && rawWeight > 0
    ? rawWeight
    : null
  const requirements = Array.isArray(input.special_requirements)
    ? [...new Set(input.special_requirements.filter((item) => SUPPORTED_REQUIREMENTS.has(item)))]
    : []

  const task = {
    raw_request: String(input.raw_request || '').trim(),
    origin_text: String(input.origin_text || '').trim() || null,
    destination_text: String(input.destination_text || '').trim() || null,
    origin_node_id: null,
    destination_node_id: null,
    item_category: itemCategory,
    weight_kg: weightKg,
    deadline: normalizeDeadline(input.deadline),
    priority: input.priority === 'high' ? 'high' : 'normal',
    special_requirements: requirements,
    recommended_vehicle_class: null,
    candidate_node_ids: [],
    needs_manual_review: itemCategory ? HIGH_RISK_CATEGORIES.has(itemCategory) : true,
    missing_fields: [],
    parse_confidence: 1,
    parse_status: 'structured',
  }

  for (const field of ['origin_text', 'destination_text', 'item_category', 'weight_kg', 'deadline']) {
    if (task[field] == null) {
      task.missing_fields.push(field === 'origin_text' ? 'origin' : field === 'destination_text' ? 'destination' : field)
    }
  }

  if (task.missing_fields.length) {
    task.parse_status = 'needs_clarification'
    task.parse_confidence = 0
  }

  return task
}

function enrichTask(task, places) {
  const originMatch = matchLocation(task.origin_text, places)
  const destinationMatch = matchLocation(task.destination_text, places)
  const vehicleResult = recommendVehicle(task)

  task.origin_node_id = originMatch.selected_node?.node_id || null
  task.destination_node_id = destinationMatch.selected_node?.node_id || null
  task.recommended_vehicle_class = vehicleResult.vehicle?.code || null
  task.candidate_node_ids = [
    ...originMatch.candidates,
    ...destinationMatch.candidates,
  ].map((item) => item.node_id)
  task.needs_manual_review =
    task.needs_manual_review || vehicleResult.needs_manual_review

  const workflowStatus = determineWorkflowStatus(
    task,
    originMatch,
    destinationMatch,
    vehicleResult,
  )
  const clarifyingQuestions = buildClarifyingQuestions(
    task,
    originMatch,
    destinationMatch,
  )

  return {
    task_draft: task,
    workflow_status: workflowStatus,
    can_submit_to_algorithm: workflowStatus === 'ready_for_algorithm',
    location_matches: {
      origin: originMatch,
      destination: destinationMatch,
    },
    vehicle_recommendation: vehicleResult,
    clarifying_questions: clarifyingQuestions,
    explanation: buildExplanation(
      task,
      originMatch,
      destinationMatch,
      vehicleResult,
      workflowStatus,
    ),
  }
}

function processTask(message, places, now = new Date()) {
  return enrichTask(parseTaskMock(message, now), places)
}

function processStructuredTask(input, places) {
  return enrichTask(createStructuredTask(input), places)
}

module.exports = {
  processTask,
  processStructuredTask,
}
