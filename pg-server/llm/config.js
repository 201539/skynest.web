const { getRuntimeLlmConfig } = require('./runtimeConfig')

function parseBoolean(value, fallback) {
  if (value == null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getLlmConfig(overrides = {}) {
  const runtime = getRuntimeLlmConfig()
  const provider = String(overrides.provider || runtime.provider || process.env.LLM_PROVIDER || 'ollama').toLowerCase()
  const cloud = provider === 'dashscope'
  return {
    enabled: overrides.enabled ?? runtime.enabled ?? parseBoolean(process.env.LLM_ENABLED, false),
    provider,
    model: overrides.model || (cloud ? process.env.DASHSCOPE_MODEL || 'qwen-plus' : process.env.OLLAMA_MODEL || 'qwen3.5:4b'),
    baseUrl: String(overrides.baseUrl || (cloud
      ? process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      : process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434')).replace(/\/$/, ''),
    apiKey: cloud ? process.env.DASHSCOPE_API_KEY || '' : '',
    timeoutMs: positiveInteger(overrides.timeoutMs || process.env.LLM_TIMEOUT_MS, cloud ? 30000 : 90000),
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    fallbackEnabled: parseBoolean(process.env.LLM_FALLBACK_ENABLED, true),
  }
}

module.exports = { getLlmConfig }
