<template>
  <section v-if="analysis" class="agent-summary">
    <header>
      <div>
        <span>AGENT DECISION SUMMARY</span>
        <strong>{{ audience === 'operator' ? '运营执行说明' : '校方审核说明' }}</strong>
      </div>
      <div class="status-badges">
        <b>{{ modeLabel }}</b>
        <i :class="generationTone">{{ generationLabel }}</i>
      </div>
    </header>
    <p>{{ decisionSummary }}</p>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  analysis: { type: Object, default: null },
  task: { type: Object, default: null },
  route: { type: Object, default: null },
  audience: { type: String, default: 'school' },
  taskStatus: { type: String, default: '' },
})

const riskLabels = Object.freeze({
  static_environment: '静态适航',
  population_density: '人流密度',
  weather_default_configured: '默认天气参数',
  realtime_weather: '实时天气',
  runtime_restriction: '实时限制区',
  dynamic_event: '动态事件',
})

const modeLabel = computed(() => props.route?.agent_explanation?.provider === 'deepseek' ? 'DeepSeek航线解释' : props.analysis?.ai?.mode_label || 'V3规则说明')
const generationLabel = computed(() => {
  if (props.route?.explanation_status === 'generating') return '生成中'
  if (props.route?.explanation_status === 'fallback') return '规则回退已生成'
  if (props.route?.explanation_status === 'generated') return '已生成'
  return props.analysis?.ai?.fallback_used ? '规则回退已生成' : '已生成'
})
const generationTone = computed(() => ['fallback', 'pending'].includes(props.route?.explanation_status) || props.analysis?.ai?.fallback_used ? 'fallback' : 'complete')
const accessPlan = computed(() => props.analysis?.access_point_plan || props.route?.planning_context?.access_points || {})
const departure = computed(() => accessPlan.value.departure || null)
const receiving = computed(() => accessPlan.value.receiving || null)
const vehicleLabel = computed(() => props.analysis?.vehicle_recommendation?.vehicle?.label || props.task?.recommended_vehicle_class || '待规则确定的机型')
const requirements = computed(() => props.task?.special_requirements?.length ? props.task.special_requirements.join('、') : '')

const decisionSummary = computed(() => {
  if (props.audience === 'operator') return operatorSummary()
  if (props.route?.agent_explanation?.summary) return props.route.agent_explanation.summary
  if (props.route?.route_type === 'replan') return replanSummary()
  if (props.route) return plannedSchoolSummary()
  return pendingSchoolSummary()
})

function pendingSchoolSummary() {
  const task = props.task || {}
  const nodeText = departure.value && receiving.value
    ? `系统按建筑距离将起终点接入最近可用的 L3-${departure.value.node_code} 和 L3-${receiving.value.node_code} 节点`
    : '起终点尚未完成可靠的 L3 节点映射'
  const review = props.analysis?.manual_review_reasons?.length
    ? `需要人工复核：${props.analysis.manual_review_reasons.map((item) => String(item).replace(/[。；，]+$/u, '')).join('；')}`
    : '需求信息完整，未触发高风险专项复核，但仍须校方常规审批'
  const handling = requirements.value ? `，并核验${requirements.value}措施` : ''
  const categoryCheck = task.item_category === '危险化学品' ? '，校方还须核验危化品运输资质、密封包装、接收人员和泄漏应急预案' : task.item_category === '高价值设备' ? '，校方还须核验防震包装、交接责任、接收人身份和设备保全措施' : ['医疗样本','生物材料'].includes(task.item_category) ? '，校方还须核验运输资质、冷链连续性、包装和接收条件' : ''
  return `${task.item_category || '该物品'}重${task.weight_kg ?? '未知'}kg，由${task.origin || '未确认起点'}送往${task.destination || '未确认终点'}；${nodeText}。V3规则匹配${vehicleLabel.value}；${review}${handling}${categoryCheck}。批准后才由动态格网算法生成航线，Agent不参与节点、机型或审批决策。`
}

