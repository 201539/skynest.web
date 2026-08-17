<template>
  <aside class="school-review-panel" :aria-busy="loading">
    <div class="panel-kicker">SCHOOL REVIEW WORKSPACE</div>
    <div class="panel-heading">
      <div>
        <h2>校方监管工作台</h2>
        <p>审核运输任务、管理临时限制区，并留存完整运行审计记录。</p>
      </div>
      <button type="button" class="refresh-btn" :disabled="loading || safetyLoading" @click="refreshCurrentWorkspace">刷新</button>
    </div>

    <div class="workspace-tabs" role="tablist" aria-label="校方监管功能">
      <button type="button" :class="{ active: workspaceMode === 'review' }" @click="switchWorkspaceMode('review')">任务审核</button>
      <button type="button" :class="{ active: workspaceMode === 'safety' }" @click="switchWorkspaceMode('safety')">
        安全管控 <span v-if="activeRestrictions.length">{{ activeRestrictions.length }}</span>
      </button>
      <button type="button" :class="{ active: workspaceMode === 'audit' }" @click="switchWorkspaceMode('audit')">
        审计记录 <span v-if="auditCount">{{ auditCount }}</span>
      </button>
    </div>

    <template v-if="workspaceMode === 'review'">
    <AgentModelStatusCard @notify="(message) => emit('notify', message)" />
    <div class="review-summary">
      <div><strong>{{ pendingCount }}</strong><span>待审核</span></div>
      <div><strong>{{ highRiskCount }}</strong><span>高风险</span></div>
      <div><strong>{{ queue.length }}</strong><span>全部任务</span></div>
    </div>

    <div class="filter-tabs" role="tablist" aria-label="审核任务筛选">
      <button
        v-for="option in filterOptions"
        :key="option.value"
        type="button"
        :class="{ active: filter === option.value }"
        @click="filter = option.value"
      >
        {{ option.label }}
      </button>
    </div>

    <div v-if="loading" class="panel-state">正在读取审核任务…</div>
    <div v-else-if="loadError" class="panel-state error-state">
      {{ loadError }}
      <button type="button" @click="loadQueue">重新加载</button>
    </div>
    <div v-else-if="!filteredQueue.length" class="panel-state success-state">
      当前没有{{ filter === 'pending' ? '待审核' : '' }}任务。
    </div>

    <template v-else>
      <div class="task-queue" aria-label="审核任务列表">
        <div
          v-for="item in filteredQueue"
          :key="item.task.id"
          class="queue-item"
          :class="{ active: selectedTaskId === item.task.id }"
        >
          <button type="button" class="queue-select" @click="selectTask(item.task.id)">
            <span class="queue-main">
              <strong>{{ item.task.origin }} → {{ item.task.destination }}</strong>
              <small>{{ item.task.item_category }} · {{ item.task.weight_kg }}kg</small>
            </span>
            <span :class="['status-badge', item.task.status]">{{ statusLabel(item.task.status) }}</span>
          </button>
          <button
            type="button"
            class="queue-delete"
            :disabled="Boolean(deletingTaskId) || taskDeleteBlocked(item.task)"
            :title="taskDeleteBlocked(item.task) ? '执行中或异常处置中的任务不能直接删除' : '删除任务及关联记录'"
            :aria-label="`删除任务：${item.task.origin}到${item.task.destination}`"
            @click="deleteTask(item)"
          >
            {{ deletingTaskId === item.task.id ? '删除中' : '删除' }}
          </button>
        </div>
      </div>
      <div v-if="deleteError" class="action-error" role="alert">{{ deleteError }}</div>

      <section v-if="selectedItem" class="review-detail">
        <div class="detail-title-row">
          <div>
            <span class="task-code">{{ selectedItem.task.id }}</span>
            <h3>{{ selectedItem.task.origin }} → {{ selectedItem.task.destination }}</h3>
          </div>
          <span v-if="selectedItem.task.needs_manual_review" class="risk-badge">高风险</span>
        </div>

        <div class="detail-grid">
          <div><span>申请人</span><strong>{{ requesterLabel }}</strong></div>
          <div><span>物品</span><strong>{{ selectedItem.task.item_category }}</strong></div>
          <div><span>重量</span><strong>{{ selectedItem.task.weight_kg }} kg</strong></div>
          <div><span>送达时限</span><strong>{{ formatDateTime(selectedItem.task.deadline) }}</strong></div>
          <div><span>优先级</span><strong>{{ priorityLabel(selectedItem.task.priority) }}</strong></div>
          <div><span>载具建议</span><strong>{{ vehicleLabel(selectedItem.task.recommended_vehicle_class) }}</strong></div>
        </div>

        <div v-if="selectedItem.task.input_text" class="request-quote">
          <span>原始需求</span>
          <p>{{ selectedItem.task.input_text }}</p>
        </div>

        <div v-if="selectedItem.task.special_requirements?.length" class="requirement-row">
          <span>特殊要求</span>
          <i v-for="requirement in selectedItem.task.special_requirements" :key="requirement">{{ requirement }}</i>
        </div>

        <div v-if="selectedItem.task.needs_manual_review" class="risk-notice">
          <strong>必须人工复核</strong>
          <span>物品风险等级较高，请确认包装、运输资质和接收条件。</span>
        </div>

        <TaskAgentAnalysisCard
          v-if="selectedItem.task.agent_analysis"
          :analysis="selectedItem.task.agent_analysis"
          audience="school"
        />

        <div v-if="accessPointPlan" class="access-point-card">
          <div class="section-title">建筑接入方案</div>
          <div>
            <span>起点接入</span>
            <strong>{{ selectedItem.task.origin }} → {{ accessPointPlan.departure.node_code }}</strong>
            <small>{{ accessPointPlan.departure.node_name }} · 约{{ Math.round(accessPointPlan.departure.distance_m) }}米</small>
          </div>
          <div>
            <span>终点接入</span>
            <strong>{{ accessPointPlan.receiving.node_code }} → {{ selectedItem.task.destination }}</strong>
            <small>{{ accessPointPlan.receiving.node_name }} · 约{{ Math.round(accessPointPlan.receiving.distance_m) }}米</small>
          </div>
        </div>

        <div class="route-card">
          <div class="route-title-row">
            <div class="section-title">推荐航线</div>
            <button
              v-if="selectedItem.route"
              type="button"
              @click="emit('view-route', { route: selectedItem.route, task: selectedItem.task })"
            >
              地图查看
            </button>
          </div>
          <template v-if="selectedItem.route">
            <div class="route-metrics">
              <span>{{ selectedItem.route.algorithm }}</span>
              <span>{{ formatDistance(selectedItem.route.total_length_meters) }}</span>
              <span>{{ formatDuration(selectedItem.route.estimated_duration_seconds) }}</span>
            </div>
            <p v-if="selectedItem.route.main_risk_factors?.length">
              主要风险：{{ selectedItem.route.main_risk_factors.map(riskFactorLabel).join('、') }}
            </p>
            <p v-if="selectedItem.route.avoided_zones?.length">
              已绕开：{{ selectedItem.route.avoided_zones.join('、') }}
            </p>
            <RouteExplanationCard :explanation="selectedItem.route.explanation" />
            <RouteDecisionTraceCard :route="selectedItem.route" />
          </template>
          <p v-else class="muted">暂未生成推荐航线，批准后可交由路径算法计算。</p>
        </div>

        <template v-if="selectedItem.task.status === TASK_STATUS.PENDING_REVIEW">
          <label class="review-reason">
            <span>审核意见 <small>驳回时必填</small></span>
            <textarea v-model.trim="reviewReason" rows="2" placeholder="填写批准条件或驳回原因"></textarea>
          </label>
          <div v-if="actionError" class="action-error" role="alert">{{ actionError }}</div>
          <div class="review-actions">
            <button type="button" class="reject-btn" :disabled="reviewing" @click="submitReview(APPROVAL_DECISION.REJECTED)">
              驳回任务
            </button>
            <button type="button" class="approve-btn" :disabled="reviewing" @click="submitReview(APPROVAL_DECISION.APPROVED)">
              {{ reviewing ? '处理中…' : '批准并交给运营商' }}
            </button>
          </div>
        </template>

        <div v-else class="review-result" :class="selectedItem.task.status">
          <strong>{{ statusLabel(selectedItem.task.status) }}</strong>
          <span>{{ selectedItem.approval?.reason || '审核已完成' }}</span>
          <small v-if="selectedItem.approval?.reviewed_at">{{ formatDateTime(selectedItem.approval.reviewed_at) }}</small>
        </div>
      </section>
    </template>
    </template>

    <section v-else-if="workspaceMode === 'safety'" class="safety-workspace">
      <div class="safety-summary">
        <div><strong>{{ activeRestrictions.length }}</strong><span>生效限制区</span></div>
        <div><strong>{{ safetyWorkspace.affected_routes.length }}</strong><span>冲突航线</span></div>
        <div><strong>{{ safetyWorkspace.active_tasks.length }}</strong><span>执行中任务</span></div>
        <div><strong>{{ safetyWorkspace.restrictions.length }}</strong><span>限制记录</span></div>
      </div>

      <div class="replan-service-status" :class="replanServiceClass">
        <div>
          <strong>{{ replanServiceLabel }}</strong>
          <span>{{ replanServiceDetail }}</span>
        </div>
        <small>{{ safetyWorkspace.source === 'v3' ? 'V3 实时数据库' : '本地演示数据' }}</small>
      </div>

      <div v-if="safetyLoading" class="panel-state">正在读取安全管控状态…</div>
      <div v-else-if="safetyError" class="panel-state error-state">{{ safetyError }}</div>
      <template v-else>
        <div class="safety-section-title">临时空域限制</div>
        <div class="restriction-list">
          <div v-for="restriction in safetyWorkspace.restrictions" :key="restriction.id" class="restriction-item">
            <div>
              <strong>{{ restriction.name }}</strong>
              <span>{{ restriction.reason }}</span>
              <small>半径 {{ restriction.radius_m }}m · 至 {{ formatDateTime(restriction.end_at) }}</small>
            </div>
            <div class="restriction-actions">
              <button type="button" class="locate-btn" @click="emit('view-restriction', restriction)">地图定位</button>
              <button
                type="button"
                :class="{ active: restriction.status === RESTRICTION_STATUS.ACTIVE }"
                :disabled="safetyOperating || Boolean(deletingRestrictionId)"
                @click="toggleRestriction(restriction)"
              >
                {{ restriction.status === RESTRICTION_STATUS.ACTIVE ? '生效中' : '已停用' }}
              </button>
              <button
                type="button"
                class="restriction-delete-btn"
                :disabled="safetyOperating || Boolean(deletingRestrictionId)"
                :aria-label="`删除限制区：${restriction.name}`"
                @click="deleteRestriction(restriction)"
              >
                {{ deletingRestrictionId === restriction.id ? '删除中' : '删除' }}
              </button>
            </div>
          </div>
        </div>
        <div v-if="restrictionDeleteError" class="action-error" role="alert">{{ restrictionDeleteError }}</div>

        <div class="replan-card">
          <div class="safety-section-title">冲突检测与动态重规划</div>
          <p>系统根据生效限制区检测航段冲突；只有完成几何校验后，才会生成带安全缓冲的绕行航点链。</p>
          <div v-if="safetyWorkspace.affected_routes.length" class="affected-route-list">
            <div v-for="item in safetyWorkspace.affected_routes" :key="item.task.id" class="affected-route-item">
              <div class="affected-route-main">
                <strong>{{ item.task.origin }} → {{ item.task.destination }}</strong>
                <span>穿越 {{ item.conflicts[0].restriction.name }}</span>
                <small>
                  冲突 {{ item.conflicts[0].analysis.conflict_segment_count }} 个航段 ·
                  区内航程约 {{ item.conflicts[0].analysis.restricted_distance_meters }}m
                </small>
              </div>
              <button
                type="button"
                class="replan-btn"
                :aria-label="`重新规划 ${item.task.origin} 到 ${item.task.destination} 航线`"
                :disabled="Boolean(replanningTaskId)"
                @click="executeRouteReplan(item)"
              >
                {{ replanningTaskId === item.task.id ? '计算中…' : '生成绕行航线' }}
              </button>
            </div>
          </div>
          <div v-else class="route-clear">当前航线均未穿越生效限制区。</div>
          <div v-if="replanError" class="action-error" role="alert">{{ replanError }}</div>

          <div v-if="safetyWorkspace.recent_replans.length" class="replan-results">
            <div class="result-title">最近重规划结果</div>
            <div v-for="item in safetyWorkspace.recent_replans" :key="item.route.id" class="replan-result-item">
              <div>
                <strong>{{ item.task?.origin }} → {{ item.task?.destination }}</strong>
                <span>已避开：{{ item.route.replan_summary.trigger_name }}</span>
              </div>
              <div class="replan-metrics">
                <div><strong>{{ formatSignedPercent(item.route.replan_summary.distance_change_percent) }}</strong><span>航程变化</span></div>
                <div><strong>{{ formatSignedPercent(item.route.replan_summary.risk_change_percent) }}</strong><span>动态风险</span></div>
                <div><strong>{{ item.route.replan_summary.safety_buffer_meters }}m</strong><span>安全缓冲</span></div>
              </div>
              <button type="button" class="compare-route-btn" @click="emit('view-route', item)">地图对比新旧航线</button>
            </div>
          </div>
        </div>

        <form class="restriction-form" @submit.prevent="submitRestriction">
          <div class="safety-section-title">新增临时限制区</div>
          <div class="safety-form-grid">
            <label>
              <span>区域预设</span>
              <select v-model="restrictionForm.preset_id">
                <option v-for="preset in restrictionPresets" :key="preset.id" :value="preset.id">{{ preset.label }}</option>
              </select>
              <small v-if="selectedRestrictionPreset" class="restriction-location-hint">
                定位：{{ selectedRestrictionPreset.anchor_label }} ·
                {{ selectedRestrictionPreset.center.lng.toFixed(6) }},
                {{ selectedRestrictionPreset.center.lat.toFixed(6) }}
              </small>
            </label>
            <label>
              <span>限制半径（m）</span>
              <input v-model.number="restrictionForm.radius_m" type="number" min="50" max="2000" step="10" />
            </label>
            <label>
              <span>持续时间（小时）</span>
              <input v-model.number="restrictionForm.duration_hours" type="number" min="1" max="24" step="1" />
            </label>
            <label>
              <span>限制区名称</span>
              <input v-model.trim="restrictionForm.name" type="text" placeholder="例如：活动临时避让区" />
            </label>
          </div>
          <label class="full-safety-field">
            <span>设置原因</span>
            <textarea v-model.trim="restrictionForm.reason" rows="2" placeholder="说明活动、施工或突发情况"></textarea>
          </label>
          <div v-if="restrictionError" class="action-error" role="alert">{{ restrictionError }}</div>
          <button type="submit" class="create-restriction-btn" :disabled="safetyOperating">
            {{ safetyOperating ? '处理中…' : '创建并立即生效' }}
          </button>
        </form>

        <div class="emergency-card">
          <div class="safety-section-title">飞行安全熔断</div>
          <p>仅用于执行中任务。熔断后任务进入异常状态，无人机立即返航并释放接驳节点。</p>
          <template v-if="safetyWorkspace.active_tasks.length">
            <label>
              <span>选择执行中任务</span>
              <select v-model="selectedFuseTaskId">
                <option v-for="item in safetyWorkspace.active_tasks" :key="item.task.id" :value="item.task.id">
                  {{ item.task.origin }} → {{ item.task.destination }} · {{ statusLabel(item.task.status) }}
                </option>
              </select>
            </label>
            <label>
              <span>熔断原因</span>
              <textarea v-model.trim="fuseReason" rows="2" placeholder="必须填写安全熔断原因"></textarea>
            </label>
            <div v-if="fuseError" class="action-error" role="alert">{{ fuseError }}</div>
            <button type="button" class="emergency-stop-btn" :disabled="safetyOperating" @click="executeEmergencyStop">
              执行安全熔断并返航
            </button>
          </template>
          <div v-else class="no-active-flight">当前没有执行中的飞行任务。</div>
        </div>
      </template>
    </section>

    <AuditTrailPanel
      v-else
      ref="auditPanelRef"
      @notify="(message) => emit('notify', message)"
      @count="auditCount = $event"
    />
  </aside>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { APPROVAL_DECISION, RESTRICTION_STATUS, TASK_STATUS } from '../domain/contracts'
