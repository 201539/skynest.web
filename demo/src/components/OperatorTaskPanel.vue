<template>
  <aside class="operator-task-panel" :aria-busy="loading">
    <div class="panel-kicker">OPERATOR WORKSPACE</div>
    <div class="panel-heading">
      <div>
        <h2>运营商任务执行端</h2>
        <p>接收校方批准任务，分配无人机与接驳节点，并更新运输进度。</p>
      </div>
      <button type="button" class="refresh-btn" :disabled="loading" @click="loadWorkspace">刷新</button>
    </div>

    <div class="summary-grid">
      <div><strong>{{ activeTaskCount }}</strong><span>执行任务</span></div>
      <div><strong>{{ availableDroneCount }}</strong><span>空闲无人机</span></div>
      <div><strong>{{ availableNodeCount }}</strong><span>可用节点</span></div>
    </div>

    <div class="filter-tabs" role="tablist" aria-label="运营任务筛选">
      <button type="button" :class="{ active: filter === 'active' }" @click="filter = 'active'">待执行</button>
      <button type="button" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
    </div>

    <div v-if="loading" class="panel-state">正在读取运营任务…</div>
    <div v-else-if="loadError" class="panel-state error-state">
      {{ loadError }}
      <button type="button" @click="loadWorkspace">重新加载</button>
    </div>
    <div v-else-if="!filteredTasks.length" class="panel-state success-state">
      当前没有{{ filter === 'active' ? '待执行' : '' }}任务。
    </div>

    <template v-else>
      <div class="task-list" aria-label="运营任务列表">
        <button
          v-for="item in filteredTasks"
          :key="item.task.id"
          type="button"
          :class="['task-item', { active: selectedTaskId === item.task.id }]"
          @click="selectTask(item.task.id)"
        >
          <span>
            <strong>{{ item.task.origin }} → {{ item.task.destination }}</strong>
            <small>{{ item.task.item_category }} · {{ item.task.weight_kg }}kg</small>
          </span>
          <i :class="item.task.status">{{ statusLabel(item.task.status) }}</i>
        </button>
      </div>

      <section v-if="selectedItem" class="task-detail">
        <div class="detail-heading">
          <div>
            <span>{{ selectedItem.task.id }}</span>
            <h3>{{ selectedItem.task.origin }} → {{ selectedItem.task.destination }}</h3>
          </div>
          <b :class="selectedItem.task.status">{{ statusLabel(selectedItem.task.status) }}</b>
        </div>

        <div class="progress-steps" aria-label="任务进度">
          <div
            v-for="(step, index) in progressSteps"
            :key="step.status"
            :class="{ done: index < currentStepIndex, current: index === currentStepIndex }"
          >
            <i>{{ index + 1 }}</i>
            <span>{{ step.label }}</span>
          </div>
        </div>

        <div class="detail-grid">
          <div><span>物品</span><strong>{{ selectedItem.task.item_description || selectedItem.task.item_category }} · {{ selectedItem.task.item_category }}</strong></div>
          <div><span>重量</span><strong>{{ selectedItem.task.weight_kg }} kg</strong></div>
          <div><span>送达时限</span><strong>{{ formatDateTime(selectedItem.task.deadline) }}</strong></div>
          <div><span>特殊要求</span><strong>{{ requirementsLabel }}</strong></div>
        </div>

        <TaskAgentAnalysisCard
          v-if="selectedItem.task.agent_analysis || selectedItem.route"
          :analysis="selectedItem.task.agent_analysis"
          :task="selectedItem.task"
          :route="selectedItem.route"
          audience="operator"
          :task-status="selectedItem.task.status"
        />

        <div class="route-card">
          <div class="route-title-row">
            <div class="section-title">校方批准航线</div>
            <button
              v-if="selectedItem.route"
              type="button"
              @click="emit('view-route', { route: selectedItem.route, task: selectedItem.task })"
            >
              地图查看 Cost
            </button>
          </div>
          <template v-if="selectedItem.route">
            <div class="route-summary">
              <span>{{ selectedItem.route.algorithm }}</span>
              <span>{{ selectedItem.route.waypoints?.length || 0 }} 个航点</span>
              <span>{{ formatDistance(selectedItem.route.total_length_meters) }}</span>
              <span>{{ formatDuration(selectedItem.route.estimated_duration_seconds) }}</span>
            </div>
            <p>风险提示：{{ selectedItem.route.main_risk_factors?.map(riskFactorLabel).join('、') || '暂无明显风险' }}</p>
            <RouteDecisionTraceCard :route="selectedItem.route" />
          </template>
          <p v-else class="muted">航点链暂未生成，请联系路径规划模块。</p>
        </div>

        <div v-if="selectedItem.task.status === TASK_STATUS.APPROVED" class="assignment-card">
          <div class="section-title">执行资源分配</div>
          <div class="assignment-grid">
            <label>
              <span>无人机</span>
              <select v-model="selectedDroneId">
                <option disabled value="">请选择空闲无人机</option>
                <option v-for="drone in availableDrones" :key="drone.id" :value="drone.id">
                  {{ drone.name }} · 电量{{ drone.battery_percent }}%
                </option>
              </select>
            </label>
            <label>
              <span>接驳节点</span>
              <select v-model="selectedNodeId">
                <option disabled value="">{{ nodeSelectionPlaceholder }}</option>
                <option v-for="node in assignableNodes" :key="node.id" :value="node.id">
                  {{ node.name }}
                </option>
              </select>
            </label>
          </div>
        </div>

        <div v-else-if="selectedItem.assigned_drone || selectedItem.assigned_node" class="resource-card">
          <div>
            <span>执行无人机</span>
            <strong>{{ selectedItem.assigned_drone?.name || '未分配' }}</strong>
            <small v-if="selectedItem.assigned_drone">电量 {{ selectedItem.assigned_drone.battery_percent }}% · {{ droneStatusLabel(selectedItem.assigned_drone.status) }}</small>
          </div>
          <div>
            <span>接驳节点</span>
            <strong>{{ selectedItem.assigned_node?.name || '未分配' }}</strong>
            <small v-if="selectedItem.assigned_node">{{ nodeStatusLabel(selectedItem.assigned_node.availability) }}</small>
          </div>
        </div>

        <div v-if="operationError" class="operation-error" role="alert">{{ operationError }}</div>

        <div v-if="nextAction" class="task-action">
          <span>{{ nextAction.hint }}</span>
          <button type="button" :disabled="operating || !canRunNextAction" @click="runNextAction">
            {{ operating ? '处理中…' : nextAction.label }}
          </button>
        </div>

        <div v-else-if="selectedItem.task.status === TASK_STATUS.EXCEPTION" class="complete-card exception-card">
          <strong>飞行任务已安全熔断</strong>
          <span>{{ selectedItem.task.exception_reason || '无人机正在返航，接驳节点已释放。' }}</span>
        </div>

        <div v-else class="complete-card">
          <strong>任务已完成交付</strong>
          <span>运输资源已经释放，记录已进入历史任务。</span>
        </div>
      </section>
    </template>
  </aside>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { DRONE_STATUS, NODE_AVAILABILITY, TASK_STATUS } from '../domain/contracts'
