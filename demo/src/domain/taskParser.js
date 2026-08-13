import { createTransportTask, validateTransportTask } from './contracts.js'

export const TASK_ITEM_CATEGORIES = Object.freeze([
  '餐食饮品',
  '文件图书',
  '日用小件',
  '实验材料',
  '医疗样本',
  '生物材料',
  '危险化学品',
  '高价值设备',
  '其他/无法识别',
])

export const HIGH_RISK_CATEGORIES = Object.freeze(new Set([
  '实验材料',
  '医疗样本',
  '生物材料',
  '危险化学品',
  '高价值设备',
  '其他/无法识别',
]))

const CATEGORY_RULES = Object.freeze([
  { category: '危险化学品', keywords: ['危险化学品', '危化品', '化学试剂', '易燃', '易爆', '腐蚀性'] },
  { category: '医疗样本', keywords: ['医疗样本', '血液样本', '检验样本', '病理样本', '医学样本'] },
  { category: '生物材料', keywords: ['生物材料', '菌种', '细胞样本', '生物样本'] },
  { category: '实验材料', keywords: ['实验材料', '实验样品', '实验器材', '实验耗材', '样品'] },
  { category: '高价值设备', keywords: ['高价值设备', '精密仪器', '贵重设备', '仪器设备'] },
  { category: '文件图书', keywords: ['文件', '资料', '图书', '书籍', '档案'] },
  { category: '餐食饮品', keywords: ['餐食', '饮品', '食品', '盒饭', '咖啡', '水果', '外卖'] },
  { category: '日用小件', keywords: ['日用品', '生活用品', '小件', '快递', '包裹'] },
])

const REQUIREMENT_KEYWORDS = Object.freeze([
  '防震', '冷链', '保温', '防水', '防晒', '避光', '轻拿轻放', '恒温', '无菌', '防倾斜', '易碎',
])

const KNOWN_PLACES = Object.freeze([
  '学生公寓区 A', '学生公寓区 B', '方肇周体育馆', '二期实验楼', '环境学院', '实验中心',
  '敬文学院', '北门广场', '南门入口', '理科楼群', '文科楼群', '行政楼', '图书馆', '食堂',
])

const pad = (value) => String(value).padStart(2, '0')

function toLocalDateTimeValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseChineseNumber(value) {
  if (!value) return null
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value)

  const digitMap = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (value === '十') return 10
  if (value.includes('十')) {
    const [left, right] = value.split('十')
    return (left ? digitMap[left] : 1) * 10 + (right ? digitMap[right] : 0)
  }
  return digitMap[value] ?? null
}

function parseWeight(text) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(公斤|千克|kg|KG|斤|克|g)(?![a-z])/)
  if (!match) return null

  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  if (unit === '斤') return amount * 0.5
  if (unit === '克' || unit === 'g') return amount / 1000
  return amount
}

function parseCategory(text) {
  return CATEGORY_RULES.find((rule) => rule.keywords.some((keyword) => text.includes(keyword)))?.category || ''
}

function cleanPlace(value = '') {
  return value
    .replace(/^(?:请|麻烦|帮我|需要|要|把|将)\s*/, '')
    .replace(/\s*(?:送|运|配送|转运|拿|取)\s*$/, '')
    .replace(/[，。；;,.!！?？]+$/g, '')
    .trim()
}

