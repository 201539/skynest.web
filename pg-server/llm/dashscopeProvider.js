const { createAgentPrompt } = require('./promptBuilder')

async function generateDashScopeAnalysis(context, config, fetchImpl = fetch) {
  if (!config.apiKey) throw new Error('DASHSCOPE_API_KEY未配置')
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
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '只根据给定事实生成JSON对象，安全规则优先。' },
          { role: 'user', content: createAgentPrompt(context) },
        ],
      }),
    })
    if (!response.ok) throw new Error(`DashScope HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('DashScope返回了空内容')
    return {
      output: JSON.parse(content),
      metrics: { total_duration_ms: Date.now() - startedAt, total_tokens: payload.usage?.total_tokens ?? null },
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`DashScope调用超过${config.timeoutMs}ms`)
    if (error instanceof SyntaxError) throw new Error('DashScope返回内容不是合法JSON')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function getDashScopeStatus(config) {
  return {
    reachable: null,
    model_installed: null,
    configured: Boolean(config.apiKey),
    note: config.apiKey ? '云端模型已配置；状态页不会主动发起计费推理。' : '尚未配置DASHSCOPE_API_KEY。',
  }
}

module.exports = { generateDashScopeAnalysis, getDashScopeStatus }
