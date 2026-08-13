const { planRoute } = require('./routePlanner')
const auditStore = require('./auditStore')
const restrictionStore = require('./restrictionStore')
const routeStore = require('./routeStore')
const taskWorkflowStore = require('./taskWorkflowStore')
const v3Database = require('./v3Database')
const { inspectRouteRestrictionConflict } = require('./routeRestriction')

const pool = taskWorkflowStore._pool
const REPLANNABLE_STATUSES = new Set(['approved', 'planned', 'replanned', 'dispatched', 'running', 'arriving'])
const EMERGENCY_STOP_STATUSES = new Set(['dispatched', 'running', 'arriving'])

function positiveId(value, fieldName) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`)
  }
  return parsed
}

function requiredReason(value) {
  const reason = String(value || '').trim()
  if (!reason) throw new TypeError('reason is required')
  if (reason.length > 500) throw new RangeError('reason cannot exceed 500 characters')
  return reason
}

function conflict(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function planOptions(route, surfaceProvider) {
  const context = route.planning_context || {}
  return {
    searchBBox: context.search_bbox,
    groundHeight: context.ground_height,
    minScore: context.min_score,
    gridSize: context.grid_size,
    simplifyToleranceMeters: context.simplify_tolerance_meters,
    startName: context.start_name,
    endName: context.end_name,
    routeName: `${context.start_name || '任务起点'} → ${context.end_name || '任务终点'}`,
    dynamicCostSurfaceProvider: surfaceProvider,
    requireDynamicCost: true,
    planningAt: new Date().toISOString(),
    timeZone: context.time_zone || 'Asia/Shanghai',
    dynamicCostOptions: {
      profile: context.cost_profile || 'balanced',
      weights: context.cost_weights,
      thresholds: {
        ...(context.min_score != null ? { minSuitability: context.min_score } : {}),
        ...(context.cost_thresholds || {}),
      },
    },
  }
}

function persistenceContext(taskId, route, plan) {
  const context = route.planning_context || {}
  return {
    taskId,
    preserveTaskStatus: true,
    start: context.start,
    end: context.end,
    startName: context.start_name,
    endName: context.end_name,
    groundHeight: context.ground_height,
    minScore: context.min_score,
    gridSize: context.grid_size,
    simplifyToleranceMeters: context.simplify_tolerance_meters,
    costProfile: context.cost_profile,
    costWeights: context.cost_weights,
    costThresholds: context.cost_thresholds,
    planningAt: plan.dynamicCost?.sampledAt,
    timeZone: context.time_zone || 'Asia/Shanghai',
  }
}

async function manualReplanTask(taskId, values = {}, options = {}) {
  const id = positiveId(taskId, 'taskId')
  const restrictionId = positiveId(values.restriction_id, 'restriction_id')
  const client = options.client || await pool.connect()
  const ownsClient = !options.client
  try {
    if (ownsClient) await client.query('BEGIN')
    const taskResult = await client.query(
      'SELECT * FROM runtime.tasks WHERE task_id = $1 FOR UPDATE',
      [id]
    )
    if (!taskResult.rowCount) throw conflict(`Task ${id} does not exist`, 'TASK_NOT_FOUND')
    const task = taskResult.rows[0]
    if (!REPLANNABLE_STATUSES.has(task.status)) {
      throw conflict('当前任务状态不能重新规划航线', 'TASK_NOT_REPLANNABLE')
    }

    const routeResult = await client.query(
      `SELECT * FROM runtime.routes
       WHERE task_id = $1 AND is_current
       FOR UPDATE`,
      [id]
    )
    if (!routeResult.rowCount) throw conflict('该任务尚未生成可重新规划的航线', 'TASK_ROUTE_MISSING')
    const currentRoute = routeResult.rows[0]
    const context = currentRoute.planning_context || {}
    const currentWaypoints = Array.isArray(currentRoute.waypoints) ? currentRoute.waypoints : []
    const start = context.start || currentWaypoints[0]
    const end = context.end || currentWaypoints.at(-1)
    if (!start || !end) throw conflict('当前航线缺少起终点规划信息', 'TASK_ROUTE_CONTEXT_MISSING')

    const restriction = await restrictionStore.getRestriction(restrictionId, { client })
    if (restriction.status !== 'active') {
      throw conflict('触发限制区不存在或未启用', 'RESTRICTION_NOT_ACTIVE')
    }
    const originalConflict = inspectRouteRestrictionConflict({ waypoints: currentWaypoints }, restriction)
    if (!originalConflict.conflicts) {
      throw conflict('当前航线未穿越该限制区，无需重新规划', 'ROUTE_NO_RESTRICTION_CONFLICT')
    }

    const surfaceProvider = options.surfaceProvider || v3Database.getDynamicCostSurface
    const plan = await planRoute(null, start, end, planOptions(currentRoute, surfaceProvider))
    const remainingConflict = inspectRouteRestrictionConflict(
      { waypoints: plan.route.points },
      restriction
    )
    if (remainingConflict.conflicts) {
      const error = conflict('重新规划结果仍与限制区冲突，请转人工处置', 'REPLAN_CONFLICT_REMAINS')
      error.details = { restriction_id: restrictionId, conflict: remainingConflict }
      throw error
    }

    await routeStore.persistPlan(
      plan,
      persistenceContext(id, currentRoute, plan),
      {
        client,
        previousRouteId: Number(currentRoute.route_id),
        trigger: {
          type: 'manual_restriction_replan',
          actor: values.actor || '校方安全管控员',
          restriction_id: restrictionId,
          restriction_name: restriction.name,
          original_conflict: originalConflict,
          safety_buffer_meters: remainingConflict.safety_buffer_meters,
          changes: [{ table: 'no_fly_zones', operation: 'manual_replan', record_id: String(restrictionId) }],
          processed_at: new Date().toISOString(),
        },
      }
    )
    if (ownsClient) await client.query('COMMIT')
    return restrictionStore.getSafetyWorkspace({ client })
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

async function emergencyStopTask(taskId, values = {}, options = {}) {
  const id = positiveId(taskId, 'taskId')
  const reason = requiredReason(values.reason)
  const actor = String(values.actor || '校方安全管控员').trim() || '校方安全管控员'
  const client = options.client || await pool.connect()
  const ownsClient = !options.client
  try {
    if (ownsClient) await client.query('BEGIN')
    const taskResult = await client.query(
      'SELECT * FROM runtime.tasks WHERE task_id = $1 FOR UPDATE',
      [id]
    )
    if (!taskResult.rowCount) throw conflict(`Task ${id} does not exist`, 'TASK_NOT_FOUND')
    const task = taskResult.rows[0]
    if (!EMERGENCY_STOP_STATUSES.has(task.status)) {
      throw conflict('该任务当前不在可熔断状态', 'TASK_NOT_STOPPABLE')
    }

    let drone = null
    let node = null
    if (task.assigned_drone_id) {
      const droneResult = await client.query(
        'SELECT * FROM runtime.drones WHERE drone_id = $1 FOR UPDATE',
        [task.assigned_drone_id]
      )
      drone = droneResult.rows[0] || null
    }
    if (task.assigned_node_id) {
      const nodeResult = await client.query(
        'SELECT * FROM runtime.node_states WHERE node_id = $1 FOR UPDATE',
        [task.assigned_node_id]
      )
      node = nodeResult.rows[0] || null
    }

    await client.query(
      `UPDATE runtime.tasks
       SET status = 'suspended', exception_reason = $2,
           suspended_at = now(), updated_at = now()
       WHERE task_id = $1`,
      [id, reason]
    )
    if (drone) {
      await client.query(
        `UPDATE runtime.drones
         SET status = 'returning', task_id = NULL, updated_at = now()
         WHERE drone_id = $1`,
        [drone.drone_id]
      )
    }
    if (node) {
      await client.query(
        `UPDATE runtime.node_states
         SET availability = 'available', door_state = 'closed',
             delivery_state = 'interrupted', task_id = NULL, updated_at = now()
         WHERE node_id = $1`,
        [node.node_id]
      )
    }

    const details = {
      reason,
      previous_status: task.status,
      task_status: 'exception',
      drone_id: drone ? Number(drone.drone_id) : null,
      drone_status: drone ? 'returning' : null,
      node_id: node ? Number(node.node_id) : null,
      node_availability: node ? 'available' : null,
    }
    await client.query(
      `INSERT INTO runtime.operation_events (task_id, event_type, actor, details)
       VALUES ($1, 'emergency_stop', $2, $3::jsonb)`,
      [id, actor, JSON.stringify(details)]
    )
    await auditStore.appendEvent({
      event_type: 'emergency_stop',
      category: 'safety',
      task_id: id,
      title: '飞行任务已执行安全熔断',
      description: `${task.origin}至${task.destination}的任务已暂停，返航处置已启动，运输资源已释放。`,
      actor: { role: 'school', name: actor, department: '校园管理部门' },
      resource: { type: 'task', id },
      metadata: details,
    }, { client })
    if (ownsClient) await client.query('COMMIT')
    return restrictionStore.getSafetyWorkspace({ client })
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

module.exports = {
  manualReplanTask,
  emergencyStopTask,
  _inspectRouteRestrictionConflict: inspectRouteRestrictionConflict,
}
