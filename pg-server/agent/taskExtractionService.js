const { ITEM_CATEGORIES, parseNaturalLanguageTask } = require('./taskParser')

function extractionConfig() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    timeoutMs: Number.parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '30000', 10),
  }
}

function exactOfficialName(value, places) {
  const requested = String(value || '').trim()
  return places.find((place) => place.name === requested)?.name || null
}

function normalizeModelTask(value, inputText, places) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DeepSeek返回格式无效')
  const category = ITEM_CATEGORIES.includes(value.item_category) ? value.item_category : '其他/无法识别'
  const weight = value.weight_kg == null ? null : Number(value.weight_kg)
  const deadline = value.deadline && !Number.isNaN(new Date(value.deadline).getTime()) ? value.deadline : null
  return {
    input_text: inputText,
    origin: exactOfficialName(value.origin, places) || String(value.origin_raw || value.origin || '').trim(),
    destination: exactOfficialName(value.destination, places) || String(value.destination_raw || value.destination || '').trim(),
    item_category: category,
    item_description: String(value.item_description || '').trim() || null,
    weight_kg: Number.isFinite(weight) && weight > 0 ? weight : null,
    deadline,
    priority: ['emergency', 'urgent', 'normal', 'low'].includes(value.priority) ? value.priority : 'normal',
    special_requirements: Array.isArray(value.special_requirements)
      ? value.special_requirements.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
      : [],
  }
}

async function extractWithDeepSeek(inputText, context, now, fetchImpl = fetch) {
  const config = extractionConfig()
  if (!config.apiKey) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const buildings = (context.places || []).map((place) => place.name)
  const prompt = [
    '你是校园运输需求结构化提取器，只返回JSON对象。',
    `当前上海时间：${now.toISOString()}。相对日期必须转换为+08:00的ISO时间。`,
    `正式建筑名列表：${JSON.stringify(buildings)}`,
    `物品分类只能是：${ITEM_CATEGORIES.join('、')}。无法分类时使用“其他/无法识别”。`,
    'origin和destination必须优先从正式建筑名列表中选择语义对应的完整名称；不确定时保留原词，不得编造。',
    'item_description保留具体物品及数量，例如“两箱玻璃瓶”；item_category只写大类。',
    '输出字段：origin_raw,destination_raw,origin,destination,item_category,item_description,weight_kg,deadline,priority,special_requirements。',
    `用户需求：${inputText}`,
  ].join('\n')
  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model, stream: false, temperature: 0, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: '严格输出合法JSON，不输出Markdown。' }, { role: 'user', content: prompt }],
      }),
    })
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`)
    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    return normalizeModelTask(JSON.parse(content), inputText, context.places || [])
  } finally {
    clearTimeout(timeout)
  }
}

async function extractTask(inputText, context = {}, now = new Date()) {
  try {
    const task = await extractWithDeepSeek(inputText, context, now)
    if (task) return { task, extraction: { provider: 'deepseek', model: extractionConfig().model, fallback_used: false } }
  } catch (error) {
    console.warn('[deepseek task extraction fallback]', error.message)
    return {
      task: parseNaturalLanguageTask(inputText, { now }),
      extraction: { provider: 'local_rules', model: null, fallback_used: true, fallback_reason: error.message },
    }
  }
  return {
    task: parseNaturalLanguageTask(inputText, { now }),
    extraction: { provider: 'local_rules', model: null, fallback_used: true, fallback_reason: 'DEEPSEEK_API_KEY未配置' },
  }
}

function getTaskExtractionStatus() {
  const config = extractionConfig()
  return { provider: 'deepseek', model: config.model, configured: Boolean(config.apiKey) }
}

module.exports = { extractTask, getTaskExtractionStatus, normalizeModelTask }
