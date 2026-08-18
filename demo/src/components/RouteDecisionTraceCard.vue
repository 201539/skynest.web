<template>
  <details class="decision-card" open>
    <summary>
      <span>
        <small>ROUTE DECISION TRACE</small>
        <strong>航线选择依据</strong>
      </span>
      <b>{{ modeLabel }}</b>
    </summary>

    <div class="decision-body">
      <p :class="['decision-reason', { legacy: !trace }]">{{ selectionReason }}</p>

      <div class="decision-metrics">
        <div><span>累计 Cost</span><strong>{{ formatNumber(totalCost) }}</strong></div>
        <div><span>基础距离 Cost</span><strong>{{ formatNumber(pathCost?.base_distance_cost) }}</strong></div>
        <div><span>风险 Cost</span><strong>{{ formatNumber(pathCost?.risk_cost) }}</strong></div>
        <div><span>机动 Cost</span><strong>{{ formatNumber(pathCost?.maneuver_cost) }}</strong></div>
        <div><span>数据覆盖</span><strong>{{ coverageText }}</strong></div>
        <div><span>硬约束格网</span><strong>{{ blockedCellsText }}</strong></div>
      </div>

      <div v-if="formula" class="formula-row">
        <span>计算公式</span>
        <code>{{ formula }}</code>
      </div>

      <div v-if="pathCost?.maneuver" class="maneuver-row">
        <span>转弯 <strong>{{ pathCost.maneuver.turn_count ?? 0 }}</strong> 次</span>
        <span>累计角度 <strong>{{ formatNumber(pathCost.maneuver.total_turn_angle_degrees, 0) }}°</strong></span>
        <span>机动权重 <strong>{{ formatNumber(pathCost.maneuver.weight, 2) }}</strong></span>
        <span>爬升/下降 <strong>0 / 0 m</strong></span>
      </div>

      <div class="cost-section-heading">
        <span>当前权重与风险 Cost 贡献</span>
        <small>贡献越大，对本次选线影响越明显</small>
      </div>
      <div class="component-list">
        <div v-for="component in componentRows" :key="component.key" class="component-row">
          <div class="component-heading">
            <span>{{ component.label }}</span>
            <small>权重 {{ formatPercent(component.weight) }}</small>
            <strong>{{ component.cost == null ? '待重新规划' : `+${formatNumber(component.cost)}` }}</strong>
          </div>
          <div class="component-track" aria-hidden="true">
            <i :style="{ width: `${component.barPercent}%` }"></i>
          </div>
        </div>
      </div>

      <div v-if="layerRows.length" class="layer-row">
        <span v-for="layer in layerRows" :key="layer.key">
          {{ layer.label }} <strong>{{ formatNumber(layer.cost) }}</strong>
        </span>
      </div>

      <div class="decision-footer">
        <span>策略：{{ profileLabel }}</span>
        <span v-if="isNumberAvailable(riskScale)">风险放大：×{{ formatNumber(riskScale, 2) }}</span>
        <span v-if="sampledAt">采样：{{ formatSampledAt(sampledAt, timeZone) }}</span>
      </div>
    </div>
  </details>
</template>

<script setup>
import { computed } from 'vue'
import { formatCompactNumber as formatNumber } from '../utils/numberFormat'

const props = defineProps({
  route: { type: Object, required: true },
})

const COMPONENTS = Object.freeze([
  { key: 'static', label: '静态环境' },
  { key: 'population', label: '周期人流' },
  { key: 'weather', label: '天气' },
  { key: 'runtime', label: '实时事件' },
  { key: 'energy', label: '能耗' },
])

const costBreakdown = computed(() => props.route?.cost_breakdown || {})
const trace = computed(() => (
  props.route?.decisionTrace
  || props.route?.decision_trace
  || props.route?.route?.decisionTrace
  || costBreakdown.value?.decision_trace
  || null
))
const pathCost = computed(() => (
  trace.value?.path_cost
  || costBreakdown.value?.path
  || props.route?.dynamicCost?.pathBreakdown
  || null
))
const model = computed(() => (
  trace.value?.model
  || costBreakdown.value?.model
  || props.route?.dynamicCost?.model
  || null
))
const summary = computed(() => (
  costBreakdown.value?.surface_summary
  || props.route?.dynamicCost?.summary
  || props.route?.dynamicCostSummary
  || null
))
const dataCoverage = computed(() => (
  trace.value?.data?.data_coverage
  || costBreakdown.value?.data_coverage
  || props.route?.dynamicCost?.dataCoverage
  || null
))
const totalCost = computed(() => (
  pathCost.value?.total_traversal_cost
  ?? costBreakdown.value?.total_traversal_cost
  ?? props.route?.totalTraversalCost
  ?? props.route?.cost
  ?? null
))
const riskScale = computed(() => model.value?.risk_scale ?? model.value?.riskScale ?? null)
const modeLabel = computed(() => (
  trace.value?.cost_model === 'dynamic-v1'
  || props.route?.cost_model === 'dynamic-v1'
  || props.route?.costModel === 'dynamic-v1'
  || props.route?.dynamicCost?.enabled
    ? '动态 Cost + A*'
    : 'Cost 选择记录'
))
const sampledAt = computed(() => (
  trace.value?.data?.sampled_at
  || props.route?.dynamicCost?.sampledAt
  || props.route?.planning_context?.planned_for
  || null
))
const timeZone = computed(() => (
  trace.value?.data?.time_zone
  || props.route?.dynamicCost?.timeZone
  || props.route?.planning_context?.time_zone
  || null
))
const formula = computed(() => trace.value?.formula
  ? '单段航线成本 = 飞行距离 ×（距离权重 + 风险放大系数 × 各项标准化风险与权重乘积之和）+ 机动权重 × 等效转弯距离'
  : null)