import { demoApi } from '../services/demoApi'
import AuditTrailPanel from './AuditTrailPanel.vue'
import AgentModelStatusCard from './AgentModelStatusCard.vue'
import RouteDecisionTraceCard from './RouteDecisionTraceCard.vue'
import RouteExplanationCard from './RouteExplanationCard.vue'
import TaskAgentAnalysisCard from './TaskAgentAnalysisCard.vue'
import { useTaskAutoRefresh } from '../composables/useTaskAutoRefresh'

const emit = defineEmits(['reviewed', 'notify', 'view-route', 'safety-updated', 'view-restriction'])

const filterOptions = Object.freeze([
  { value: 'pending', label: '待审核' },
  { value: 'all', label: '全部' },
])

const restrictionPresetDefinitions = Object.freeze([
  {
    id: 'stadium',
    label: '体育场活动区',
    anchor_label: '方肇周体育馆',
    building_name: '方肇周体育馆',
    fallback_center: { lng: 118.9510165, lat: 32.1148087, height: 0 },
  },
  {
    id: 'library',
    label: '图书馆周边',
    anchor_label: '杜厦图书馆',
    building_name: '杜厦图书馆',
    fallback_center: { lng: 118.9549885, lat: 32.1163152, height: 0 },
  },
  {
    id: 'south-gate',
    label: '南门入口周边',
    anchor_label: '南门 L1 枢纽',
    node_code: 'hub',
    fallback_center: { lng: 118.95674, lat: 32.11181, height: 0 },
  },
])

