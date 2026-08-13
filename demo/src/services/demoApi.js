import {
  APPROVAL_DECISION,
  AUDIT_CATEGORY,
  DOOR_STATE,
  DRONE_STATUS,
  NODE_AVAILABILITY,
  RESTRICTION_STATUS,
  ROLE,
  TASK_STATUS,
  createApprovalRecord,
  createAirspaceRestriction,
  createAuditRecord,
  createTransportTask,
} from '../domain/contracts'
import { parseNaturalLanguageTask } from '../domain/taskParser'
import { inspectRouteRestrictionConflict, replanRouteAroundRestriction } from '../domain/routeReplanner'
import { createMockDataset } from '../mocks/demoData'

const API_BASE = '/api/demo'
const V3_API_BASE = '/api/v3'
const requestedMode = import.meta.env.VITE_DEMO_API_MODE || 'mock'
const requestedSafetyMode = import.meta.env.VITE_V3_SAFETY_MODE || 'real'
const requestedWorkflowMode = import.meta.env.VITE_V3_WORKFLOW_MODE || 'real'
const MOCK_STORAGE_KEY = 'skynest-demo-state-v3'
const AUTH_STORAGE_KEY = 'skynest-auth-session-v1'
const clone = (value) => JSON.parse(JSON.stringify(value))

function loadAuthSession() {
  if (typeof globalThis.localStorage === 'undefined') return null
  try {
    const session = JSON.parse(globalThis.localStorage.getItem(AUTH_STORAGE_KEY) || 'null')
    if (!session?.token || !session?.user || new Date(session.expires_at).getTime() <= Date.now()) return null
    return session
  } catch {
    return null
  }
}

let authSession = loadAuthSession()

function persistAuthSession(session) {
  authSession = session
  if (typeof globalThis.localStorage === 'undefined') return
  if (session) globalThis.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
  else globalThis.localStorage.removeItem(AUTH_STORAGE_KEY)
}

function authHeaders() {
  return authSession?.token ? { Authorization: `Bearer ${authSession.token}` } : {}
}

function notifyAuthExpired() {
  persistAuthSession(null)
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent('skynest-auth-expired'))
  }
}

function loadMockState() {
  const fallback = createMockDataset()
  if (typeof globalThis.localStorage === 'undefined') return fallback
  try {
    const stored = JSON.parse(globalThis.localStorage.getItem(MOCK_STORAGE_KEY) || 'null')
    if (stored?.version !== 1 || !stored.state || !Array.isArray(stored.state.tasks)) return fallback
    return {
      ...fallback,
      ...stored.state,
      audit_records: Array.isArray(stored.state.audit_records) ? stored.state.audit_records : fallback.audit_records,
    }
  } catch (error) {
    console.warn('[demo-api] 读取本地演示记录失败，已使用初始数据：', error.message)
    return fallback
  }
}

function persistMockState() {
  if (typeof globalThis.localStorage === 'undefined') return
  try {
    globalThis.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify({ version: 1, state: mockState }))
  } catch (error) {
    console.warn('[demo-api] 保存本地演示记录失败：', error.message)
  }
}

function appendAuditRecord(values) {
  if (!Array.isArray(mockState.audit_records)) mockState.audit_records = []
  const record = createAuditRecord(values)
  mockState.audit_records.unshift(record)
  mockState.audit_records = mockState.audit_records.slice(0, 500)
  persistMockState()
  return record
}

let mockState = loadMockState()

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.error || `接口请求失败：${response.status}`)
  }
  return data
}

