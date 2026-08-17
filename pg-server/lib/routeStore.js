const { Pool } = require('pg')
const auditStore = require('./auditStore')
const { getV3DatabaseConfig } = require('./databaseConfig')

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function roundPercent(value) {
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100) / 100
}

function percentChange(current, previous) {
  const currentValue = Number(current)
  const previousValue = Number(previous)
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) {
    return null
  }
  return roundPercent(((currentValue / previousValue) - 1) * 100)
}

function normalizeTaskId(value) {
  if (value == null || value === '') return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new TypeError('taskId must be a positive integer')
  return parsed
}

function createPool() {
  return new Pool(getV3DatabaseConfig({
    max: parsePositiveInteger(process.env.PG_V3_WRITE_POOL_MAX, 4),
    application_name: 'skynest-route-store',
  }))
}

const pool = createPool()

async function ensureTask(client, context) {
  const requestedTaskId = normalizeTaskId(context.taskId)
  if (requestedTaskId != null) {
    const existing = await client.query(
      'SELECT task_id FROM runtime.tasks WHERE task_id = $1 FOR UPDATE',
      [requestedTaskId]
    )
    if (!existing.rowCount) throw new Error(`Task ${requestedTaskId} does not exist in runtime.tasks`)
    if (!context.preserveTaskStatus) {
      await client.query(
        `UPDATE runtime.tasks
         SET status = 'planning', updated_at = now()
         WHERE task_id = $1 AND status NOT IN ('completed', 'aborted', 'rejected')`,
        [requestedTaskId]
      )
    }
    return requestedTaskId
  }

  const result = await client.query(
    `
      INSERT INTO runtime.tasks (
        origin, destination, priority, safety_level,
        special_requirements, candidate_node_ids, missing_fields, status
      ) VALUES ($1, $2, $3, $4, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'planning')
      RETURNING task_id
    `,
    [
      context.startName || '地图选点起点',
      context.endName || '地图选点终点',
      context.priority || 'normal',
      context.safetyLevel || 'normal',
    ]
  )
  return Number(result.rows[0].task_id)
}

function createPlanningContext(context, plan) {
  return {
    start: context.start,
    end: context.end,
    start_name: context.startName || null,
    end_name: context.endName || null,
    access_points: context.accessPoints || null,
    search_bbox: plan.searchBBox,
    ground_height: context.groundHeight,
    min_score: context.minScore ?? null,
    grid_size: context.gridSize,
    simplify_tolerance_meters: context.simplifyToleranceMeters ?? null,
    cost_profile: context.costProfile || 'balanced',
    cost_weights: plan.dynamicCost?.model
      ? {
          distance: plan.dynamicCost.model.distanceWeight,
          maneuver: plan.dynamicCost.model.maneuverWeight,
          ...plan.dynamicCost.model.weights,
        }
      : context.costWeights || null,
    cost_thresholds: plan.dynamicCost?.model?.thresholds || context.costThresholds || null,
    time_zone: context.timeZone || 'Asia/Shanghai',
    planned_for: context.planningAt || plan.dynamicCost?.sampledAt || null,
  }
}

