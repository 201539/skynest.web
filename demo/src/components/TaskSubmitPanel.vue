<template>
  <aside class="task-submit-panel">
    <div class="panel-kicker">STUDENT WORKSPACE</div>
    <h2>师生任务中心</h2>
    <p class="panel-description">
      提交校园运输需求，并实时查看校方审核、运营派发和交付进度。
    </p>

    <div class="workspace-tabs" role="tablist" aria-label="师生任务功能">
      <button type="button" :class="{ active: workspaceTab === 'submit' }" @click="switchWorkspaceTab('submit')">提交任务</button>
      <button type="button" :class="{ active: workspaceTab === 'tracking' }" @click="switchWorkspaceTab('tracking')">
        我的任务 <span v-if="studentTasks.length">{{ studentTasks.length }}</span>
      </button>
    </div>

    <form v-if="workspaceTab === 'submit'" novalidate @submit.prevent="submitTask">
      <div v-if="editingRejectedTaskId" class="resubmit-banner" role="status">
        <div>
          <strong>正在修改已驳回任务</strong>
          <span>任务 #{{ editingRejectedTaskId }} · 请根据校方意见修改后重新提交</span>
        </div>
        <button type="button" :disabled="submitting" @click="cancelRejectedTaskEdit">取消修改</button>
      </div>
      <label class="form-field full-span">
        <span>自然语言需求 <small>选填</small></span>
        <textarea
          v-model.trim="form.input_text"
          rows="3"
          placeholder="例如：下午4点前，把2公斤实验材料从环境学院送到二期实验楼，需要防震。"
          @input="clearParseFeedback"
        ></textarea>
        <div class="agent-actions">
          <span>支持识别地点、物品、重量、时限和特殊要求</span>
          <button
            type="button"
            class="agent-btn"
            :disabled="parsing || !form.input_text"
            @click="parseTaskInput"
          >
            {{ parsing ? '解析中…' : '智能解析并回填' }}
          </button>
        </div>
      </label>

      <div v-if="parseFeedback" class="parse-feedback" :class="parseFeedback.tone" aria-live="polite">
        <strong>{{ parseFeedback.title }}</strong>
        <span>{{ parseFeedback.message }}</span>
        <div v-if="parsedFieldLabels.length" class="parsed-fields">
          <i v-for="label in parsedFieldLabels" :key="label">{{ label }}</i>
        </div>
      </div>

      <section
        v-if="agentAnalysis"
        :class="['agent-analysis-card', confidenceTone]"
        aria-label="Agent需求理解说明"
      >
        <div class="agent-analysis-heading">
          <div>
            <span>SKYNEST AGENT</span>
            <strong>需求理解说明</strong>
          </div>
          <div class="agent-heading-badges">
            <em>{{ agentModeLabel }}</em>
            <b>{{ confidenceScore }}% · {{ confidenceLabel }}</b>
          </div>
        </div>

        <div class="confidence-track" aria-hidden="true">
          <i :style="{ width: `${confidenceScore}%` }"></i>
        </div>
        <small class="confidence-note">置信度表示解析把握，不代表运输任务的安全评分。</small>

        <p class="agent-explanation">{{ agentAnalysis.explanation }}</p>

        <div v-if="agentAnalysis.reasoning?.length" class="agent-reasoning">
          <span>识别依据</span>
          <ul>
            <li v-for="reason in agentAnalysis.reasoning" :key="reason">{{ reason }}</li>
          </ul>
        </div>

        <div v-if="agentAnalysis.manual_review_reasons?.length" class="manual-review-prompt">
          <strong>需要重点核对</strong>
          <span v-for="reason in agentAnalysis.manual_review_reasons" :key="reason">{{ reason }}</span>
        </div>

        <div class="agent-confirmation">
          <span>
            {{ analysisChanged
              ? '表单内容已修改，请按最终内容重新确认。'
              : agentAnalysis.confirmation_prompt }}
          </span>
          <button
            type="button"
            :class="{ confirmed: agentConfirmed }"
            :aria-pressed="agentConfirmed"
            @click="confirmAgentResult"
          >
            {{ agentConfirmed ? '✓ 已人工确认' : '确认解析无误' }}
          </button>
        </div>
      </section>

      <div class="form-grid">
        <label class="form-field">
          <span>申请人</span>
          <input v-model.trim="form.requester.name" type="text" readonly />
        </label>

        <label class="form-field">
          <span>所属部门</span>
          <input v-model.trim="form.requester.department" type="text" readonly />
        </label>

        <BuildingSearchField
          v-model="form.origin"
          label="起点建筑"
          placeholder="输入关键词，如：环境学院"
          :buildings="buildings"
          :loading="buildingsLoading"
          :load-error="buildingsError"
          :error="errors.origin"
          :access-point="originAccessPoint"
          :access-loading="originAccessLoading"
          access-role="departure"
          :exclude-name="form.destination"
          @select="(building) => handleBuildingSelection('origin', building)"
        />

        <BuildingSearchField
          v-model="form.destination"
          label="终点建筑"
          placeholder="输入关键词，如：杜厦图书馆"
          :buildings="buildings"
          :loading="buildingsLoading"
          :load-error="buildingsError"
          :error="errors.destination"
          :access-point="destinationAccessPoint"
          :access-loading="destinationAccessLoading"
          access-role="receiving"
          :exclude-name="form.origin"
          @select="(building) => handleBuildingSelection('destination', building)"
        />

        <div v-if="buildingsError" class="building-library-error full-span" role="alert">
          <span>正式建筑库暂时不可用，任务无法提交，避免使用错误坐标。</span>
          <button type="button" :disabled="buildingsLoading" @click="loadBuildings">重新加载</button>
        </div>

        <label class="form-field">
          <span>物品类型 <b>*</b></span>
          <select v-model="form.item_category" @change="markAnalysisChanged">
            <option disabled value="">请选择</option>
            <option v-for="item in itemCategories" :key="item" :value="item">{{ item }}</option>
          </select>
          <em v-if="errors.item_category">{{ errors.item_category }}</em>
        </label>

        <label class="form-field">
          <span>重量（kg） <b>*</b></span>
          <input v-model.number="form.weight_kg" type="number" min="0.01" step="0.1" placeholder="例如：2" @input="markAnalysisChanged" />
          <em v-if="errors.weight_kg">{{ errors.weight_kg }}</em>
        </label>

        <label class="form-field full-span">
          <span>送达时限 <b>*</b></span>
          <input v-model="form.deadline" type="datetime-local" @change="markAnalysisChanged" />
          <em v-if="errors.deadline">{{ errors.deadline }}</em>
        </label>

        <label class="form-field">
          <span>优先级</span>
          <select v-model="form.priority" @change="markAnalysisChanged">
            <option value="normal">普通</option>
            <option value="urgent">紧急</option>
            <option value="emergency">应急</option>
          </select>
        </label>

        <label class="form-field">
          <span>特殊要求 <small>选填</small></span>
          <input v-model.trim="specialRequirementsText" type="text" placeholder="防震、冷链；用逗号分隔" @input="markAnalysisChanged" />
        </label>
      </div>

      <div v-if="requiresManualReview" class="risk-notice" role="status">
        <strong>需要人工审核</strong>
        <span>该物品属于高风险或待确认类型，提交后不会自动进入航线计算。</span>
      </div>

      <div v-if="formError" class="form-error" role="alert">{{ formError }}</div>

      <div class="form-actions">
        <button type="button" class="secondary-btn" :disabled="submitting" @click="resetForm">{{ editingRejectedTaskId ? '恢复原内容' : '清空' }}</button>
        <button type="submit" class="primary-btn" :disabled="submitting">
          {{ submitting ? '提交中…' : editingRejectedTaskId ? '保存修改并重新提交' : '提交运输任务' }}
        </button>
      </div>
    </form>

    <div v-if="workspaceTab === 'submit' && lastSubmitted" class="submit-result" aria-live="polite">
      <div class="result-icon">✓</div>
      <div>
        <strong>任务已进入校方审核</strong>
        <p>{{ lastSubmitted.origin }} → {{ lastSubmitted.destination }}</p>
        <code>{{ lastSubmitted.id }}</code>
      </div>
    </div>

    <section v-if="workspaceTab === 'tracking'" class="tracking-workspace">
      <div class="tracking-toolbar">
        <span>任务状态会随校方和运营商操作自动更新</span>
        <button type="button" :disabled="tasksLoading" @click="loadStudentTasks">刷新</button>
      </div>

      <div v-if="tasksLoading" class="tracking-state">正在读取任务进度…</div>
      <div v-else-if="tasksError" class="tracking-state error-state">
        {{ tasksError }}
        <button type="button" @click="loadStudentTasks">重新加载</button>
      </div>
      <div v-else-if="!studentTasks.length" class="tracking-state">尚未提交运输任务。</div>

      <template v-else>
        <div class="student-task-list" aria-label="我的运输任务">
          <button
            v-for="item in studentTasks"
            :key="item.task.id"
            type="button"
            :class="['student-task-item', { active: selectedTaskId === item.task.id }]"
            @click="selectedTaskId = item.task.id"
          >
            <span>
              <strong>{{ item.task.origin }} → {{ item.task.destination }}</strong>
              <small>{{ formatDateTime(item.task.created_at) }} · {{ item.task.item_category }}</small>
            </span>
            <i :class="item.task.status">{{ statusLabel(item.task.status) }}</i>
          </button>
        </div>

        <div v-if="selectedStudentTask" class="tracking-detail">
          <div class="tracking-heading">
            <div>
              <span>{{ selectedStudentTask.task.id }}</span>
              <h3>{{ selectedStudentTask.task.origin }} → {{ selectedStudentTask.task.destination }}</h3>
            </div>
            <b :class="selectedStudentTask.task.status">{{ statusLabel(selectedStudentTask.task.status) }}</b>
          </div>

          <div v-if="isNormalProgress" class="tracking-progress" aria-label="运输任务进度">
            <div
              v-for="(step, index) in trackingSteps"
              :key="step.status"
              :class="{ done: index < currentTrackingStepIndex, current: index === currentTrackingStepIndex }"
            >
              <i>{{ index + 1 }}</i>
              <span>{{ step.label }}</span>
            </div>
          </div>

          <div :class="['current-status-card', selectedStudentTask.task.status]">
            <strong>{{ statusLabel(selectedStudentTask.task.status) }}</strong>
            <span>{{ statusDescription(selectedStudentTask.task.status, selectedStudentTask.task.exception_reason) }}</span>
          </div>

          <div class="tracking-grid">
            <div><span>物品</span><strong>{{ selectedStudentTask.task.item_category }} · {{ selectedStudentTask.task.weight_kg }}kg</strong></div>
            <div><span>送达时限</span><strong>{{ formatDateTime(selectedStudentTask.task.deadline) }}</strong></div>
            <div><span>执行无人机</span><strong>{{ selectedStudentTask.assigned_drone?.name || '尚未分配' }}</strong></div>
            <div><span>接驳节点</span><strong>{{ selectedStudentTask.assigned_node?.name || '尚未分配' }}</strong></div>
          </div>

          <div v-if="selectedStudentTask.approval" class="approval-card">
            <span>校方审核意见</span>
            <strong>{{ approvalDecisionLabel(selectedStudentTask.approval.decision) }}</strong>
            <p>{{ selectedStudentTask.approval.reason || '暂无补充意见' }}</p>
          </div>

          <div v-if="selectedStudentTask.task.status === TASK_STATUS.REJECTED" class="rejected-task-actions">
            <span>原任务和驳回意见会保留，修改后将使用同一任务编号重新进入审核。</span>
            <button type="button" @click="editRejectedTask(selectedStudentTask)">修改并重新提交</button>
          </div>

          <div v-if="selectedStudentTask.route" class="student-route-card">
            <div class="student-route-heading">
              <span>运输航线</span>
              <button
                type="button"
                @click="emit('view-route', { route: selectedStudentTask.route, task: selectedStudentTask.task })"
              >
                在地图中查看
              </button>
            </div>
              <div>
                <i>{{ selectedStudentTask.route.algorithm }}</i>
                <i>{{ selectedStudentTask.route.waypoints?.length || 0 }} 个航点</i>
                <i>{{ formatDistance(selectedStudentTask.route.total_length_meters) }}</i>
                <i>{{ formatDuration(selectedStudentTask.route.estimated_duration_seconds) }}</i>
              </div>
              <RouteExplanationCard :explanation="selectedStudentTask.route.explanation" />
              <RouteDecisionTraceCard :route="selectedStudentTask.route" />
            </div>
        </div>
      </template>
    </section>
  </aside>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { APPROVAL_DECISION, TASK_STATUS, createTransportTask, validateTransportTask } from '../domain/contracts'
