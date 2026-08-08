const ITEM_CATEGORY_RULES = [
  {
    category: 'medical_sample',
    keywords: ['医疗样本', '医学样本', '血液样本', '检验样本'],
    manualReview: true,
  },
  {
    category: 'biological_material',
    keywords: ['生物材料', '生物样本', '菌株'],
    manualReview: true,
  },
  {
    category: 'hazardous_chemical',
    keywords: ['危险化学品', '危化品', '化学试剂'],
    manualReview: true,
  },
  {
    category: 'flammable_explosive',
    keywords: ['易燃易爆', '爆炸物', '燃料'],
    manualReview: true,
  },
  {
    category: 'experimental_material',
    keywords: ['实验材料', '实验物料'],
    manualReview: false,
  },
  {
    category: 'document',
    keywords: ['文件', '资料', '档案'],
    manualReview: false,
  },
  {
    category: 'book',
    keywords: ['图书', '书籍', '教材'],
    manualReview: false,
  },
  {
    category: 'medicine',
    keywords: ['药品', '药物'],
    manualReview: false,
  },
  {
    category: 'meal',
    keywords: ['餐食', '外卖', '食品', '饮品'],
    manualReview: false,
  },
]

const SPECIAL_REQUIREMENT_RULES = [
  { keyword: '防震', value: 'shockproof' },
  { keyword: '冷链', value: 'cold_chain' },
  { keyword: '恒温', value: 'temperature_controlled' },
  { keyword: '易碎', value: 'fragile' },
  { keyword: '防水', value: 'waterproof' },
]

function getShanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )

  return `${values.year}-${values.month}-${values.day}`
}

function extractDeadline(rawRequest, now = new Date()) {
  const match = rawRequest.match(
    /(上午|中午|下午|晚上)?\s*(\d{1,2})\s*(?:点|时)(?:(\d{1,2})分)?\s*(?:前|之前)?/,
  )

  if (!match) return null

  const period = match[1] || ''
  let hour = Number(match[2])
  const minute = Number(match[3] || 0)

  if ((period === '下午' || period === '晚上') && hour < 12) {
    hour += 12
  }

  if (period === '中午' && hour < 11) {
    hour += 12
  }

  if (hour > 23 || minute > 59) return null

  const date = getShanghaiDate(now)
  const hourText = String(hour).padStart(2, '0')
  const minuteText = String(minute).padStart(2, '0')

  return `${date}T${hourText}:${minuteText}:00+08:00`
}

function extractItemCategory(rawRequest) {
  for (const rule of ITEM_CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => rawRequest.includes(keyword))) {
      return rule
    }
  }

  return null
}

function extractSpecialRequirements(rawRequest) {
  return SPECIAL_REQUIREMENT_RULES
    .filter((rule) => rawRequest.includes(rule.keyword))
    .map((rule) => rule.value)
}

function parseTaskMock(rawRequest, now = new Date()) {
  if (typeof rawRequest !== 'string' || !rawRequest.trim()) {
    throw new Error('任务描述不能为空')
  }

  const text = rawRequest.trim()

  const originMatch = text.match(
    /从\s*([^，。；]+?)\s*(?:送到|送往|运到|配送到)/,
  )

  const destinationMatch = text.match(
    /(?:送到|送往|运到|配送到)\s*([^，。；]+?)(?=，|。|需要|要求|最晚|$)/,
  )

  const weightMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:公斤|千克|kg)/i,
  )

  const itemRule = extractItemCategory(text)
  const deadline = extractDeadline(text, now)

  const result = {
    raw_request: text,

    origin_text: originMatch
      ? originMatch[1].trim()
      : null,

    destination_text: destinationMatch
      ? destinationMatch[1].trim()
      : null,

    origin_node_id: null,
    destination_node_id: null,

    item_category: itemRule
      ? itemRule.category
      : null,

    weight_kg: weightMatch
      ? Number(weightMatch[1])
      : null,

    deadline,

    priority: /紧急|急件|尽快|马上|前/.test(text)
      ? 'high'
      : 'normal',

    special_requirements:
      extractSpecialRequirements(text),

    recommended_vehicle_class: null,
    candidate_node_ids: [],

    needs_manual_review:
      itemRule?.manualReview ?? true,

    missing_fields: [],

    parse_confidence: 0,
    parse_status: 'parsed',
  }

  if (!result.origin_text) {
    result.missing_fields.push('origin')
  }

  if (!result.destination_text) {
    result.missing_fields.push('destination')
  }

  if (!result.item_category) {
    result.missing_fields.push('item_category')
  }

  if (result.weight_kg == null) {
    result.missing_fields.push('weight_kg')
  }

  if (!result.deadline) {
    result.missing_fields.push('deadline')
  }

  if (result.missing_fields.length > 0) {
    result.parse_status = 'needs_clarification'
    result.parse_confidence = 0.6
  } else {
    result.parse_status = 'parsed'
    result.parse_confidence = 0.95
  }

  return result
}

module.exports = {
  parseTaskMock,
}