const taskWorkflowStore = require('./taskWorkflowStore')
const auditStore = require('./auditStore')
const droneRecommendationService = require('./droneRecommendationService')

const pool = taskWorkflowStore._pool
// 展示临时开关：明日演示期间允许“接收并派发”覆盖资源占用状态。
// TODO: 展示结束后设置 DEMO_FORCE_DISPATCH=false，恢复正式的无人机/节点互斥校验。
const DEMO_FORCE_DISPATCH = process.env.DEMO_FORCE_DISPATCH !== 'false'
const OPERATOR_DATABASE_STATUSES = [
  'approved', 'planned', 'replanned', 'dispatched', 'running',
  'arriving', 'completed', 'suspended',
]

function positiveId(value, fieldName) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`)
  }
  return parsed
}

function conflict(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function plannedReceivingNodeId(route) {
  const accessPoint = route?.planning_context?.access_points?.receiving
  const nodeId = Number(accessPoint?.node_id ?? accessPoint?.id)
  return Number.isInteger(nodeId) && nodeId > 0 ? nodeId : null
}

function frontendTaskStatus(databaseStatus) {
  return {
    planning: 'approved',
    planned: 'approved',
    replanned: 'approved',
    running: 'in_transit',
    completed: 'delivered',
    suspended: 'exception',
    aborted: 'cancelled',
  }[databaseStatus] || databaseStatus
}

function frontendDroneStatus(databaseStatus, taskStatus) {
  if (databaseStatus !== 'task') {
    return {
      maintenance: 'fault',
    }[databaseStatus] || databaseStatus
  }
  return ['running', 'arriving'].includes(taskStatus) ? 'in_flight' : 'assigned'
}

function normalizeDrone(row) {
  return {
    id: Number(row.drone_id),
    name: row.model || row.drone_code,
    code: row.drone_code,
    operator: 'SkyNest 运营调度',
    vehicle_class: row.vehicle_class || 'light',
    position: row.lng == null || row.lat == null
      ? { lng: null, lat: null, height: Number(row.altitude || 0) }
      : { lng: Number(row.lng), lat: Number(row.lat), height: Number(row.altitude || 0) },
    battery_percent: row.battery_level == null ? null : Number(row.battery_level),
    payload_kg: row.payload_kg == null ? null : Number(row.payload_kg),
    range_km: row.range_km == null ? null : Number(row.range_km),
    status: frontendDroneStatus(row.status, row.task_status),
    task_id: row.task_id == null ? null : Number(row.task_id),
    updated_at: row.updated_at,
  }
}

function normalizeNode(row) {
  const fallbackAvailability = row.static_status === 'active'
    ? 'available'
    : row.static_status === 'maintenance' ? 'maintenance' : 'offline'
  return {
    id: Number(row.node_id),
    code: row.node_code,
    name: row.node_name,
    node_type: row.node_type,
    location: row.lng == null || row.lat == null
      ? { lng: null, lat: null, height: null }
      : { lng: Number(row.lng), lat: Number(row.lat), height: null },
    capacity: Number(row.capacity || 1),
    availability: row.availability || fallbackAvailability,
    door_state: row.door_state || 'closed',
    delivery_state: row.delivery_state || 'idle',
    fault_code: row.fault_code || null,
    task_id: row.node_task_id == null ? null : Number(row.node_task_id),
    updated_at: row.state_updated_at || row.static_updated_at,
  }
}

async function listDrones(client) {
  const result = await client.query(`
    SELECT
      d.*,
      ST_X(d.location) AS lng,
      ST_Y(d.location) AS lat,
      t.status AS task_status
    FROM runtime.drones d
    LEFT JOIN runtime.tasks t ON t.task_id = d.task_id
    ORDER BY d.drone_id
  `)
  return result.rows.map(normalizeDrone)
}

async function listNodes(client) {
  const result = await client.query(`
    SELECT
      n.node_id, n.node_code, n.node_name, n.node_type,
      n.capacity, n.status AS static_status, n.updated_at AS static_updated_at,
      ST_X(n.location) AS lng, ST_Y(n.location) AS lat,
      s.availability, s.door_state, s.delivery_state, s.fault_code,
      s.task_id AS node_task_id, s.updated_at AS state_updated_at
    FROM static.fixed_nodes n
    LEFT JOIN runtime.node_states s ON s.node_id = n.node_id
    WHERE n.node_type IN ('landing', 'transfer', 'relay')
    ORDER BY n.node_id
  `)
  return result.rows.map(normalizeNode)
}

async function getOperatorWorkspace(options = {}) {
  const client = options.client || pool
  const tasks = await taskWorkflowStore.listWorkspace({ client, statuses: OPERATOR_DATABASE_STATUSES })
  for (const item of tasks) {
    if (item.route && item.task.status === 'approved') {
      item.drone_recommendation = await droneRecommendationService.evaluateTaskCandidates(client, item.task.id)
    }
  }
  const drones = await listDrones(client)
  const nodes = await listNodes(client)
  return {
    source: 'v3',
    updated_at: new Date().toISOString(),
    tasks,
    drones,
    nodes,
  }
}

async function addEvent(client, taskId, eventType, actor, details) {
  await client.query(
    `INSERT INTO runtime.operation_events (task_id, event_type, actor, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [taskId, eventType, actor || '运营调度员', JSON.stringify(details || {})]
  )
}

