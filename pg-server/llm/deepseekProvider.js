const { createAgentPrompt } = require('./promptBuilder')

async function generateDeepSeekAnalysis(context, config, fetchImpl = fetch) {
  if (!config.apiKey) throw new Error('DEEPSEEK_API_KEY未配置')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        temperature: 0.2,
        max_tokens: 1300,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: '只根据给定事实生成符合指定结构的JSON对象，安全规则优先。' },
          { role: 'user', content: createAgentPrompt(context) },
        ],
      }),
    })
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('DeepSeek返回了空内容')
    return {
      output: JSON.parse(content),
      metrics: {
        total_duration_ms: Date.now() - startedAt,
        prompt_tokens: payload.usage?.prompt_tokens ?? null,
        output_tokens: payload.usage?.completion_tokens ?? null,
        total_tokens: payload.usage?.total_tokens ?? null,
      },
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`DeepSeek调用超过${config.timeoutMs}ms`)
    if (error instanceof SyntaxError) throw new Error('DeepSeek返回内容不是合法JSON')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function getDeepSeekStatus(config) {
  return {
    reachable: null,
    model_installed: null,
    configured: Boolean(config.apiKey),
    note: config.apiKey ? 'DeepSeek API已配置；状态页不会主动发起计费推理。' : '尚未配置DEEPSEEK_API_KEY。',
  }
}

module.exports = { generateDeepSeekAnalysis, getDeepSeekStatus }
