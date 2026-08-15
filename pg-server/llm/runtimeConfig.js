const runtime = { enabled: null, provider: null }

function getRuntimeLlmConfig() {
  return { ...runtime }
}

function updateRuntimeLlmConfig(values = {}) {
  if (values.enabled != null) runtime.enabled = Boolean(values.enabled)
  if (values.provider != null) {
    const provider = String(values.provider).toLowerCase()
    if (!['ollama', 'dashscope', 'deepseek'].includes(provider)) throw new TypeError('provider must be ollama, dashscope or deepseek')
    runtime.provider = provider
  }
  return getRuntimeLlmConfig()
}

module.exports = { getRuntimeLlmConfig, updateRuntimeLlmConfig }
