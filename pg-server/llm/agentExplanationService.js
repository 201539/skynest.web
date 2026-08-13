const { getLlmConfig } = require('./config')
const { buildAgentContext } = require('./agentContext')
const { buildFallbackAnalysis } = require('./fallbackRenderer')
const { generateOllamaAnalysis, getOllamaStatus } = require('./ollamaProvider')
const { generateDashScopeAnalysis, getDashScopeStatus } = require('./dashscopeProvider')
const { validateAgentOutput } = require('./outputSchema')

function fallbackResult(context, config, reason) {
  return {
    mode: 'deterministic_fallback',
    mode_label: 'V3规则说明',
    provider: config.provider,
    model: config.model,
    fallback_used: true,
    fallback_reason: reason,
    generated_at: new Date().toISOString(),
    analysis: buildFallbackAnalysis(context),
  }
}

async function explainTask(task, options = {}) {
  const config = getLlmConfig(options.config)
  const context = buildAgentContext(task)
  if (!config.enabled) return fallbackResult(context, config, 'llm_disabled')
  try {
    const generated = config.provider === 'dashscope'
      ? await generateDashScopeAnalysis(context, config)
      : await generateOllamaAnalysis(context, config)
    const model = validateAgentOutput(generated.output, context)
    const deterministic = buildFallbackAnalysis(context)
    return {
      mode: config.provider === 'dashscope' ? 'cloud_llm' : 'local_llm',
      mode_label: config.provider === 'dashscope' ? '百炼解释' : '本地模型解释',
      provider: config.provider,
      model: config.model,
      fallback_used: false,
      fallback_reason: null,
      generated_at: new Date().toISOString(),
      metrics: generated.metrics,
      analysis: {
        ...model,
        summary: deterministic.summary,
        risk_level: deterministic.risk_level,
        risk_reasons: deterministic.risk_reasons,
        vehicle_explanation: deterministic.vehicle_explanation,
        operator_requirements: deterministic.operator_requirements,
      },
    }
  } catch (error) {
    if (!config.fallbackEnabled) throw error
    console.warn(`[${config.provider} llm fallback]`, error.message)
    return fallbackResult(context, config, error.message)
  }
}

async function getAgentModelStatus(options = {}) {
  const config = getLlmConfig(options.config)
  const providerStatus = config.provider === 'dashscope' ? getDashScopeStatus(config) : await getOllamaStatus(config)
  return {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    fallback_enabled: config.fallbackEnabled,
    safety_source: 'V3数据库与确定性规则',
    explanation_only: true,
    ...providerStatus,
  }
}

module.exports = { explainTask, getAgentModelStatus }
