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

const CATEGORY_RULES = Object.freeze([
  { category: '危险化学品', keywords: ['危险化学品', '危化品', '化学试剂', '易燃', '易爆', '腐蚀性'] },
  { category: '医疗样本', keywords: ['医疗样本', '血液样本', '检验样本', '病理样本', '医学样本'] },
  { category: '生物材料', keywords: ['生物材料', '菌种', '菌株', '细胞样本', '生物样本'] },
  { category: '实验材料', keywords: ['实验材料', '实验样品', '实验器材', '实验耗材', '样品'] },
  { category: '高价值设备', keywords: ['高价值设备', '精密仪器', '贵重设备', '仪器设备', '电子产品'] },
  { category: '文件图书', keywords: ['文件', '资料', '图书', '书籍', '教材', '档案'] },
  { category: '餐食饮品', keywords: ['餐食', '饮品', '食品', '盒饭', '咖啡', '水果', '外卖'] },
  { category: '日用小件', keywords: ['日用品', '生活用品', '小件', '快递', '包裹'] },
])

const REQUIREMENT_KEYWORDS = Object.freeze([
  '防震', '冷链', '保温', '防水', '防晒', '避光', '轻拿轻放', '恒温', '无菌', '防倾斜', '易碎', '防漏',
])

const REQUIRED_FIELDS = Object.freeze(['origin', 'destination', 'item_category', 'weight_kg', 'deadline'])
const pad = (value) => String(value).padStart(2, '0')

function parseChineseNumber(value) {
  if (!value) return null
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value)
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (value === '十') return 10
  if (value.includes('十')) {
    const [left, right] = value.split('十')
    return (left ? digits[left] : 1) * 10 + (right ? digits[right] : 0)
  }
  return digits[value] ?? null
}

function parseWeight(text) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(公斤|千克|kg|斤|克|g)(?![a-z])/i)
  if (!match) return null
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  if (unit === '斤') return amount * 0.5
  if (unit === '克' || unit === 'g') return amount / 1000
  return amount
}

function parseCategory(text) {
  return CATEGORY_RULES.find((rule) => rule.keywords.some((keyword) => text.includes(keyword)))?.category || null
}

function cleanPlace(value = '') {
  return value
    .replace(/^(?:请|麻烦|帮我|需要|要|把|将)\s*/, '')
    .replace(/\s*(?:送|运|配送|转运|拿|取)\s*$/, '')
    .replace(/[，。；;,.!！?？]+$/g, '')
    .trim()
}

function parsePlaces(text, placeNames = []) {
  const fromTo = text.match(/从\s*([^，。；;!?！？]+?)\s*(?:送到|送往|运到|配送到|送|运|配送|转运|拿|取)?\s*(?:到|至)\s*([^，。；;!?！？]+?)(?=\s*(?:，|。|；|;|需要|要求|并且|而且|请|$))/)
  if (fromTo) return { origin: cleanPlace(fromTo[1]), destination: cleanPlace(fromTo[2]) }

  const mentioned = placeNames
    .filter((name) => String(name).length > 1 && text.includes(name))
    .sort((a, b) => text.indexOf(a) - text.indexOf(b) || b.length - a.length)
  return {
    origin: cleanPlace(mentioned[0] || ''),
    destination: cleanPlace(mentioned.find((name) => name !== mentioned[0]) || ''),
  }
}

function parseDeadline(text, now = new Date()) {
  const result = new Date(now)
  result.setSeconds(0, 0)
  let hasExplicitDay = false
  if (text.includes('后天')) {
    result.setDate(result.getDate() + 2)
    hasExplicitDay = true
  } else if (text.includes('明天') || text.includes('明日')) {
    result.setDate(result.getDate() + 1)
    hasExplicitDay = true
  } else if (text.includes('今天') || text.includes('今日')) {
    hasExplicitDay = true
  }

  const fullDate = text.match(/(20\d{2})[年\-/](\d{1,2})[月\-/](\d{1,2})日?/)
  const shortDate = !fullDate && text.match(/(?<!\d)(\d{1,2})[月\-/](\d{1,2})日?/)
  if (fullDate) {
    result.setFullYear(Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3]))
    hasExplicitDay = true
  } else if (shortDate) {
    result.setMonth(Number(shortDate[1]) - 1, Number(shortDate[2]))
    hasExplicitDay = true
  }

  const time = text.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([零一二两三四五六七八九十\d]{1,3})(?:点|时|:|：)(?:\s*([零一二两三四五六七八九十\d]{1,2})分?)?(半)?/)
  if (!time) return null
  let hour = parseChineseNumber(time[2])
  const minute = time[4] ? 30 : parseChineseNumber(time[3]) ?? 0
  if (hour == null || hour > 23 || minute > 59) return null
  if (['下午', '傍晚', '晚上'].includes(time[1]) && hour < 12) hour += 12
  if (time[1] === '中午' && hour < 11) hour += 12
  if (time[1] === '凌晨' && hour === 12) hour = 0
  result.setHours(hour, minute, 0, 0)
  if (!hasExplicitDay && result.getTime() <= now.getTime()) result.setDate(result.getDate() + 1)
  return `${result.getFullYear()}-${pad(result.getMonth() + 1)}-${pad(result.getDate())}T${pad(result.getHours())}:${pad(result.getMinutes())}`
}

function parsePriority(text) {
  if (/(应急|立刻|立即|马上|十万火急)/.test(text)) return 'emergency'
  if (/(紧急|急件|加急|尽快|越快越好)/.test(text)) return 'urgent'
  return 'normal'
}

function parseNaturalLanguageTask(inputText, options = {}) {
  const text = String(inputText || '').replace(/\s+/g, ' ').trim()
  if (!text) throw new TypeError('input_text is required')
  const places = parsePlaces(text, options.placeNames || [])
  const task = {
    input_text: text,
    origin: places.origin,
    destination: places.destination,
    item_category: parseCategory(text),
    weight_kg: parseWeight(text),
    deadline: parseDeadline(text, options.now instanceof Date ? options.now : new Date()),
    priority: parsePriority(text),
    special_requirements: REQUIREMENT_KEYWORDS.filter((keyword) => text.includes(keyword)),
  }
  task.missing_fields = REQUIRED_FIELDS.filter((field) => task[field] == null || task[field] === '')
  return task
}

module.exports = { ITEM_CATEGORIES, REQUIRED_FIELDS, parseNaturalLanguageTask }
