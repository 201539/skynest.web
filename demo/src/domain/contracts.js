export const ROLE = Object.freeze({
  STUDENT: 'student',
  SCHOOL: 'school',
  OPERATOR: 'operator',
})

export const ROLE_OPTIONS = Object.freeze([
  {
    id: ROLE.STUDENT,
    label: '师生提交端',
    shortLabel: '师生端',
    description: '提交运输需求并查看审核、配送和交付进度',
  },
  {
    id: ROLE.SCHOOL,
    label: '校方监管端',
    shortLabel: '校方端',
    description: '审查任务与航线，管理临时限制并执行安全熔断',
  },
  {
    id: ROLE.OPERATOR,
    label: '运营商端',
    shortLabel: '运营端',
    description: '接收航点链，监控无人机、任务和接驳节点状态',
  },
])

export const TASK_STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  DISPATCHED: 'dispatched',
  IN_TRANSIT: 'in_transit',
  ARRIVING: 'arriving',
  DELIVERED: 'delivered',
  EXCEPTION: 'exception',
  CANCELLED: 'cancelled',
})

export const DRONE_STATUS = Object.freeze({
  IDLE: 'idle',
  ASSIGNED: 'assigned',
  IN_FLIGHT: 'in_flight',
  RETURNING: 'returning',
  CHARGING: 'charging',
  FAULT: 'fault',
  OFFLINE: 'offline',
})

export const NODE_AVAILABILITY = Object.freeze({
  AVAILABLE: 'available',
  RESERVED: 'reserved',
  OCCUPIED: 'occupied',
  MAINTENANCE: 'maintenance',
  OFFLINE: 'offline',
})

export const DOOR_STATE = Object.freeze({
  CLOSED: 'closed',
  OPENING: 'opening',
  OPEN: 'open',
  CLOSING: 'closing',
  FAULT: 'fault',
})

export const APPROVAL_DECISION = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
})

export const RESTRICTION_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  EXPIRED: 'expired',
})

export const AUDIT_CATEGORY = Object.freeze({
  TASK: 'task',
  APPROVAL: 'approval',
  OPERATION: 'operation',
  SAFETY: 'safety',
})

export const REQUIRED_TASK_FIELDS = Object.freeze([
  'origin',
  'destination',
  'item_category',
  'weight_kg',
  'deadline',
])

const isoNow = () => new Date().toISOString()
const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function createTransportTask(overrides = {}) {
  return {
    id: makeId('task'),
    input_text: '',
    requester: { id: '', name: '', department: '' },
    origin: '',
    destination: '',
    item_category: '',
    weight_kg: null,
    deadline: null,
    priority: 'normal',
    safety_level: 'normal',
    special_requirements: [],
    recommended_vehicle_class: null,
    candidate_node_ids: [],
    assigned_drone_id: null,
    assigned_node_id: null,
    needs_manual_review: false,
    missing_fields: [],
    agent_analysis: null,
    status: TASK_STATUS.DRAFT,
    created_at: isoNow(),
    updated_at: isoNow(),
    ...overrides,
  }
}

export function createRoutePlan(overrides = {}) {
  return {
    id: makeId('route'),
    task_id: null,
    algorithm: 'A*',
    waypoints: [],
    main_risk_factors: [],
    avoided_zones: [],
    distance_change_percent: null,
    risk_change_percent: null,
    total_length_meters: null,
    estimated_duration_seconds: null,
    generated_at: isoNow(),
    ...overrides,
  }
}

export function createDroneState(overrides = {}) {
  return {
    id: makeId('drone'),
    name: '未命名无人机',
    operator: '',
    vehicle_class: 'light',
    position: { lng: null, lat: null, height: null },
    battery_percent: 100,
    status: DRONE_STATUS.IDLE,
    task_id: null,
    updated_at: isoNow(),
    ...overrides,
  }
}

export function createNestNode(overrides = {}) {
  return {
    id: makeId('node'),
    name: '未命名接驳节点',
    node_type: 'building_nest',
    location: { lng: null, lat: null, height: null },
    availability: NODE_AVAILABILITY.AVAILABLE,
    door_state: DOOR_STATE.CLOSED,
    delivery_state: 'idle',
    fault_code: null,
    updated_at: isoNow(),
    ...overrides,
  }
}

export function createApprovalRecord(overrides = {}) {
  return {
    id: makeId('approval'),
    task_id: null,
    decision: APPROVAL_DECISION.PENDING,
    reviewer: { id: '', name: '', department: '' },
    reason: '',
    reviewed_at: null,
    ...overrides,
  }
}

export function createAirspaceRestriction(overrides = {}) {
  return {
    id: makeId('restriction'),
    name: '未命名临时限制区',
    zone_type: 'temporary_circle',
    center: { lng: null, lat: null, height: 0 },
    radius_m: 100,
    reason: '',
    status: RESTRICTION_STATUS.ACTIVE,
    start_at: isoNow(),
    end_at: null,
    created_by: { id: '', name: '', department: '' },
    updated_at: isoNow(),
    ...overrides,
  }
}

export function createAuditRecord(overrides = {}) {
  return {
    id: makeId('audit'),
    event_type: 'system_event',
    category: AUDIT_CATEGORY.TASK,
    task_id: null,
    title: '系统事件',
    description: '',
    actor: { role: '', name: '系统', department: '' },
    resource: { type: '', id: '' },
    metadata: {},
    created_at: isoNow(),
    ...overrides,
  }
}

export function validateTransportTask(task) {
  const missing_fields = REQUIRED_TASK_FIELDS.filter((field) => {
    const value = task?.[field]
    return value === null || value === undefined || value === ''
  })

  return {
    valid: missing_fields.length === 0,
    missing_fields,
  }
}