function parsePlaces(text) {
  const fromTo = text.match(/从\s*([^，。；;!?！？]+?)\s*(?:送|运|配送|转运|拿|取)?\s*到\s*([^，。；;!?！？]+?)(?=\s*(?:，|。|；|;|需要|要求|并且|而且|请|$))/)
  if (fromTo) {
    return { origin: cleanPlace(fromTo[1]), destination: cleanPlace(fromTo[2]) }
  }

  const originMatch = text.match(/从\s*([^，。；;!?！？]+?)(?=\s*(?:出发|送|运|配送|转运|拿|取|到|前往))/)
  const destinationMatch = text.match(/(?:送|运|配送|转运|拿|取)?\s*到\s*([^，。；;!?！？]+?)(?=\s*(?:，|。|；|;|需要|要求|并且|而且|请|$))/)
  const mentionedPlaces = KNOWN_PLACES.filter((place) => text.includes(place))
  const hasPlacePair = mentionedPlaces.length >= 2

  return {
    origin: cleanPlace(originMatch?.[1] || (hasPlacePair ? mentionedPlaces[0] : '')),
    destination: cleanPlace(destinationMatch?.[1] || (hasPlacePair ? mentionedPlaces[1] : '')),
  }
}

function parseTime(text, now) {
  const result = new Date(now)
  result.setSeconds(0, 0)

  let hasExplicitDay = false
  let dayOffset = 0
  if (text.includes('后天')) {
    dayOffset = 2
    hasExplicitDay = true
  } else if (text.includes('明天') || text.includes('明日')) {
    dayOffset = 1
    hasExplicitDay = true
  } else if (text.includes('今天') || text.includes('今日')) {
    hasExplicitDay = true
  }

  const fullDateMatch = text.match(/(20\d{2})[年\-/](\d{1,2})[月\-/](\d{1,2})日?/)
  const shortDateMatch = !fullDateMatch && text.match(/(?<!\d)(\d{1,2})[月\-/](\d{1,2})日?/)
  if (fullDateMatch) {
    result.setFullYear(Number(fullDateMatch[1]), Number(fullDateMatch[2]) - 1, Number(fullDateMatch[3]))
    hasExplicitDay = true
  } else if (shortDateMatch) {
    result.setMonth(Number(shortDateMatch[1]) - 1, Number(shortDateMatch[2]))
    hasExplicitDay = true
  } else if (dayOffset) {
    result.setDate(result.getDate() + dayOffset)
  }

  const periodMatch = text.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([零一二两三四五六七八九十\d]{1,3})(?:点|时|:|：)(?:\s*([零一二两三四五六七八九十\d]{1,2})分?)?(半)?/)
  if (!periodMatch) return null

  let hour = parseChineseNumber(periodMatch[2])
  let minute = periodMatch[4] ? 30 : parseChineseNumber(periodMatch[3]) ?? 0
  if (hour === null || hour > 23 || minute > 59) return null

  const period = periodMatch[1] || ''
  if (['下午', '傍晚', '晚上'].includes(period) && hour < 12) hour += 12
  if (period === '中午' && hour < 11) hour += 12
  if (period === '凌晨' && hour === 12) hour = 0
  result.setHours(hour, minute, 0, 0)

  if (!hasExplicitDay && result.getTime() <= now.getTime()) result.setDate(result.getDate() + 1)
  return toLocalDateTimeValue(result)
}

function parsePriority(text) {
  if (/(应急|立刻|立即|马上|十万火急)/.test(text)) return 'emergency'
  if (/(紧急|加急|尽快|越快越好)/.test(text)) return 'urgent'
  return 'normal'
}

function parseRequirements(text) {
  return REQUIREMENT_KEYWORDS.filter((keyword) => text.includes(keyword))
}

const AGENT_FIELD_LABELS = Object.freeze({
  origin: '起点',
  destination: '终点',
  item_category: '物品类型',
  weight_kg: '重量',
  deadline: '送达时限',
})