import { HIGH_RISK_CATEGORIES, TASK_ITEM_CATEGORIES } from '../domain/taskParser'
import { demoApi } from '../services/demoApi'
import { findExactBuilding as findExactBuildingInList } from '../utils/buildingSearch'
import RouteDecisionTraceCard from './RouteDecisionTraceCard.vue'
import RouteExplanationCard from './RouteExplanationCard.vue'
import BuildingSearchField from './BuildingSearchField.vue'

const emit = defineEmits(['submitted', 'notify', 'view-route'])
const props = defineProps({
  currentUser: { type: Object, required: true },
})

const itemCategories = TASK_ITEM_CATEGORIES
const highRiskCategories = HIGH_RISK_CATEGORIES

const taskFieldLabels = Object.freeze({
  origin: '起点',
  destination: '终点',
  item_category: '物品类型',
  weight_kg: '重量',
  deadline: '送达时限',
  priority: '优先级',
  special_requirements: '特殊要求',
})

const trackingSteps = Object.freeze([
  { status: TASK_STATUS.PENDING_REVIEW, label: '审核' },
  { status: TASK_STATUS.APPROVED, label: '批准' },
  { status: TASK_STATUS.DISPATCHED, label: '派发' },
  { status: TASK_STATUS.IN_TRANSIT, label: '运输' },
  { status: TASK_STATUS.ARRIVING, label: '到达' },
  { status: TASK_STATUS.DELIVERED, label: '交付' },
])

