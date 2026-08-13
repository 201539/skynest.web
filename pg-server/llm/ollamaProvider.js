const { AGENT_OUTPUT_SCHEMA } = require('./outputSchema')
const { createAgentPrompt } = require('./promptBuilder')

async function generateOllamaAnalysis(context, config, fetchImpl = fetch) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetchImpl(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        think: false,
        keep_alive: config.keepAlive,
        format: AGENT_OUTPUT_SCHEMA,
        options: { temperature: 0.2, num_ctx: 8192, num_predict: 700 },
        messages: [
          { role: 'system', content: '只根据给定事实生成符合Schema的JSON对象，安全规则优先。' },
          { role: 'user', content: createAgentPrompt(context) },
        ],
      }),
    })
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
    const payload = await response.json()
    const content = payload?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('Ollama返回了空内容')
    return {
      output: JSON.parse(content),
      metrics: {
        total_duration_ms: payload.total_duration ? Math.round(payload.total_duration / 1e6) : null,
        prompt_tokens: payload.prompt_eval_count ?? null,
        output_tokens: payload.eval_count ?? null,
      },
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Ollama调用超过${config.timeoutMs}ms`)
    if (error instanceof SyntaxError) throw new Error('Ollama返回内容不是合法JSON')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function getOllamaStatus(config) {
  if (!config.enabled) return { reachable: null, model_installed: null, models: [], note: '模型解释已关闭，当前使用确定性说明。' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 3000))
  try {
    const response = await fetch(`${config.baseUrl}/api/tags`, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    const models = (payload.models || []).map((item) => item.name)
    return { reachable: true, model_installed: models.some((name) => name === config.model || name.startsWith(`${config.model}:`)), models }
  } catch (error) {
    return { reachable: false, model_installed: false, models: [], error: error.message }
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = { generateOllamaAnalysis, getOllamaStatus }
