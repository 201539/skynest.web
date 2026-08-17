const { Pool } = require('pg')
const { computeSearchBbox, planRoute } = require('./routePlanner')
const v3Database = require('./v3Database')
const routeStore = require('./routeStore')
const placeResolver = require('./placeResolver')
const auditStore = require('./auditStore')
const routeExplanationService = require('./routeExplanationService')
const { getV3DatabaseConfig } = require('./databaseConfig')

const TIME_ZONE = process.env.SKYNEST_TIME_ZONE || 'Asia/Shanghai'

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function createPool() {
  return new Pool(getV3DatabaseConfig({
    max: parsePositiveInteger(process.env.PG_V3_WRITE_POOL_MAX, 4),
    application_name: 'skynest-task-workflow',
  }))
}

const pool = createPool()

function requiredText(value, fieldName, maximumLength) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new TypeError(`${fieldName} is required`)
  if (normalized.length > maximumLength) {
    throw new RangeError(`${fieldName} cannot exceed ${maximumLength} characters`)
  }
  return normalized
}

function normalizeTaskId(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new TypeError('taskId must be a positive integer')
  return parsed
}

function normalizeDeadline(value) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new TypeError('deadline must be a valid date-time')
  return parsed
}

function normalizePriority(value) {
  const priority = String(value || 'normal')
  return { emergency: 'urgent', urgent: 'urgent', high: 'high', normal: 'normal', low: 'low' }[priority] || 'normal'
}

function normalizeJsonArray(value) {
  return Array.isArray(value) ? value.filter((item) => item != null) : []
}

function validateTask(values = {}) {
  const weight = Number(values.weight_kg)
  if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
    throw new RangeError('weight_kg must be greater than 0 and at most 100')
  }
  const origin = requiredText(values.origin, 'origin', 100)
  const destination = requiredText(values.destination, 'destination', 100)
  if (origin === destination) throw new RangeError('origin and destination cannot be the same')
  return {
    origin,
    destination,
    itemCategory: requiredText(values.item_category, 'item_category', 100),
    itemDescription: requiredText(values.item_description || values.item_category, 'item_description', 200),
    weight,
    deadline: normalizeDeadline(values.deadline),
    priority: normalizePriority(values.priority),
    safetyLevel: String(values.safety_level || 'normal').trim() || 'normal',
    specialRequirements: normalizeJsonArray(values.special_requirements),
    recommendedVehicleClass: values.recommended_vehicle_class || null,
    candidateNodeIds: normalizeJsonArray(values.candidate_node_ids),
    needsManualReview: Boolean(values.needs_manual_review),
    missingFields: normalizeJsonArray(values.missing_fields),
    inputText: String(values.input_text || '').trim() || null,
    requester: values.requester && typeof values.requester === 'object' ? values.requester : {},
    agentAnalysis: values.agent_analysis && typeof values.agent_analysis === 'object'
      ? values.agent_analysis
      : null,
  }
}

function normalizeTask(row) {
  const frontendStatus = {
    submitted: 'pending_review',
    parsed: 'pending_review',
    reviewing: 'pending_review',
    planning: 'approved',
    planned: 'approved',
    replanned: 'approved',
    running: 'in_transit',
    completed: 'delivered',
    aborted: 'cancelled',
    suspended: 'exception',
  }[row.status] || row.status
  return {
    id: Number(row.task_id),
    input_text: row.input_text || '',
    requester: row.requester || {},
    origin: row.origin,
    destination: row.destination,
    item_category: row.item_category,
    item_description: row.item_description || row.item_category,
    weight_kg: row.weight_kg == null ? null : Number(row.weight_kg),
    deadline: row.deadline,
    priority: row.priority,
    safety_level: row.safety_level,
    special_requirements: row.special_requirements || [],
    recommended_vehicle_class: row.recommended_vehicle_class,
    candidate_node_ids: row.candidate_node_ids || [],
    assigned_drone_id: row.assigned_drone_id == null ? null : Number(row.assigned_drone_id),
    assigned_node_id: row.assigned_node_id == null ? null : Number(row.assigned_node_id),
    needs_manual_review: Boolean(row.needs_manual_review),
    missing_fields: row.missing_fields || [],
    agent_analysis: row.agent_analysis || null,
    risk_score: row.risk_score == null ? null : Number(row.risk_score),
    status: frontendStatus,
    database_status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || null,
    exception_reason: row.exception_reason || null,
    suspended_at: row.suspended_at || null,
  }
}

