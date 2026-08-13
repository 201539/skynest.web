const crypto = require('crypto')
const { TASK_STATUS, assertTransition, getStatusLabel } = require('./taskState')

function createRequestNo(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `SKY-DEMO-${day}-${suffix}`
}

function maskPhone(value) {
  const text = String(value || '').trim()
  if (text.length < 7) return text ? '***' : ''
  return `${text.slice(0, 3)}****${text.slice(-4)}`
}

function normalizeRequester(input = {}) {
  const requester = input.requester && typeof input.requester === 'object'
    ? input.requester
    : input
  return {
    role: ['student', 'teacher'].includes(requester.role) ? requester.role : 'student',
    org: String(requester.org || '理科楼群实验室').trim() || '理科楼群实验室',
    name: String(requester.contact_name || requester.name || '演示用户').trim() || '演示用户',
    phone: String(requester.contact_phone || requester.phone || '13800000000').trim() || '13800000000',
  }
}

function validateTaskDraft(agentResult) {
  const task = agentResult?.task_draft
  if (!task) throw new Error('未获得 Agent 任务分析结果')
  if (task.missing_fields?.length) throw new Error('任务必要信息不完整，暂不能提交')
  if (!task.origin_node_id || !task.destination_node_id) {
    throw new Error('起点或终点未匹配到校园节点，暂不能提交')
  }
  return task
}

function toStudentView(task) {
  const route = task.route_result_json
  const telemetry = task.telemetry_json
  return {
    id: task.id,
    request_no: task.request_no,
    requester_role: task.requester_role,
    requester_org: task.requester_org,
    origin_text: task.origin_text,
    destination_text: task.destination_text,
    item_category: task.item_category,
    weight_kg: task.weight_kg,
    deadline: task.deadline,
    priority: task.priority,
    special_requirements: task.special_requirements_json || [],
    status: task.status,
    status_label: getStatusLabel(task.status),
    agent_summary: task.agent_result_json?.explanation || '',
    route_summary: route
      ? {
          route_name: route.route?.name || '校园推荐通道',
          total_length_meters: route.totalLengthMeters ?? null,
          duration_seconds: route.route?.duration ?? null,
          algorithm: route.algorithm || null,
          planned_at: route.planned_at || null,
          evaluation_verdict: route.evaluation?.overallVerdict || null,
        }
      : null,
    provider_display_name: task.provider_name || null,
    provider_status: task.provider_status || null,
    provider_vehicle: task.provider_vehicle || null,
    telemetry: telemetry
      ? {
          simulation: Boolean(telemetry.simulation),
          provider_status: telemetry.provider_status || null,
          progress_percent: telemetry.progress_percent ?? null,
          estimated_arrival: telemetry.estimated_arrival || null,
          updated_at: telemetry.updated_at || null,
        }
      : null,
    pickup_code: task.status === TASK_STATUS.ARRIVED || task.status === TASK_STATUS.PICKED_UP || task.status === TASK_STATUS.COMPLETED
      ? task.pickup_code
      : null,
    exception_reason: task.status === TASK_STATUS.EXCEPTION ? task.exception_reason : null,
    created_at: task.created_at,
    updated_at: task.updated_at,
  }
}

function toAdminView(task) {
  return {
    ...toStudentView(task),
    contact_name: task.contact_name,
    contact_phone_masked: maskPhone(task.contact_phone),
    origin_node_id: task.origin_node_id,
    destination_node_id: task.destination_node_id,
    agent_result: task.agent_result_json || {},
    route_result: task.route_result_json || null,
    provider_code: task.provider_code || null,
    provider_order_no: task.provider_order_no || null,
    provider_raw_status: task.provider_status || null,
    telemetry: task.telemetry_json || null,
    pickup_code: task.pickup_code || null,
    approved_at: task.approved_at,
    completed_at: task.completed_at,
  }
}

function toEnterpriseView(task) {
  return {
    ...toStudentView(task),
    provider_code: task.provider_code || null,
    provider_order_no: task.provider_order_no || null,
    provider_raw_status: task.provider_status || null,
    telemetry: task.telemetry_json || null,
    approved_at: task.approved_at,
    completed_at: task.completed_at,
  }
}

