const placeResolver = require('../lib/placeResolver')
const { loadAgentContext } = require('./staticRepository')
const { processNaturalLanguage, processStructuredTask } = require('./taskOrchestrator')
const { explainTask, getAgentModelStatus } = require('../llm/agentExplanationService')
const { updateRuntimeLlmConfig } = require('../llm/runtimeConfig')

async function withExplanation(task) {
  const ai = await explainTask(task)
  return {
    ...task,
    agent_analysis: {
      ...task.agent_analysis,
      explanation: ai.analysis.student_message || task.agent_analysis.explanation,
      ai: {
        mode: ai.mode,
        mode_label: ai.mode_label,
        provider: ai.provider,
        model: ai.model,
        fallback_used: ai.fallback_used,
        fallback_reason: ai.fallback_reason,
        generated_at: ai.generated_at,
      },
      role_messages: ai.analysis,
    },
  }
}

async function contextFor(pool) {
  return loadAgentContext(pool, placeResolver.supportedPlaceNames())
}

async function parseInput(inputText, options = {}) {
  const context = await contextFor(options.pool)
  return withExplanation(processNaturalLanguage(inputText, context, options.now || new Date()))
}

async function verifyStructuredTask(input, options = {}) {
  const context = await contextFor(options.pool)
  const verified = await withExplanation(processStructuredTask(input, context))
  const submittedAnalysis = input.agent_analysis && typeof input.agent_analysis === 'object' ? input.agent_analysis : {}
  verified.agent_analysis.user_confirmed = Boolean(submittedAnalysis.user_confirmed)
  verified.agent_analysis.confirmed_at = verified.agent_analysis.user_confirmed ? submittedAnalysis.confirmed_at || new Date().toISOString() : null
  return verified
}

async function updateModelConfig(values = {}) {
  updateRuntimeLlmConfig(values)
  return getAgentModelStatus()
}

module.exports = { parseInput, verifyStructuredTask, getAgentModelStatus, updateModelConfig }