function fallbackRestrictionPresets() {
  return restrictionPresetDefinitions.map((definition) => ({
    ...definition,
    center: { ...definition.fallback_center },
  }))
}

const restrictionPresets = ref(fallbackRestrictionPresets())

const queue = ref([])
const loading = ref(false)
const reviewing = ref(false)
const loadError = ref('')
const actionError = ref('')
const filter = ref('pending')
const selectedTaskId = ref('')
const reviewReason = ref('')
const deletingTaskId = ref('')
const deleteError = ref('')
const workspaceMode = ref('review')
const auditPanelRef = ref(null)
const auditCount = ref(0)
const safetyWorkspace = ref({
  source: 'loading',
  restrictions: [],
  active_tasks: [],
  affected_routes: [],
  recent_replans: [],
  replanning_status: null,
})
const safetyLoading = ref(false)
const safetyOperating = ref(false)
const safetyError = ref('')
const restrictionError = ref('')
const deletingRestrictionId = ref('')
const restrictionDeleteError = ref('')
const fuseError = ref('')
const selectedFuseTaskId = ref('')
const fuseReason = ref('')
const replanError = ref('')
const replanningTaskId = ref('')
const restrictionForm = reactive({
  preset_id: 'stadium',
  radius_m: 150,
  duration_hours: 4,
  name: '',
  reason: '',
})

