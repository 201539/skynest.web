import {
  APPROVAL_DECISION,
  AUDIT_CATEGORY,
  DOOR_STATE,
  DRONE_STATUS,
  NODE_AVAILABILITY,
  RESTRICTION_STATUS,
  TASK_STATUS,
  createAirspaceRestriction,
  createAuditRecord,
  createApprovalRecord,
  createDroneState,
  createNestNode,
  createRoutePlan,
  createTransportTask,
} from '../domain/contracts'

export function createMockDataset() {
  const task = createTransportTask({
    id: 'task-demo-001',
    input_text: '下午4点前，把2公斤实验材料从环境学院送到二期实验楼，需要防震。',
    requester: { id: 'student-001', name: '演示用户', department: '环境学院' },
    origin: '环境学院',
    destination: '二期实验楼',
    item_category: '实验材料',
    weight_kg: 2,
    deadline: '2026-08-03T16:00:00+08:00',
    priority: 'urgent',
    safety_level: 'high',
    special_requirements: ['防震'],
    recommended_vehicle_class: 'light-cargo',
    candidate_node_ids: ['node-lab-01'],
    needs_manual_review: true,
    missing_fields: [],
    status: TASK_STATUS.PENDING_REVIEW,
  })

  const approvedTask = createTransportTask({
    id: 'task-demo-002',
    input_text: '今天下午5点半前，把800克文件资料从图书馆送到行政楼，需要防水。',
    requester: { id: 'teacher-002', name: '演示教师', department: '教务处' },
    origin: '图书馆',
    destination: '行政楼',
    item_category: '文件图书',
    weight_kg: 0.8,
    deadline: '2026-08-03T17:30:00+08:00',
    priority: 'normal',
    safety_level: 'normal',
    special_requirements: ['防水'],
    recommended_vehicle_class: 'light-cargo',
    candidate_node_ids: ['node-admin-01'],
    needs_manual_review: false,
    missing_fields: [],
    status: TASK_STATUS.APPROVED,
  })

  const route = createRoutePlan({
    id: 'route-demo-001',
    task_id: task.id,
    algorithm: 'A*',
    waypoints: [
      { lng: 118.944736, lat: 32.10747, height: 80, eta: '15:45:00' },
      { lng: 118.9472, lat: 32.1091, height: 80, eta: '15:46:20' },
      { lng: 118.951, lat: 32.114, height: 80, eta: '15:48:10' },
    ],
    main_risk_factors: ['教学区人流', '隐私敏感区'],
    avoided_zones: ['中央主干道'],
    distance_change_percent: 12,
    risk_change_percent: -28,
    total_length_meters: 1680,
    estimated_duration_seconds: 190,
  })

  const approvedRoute = createRoutePlan({
    id: 'route-demo-002',
    task_id: approvedTask.id,
    algorithm: 'A*',
    waypoints: [
      { lng: 118.9492, lat: 32.1082, height: 70, eta: '17:18:00' },
      { lng: 118.9479, lat: 32.1101, height: 70, eta: '17:19:10' },
      { lng: 118.9465, lat: 32.1122, height: 70, eta: '17:20:20' },
    ],
    main_risk_factors: ['教学区人流'],
    avoided_zones: ['中央主干道'],
    distance_change_percent: 8,
    risk_change_percent: -22,
    total_length_meters: 1260,
    estimated_duration_seconds: 150,
  })

  const drones = [
    createDroneState({
      id: 'drone-nju-01',
      name: 'SkyNest-01',
      operator: '演示运营商',
      position: { lng: 118.944736, lat: 32.10747, height: 80 },
      battery_percent: 86,
      status: DRONE_STATUS.IDLE,
    }),
    createDroneState({
      id: 'drone-nju-02',
      name: 'SkyNest-02',
      operator: '演示运营商',
      position: { lng: 118.949, lat: 32.1068, height: 0 },
      battery_percent: 100,
      status: DRONE_STATUS.IDLE,
    }),
  ]

  const nodes = [
    createNestNode({
      id: 'node-lab-01',
      name: '实验楼接驳节点',
      node_type: 'building_nest',
      location: { lng: 118.951, lat: 32.114, height: 25 },
      availability: NODE_AVAILABILITY.RESERVED,
      door_state: DOOR_STATE.CLOSED,
      delivery_state: 'awaiting_arrival',
    }),
    createNestNode({
      id: 'node-library-01',
      name: '图书馆接驳节点',
      node_type: 'building_nest',
      location: { lng: 118.9492, lat: 32.1082, height: 20 },
      availability: NODE_AVAILABILITY.AVAILABLE,
      door_state: DOOR_STATE.CLOSED,
      delivery_state: 'idle',
    }),
    createNestNode({
      id: 'node-south-gate-01',
      name: '南门集散节点',
      node_type: 'campus_hub',
      location: { lng: 118.949, lat: 32.1068, height: 0 },
      availability: NODE_AVAILABILITY.AVAILABLE,
      door_state: DOOR_STATE.OPEN,
      delivery_state: 'loading',
    }),
    createNestNode({
      id: 'node-admin-01',
      name: '行政楼接驳节点',
      node_type: 'building_nest',
      location: { lng: 118.9465, lat: 32.1122, height: 22 },
      availability: NODE_AVAILABILITY.AVAILABLE,
      door_state: DOOR_STATE.CLOSED,
      delivery_state: 'idle',
    }),
  ]

  const approvals = [
    createApprovalRecord({
      id: 'approval-demo-001',
      task_id: task.id,
      decision: APPROVAL_DECISION.PENDING,
      reviewer: { id: 'school-reviewer-01', name: '校方值班员', department: '保卫处' },
      reason: '高风险实验材料，等待人工复核。',
    }),
    createApprovalRecord({
      id: 'approval-demo-002',
      task_id: approvedTask.id,
      decision: APPROVAL_DECISION.APPROVED,
      reviewer: { id: 'school-reviewer-02', name: '校方值班员', department: '保卫处' },
      reason: '普通文件运输，包装和航线符合要求。',
      reviewed_at: '2026-08-03T10:30:00+08:00',
    }),
  ]

  const restrictions = [
    createAirspaceRestriction({
      id: 'restriction-demo-001',
      name: '体育场活动临时避让区',
      center: { lng: 118.9479, lat: 32.1101, height: 0 },
      radius_m: 140,
      reason: '体育场大型活动期间人流密集，禁止无人机进入。',
      status: RESTRICTION_STATUS.ACTIVE,
      start_at: '2026-08-03T08:00:00+08:00',
      end_at: '2026-08-03T20:00:00+08:00',
      created_by: { id: 'school-reviewer-01', name: '校方值班员', department: '保卫处' },
    }),
  ]

  const auditRecords = [
    createAuditRecord({
      id: 'audit-demo-004',
      event_type: 'restriction_created',
      category: AUDIT_CATEGORY.SAFETY,
      title: '临时限制区已生效',
      description: '体育场活动临时避让区已启用，系统开始检测受影响航线。',
      actor: { role: 'school', name: '校方值班员', department: '保卫处' },
      resource: { type: 'restriction', id: 'restriction-demo-001' },
      metadata: { radius_m: 140, reason: '体育场大型活动期间人流密集' },
      created_at: '2026-08-03T11:00:00+08:00',
    }),
    createAuditRecord({
      id: 'audit-demo-003',
      event_type: 'task_approved',
      category: AUDIT_CATEGORY.APPROVAL,
      task_id: approvedTask.id,
      title: '运输任务审核通过',
      description: '图书馆至行政楼的文件运输任务已批准，等待运营商接收。',
      actor: { role: 'school', name: '校方值班员', department: '保卫处' },
      resource: { type: 'task', id: approvedTask.id },
      metadata: { decision: 'approved', reason: '普通文件运输，包装和航线符合要求。' },
      created_at: '2026-08-03T10:30:00+08:00',
    }),
    createAuditRecord({
      id: 'audit-demo-002',
      event_type: 'task_submitted',
      category: AUDIT_CATEGORY.TASK,
      task_id: approvedTask.id,
      title: '运输任务已提交',
      description: '演示教师提交了图书馆至行政楼的文件运输需求。',
      actor: { role: 'student', name: '演示教师', department: '教务处' },
      resource: { type: 'task', id: approvedTask.id },
      metadata: { item_category: '文件图书', weight_kg: 0.8 },
      created_at: '2026-08-03T10:05:00+08:00',
    }),
    createAuditRecord({
      id: 'audit-demo-001',
      event_type: 'task_submitted',
      category: AUDIT_CATEGORY.TASK,
      task_id: task.id,
      title: '高风险运输任务已提交',
      description: '演示用户提交了环境学院至二期实验楼的实验材料运输需求。',
      actor: { role: 'student', name: '演示用户', department: '环境学院' },
      resource: { type: 'task', id: task.id },
      metadata: { item_category: '实验材料', weight_kg: 2, needs_manual_review: true },
      created_at: '2026-08-03T09:45:00+08:00',
    }),
  ]

  return {
    tasks: [task, approvedTask],
    routes: [route, approvedRoute],
    drones,
    nodes,
    approvals,
    restrictions,
    audit_records: auditRecords,
  }
}