async function persistPlan(plan, context = {}, options = {}) {
  if (plan.costModel !== 'dynamic-v1') return null
  const client = options.client || await pool.connect()
  const ownsClient = !options.client
  try {
    if (ownsClient) await client.query('BEGIN')
    const taskId = await ensureTask(client, context)
    const currentResult = await client.query(
      `
        SELECT route_id, distance_m, cost
        FROM runtime.routes
        WHERE task_id = $1 AND is_current
        FOR UPDATE
      `,
      [taskId]
    )
    const current = currentResult.rows[0] || null
    const expectedPreviousRouteId = options.previousRouteId == null
      ? null
      : Number.parseInt(options.previousRouteId, 10)
    if (
      expectedPreviousRouteId != null &&
      (!current || Number(current.route_id) !== expectedPreviousRouteId)
    ) {
      const error = new Error('Route was already replaced by a newer version')
      error.code = 'ROUTE_VERSION_CHANGED'
      error.expected_route_id = expectedPreviousRouteId
      error.current_route_id = current ? Number(current.route_id) : null
      throw error
    }
    const previousRouteId = expectedPreviousRouteId || (current ? Number(current.route_id) : null)
    const routeType = previousRouteId ? 'replan' : 'initial'
    if (current) {
      await client.query('UPDATE runtime.routes SET is_current = false WHERE route_id = $1', [current.route_id])
    }

    const distanceChange = percentChange(plan.totalLengthMeters, current?.distance_m)
    const riskChange = percentChange(plan.totalTraversalCost, current?.cost)
    const planningContext = createPlanningContext(context, plan)
    const costBreakdown = {
      total_traversal_cost: plan.totalTraversalCost,
      surface_summary: plan.dynamicCost?.summary || null,
      model: plan.dynamicCost?.model || null,
      data_coverage: plan.dynamicCost?.dataCoverage || null,
      path: plan.dynamicCost?.pathBreakdown || null,
      decision_trace: plan.decisionTrace || null,
    }
    const insertResult = await client.query(
      `
        INSERT INTO runtime.routes (
          task_id, route_type, waypoints, main_risk_factors, avoided_zones,
          distance_m, distance_change_percent, risk_change_percent, cost, status,
          previous_route_id, algorithm, cost_model, planning_context,
          cost_breakdown, change_trigger, is_current
        ) VALUES (
          $1, $2, $3::jsonb, $4::jsonb, $5::jsonb,
          $6, $7, $8, $9, 'proposed',
          $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, true
        )
        RETURNING *
      `,
      [
        taskId,
        routeType,
        JSON.stringify(plan.route.points || []),
        JSON.stringify(plan.route.mainRiskFactors || []),
        JSON.stringify(plan.route.avoidedZones || []),
        plan.totalLengthMeters,
        distanceChange,
        riskChange,
        plan.totalTraversalCost,
        previousRouteId,
        plan.algorithm,
        plan.costModel,
        JSON.stringify(planningContext),
        JSON.stringify(costBreakdown),
        options.trigger ? JSON.stringify(options.trigger) : null,
      ]
    )
    if (context.preserveTaskStatus) {
      await client.query(
        `UPDATE runtime.tasks SET risk_score = $2, updated_at = now() WHERE task_id = $1`,
        [taskId, plan.dynamicCost?.summary?.average_traversal_cost]
      )
    } else {
      await client.query(
        `UPDATE runtime.tasks
         SET status = $2, risk_score = $3, updated_at = now()
         WHERE task_id = $1`,
        [taskId, routeType === 'replan' ? 'replanned' : 'planned', plan.dynamicCost?.summary?.average_traversal_cost]
      )
    }
    if (routeType === 'replan') {
      const manualRestrictionReplan = options.trigger?.type === 'manual_restriction_replan'
      await auditStore.appendEvent({
        event_type: 'route_replanned',
        category: 'safety',
        task_id: taskId,
        title: manualRestrictionReplan ? '冲突航线已手动重新规划' : '航线已自动重新规划',
        description: manualRestrictionReplan
          ? `校方已根据${options.trigger.restriction_name || '临时限制区'}生成并保存新版安全航线。`
          : '动态环境或安全约束发生变化，系统已生成新的安全航线。',
        actor: manualRestrictionReplan
          ? { role: 'school', name: options.trigger.actor || '校方安全管控员', department: '校园管理部门' }
          : { role: 'system', name: '动态航线规划服务', department: 'SkyNest 安全系统' },
        resource: { type: 'route', id: insertResult.rows[0].route_id },
        metadata: {
          previous_route_id: previousRouteId,
          route_id: Number(insertResult.rows[0].route_id),
          distance_change_percent: distanceChange,
          risk_change_percent: riskChange,
          trigger: options.trigger?.type || 'dynamic_data_change',
          restriction_id: options.trigger?.restriction_id || null,
          safety_buffer_meters: options.trigger?.safety_buffer_meters ?? null,
        },
      }, { client })
    }
    if (ownsClient) await client.query('COMMIT')
    const route = insertResult.rows[0]
    return {
      route_id: Number(route.route_id),
      task_id: Number(route.task_id),
      route_type: route.route_type,
      previous_route_id: route.previous_route_id == null ? null : Number(route.previous_route_id),
      distance_change_percent: route.distance_change_percent == null
        ? null
        : Number(route.distance_change_percent),
      risk_change_percent: route.risk_change_percent == null
        ? null
        : Number(route.risk_change_percent),
      status: route.status,
      is_current: route.is_current,
      created_at: route.created_at,
    }
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

async function listCurrentDynamicRoutes() {
  const result = await pool.query(`
    SELECT
      r.route_id, r.task_id, r.waypoints, r.distance_m, r.cost,
      r.planning_context, r.cost_breakdown, r.status, r.created_at,
      t.status AS task_status
    FROM runtime.routes r
    JOIN runtime.tasks t ON t.task_id = r.task_id
    WHERE r.is_current
      AND r.cost_model = 'dynamic-v1'
      AND r.status IN ('proposed', 'approved')
      AND t.status NOT IN ('completed', 'aborted', 'rejected')
    ORDER BY r.route_id
  `)
  return result.rows.map((row) => ({
    ...row,
    route_id: Number(row.route_id),
    task_id: Number(row.task_id),
    distance_m: row.distance_m == null ? null : Number(row.distance_m),
    cost: row.cost == null ? null : Number(row.cost),
  }))
}

async function listRouteHistory(taskId) {
  const normalizedTaskId = normalizeTaskId(taskId)
  const result = await pool.query(
    `
      SELECT
        route_id, task_id, route_type, waypoints, main_risk_factors, avoided_zones,
        distance_m, distance_change_percent, risk_change_percent, cost, status,
        previous_route_id, algorithm, cost_model, planning_context,
        cost_breakdown, change_trigger, is_current, created_at
      FROM runtime.routes
      WHERE task_id = $1
      ORDER BY created_at, route_id
    `,
    [normalizedTaskId]
  )
  return result.rows.map((row) => ({
    ...row,
    route_id: Number(row.route_id),
    task_id: Number(row.task_id),
    previous_route_id: row.previous_route_id == null ? null : Number(row.previous_route_id),
    distance_m: row.distance_m == null ? null : Number(row.distance_m),
    distance_change_percent: row.distance_change_percent == null
      ? null
      : Number(row.distance_change_percent),
    risk_change_percent: row.risk_change_percent == null
      ? null
      : Number(row.risk_change_percent),
    cost: row.cost == null ? null : Number(row.cost),
  }))
}

async function getDynamicChangeImpact(trigger) {
  const table = String(trigger?.table || '')
  if (trigger?.operation && trigger.operation !== 'insert') return null
  const recordId = Number.parseInt(trigger?.record_id, 10)
  if (!Number.isInteger(recordId) || recordId <= 0) return null

  const definitions = {
    weather: {
      idColumn: 'weather_id',
      sql: `
        SELECT d.grid_code,
          MIN(g.x_min) AS x_min, MAX(g.x_max) AS x_max,
          MIN(g.y_min) AS y_min, MAX(g.y_max) AS y_max
        FROM runtime.weather d
        LEFT JOIN static.grid_3d g ON g.grid_code = d.grid_code
        WHERE d.weather_id = $1
        GROUP BY d.grid_code
      `,
    },
    no_fly_zones: {
      idColumn: 'zone_id',
      sql: `
        WITH data AS (
          SELECT grid_code, zone FROM runtime.no_fly_zones WHERE zone_id = $1
        ), grid_bounds AS (
          SELECT MIN(g.x_min) AS x_min, MAX(g.x_max) AS x_max,
                 MIN(g.y_min) AS y_min, MAX(g.y_max) AS y_max
          FROM data d LEFT JOIN static.grid_3d g ON g.grid_code = d.grid_code
        )
        SELECT d.grid_code,
          COALESCE(ST_XMin(Box3D(d.zone)), b.x_min) AS x_min,
          COALESCE(ST_XMax(Box3D(d.zone)), b.x_max) AS x_max,
          COALESCE(ST_YMin(Box3D(d.zone)), b.y_min) AS y_min,
          COALESCE(ST_YMax(Box3D(d.zone)), b.y_max) AS y_max
        FROM data d CROSS JOIN grid_bounds b
      `,
    },
    construction: {
      idColumn: 'site_id',
      sql: `
        WITH data AS (
          SELECT grid_code, location FROM runtime.construction WHERE site_id = $1
        ), grid_bounds AS (
          SELECT MIN(g.x_min) AS x_min, MAX(g.x_max) AS x_max,
                 MIN(g.y_min) AS y_min, MAX(g.y_max) AS y_max
          FROM data d LEFT JOIN static.grid_3d g ON g.grid_code = d.grid_code
        )
        SELECT d.grid_code,
          COALESCE(ST_X(d.location), b.x_min) AS x_min,
          COALESCE(ST_X(d.location), b.x_max) AS x_max,
          COALESCE(ST_Y(d.location), b.y_min) AS y_min,
          COALESCE(ST_Y(d.location), b.y_max) AS y_max
        FROM data d CROSS JOIN grid_bounds b
      `,
    },
    events: {
      idColumn: 'event_id',
      sql: `
        WITH data AS (
          SELECT grid_code, location FROM runtime.events WHERE event_id = $1
        ), grid_bounds AS (
          SELECT MIN(g.x_min) AS x_min, MAX(g.x_max) AS x_max,
                 MIN(g.y_min) AS y_min, MAX(g.y_max) AS y_max
          FROM data d LEFT JOIN static.grid_3d g ON g.grid_code = d.grid_code
        )
        SELECT d.grid_code,
          COALESCE(ST_X(d.location), b.x_min) AS x_min,
          COALESCE(ST_X(d.location), b.x_max) AS x_max,
          COALESCE(ST_Y(d.location), b.y_min) AS y_min,
          COALESCE(ST_Y(d.location), b.y_max) AS y_max
        FROM data d CROSS JOIN grid_bounds b
      `,
    },
  }
  const definition = definitions[table]
  if (!definition) return null
  const result = await pool.query(definition.sql, [recordId])
  if (!result.rowCount) return null
  const row = result.rows[0]
  const bounds = ['x_min', 'x_max', 'y_min', 'y_max'].map((name) => Number(row[name]))
  return {
    table,
    record_id: recordId,
    grid_code: row.grid_code || null,
    bbox: bounds.every(Number.isFinite)
      ? { xMin: bounds[0], xMax: bounds[1], yMin: bounds[2], yMax: bounds[3] }
      : null,
  }
}

async function suspendTask(taskId, reason, options = {}) {
  const normalizedTaskId = normalizeTaskId(taskId)
  const client = options.client || await pool.connect()
  const ownsClient = !options.client
  try {
    if (ownsClient) await client.query('BEGIN')
    const result = await client.query(
      `UPDATE runtime.tasks
       SET status = 'suspended',
           special_requirements = COALESCE(special_requirements, '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object('type', 'automatic_replan_failed', 'reason', $2, 'at', now())),
           updated_at = now()
       WHERE task_id = $1 AND status NOT IN ('completed', 'aborted', 'rejected')
       RETURNING origin, destination`,
      [normalizedTaskId, reason]
    )
    if (result.rowCount) {
      const task = result.rows[0]
      await auditStore.appendEvent({
        event_type: 'task_suspended',
        category: 'safety',
        task_id: normalizedTaskId,
        title: '任务已触发安全熔断',
        description: `${task.origin}至${task.destination}暂时无法生成安全航线，任务已自动暂停。`,
        actor: { role: 'system', name: '动态航线规划服务', department: 'SkyNest 安全系统' },
        resource: { type: 'task', id: normalizedTaskId },
        metadata: { reason },
      }, { client })
    }
    if (ownsClient) await client.query('COMMIT')
    return result.rowCount > 0
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
  persistPlan,
  listCurrentDynamicRoutes,
  listRouteHistory,
  getDynamicChangeImpact,
  suspendTask,
  close,
  _pool: pool,
}