const pendingCount = computed(() => queue.value.filter((item) => item.task.status === TASK_STATUS.PENDING_REVIEW).length)
const highRiskCount = computed(() => queue.value.filter((item) => item.task.needs_manual_review).length)
const filteredQueue = computed(() => filter.value === 'pending'
  ? queue.value.filter((item) => item.task.status === TASK_STATUS.PENDING_REVIEW)
  : queue.value)
const selectedItem = computed(() => filteredQueue.value.find((item) => item.task.id === selectedTaskId.value) || filteredQueue.value[0] || null)
const requesterLabel = computed(() => {
  const requester = selectedItem.value?.task.requester || {}
  return [requester.name, requester.department].filter(Boolean).join(' · ') || '未填写'
})
const accessPointPlan = computed(() => {
  const plan = selectedItem.value?.task.agent_analysis?.access_point_plan
  return plan?.departure && plan?.receiving ? plan : null
})
const selectedRestrictionPreset = computed(() =>
  restrictionPresets.value.find((item) => item.id === restrictionForm.preset_id) || null
)
const activeRestrictions = computed(() => safetyWorkspace.value.restrictions.filter((item) => item.status === RESTRICTION_STATUS.ACTIVE))
const taskDeleteBlockedStatuses = new Set([
  TASK_STATUS.DISPATCHED,
  TASK_STATUS.IN_TRANSIT,
  TASK_STATUS.ARRIVING,
  TASK_STATUS.EXCEPTION,
])
const replanningStatus = computed(() => safetyWorkspace.value.replanning_status || {})
const replanServiceClass = computed(() => {
  if (safetyWorkspace.value.source !== 'v3') return 'mock'
  if (replanningStatus.value.processing) return 'processing'
  if (replanningStatus.value.listening) return 'online'
  return 'offline'
})
const replanServiceLabel = computed(() => {
  if (safetyWorkspace.value.source !== 'v3') return '安全管控演示模式'
  if (replanningStatus.value.processing) return '正在自动重规划'
  if (replanningStatus.value.listening) return '动态变化监听已连接'
  if (replanningStatus.value.enabled === false) return '自动重规划已关闭'
  return '动态变化监听未连接'
})
const replanServiceDetail = computed(() => {
  const result = replanningStatus.value.last_result
  if (!result) return '限制区变化后将自动检查当前航线'
  if (result.suspended_count) return `最近检查 ${result.route_count} 条航线，暂停 ${result.suspended_count} 个任务`
  return `最近检查 ${result.route_count} 条航线，重规划 ${result.replanned_count} 条`
})

let safetyRefreshTimer = null

function normalizeSafetyWorkspace(workspace) {
  return {
    source: workspace?.source || 'unknown',
    updated_at: workspace?.updated_at || new Date().toISOString(),
    restrictions: Array.isArray(workspace?.restrictions) ? workspace.restrictions : [],
    active_tasks: Array.isArray(workspace?.active_tasks) ? workspace.active_tasks : [],
    affected_routes: Array.isArray(workspace?.affected_routes) ? workspace.affected_routes : [],
    recent_replans: Array.isArray(workspace?.recent_replans) ? workspace.recent_replans : [],
    replanning_status: workspace?.replanning_status || null,
  }
}

function scheduleSafetyRefresh() {
  clearTimeout(safetyRefreshTimer)
  safetyRefreshTimer = setTimeout(() => loadSafetyWorkspace({ quiet: true }), 1400)
}

function switchWorkspaceMode(mode) {
  workspaceMode.value = mode
  if (mode === 'safety') loadSafetyWorkspace()
}

function refreshCurrentWorkspace() {
  if (workspaceMode.value === 'review') return loadQueue()
  if (workspaceMode.value === 'safety') return loadSafetyWorkspace()
  return auditPanelRef.value?.refresh()
}

watch(filteredQueue, (items) => {
  if (!items.some((item) => item.task.id === selectedTaskId.value)) {
    selectedTaskId.value = items[0]?.task.id || ''
    reviewReason.value = ''
    actionError.value = ''
  }
})

function selectTask(taskId) {
  selectedTaskId.value = taskId
  reviewReason.value = ''
  actionError.value = ''
  deleteError.value = ''
}

function taskDeleteBlocked(task) {
  return taskDeleteBlockedStatuses.has(task?.status)
}

async function deleteTask(item) {
  const task = item?.task
  if (!task?.id || deletingTaskId.value || taskDeleteBlocked(task)) return
  const confirmed = globalThis.confirm?.(
    `确定删除“${task.origin} → ${task.destination}”吗？\n\n关联航线、审批和运营记录也会被清理，此操作不可撤销。`
  )
  if (!confirmed) return

  deletingTaskId.value = task.id
  deleteError.value = ''
  try {
    await demoApi.deleteTask(task.id)
    queue.value = queue.value.filter((entry) => String(entry.task.id) !== String(task.id))
    if (String(selectedTaskId.value) === String(task.id)) selectedTaskId.value = ''
    await Promise.all([
      loadQueue({ quiet: true }),
      auditPanelRef.value?.refresh({ quiet: true }),
    ])
    emit('notify', `任务已删除：${task.origin} → ${task.destination}`)
  } catch (error) {
    deleteError.value = `任务删除失败：${error.message}`
  } finally {
    deletingTaskId.value = ''
  }
}

function statusLabel(status) {
  return {
    [TASK_STATUS.PENDING_REVIEW]: '待审核',
    [TASK_STATUS.APPROVED]: '已批准',
    [TASK_STATUS.REJECTED]: '已驳回',
    [TASK_STATUS.DISPATCHED]: '已派发',
    [TASK_STATUS.IN_TRANSIT]: '运输中',
    [TASK_STATUS.ARRIVING]: '即将到达',
    [TASK_STATUS.DELIVERED]: '已送达',
    [TASK_STATUS.EXCEPTION]: '异常',
  }[status] || status
}

