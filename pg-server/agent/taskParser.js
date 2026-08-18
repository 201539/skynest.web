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
  {
    category: 'daily_item',
    keywords: ['日用小件', '日用品', '生活用品', '小件'],
    manualReview: false,
  },
  {
    category: 'valuable_equipment',
    keywords: ['高价值设备', '贵重设备', '精密仪器', '电子设备'],
    manualReview: true,
  },
]

const ITEM_CATEGORIES = Object.freeze([
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

const REQUIRED_FIELDS = Object.freeze(['origin', 'destination', 'item_category', 'item_description', 'weight_kg', 'deadline'])

const CATEGORY_TO_V3 = Object.freeze({
  experimental_material: '实验材料',
  document: '文件图书',
  book: '文件图书',
  medicine: '医疗样本',
  meal: '餐食饮品',
  medical_sample: '医疗样本',
  biological_material: '生物材料',
  hazardous_chemical: '危险化学品',
  flammable_explosive: '危险化学品',
  daily_item: '日用小件',
  valuable_equipment: '高价值设备',
})

const REQUIREMENT_TO_V3 = Object.freeze({
  shockproof: '防震',
  cold_chain: '冷链',
  temperature_controlled: '恒温',
  fragile: '易碎',
  waterproof: '防水',
})

const SPECIAL_REQUIREMENT_RULES = [
  { keyword: '防震', value: 'shockproof' },
  { keyword: '冷链', value: 'cold_chain' },
  { keyword: '恒温', value: 'temperature_controlled' },
  { keyword: '易碎', value: 'fragile' },
  { keyword: '防水', value: 'waterproof' },
]

function getShanghaiDate(now = new Date(), dayOffset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )

  const shifted = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + dayOffset))
  return [shifted.getUTCFullYear(), String(shifted.getUTCMonth() + 1).padStart(2, '0'), String(shifted.getUTCDate()).padStart(2, '0')].join('-')
}

function chineseNumberToInteger(value) {
  if (/^\d+$/.test(value)) return Number(value)
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (value === '十') return 10
  if (value.includes('十')) {
    const [tens, units] = value.split('十')
    return (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0)
  }
  return digits[value]
}

function extractDeadline(rawRequest, now = new Date()) {
  const match = rawRequest.match(
    /(今天|今日|明天|明日|后天)?\s*(上午|中午|下午|晚上|今晚|凌晨)?\s*([零〇一二两三四五六七八九十\d]{1,3})(?:\s*[:：]\s*([零〇一二两三四五六七八九十\d]{1,3})|\s*(?:点|时)(?:(半)|([零〇一二两三四五六七八九十\d]{1,3})分?)?)\s*(?:前|之前)?/,
  )

  if (!match) return null

  const dayText = match[1] || ''
  const period = match[2] || ''
  let hour = chineseNumberToInteger(match[3])
  const minute = match[5] ? 30 : match[4] || match[6] ? chineseNumberToInteger(match[4] || match[6]) : 0

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null

  if ((period === '下午' || period === '晚上' || period === '今晚') && hour < 12) {
    hour += 12
  }

  if (period === '中午' && hour < 11) {
    hour += 12
  }

  if (period === '凌晨' && hour === 12) hour = 0

  if (hour > 23 || minute > 59) return null

  const dayOffset = /明天|明日/.test(dayText) ? 1 : dayText === '后天' ? 2 : 0
  const date = getShanghaiDate(now, dayOffset)
  const hourText = String(hour).padStart(2, '0')
  const minuteText = String(minute).padStart(2, '0')

  return `${date}T${hourText}:${minuteText}:00+08:00`
}

function extractItemDescription(rawRequest, itemRule) {
  const quantityItem = rawRequest.match(/从\s*[^，。；]+?\s*(?:配送|转运|送|运|带)\s*([^，。；]+?)\s*到/)
    || rawRequest.match(/(?:配送|转运|送|运|带)\s*([^，。；]+?)\s*到/)
  if (quantityItem?.[1]) return quantityItem[1].trim()
  const keyword = itemRule?.keywords.find((item) => rawRequest.includes(item))
  return keyword || null
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
    .filter((rule) => {
      const index = rawRequest.indexOf(rule.keyword)
      if (index < 0) return false
      return !/(?:不|无须|无需|不用|免)[^，。；]{0,3}$/.test(rawRequest.slice(Math.max(0, index - 6), index))
    })
    .map((rule) => rule.value)
}