function plannedSchoolSummary() {
  const route = props.route
  const nodeText = departure.value && receiving.value ? `L3-${departure.value.node_code} 至 L3-${receiving.value.node_code}` : '已批准端点之间'
  const risks = route.main_risk_factors?.length ? route.main_risk_factors.map((item) => riskLabels[item] || item).join('、') : '未记录突出风险'
  const summary = route.cost_breakdown?.surface_summary
  const sampled = route.cost_breakdown?.data_coverage?.sampled
  const blocked = summary?.blocked
  const weatherDefault = summary?.weather_data?.configured_default
  const evidence = [
    sampled != null && blocked != null ? `${sampled}个采样格网中${blocked}个不可通行` : '',
    weatherDefault ? `其中${weatherDefault}个格网使用默认天气参数` : '',
    route.avoided_zones?.length ? `已绕开${route.avoided_zones.join('、')}` : '未遇到已记录的生效限制区',
  ].filter(Boolean).join('，')
  const handling = requirements.value ? `；执行前应确认${requirements.value}措施` : ''
  return `校方批准后，${route.algorithm || 'A*'}算法生成${nodeText}的${route.waypoints?.length || 0}个航点航线，全长${distanceLabel(route.total_length_meters)}，主要成本来自${risks}；${evidence}${handling}。若天气使用默认值，应在执行前核验实际天气；航线、节点和机型均由规则算法确定，Agent仅解释结果。`
}

function replanSummary() {
  const route = props.route
  const trigger = route.change_trigger?.reason || route.change_trigger?.type || '限制区或动态成本变化'
  const distance = changeLabel(route.distance_change_percent)
  const risk = changeLabel(route.risk_change_percent)
  const avoided = route.avoided_zones?.length ? `，新航线绕开${route.avoided_zones.join('、')}` : ''
  return `${trigger}与原航线产生影响，系统已重新规划${avoided}；新航线共${route.waypoints?.length || 0}个航点、${distanceLabel(route.total_length_meters)}，较上一版距离变化${distance}、综合风险变化${risk}。校方应确认新版本后通知运营端停用旧航点链；这些变化来自算法结果，Agent未修改航线。`
}

function operatorSummary() {
  const task = props.task || {}
  const route = props.route
  if (!route) return '校方批准航线尚未生成，运营端不得自行规划、派发或更换接驳节点。'
  const nodes = departure.value && receiving.value ? `从L3-${departure.value.node_code}取货并在L3-${receiving.value.node_code}交付` : '按校方批准端点执行'
  const handling = requirements.value ? `，落实${requirements.value}` : ''
  const weatherDefault = route.cost_breakdown?.surface_summary?.weather_data?.configured_default
  const weather = weatherDefault ? '，并在起飞前核验实际天气' : ''
  const version = route.route_type === 'replan' ? '当前重新规划版本' : '校方批准的当前版本'
  return `任务使用${vehicleLabel.value}，${nodes}；${version}含${route.waypoints?.length || 0}个航点、全长${distanceLabel(route.total_length_meters)}。执行前确认无人机电量、节点状态和货物交接条件${handling}${weather}；必须使用当前批准航点链，不得自行更换节点或航线，Agent仅解释执行依据。`
}

function distanceLabel(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '距离未记录'
  return number >= 1000 ? `${(number / 1000).toFixed(2)}公里` : `${Math.round(number)}米`
}
function changeLabel(value) {
  const number = Number(value)
  return Number.isFinite(number) ? `${number > 0 ? '+' : ''}${number.toFixed(1)}%` : '未记录'
}
</script>

<style scoped>
.agent-summary{margin-top:10px;padding:11px;background:rgba(18,54,78,.2);border:1px solid rgba(79,195,247,.24);border-radius:9px}.agent-summary header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.agent-summary header>div:first-child{display:flex;flex-direction:column;gap:2px}.agent-summary header span{color:#4fc3f7;font-size:8px;letter-spacing:.08em}.agent-summary header strong{color:#e7f2fb;font-size:11px}.status-badges{display:flex;align-items:flex-end;flex-direction:column;gap:3px}.status-badges b{padding:3px 6px;color:#b3e5fc;background:rgba(3,169,244,.12);border-radius:999px;font-size:8px}.status-badges i{font-size:8px;font-style:normal}.status-badges .complete{color:#69f0ae}.status-badges .fallback{color:#ffd180}.agent-summary p{margin:9px 0 0;padding:9px;color:#d7e8f5;background:rgba(3,169,244,.06);border-radius:6px;font-size:10px;line-height:1.65}
</style>