function createEmptyForm(requester = {}) {
  return createTransportTask({
    requester: {
      id: requester.id || '',
      name: requester.name || '',
      department: requester.department || '',
    },
  })
}

const form = reactive(createEmptyForm(props.currentUser))
const errors = reactive({})
const specialRequirementsText = ref('')
const submitting = ref(false)
const parsing = ref(false)
const formError = ref('')
const lastSubmitted = ref(null)
const parseFeedback = ref(null)
const parsedFieldLabels = ref([])
const agentAnalysis = ref(null)
const agentConfirmed = ref(false)
const agentConfirmedAt = ref(null)
const analysisChanged = ref(false)
const workspaceTab = ref('submit')
const studentWorkspace = ref({ tasks: [] })
const tasksLoading = ref(false)
const tasksError = ref('')
const selectedTaskId = ref('')
const editingRejectedTaskId = ref(null)
const rejectedTaskSnapshot = ref(null)
const buildings = ref([])
const buildingsLoading = ref(false)
const buildingsError = ref('')
const originBuilding = ref(null)
const destinationBuilding = ref(null)
const originAccessPoint = ref(null)
const destinationAccessPoint = ref(null)
const originAccessLoading = ref(false)
const destinationAccessLoading = ref(false)
let originAccessRequest = 0
let destinationAccessRequest = 0

const requiresManualReview = computed(() => highRiskCategories.has(form.item_category))
const confidenceScore = computed(() => Math.max(0, Math.min(100, Number(agentAnalysis.value?.confidence_score) || 0)))
const confidenceTone = computed(() => agentAnalysis.value?.confidence_level || 'low')
const confidenceLabel = computed(() => ({
  high: '高置信度',
  medium: '中等置信度',
  low: '低置信度',
}[confidenceTone.value] || '待确认'))
const agentModeLabel = computed(() => agentAnalysis.value?.ai?.mode_label || '本地规则解析')
const studentTasks = computed(() => studentWorkspace.value.tasks || [])
const selectedStudentTask = computed(() => studentTasks.value.find((item) => item.task.id === selectedTaskId.value) || studentTasks.value[0] || null)
const currentTrackingStepIndex = computed(() => Math.max(0, trackingSteps.findIndex((step) => step.status === selectedStudentTask.value?.task.status)))
const isNormalProgress = computed(() => ![
  TASK_STATUS.REJECTED,
  TASK_STATUS.CANCELLED,
  TASK_STATUS.EXCEPTION,
].includes(selectedStudentTask.value?.task.status))

function switchWorkspaceTab(tab) {
  workspaceTab.value = tab
  if (tab === 'tracking') loadStudentTasks()
}

async function loadStudentTasks() {
  tasksLoading.value = true
  tasksError.value = ''
  try {
    studentWorkspace.value = await demoApi.getStudentWorkspace()
    if (!studentTasks.value.some((item) => item.task.id === selectedTaskId.value)) {
      selectedTaskId.value = studentTasks.value[0]?.task.id || ''
    }
  } catch (error) {
    console.error('学生任务进度加载失败', error)
    tasksError.value = `任务进度加载失败：${error.message}`
  } finally {
    tasksLoading.value = false
  }
}

function statusLabel(status) {
  return {
    [TASK_STATUS.PENDING_REVIEW]: '等待审核',
    [TASK_STATUS.APPROVED]: '已批准',
    [TASK_STATUS.REJECTED]: '已驳回',
    [TASK_STATUS.DISPATCHED]: '已派发',
    [TASK_STATUS.IN_TRANSIT]: '运输中',
    [TASK_STATUS.ARRIVING]: '即将交付',
    [TASK_STATUS.DELIVERED]: '已送达',
    [TASK_STATUS.EXCEPTION]: '运输异常',
    [TASK_STATUS.CANCELLED]: '已取消',
  }[status] || status
}