import { demoApi } from '../services/demoApi'
import RouteDecisionTraceCard from './RouteDecisionTraceCard.vue'
import TaskAgentAnalysisCard from './TaskAgentAnalysisCard.vue'
import { useTaskAutoRefresh } from '../composables/useTaskAutoRefresh'

const emit = defineEmits(['updated', 'notify', 'view-route'])

const ACTIVE_STATUSES = new Set([
  TASK_STATUS.APPROVED,
  TASK_STATUS.DISPATCHED,
  TASK_STATUS.IN_TRANSIT,
  TASK_STATUS.ARRIVING,
])

const progressSteps = Object.freeze([
  { status: TASK_STATUS.APPROVED, label: '已批准' },
  { status: TASK_STATUS.DISPATCHED, label: '已派发' },
  { status: TASK_STATUS.IN_TRANSIT, label: '运输中' },
  { status: TASK_STATUS.ARRIVING, label: '到达' },
  { status: TASK_STATUS.DELIVERED, label: '交付' },
])

const workspace = ref({ tasks: [], drones: [], nodes: [] })
const loading = ref(false)
const operating = ref(false)
const loadError = ref('')
const operationError = ref('')
const filter = ref('active')
const selectedTaskId = ref('')
const selectedDroneId = ref('')
const selectedNodeId = ref('')