function extractRoute(rawRequest, placeNames = []) {
  const patterns = [
    /从\s*([^，。；]+?)\s*(?:送到|送往|运到|配送到|送去|运往|到)\s*([^，。；]+?)(?=，|。|；|需要|要求|最晚|送\s*\d|$)/,
    /(?:把|将)\s*[^，。；]+?\s*从\s*([^，。；]+?)\s*(?:送到|送往|运到|配送到|送去|运往)\s*([^，。；]+?)(?=，|。|；|需要|要求|最晚|送\s*\d|$)/,
  ]
  for (const pattern of patterns) {
    const match = rawRequest.match(pattern)
    if (match) return { origin: match[1].trim(), destination: match[2].trim() }
  }

  const originMatch = rawRequest.match(/从\s*([^，。；]+?)\s*(?=送|运|配送|转运|拿|取)/)
  const destinationMatch = rawRequest.match(/(?:送到|送往|运到|配送到|送去|运往|到)\s*([^，。；]+?)(?=，|。|；|需要|要求|最晚|今天|明天|明日|后天|$)/)
  if (originMatch && destinationMatch) {
    return { origin: originMatch[1].trim(), destination: destinationMatch[1].trim() }
  }

  const mentioned = [...new Set(placeNames)]
    .filter((name) => name && rawRequest.includes(name))
    .map((name) => ({ name, index: rawRequest.indexOf(name) }))
    .sort((left, right) => left.index - right.index || right.name.length - left.name.length)
  if (mentioned.length >= 2) return { origin: mentioned[0].name, destination: mentioned[1].name }
  return { origin: null, destination: null }
}

function extractWeightKg(rawRequest) {
  const match = rawRequest.match(/(\d+(?:\.\d+)?)\s*(公斤|千克|kg|克|g|斤)/i)
  if (!match) return null
  const value = Number(match[1])
  const unit = match[2].toLowerCase()
  if (unit === '克' || unit === 'g') return value / 1000
  if (unit === '斤') return value * 0.5
  return value
}

function parseTaskMock(rawRequest, now = new Date(), options = {}) {
  if (typeof rawRequest !== 'string' || !rawRequest.trim()) {
    throw new Error('任务描述不能为空')
  }

  const text = rawRequest.trim()

  const route = extractRoute(text, options.placeNames || [])
  const weightKg = extractWeightKg(text)

  const preliminaryDescription = extractItemDescription(text, null)
  const itemRule = extractItemCategory(preliminaryDescription || text)
  const itemDescription = preliminaryDescription || extractItemDescription(text, itemRule)
  const deadline = extractDeadline(text, now)

  const result = {
    raw_request: text,

    origin_text: route.origin,

    item_description: itemDescription,

    destination_text: route.destination,

    origin_node_id: null,
    destination_node_id: null,

    item_category: itemRule
      ? itemRule.category
      : 'other',

    weight_kg: weightKg,

    deadline,

    priority: /紧急|急件|尽快|马上/.test(text)
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

  if (!result.item_description) result.missing_fields.push('item_description')

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

function parseNaturalLanguageTask(inputText, options = {}) {
  const parsed = parseTaskMock(inputText, options.now instanceof Date ? options.now : new Date(), options)
  const task = {
    input_text: parsed.raw_request,
    origin: parsed.origin_text || '',
    destination: parsed.destination_text || '',
    item_category: parsed.item_category ? CATEGORY_TO_V3[parsed.item_category] || '其他/无法识别' : null,
    item_description: parsed.item_description,
    weight_kg: parsed.weight_kg,
    deadline: parsed.deadline,
    priority: parsed.priority === 'high' ? 'urgent' : 'normal',
    special_requirements: parsed.special_requirements.map((item) => REQUIREMENT_TO_V3[item] || item),
  }
  task.missing_fields = REQUIRED_FIELDS.filter((field) => task[field] == null || task[field] === '')
  return task
}

module.exports = {
  ITEM_CATEGORIES,
  REQUIRED_FIELDS,
  CATEGORY_TO_V3,
  parseTaskMock,
  parseNaturalLanguageTask,
}