function statusDescription(status, exceptionReason = '') {
  return {
    [TASK_STATUS.PENDING_REVIEW]: '任务已提交，正在等待校方审核。',
    [TASK_STATUS.APPROVED]: '校方已批准，正在等待运营商接收。',
    [TASK_STATUS.REJECTED]: '校方未批准该任务，请根据审核意见修改后重新提交。',
    [TASK_STATUS.DISPATCHED]: '运营商已分配无人机和接驳节点。',
    [TASK_STATUS.IN_TRANSIT]: '无人机正在执行运输任务。',
    [TASK_STATUS.ARRIVING]: '无人机已到达接驳节点，请准备接收。',
    [TASK_STATUS.DELIVERED]: '运输任务已完成交付。',
    [TASK_STATUS.EXCEPTION]: exceptionReason
      ? `校方已执行安全熔断：${exceptionReason}`
      : '运输过程中出现异常，请等待运营商处理。',
    [TASK_STATUS.CANCELLED]: '该运输任务已经取消。',
  }[status] || '任务状态已更新。'
}

function approvalDecisionLabel(decision) {
  return {
    [APPROVAL_DECISION.PENDING]: '等待审核',
    [APPROVAL_DECISION.APPROVED]: '审核通过',
    [APPROVAL_DECISION.REJECTED]: '审核驳回',
  }[decision] || decision
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
  return Number.isFinite(Number(meters)) ? `${(Number(meters) / 1000).toFixed(2)} km` : '距离待计算'
}

function formatDuration(seconds) {
  return Number.isFinite(Number(seconds)) ? `约 ${Math.max(1, Math.round(Number(seconds) / 60))} 分钟` : '时长待计算'
}

function clearErrors() {
  Object.keys(errors).forEach((key) => delete errors[key])
  formError.value = ''
}

function clearParseFeedback() {
  parseFeedback.value = null
  parsedFieldLabels.value = []
  agentAnalysis.value = null
  agentConfirmed.value = false
  agentConfirmedAt.value = null
  analysisChanged.value = false
}

function markAnalysisChanged() {
  if (!agentAnalysis.value) return
  analysisChanged.value = true
  agentConfirmed.value = false
  agentConfirmedAt.value = null
}

function confirmAgentResult() {
  if (!agentAnalysis.value) return
  agentConfirmed.value = true
  agentConfirmedAt.value = new Date().toISOString()
  analysisChanged.value = false
  emit('notify', 'Agent解析结果已由申请人确认')
}

function normalizeDeadlineForInput(value) {
  if (!value) return ''
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/)
  return match?.[1] || ''
}

function getRecognizedFields(parsed) {
  return Object.entries(taskFieldLabels)
    .filter(([field]) => {
      const value = parsed[field]
      return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== ''
    })
    .map(([, label]) => label)
}

function findExactBuilding(name) {
  return findExactBuildingInList(buildings.value, name)
}

async function loadBuildings() {
  buildingsLoading.value = true
  buildingsError.value = ''
  try {
    buildings.value = await demoApi.listBuildings()
    if (buildings.value.length !== 83) {
      throw new Error(`建筑数量异常：应为83栋，实际返回${buildings.value.length}栋`)
    }
    await Promise.all([
      restoreBuildingSelection('origin'),
      restoreBuildingSelection('destination'),
    ])
  } catch (error) {
    console.error('正式建筑库加载失败', error)
    buildings.value = []
    buildingsError.value = error.message || '请检查后端和数据库迁移'
  } finally {
    buildingsLoading.value = false
  }
}

async function restoreBuildingSelection(field) {
  const building = findExactBuilding(form[field])
  if (!building) return
  await handleBuildingSelection(field, building, { preserveAnalysis: true })
}

async function handleBuildingSelection(field, building, options = {}) {
  const isOrigin = field === 'origin'
  const buildingRef = isOrigin ? originBuilding : destinationBuilding
  const accessRef = isOrigin ? originAccessPoint : destinationAccessPoint
  const loadingRef = isOrigin ? originAccessLoading : destinationAccessLoading
  const requestNumber = isOrigin ? ++originAccessRequest : ++destinationAccessRequest

  buildingRef.value = building
  accessRef.value = null
  loadingRef.value = false
  delete errors[field]
  if (!options.preserveAnalysis) markAnalysisChanged()
  if (!building) return

  form[field] = building.building_name
  loadingRef.value = true
  try {
    const access = await demoApi.getBuildingAccessPoints(building.building_name, 3)
    const latestRequest = isOrigin ? originAccessRequest : destinationAccessRequest
    if (requestNumber !== latestRequest) return
    accessRef.value = isOrigin ? access.departure_nodes?.[0] || null : access.receiving_nodes?.[0] || null
    if (!accessRef.value) {
      errors[field] = isOrigin ? '该建筑没有可用起飞节点' : '该建筑没有可用L3接驳箱'
    }
  } catch (error) {
    const latestRequest = isOrigin ? originAccessRequest : destinationAccessRequest
    if (requestNumber !== latestRequest) return
    errors[field] = `节点匹配失败：${error.message}`
  } finally {
    const latestRequest = isOrigin ? originAccessRequest : destinationAccessRequest
    if (requestNumber === latestRequest) loadingRef.value = false
  }
}

async function applyParsedLocation(field, value) {
  if (!value) return
  form[field] = value
  const exact = findExactBuilding(value)
  await handleBuildingSelection(field, exact, { preserveAnalysis: true })
}