async function insertEvent(client, taskId, { eventType, status, title, detail = null, source, payload = {} }) {
  await client.query(
    `
      INSERT INTO demo_task_events (
        task_id, event_type, status, title, detail, source, payload_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [taskId, eventType, status, title, detail, source, JSON.stringify(payload)],
  )
}

async function createDemoTask(pool, { agentResult, requester, now = new Date() }) {
  const task = validateTaskDraft(agentResult)
  const contact = normalizeRequester(requester)
  const id = crypto.randomUUID()
  const requestNo = createRequestNo(now)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `
        INSERT INTO demo_tasks (
          id, request_no, requester_role, requester_org, contact_name, contact_phone,
          origin_text, destination_text, origin_node_id, destination_node_id,
          item_category, weight_kg, deadline, priority, special_requirements_json,
          status, agent_result_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14, $15::jsonb,
          $16, $17::jsonb
        )
        RETURNING *
      `,
      [
        id,
        requestNo,
        contact.role,
        contact.org,
        contact.name,
        contact.phone,
        task.origin_text,
        task.destination_text,
        task.origin_node_id,
        task.destination_node_id,
        task.item_category,
        task.weight_kg,
        task.deadline,
        task.priority === 'high' ? 'high' : 'normal',
        JSON.stringify(task.special_requirements || []),
        TASK_STATUS.AGENT_REVIEWED,
        JSON.stringify(agentResult),
      ],
    )

    await insertEvent(client, id, {
      eventType: 'task_created',
      status: TASK_STATUS.SUBMITTED,
      title: '运输需求已提交',
      detail: '学生端已提交结构化运输需求。',
      source: 'student',
    })
    await insertEvent(client, id, {
      eventType: 'agent_reviewed',
      status: TASK_STATUS.AGENT_REVIEWED,
      title: 'AI 分析完成',
      detail: agentResult.explanation,
      source: 'agent',
      payload: agentResult,
    })
    await client.query('COMMIT')
    return inserted.rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function getDemoTask(pool, id) {
  const result = await pool.query('SELECT * FROM demo_tasks WHERE id = $1', [id])
  return result.rows[0] || null
}

async function listDemoTasks(pool, { status, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100))
  const params = []
  let where = ''
  if (status) {
    params.push(status)
    where = 'WHERE status = $1'
  }
  params.push(safeLimit)
  const result = await pool.query(
    `SELECT * FROM demo_tasks ${where} ORDER BY updated_at DESC LIMIT $${params.length}`,
    params,
  )
  return result.rows
}

async function getDemoTaskEvents(pool, taskId) {
  const result = await pool.query(
    `SELECT id, event_type, status, title, detail, source, payload_json, created_at
     FROM demo_task_events WHERE task_id = $1 ORDER BY created_at ASC, id ASC`,
    [taskId],
  )
  return result.rows
}

async function transitionDemoTask(pool, id, nextStatus, event) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const currentResult = await client.query('SELECT * FROM demo_tasks WHERE id = $1 FOR UPDATE', [id])
    const current = currentResult.rows[0]
    if (!current) {
      const notFound = new Error('任务不存在')
      notFound.code = 'TASK_NOT_FOUND'
      throw notFound
    }

    assertTransition(current.status, nextStatus)
    const fields = ['status = $2', 'updated_at = NOW()']
    const values = [id, nextStatus]
    if (nextStatus === TASK_STATUS.APPROVED) fields.push('approved_at = NOW()')
    if (nextStatus === TASK_STATUS.COMPLETED) fields.push('completed_at = NOW()')
    const updatedResult = await client.query(
      `UPDATE demo_tasks SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
      values,
    )
    const updated = updatedResult.rows[0]
    await insertEvent(client, id, {
      eventType: event.eventType,
      status: nextStatus,
      title: event.title || getStatusLabel(nextStatus),
      detail: event.detail || null,
      source: event.source,
      payload: event.payload || {},
    })
    await client.query('COMMIT')
    return updated
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function saveDemoTaskRoute(pool, id, routeResult) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const currentResult = await client.query('SELECT * FROM demo_tasks WHERE id = $1 FOR UPDATE', [id])
    const current = currentResult.rows[0]
    if (!current) {
      const notFound = new Error('任务不存在')
      notFound.code = 'TASK_NOT_FOUND'
      throw notFound
    }
    if (current.status !== TASK_STATUS.APPROVED) {
      const invalidStatus = new Error('只有校方已批准且尚未派单的任务可以生成或重试推荐通道')
      invalidStatus.statusCode = 400
      throw invalidStatus
    }

    const updatedResult = await client.query(
      `UPDATE demo_tasks
       SET route_result_json = $2::jsonb, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, JSON.stringify(routeResult)],
    )
    const updated = updatedResult.rows[0]
    const routeDescription = routeResult.route?.description || '校园侧推荐通道已生成。'
    await insertEvent(client, id, {
      eventType: 'route_planned',
      status: current.status,
      title: '校园推荐通道已生成',
      detail: `${routeDescription} 全程约 ${routeResult.totalLengthMeters ?? '—'} 米，预计 ${routeResult.route?.duration ?? '—'} 秒。`,
      source: 'route_engine',
      payload: {
        algorithm: routeResult.algorithm,
        fallback_used: routeResult.fallbackUsed,
        grid_count: routeResult.gridCount,
        total_length_meters: routeResult.totalLengthMeters,
      },
    })
    await client.query('COMMIT')
    return updated
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function applyProviderUpdate(pool, id, { nextStatus, provider = {}, event }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const currentResult = await client.query('SELECT * FROM demo_tasks WHERE id = $1 FOR UPDATE', [id])
    const current = currentResult.rows[0]
    if (!current) {
      const notFound = new Error('任务不存在')
      notFound.code = 'TASK_NOT_FOUND'
      throw notFound
    }

    assertTransition(current.status, nextStatus)
    const fields = ['status = $2', 'updated_at = NOW()']
    const values = [id, nextStatus]
    const setValue = (column, value) => {
      values.push(value)
      fields.push(`${column} = $${values.length}`)
    }

    if (Object.hasOwn(provider, 'code')) setValue('provider_code', provider.code)
    if (Object.hasOwn(provider, 'name')) setValue('provider_name', provider.name)
    if (Object.hasOwn(provider, 'orderNo')) setValue('provider_order_no', provider.orderNo)
    if (Object.hasOwn(provider, 'vehicle')) setValue('provider_vehicle', provider.vehicle)
    if (Object.hasOwn(provider, 'status')) setValue('provider_status', provider.status)
    if (Object.hasOwn(provider, 'telemetry')) {
      values.push(JSON.stringify(provider.telemetry))
      fields.push(`telemetry_json = $${values.length}::jsonb`)
    }
    if (Object.hasOwn(provider, 'pickupCode')) setValue('pickup_code', provider.pickupCode)
    if (Object.hasOwn(provider, 'exceptionReason')) setValue('exception_reason', provider.exceptionReason)

    const updatedResult = await client.query(
      `UPDATE demo_tasks SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
      values,
    )
    const updated = updatedResult.rows[0]
    await insertEvent(client, id, {
      eventType: event.eventType,
      status: nextStatus,
      title: event.title || getStatusLabel(nextStatus),
      detail: event.detail || null,
      source: event.source || 'provider_sandbox',
      payload: event.payload || {},
    })
    await client.query('COMMIT')
    return updated
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function completeDemoPickup(pool, id, pickupCode) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const currentResult = await client.query('SELECT * FROM demo_tasks WHERE id = $1 FOR UPDATE', [id])
    const current = currentResult.rows[0]
    if (!current) {
      const notFound = new Error('任务不存在')
      notFound.code = 'TASK_NOT_FOUND'
      throw notFound
    }
    if (current.status !== TASK_STATUS.ARRIVED) {
      const invalidStatus = new Error('只有已到达接驳点的任务可以确认取件')
      invalidStatus.statusCode = 400
      throw invalidStatus
    }
    if (!current.pickup_code || String(pickupCode || '').trim() !== current.pickup_code) {
      const invalidCode = new Error('取件码不正确')
      invalidCode.statusCode = 400
      throw invalidCode
    }

    assertTransition(current.status, TASK_STATUS.PICKED_UP)
    assertTransition(TASK_STATUS.PICKED_UP, TASK_STATUS.COMPLETED)
    const updatedResult = await client.query(
      `UPDATE demo_tasks
       SET status = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, TASK_STATUS.COMPLETED],
    )
    const updated = updatedResult.rows[0]
    await insertEvent(client, id, {
      eventType: 'pickup_confirmed',
      status: TASK_STATUS.PICKED_UP,
      title: '用户已确认取件',
      detail: '学生端已通过取件码完成接驳点取件确认。',
      source: 'student',
    })
    await insertEvent(client, id, {
      eventType: 'task_completed',
      status: TASK_STATUS.COMPLETED,
      title: '配送任务已完成',
      detail: '本次校园低空配送演示流程已闭环。',
      source: 'system',
    })
    await client.query('COMMIT')
    return updated
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function resetDemoData(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const eventResult = await client.query('DELETE FROM demo_task_events')
    const taskResult = await client.query('DELETE FROM demo_tasks')
    await client.query('COMMIT')
    return { deleted_tasks: taskResult.rowCount, deleted_events: eventResult.rowCount }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = {
  createDemoTask,
  getDemoTask,
  getDemoTaskEvents,
  listDemoTasks,
  transitionDemoTask,
  saveDemoTaskRoute,
  applyProviderUpdate,
  completeDemoPickup,
  resetDemoData,
  toStudentView,
  toAdminView,
  toEnterpriseView,
  validateTaskDraft,
}