function normalizeAssignedDrone(row, taskStatus) {
  if (!row.assigned_drone_id || !row.drone_code) return null
  const status = row.drone_status === 'task'
    ? (['running', 'arriving'].includes(taskStatus) ? 'in_flight' : 'assigned')
    : row.drone_status === 'maintenance' ? 'fault' : row.drone_status
  return {
    id: Number(row.assigned_drone_id),
    name: row.drone_model || row.drone_code,
    code: row.drone_code,
    operator: 'SkyNest 运营调度',
    vehicle_class: row.drone_vehicle_class || 'light',
    battery_percent: row.drone_battery_level == null ? null : Number(row.drone_battery_level),
    status,
    task_id: row.drone_task_id == null ? null : Number(row.drone_task_id),
    updated_at: row.drone_updated_at,
  }
}

function normalizeAssignedNode(row) {
  if (!row.assigned_node_id || !row.node_name) return null
  return {
    id: Number(row.assigned_node_id),
    code: row.node_code,
    name: row.node_name,
    node_type: row.node_type,
    availability: row.node_availability || 'available',
    door_state: row.node_door_state || 'closed',
    delivery_state: row.node_delivery_state || 'idle',
    fault_code: row.node_fault_code || null,
    task_id: row.node_task_id == null ? null : Number(row.node_task_id),
    updated_at: row.node_state_updated_at || row.node_updated_at,
  }
}

function normalizeApproval(row) {
  if (!row.approval_id) return null
  return {
    id: Number(row.approval_id),
    task_id: Number(row.task_id),
    decision: row.action === 'approved' ? 'approved' : row.action === 'rejected' ? 'rejected' : 'pending',
    reviewer: { name: row.approver || '校方审核员', department: '' },
    reason: row.comment || '',
    reviewed_at: row.created_at,
  }
}

function normalizeRoute(row) {
  if (!row.route_id) return null
  const planningContext = row.planning_context || {}
  const distance = row.distance_m == null ? null : Number(row.distance_m)
  const route = {
    id: Number(row.route_id),
    task_id: Number(row.task_id),
    algorithm: row.algorithm || 'A*',
    cost_model: row.cost_model,
    waypoints: Array.isArray(row.waypoints) ? row.waypoints : [],
    points: Array.isArray(row.waypoints) ? row.waypoints : [],
    main_risk_factors: row.main_risk_factors || [],
    avoided_zones: row.avoided_zones || [],
    distance_change_percent: row.distance_change_percent == null ? null : Number(row.distance_change_percent),
    risk_change_percent: row.risk_change_percent == null ? null : Number(row.risk_change_percent),
    total_length_meters: distance,
    estimated_duration_seconds: distance == null ? null : Math.max(25, Math.min(120, Math.round(distance / 25))),
    generated_at: row.route_created_at,
    status: row.route_status,
    route_type: row.route_type,
    is_current: Boolean(row.is_current),
    planning_context: planningContext,
    cost_breakdown: row.cost_breakdown || null,
  }
  route.explanation = routeExplanationService.explainRoute(route)
  return route
}

const WORKSPACE_QUERY = `
  SELECT
    t.*,
    a.approval_id, a.action, a.approver, a.comment, a.created_at AS approval_created_at,
    r.route_id, r.route_type, r.waypoints, r.main_risk_factors, r.avoided_zones,
    r.distance_m, r.distance_change_percent, r.risk_change_percent,
    r.algorithm, r.cost_model, r.planning_context, r.cost_breakdown, r.status AS route_status,
    r.is_current, r.created_at AS route_created_at,
    d.drone_code, d.model AS drone_model, d.vehicle_class AS drone_vehicle_class,
    d.battery_level AS drone_battery_level, d.status AS drone_status,
    d.task_id AS drone_task_id, d.updated_at AS drone_updated_at,
    n.node_code, n.node_name, n.node_type, n.updated_at AS node_updated_at,
    ns.availability AS node_availability, ns.door_state AS node_door_state,
    ns.delivery_state AS node_delivery_state, ns.fault_code AS node_fault_code,
    ns.task_id AS node_task_id, ns.updated_at AS node_state_updated_at
  FROM runtime.tasks t
  LEFT JOIN LATERAL (
    SELECT approval_id, action, approver, comment, created_at
    FROM runtime.approvals
    WHERE task_id = t.task_id
    ORDER BY created_at DESC, approval_id DESC
    LIMIT 1
  ) a ON true
  LEFT JOIN runtime.routes r ON r.task_id = t.task_id AND r.is_current
  LEFT JOIN runtime.drones d ON d.drone_id = t.assigned_drone_id
  LEFT JOIN static.fixed_nodes n ON n.node_id = t.assigned_node_id
  LEFT JOIN runtime.node_states ns ON ns.node_id = t.assigned_node_id
`