async function parseTaskInput() {
  if (parsing.value || !form.input_text) return

  parsing.value = true
  clearErrors()
  clearParseFeedback()

  try {
    const parsed = await demoApi.parseTask(form.input_text)
    await Promise.all([
      applyParsedLocation('origin', parsed.origin),
      applyParsedLocation('destination', parsed.destination),
    ])
    if (parsed.item_category) form.item_category = parsed.item_category
    if (parsed.weight_kg !== null && parsed.weight_kg !== undefined) form.weight_kg = parsed.weight_kg
    if (parsed.deadline) form.deadline = normalizeDeadlineForInput(parsed.deadline)
    if (parsed.priority) form.priority = parsed.priority
    if (parsed.special_requirements?.length) {
      specialRequirementsText.value = parsed.special_requirements.join('、')
    }

    parsedFieldLabels.value = getRecognizedFields(parsed)
    const mergedValidation = validateTransportTask(form)
    const missingLabels = mergedValidation.missing_fields.map((field) => taskFieldLabels[field] || field)
    agentAnalysis.value = parsed.agent_analysis || {
      source: 'agent-adapter',
      confidence_score: Math.round(35 + (parsedFieldLabels.value.length / 7) * 55),
      confidence_level: missingLabels.length ? 'medium' : 'high',
      explanation: 'Agent已返回结构化任务信息，请结合回填表单核对起终点、物品、重量和送达时限。',
      reasoning: parsedFieldLabels.value.map((label) => `已识别：${label}`),
      recognized_fields: parsedFieldLabels.value,
      uncertain_fields: missingLabels,
      manual_review_reasons: missingLabels.length ? [`仍需补充或核对：${missingLabels.join('、')}`] : [],
      confirmation_required: true,
      confirmation_prompt: '请核对回填表单，确认无误后再提交任务。',
    }
    agentConfirmed.value = false
    agentConfirmedAt.value = null
    analysisChanged.value = false

    parseFeedback.value = missingLabels.length
      ? {
          tone: 'warning',
          title: '已完成初步解析',
          message: `还需手动补充：${missingLabels.join('、')}。`,
        }
      : {
          tone: 'success',
          title: '解析完成',
          message: '必填信息已补齐，请核对无误后提交。',
        }

    emit('notify', missingLabels.length ? '需求已解析，请补充未识别字段' : '需求解析完成，请核对后提交')
  } catch (error) {
    console.error('任务解析失败', error)
    parseFeedback.value = {
      tone: 'error',
      title: '解析失败',
      message: error.message || '请稍后重试，或直接手动填写表单。',
    }
  } finally {
    parsing.value = false
  }
}

