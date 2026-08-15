<template>
  <section v-if="explanation" class="route-explanation" :class="confidenceClass">
    <div class="explanation-heading">
      <div>
        <span class="assistant-mark" aria-hidden="true">AI</span>
        <strong>算法航线解释</strong>
      </div>
      <i>确定性解释已生成</i>
    </div>

    <p>{{ explanation.summary }}</p>

    <div class="explanation-meta">
      <span>{{ confidenceLabel }} · {{ explanation.confidence?.score ?? '—' }}%</span>
      <span>{{ sourceLabel }}</span>
    </div>

    <div v-if="explanation.confidence?.confirmation_required" class="confirmation-notice" role="status">
      <strong>需要人工确认</strong>
      <span>算法结果缺少：{{ missingFieldsLabel }}</span>
    </div>

    <small>解释仅引用已保存的风险因素、绕行区域和算法计算结果，不推测未提供的路线原因。</small>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  explanation: {
    type: Object,
    default: null,
  },
})

const fieldLabels = Object.freeze({
  route_id: '航线编号',
  algorithm: '算法名称',
  cost_model: 'Cost 模型',
  waypoints: '航点链',
  main_risk_factors: '主要风险因素',
  avoided_zones: '绕行区域',
  distance_change_percent: '航程变化百分比',
  risk_change_percent: '风险变化百分比',
})

const confidenceLabel = computed(() => props.explanation?.confidence?.label || '证据状态未知')
const confidenceClass = computed(() => `confidence-${props.explanation?.confidence?.level || 'unknown'}`)
const sourceLabel = computed(() => {
  const evidence = props.explanation?.evidence || {}
  return [evidence.algorithm, evidence.cost_model].filter(Boolean).join(' · ') || '结构化航线结果'
})
const missingFieldsLabel = computed(() => {
  const fields = props.explanation?.confidence?.missing_fields || []
  return fields.map((field) => fieldLabels[field] || field).join('、') || '关键证据'
})
</script>

<style scoped>
.route-explanation {
  margin-top: 8px;
  padding: 9px;
  background: linear-gradient(145deg, rgba(3, 169, 244, 0.08), rgba(4, 13, 27, 0.58));
  border: 1px solid rgba(79, 195, 247, 0.22);
  border-radius: 7px;
}

.route-explanation.confidence-medium { border-color: rgba(255, 183, 77, 0.3); }
.route-explanation.confidence-low { border-color: rgba(255, 138, 128, 0.38); }

.explanation-heading,
.explanation-heading > div,
.explanation-meta {
  display: flex;
  align-items: center;
}

.explanation-heading { justify-content: space-between; gap: 7px; }
.explanation-heading > div { min-width: 0; gap: 6px; }
.explanation-heading strong { color: #dff7ff; font-size: 10px; }
.explanation-heading i {
  flex: 0 0 auto;
  padding: 2px 5px;
  color: #80deea;
  background: rgba(38, 198, 218, 0.1);
  border-radius: 999px;
  font-size: 8px;
  font-style: normal;
}

.assistant-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 16px;
  color: #03191f;
  background: linear-gradient(135deg, #80deea, #4fc3f7);
  border-radius: 4px;
  font-size: 7px;
  font-weight: 800;
}

.route-explanation > p { margin: 7px 0 0; color: #c7d8e7; font-size: 9px; line-height: 1.55; }
.explanation-meta { flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.explanation-meta span { padding: 2px 5px; color: #8fc5d8; background: rgba(3, 169, 244, 0.08); border-radius: 4px; font-size: 8px; }

.confirmation-notice { display: flex; flex-direction: column; gap: 2px; margin-top: 7px; padding: 6px 7px; color: #ffccbc; background: rgba(255, 112, 67, 0.08); border-radius: 5px; font-size: 8px; }
.confirmation-notice span { color: #bcaaa4; }
.route-explanation > small { display: block; margin-top: 6px; color: #607d8b; font-size: 7px; line-height: 1.45; }
</style>