const activeTaskCount = computed(() => workspace.value.tasks.filter((item) => ACTIVE_STATUSES.has(item.task.status)).length)
const availableDrones = computed(() => workspace.value.drones.filter((drone) => drone.status === DRONE_STATUS.IDLE))
const availableNodes = computed(() => workspace.value.nodes.filter((node) => node.availability === NODE_AVAILABILITY.AVAILABLE))
const plannedReceivingNodeId = computed(() => getPlannedReceivingNodeId(selectedItem.value))
const assignableNodes = computed(() => {
  const plannedNodeId = plannedReceivingNodeId.value
  if (plannedNodeId != null) {
    return availableNodes.value.filter((node) => Number(node.id) === plannedNodeId)
  }

  const candidates = orderedAvailableCandidates(selectedItem.value)
  return candidates.length ? candidates : availableNodes.value
})
const nodeSelectionPlaceholder = computed(() => (
  plannedReceivingNodeId.value != null && !assignableNodes.value.length
    ? '航线接驳节点当前不可用'
    : '请选择可用节点'
))
const availableDroneCount = computed(() => availableDrones.value.length)
const availableNodeCount = computed(() => availableNodes.value.length)
const filteredTasks = computed(() => filter.value === 'active'
  ? workspace.value.tasks.filter((item) => ACTIVE_STATUSES.has(item.task.status))
  : workspace.value.tasks)
const selectedItem = computed(() => filteredTasks.value.find((item) => item.task.id === selectedTaskId.value) || filteredTasks.value[0] || null)
const currentStepIndex = computed(() => Math.max(0, progressSteps.findIndex((step) => step.status === selectedItem.value?.task.status)))
const requirementsLabel = computed(() => selectedItem.value?.task.special_requirements?.join('、') || '无')
const nextAction = computed(() => ({
  [TASK_STATUS.APPROVED]: { label: '接收并派发任务', hint: '确认无人机与接驳节点后接收航点链。' },
  [TASK_STATUS.DISPATCHED]: { label: '开始运输', hint: '起飞检查完成后更新为运输中。' },
  [TASK_STATUS.IN_TRANSIT]: { label: '标记到达节点', hint: '无人机抵达接驳节点后更新状态。' },
  [TASK_STATUS.ARRIVING]: { label: '确认完成交付', hint: '确认收件完成并释放无人机和节点。' },
}[selectedItem.value?.task.status] || null))
const canRunNextAction = computed(() => {
  if (selectedItem.value?.task.status !== TASK_STATUS.APPROVED) return true
  return Boolean(selectedDroneId.value && selectedNodeId.value)
})

watch(filteredTasks, (items) => {
  if (!items.some((item) => item.task.id === selectedTaskId.value)) selectedTaskId.value = items[0]?.task.id || ''
})

watch(selectedItem, (item) => {
  operationError.value = ''
  if (item?.task.status === TASK_STATUS.APPROVED) setDefaultResources(item)
}, { immediate: true })

function getPlannedReceivingNodeId(item) {
  const accessPoint = item?.route?.planning_context?.access_points?.receiving
  const nodeId = Number(accessPoint?.node_id ?? accessPoint?.id)
  return Number.isInteger(nodeId) && nodeId > 0 ? nodeId : null
}

function orderedAvailableCandidates(item) {
  const nodesById = new Map(availableNodes.value.map((node) => [Number(node.id), node]))
  return (item?.task?.candidate_node_ids || [])
    .map((nodeId) => nodesById.get(Number(nodeId)))
    .filter(Boolean)
}

