const { loadAgentContext } = require('./staticRepository')
const { processNaturalLanguage, processStructuredTask } = require('./taskOrchestrator')
const { explainTask, getAgentModelStatus } = require('../llm/agentExplanationService')
const { updateRuntimeLlmConfig } = require('../llm/runtimeConfig')
const { extractTask, getTaskExtractionStatus } = require('./taskExtractionService')

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
  return loadAgentContext(pool)
}

async function parseInput(inputText, options = {}) {
  const context = await contextFor(options.pool)
  const now = options.now || new Date()
  const extracted = await extractTask(inputText, context, now)
  const result = processStructuredTask(extracted.task, context)
  result.agent_analysis.extraction = extracted.extraction
  return withExplanation(result)
}

async function verifyStructuredTask(input, options = {}) {
  const context = await contextFor(options.pool)
  const verified = await withExplanation(processStructuredTask(input, context))
  const submittedAnalysis = input.agent_analysis && typeof input.agent_analysis === 'object' ? input.agent_analysis : {}
  verified.agent_analysis.user_confirmed = Boolean(submittedAnalysis.user_confirmed)
  verified.agent_analysis.confirmed_at = verified.agent_analysis.user_confirmed ? submittedAnalysis.confirmed_at || new Date().toISOString() : null
  return verified
}

function assertLocationsMatched(task) {
  const matches = task?.agent_analysis?.location_matches || {}
  const invalid = ['origin', 'destination'].filter((field) => matches[field]?.status !== 'matched')
  if (!invalid.length) return task

  const error = new Error('起点或终点尚未匹配到正式建筑，请从83栋校园建筑中重新选择')
  error.code = 'PLACE_NOT_CONFIRMED'
  error.details = {
    fields: invalid,
    locations: Object.fromEntries(invalid.map((field) => [field, {
      input: task?.[field] || '',
      status: matches[field]?.status || 'not_found',
      candidates: (matches[field]?.candidates || []).map((item) => item.name).slice(0, 5),
    }])),
  }
  throw error
}

async function updateModelConfig(values = {}) {
  updateRuntimeLlmConfig(values)
  return getAgentModelStatus()
}

async function getCombinedAgentStatus() {
  return { ...(await getAgentModelStatus()), task_extraction: getTaskExtractionStatus() }
}

module.exports = { parseInput, verifyStructuredTask, assertLocationsMatched, getAgentModelStatus: getCombinedAgentStatus, updateModelConfig }