async function requestV3Json(path, options = {}) {
  const response = await fetch(`${V3_API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
    ...options,
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/login')) notifyAuthExpired()
    const error = new Error(data?.detail || data?.error || `V3接口请求失败：${response.status}`)
    error.status = response.status
    error.code = data?.error || null
    throw error
  }
  return data
}

async function withMode(realRequest, mockRequest) {
  if (requestedMode === 'mock') return mockRequest()
  if (requestedMode === 'real') return realRequest()

  try {
    return await realRequest()
  } catch (error) {
    console.warn('[demo-api] 真实接口不可用，已回退到模拟数据：', error.message)
    return mockRequest()
  }
}

async function withSafetyMode(realRequest, mockRequest) {
  if (requestedSafetyMode === 'mock') return mockRequest()
  if (requestedSafetyMode === 'real') return realRequest()

  try {
    return await realRequest()
  } catch (error) {
    console.warn('[demo-api] V3安全管控接口不可用，已回退到模拟数据：', error.message)
    return mockRequest()
  }
}

async function withWorkflowMode(realRequest, mockRequest) {
  if (requestedWorkflowMode === 'mock') return mockRequest()
  if (requestedWorkflowMode === 'real') return realRequest()

  try {
    return await realRequest()
  } catch (error) {
    console.warn('[demo-api] V3任务流程接口不可用，已回退到模拟数据：', error.message)
    return mockRequest()
  }
}

function buildMockOverview(role) {
  const pendingTasks = mockState.tasks.filter((task) => task.status === TASK_STATUS.PENDING_REVIEW)
  const activeDrones = mockState.drones.filter((drone) => drone.status !== 'idle' && drone.status !== 'offline')
  const availableNodes = mockState.nodes.filter((node) => node.availability === 'available')

  const roleContent = {
    [ROLE.STUDENT]: {
      title: '师生任务提交端',
      description: '提交校园运输需求，并跟踪审核、配送和接驳进度。',
      metrics: [
        { label: '我的任务', value: mockState.tasks.length },
        { label: '等待审核', value: pendingTasks.length },
        { label: '运输中', value: mockState.tasks.filter((task) => task.status === TASK_STATUS.IN_TRANSIT).length },
      ],
      next_actions: ['填写运输需求', '确认Agent解析结果', '查看任务进度'],
    },
    [ROLE.SCHOOL]: {
      title: '校方监管端',
      description: '统一查看任务、航线和风险信息，执行审批与安全监管。',
      metrics: [
        { label: '待审批', value: pendingTasks.length },
        { label: '运行航线', value: mockState.routes.length },
        { label: '在线节点', value: mockState.nodes.length },
      ],
      next_actions: ['审核高风险任务', '查看航线解释', '管理临时限制'],
    },
    [ROLE.OPERATOR]: {
      title: '运营商任务端',
      description: '接收航点链，监控无人机、电量、任务和接驳节点状态。',
      metrics: [
        { label: '活动任务', value: activeDrones.length },
        { label: '可用无人机', value: mockState.drones.length },
        { label: '空闲节点', value: availableNodes.length },
      ],
      next_actions: ['接收已批准任务', '检查无人机状态', '确认接驳节点'],
    },
  }

  return {
    role,
    source: 'mock',
    updated_at: new Date().toISOString(),
    ...roleContent[role],
  }
}

function mockParseTask(inputText = '') {
  return parseNaturalLanguageTask(inputText)
}

function buildMockAuditWorkspace() {
  const records = [...(mockState.audit_records || [])]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
  const todayKey = new Date().toLocaleDateString('zh-CN')
  return {
    source: 'mock',
    updated_at: new Date().toISOString(),
    records,
    summary: {
      total: records.length,
      today: records.filter((record) => new Date(record.created_at).toLocaleDateString('zh-CN') === todayKey).length,
      safety: records.filter((record) => record.category === AUDIT_CATEGORY.SAFETY).length,
      exceptions: records.filter((record) => record.event_type === 'emergency_stop').length,
    },
    persistence: 'local',
  }
}

function buildMockReviewQueue() {
  return mockState.tasks.map((task) => ({
    task,
    route: mockState.routes.find((route) => route.task_id === task.id) || null,
    approval: mockState.approvals.find((approval) => approval.task_id === task.id) || null,
  }))
}

function buildMockStudentWorkspace() {
  return {
    source: 'mock',
    updated_at: new Date().toISOString(),
    tasks: mockState.tasks.map((task) => ({
      task,
      route: mockState.routes.find((route) => route.task_id === task.id) || null,
      approval: mockState.approvals.find((approval) => approval.task_id === task.id) || null,
      assigned_drone: mockState.drones.find((drone) => drone.id === task.assigned_drone_id) || null,
      assigned_node: mockState.nodes.find((node) => node.id === task.assigned_node_id) || null,
    })),
  }
}

function mockReviewTask(taskId, review = {}) {
  const allowedDecisions = new Set([APPROVAL_DECISION.APPROVED, APPROVAL_DECISION.REJECTED])
  if (!allowedDecisions.has(review.decision)) throw new Error('请选择批准或驳回')

  const task = mockState.tasks.find((item) => item.id === taskId)
  if (!task) throw new Error('待审核任务不存在')
  if (task.status !== TASK_STATUS.PENDING_REVIEW) throw new Error('该任务已经完成审核')

  const reviewedAt = new Date().toISOString()
  task.status = review.decision === APPROVAL_DECISION.APPROVED
    ? TASK_STATUS.APPROVED
    : TASK_STATUS.REJECTED
  task.updated_at = reviewedAt

  let approval = mockState.approvals.find((item) => item.task_id === taskId)
  const approvalValues = {
    task_id: taskId,
    decision: review.decision,
    reviewer: review.reviewer || { id: '', name: '校方审核员', department: '' },
    reason: String(review.reason || '').trim(),
    reviewed_at: reviewedAt,
  }

  if (approval) {
    Object.assign(approval, approvalValues)
  } else {
    approval = createApprovalRecord(approvalValues)
    mockState.approvals.unshift(approval)
  }

  const approved = review.decision === APPROVAL_DECISION.APPROVED
  appendAuditRecord({
    event_type: approved ? 'task_approved' : 'task_rejected',
    category: AUDIT_CATEGORY.APPROVAL,
    task_id: task.id,
    title: approved ? '运输任务审核通过' : '运输任务已驳回',
    description: `${task.origin}至${task.destination}的任务${approved ? '已批准并等待运营商接收' : '未通过校方审核'}。`,
    actor: { role: ROLE.SCHOOL, name: approvalValues.reviewer.name || '校方审核员', department: approvalValues.reviewer.department || '' },
    resource: { type: 'task', id: task.id },
    metadata: { decision: review.decision, reason: approvalValues.reason },
    created_at: reviewedAt,
  })

  return {
    task,
    approval,
    route: mockState.routes.find((route) => route.task_id === task.id) || null,
  }
}

function mockResubmitRejectedTask(taskId, values = {}) {
  const task = mockState.tasks.find((item) => item.id === taskId)
  if (!task) throw new Error('待修改任务不存在')
  if (task.status !== TASK_STATUS.REJECTED) throw new Error('只有已驳回的任务可以修改后重新提交')

  const requesterId = authSession?.user?.id
  if (requesterId && task.requester?.id && task.requester.id !== requesterId) {
    throw new Error('只能修改本人提交的任务')
  }

  const previous = {
    status: task.status,
    origin: task.origin,
    destination: task.destination,
  }
  Object.assign(task, values, {
    id: task.id,
    requester: task.requester,
    status: TASK_STATUS.PENDING_REVIEW,
    assigned_drone_id: null,
    assigned_node_id: null,
    updated_at: new Date().toISOString(),
  })
  appendAuditRecord({
    event_type: 'task_resubmitted',
    category: AUDIT_CATEGORY.TASK,
    task_id: task.id,
    title: '驳回任务已修改并重新提交',
    description: `${task.origin}至${task.destination}的运输任务已根据审核意见修改，并重新进入校方审核。`,
    actor: { role: ROLE.STUDENT, name: task.requester?.name || '师生用户', department: task.requester?.department || '' },
    resource: { type: 'task', id: task.id },
    metadata: {
      previous_status: previous.status,
      previous_origin: previous.origin,
      previous_destination: previous.destination,
    },
    created_at: task.updated_at,
  })
  persistMockState()
  return buildMockStudentWorkspace().tasks.find((item) => item.task.id === task.id)
}

const OPERATOR_TASK_STATUSES = new Set([
  TASK_STATUS.APPROVED,
  TASK_STATUS.DISPATCHED,
  TASK_STATUS.IN_TRANSIT,
  TASK_STATUS.ARRIVING,
  TASK_STATUS.DELIVERED,
  TASK_STATUS.EXCEPTION,
])

function buildMockOperatorWorkspace() {
  const tasks = mockState.tasks
    .filter((task) => OPERATOR_TASK_STATUSES.has(task.status))
    .map((task) => ({
      task,
      route: mockState.routes.find((route) => route.task_id === task.id) || null,
      approval: mockState.approvals.find((approval) => approval.task_id === task.id) || null,
      assigned_drone: mockState.drones.find((drone) => drone.id === task.assigned_drone_id) || null,
      assigned_node: mockState.nodes.find((node) => node.id === task.assigned_node_id) || null,
    }))

  return {
    source: 'mock',
    updated_at: new Date().toISOString(),
    tasks,
    drones: mockState.drones,
    nodes: mockState.nodes,
  }
}

function mockDispatchTask(taskId, assignment = {}) {
  const task = mockState.tasks.find((item) => item.id === taskId)
  if (!task) throw new Error('运营任务不存在')
  if (task.status !== TASK_STATUS.APPROVED) throw new Error('只有已批准任务可以派发')

  const drone = mockState.drones.find((item) => item.id === assignment.drone_id)
  const node = mockState.nodes.find((item) => item.id === assignment.node_id)
  if (!drone || drone.status !== DRONE_STATUS.IDLE) throw new Error('请选择空闲无人机')
  if (!node || node.availability !== NODE_AVAILABILITY.AVAILABLE) throw new Error('请选择可用接驳节点')

  const updatedAt = new Date().toISOString()
  Object.assign(task, {
    assigned_drone_id: drone.id,
    assigned_node_id: node.id,
    status: TASK_STATUS.DISPATCHED,
    updated_at: updatedAt,
  })
  Object.assign(drone, {
    status: DRONE_STATUS.ASSIGNED,
    task_id: task.id,
    updated_at: updatedAt,
  })
  Object.assign(node, {
    availability: NODE_AVAILABILITY.RESERVED,
    delivery_state: 'awaiting_departure',
    updated_at: updatedAt,
  })

  appendAuditRecord({
    event_type: 'task_dispatched',
    category: AUDIT_CATEGORY.OPERATION,
    task_id: task.id,
    title: '运输资源已派发',
    description: `${drone.name}已接收${task.origin}至${task.destination}的航点链，${node.name}已预留。`,
    actor: { role: ROLE.OPERATOR, name: drone.operator || '演示运营商', department: '运营调度' },
    resource: { type: 'task', id: task.id },
    metadata: { drone_id: drone.id, drone_name: drone.name, node_id: node.id, node_name: node.name },
    created_at: updatedAt,
  })

  return buildMockOperatorWorkspace()
}

function mockAdvanceOperatorTask(taskId) {
  const task = mockState.tasks.find((item) => item.id === taskId)
  if (!task) throw new Error('运营任务不存在')

  const nextStatus = {
    [TASK_STATUS.DISPATCHED]: TASK_STATUS.IN_TRANSIT,
    [TASK_STATUS.IN_TRANSIT]: TASK_STATUS.ARRIVING,
    [TASK_STATUS.ARRIVING]: TASK_STATUS.DELIVERED,
  }[task.status]
  if (!nextStatus) throw new Error('当前任务状态不能继续推进')

  const drone = mockState.drones.find((item) => item.id === task.assigned_drone_id)
  const node = mockState.nodes.find((item) => item.id === task.assigned_node_id)
  const updatedAt = new Date().toISOString()
  task.status = nextStatus
  task.updated_at = updatedAt

  if (nextStatus === TASK_STATUS.IN_TRANSIT) {
    if (drone) Object.assign(drone, { status: DRONE_STATUS.IN_FLIGHT, updated_at: updatedAt })
    if (node) Object.assign(node, { delivery_state: 'awaiting_arrival', updated_at: updatedAt })
  } else if (nextStatus === TASK_STATUS.ARRIVING) {
    if (node) Object.assign(node, {
      availability: NODE_AVAILABILITY.OCCUPIED,
      door_state: DOOR_STATE.OPENING,
      delivery_state: 'drone_arriving',
      updated_at: updatedAt,
    })
  } else if (nextStatus === TASK_STATUS.DELIVERED) {
    task.completed_at = updatedAt
    if (drone) Object.assign(drone, {
      status: DRONE_STATUS.IDLE,
      task_id: null,
      battery_percent: Math.max(0, drone.battery_percent - 12),
      updated_at: updatedAt,
    })
    if (node) Object.assign(node, {
      availability: NODE_AVAILABILITY.AVAILABLE,
      door_state: DOOR_STATE.OPEN,
      delivery_state: 'delivered',
      updated_at: updatedAt,
    })
  }

  const auditContent = {
    [TASK_STATUS.IN_TRANSIT]: {
      event_type: 'task_in_transit',
      title: '无人机开始运输',
      description: `${drone?.name || '执行无人机'}已起飞，任务进入运输状态。`,
    },
    [TASK_STATUS.ARRIVING]: {
      event_type: 'task_arriving',
      title: '无人机到达接驳节点',
      description: `${drone?.name || '执行无人机'}已到达${node?.name || '目标接驳节点'}，舱门正在开启。`,
    },
    [TASK_STATUS.DELIVERED]: {
      event_type: 'task_delivered',
      title: '运输任务完成交付',
      description: `${task.origin}至${task.destination}的任务已完成，运输资源已经释放。`,
    },
  }[nextStatus]
  appendAuditRecord({
    ...auditContent,
    category: AUDIT_CATEGORY.OPERATION,
    task_id: task.id,
    actor: { role: ROLE.OPERATOR, name: drone?.operator || '演示运营商', department: '运营调度' },
    resource: { type: 'task', id: task.id },
    metadata: {
      task_status: nextStatus,
      drone_status: drone?.status || null,
      node_state: node?.delivery_state || null,
    },
    created_at: updatedAt,
  })

  return buildMockOperatorWorkspace()
}

const ACTIVE_FLIGHT_STATUSES = new Set([
  TASK_STATUS.DISPATCHED,
  TASK_STATUS.IN_TRANSIT,
  TASK_STATUS.ARRIVING,
])

const REPLANNABLE_TASK_STATUSES = new Set([
  TASK_STATUS.PENDING_REVIEW,
  TASK_STATUS.APPROVED,
  TASK_STATUS.DISPATCHED,
  TASK_STATUS.IN_TRANSIT,
  TASK_STATUS.ARRIVING,
])

function buildMockSafetyWorkspace() {
  const activeRestrictions = (mockState.restrictions || [])
    .filter((restriction) => restriction.status === RESTRICTION_STATUS.ACTIVE)
  const affectedRoutes = mockState.routes.flatMap((route) => {
    const task = mockState.tasks.find((item) => item.id === route.task_id)
    if (!task || !REPLANNABLE_TASK_STATUSES.has(task.status)) return []
    const conflicts = activeRestrictions
      .map((restriction) => ({
        restriction,
        analysis: inspectRouteRestrictionConflict(route, restriction),
      }))
      .filter((item) => item.analysis.conflicts)
    return conflicts.length ? [{ task, route, conflicts }] : []
  })

  return {
    source: 'mock',
    updated_at: new Date().toISOString(),
    restrictions: mockState.restrictions || [],
    affected_routes: affectedRoutes,
    recent_replans: mockState.routes
      .filter((route) => route.replanned_at)
      .map((route) => ({
        task: mockState.tasks.find((task) => task.id === route.task_id) || null,
        route,
      })),
    active_tasks: mockState.tasks
      .filter((task) => ACTIVE_FLIGHT_STATUSES.has(task.status))
      .map((task) => ({
        task,
        assigned_drone: mockState.drones.find((drone) => drone.id === task.assigned_drone_id) || null,
        assigned_node: mockState.nodes.find((node) => node.id === task.assigned_node_id) || null,
      })),
  }
}

function mockCreateRestriction(values = {}) {
  const name = String(values.name || '').trim()
  const reason = String(values.reason || '').trim()
  const center = values.center || {}
  const radius = Number(values.radius_m)
  if (!name || !reason) throw new Error('请填写限制区名称和原因')
  if (!Number.isFinite(Number(center.lng)) || !Number.isFinite(Number(center.lat))) throw new Error('请选择限制区域')
  if (!Number.isFinite(radius) || radius < 50 || radius > 2000) throw new Error('限制半径必须在50至2000米之间')

  const restriction = createAirspaceRestriction({
    ...values,
    name,
    reason,
    center: { lng: Number(center.lng), lat: Number(center.lat), height: Number(center.height || 0) },
    radius_m: radius,
    status: RESTRICTION_STATUS.ACTIVE,
  })
  mockState.restrictions.unshift(restriction)
  appendAuditRecord({
    event_type: 'restriction_created',
    category: AUDIT_CATEGORY.SAFETY,
    title: '临时限制区已生效',
    description: `${restriction.name}已启用，系统将自动检测受影响航线。`,
    actor: { role: ROLE.SCHOOL, name: restriction.created_by?.name || '校方审核员', department: restriction.created_by?.department || '' },
    resource: { type: 'restriction', id: restriction.id },
    metadata: { radius_m: restriction.radius_m, reason: restriction.reason, end_at: restriction.end_at },
    created_at: restriction.updated_at,
  })
  return buildMockSafetyWorkspace()
}

function mockReplanTaskRoute(taskId, restrictionId) {
  const task = mockState.tasks.find((item) => item.id === taskId)
  const route = mockState.routes.find((item) => item.task_id === taskId)
  const restriction = mockState.restrictions.find((item) => item.id === restrictionId)
  if (!task || !route) throw new Error('该任务尚未生成可重新规划的航线')
  if (!REPLANNABLE_TASK_STATUSES.has(task.status)) throw new Error('当前任务状态不能重新规划航线')
  if (!restriction || restriction.status !== RESTRICTION_STATUS.ACTIVE) throw new Error('触发限制区不存在或未启用')

  const replannedRoute = replanRouteAroundRestriction(route, restriction)
  Object.assign(route, replannedRoute)
  task.updated_at = route.replanned_at
  appendAuditRecord({
    event_type: 'route_replanned',
    category: AUDIT_CATEGORY.SAFETY,
    task_id: task.id,
    title: '冲突航线已动态重规划',
    description: `${task.origin}至${task.destination}的航线已绕开${restriction.name}。`,
    actor: { role: ROLE.SCHOOL, name: '校方安全管控员', department: '保卫处' },
    resource: { type: 'route', id: route.id },
    metadata: {
      restriction_id: restriction.id,
      distance_change_percent: route.replan_summary.distance_change_percent,
      risk_change_percent: route.replan_summary.risk_change_percent,
      safety_buffer_meters: route.replan_summary.safety_buffer_meters,
    },
    created_at: route.replanned_at,
  })
  return buildMockSafetyWorkspace()
}

function mockToggleRestriction(restrictionId, active) {
  const restriction = mockState.restrictions.find((item) => item.id === restrictionId)
  if (!restriction) throw new Error('临时限制区不存在')
  restriction.status = active ? RESTRICTION_STATUS.ACTIVE : RESTRICTION_STATUS.INACTIVE
  restriction.updated_at = new Date().toISOString()
  appendAuditRecord({
    event_type: active ? 'restriction_enabled' : 'restriction_disabled',
    category: AUDIT_CATEGORY.SAFETY,
    title: active ? '临时限制区已重新启用' : '临时限制区已停用',
    description: `${restriction.name}已${active ? '恢复生效' : '停止生效'}。`,
    actor: { role: ROLE.SCHOOL, name: '校方安全管控员', department: '保卫处' },
    resource: { type: 'restriction', id: restriction.id },
    metadata: { status: restriction.status, reason: restriction.reason },
    created_at: restriction.updated_at,
  })
  return buildMockSafetyWorkspace()
}

function mockEmergencyStopTask(taskId, reason = '') {
  const task = mockState.tasks.find((item) => item.id === taskId)
  if (!task || !ACTIVE_FLIGHT_STATUSES.has(task.status)) throw new Error('该任务当前不在可熔断状态')
  const stopReason = String(reason || '').trim()
  if (!stopReason) throw new Error('执行安全熔断前必须填写原因')

  const updatedAt = new Date().toISOString()
  const drone = mockState.drones.find((item) => item.id === task.assigned_drone_id)
  const node = mockState.nodes.find((item) => item.id === task.assigned_node_id)
  Object.assign(task, {
    status: TASK_STATUS.EXCEPTION,
    exception_reason: stopReason,
    updated_at: updatedAt,
  })
  if (drone) Object.assign(drone, { status: DRONE_STATUS.RETURNING, updated_at: updatedAt })
  if (node) Object.assign(node, {
    availability: NODE_AVAILABILITY.AVAILABLE,
    door_state: DOOR_STATE.CLOSED,
    delivery_state: 'interrupted',
    updated_at: updatedAt,
  })
  appendAuditRecord({
    event_type: 'emergency_stop',
    category: AUDIT_CATEGORY.SAFETY,
    task_id: task.id,
    title: '飞行任务已执行安全熔断',
    description: `${task.origin}至${task.destination}的任务已中止，无人机正在返航。`,
    actor: { role: ROLE.SCHOOL, name: '校方安全管控员', department: '保卫处' },
    resource: { type: 'task', id: task.id },
    metadata: {
      reason: stopReason,
      drone_id: drone?.id || null,
      drone_status: drone?.status || null,
      node_id: node?.id || null,
      node_availability: node?.availability || null,
    },
    created_at: updatedAt,
  })
  return buildMockSafetyWorkspace()
}

export const demoApi = {
  mode: requestedWorkflowMode === 'real' ? 'real' : requestedMode,

  getLoginOptions() {
    return requestV3Json('/auth/options')
  },

  async login(username, password) {
    const session = await requestV3Json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    persistAuthSession(session)
    return clone(session)
  },

  async restoreSession() {
    if (!authSession) return null
    try {
      const result = await requestV3Json('/auth/me')
      authSession = { ...authSession, user: result.user }
      persistAuthSession(authSession)
      return clone(authSession)
    } catch {
      persistAuthSession(null)
      return null
    }
  },

  async logout() {
    try {
      if (authSession) await requestV3Json('/auth/logout', { method: 'POST' })
    } finally {
      persistAuthSession(null)
    }
  },

  getCurrentSession() {
    return authSession ? clone(authSession) : null
  },

  getRoleOverview(role) {
    return withMode(
      () => requestJson(`/overview/${role}`),
      () => Promise.resolve(clone(buildMockOverview(role))),
    )
  },

  listTasks() {
    return withWorkflowMode(
      () => requestV3Json('/tasks').then((result) => result.data || []),
      () => Promise.resolve(clone(mockState.tasks)),
    )
  },

  getStudentWorkspace() {
    return withWorkflowMode(
      () => requestV3Json('/student/workspace'),
      () => Promise.resolve(clone(buildMockStudentWorkspace())),
    )
  },

  getAuditWorkspace() {
    return withWorkflowMode(
      () => requestV3Json('/audit'),
      () => Promise.resolve(clone(buildMockAuditWorkspace())),
    )
  },

  listReviewTasks() {
    return withWorkflowMode(
      () => requestV3Json('/reviews'),
      () => Promise.resolve(clone(buildMockReviewQueue())),
    )
  },

  reviewTask(taskId, review) {
    return withWorkflowMode(
      () => requestV3Json(`/tasks/${encodeURIComponent(taskId)}/review`, {
        method: 'POST',
        body: JSON.stringify(review),
      }),
      () => Promise.resolve(clone(mockReviewTask(taskId, review))),
    )
  },

  getOperatorWorkspace() {
    return withWorkflowMode(
      () => requestV3Json('/operator/workspace'),
      () => Promise.resolve(clone(buildMockOperatorWorkspace())),
    )
  },

  dispatchTask(taskId, assignment) {
    return withWorkflowMode(
      () => requestV3Json(`/operator/tasks/${encodeURIComponent(taskId)}/dispatch`, {
        method: 'POST',
        body: JSON.stringify(assignment),
      }),
      () => Promise.resolve(clone(mockDispatchTask(taskId, assignment))),
    )
  },

  advanceOperatorTask(taskId) {
    return withWorkflowMode(
      () => requestV3Json(`/operator/tasks/${encodeURIComponent(taskId)}/advance`, { method: 'POST' }),
      () => Promise.resolve(clone(mockAdvanceOperatorTask(taskId))),
    )
  },

  getSafetyWorkspace() {
    return withSafetyMode(
      () => requestV3Json('/safety/workspace'),
      () => Promise.resolve(clone(buildMockSafetyWorkspace())),
    )
  },

  createRestriction(values) {
    return withSafetyMode(
      () => requestV3Json('/safety/restrictions', { method: 'POST', body: JSON.stringify(values) }),
      () => Promise.resolve(clone(mockCreateRestriction(values))),
    )
  },

  setRestrictionActive(restrictionId, active) {
    return withSafetyMode(
      () => requestV3Json(`/safety/restrictions/${encodeURIComponent(restrictionId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      }),
      () => Promise.resolve(clone(mockToggleRestriction(restrictionId, active))),
    )
  },

  emergencyStopTask(taskId, reason) {
    return withSafetyMode(
      () => requestV3Json(`/safety/tasks/${encodeURIComponent(taskId)}/emergency-stop`, {
        method: 'POST',
        body: JSON.stringify({ reason, actor: '校方安全管控员' }),
      }),
      () => Promise.resolve(clone(mockEmergencyStopTask(taskId, reason))),
    )
  },

  replanTaskRoute(taskId, restrictionId) {
    return withSafetyMode(
      () => requestV3Json(`/safety/tasks/${encodeURIComponent(taskId)}/replan`, {
        method: 'POST',
        body: JSON.stringify({ restriction_id: restrictionId, actor: '校方安全管控员' }),
      }),
      () => Promise.resolve(clone(mockReplanTaskRoute(taskId, restrictionId))),
    )
  },

  parseTask(inputText) {
    return withWorkflowMode(
      () => requestV3Json('/agent/parse', { method: 'POST', body: JSON.stringify({ input_text: inputText }) }),
      () => Promise.resolve(clone(mockParseTask(inputText))),
    )
  },

  getAgentModelStatus() {
    return withWorkflowMode(
      () => requestV3Json('/agent/status'),
      () => Promise.resolve({
        enabled: false,
        provider: 'ollama',
        model: 'mock',
        safety_source: '本地演示规则',
        explanation_only: true,
        note: '当前为本地演示模式。',
      }),
    )
  },

  updateAgentModelConfig(values) {
    return withWorkflowMode(
      () => requestV3Json('/agent/config', { method: 'PUT', body: JSON.stringify(values) }),
      () => Promise.resolve({
        enabled: Boolean(values.enabled),
        provider: values.provider || 'ollama',
        model: 'mock',
        safety_source: '本地演示规则',
        explanation_only: true,
        note: '演示模式不会连接真实模型。',
      }),
    )
  },

  submitTask(task) {
    return withWorkflowMode(
      () => requestV3Json('/tasks', { method: 'POST', body: JSON.stringify(task) }),
      () => {
        const saved = createTransportTask({ ...task, status: TASK_STATUS.PENDING_REVIEW })
        mockState.tasks.unshift(saved)
        appendAuditRecord({
          event_type: 'task_submitted',
          category: AUDIT_CATEGORY.TASK,
          task_id: saved.id,
          title: saved.needs_manual_review ? '高风险运输任务已提交' : '运输任务已提交',
          description: `${saved.requester?.name || '师生用户'}提交了${saved.origin}至${saved.destination}的${saved.item_category}运输需求。`,
          actor: { role: ROLE.STUDENT, name: saved.requester?.name || '师生用户', department: saved.requester?.department || '' },
          resource: { type: 'task', id: saved.id },
          metadata: {
            item_category: saved.item_category,
            weight_kg: saved.weight_kg,
            needs_manual_review: saved.needs_manual_review,
          },
          created_at: saved.created_at,
        })
        return Promise.resolve(clone(saved))
      },
    )
  },

  resubmitRejectedTask(taskId, task) {
    return withWorkflowMode(
      () => requestV3Json(`/student/tasks/${encodeURIComponent(taskId)}/resubmit`, {
        method: 'PUT',
        body: JSON.stringify(task),
      }),
      () => Promise.resolve(clone(mockResubmitRejectedTask(taskId, task))),
    )
  },

  listDrones() {
    return withMode(
      () => requestJson('/drones'),
      () => Promise.resolve(clone(mockState.drones)),
    )
  },

  listNestNodes() {
    return withMode(
      () => requestJson('/nodes'),
      () => Promise.resolve(clone(mockState.nodes)),
    )
  },

  resetMockState() {
    mockState = createMockDataset()
    persistMockState()
  },
}
