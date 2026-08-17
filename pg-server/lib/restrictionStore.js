const { Pool } = require('pg')
const auditStore = require('./auditStore')
const { inspectRouteRestrictionConflict } = require('./routeRestriction')
const { getV3DatabaseConfig } = require('./databaseConfig')

const TIME_ZONE = process.env.SKYNEST_TIME_ZONE || 'Asia/Shanghai'

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function createPool() {
  return new Pool(getV3DatabaseConfig({
    max: parsePositiveInteger(process.env.PG_V3_WRITE_POOL_MAX, 4),
    application_name: 'skynest-restriction-store',
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

function requiredNumber(value, fieldName) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${fieldName} must be a finite number`)
  return parsed
}

function normalizeId(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError('restrictionId must be a positive integer')
  }
  return parsed
}

function normalizeDate(value, fieldName, fallback = null) {
  if ((value == null || value === '') && fallback) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${fieldName} must be a valid date-time`)
  return parsed
}

function creatorLabel(createdBy) {
  if (createdBy && typeof createdBy === 'object') {
    return [createdBy.name, createdBy.department].filter(Boolean).join(' · ') || null
  }
  const label = String(createdBy || '').trim()
  return label || null
}

function validateRestriction(values = {}) {
  const center = values.center || {}
  const lng = requiredNumber(center.lng, 'center.lng')
  const lat = requiredNumber(center.lat, 'center.lat')
  const radius = requiredNumber(values.radius_m, 'radius_m')
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new RangeError('restriction center is outside valid longitude/latitude bounds')
  }
  if (radius < 50 || radius > 2000) {
    throw new RangeError('restriction radius must be between 50 and 2000 meters')
  }

  const startAt = normalizeDate(values.start_at, 'start_at', new Date())
  const endAt = normalizeDate(values.end_at, 'end_at')
  const durationHours = (endAt.getTime() - startAt.getTime()) / 3600000
  if (durationHours <= 0 || durationHours > 24) {
    throw new RangeError('restriction duration must be greater than 0 and at most 24 hours')
  }

  return {
    name: requiredText(values.name, 'name', 100),
    reason: requiredText(values.reason, 'reason', 500),
    lng,
    lat,
    radius,
    startAt,
    endAt,
    createdBy: creatorLabel(values.created_by) || '校方审核员',
  }
}

function normalizeRestriction(row) {
  return {
    id: Number(row.id),
    name: row.name,
    center: {
      lng: Number(row.lng),
      lat: Number(row.lat),
      height: 0,
    },
    radius_m: Number(row.radius_m),
    reason: row.reason || '',
    start_at: row.start_at,
    end_at: row.end_at,
    created_by: row.created_by ? { name: row.created_by } : null,
    status: row.ui_status,
  }
}

const RESTRICTION_SELECT = `
  SELECT
    n.zone_id AS id,
    n.name,
    ST_X(ST_Transform(ST_Centroid(n.zone), 4326)) AS lng,
    ST_Y(ST_Transform(ST_Centroid(n.zone), 4326)) AS lat,
    ROUND(ST_Perimeter(ST_Transform(n.zone, 4326)::geography) / (2 * pi()))::integer AS radius_m,
    n.reason,
    n.start_time AT TIME ZONE $1 AS start_at,
    n.end_time AT TIME ZONE $1 AS end_at,
    n.created_by,
    CASE
      WHEN n.status = 'active' AND n.end_time < timezone($1, now()) THEN 'expired'
      WHEN n.status = 'cancelled' THEN 'inactive'
      ELSE n.status
    END AS ui_status
  FROM runtime.no_fly_zones n
`

async function listRestrictions(options = {}) {
  const client = options.client || pool
  const result = await client.query(
    `${RESTRICTION_SELECT}
     ORDER BY (n.status = 'active' AND n.end_time >= timezone($1, now())) DESC,
              n.start_time DESC, n.zone_id DESC
     LIMIT 200`,
    [TIME_ZONE]
  )
  return result.rows.map(normalizeRestriction)
}

async function createRestriction(values = {}, options = {}) {
  const data = validateRestriction(values)
  const client = options.client || await pool.connect()
  const ownsClient = !options.client
  try {
    if (ownsClient) await client.query('BEGIN')
    const result = await client.query(
    `
      INSERT INTO runtime.no_fly_zones (
        name, zone, grid_code, start_time, end_time,
        reason, created_by, status, z_min, z_max
      ) VALUES (
        $1,
        ST_Transform(
          ST_Buffer(ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)::geometry,
          4490
        ),
        NULL,
        $5::timestamptz AT TIME ZONE $9,
        $6::timestamptz AT TIME ZONE $9,
        $7, $8, 'active', 0, NULL
      )
      RETURNING zone_id
    `,
    [
      data.name,
      data.lng,
      data.lat,
      data.radius,
      data.startAt.toISOString(),
      data.endAt.toISOString(),
      data.reason,
      data.createdBy,
      TIME_ZONE,
    ]
  )
    const restriction = await getRestriction(result.rows[0].zone_id, { client })
    await auditStore.appendEvent({
      event_type: 'restriction_created',
      category: 'safety',
      title: '临时限制区已创建',
      description: `${restriction.name}已启用，系统将检测受影响航线。`,
      actor: { role: 'school', name: data.createdBy, department: '' },
      resource: { type: 'restriction', id: restriction.id },
      metadata: {
        radius_m: restriction.radius_m,
        reason: restriction.reason,
        end_at: restriction.end_at,
        status: restriction.status,
      },
    }, { client })
    if (ownsClient) await client.query('COMMIT')
    return restriction
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

async function getRestriction(restrictionId, options = {}) {
  const id = normalizeId(restrictionId)
  const client = options.client || pool
  const result = await client.query(
    `${RESTRICTION_SELECT} WHERE n.zone_id = $2`,
    [TIME_ZONE, id]
  )
  if (!result.rowCount) {
    const error = new Error(`Restriction ${id} does not exist`)
    error.code = 'RESTRICTION_NOT_FOUND'
    throw error
  }
  return normalizeRestriction(result.rows[0])
}

async function setRestrictionActive(restrictionId, active, options = {}) {
  const id = normalizeId(restrictionId)
  if (typeof active !== 'boolean') throw new TypeError('active must be a boolean')
  const client = options.client || await pool.connect()
  const ownsClient = !options.client
  try {
    if (ownsClient) await client.query('BEGIN')
    const result = await client.query(
    `
      UPDATE runtime.no_fly_zones
      SET
        status = CASE WHEN $2 THEN 'active' ELSE 'cancelled' END,
        start_time = CASE
          WHEN $2 AND (end_time IS NULL OR end_time <= timezone($3, now()))
            THEN timezone($3, now())
          ELSE start_time
        END,
        end_time = CASE
          WHEN $2 AND (end_time IS NULL OR end_time <= timezone($3, now()))
            THEN timezone($3, now()) + LEAST(
              GREATEST(COALESCE(end_time - start_time, interval '1 hour'), interval '1 hour'),
              interval '24 hours'
            )
          ELSE end_time
        END
      WHERE zone_id = $1
      RETURNING zone_id
    `,
    [id, active, TIME_ZONE]
  )
    if (!result.rowCount) {
      const error = new Error(`Restriction ${id} does not exist`)
      error.code = 'RESTRICTION_NOT_FOUND'
      throw error
    }
    const restriction = await getRestriction(id, { client })
    await auditStore.appendEvent({
      event_type: active ? 'restriction_enabled' : 'restriction_disabled',
      category: 'safety',
      title: active ? '临时限制区已启用' : '临时限制区已停用',
      description: `${restriction.name}已${active ? '恢复生效' : '停止生效'}。`,
      actor: { role: 'school', name: options.actor || '校方安全管控员', department: '校园管理部门' },
      resource: { type: 'restriction', id },
      metadata: { status: restriction.status, reason: restriction.reason },
    }, { client })
    if (ownsClient) await client.query('COMMIT')
    return restriction
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

async function cancelRestriction(restrictionId, options = {}) {
  return setRestrictionActive(restrictionId, false, options)
}

async function deleteRestriction(restrictionId, options = {}) {
  const id = normalizeId(restrictionId)
  const client = options.client || await pool.connect()
  const ownsClient = !options.client
  try {
    if (ownsClient) await client.query('BEGIN')
    const restriction = await getRestriction(id, { client })
    const result = await client.query(
      'DELETE FROM runtime.no_fly_zones WHERE zone_id = $1',
      [id]
    )
    if (!result.rowCount) {
      const error = new Error(`Restriction ${id} does not exist`)
      error.code = 'RESTRICTION_NOT_FOUND'
      throw error
    }
    await auditStore.appendEvent({
      event_type: 'restriction_deleted',
      category: 'safety',
      title: '临时限制区已删除',
      description: `${restriction.name}已由校方从限制区记录中清理。`,
      actor: { role: 'school', name: options.actor || '校方安全管控员', department: '校园管理部门' },
      resource: { type: 'restriction', id },
      metadata: {
        previous_status: restriction.status,
        radius_m: restriction.radius_m,
        reason: restriction.reason,
      },
    }, { client })
    if (ownsClient) await client.query('COMMIT')
    return restriction
  } catch (error) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (ownsClient) client.release()
  }
}

function normalizeRoute(row) {
  const changes = Array.isArray(row.change_trigger?.changes) ? row.change_trigger.changes : []
  const noFlyChange = changes.find((change) => change?.table === 'no_fly_zones')
  return {
    task: {
      id: Number(row.task_id),
      origin: row.origin,
      destination: row.destination,
      status: row.task_status,
    },
    route: {
      id: Number(row.route_id),
      task_id: Number(row.task_id),
      points: Array.isArray(row.waypoints) ? row.waypoints : [],
      replanned_at: row.created_at,
      replan_summary: {
        trigger_name: row.trigger_name || (noFlyChange ? `限制区 #${noFlyChange.record_id}` : '动态数据变化'),
        distance_change_percent: row.distance_change_percent == null
          ? null
          : Number(row.distance_change_percent),
        risk_change_percent: row.risk_change_percent == null
          ? null
          : Number(row.risk_change_percent),
        safety_buffer_meters: Number(
          row.planning_context?.safety_buffer_meters || row.change_trigger?.safety_buffer_meters || 0
        ),
      },
    },
  }
}

async function listRecentReplans(options = {}) {
  const client = options.client || pool
  const result = await client.query(`
    SELECT
      r.route_id, r.task_id, r.waypoints, r.distance_change_percent,
      r.risk_change_percent, r.planning_context, r.change_trigger, r.created_at,
      t.origin, t.destination, t.status AS task_status,
      trigger_zone.name AS trigger_name
    FROM runtime.routes r
    JOIN runtime.tasks t ON t.task_id = r.task_id
    LEFT JOIN LATERAL (
      SELECT n.name
      FROM jsonb_array_elements(COALESCE(r.change_trigger->'changes', '[]'::jsonb)) change
      JOIN runtime.no_fly_zones n
        ON n.zone_id = CASE
          WHEN change->>'record_id' ~ '^[0-9]+$' THEN (change->>'record_id')::bigint
          ELSE NULL
        END
      WHERE change->>'table' = 'no_fly_zones'
      LIMIT 1
    ) trigger_zone ON true
    WHERE r.route_type = 'replan'
      AND r.cost_model = 'dynamic-v1'
    ORDER BY r.created_at DESC, r.route_id DESC
    LIMIT 10
  `)
  return result.rows.map(normalizeRoute)
}

async function listActiveTasks(options = {}) {
  const client = options.client || pool
  const result = await client.query(`
    SELECT
      t.task_id, t.origin, t.destination, t.status,
      d.drone_id, d.drone_code, d.model, d.battery_level, d.status AS drone_status,
      n.node_id, n.node_code, n.node_name,
      s.availability, s.door_state, s.delivery_state
    FROM runtime.tasks t
    LEFT JOIN runtime.drones d ON d.drone_id = t.assigned_drone_id
    LEFT JOIN static.fixed_nodes n ON n.node_id = t.assigned_node_id
    LEFT JOIN runtime.node_states s ON s.node_id = t.assigned_node_id
    WHERE t.status IN ('dispatched', 'running', 'arriving')
    ORDER BY t.updated_at DESC, t.task_id DESC
    LIMIT 100
  `)
  return result.rows.map((row) => ({
    task: {
      id: Number(row.task_id),
      origin: row.origin,
      destination: row.destination,
      status: {
        running: 'in_transit',
      }[row.status] || row.status,
    },
    assigned_drone: row.drone_id ? {
      id: Number(row.drone_id),
      code: row.drone_code,
      name: row.model || row.drone_code,
      battery_percent: row.battery_level == null ? null : Number(row.battery_level),
      status: row.drone_status === 'task'
        ? (row.status === 'dispatched' ? 'assigned' : 'in_flight')
        : row.drone_status,
    } : null,
    assigned_node: row.node_id ? {
      id: Number(row.node_id),
      code: row.node_code,
      name: row.node_name,
      availability: row.availability || 'available',
      door_state: row.door_state || 'closed',
      delivery_state: row.delivery_state || 'idle',
    } : null,
  }))
}

async function listAffectedRoutes(restrictions, options = {}) {
  const activeRestrictions = restrictions.filter((restriction) => restriction.status === 'active')
  if (!activeRestrictions.length) return []
  const client = options.client || pool
  const result = await client.query(`
    SELECT
      r.route_id, r.task_id, r.waypoints, r.main_risk_factors, r.avoided_zones,
      r.distance_m, r.distance_change_percent, r.risk_change_percent,
      r.algorithm, r.cost_model, r.planning_context, r.created_at,
      t.origin, t.destination, t.status AS task_status
    FROM runtime.routes r
    JOIN runtime.tasks t ON t.task_id = r.task_id
    WHERE r.is_current
      AND t.status IN ('approved', 'planned', 'replanned', 'dispatched', 'running', 'arriving')
    ORDER BY t.updated_at DESC, t.task_id DESC
    LIMIT 200
  `)

  return result.rows.flatMap((row) => {
    const route = {
      id: Number(row.route_id),
      task_id: Number(row.task_id),
      waypoints: Array.isArray(row.waypoints) ? row.waypoints : [],
      points: Array.isArray(row.waypoints) ? row.waypoints : [],
      main_risk_factors: row.main_risk_factors || [],
      avoided_zones: row.avoided_zones || [],
      total_length_meters: row.distance_m == null ? null : Number(row.distance_m),
      distance_change_percent: row.distance_change_percent == null ? null : Number(row.distance_change_percent),
      risk_change_percent: row.risk_change_percent == null ? null : Number(row.risk_change_percent),
      algorithm: row.algorithm,
      cost_model: row.cost_model,
      planning_context: row.planning_context || {},
      generated_at: row.created_at,
    }
    const conflicts = activeRestrictions
      .map((restriction) => ({
        restriction,
        analysis: inspectRouteRestrictionConflict(route, restriction),
      }))
      .filter((item) => item.analysis.conflicts)
    if (!conflicts.length) return []
    return [{
      task: {
        id: Number(row.task_id),
        origin: row.origin,
        destination: row.destination,
        status: row.task_status === 'running' ? 'in_transit' : row.task_status,
      },
      route,
      conflicts,
    }]
  })
}

async function getSafetyWorkspace(options = {}) {
  const restrictions = await listRestrictions(options)
  const recentReplans = await listRecentReplans(options)
  const activeTasks = await listActiveTasks(options)
  const affectedRoutes = await listAffectedRoutes(restrictions, options)
  return {
    source: 'v3',
    updated_at: new Date().toISOString(),
    restrictions,
    active_tasks: activeTasks,
    affected_routes: affectedRoutes,
    recent_replans: recentReplans,
  }
}

async function close() {
  await pool.end()
}

module.exports = {
  validateRestriction,
  listRestrictions,
  getRestriction,
  createRestriction,
  setRestrictionActive,
  cancelRestriction,
  deleteRestriction,
  listRecentReplans,
  listActiveTasks,
  listAffectedRoutes,
  getSafetyWorkspace,
  close,
  _pool: pool,
}