function priorityLabel(priority) {
  return { normal: '普通', urgent: '紧急', emergency: '应急' }[priority] || priority || '普通'
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

function vehicleLabel(vehicleClass) {
  return { 'light-cargo': '轻型货运', 'medium-cargo': '中型货运', 'heavy-cargo': '重型货运' }[vehicleClass] || '待算法推荐'
}

function formatDateTime(value) {
  if (!value) return '未填写'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function formatDistance(meters) {
  if (!Number.isFinite(Number(meters))) return '距离待计算'
  return `${(Number(meters) / 1000).toFixed(2)} km`
}

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return '时长待计算'
  return `约 ${Math.max(1, Math.round(Number(seconds) / 60))} 分钟`
}

function formatSignedPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '待计算'
  return `${number > 0 ? '+' : ''}${number.toFixed(1)}%`
}

async function loadQueue(options = {}) {
  const quiet = options?.quiet === true
  if (!quiet) loading.value = true
  try {
    queue.value = await demoApi.listReviewTasks()
    loadError.value = ''
    if (!selectedTaskId.value) selectedTaskId.value = filteredQueue.value[0]?.task.id || ''
  } catch (error) {
    console.error('审核任务加载失败', error)
    if (!quiet || !queue.value.length) loadError.value = `审核任务加载失败：${error.message}`
  } finally {
    if (!quiet) loading.value = false
  }
}

async function submitReview(decision) {
  const item = selectedItem.value
  if (!item || reviewing.value) return
  actionError.value = ''

  if (decision === APPROVAL_DECISION.REJECTED && !reviewReason.value) {
    actionError.value = '驳回任务时必须填写原因。'
    return
  }

  reviewing.value = true
  try {
    const result = await demoApi.reviewTask(item.task.id, {
      decision,
      reason: reviewReason.value || '任务信息与安全条件符合要求。',
      reviewer: { id: 'school-reviewer-current', name: '校方审核员', department: '校园管理部门' },
    })
    const index = queue.value.findIndex((entry) => entry.task.id === item.task.id)
    if (index >= 0) queue.value.splice(index, 1, result)
    emit('reviewed', result)
    emit('notify', decision === APPROVAL_DECISION.APPROVED
      ? `任务已批准：${result.task.origin} → ${result.task.destination}`
      : `任务已驳回：${result.task.origin} → ${result.task.destination}`)
    reviewReason.value = ''
  } catch (error) {
    console.error('任务审核失败', error)
    actionError.value = `任务审核失败：${error.message}`
  } finally {
    reviewing.value = false
  }
}

async function loadSafetyWorkspace(options = {}) {
  if (!options.quiet) safetyLoading.value = true
  try {
    safetyWorkspace.value = normalizeSafetyWorkspace(await demoApi.getSafetyWorkspace())
    safetyError.value = ''
    if (!safetyWorkspace.value.active_tasks.some((item) => item.task.id === selectedFuseTaskId.value)) {
      selectedFuseTaskId.value = safetyWorkspace.value.active_tasks[0]?.task.id || ''
    }
    emit('safety-updated', safetyWorkspace.value)
  } catch (error) {
    console.error('安全管控状态加载失败', error)
    if (!options.quiet || safetyWorkspace.value.source === 'loading') {
      safetyError.value = `安全管控状态加载失败：${error.message}`
    }
  } finally {
    if (!options.quiet) safetyLoading.value = false
  }
}

async function loadRestrictionPresets() {
  try {
    const [buildings, nodes] = await Promise.all([
      demoApi.listBuildings(),
      demoApi.listFixedNodes(),
    ])
    restrictionPresets.value = restrictionPresetDefinitions.map((definition) => {
      const source = definition.building_name
        ? buildings.find((item) => item.building_name === definition.building_name)
        : nodes.find((item) => item.node_code === definition.node_code)
      const lng = Number(source?.location?.lng)
      const lat = Number(source?.location?.lat)
      return {
        ...definition,
        center: Number.isFinite(lng) && Number.isFinite(lat)
          ? { lng, lat, height: 0 }
          : { ...definition.fallback_center },
      }
    })
  } catch (error) {
    console.warn('正式限制区预设坐标加载失败，使用已校准的本地坐标', error)
    restrictionPresets.value = fallbackRestrictionPresets()
  }
}

async function submitRestriction() {
  restrictionError.value = ''
  const preset = selectedRestrictionPreset.value
  if (!preset) {
    restrictionError.value = '请选择有效的限制区域。'
    return
  }
  if (!restrictionForm.name || !restrictionForm.reason) {
    restrictionError.value = '请填写限制区名称和设置原因。'
    return
  }

  safetyOperating.value = true
  try {
    const startAt = new Date()
    const endAt = new Date(startAt.getTime() + Number(restrictionForm.duration_hours) * 60 * 60 * 1000)
    safetyWorkspace.value = normalizeSafetyWorkspace(await demoApi.createRestriction({
      name: restrictionForm.name,
      center: preset.center,
      radius_m: Number(restrictionForm.radius_m),
      reason: restrictionForm.reason,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      created_by: { id: 'school-reviewer-current', name: '校方审核员', department: '校园管理部门' },
    }))
    emit('safety-updated', safetyWorkspace.value)
    emit('notify', `临时限制区已生效，后台已开始检查航线：${restrictionForm.name}`)
    restrictionForm.name = ''
    restrictionForm.reason = ''
    scheduleSafetyRefresh()
  } catch (error) {
    restrictionError.value = `限制区创建失败：${error.message}`
  } finally {
    safetyOperating.value = false
  }
}

async function toggleRestriction(restriction) {
  safetyOperating.value = true
  safetyError.value = ''
  try {
    const nextActive = restriction.status !== RESTRICTION_STATUS.ACTIVE
    safetyWorkspace.value = normalizeSafetyWorkspace(
      await demoApi.setRestrictionActive(restriction.id, nextActive)
    )
    emit('safety-updated', safetyWorkspace.value)
    emit('notify', `${restriction.name}已${nextActive ? '启用' : '停用'}`)
    scheduleSafetyRefresh()
  } catch (error) {
    safetyError.value = `限制区状态更新失败：${error.message}`
  } finally {
    safetyOperating.value = false
  }
}