function formatAgentDeadline(value) {
  if (!value) return '尚未明确的时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function buildAgentAnalysis(task, text) {
  const requiredFields = Object.keys(AGENT_FIELD_LABELS)
  const recognizedFields = requiredFields.filter((field) => {
    const value = task[field]
    return value !== null && value !== undefined && value !== ''
  })
  const uncertainFields = task.missing_fields.map((field) => AGENT_FIELD_LABELS[field] || field)

  let confidence = 0.28 + (recognizedFields.length / requiredFields.length) * 0.67
  if (task.item_category === '其他/无法识别') confidence -= 0.12
  if (task.origin && task.destination && task.origin === task.destination) confidence -= 0.18
  if (text.length < 12) confidence -= 0.08
  confidence = Math.max(0.32, Math.min(0.98, confidence))
  const confidenceScore = Math.round(confidence * 100)
  const confidenceLevel = confidenceScore >= 85 ? 'high' : confidenceScore >= 65 ? 'medium' : 'low'

  const explanationParts = [
    `我理解这是一项从${task.origin || '待确认起点'}运送至${task.destination || '待确认终点'}的${task.item_category || '待确认物品'}运输任务`,
  ]
  if (task.weight_kg !== null) explanationParts.push(`货物重量约${task.weight_kg}公斤`)
  if (task.deadline) explanationParts.push(`需要在${formatAgentDeadline(task.deadline)}前送达`)
  if (task.special_requirements.length) explanationParts.push(`运输时需满足${task.special_requirements.join('、')}`)
  if (task.priority !== 'normal') explanationParts.push(`系统将其识别为${task.priority === 'emergency' ? '应急' : '紧急'}任务`)

  const reasoning = []
  if (task.origin && task.destination) reasoning.push(`识别运输路径：${task.origin} → ${task.destination}`)
  if (task.item_category) reasoning.push(`根据物品关键词归类为“${task.item_category}”`)
  if (task.weight_kg !== null) reasoning.push(`识别载重：${task.weight_kg} kg`)
  if (task.deadline) reasoning.push(`识别送达时限：${formatAgentDeadline(task.deadline)}`)
  if (task.special_requirements.length) reasoning.push(`识别特殊要求：${task.special_requirements.join('、')}`)

  const manualReviewReasons = []
  if (uncertainFields.length) manualReviewReasons.push(`仍需补充或核对：${uncertainFields.join('、')}`)
  if (task.needs_manual_review) manualReviewReasons.push('物品类别涉及安全风险，提交后仍需校方人工审核')
  if (confidenceLevel === 'low') manualReviewReasons.push('当前描述信息较少，Agent判断的可靠性偏低')

  return {
    source: 'rule-based-demo-v1',
    confidence_score: confidenceScore,
    confidence_level: confidenceLevel,
    explanation: `${explanationParts.join('，')}。`,
    reasoning,
    recognized_fields: recognizedFields.map((field) => AGENT_FIELD_LABELS[field]),
    uncertain_fields: uncertainFields,
    manual_review_reasons: manualReviewReasons,
    confirmation_required: true,
    confirmation_prompt: manualReviewReasons.length
      ? '请重点核对下列提示及表单内容，确认无误后再提交任务。'
      : '解析结果完整度较高，但仍请核对起终点、物品和时限后进行人工确认。',
    user_confirmed: false,
    confirmed_at: null,
  }
}

export function parseNaturalLanguageTask(inputText = '', options = {}) {
  const text = String(inputText).replace(/\s+/g, ' ').trim()
  const now = options.now instanceof Date ? new Date(options.now) : new Date()
  const { origin, destination } = parsePlaces(text)
  const itemCategory = parseCategory(text)
  const weight = parseWeight(text)
  const deadline = parseTime(text, now)
  const requirements = parseRequirements(text)
  const highRisk = HIGH_RISK_CATEGORIES.has(itemCategory)

  const task = createTransportTask({
    input_text: text,
    origin,
    destination,
    item_category: itemCategory,
    weight_kg: weight,
    deadline,
    priority: parsePriority(text),
    safety_level: highRisk ? 'high' : 'normal',
    special_requirements: requirements,
    recommended_vehicle_class: weight === null ? null : weight <= 5 ? 'light-cargo' : weight <= 20 ? 'medium-cargo' : 'heavy-cargo',
    needs_manual_review: highRisk,
  })

  const validation = validateTransportTask(task)
  task.missing_fields = validation.missing_fields
  task.agent_analysis = buildAgentAnalysis(task, text)
  return task
}
