<template>
  <section v-if="analysis" class="task-agent-card">
    <div class="task-agent-heading">
      <div>
        <span>V3 TASK AGENT</span>
        <strong>{{ title }}</strong>
      </div>
      <b>{{ modeLabel }}</b>
    </div>
    <p>{{ audienceMessage }}</p>
    <div v-if="advice" class="task-agent-advice">
      <span>{{ adviceLabel }}</span>
      <strong>{{ advice }}</strong>
    </div>
    <ul v-if="requirements.length">
      <li v-for="item in requirements" :key="item">{{ item }}</li>
    </ul>
    <small>{{ analysis.safety_boundary || '安全关键结果由V3确定性规则决定。' }}</small>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  analysis: { type: Object, default: null },
  audience: { type: String, default: 'school' },
  taskStatus: { type: String, default: '' },
})

const messages = computed(() => props.analysis?.role_messages || {})
const title = computed(() => ({ student: '任务预审说明', school: '任务审核辅助', operator: '执行要求摘要' }[props.audience] || '任务Agent分析'))
const modeLabel = computed(() => props.analysis?.ai?.mode_label || 'V3规则说明')
const audienceMessage = computed(() => {
  if (props.audience === 'student') return messages.value.student_message || props.analysis?.explanation
  return messages.value.summary || props.analysis?.explanation
})
const advice = computed(() => {
  if (props.audience === 'school') return messages.value.school_advice
  if (props.audience !== 'operator') return ''
  if (['approved', 'dispatched', 'in_transit', 'arriving', 'delivered'].includes(props.taskStatus)) {
    return '校方审核已完成，请按批准航线、指定机型和下列运输要求执行。'
  }
  return messages.value.planning_advice
})
const adviceLabel = computed(() => props.audience === 'school' ? '校方核验建议' : '执行前提示')
const requirements = computed(() => props.audience === 'operator' ? messages.value.operator_requirements || [] : props.analysis?.manual_review_reasons || [])
</script>

<style scoped>
.task-agent-card { margin-top: 9px; padding: 10px; background: rgba(30, 76, 105, 0.18); border: 1px solid rgba(79, 195, 247, 0.2); border-radius: 8px; }
.task-agent-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.task-agent-heading > div { display: flex; flex-direction: column; gap: 2px; }
.task-agent-heading span { color: #4fc3f7; font-size: 8px; letter-spacing: 0.1em; }
.task-agent-heading strong { color: #e7f2fb; font-size: 11px; }
.task-agent-heading b { padding: 3px 6px; color: #b3e5fc; background: rgba(3, 169, 244, 0.12); border-radius: 999px; font-size: 8px; }
.task-agent-card > p { margin: 7px 0; color: #b0bec5; font-size: 9px; line-height: 1.5; }
.task-agent-advice { display: flex; flex-direction: column; gap: 3px; padding: 7px; background: rgba(4, 13, 27, 0.38); border-radius: 6px; }
.task-agent-advice span { color: #78909c; font-size: 8px; }
.task-agent-advice strong { color: #d9e7f3; font-size: 9px; line-height: 1.45; }
.task-agent-card ul { margin: 7px 0 0; padding-left: 16px; color: #ffccbc; font-size: 9px; line-height: 1.5; }
.task-agent-card small { display: block; margin-top: 7px; color: #607d8b; font-size: 8px; line-height: 1.4; }
</style>