function normalizeRequirements() {
  return specialRequirementsText.value
    .split(/[，,、]/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function fillFormFromTask(task) {
  Object.assign(form, createEmptyForm(props.currentUser), {
    ...task,
    id: task.id,
    requester: { ...props.currentUser },
    deadline: normalizeDeadlineForInput(task.deadline),
    special_requirements: Array.isArray(task.special_requirements) ? [...task.special_requirements] : [],
    candidate_node_ids: Array.isArray(task.candidate_node_ids) ? [...task.candidate_node_ids] : [],
    missing_fields: [],
  })
  specialRequirementsText.value = (task.special_requirements || []).join('、')
  agentAnalysis.value = task.agent_analysis || null
  agentConfirmed.value = false
  agentConfirmedAt.value = null
  analysisChanged.value = Boolean(agentAnalysis.value)
  parseFeedback.value = null
  parsedFieldLabels.value = []
  clearErrors()
  Promise.all([
    restoreBuildingSelection('origin'),
    restoreBuildingSelection('destination'),
  ]).catch((error) => console.warn('恢复建筑选择失败', error))
}

function editRejectedTask(item) {
  if (!item || item.task.status !== TASK_STATUS.REJECTED) return
  editingRejectedTaskId.value = item.task.id
  rejectedTaskSnapshot.value = {
    ...item.task,
    requester: { ...item.task.requester },
    special_requirements: [...(item.task.special_requirements || [])],
    candidate_node_ids: [...(item.task.candidate_node_ids || [])],
  }
  fillFormFromTask(item.task)
  lastSubmitted.value = null
  workspaceTab.value = 'submit'
  emit('notify', `已载入任务 #${item.task.id}，请根据审核意见修改`)
}

function cancelRejectedTaskEdit() {
  editingRejectedTaskId.value = null
  rejectedTaskSnapshot.value = null
  resetForm({ preserveRequester: true, forceEmpty: true })
}

function validateForm() {
  clearErrors()
  const result = validateTransportTask(form)
  const labels = {
    origin: '请填写起点',
    destination: '请填写终点',
    item_category: '请选择物品类型',
    weight_kg: '请填写重量',
    deadline: '请选择送达时限',
  }

  result.missing_fields.forEach((field) => {
    errors[field] = labels[field] || '该字段不能为空'
  })

  if (form.weight_kg !== null && form.weight_kg !== '' && Number(form.weight_kg) <= 0) {
    errors.weight_kg = '重量必须大于0'
  }
  if (form.origin && form.destination && form.origin === form.destination) {
    errors.destination = '终点不能与起点相同'
  }
  if (buildingsError.value || buildings.value.length !== 83) {
    formError.value = '正式建筑库尚未加载完成，暂不能提交任务。'
  } else {
    if (!findExactBuilding(form.origin)) errors.origin = '请从83栋正式建筑中选择起点'
    if (!findExactBuilding(form.destination)) errors.destination = '请从83栋正式建筑中选择终点'
    if (findExactBuilding(form.origin) && !originAccessPoint.value) errors.origin = '起点的可用起飞节点尚未确认'
    if (findExactBuilding(form.destination) && !destinationAccessPoint.value) errors.destination = '终点的L3接驳箱尚未确认'
  }

  if (agentAnalysis.value && !agentConfirmed.value) {
    formError.value = confidenceTone.value === 'low'
      ? 'Agent对此需求的置信度较低，请补充信息并人工确认解析结果。'
      : '请先人工确认Agent解析结果，再提交运输任务。'
  }

  const fieldsValid = Object.keys(errors).length === 0
  const valid = fieldsValid && (!agentAnalysis.value || agentConfirmed.value)
  if (!fieldsValid) formError.value = '请补全标记为必填的任务信息。'
  return valid
}

async function submitTask() {
  if (submitting.value || !validateForm()) return
  submitting.value = true
  formError.value = ''

  const payload = createTransportTask({
    ...form,
    requester: { ...form.requester },
    weight_kg: Number(form.weight_kg),
    special_requirements: normalizeRequirements(),
    safety_level: requiresManualReview.value ? 'high' : 'normal',
    needs_manual_review: requiresManualReview.value,
    missing_fields: [],
    agent_analysis: agentAnalysis.value
      ? {
          ...agentAnalysis.value,
          user_confirmed: agentConfirmed.value,
          confirmed_at: agentConfirmedAt.value,
        }
      : null,
  })

  try {
    const editingTaskId = editingRejectedTaskId.value
    const result = editingTaskId
      ? await demoApi.resubmitRejectedTask(editingTaskId, payload)
      : await demoApi.submitTask(payload)
    const saved = result.task || result
    lastSubmitted.value = saved
    selectedTaskId.value = saved.id
    await loadStudentTasks()
    emit('submitted', saved)
    emit('notify', editingTaskId
      ? `任务已修改并重新提交：${saved.origin} → ${saved.destination}`
      : `运输任务已提交：${saved.origin} → ${saved.destination}`)
    editingRejectedTaskId.value = null
    rejectedTaskSnapshot.value = null
    resetForm({ preserveResult: true, preserveRequester: true })
  } catch (error) {
    console.error('任务提交失败', error)
    formError.value = `任务提交失败：${error.message}`
  } finally {
    submitting.value = false
  }
}

function resetForm(options = {}) {
  if (editingRejectedTaskId.value && rejectedTaskSnapshot.value && !options.forceEmpty) {
    fillFormFromTask(rejectedTaskSnapshot.value)
    return
  }
  // 让重置前尚未返回的接入点请求失效，避免旧结果回填到空表单。
  originAccessRequest += 1
  destinationAccessRequest += 1
  const requester = options.preserveRequester ? { ...form.requester } : {}
  Object.assign(form, createEmptyForm(requester))
  originBuilding.value = null
  destinationBuilding.value = null
  originAccessPoint.value = null
  destinationAccessPoint.value = null
  originAccessLoading.value = false
  destinationAccessLoading.value = false
  specialRequirementsText.value = ''
  clearErrors()
  clearParseFeedback()
  if (!options.preserveResult) lastSubmitted.value = null
}

onMounted(() => Promise.all([loadStudentTasks(), loadBuildings()]))
</script>

<style scoped>
.task-submit-panel {
  position: absolute;
  top: 62px;
  right: 16px;
  width: 420px;
  max-height: calc(100vh - 82px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 17px;
  color: #edf5ff;
  background: linear-gradient(155deg, rgba(12, 28, 52, 0.96), rgba(16, 24, 40, 0.92));
  border: 1px solid rgba(144, 202, 249, 0.28);
  border-radius: 14px;
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(12px);
  z-index: 998;
  transition: transform 220ms ease, opacity 180ms ease;
  will-change: transform;
}

.task-submit-panel.role-panel-collapsed {
  transform: translateX(calc(100% + 32px));
  opacity: 0;
  pointer-events: none;
}

.panel-kicker {
  margin-bottom: 4px;
  color: #64b5f6;
  font-size: 10px;
  letter-spacing: 0.16em;
}

h2 { margin: 0; font-size: 18px; }

.panel-description {
  margin: 7px 0 14px;
  color: #b9c7d9;
  font-size: 11px;
  line-height: 1.55;
}

.workspace-tabs {
  display: flex;
  gap: 5px;
  margin: -3px 0 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.workspace-tabs button {
  flex: 0 0 auto;
  padding: 6px 10px;
  color: #90a4ae;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  font-size: 11px;
  cursor: pointer;
}

.workspace-tabs button.active { color: #e1f5fe; border-color: #4fc3f7; }
.workspace-tabs span { padding: 1px 5px; color: #061426; background: #81d4fa; border-radius: 999px; font-size: 8px; }

.resubmit-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding: 9px 10px;
  color: #ffe0b2;
  background: rgba(255, 152, 0, 0.09);
  border: 1px solid rgba(255, 183, 77, 0.28);
  border-radius: 8px;
}

.resubmit-banner div { display: flex; flex-direction: column; gap: 2px; }
.resubmit-banner strong { font-size: 11px; }
.resubmit-banner span { color: #bcaaa4; font-size: 9px; }
.resubmit-banner button { padding: 5px 7px; color: #ffcc80; background: transparent; border: 1px solid rgba(255, 183, 77, 0.25); border-radius: 6px; font-size: 9px; cursor: pointer; }

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.form-field.full-span,
.full-span { grid-column: 1 / -1; margin-bottom: 10px; }

.form-field > span {
  color: #ced9e8;
  font-size: 11px;
}

.form-field small { color: #78909c; font-weight: 400; }
.form-field b { color: #ff8a80; }

.building-library-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  color: #ffccbc;
  background: rgba(244, 67, 54, 0.08);
  border: 1px solid rgba(239, 83, 80, 0.2);
  border-radius: 7px;
  font-size: 9px;
}

.building-library-error button {
  flex: 0 0 auto;
  padding: 5px 7px;
  color: #ffccbc;
  background: transparent;
  border: 1px solid rgba(255, 171, 145, 0.3);
  border-radius: 5px;
  font-size: 9px;
  cursor: pointer;
}

input,
select,
textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 9px;
  color: #f5f9ff;
  background: rgba(4, 13, 27, 0.72);
  border: 1px solid rgba(144, 202, 249, 0.2);
  border-radius: 7px;
  outline: none;
  font: inherit;
  font-size: 12px;
}

textarea { resize: vertical; line-height: 1.5; }

.agent-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.agent-actions > span {
  color: #78909c;
  font-size: 10px;
  line-height: 1.35;
}

.agent-btn {
  flex: 0 0 auto;
  padding: 6px 9px;
  color: #b3e5fc;
  background: rgba(3, 169, 244, 0.12);
  border: 1px solid rgba(79, 195, 247, 0.35);
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
}

.agent-btn:disabled { opacity: 0.45; cursor: wait; }

.parse-feedback {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: -2px 0 11px;
  padding: 9px 10px;
  border: 1px solid rgba(100, 181, 246, 0.25);
  border-radius: 8px;
  background: rgba(100, 181, 246, 0.08);
  color: #d6ecff;
  font-size: 11px;
  line-height: 1.4;
}

.parse-feedback.warning {
  border-color: rgba(255, 193, 7, 0.28);
  background: rgba(255, 193, 7, 0.07);
  color: #ffe082;
}

.parse-feedback.error {
  border-color: rgba(255, 138, 128, 0.3);
  background: rgba(255, 82, 82, 0.08);
  color: #ffab91;
}

.parsed-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
}

.parsed-fields i {
  padding: 2px 6px;
  color: #b3e5fc;
  background: rgba(3, 169, 244, 0.12);
  border-radius: 999px;
  font-size: 9px;
  font-style: normal;
}

.agent-analysis-card {
  margin: -2px 0 13px;
  padding: 12px;
  background: linear-gradient(145deg, rgba(3, 169, 244, 0.1), rgba(10, 22, 42, 0.72));
  border: 1px solid rgba(79, 195, 247, 0.28);
  border-radius: 9px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
}

.agent-analysis-card.medium {
  background: linear-gradient(145deg, rgba(255, 193, 7, 0.07), rgba(10, 22, 42, 0.72));
  border-color: rgba(255, 193, 7, 0.26);
}

.agent-analysis-card.low {
  background: linear-gradient(145deg, rgba(255, 112, 67, 0.08), rgba(10, 22, 42, 0.72));
  border-color: rgba(255, 138, 101, 0.3);
}

.agent-analysis-heading,
.agent-confirmation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.agent-analysis-heading > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-analysis-heading .agent-heading-badges {
  flex: 0 0 auto;
  flex-direction: row;
  align-items: center;
  gap: 5px;
}

.agent-heading-badges em {
  padding: 4px 7px;
  color: #80cbc4;
  background: rgba(38, 166, 154, 0.1);
  border-radius: 999px;
  font-size: 8px;
  font-style: normal;
}

.agent-analysis-heading span {
  color: #4fc3f7;
  font-size: 8px;
  letter-spacing: 0.12em;
}

.agent-analysis-heading strong { color: #edf7ff; font-size: 13px; }

.agent-analysis-heading b {
  flex: 0 0 auto;
  padding: 4px 7px;
  color: #b3e5fc;
  background: rgba(3, 169, 244, 0.12);
  border-radius: 999px;
  font-size: 9px;
}

.medium .agent-analysis-heading b { color: #ffe082; background: rgba(255, 193, 7, 0.1); }
.low .agent-analysis-heading b { color: #ffab91; background: rgba(255, 112, 67, 0.11); }

.confidence-track {
  height: 4px;
  margin-top: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
}

.confidence-track i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #29b6f6, #80deea);
  border-radius: inherit;
  transition: width 0.25s ease;
}

.medium .confidence-track i { background: linear-gradient(90deg, #ffa726, #ffee58); }
.low .confidence-track i { background: linear-gradient(90deg, #ff7043, #ffab91); }

.confidence-note {
  display: block;
  margin-top: 5px;
  color: #78909c;
  font-size: 8px;
}

.agent-explanation {
  margin: 10px 0 0;
  color: #d8e9f7;
  font-size: 11px;
  line-height: 1.55;
}

.agent-reasoning { margin-top: 9px; }
.agent-reasoning > span { color: #78909c; font-size: 9px; }
.agent-reasoning ul { display: grid; gap: 3px; margin: 5px 0 0; padding-left: 17px; }
.agent-reasoning li { color: #a9c1d3; font-size: 9px; line-height: 1.4; }

.manual-review-prompt {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 9px;
  padding: 8px 9px;
  color: #ffcc80;
  background: rgba(255, 152, 0, 0.08);
  border-left: 2px solid rgba(255, 183, 77, 0.7);
  border-radius: 0 6px 6px 0;
  font-size: 9px;
  line-height: 1.4;
}

.agent-confirmation {
  align-items: flex-start;
  margin-top: 11px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.agent-confirmation > span {
  max-width: 245px;
  color: #90a4ae;
  font-size: 9px;
  line-height: 1.45;
}

.agent-confirmation button {
  flex: 0 0 auto;
  padding: 6px 9px;
  color: #b3e5fc;
  background: rgba(3, 169, 244, 0.12);
  border: 1px solid rgba(79, 195, 247, 0.32);
  border-radius: 6px;
  font-size: 10px;
  cursor: pointer;
}

.agent-confirmation button.confirmed {
  color: #c8e6c9;
  background: rgba(102, 187, 106, 0.12);
  border-color: rgba(129, 199, 132, 0.35);
}

input:focus,
select:focus,
textarea:focus {
  border-color: #64b5f6;
  box-shadow: 0 0 0 2px rgba(100, 181, 246, 0.12);
}

input[type='datetime-local'] { color-scheme: dark; }

.form-field em {
  color: #ffab91;
  font-size: 10px;
  font-style: normal;
}

.risk-notice {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 12px;
  padding: 9px 10px;
  border: 1px solid rgba(255, 193, 7, 0.28);
  border-radius: 8px;
  background: rgba(255, 193, 7, 0.08);
  color: #ffe082;
  font-size: 11px;
  line-height: 1.45;
}

.risk-notice span { color: #d9c893; }

.form-error {
  margin-top: 10px;
  color: #ffab91;
  font-size: 11px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.form-actions button {
  padding: 8px 13px;
  border-radius: 7px;
  font-size: 12px;
  cursor: pointer;
}

.secondary-btn {
  color: #b0bec5;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.primary-btn {
  color: #061426;
  font-weight: 700;
  background: linear-gradient(135deg, #90caf9, #4fc3f7);
  border: 1px solid rgba(255, 255, 255, 0.45);
}

.form-actions button:disabled { opacity: 0.55; cursor: wait; }

.submit-result {
  display: flex;
  gap: 10px;
  margin-top: 14px;
  padding: 11px;
  border: 1px solid rgba(102, 187, 106, 0.25);
  border-radius: 9px;
  background: rgba(102, 187, 106, 0.09);
}

.result-icon {
  display: grid;
  place-items: center;
  flex: 0 0 28px;
  height: 28px;
  border-radius: 50%;
  color: #072a10;
  background: #81c784;
  font-weight: 800;
}

.submit-result strong { color: #c8e6c9; font-size: 12px; }
.submit-result p { margin: 4px 0; color: #b9c7d9; font-size: 11px; }
.submit-result code { color: #78909c; font-size: 10px; }

.tracking-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tracking-toolbar > span { color: #78909c; font-size: 9px; }
.tracking-toolbar button { padding: 5px 8px; color: #b3e5fc; background: rgba(3, 169, 244, 0.1); border: 1px solid rgba(79, 195, 247, 0.25); border-radius: 6px; font-size: 10px; cursor: pointer; }
.tracking-toolbar button:disabled { opacity: 0.5; cursor: wait; }
.tracking-state { padding: 24px 4px; color: #90a4ae; text-align: center; font-size: 11px; }
.tracking-state button { margin-left: 4px; color: #81d4fa; background: none; border: 0; cursor: pointer; }
.tracking-state.error-state { color: #ffab91; }

.student-task-list { display: flex; gap: 7px; overflow-x: auto; margin-top: 10px; padding-bottom: 7px; }
.student-task-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 238px; padding: 8px 9px; color: #e7f1fb; text-align: left; background: rgba(4, 13, 27, 0.58); border: 1px solid rgba(144, 202, 249, 0.14); border-radius: 8px; cursor: pointer; }
.student-task-item.active { border-color: rgba(79, 195, 247, 0.65); background: rgba(3, 169, 244, 0.1); }
.student-task-item > span { display: flex; flex-direction: column; min-width: 0; }
.student-task-item strong { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.student-task-item small { margin-top: 3px; color: #78909c; font-size: 8px; }
.student-task-item > i, .tracking-heading > b { flex: 0 0 auto; padding: 3px 6px; color: #b3e5fc; background: rgba(3, 169, 244, 0.12); border-radius: 999px; font-size: 8px; font-style: normal; }
.student-task-item > i.pending_review, .tracking-heading > b.pending_review { color: #ffe082; background: rgba(255, 193, 7, 0.12); }
.student-task-item > i.rejected, .tracking-heading > b.rejected { color: #ffab91; background: rgba(239, 83, 80, 0.12); }
.student-task-item > i.delivered, .tracking-heading > b.delivered { color: #a5d6a7; background: rgba(102, 187, 106, 0.12); }

.tracking-detail { margin-top: 5px; padding-top: 11px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.tracking-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.tracking-heading > div > span { color: #607d8b; font-family: monospace; font-size: 8px; }
.tracking-heading h3 { margin: 3px 0 0; font-size: 14px; }

.tracking-progress { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px; margin-top: 12px; }
.tracking-progress div { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; color: #607d8b; font-size: 8px; }
.tracking-progress div::before { position: absolute; top: 8px; right: 50%; left: -50%; height: 1px; background: rgba(144, 202, 249, 0.18); content: ''; }
.tracking-progress div:first-child::before { display: none; }
.tracking-progress i { position: relative; z-index: 1; display: grid; place-items: center; width: 17px; height: 17px; color: #78909c; background: #26384c; border-radius: 50%; font-size: 8px; font-style: normal; }
.tracking-progress .done, .tracking-progress .current { color: #b3e5fc; }
.tracking-progress .done i { color: #062113; background: #66bb6a; }
.tracking-progress .current i { color: #061426; background: #4fc3f7; box-shadow: 0 0 0 3px rgba(79, 195, 247, 0.12); }

.current-status-card { display: flex; flex-direction: column; gap: 2px; margin-top: 11px; padding: 9px; color: #b3e5fc; background: rgba(3, 169, 244, 0.08); border: 1px solid rgba(79, 195, 247, 0.2); border-radius: 7px; font-size: 10px; }
.current-status-card span { color: #90a4ae; }
.current-status-card.rejected, .current-status-card.exception, .current-status-card.cancelled { color: #ffab91; background: rgba(239, 83, 80, 0.08); border-color: rgba(239, 83, 80, 0.2); }
.current-status-card.delivered { color: #c8e6c9; background: rgba(102, 187, 106, 0.09); border-color: rgba(102, 187, 106, 0.22); }

.tracking-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 9px; }
.tracking-grid div { display: flex; flex-direction: column; gap: 2px; padding: 7px 8px; background: rgba(255, 255, 255, 0.035); border-radius: 6px; }
.tracking-grid span, .approval-card > span, .student-route-heading > span { color: #78909c; font-size: 8px; }
.tracking-grid strong { overflow: hidden; color: #d7e4f1; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }

.approval-card, .student-route-card { margin-top: 8px; padding: 8px 9px; background: rgba(4, 13, 27, 0.48); border: 1px solid rgba(144, 202, 249, 0.12); border-radius: 7px; }
.approval-card strong { display: block; margin-top: 3px; color: #d7e4f1; font-size: 10px; }
.approval-card p { margin: 3px 0 0; color: #90a4ae; font-size: 9px; line-height: 1.4; }

.rejected-task-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; padding: 9px; color: #bcaaa4; background: rgba(255, 152, 0, 0.07); border: 1px solid rgba(255, 183, 77, 0.18); border-radius: 7px; }
.rejected-task-actions span { font-size: 9px; line-height: 1.4; }
.rejected-task-actions button { flex: 0 0 auto; padding: 6px 8px; color: #4e2f00; font-weight: 700; background: linear-gradient(135deg, #ffe082, #ffb74d); border: 0; border-radius: 6px; font-size: 9px; cursor: pointer; }
.student-route-card > div { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
.student-route-card i { padding: 3px 6px; color: #b3e5fc; background: rgba(3, 169, 244, 0.1); border-radius: 5px; font-size: 8px; font-style: normal; }
.student-route-card .student-route-heading { align-items: center; justify-content: space-between; margin-top: 0; }
.student-route-heading button { padding: 4px 7px; color: #b3e5fc; background: rgba(3, 169, 244, 0.1); border: 1px solid rgba(79, 195, 247, 0.24); border-radius: 5px; font-size: 9px; cursor: pointer; }

@media (max-width: 980px) {
  .task-submit-panel { right: 10px; width: 370px; }
}
</style>