async function deleteRestriction(restriction) {
  if (!restriction?.id || deletingRestrictionId.value || safetyOperating.value) return
  const confirmed = globalThis.confirm?.(
    `确定删除临时限制区“${restriction.name}”吗？\n\n删除后该区域将不再参与航线冲突检测，此操作不可撤销。`
  )
  if (!confirmed) return

  deletingRestrictionId.value = restriction.id
  restrictionDeleteError.value = ''
  try {
    safetyWorkspace.value = normalizeSafetyWorkspace(
      await demoApi.deleteRestriction(restriction.id)
    )
    emit('safety-updated', safetyWorkspace.value)
    await auditPanelRef.value?.refresh({ quiet: true })
    emit('notify', `临时限制区已删除：${restriction.name}`)
  } catch (error) {
    restrictionDeleteError.value = `限制区删除失败：${error.message}`
  } finally {
    deletingRestrictionId.value = ''
  }
}

async function executeRouteReplan(item) {
  const conflict = item?.conflicts?.[0]
  if (!item?.task?.id || !conflict?.restriction?.id || replanningTaskId.value) return
  replanError.value = ''
  replanningTaskId.value = item.task.id
  try {
    safetyWorkspace.value = await demoApi.replanTaskRoute(item.task.id, conflict.restriction.id)
    const result = safetyWorkspace.value.recent_replans.find((entry) => entry.task?.id === item.task.id)
    emit('safety-updated', safetyWorkspace.value)
    emit('reviewed', result || safetyWorkspace.value)
    if (result) {
      emit('view-route', result)
      emit('notify', `航线已绕开${result.route.replan_summary.trigger_name}：航程${formatSignedPercent(result.route.replan_summary.distance_change_percent)}，动态风险${formatSignedPercent(result.route.replan_summary.risk_change_percent)}`)
    }
    await loadQueue()
  } catch (error) {
    replanError.value = `航线重新规划失败：${error.message}`
  } finally {
    replanningTaskId.value = ''
  }
}

async function executeEmergencyStop() {
  fuseError.value = ''
  if (!selectedFuseTaskId.value || !fuseReason.value) {
    fuseError.value = '请选择执行中任务并填写熔断原因。'
    return
  }

  safetyOperating.value = true
  try {
    safetyWorkspace.value = await demoApi.emergencyStopTask(selectedFuseTaskId.value, fuseReason.value)
    emit('safety-updated', safetyWorkspace.value)
    emit('reviewed', safetyWorkspace.value)
    emit('notify', '安全熔断已执行，无人机正在返航')
    fuseReason.value = ''
    selectedFuseTaskId.value = safetyWorkspace.value.active_tasks[0]?.task.id || ''
    await loadQueue()
  } catch (error) {
    fuseError.value = `安全熔断失败：${error.message}`
  } finally {
    safetyOperating.value = false
  }
}

async function autoRefreshWorkspace() {
  await Promise.all([
    loadQueue({ quiet: true }),
    loadSafetyWorkspace({ quiet: true }),
    auditPanelRef.value?.refresh({ quiet: true }),
  ])
}

useTaskAutoRefresh(autoRefreshWorkspace)

onMounted(() => {
  loadQueue()
  loadSafetyWorkspace()
  loadRestrictionPresets()
})

onBeforeUnmount(() => clearTimeout(safetyRefreshTimer))
</script>