function setDefaultResources(item) {
  const plannedNodeId = getPlannedReceivingNodeId(item)
  const plannedNode = plannedNodeId == null
    ? null
    : availableNodes.value.find((node) => Number(node.id) === plannedNodeId)
  const candidateNode = plannedNodeId == null ? orderedAvailableCandidates(item)[0] : null
  selectedDroneId.value = availableDrones.value[0]?.id || ''
  selectedNodeId.value = plannedNode?.id || candidateNode?.id || (plannedNodeId == null ? availableNodes.value[0]?.id : '') || ''
}

function selectTask(taskId) {
  selectedTaskId.value = taskId
  operationError.value = ''
}

function statusLabel(status) {
  return {
    [TASK_STATUS.APPROVED]: '待派发',
    [TASK_STATUS.DISPATCHED]: '已派发',
    [TASK_STATUS.IN_TRANSIT]: '运输中',
    [TASK_STATUS.ARRIVING]: '已到达',
    [TASK_STATUS.DELIVERED]: '已交付',
    [TASK_STATUS.EXCEPTION]: '异常',
  }[status] || status
}

function droneStatusLabel(status) {
  return { idle: '空闲', assigned: '已分配', in_flight: '飞行中', returning: '返航中', charging: '充电中' }[status] || status
}

function nodeStatusLabel(status) {
  return { available: '可用', reserved: '已预留', occupied: '占用中', maintenance: '维护中', offline: '离线' }[status] || status
}

function riskFactorLabel(value) {
  return ({
    static_environment: '静态环境', population_density: '人流密度', weather: '天气条件',
    construction: '施工', event: '临时事件', data_coverage_gap: '数据覆盖不足',
    energy: '能源', no_fly_zone: '禁飞区', class_period: '上课时段',
    consumption_peak: '食堂营业高峰', access_closed: '场馆关闭',
    weather_default_configured: '默认天气参数',
    weather_data_stale: '天气数据过期', weather_data_missing: '天气数据缺失',
  })[value] || value
}