async function dispatchTask(taskId, assignment = {}, options = {}) {
  const id = positiveId(taskId, 'taskId')
  const droneId = positiveId(assignment.drone_id, 'drone_id')
  const nodeId = positiveId(assignment.node_id, 'node_id')
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
    if (!['approved', 'planned', 'replanned'].includes(task.status)) {
      throw conflict('只有已批准且完成航线规划的任务可以派发', 'TASK_NOT_DISPATCHABLE')
    }
    const routeResult = await client.query(
      `SELECT route_id, planning_context FROM runtime.routes
       WHERE task_id = $1 AND is_current
       ORDER BY created_at DESC, route_id DESC LIMIT 1`,
      [id]
    )
    if (!routeResult.rowCount) throw conflict('任务尚未生成可执行航线', 'TASK_ROUTE_MISSING')
    const routeNodeId = plannedReceivingNodeId(routeResult.rows[0])
    if (routeNodeId != null && nodeId !== routeNodeId) {
      throw conflict(`所选接驳节点与当前航线终点不一致，必须使用节点 ${routeNodeId}`, 'NODE_ROUTE_MISMATCH')
    }

    const droneResult = await client.query(
      'SELECT * FROM runtime.drones WHERE drone_id = $1 FOR UPDATE',
      [droneId]
    )
    if (!droneResult.rowCount) throw conflict('所选无人机不存在', 'DRONE_NOT_FOUND')
    const drone = droneResult.rows[0]
    if (!DEMO_FORCE_DISPATCH && (drone.status !== 'idle' || drone.task_id != null)) {
      throw conflict('所选无人机已被其他任务占用', 'DRONE_UNAVAILABLE')
    }
    if (!DEMO_FORCE_DISPATCH && drone.battery_level != null && Number(drone.battery_level) < 20) {
      throw conflict('所选无人机电量低于20%，不能执行任务', 'DRONE_BATTERY_LOW')
    }
    if (!DEMO_FORCE_DISPATCH && drone.payload_kg != null && task.weight_kg != null && Number(drone.payload_kg) < Number(task.weight_kg)) {
      throw conflict('所选无人机载重不足', 'DRONE_PAYLOAD_EXCEEDED')
    }
    const candidateResult = await client.query(
      `SELECT is_eligible, recommendation_reason FROM runtime.task_drone_candidates
       WHERE task_id=$1 AND route_id=$2 AND drone_id=$3
       ORDER BY evaluated_at DESC LIMIT 1`,
      [id, routeResult.rows[0].route_id, droneId]
    )
    if (!DEMO_FORCE_DISPATCH && candidateResult.rowCount && !candidateResult.rows[0].is_eligible) {
      throw conflict(`所选无人机不满足当前任务：${candidateResult.rows[0].recommendation_reason}`, 'DRONE_REQUIREMENTS_MISMATCH')
    }

    await client.query(
      `INSERT INTO runtime.node_states (node_id)
       VALUES ($1) ON CONFLICT (node_id) DO NOTHING`,
      [nodeId]
    )
    const nodeResult = await client.query(
      `SELECT n.*, s.availability, s.task_id AS node_task_id
       FROM static.fixed_nodes n
       JOIN runtime.node_states s ON s.node_id = n.node_id
       WHERE n.node_id = $1
       FOR UPDATE OF n, s`,
      [nodeId]
    )
    if (!nodeResult.rowCount) throw conflict('所选接驳节点不存在', 'NODE_NOT_FOUND')
    const node = nodeResult.rows[0]
    if (!DEMO_FORCE_DISPATCH && (node.status !== 'active' || node.availability !== 'available' || node.node_task_id != null)) {
      throw conflict('所选接驳节点当前不可用', 'NODE_UNAVAILABLE')
    }
    if (!['landing', 'transfer', 'relay'].includes(node.node_type)) {
      throw conflict('所选节点不是接驳节点', 'NODE_TYPE_INVALID')
    }

    if (DEMO_FORCE_DISPATCH) {
      // 展示专用：避免唯一资源残留在旧任务上导致演示流程中断。
      // TODO: 正式环境删除此覆盖逻辑，只允许资源释放后再派发。
      await client.query(
        `UPDATE runtime.drones
         SET status = 'idle', task_id = NULL, updated_at = now()
         WHERE task_id = $1 AND drone_id <> $2`,
        [id, droneId]
      )
      await client.query(
        `UPDATE runtime.node_states
         SET availability = 'available', door_state = 'closed', delivery_state = 'idle',
             task_id = NULL, updated_at = now()
         WHERE task_id = $1 AND node_id <> $2`,
        [id, nodeId]
      )
      await client.query(
        'UPDATE runtime.tasks SET assigned_drone_id = NULL, updated_at = now() WHERE assigned_drone_id = $1 AND task_id <> $2',
        [droneId, id]
      )
      await client.query(
        'UPDATE runtime.tasks SET assigned_node_id = NULL, updated_at = now() WHERE assigned_node_id = $1 AND task_id <> $2',
        [nodeId, id]
      )
    }

    await client.query(
      `UPDATE runtime.tasks
       SET assigned_drone_id = $2, assigned_node_id = $3,
           resource_confirmed_at = CASE WHEN $4::boolean THEN now() ELSE resource_confirmed_at END,
           resource_confirmed_by = CASE WHEN $4::boolean THEN $5 ELSE resource_confirmed_by END,
           selection_reason = $6,
           status = 'dispatched', updated_at = now()
       WHERE task_id = $1`,
      [id, droneId, nodeId, assignment.confirmed === true, assignment.actor || '运营调度员', assignment.selection_reason || null]
    )
    await client.query(
      `UPDATE runtime.drones
       SET status = 'task', task_id = $2, updated_at = now()
       WHERE drone_id = $1`,
      [droneId, id]
    )
    await client.query(
      `UPDATE runtime.node_states
       SET availability = 'reserved', door_state = 'closed',
           delivery_state = 'awaiting_departure', task_id = $2, updated_at = now()
       WHERE node_id = $1`,
      [nodeId, id]
    )
    await addEvent(client, id, 'task_dispatched', assignment.actor, {
      drone_id: droneId,
      drone_code: drone.drone_code,
      node_id: nodeId,
      node_name: node.node_name,
      route_id: Number(routeResult.rows[0].route_id),
      demo_force_dispatch: DEMO_FORCE_DISPATCH,
    })
    await auditStore.appendEvent({
      event_type: 'task_dispatched',
      category: 'operation',
      task_id: id,
      title: '运输资源已派发',
      description: `${drone.model || drone.drone_code}已接收${task.origin}至${task.destination}的航点链，${node.node_name}已预留。`,
      actor: { role: 'operator', name: assignment.actor || '运营调度员', department: '运营调度' },
      resource: { type: 'task', id },
      metadata: {
        drone_id: droneId,
        drone_name: drone.model || drone.drone_code,
        node_id: nodeId,
        node_name: node.node_name,
        route_id: Number(routeResult.rows[0].route_id),
      },
    }, { client })
    if (ownsClient) await client.query('COMMIT')
    return getOperatorWorkspace({ client })
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

async function advanceTask(taskId, values = {}, options = {}) {
  const id = positiveId(taskId, 'taskId')
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
    const nextStatus = {
      dispatched: 'running',
      running: 'arriving',
      arriving: 'completed',
    }[task.status]
    if (!nextStatus) throw conflict('当前任务状态不能继续推进', 'TASK_NOT_ADVANCEABLE')
    if (!task.assigned_drone_id || !task.assigned_node_id) {
      throw conflict('任务缺少已分配的无人机或接驳节点', 'TASK_ASSIGNMENT_MISSING')
    }

    const droneResult = await client.query(
      'SELECT * FROM runtime.drones WHERE drone_id = $1 FOR UPDATE',
      [task.assigned_drone_id]
    )
    const nodeResult = await client.query(
      'SELECT * FROM runtime.node_states WHERE node_id = $1 FOR UPDATE',
      [task.assigned_node_id]
    )
    if (!droneResult.rowCount || !nodeResult.rowCount) {
      throw conflict('任务执行资源记录不完整', 'TASK_ASSIGNMENT_MISSING')
    }

    await client.query(
      `UPDATE runtime.tasks
       SET status = $2,
           completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
           updated_at = now()
       WHERE task_id = $1`,
      [id, nextStatus]
    )

    if (nextStatus === 'running') {
      await client.query(
        `UPDATE runtime.drones SET status = 'task', updated_at = now() WHERE drone_id = $1`,
        [task.assigned_drone_id]
      )
      await client.query(
        `UPDATE runtime.node_states
         SET delivery_state = 'awaiting_arrival', updated_at = now()
         WHERE node_id = $1`,
        [task.assigned_node_id]
      )
    } else if (nextStatus === 'arriving') {
      await client.query(
        `UPDATE runtime.node_states
         SET availability = 'occupied', door_state = 'opening',
             delivery_state = 'drone_arriving', updated_at = now()
         WHERE node_id = $1`,
        [task.assigned_node_id]
      )
    } else {
      await client.query(
        `UPDATE runtime.drones
         SET status = 'idle', task_id = NULL,
             battery_level = GREATEST(0, COALESCE(battery_level, 100) - 12),
             updated_at = now()
         WHERE drone_id = $1`,
        [task.assigned_drone_id]
      )
      await client.query(
        `UPDATE runtime.node_states
         SET availability = 'available', door_state = 'closed',
             delivery_state = 'delivered', task_id = NULL, updated_at = now()
         WHERE node_id = $1`,
        [task.assigned_node_id]
      )
    }

    const event = {
      running: 'task_in_transit',
      arriving: 'task_arriving',
      completed: 'task_delivered',
    }[nextStatus]
    await addEvent(client, id, event, values.actor, {
      task_status: frontendTaskStatus(nextStatus),
      drone_id: Number(task.assigned_drone_id),
      node_id: Number(task.assigned_node_id),
    })
    const content = {
      running: {
        title: '无人机开始运输',
        description: `${droneResult.rows[0].model || droneResult.rows[0].drone_code}已起飞，任务进入运输状态。`,
      },
      arriving: {
        title: '无人机到达接驳节点',
        description: '无人机已到达目标接驳节点，节点进入占用状态。',
      },
      completed: {
        title: '运输任务完成交付',
        description: `${task.origin}至${task.destination}的任务已完成，运输资源已经释放。`,
      },
    }[nextStatus]
    await auditStore.appendEvent({
      event_type: event,
      category: 'operation',
      task_id: id,
      ...content,
      actor: { role: 'operator', name: values.actor || '运营调度员', department: '运营调度' },
      resource: { type: 'task', id },
      metadata: {
        task_status: frontendTaskStatus(nextStatus),
        drone_id: Number(task.assigned_drone_id),
        drone_status: nextStatus === 'completed' ? 'idle' : 'in_flight',
        node_id: Number(task.assigned_node_id),
        node_state: nextStatus === 'running' ? 'awaiting_arrival' : nextStatus === 'arriving' ? 'drone_arriving' : 'delivered',
      },
    }, { client })
    if (ownsClient) await client.query('COMMIT')
    return getOperatorWorkspace({ client })
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

module.exports = {
  getOperatorWorkspace,
  dispatchTask,
  advanceTask,
  _normalizeDrone: normalizeDrone,
  _normalizeNode: normalizeNode,
}
