const { Pool } = require('pg')
const { getV3DatabaseConfig } = require('./databaseConfig')

function parsePositiveInteger(value, fallback, maximum = 1000) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

function createPool() {
  return new Pool(getV3DatabaseConfig({
    max: parsePositiveInteger(process.env.PG_V3_WRITE_POOL_MAX, 4, 20),
    application_name: 'skynest-audit-store',
  }))
}

const pool = createPool()
const CATEGORIES = new Set(['task', 'approval', 'operation', 'safety'])

function requiredText(value, fieldName, maximumLength) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new TypeError(`${fieldName} is required`)
  if (normalized.length > maximumLength) {
    throw new RangeError(`${fieldName} cannot exceed ${maximumLength} characters`)
  }
  return normalized
}

function normalizeActor(actor) {
  if (actor && typeof actor === 'object') {
    return {
      role: String(actor.role || 'system'),
      name: String(actor.name || '系统'),
      department: String(actor.department || ''),
    }
  }
  return { role: 'system', name: String(actor || '系统'), department: '' }
}

function normalizeResource(resource) {
  if (!resource || typeof resource !== 'object') return { type: '', id: '' }
  return { type: String(resource.type || ''), id: String(resource.id ?? '') }
}

async function appendEvent(values = {}, options = {}) {
  const client = options.client || pool
  const category = String(values.category || '')
  if (!CATEGORIES.has(category)) throw new TypeError('category is invalid')
  const actor = normalizeActor(values.actor)
  const resource = normalizeResource(values.resource)
  const taskId = values.task_id == null ? null : Number.parseInt(values.task_id, 10)
  if (values.task_id != null && (!Number.isInteger(taskId) || taskId <= 0)) {
    throw new TypeError('task_id must be a positive integer')
  }
  const result = await client.query(
    `
      INSERT INTO runtime.audit_events (
        event_type, category, task_id, title, description,
        actor_role, actor_name, actor_department,
        resource_type, resource_id, metadata, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11::jsonb, COALESCE($12::timestamptz AT TIME ZONE 'Asia/Shanghai', now())
      )
      RETURNING *
    `,
    [
      requiredText(values.event_type, 'event_type', 100),
      category,
      taskId,
      requiredText(values.title, 'title', 200),
      String(values.description || ''),
      actor.role,
      actor.name,
      actor.department,
      resource.type,
      resource.id,
      JSON.stringify(values.metadata && typeof values.metadata === 'object' ? values.metadata : {}),
      values.created_at || null,
    ]
  )
  return normalizeRecord(result.rows[0])
}

function normalizeRecord(row) {
  return {
    id: Number(row.audit_id),
    event_type: row.event_type,
    category: row.category,
    task_id: row.task_id == null ? null : Number(row.task_id),
    title: row.title,
    description: row.description || '',
    actor: {
      role: row.actor_role || 'system',
      name: row.actor_name || '系统',
      department: row.actor_department || '',
    },
    resource: { type: row.resource_type || '', id: row.resource_id || '' },
    metadata: row.metadata || {},
    created_at: row.created_at,
  }
}

async function getWorkspace(options = {}) {
  const client = options.client || pool
  const limit = parsePositiveInteger(options.limit, 500, 2000)
  const result = await client.query(
    `SELECT * FROM runtime.audit_events
     ORDER BY created_at DESC, audit_id DESC
     LIMIT $1`,
    [limit]
  )
  const records = result.rows.map(normalizeRecord)
  const summaryResult = await client.query(`
    SELECT
      COUNT(*)::integer AS total,
      COUNT(*) FILTER (WHERE created_at::date = timezone('Asia/Shanghai', now())::date)::integer AS today,
      COUNT(*) FILTER (WHERE category = 'safety')::integer AS safety,
      COUNT(*) FILTER (WHERE event_type IN ('emergency_stop', 'task_suspended'))::integer AS exceptions
    FROM runtime.audit_events
  `)
  const summary = summaryResult.rows[0]
  return {
    source: 'v3',
    updated_at: new Date().toISOString(),
    records,
    summary: {
      total: Number(summary.total),
      today: Number(summary.today),
      safety: Number(summary.safety),
      exceptions: Number(summary.exceptions),
    },
    persistence: 'database',
  }
}

async function close() {
  await pool.end()
}

module.exports = { appendEvent, getWorkspace, close, _pool: pool }