function normalizeWorkspaceRow(row) {
  return {
    task: normalizeTask(row),
    approval: normalizeApproval({
      approval_id: row.approval_id,
      task_id: row.task_id,
      action: row.action,
      approver: row.approver,
      comment: row.comment,
      created_at: row.approval_created_at,
    }),
    route: normalizeRoute(row),
    assigned_drone: normalizeAssignedDrone(row, row.status),
    assigned_node: normalizeAssignedNode(row),
  }
}

async function createTask(values = {}, options = {}) {
  const task = validateTask(values)
  const client = options.client || await pool.connect()
  const ownsClient = !options.client
  try {
    if (ownsClient) await client.query('BEGIN')
    const result = await client.query(
    `
      INSERT INTO runtime.tasks (
        origin, destination, item_category, weight_kg, deadline, priority,
        safety_level, special_requirements, recommended_vehicle_class,
        candidate_node_ids, needs_manual_review, missing_fields,
        status, input_text, requester, agent_analysis, item_description
      ) VALUES (
        $1, $2, $3, $4, $5::timestamptz AT TIME ZONE $16, $6,
        $7, $8::jsonb, $9, $10::jsonb, $11, $12::jsonb,
        'submitted', $13, $14::jsonb, $15::jsonb, $17
      )
      RETURNING *
    `,
    [
      task.origin,
      task.destination,
      task.itemCategory,
      task.weight,
      task.deadline.toISOString(),
      task.priority,
      task.safetyLevel,
      JSON.stringify(task.specialRequirements),
      task.recommendedVehicleClass,
      JSON.stringify(task.candidateNodeIds),
      task.needsManualReview,
      JSON.stringify(task.missingFields),
      task.inputText,
      JSON.stringify(task.requester),
      task.agentAnalysis ? JSON.stringify(task.agentAnalysis) : null,
      TIME_ZONE,
      task.itemDescription,
    ]
  )
    const saved = normalizeTask(result.rows[0])
    await auditStore.appendEvent({
      event_type: 'task_submitted',
      category: 'task',
      task_id: saved.id,
      title: '运输任务已提交',
      description: `${saved.origin}至${saved.destination}的运输任务已进入校方审核。`,
      actor: {
        role: 'student',
        name: saved.requester?.name || '师生用户',
        department: saved.requester?.department || '',
      },
      resource: { type: 'task', id: saved.id },
      metadata: {
        item_category: saved.item_category,
        weight_kg: saved.weight_kg,
        needs_manual_review: saved.needs_manual_review,
      },
    }, { client })
    if (ownsClient) await client.query('COMMIT')
    return saved
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

async function resubmitRejectedTask(taskId, values = {}, options = {}) {
  const id = normalizeTaskId(taskId)
  const task = validateTask(values)
  const requesterId = requiredText(options.requesterId, 'requesterId', 100)
  const client = options.client || await pool.connect()
  const ownsClient = !options.client
  try {
    if (ownsClient) await client.query('BEGIN')
    const currentResult = await client.query(
      'SELECT * FROM runtime.tasks WHERE task_id = $1 FOR UPDATE',
      [id]
    )
    if (!currentResult.rowCount) {
      const error = new Error(`Task ${id} does not exist`)
      error.code = 'TASK_NOT_FOUND'
      throw error
    }

    const current = currentResult.rows[0]
    if (String(current.requester?.id || '') !== requesterId) {
      const error = new Error('只能修改本人提交的任务')
      error.code = 'PERMISSION_DENIED'
      error.status = 403
      throw error
    }
    if (current.status !== 'rejected') {
      const error = new Error('只有已驳回的任务可以修改后重新提交')
      error.code = 'TASK_NOT_RESUBMITTABLE'
      throw error
    }

    const result = await client.query(
      `
        UPDATE runtime.tasks
        SET
          origin = $2,
          destination = $3,
          item_category = $4,
          weight_kg = $5,
          deadline = $6::timestamptz AT TIME ZONE $16,
          priority = $7,
          safety_level = $8,
          special_requirements = $9::jsonb,
          recommended_vehicle_class = $10,
          candidate_node_ids = $11::jsonb,
          needs_manual_review = $12,
          missing_fields = $13::jsonb,
          input_text = $14,
          agent_analysis = $15::jsonb,
          item_description = $17,
          status = 'submitted',
          assigned_drone_id = NULL,
          assigned_node_id = NULL,
          updated_at = now()
        WHERE task_id = $1
        RETURNING *
      `,
      [
        id,
        task.origin,
        task.destination,
        task.itemCategory,
        task.weight,
        task.deadline.toISOString(),
        task.priority,
        task.safetyLevel,
        JSON.stringify(task.specialRequirements),
        task.recommendedVehicleClass,
        JSON.stringify(task.candidateNodeIds),
        task.needsManualReview,
        JSON.stringify(task.missingFields),
        task.inputText,
        task.agentAnalysis ? JSON.stringify(task.agentAnalysis) : null,
        TIME_ZONE,
        task.itemDescription,
      ]
    )
    const saved = normalizeTask(result.rows[0])
    await auditStore.appendEvent({
      event_type: 'task_resubmitted',
      category: 'task',
      task_id: saved.id,
      title: '驳回任务已修改并重新提交',
      description: `${saved.origin}至${saved.destination}的运输任务已根据审核意见修改，并重新进入校方审核。`,
      actor: {
        role: 'student',
        name: options.requester?.name || current.requester?.name || '师生用户',
        department: options.requester?.department || current.requester?.department || '',
      },
      resource: { type: 'task', id: saved.id },
      metadata: {
        previous_status: current.status,
        previous_origin: current.origin,
        previous_destination: current.destination,
        item_category: saved.item_category,
        weight_kg: saved.weight_kg,
        needs_manual_review: saved.needs_manual_review,
      },
    }, { client })
    if (ownsClient) await client.query('COMMIT')
    return getTaskWorkspace(id, { client })
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

async function listWorkspace(options = {}) {
  const client = options.client || pool
  const result = await client.query(
    `${WORKSPACE_QUERY}
     WHERE ($1::text[] IS NULL OR t.status = ANY($1::text[]))
       AND ($2::text IS NULL OR t.requester->>'id' = $2)
     ORDER BY t.created_at DESC, t.task_id DESC
     LIMIT 500`,
    [options.statuses?.length ? options.statuses : null, options.requesterId || null]
  )
  return result.rows.map(normalizeWorkspaceRow)
}

async function getTaskWorkspace(taskId, options = {}) {
  const id = normalizeTaskId(taskId)
  const client = options.client || pool
  const result = await client.query(`${WORKSPACE_QUERY} WHERE t.task_id = $1`, [id])
  if (!result.rowCount) {
    const error = new Error(`Task ${id} does not exist`)
    error.code = 'TASK_NOT_FOUND'
    throw error
  }
  return normalizeWorkspaceRow(result.rows[0])
}

async function resolveTaskPlaces(task, client, options = {}) {
  const resolver = options.placeResolver || placeResolver.resolvePlace
  const flightHeight = Number(options.flightHeight || process.env.DEFAULT_FLIGHT_HEIGHT || 80)
  const [start, end] = await Promise.all([
    resolver(task.origin, { client, height: flightHeight, role: 'departure' }),
    resolver(task.destination, { client, height: flightHeight, role: 'receiving' }),
  ])
  return { start, end }
}

async function createApprovedRoute(task, client, options = {}) {
  const places = await resolveTaskPlaces(task, client, options)
  const groundHeight = Number(options.groundHeight || process.env.GROUND_HEIGHT || 50)
  const gridSize = Number(options.gridSize || 48)
  const searchBBox = computeSearchBbox(places.start, places.end, { minPad: 0.002, ratio: 0.3 })
  const surfaceProvider = options.surfaceProvider || v3Database.getDynamicCostSurface
  const plan = await planRoute(null, places.start, places.end, {
    searchBBox,
    groundHeight,
    minScore: options.minScore ?? 0.25,
    gridSize,
    simplifyToleranceMeters: options.simplifyToleranceMeters ?? 8,
    startName: task.origin,
    endName: task.destination,
    accessPoints: {
      departure: places.start,
      receiving: places.end,
    },
    routeName: `${task.origin} → ${task.destination}`,
    dynamicCostSurfaceProvider: surfaceProvider,
    requireDynamicCost: true,
    planningAt: options.planningAt || new Date().toISOString(),
    timeZone: options.timeZone || TIME_ZONE,
    dynamicCostOptions: { profile: options.costProfile || 'balanced' },
  })
  const persisted = await (options.routeStore || routeStore).persistPlan(plan, {
    taskId: task.id,
    preserveTaskStatus: true,
    start: places.start,
    end: places.end,
    startName: task.origin,
    endName: task.destination,
    accessPoints: {
      departure: places.start,
      receiving: places.end,
    },
    groundHeight,
    minScore: options.minScore ?? 0.25,
    gridSize,
    simplifyToleranceMeters: options.simplifyToleranceMeters ?? 8,
    costProfile: options.costProfile || 'balanced',
    planningAt: plan.dynamicCost?.sampledAt,
    timeZone: options.timeZone || TIME_ZONE,
  }, { client })
  return { plan, persisted, places }
}

async function reviewTask(taskId, review = {}, options = {}) {
  const id = normalizeTaskId(taskId)
  const decision = String(review.decision || '')
  if (!['approved', 'rejected'].includes(decision)) throw new TypeError('decision must be approved or rejected')
  const reason = String(review.reason || '').trim()
  if (decision === 'rejected' && !reason) throw new TypeError('reason is required when rejecting a task')
  const reviewer = review.reviewer && typeof review.reviewer === 'object'
    ? [review.reviewer.name, review.reviewer.department].filter(Boolean).join(' · ')
    : String(review.reviewer || '')

  const client = options.client || await pool.connect()
  const ownsClient = !options.client
  try {
    if (ownsClient) await client.query('BEGIN')
    const taskResult = await client.query('SELECT * FROM runtime.tasks WHERE task_id = $1 FOR UPDATE', [id])
    if (!taskResult.rowCount) {
      const error = new Error(`Task ${id} does not exist`)
      error.code = 'TASK_NOT_FOUND'
      throw error
    }
    if (!['submitted', 'parsed', 'reviewing'].includes(taskResult.rows[0].status)) {
      const error = new Error('Task has already been reviewed')
      error.code = 'TASK_ALREADY_REVIEWED'
      throw error
    }

    let routeResult = null
    if (decision === 'approved') {
      routeResult = await createApprovedRoute(normalizeTask(taskResult.rows[0]), client, options)
    }
    const routeId = routeResult?.persisted?.route_id || null
    await client.query(
      `INSERT INTO runtime.approvals (task_id, route_id, approver, action, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, routeId, reviewer || '校方审核员', decision, reason || '任务信息与安全条件符合要求。']
    )
    await client.query(
      `UPDATE runtime.tasks SET status = $2, updated_at = now() WHERE task_id = $1`,
      [id, decision]
    )
    await auditStore.appendEvent({
      event_type: decision === 'approved' ? 'task_approved' : 'task_rejected',
      category: 'approval',
      task_id: id,
      title: decision === 'approved' ? '运输任务审核通过' : '运输任务已驳回',
      description: `${taskResult.rows[0].origin}至${taskResult.rows[0].destination}的任务${decision === 'approved' ? '已批准并等待运营商接收。' : '未通过校方审核。'}`,
      actor: {
        role: 'school',
        name: review.reviewer?.name || reviewer || '校方审核员',
        department: review.reviewer?.department || '',
      },
      resource: { type: 'task', id },
      metadata: { decision, reason, route_id: routeId },
    }, { client })
    if (ownsClient) await client.query('COMMIT')
    return getTaskWorkspace(id, { client })
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

async function close() {
  await pool.end()
}

module.exports = {
  validateTask,
  createTask,
  resubmitRejectedTask,
  listWorkspace,
  getTaskWorkspace,
  reviewTask,
  createApprovedRoute,
  close,
  _pool: pool,
}