function formatDateTime(value) {
  if (!value) return '未填写'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function formatDistance(meters) {
  return Number.isFinite(Number(meters)) ? `${(Number(meters) / 1000).toFixed(2)} km` : '距离待计算'
}

function formatDuration(seconds) {
  return Number.isFinite(Number(seconds)) ? `约 ${Math.max(1, Math.round(Number(seconds) / 60))} 分钟` : '时长待计算'
}

async function loadWorkspace(options = {}) {
  const quiet = options?.quiet === true
  if (!quiet) loading.value = true
  try {
    workspace.value = await demoApi.getOperatorWorkspace()
    loadError.value = ''
    if (!selectedTaskId.value) selectedTaskId.value = filteredTasks.value[0]?.task.id || ''
  } catch (error) {
    console.error('运营工作台加载失败', error)
    if (!quiet || !workspace.value.tasks.length) loadError.value = `运营工作台加载失败：${error.message}`
  } finally {
    if (!quiet) loading.value = false
  }
}

async function runNextAction() {
  const item = selectedItem.value
  if (!item || operating.value || !canRunNextAction.value) return
  operating.value = true
  operationError.value = ''

  try {
    const previousStatus = item.task.status
    workspace.value = previousStatus === TASK_STATUS.APPROVED
      ? await demoApi.dispatchTask(item.task.id, { drone_id: selectedDroneId.value, node_id: selectedNodeId.value })
      : await demoApi.advanceOperatorTask(item.task.id)
    emit('updated', workspace.value)
    emit('notify', {
      [TASK_STATUS.APPROVED]: '任务已接收并完成资源派发',
      [TASK_STATUS.DISPATCHED]: '无人机已开始运输',
      [TASK_STATUS.IN_TRANSIT]: '无人机已到达接驳节点',
      [TASK_STATUS.ARRIVING]: '任务已完成交付',
    }[previousStatus])
  } catch (error) {
    console.error('运营任务更新失败', error)
    operationError.value = `任务状态更新失败：${error.message}`
  } finally {
    operating.value = false
  }
}

useTaskAutoRefresh(loadWorkspace)
onMounted(loadWorkspace)
</script>

<style scoped>
.operator-task-panel {
  position: absolute;
  top: 62px;
  right: 16px;
  width: 420px;
  max-height: calc(100vh - 82px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 17px;
  color: #edf5ff;
  background: linear-gradient(155deg, rgba(12, 28, 52, 0.97), rgba(16, 24, 40, 0.94));
  border: 1px solid rgba(144, 202, 249, 0.28);
  border-radius: 14px;
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(12px);
  z-index: 998;
  transition: transform 220ms ease, opacity 180ms ease;
  will-change: transform;
}

.operator-task-panel.role-panel-collapsed {
  transform: translateX(calc(100% + 32px));
  opacity: 0;
  pointer-events: none;
}

.panel-kicker { color: #64b5f6; font-size: 10px; letter-spacing: 0.16em; }
.panel-heading { display: flex; justify-content: space-between; gap: 10px; margin-top: 4px; }
.panel-heading h2 { margin: 0; font-size: 18px; }
.panel-heading p { margin: 6px 0 0; color: #b9c7d9; font-size: 11px; line-height: 1.5; }
.refresh-btn { align-self: flex-start; padding: 5px 8px; color: #b3e5fc; background: rgba(3, 169, 244, 0.1); border: 1px solid rgba(79, 195, 247, 0.28); border-radius: 6px; cursor: pointer; }

.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-top: 13px; }
.summary-grid div { display: flex; flex-direction: column; align-items: center; padding: 8px; background: rgba(144, 202, 249, 0.07); border: 1px solid rgba(144, 202, 249, 0.12); border-radius: 8px; }
.summary-grid strong { color: #81d4fa; font-size: 18px; }
.summary-grid span { color: #90a4ae; font-size: 10px; }

.filter-tabs { display: flex; gap: 5px; margin: 12px 0 8px; }
.filter-tabs button { padding: 5px 10px; color: #90a4ae; background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; }
.filter-tabs button.active { color: #e1f5fe; border-color: #4fc3f7; }
.panel-state { padding: 22px 4px; color: #b0bec5; text-align: center; font-size: 12px; }
.panel-state button { margin-left: 5px; color: #81d4fa; background: none; border: 0; cursor: pointer; }
.error-state { color: #ffab91; }
.success-state { color: #a5d6a7; }

.task-list { display: flex; gap: 7px; overflow-x: auto; padding-bottom: 7px; }
.task-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 240px; padding: 8px 9px; color: #e7f1fb; text-align: left; background: rgba(4, 13, 27, 0.58); border: 1px solid rgba(144, 202, 249, 0.14); border-radius: 8px; cursor: pointer; }
.task-item.active { border-color: rgba(79, 195, 247, 0.65); background: rgba(3, 169, 244, 0.1); }
.task-item > span { display: flex; flex-direction: column; min-width: 0; }
.task-item strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.task-item small { margin-top: 3px; color: #78909c; font-size: 9px; }
.task-item i, .detail-heading b { flex: 0 0 auto; padding: 3px 6px; border-radius: 999px; color: #b3e5fc; background: rgba(3, 169, 244, 0.12); font-size: 9px; font-style: normal; }
.task-item i.in_transit, .detail-heading b.in_transit { color: #fff59d; background: rgba(255, 235, 59, 0.12); }
.task-item i.delivered, .detail-heading b.delivered { color: #a5d6a7; background: rgba(102, 187, 106, 0.12); }

.task-detail { margin-top: 5px; padding-top: 11px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.detail-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.detail-heading > div > span { color: #607d8b; font-family: monospace; font-size: 9px; }
.detail-heading h3 { margin: 3px 0 0; font-size: 15px; }

.progress-steps { display: grid; grid-template-columns: repeat(5, 1fr); gap: 3px; margin-top: 12px; }
.progress-steps div { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; color: #607d8b; font-size: 8px; }
.progress-steps div::before { position: absolute; top: 8px; right: 50%; left: -50%; height: 1px; background: rgba(144, 202, 249, 0.18); content: ''; }
.progress-steps div:first-child::before { display: none; }
.progress-steps i { position: relative; z-index: 1; display: grid; place-items: center; width: 17px; height: 17px; border-radius: 50%; background: #26384c; font-style: normal; }
.progress-steps div.done, .progress-steps div.current { color: #b3e5fc; }
.progress-steps div.done i { color: #062113; background: #66bb6a; }
.progress-steps div.current i { color: #061426; background: #4fc3f7; box-shadow: 0 0 0 3px rgba(79, 195, 247, 0.12); }

.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 12px; }
.detail-grid div { display: flex; flex-direction: column; gap: 2px; padding: 7px 8px; background: rgba(255, 255, 255, 0.035); border-radius: 6px; }
.detail-grid span, .assignment-grid span, .resource-card span { color: #78909c; font-size: 9px; }
.detail-grid strong { color: #d7e4f1; font-size: 10px; }

.route-card, .assignment-card { margin-top: 9px; padding: 9px; background: rgba(4, 13, 27, 0.48); border: 1px solid rgba(144, 202, 249, 0.12); border-radius: 8px; }
.section-title { color: #dbe9f7; font-size: 11px; font-weight: 700; }
.route-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.route-title-row button { padding: 4px 7px; color: #b3e5fc; background: rgba(3, 169, 244, 0.1); border: 1px solid rgba(79, 195, 247, 0.24); border-radius: 5px; font-size: 9px; cursor: pointer; }
.route-summary { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.route-summary span { padding: 3px 6px; color: #b3e5fc; background: rgba(3, 169, 244, 0.1); border-radius: 5px; font-size: 9px; }
.route-card p { margin: 6px 0 0; color: #90a4ae; font-size: 9px; }
.route-card .muted { color: #78909c; }

.assignment-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 7px; }
.assignment-grid label { display: flex; flex-direction: column; gap: 4px; }
.assignment-grid select { width: 100%; box-sizing: border-box; padding: 7px; color: #f5f9ff; background: rgba(4, 13, 27, 0.72); border: 1px solid rgba(144, 202, 249, 0.2); border-radius: 6px; outline: none; font-size: 10px; }

.resource-card { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 9px; }
.resource-card > div { display: flex; flex-direction: column; gap: 2px; padding: 8px; background: rgba(3, 169, 244, 0.06); border: 1px solid rgba(79, 195, 247, 0.12); border-radius: 7px; }
.resource-card strong { color: #d7e4f1; font-size: 10px; }
.resource-card small { color: #90a4ae; font-size: 9px; }

.operation-error { margin-top: 8px; color: #ffab91; font-size: 10px; }
.task-action { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.task-action > span { max-width: 55%; color: #90a4ae; font-size: 9px; line-height: 1.4; }
.task-action button { padding: 8px 11px; color: #061426; font-weight: 700; background: linear-gradient(135deg, #90caf9, #4fc3f7); border: 1px solid rgba(255, 255, 255, 0.4); border-radius: 7px; font-size: 10px; cursor: pointer; }
.task-action button:disabled, .refresh-btn:disabled { opacity: 0.5; cursor: wait; }
.complete-card { display: flex; flex-direction: column; gap: 3px; margin-top: 10px; padding: 9px; color: #c8e6c9; background: rgba(102, 187, 106, 0.09); border: 1px solid rgba(102, 187, 106, 0.22); border-radius: 7px; font-size: 10px; }
.complete-card span { color: #90a4ae; }
.exception-card { color: #ffccbc; background: rgba(255, 87, 34, 0.1); border-color: rgba(255, 112, 67, 0.34); }
.exception-card span { color: #ffab91; }

@media (max-width: 980px) {
  .operator-task-panel { right: 10px; width: 370px; }
}
</style>