<style scoped>
.school-review-panel {
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

.school-review-panel.role-panel-collapsed {
  transform: translateX(calc(100% + 32px));
  opacity: 0;
  pointer-events: none;
}

.panel-kicker { color: #64b5f6; font-size: 10px; letter-spacing: 0.16em; }
.panel-heading { display: flex; justify-content: space-between; gap: 10px; margin-top: 4px; }
.panel-heading h2 { margin: 0; font-size: 18px; }
.panel-heading p { margin: 6px 0 0; color: #b9c7d9; font-size: 11px; line-height: 1.5; }

.workspace-tabs { display: flex; gap: 5px; margin: 10px 0 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.workspace-tabs button { flex: 0 0 auto; padding: 6px 10px; color: #90a4ae; background: transparent; border: 0; border-bottom: 2px solid transparent; font-size: 11px; cursor: pointer; }
.workspace-tabs button.active { color: #e1f5fe; border-color: #4fc3f7; }
.workspace-tabs span { padding: 1px 5px; color: #301700; background: #ffb74d; border-radius: 999px; font-size: 8px; }

.refresh-btn {
  align-self: flex-start;
  padding: 5px 8px;
  color: #b3e5fc;
  background: rgba(3, 169, 244, 0.1);
  border: 1px solid rgba(79, 195, 247, 0.28);
  border-radius: 6px;
  cursor: pointer;
}

.review-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-top: 13px; }
.review-summary div { display: flex; flex-direction: column; align-items: center; padding: 8px; background: rgba(144, 202, 249, 0.07); border: 1px solid rgba(144, 202, 249, 0.12); border-radius: 8px; }
.review-summary strong { color: #81d4fa; font-size: 18px; }
.review-summary span { color: #90a4ae; font-size: 10px; }

.filter-tabs { display: flex; gap: 5px; margin: 12px 0 8px; }
.filter-tabs button { padding: 5px 10px; color: #90a4ae; background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; }
.filter-tabs button.active { color: #e1f5fe; border-color: #4fc3f7; }

.panel-state { padding: 22px 4px; color: #b0bec5; text-align: center; font-size: 12px; }
.panel-state button { margin-left: 5px; color: #81d4fa; background: none; border: 0; cursor: pointer; }
.error-state { color: #ffab91; }
.success-state { color: #a5d6a7; }

.task-queue { display: flex; gap: 7px; overflow-x: auto; padding-bottom: 7px; }
.queue-item { display: flex; align-items: stretch; min-width: 275px; color: #e7f1fb; background: rgba(4, 13, 27, 0.58); border: 1px solid rgba(144, 202, 249, 0.14); border-radius: 8px; overflow: hidden; }
.queue-item.active { border-color: rgba(79, 195, 247, 0.65); background: rgba(3, 169, 244, 0.1); }
.queue-select { display: flex; flex: 1 1 auto; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 8px 9px; color: inherit; text-align: left; background: transparent; border: 0; cursor: pointer; }
.queue-delete { flex: 0 0 auto; padding: 0 8px; color: #ffab91; background: rgba(239, 83, 80, 0.06); border: 0; border-left: 1px solid rgba(239, 83, 80, 0.18); font-size: 9px; cursor: pointer; }
.queue-delete:hover:not(:disabled) { background: rgba(239, 83, 80, 0.16); }
.queue-delete:disabled { color: #607d8b; cursor: not-allowed; }
.queue-main { display: flex; flex-direction: column; min-width: 0; }
.queue-main strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.queue-main small { margin-top: 3px; color: #78909c; font-size: 9px; }

.status-badge, .risk-badge { flex: 0 0 auto; padding: 3px 6px; border-radius: 999px; font-size: 9px; }
.status-badge.pending_review { color: #ffe082; background: rgba(255, 193, 7, 0.12); }
.status-badge.approved { color: #a5d6a7; background: rgba(102, 187, 106, 0.12); }
.status-badge.rejected { color: #ffab91; background: rgba(239, 83, 80, 0.12); }
.risk-badge { color: #ffcc80; background: rgba(255, 152, 0, 0.14); border: 1px solid rgba(255, 183, 77, 0.25); }

.review-detail { margin-top: 5px; padding-top: 11px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.detail-title-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.task-code { color: #607d8b; font-family: monospace; font-size: 9px; }
.detail-title-row h3 { margin: 3px 0 0; font-size: 15px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 11px; }
.detail-grid div { display: flex; flex-direction: column; gap: 2px; padding: 7px 8px; background: rgba(255, 255, 255, 0.035); border-radius: 6px; }
.detail-grid span, .request-quote > span, .requirement-row > span { color: #78909c; font-size: 9px; }
.detail-grid strong { overflow: hidden; color: #d7e4f1; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }

.request-quote { margin-top: 9px; padding: 8px 9px; border-left: 2px solid rgba(79, 195, 247, 0.5); background: rgba(3, 169, 244, 0.05); }
.request-quote p { margin: 3px 0 0; color: #b8c8d8; font-size: 10px; line-height: 1.45; }
.requirement-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.requirement-row i { padding: 2px 6px; color: #b3e5fc; background: rgba(3, 169, 244, 0.1); border-radius: 999px; font-size: 9px; font-style: normal; }

.risk-notice { display: flex; flex-direction: column; gap: 2px; margin-top: 9px; padding: 8px 9px; color: #ffe082; background: rgba(255, 193, 7, 0.07); border: 1px solid rgba(255, 193, 7, 0.24); border-radius: 7px; font-size: 10px; }
.risk-notice span { color: #cdbf8d; }

.access-point-card { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 9px; padding: 9px; background: rgba(38, 166, 154, 0.07); border: 1px solid rgba(77, 208, 225, 0.18); border-radius: 8px; }
.access-point-card .section-title { grid-column: 1 / -1; }
.access-point-card > div:not(.section-title) { display: flex; flex-direction: column; gap: 2px; padding: 6px 7px; background: rgba(4, 13, 27, 0.38); border-radius: 6px; }
.access-point-card span { color: #78909c; font-size: 8px; }
.access-point-card strong { color: #b2dfdb; font-size: 9px; }
.access-point-card small { color: #80cbc4; font-size: 8px; line-height: 1.35; }

.route-card { margin-top: 9px; padding: 9px; background: rgba(4, 13, 27, 0.48); border: 1px solid rgba(144, 202, 249, 0.12); border-radius: 8px; }
.section-title { color: #dbe9f7; font-size: 11px; font-weight: 700; }
.route-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.route-title-row button { padding: 4px 7px; color: #b3e5fc; background: rgba(3, 169, 244, 0.1); border: 1px solid rgba(79, 195, 247, 0.24); border-radius: 5px; font-size: 9px; cursor: pointer; }
.route-metrics { display: flex; gap: 6px; margin-top: 6px; }
.route-metrics span { padding: 3px 6px; color: #b3e5fc; background: rgba(3, 169, 244, 0.1); border-radius: 5px; font-size: 9px; }
.route-card p { margin: 5px 0 0; color: #90a4ae; font-size: 9px; line-height: 1.4; }
.route-card .muted { color: #78909c; }

.review-reason { display: flex; flex-direction: column; gap: 5px; margin-top: 9px; color: #ced9e8; font-size: 10px; }
.review-reason small { color: #78909c; }
.review-reason textarea { box-sizing: border-box; width: 100%; padding: 7px 8px; color: #f5f9ff; background: rgba(4, 13, 27, 0.72); border: 1px solid rgba(144, 202, 249, 0.2); border-radius: 7px; outline: none; resize: vertical; font: inherit; font-size: 11px; }
.review-reason textarea:focus { border-color: #64b5f6; }
.action-error { margin-top: 7px; color: #ffab91; font-size: 10px; }
.review-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
.review-actions button { padding: 7px 10px; border-radius: 7px; font-size: 10px; cursor: pointer; }
.review-actions button:disabled, .refresh-btn:disabled { opacity: 0.5; cursor: wait; }
.reject-btn { color: #ffab91; background: rgba(239, 83, 80, 0.08); border: 1px solid rgba(239, 83, 80, 0.26); }
.approve-btn { color: #062113; font-weight: 700; background: linear-gradient(135deg, #a5d6a7, #66bb6a); border: 1px solid rgba(255, 255, 255, 0.36); }

.review-result { display: flex; flex-direction: column; gap: 2px; margin-top: 10px; padding: 9px; border-radius: 7px; font-size: 10px; }
.review-result.approved { color: #c8e6c9; background: rgba(102, 187, 106, 0.09); border: 1px solid rgba(102, 187, 106, 0.22); }
.review-result.rejected { color: #ffcdd2; background: rgba(239, 83, 80, 0.08); border: 1px solid rgba(239, 83, 80, 0.2); }
.review-result small { color: #78909c; }

.safety-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
.safety-summary div { display: flex; flex-direction: column; align-items: center; padding: 8px; background: rgba(255, 152, 0, 0.06); border: 1px solid rgba(255, 183, 77, 0.13); border-radius: 8px; }
.safety-summary strong { color: #ffcc80; font-size: 18px; }
.safety-summary span { color: #90a4ae; font-size: 9px; }
.safety-section-title { color: #dbe9f7; font-size: 11px; font-weight: 700; }

.replan-service-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0 11px; padding: 8px 9px; background: rgba(144, 164, 174, 0.07); border: 1px solid rgba(144, 164, 174, 0.18); border-radius: 8px; }
.replan-service-status > div { display: flex; flex-direction: column; gap: 2px; }
.replan-service-status strong { color: #cfd8dc; font-size: 10px; }
.replan-service-status span, .replan-service-status small { color: #78909c; font-size: 8px; }
.replan-service-status.online { background: rgba(102, 187, 106, 0.07); border-color: rgba(102, 187, 106, 0.22); }
.replan-service-status.online strong { color: #a5d6a7; }
.replan-service-status.processing { background: rgba(38, 198, 218, 0.08); border-color: rgba(38, 198, 218, 0.26); }
.replan-service-status.processing strong { color: #80deea; }
.replan-service-status.offline strong { color: #ffab91; }
.replan-service-status.mock strong { color: #ffe082; }

.restriction-list { display: flex; flex-direction: column; gap: 7px; margin-top: 8px; }
.restriction-item { display: flex; align-items: center; justify-content: space-between; gap: 9px; padding: 9px; background: rgba(4, 13, 27, 0.5); border: 1px solid rgba(255, 183, 77, 0.14); border-radius: 8px; }
.restriction-item > div { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.restriction-item strong { color: #ffe0b2; font-size: 10px; }
.restriction-item span { overflow: hidden; color: #90a4ae; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.restriction-item small { color: #607d8b; font-size: 8px; }
.restriction-item button { flex: 0 0 auto; padding: 5px 7px; color: #90a4ae; background: rgba(144, 164, 174, 0.08); border: 1px solid rgba(144, 164, 174, 0.18); border-radius: 999px; font-size: 9px; cursor: pointer; }
.restriction-item button.active { color: #ffcc80; background: rgba(255, 152, 0, 0.12); border-color: rgba(255, 183, 77, 0.28); }
.restriction-actions { display: flex; flex: 0 0 auto; flex-direction: row; align-items: center; gap: 5px; }
.restriction-actions .locate-btn { color: #80deea; border-color: rgba(38, 198, 218, 0.25); }
.restriction-actions .restriction-delete-btn { color: #ffab91; background: rgba(239, 83, 80, 0.08); border-color: rgba(239, 83, 80, 0.24); }

.replan-card { margin-top: 10px; padding: 10px; background: rgba(4, 13, 27, 0.54); border: 1px solid rgba(38, 198, 218, 0.18); border-radius: 8px; }
.replan-card > p { margin: 5px 0 8px; color: #90a4ae; font-size: 9px; line-height: 1.45; }
.affected-route-list, .replan-results { display: flex; flex-direction: column; gap: 7px; }
.affected-route-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px; background: rgba(255, 112, 67, 0.07); border: 1px solid rgba(255, 112, 67, 0.2); border-radius: 7px; }
.affected-route-main { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.affected-route-main strong { color: #ffccbc; font-size: 10px; }
.affected-route-main span { overflow: hidden; color: #ffab91; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.affected-route-main small { color: #78909c; font-size: 8px; }
.replan-btn, .compare-route-btn { flex: 0 0 auto; padding: 6px 8px; color: #031f22; font-weight: 700; background: linear-gradient(135deg, #80deea, #26c6da); border: 1px solid rgba(255, 255, 255, 0.32); border-radius: 6px; font-size: 9px; cursor: pointer; }
.replan-btn:disabled { opacity: 0.5; cursor: wait; }
.route-clear { padding: 8px; color: #a5d6a7; background: rgba(102, 187, 106, 0.06); border-radius: 6px; text-align: center; font-size: 9px; }
.replan-results { margin-top: 9px; padding-top: 8px; border-top: 1px solid rgba(144, 202, 249, 0.12); }
.result-title { color: #80deea; font-size: 9px; font-weight: 700; }
.replan-result-item { padding: 8px; background: rgba(38, 198, 218, 0.06); border: 1px solid rgba(38, 198, 218, 0.15); border-radius: 7px; }
.replan-result-item > div:first-child { display: flex; justify-content: space-between; gap: 7px; color: #dbe9f7; font-size: 9px; }
.replan-result-item > div:first-child span { color: #80cbc4; }
.replan-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin: 7px 0; }
.replan-metrics div { display: flex; flex-direction: column; align-items: center; padding: 5px; background: rgba(4, 13, 27, 0.45); border-radius: 5px; }
.replan-metrics strong { color: #80deea; font-size: 11px; }
.replan-metrics span { color: #78909c; font-size: 8px; }
.compare-route-btn { display: block; margin-left: auto; color: #dffcff; background: rgba(38, 198, 218, 0.12); border-color: rgba(38, 198, 218, 0.28); }

.restriction-form, .emergency-card { margin-top: 10px; padding: 10px; background: rgba(4, 13, 27, 0.48); border: 1px solid rgba(144, 202, 249, 0.12); border-radius: 8px; }
.safety-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 8px; }
.safety-form-grid label, .full-safety-field, .emergency-card label { display: flex; flex-direction: column; gap: 4px; color: #90a4ae; font-size: 9px; }
.safety-form-grid input, .safety-form-grid select, .full-safety-field textarea, .emergency-card select, .emergency-card textarea { box-sizing: border-box; width: 100%; padding: 7px 8px; color: #f5f9ff; background: rgba(4, 13, 27, 0.75); border: 1px solid rgba(144, 202, 249, 0.2); border-radius: 6px; outline: none; font: inherit; font-size: 10px; }
.restriction-location-hint { color: #607d8b; font-size: 8px; line-height: 1.35; }
.full-safety-field { margin-top: 7px; }
.full-safety-field textarea, .emergency-card textarea { resize: vertical; }
.create-restriction-btn { display: block; margin: 8px 0 0 auto; padding: 7px 9px; color: #271300; font-weight: 700; background: linear-gradient(135deg, #ffcc80, #ffb74d); border: 1px solid rgba(255, 255, 255, 0.32); border-radius: 6px; font-size: 9px; cursor: pointer; }

.emergency-card { border-color: rgba(239, 83, 80, 0.2); }
.emergency-card p { margin: 5px 0 8px; color: #90a4ae; font-size: 9px; line-height: 1.45; }
.emergency-card label + label { margin-top: 7px; }
.emergency-stop-btn { display: block; margin: 8px 0 0 auto; padding: 7px 9px; color: #fff; font-weight: 700; background: linear-gradient(135deg, #ef5350, #c62828); border: 1px solid rgba(255, 205, 210, 0.32); border-radius: 6px; font-size: 9px; cursor: pointer; }
.create-restriction-btn:disabled, .emergency-stop-btn:disabled, .restriction-item button:disabled { opacity: 0.5; cursor: wait; }
.no-active-flight { padding: 10px 0 2px; color: #78909c; text-align: center; font-size: 9px; }

@media (max-width: 980px) {
  .school-review-panel { right: 10px; width: 370px; }
}
</style>