const selectionReason = computed(() => (
  trace.value?.selection_reason?.summary
  || '该航线生成于选择明细上线前；重新规划后可查看每项 Cost 对本航线的真实贡献。'
))
const coverageText = computed(() => {
  const matched = toFiniteNumber(dataCoverage.value?.matched)
  const sampled = toFiniteNumber(dataCoverage.value?.sampled)
  if (matched == null || sampled == null || sampled <= 0) return '--'
  return `${matched}/${sampled}`
})
const blockedCellsText = computed(() => {
  const blocked = trace.value?.constraints?.blocked_cells ?? summary.value?.blocked
  const number = toFiniteNumber(blocked)
  return number == null ? '--' : `${number} 个`
})
const profileLabel = computed(() => {
  const profile = model.value?.profile
  return ({ balanced: '均衡', safest: '安全优先', fastest: '效率优先' })[profile] || profile || '--'
})
const componentRows = computed(() => {
  const components = pathCost.value?.components || {}
  const weights = model.value?.weights || {}
  const costs = COMPONENTS.map(({ key }) => toFiniteNumber(components[key]?.cost_contribution) ?? 0)
  const maxCost = Math.max(...costs, 0)
  return COMPONENTS.map(({ key, label }, index) => ({
    key,
    label: components[key]?.label || label,
    weight: components[key]?.weight ?? weights[key] ?? null,
    cost: components[key]?.cost_contribution ?? null,
    barPercent: maxCost > 0 ? Math.max(4, Math.round((costs[index] / maxCost) * 100)) : 0,
  }))
})
const layerRows = computed(() => {
  const layers = pathCost.value?.layers
  if (!layers) return []
  return ['static', 'periodic', 'realtime'].map((key) => ({
    key,
    label: layers[key]?.label || key,
    cost: layers[key]?.cost_contribution,
  }))
})

function formatPercent(value) {
  const number = toFiniteNumber(value)
  return number == null ? '--' : `${Math.round(number * 100)}%`
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function isNumberAvailable(value) {
  return toFiniteNumber(value) != null
}

function formatSampledAt(value, requestedTimeZone) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const options = { hour12: false }
  if (requestedTimeZone) options.timeZone = requestedTimeZone
  try {
    return date.toLocaleString('zh-CN', options)
  } catch {
    return date.toLocaleString('zh-CN', { hour12: false })
  }
}
</script>

<style scoped>
.decision-card {
  margin-top: 9px;
  overflow: hidden;
  color: #dcecff;
  background: rgba(3, 15, 29, 0.7);
  border: 1px solid rgba(79, 195, 247, 0.24);
  border-radius: 8px;
}

summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px;
  cursor: pointer;
  list-style: none;
  background: linear-gradient(90deg, rgba(3, 169, 244, 0.1), rgba(3, 15, 29, 0.3));
}

summary::-webkit-details-marker { display: none; }
summary > span { display: flex; flex-direction: column; gap: 2px; }
summary small { color: #4fc3f7; font-size: 7px; letter-spacing: 0.11em; }
summary strong { color: #f0f8ff; font-size: 11px; }
summary b { padding: 3px 6px; color: #80deea; background: rgba(38, 198, 218, 0.1); border-radius: 999px; font-size: 8px; }

.decision-body { padding: 9px 10px 10px; }
.decision-reason { margin: 0; color: #c8e6f5; font-size: 9px; line-height: 1.55; }
.decision-reason.legacy { color: #ffcc80; }

.decision-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin-top: 8px;
}

.decision-metrics div { display: flex; flex-direction: column; gap: 2px; padding: 6px 7px; background: rgba(255, 255, 255, 0.035); border-radius: 5px; }
.decision-metrics span { color: #78909c; font-size: 7px; }
.decision-metrics strong { color: #e1f5fe; font-size: 10px; }

.formula-row { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; padding: 7px 8px; background: rgba(3, 169, 244, 0.055); border-left: 2px solid rgba(79, 195, 247, 0.55); }
.formula-row span, .cost-section-heading small { color: #78909c; font-size: 7px; }
.formula-row code { overflow-wrap: anywhere; color: #b3e5fc; font-family: inherit; font-size: 8px; line-height: 1.45; }

.maneuver-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.maneuver-row span { padding: 4px 6px; color: #90a4ae; background: rgba(255, 255, 255, 0.035); border-radius: 4px; font-size: 7px; }
.maneuver-row strong { color: #b3e5fc; }

.cost-section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; margin-top: 9px; }
.cost-section-heading > span { color: #d9eefb; font-size: 9px; font-weight: 700; }
.component-list { display: grid; gap: 6px; margin-top: 7px; }
.component-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 7px; }
.component-heading span { color: #c7d9e7; font-size: 8px; }
.component-heading small { color: #78909c; font-size: 7px; }
.component-heading strong { min-width: 45px; color: #80deea; text-align: right; font-size: 8px; }
.component-track { height: 3px; margin-top: 3px; overflow: hidden; background: rgba(255, 255, 255, 0.07); border-radius: 999px; }
.component-track i { display: block; height: 100%; background: linear-gradient(90deg, #29b6f6, #80deea); border-radius: inherit; }

.layer-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.layer-row span { padding: 3px 5px; color: #90a4ae; background: rgba(255, 255, 255, 0.035); border-radius: 4px; font-size: 7px; }
.layer-row strong { color: #b3e5fc; }

.decision-footer { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; padding-top: 7px; color: #607d8b; border-top: 1px solid rgba(255, 255, 255, 0.07); font-size: 7px; }
</style>
