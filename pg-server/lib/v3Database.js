const { Pool } = require('pg')
const { getV3DatabaseConfig } = require('./databaseConfig')
const periodicContext = require('./periodicContext')

const DEFAULT_DATABASE = 'nanjing_uni_grid_v3_test'
const READ_ONLY = process.env.PG_V3_READ_ONLY !== 'false'

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function clampLimit(value, fallback = 100, maximum = 20000) {
  return Math.min(parsePositiveInteger(value, fallback), maximum)
}

function clampGridDimension(value, fallback = 48) {
  return Math.min(Math.max(parsePositiveInteger(value, fallback), 8), 70)
}

function normalizeSearchText(value) {
  return String(value || '').trim()
}

function optionalNumber(value, fieldName) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${fieldName} must be a finite number`)
  return parsed
}

function requiredNumber(value, fieldName) {
  const parsed = optionalNumber(value, fieldName)
  if (parsed == null) throw new TypeError(`${fieldName} is required`)
  return parsed
}

function normalizePointRow(row) {
  const normalized = {
    ...row,
    location:
      row.lng == null || row.lat == null
        ? null
        : { lng: Number(row.lng), lat: Number(row.lat) },
  }
  delete normalized.lng
  delete normalized.lat
  return normalized
}

function normalizeBuildingRow(row) {
  const normalized = normalizePointRow(row)
  return {
    ...normalized,
    altitude_m: normalized.altitude_m == null ? null : Number(normalized.altitude_m),
    source_lng: normalized.source_lng == null ? null : Number(normalized.source_lng),
    source_lat: normalized.source_lat == null ? null : Number(normalized.source_lat),
    merged_count: Number(normalized.merged_count),
    match_rank: normalized.match_rank == null ? undefined : Number(normalized.match_rank),
  }
}

function normalizeNodeDistanceRow(row) {
  const normalized = normalizePointRow(row)
  return {
    ...normalized,
    distance_m: normalized.distance_m == null ? null : Number(normalized.distance_m),
    group_rank: normalized.group_rank == null ? undefined : Number(normalized.group_rank),
  }
}

const pool = new Pool(getV3DatabaseConfig({
  max: parsePositiveInteger(process.env.PG_V3_POOL_MAX, 4),
  connectionTimeoutMillis: parsePositiveInteger(process.env.PG_V3_CONNECT_TIMEOUT_MS, 5000),
  idleTimeoutMillis: 30000,
  application_name: 'skynest-v3-adapter',
  options: READ_ONLY ? '-c default_transaction_read_only=on' : undefined,
}))

async function getStatus() {
  const result = await pool.query(`
    SELECT
      current_database() AS database,
      current_setting('server_version') AS server_version,
      current_setting('default_transaction_read_only')::boolean AS read_only,
      (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis_version,
      to_regclass('static.grid_3d') IS NOT NULL AS has_static_grid,
      to_regclass('static.buildings') IS NOT NULL AS has_static_buildings,
      to_regclass('periodic.population') IS NOT NULL AS has_periodic_population,
      to_regclass('periodic.class_periods') IS NOT NULL AS has_class_periods,
      to_regclass('periodic.access_control') IS NOT NULL AS has_access_control,
      to_regclass('periodic.consumption') IS NOT NULL AS has_consumption,
      to_regclass('runtime.tasks') IS NOT NULL AS has_runtime_tasks
  `)
  const row = result.rows[0]
  return {
    ok: Boolean(
      row.has_static_grid &&
      row.has_static_buildings &&
      row.has_periodic_population &&
      row.has_class_periods &&
      row.has_access_control &&
      row.has_consumption &&
      row.has_runtime_tasks &&
      row.postgis_version
    ),
    ...row,
  }
}

async function getSummary() {
  const result = await pool.query(`
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      GREATEST(c.reltuples::bigint, 0) AS estimated_rows,
      pg_total_relation_size(c.oid) AS total_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname IN ('static', 'periodic', 'runtime')
    ORDER BY n.nspname, c.relname
  `)
  return result.rows.map((row) => ({
    schema: row.schema_name,
    table: row.table_name,
    estimated_rows: Number(row.estimated_rows),
    total_bytes: Number(row.total_bytes),
  }))
}

async function listFixedNodes(options = {}) {
  const limit = clampLimit(options.limit, 100, 1000)
  const offset = Math.max(Number.parseInt(options.offset, 10) || 0, 0)
  const result = await pool.query(
    `
      SELECT
        node_id, node_code, node_name, node_type,
        ST_X(ST_Transform(location, 4326)) AS lng,
        ST_Y(ST_Transform(location, 4326)) AS lat,
        grid_code, capacity, status, description, created_at, updated_at,
        CASE
          WHEN node_code = 'hub' OR node_code ~ '^[a-e]$' THEN 'departure'
          WHEN node_code ~ '^[A-G]$' THEN 'receiving'
          ELSE 'other'
        END AS service_group
      FROM static.fixed_nodes
      WHERE ($1::text IS NULL OR node_type = $1)
        AND ($2::text IS NULL OR status = $2)
      ORDER BY node_id
      LIMIT $3 OFFSET $4
    `,
    [options.nodeType || null, options.status || null, limit, offset]
  )
  return result.rows.map((row) => normalizePointRow(row))
}

async function listBuildings(options = {}) {
  const limit = clampLimit(options.limit, 100, 1000)
  const offset = Math.max(Number.parseInt(options.offset, 10) || 0, 0)
  const category = normalizeSearchText(options.category) || null
  const result = await pool.query(
    `
      SELECT
        building_id, building_name,
        ST_X(ST_Transform(location, 4326)) AS lng,
        ST_Y(ST_Transform(location, 4326)) AS lat,
        source_lng, source_lat,
        altitude_m, altitude_is_placeholder, category, merged_count,
        source_dataset, source_crs, created_at, updated_at
      FROM static.buildings
      WHERE ($1::text IS NULL OR category = $1)
      ORDER BY building_name COLLATE "C", building_id
      LIMIT $2 OFFSET $3
    `,
    [category, limit, offset]
  )
  return result.rows.map((row) => normalizeBuildingRow(row))
}

async function searchBuildings(query, options = {}) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) throw new TypeError('q is required')
  const limit = clampLimit(options.limit, 10, 50)
  const result = await pool.query(
    `
      WITH matched AS (
        SELECT
          building_id, building_name, location,
          source_lng, source_lat,
          altitude_m, altitude_is_placeholder, category, merged_count,
          source_dataset, source_crs, created_at, updated_at,
          CASE
            WHEN building_name = $1 THEN 0
            WHEN lower(building_name) = lower($1) THEN 1
            WHEN building_name LIKE $1 || '%' THEN 2
            WHEN building_name ILIKE '%' || $1 || '%' THEN 3
            ELSE 4
          END AS match_rank
        FROM static.buildings
        WHERE building_name ILIKE '%' || $1 || '%'
      )
      SELECT
        building_id, building_name,
        ST_X(ST_Transform(location, 4326)) AS lng,
        ST_Y(ST_Transform(location, 4326)) AS lat,
        source_lng, source_lat,
        altitude_m, altitude_is_placeholder, category, merged_count,
        source_dataset, source_crs, created_at, updated_at,
        match_rank
      FROM matched
      ORDER BY match_rank, length(building_name), building_name COLLATE "C"
      LIMIT $2
    `,
    [normalizedQuery, limit]
  )
  return result.rows.map((row) => normalizeBuildingRow(row))
}

async function getBuildingByName(buildingName, options = {}) {
  const name = normalizeSearchText(buildingName)
  if (!name) throw new TypeError('building name is required')
  const client = options.client || pool
  const result = await client.query(
    `
      SELECT
        building_id, building_name,
        ST_X(ST_Transform(location, 4326)) AS lng,
        ST_Y(ST_Transform(location, 4326)) AS lat,
        source_lng, source_lat,
        altitude_m, altitude_is_placeholder, category, merged_count,
        source_dataset, source_crs, created_at, updated_at
      FROM static.buildings
      WHERE building_name = $1
      LIMIT 1
    `,
    [name]
  )
  if (!result.rowCount) {
    const error = new Error(`Building ${name} does not exist`)
    error.code = 'BUILDING_NOT_FOUND'
    throw error
  }
  return normalizeBuildingRow(result.rows[0])
}

function normalizeNearestNodeGroup(value) {
  const group = normalizeSearchText(value || 'all').toLowerCase()
  if (!['all', 'departure', 'receiving'].includes(group)) {
    throw new TypeError('group must be all, departure or receiving')
  }
  return group
}

async function listBuildingNearestNodes(buildingName, options = {}) {
  const name = normalizeSearchText(buildingName)
  if (!name) throw new TypeError('building name is required')
  const group = normalizeNearestNodeGroup(options.group)
  const limit = clampLimit(options.limit, group === 'all' ? 13 : 6, 13)
  const client = options.client || pool
  const building = await getBuildingByName(name, { client })
  const result = await client.query(
    `
      SELECT
        n.node_id, n.node_code, n.node_name, n.node_type,
        ST_X(ST_Transform(n.location, 4326)) AS lng,
        ST_Y(ST_Transform(n.location, 4326)) AS lat,
        n.grid_code, n.capacity, n.status, n.description,
        d.distance_m,
        CASE
          WHEN n.node_code = 'hub' OR n.node_code ~ '^[a-e]$' THEN 'departure'
          WHEN n.node_code ~ '^[A-G]$' THEN 'receiving'
          ELSE 'other'
        END AS service_group
      FROM static.building_node_distance d
      JOIN static.fixed_nodes n ON n.node_code = d.node_code
      WHERE d.building_name = $1
        AND (
          $2 = 'all'
          OR ($2 = 'departure' AND (n.node_code = 'hub' OR n.node_code ~ '^[a-e]$'))
          OR ($2 = 'receiving' AND n.node_code ~ '^[A-G]$')
        )
      ORDER BY d.distance_m, n.node_id
      LIMIT $3
    `,
    [name, group, limit]
  )
  return {
    building,
    group,
    nodes: result.rows.map((row) => normalizeNodeDistanceRow(row)),
  }
}

async function getBuildingAccessPoints(buildingName, options = {}) {
  const name = normalizeSearchText(buildingName)
  if (!name) throw new TypeError('building name is required')
  const client = options.client || pool
  const building = await getBuildingByName(name, { client })
  const result = await client.query(
    `
      WITH ranked AS (
        SELECT
          n.node_id, n.node_code, n.node_name, n.node_type,
          ST_X(ST_Transform(n.location, 4326)) AS lng,
          ST_Y(ST_Transform(n.location, 4326)) AS lat,
          n.grid_code, n.capacity, n.status, n.description,
          d.distance_m,
          CASE
            WHEN n.node_code = 'hub' OR n.node_code ~ '^[a-e]$' THEN 'departure'
            WHEN n.node_code ~ '^[A-G]$' THEN 'receiving'
            ELSE 'other'
          END AS service_group,
          ROW_NUMBER() OVER (
            PARTITION BY CASE
              WHEN n.node_code = 'hub' OR n.node_code ~ '^[a-e]$' THEN 'departure'
              WHEN n.node_code ~ '^[A-G]$' THEN 'receiving'
              ELSE 'other'
            END
            ORDER BY d.distance_m, n.node_id
          ) AS group_rank
        FROM static.building_node_distance d
        JOIN static.fixed_nodes n ON n.node_code = d.node_code
        WHERE d.building_name = $1
      )
      SELECT *
      FROM ranked
      WHERE service_group IN ('departure', 'receiving')
        AND group_rank <= $2
      ORDER BY service_group, group_rank
    `,
    [name, clampLimit(options.limitPerGroup, 3, 13)]
  )
  const normalized = result.rows.map((row) => normalizeNodeDistanceRow(row))
  return {
    building,
    departure_nodes: normalized.filter((node) => node.service_group === 'departure'),
    receiving_nodes: normalized.filter((node) => node.service_group === 'receiving'),
  }
}

async function listVehicleRules(options = {}) {
  const weightKg = optionalNumber(options.weightKg, 'weightKg')
  const limit = clampLimit(options.limit, 100, 1000)
  const result = await pool.query(
    `
      SELECT
        rule_id, item_category, min_weight_kg, max_weight_kg,
        vehicle_class, special_handling, remarks
      FROM static.vehicle_rules
      WHERE ($1::text IS NULL OR item_category = $1)
        AND (
          $2::numeric IS NULL
          OR ($2 >= min_weight_kg AND $2 <= max_weight_kg)
        )
      ORDER BY item_category, min_weight_kg, rule_id
      LIMIT $3
    `,
    [options.itemCategory || null, weightKg, limit]
  )
  return result.rows
}

async function listHighRiskCategories(options = {}) {
  const limit = clampLimit(options.limit, 100, 1000)
  const result = await pool.query(
    `
      SELECT
        category_id, category_name, requires_manual, requires_cold_chain,
        requires_shockproof, max_weight_no_review
      FROM static.high_risk_categories
      WHERE ($1::text IS NULL OR category_name = $1)
      ORDER BY category_id
      LIMIT $2
    `,
    [options.categoryName || null, limit]
  )
  return result.rows
}

async function listDrones(options = {}) {
  const minBattery = optionalNumber(options.minBattery, 'minBattery')
  const limit = clampLimit(options.limit, 100, 1000)
  const result = await pool.query(
    `
      SELECT
        drone_id, drone_code, model, vehicle_class, status, battery_level,
        ST_X(location) AS lng, ST_Y(location) AS lat,
        altitude, range_km, payload_kg, task_id, updated_at
      FROM runtime.drones
      WHERE ($1::text IS NULL OR status = $1)
        AND ($2::text IS NULL OR vehicle_class = $2)
        AND ($3::numeric IS NULL OR battery_level >= $3)
      ORDER BY drone_id
      LIMIT $4
    `,
    [options.status || null, options.vehicleClass || null, minBattery, limit]
  )
  return result.rows.map((row) => normalizePointRow(row))
}

async function listGridCells(options = {}) {
  const xMin = requiredNumber(options.xMin, 'xMin')
  const xMax = requiredNumber(options.xMax, 'xMax')
  const yMin = requiredNumber(options.yMin, 'yMin')
  const yMax = requiredNumber(options.yMax, 'yMax')
  const zMin = optionalNumber(options.zMin, 'zMin')
  const zMax = optionalNumber(options.zMax, 'zMax')
  if (xMin > xMax || yMin > yMax || (zMin != null && zMax != null && zMin > zMax)) {
    throw new RangeError('bbox minimum values cannot exceed maximum values')
  }

  const limit = clampLimit(options.limit, 5000, 20000)
  const result = await pool.query(
    `
      SELECT
        new_id, grid_code,
        x_min, x_max, y_min, y_max, z_min, z_max,
        has_building, pop, building_class, sensitivity_level, privacy_level,
        static_suitability_score, building_evaluation_score
      FROM static.grid_3d
      WHERE geomm && ST_MakeEnvelope($1, $3, $2, $4, 4490)
        AND x_max >= $1 AND x_min <= $2
        AND y_max >= $3 AND y_min <= $4
        AND ($5::double precision IS NULL OR z_max >= $5)
        AND ($6::double precision IS NULL OR z_min <= $6)
      ORDER BY x_min, y_min, z_min
      LIMIT $7
    `,
    [xMin, xMax, yMin, yMax, zMin, zMax, limit]
  )
  return result.rows
}

function normalizePlanningTime(value) {
  const date = value == null || value === '' ? new Date() : new Date(value)
  if (Number.isNaN(date.getTime())) throw new TypeError('at must be a valid ISO date-time')
  return date.toISOString()
}

async function listDynamicCostInputs(options = {}) {
  const xMin = requiredNumber(options.xMin, 'xMin')
  const xMax = requiredNumber(options.xMax, 'xMax')
  const yMin = requiredNumber(options.yMin, 'yMin')
  const yMax = requiredNumber(options.yMax, 'yMax')
  const zMin = optionalNumber(options.zMin, 'zMin')
  const zMax = optionalNumber(options.zMax, 'zMax')
  if (xMin > xMax || yMin > yMax || (zMin != null && zMax != null && zMin > zMax)) {
    throw new RangeError('bbox minimum values cannot exceed maximum values')
  }

  const at = normalizePlanningTime(options.at)
  const timeZone = options.timeZone || 'Asia/Shanghai'
  const limit = clampLimit(options.limit, 500, 5000)
  const result = await pool.query(
    `
      WITH planning AS (
        SELECT
          $7::timestamptz AS planned_at,
          $7::timestamptz AT TIME ZONE $8 AS local_at,
          EXTRACT(DOW FROM $7::timestamptz AT TIME ZONE $8)::smallint AS weekday,
          EXTRACT(HOUR FROM $7::timestamptz AT TIME ZONE $8)::smallint AS hour
      )
      SELECT
        g.new_id, g.grid_code,
        g.x_min, g.x_max, g.y_min, g.y_max, g.z_min, g.z_max,
        g.has_building, g.pop, g.building_class,
        g.sensitivity_level, g.privacy_level,
        g.static_suitability_score, g.building_evaluation_score,
        population.pop_value AS population_value,
        p.weekday AS population_requested_weekday,
        p.hour AS population_requested_hour,
        population.weekday AS population_sample_weekday,
        population.hour AS population_sample_hour,
        COALESCE(holiday.is_holiday, false) AS is_holiday,
        weather.recorded_at AS weather_recorded_at,
        weather.age_seconds AS weather_age_seconds,
        weather.wind_speed, weather.precipitation, weather.visibility,
        COALESCE(no_fly.names, '{}'::text[]) AS no_fly_zone_names,
        COALESCE(construction.names, '{}'::text[]) AS construction_names,
        COALESCE(event.names, '{}'::text[]) AS event_names
      FROM static.grid_3d g
      CROSS JOIN planning p
      LEFT JOIN LATERAL (
        SELECT pp.pop_value, pp.weekday, pp.hour
        FROM periodic.population pp
        WHERE pp.grid_code = g.grid_code
          AND pp.weekday = p.weekday
        ORDER BY LEAST(ABS(pp.hour - p.hour), 24 - ABS(pp.hour - p.hour)), pp.id DESC
        LIMIT 1
      ) population ON true
      LEFT JOIN LATERAL (
        SELECT BOOL_OR(h.is_holiday) AS is_holiday
        FROM periodic.holidays h
        WHERE h.holiday_date = p.local_at::date
      ) holiday ON true
      LEFT JOIN LATERAL (
        SELECT
          w.recorded_at,
          EXTRACT(EPOCH FROM (p.planned_at - w.recorded_at)) AS age_seconds,
          w.wind_speed, w.precipitation, w.visibility
        FROM runtime.weather w
        WHERE w.grid_code = g.grid_code
          AND w.recorded_at <= p.planned_at
        ORDER BY w.recorded_at DESC, w.weather_id DESC
        LIMIT 1
      ) weather ON true
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(n.name ORDER BY n.zone_id) AS names
        FROM runtime.no_fly_zones n
        WHERE n.status = 'active'
          AND (n.start_time IS NULL OR n.start_time <= p.planned_at)
          AND (n.end_time IS NULL OR n.end_time >= p.planned_at)
          AND (n.z_min IS NULL OR g.z_max >= n.z_min)
          AND (n.z_max IS NULL OR g.z_min <= n.z_max)
          AND (
            (n.grid_code IS NOT NULL AND n.grid_code = g.grid_code)
            OR (n.zone IS NOT NULL AND n.zone && g.geomm AND ST_Intersects(n.zone, g.geomm))
          )
      ) no_fly ON true
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(c.name ORDER BY c.site_id) AS names
        FROM runtime.construction c
        WHERE c.status = 'ongoing'
          AND (c.start_time IS NULL OR c.start_time <= p.planned_at)
          AND (c.end_time IS NULL OR c.end_time >= p.planned_at)
          AND (
            (c.grid_code IS NOT NULL AND c.grid_code = g.grid_code)
            OR (c.location IS NOT NULL AND ST_Intersects(c.location, g.geomm))
          )
      ) construction ON true
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(e.name ORDER BY e.event_id) AS names
        FROM runtime.events e
        WHERE e.status IN ('scheduled', 'ongoing')
          AND (e.start_time IS NULL OR e.start_time <= p.planned_at)
          AND (e.end_time IS NULL OR e.end_time >= p.planned_at)
          AND (
            (e.grid_code IS NOT NULL AND e.grid_code = g.grid_code)
            OR (e.location IS NOT NULL AND ST_Intersects(e.location, g.geomm))
          )
      ) event ON true
      WHERE g.geomm && ST_MakeEnvelope($1, $3, $2, $4, 4490)
        AND g.x_max >= $1 AND g.x_min <= $2
        AND g.y_max >= $3 AND g.y_min <= $4
        AND ($5::double precision IS NULL OR g.z_max >= $5)
        AND ($6::double precision IS NULL OR g.z_min <= $6)
      ORDER BY g.x_min, g.y_min, g.z_min
      LIMIT $9
    `,
    [xMin, xMax, yMin, yMax, zMin, zMax, at, timeZone, limit]
  )
  const rows = await periodicContext.enrichCells(pool, result.rows, { at, timeZone })
  return { at, timeZone, rows }
}

async function getDynamicCostSurface(options = {}) {
  const xMin = requiredNumber(options.xMin, 'xMin')
  const xMax = requiredNumber(options.xMax, 'xMax')
  const yMin = requiredNumber(options.yMin, 'yMin')
  const yMax = requiredNumber(options.yMax, 'yMax')
  const zTarget = requiredNumber(options.zTarget, 'zTarget')
  if (xMin >= xMax || yMin >= yMax) {
    throw new RangeError('surface bbox minimum values must be below maximum values')
  }

  const cols = clampGridDimension(options.cols)
  const rows = clampGridDimension(options.rows)
  const at = normalizePlanningTime(options.at)
  const timeZone = options.timeZone || 'Asia/Shanghai'
  const result = await pool.query(
    `
      WITH planning AS (
        SELECT
          $8::timestamptz AS planned_at,
          $8::timestamptz AT TIME ZONE $9 AS local_at,
          EXTRACT(DOW FROM $8::timestamptz AT TIME ZONE $9)::smallint AS weekday,
          EXTRACT(HOUR FROM $8::timestamptz AT TIME ZONE $9)::smallint AS hour
      ),
      samples AS (
        SELECT
          sample_col,
          sample_row,
          $1::double precision
            + (sample_col + 0.5) * (($2::double precision - $1::double precision) / $6::integer)
            AS sample_lng,
          $3::double precision
            + (sample_row + 0.5) * (($4::double precision - $3::double precision) / $7::integer)
            AS sample_lat
        FROM generate_series(0, $6::integer - 1) AS sample_col
        CROSS JOIN generate_series(0, $7::integer - 1) AS sample_row
      ),
      sample_points AS (
        SELECT
          samples.*,
          ST_SetSRID(ST_MakePoint(sample_lng, sample_lat), 4490) AS sample_point
        FROM samples
      ),
      sampled_grids AS (
        SELECT
          s.sample_col, s.sample_row, s.sample_lng, s.sample_lat,
          grid_cell.*
        FROM sample_points s
        LEFT JOIN LATERAL (
          SELECT
            g.new_id, g.grid_code,
            g.x_min, g.x_max, g.y_min, g.y_max, g.z_min, g.z_max,
            g.has_building, g.pop, g.building_class,
            g.sensitivity_level, g.privacy_level,
            g.static_suitability_score, g.building_evaluation_score,
            g.geomm
          FROM static.grid_3d g
          WHERE g.geomm && s.sample_point
            AND ST_Covers(g.geomm, s.sample_point)
          ORDER BY
            CASE
              WHEN g.z_min <= $5::double precision AND g.z_max >= $5::double precision THEN 0
              ELSE 1
            END,
            LEAST(
              ABS(g.z_min - $5::double precision),
              ABS(g.z_max - $5::double precision)
            ),
            g.new_id
          LIMIT 1
        ) grid_cell ON true
      )
      SELECT
        g.sample_col, g.sample_row, g.sample_lng, g.sample_lat,
        g.new_id, g.grid_code,
        g.x_min, g.x_max, g.y_min, g.y_max, g.z_min, g.z_max,
        g.has_building, g.pop, g.building_class,
        g.sensitivity_level, g.privacy_level,
        g.static_suitability_score, g.building_evaluation_score,
        population.pop_value AS population_value,
        p.weekday AS population_requested_weekday,
        p.hour AS population_requested_hour,
        population.weekday AS population_sample_weekday,
        population.hour AS population_sample_hour,
        COALESCE(holiday.is_holiday, false) AS is_holiday,
        weather.recorded_at AS weather_recorded_at,
        weather.age_seconds AS weather_age_seconds,
        weather.wind_speed, weather.precipitation, weather.visibility,
        COALESCE(no_fly.names, '{}'::text[]) AS no_fly_zone_names,
        COALESCE(construction.names, '{}'::text[]) AS construction_names,
        COALESCE(event.names, '{}'::text[]) AS event_names
      FROM sampled_grids g
      CROSS JOIN planning p
      LEFT JOIN LATERAL (
        SELECT pp.pop_value, pp.weekday, pp.hour
        FROM periodic.population pp
        WHERE pp.grid_code = g.grid_code
          AND pp.weekday = p.weekday
        ORDER BY LEAST(ABS(pp.hour - p.hour), 24 - ABS(pp.hour - p.hour)), pp.id DESC
        LIMIT 1
      ) population ON true
      LEFT JOIN LATERAL (
        SELECT BOOL_OR(h.is_holiday) AS is_holiday
        FROM periodic.holidays h
        WHERE h.holiday_date = p.local_at::date
      ) holiday ON true
      LEFT JOIN LATERAL (
        SELECT
          w.recorded_at,
          EXTRACT(EPOCH FROM (p.planned_at - w.recorded_at)) AS age_seconds,
          w.wind_speed, w.precipitation, w.visibility
        FROM runtime.weather w
        WHERE w.grid_code = g.grid_code
          AND w.recorded_at <= p.planned_at
        ORDER BY w.recorded_at DESC, w.weather_id DESC
        LIMIT 1
      ) weather ON true
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(n.name ORDER BY n.zone_id) AS names
        FROM runtime.no_fly_zones n
        WHERE n.status = 'active'
          AND (n.start_time IS NULL OR n.start_time <= p.planned_at)
          AND (n.end_time IS NULL OR n.end_time >= p.planned_at)
          AND (n.z_min IS NULL OR g.z_max >= n.z_min)
          AND (n.z_max IS NULL OR g.z_min <= n.z_max)
          AND (
            (n.grid_code IS NOT NULL AND n.grid_code = g.grid_code)
            OR (n.zone IS NOT NULL AND n.zone && g.geomm AND ST_Intersects(n.zone, g.geomm))
          )
      ) no_fly ON true
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(c.name ORDER BY c.site_id) AS names
        FROM runtime.construction c
        WHERE c.status = 'ongoing'
          AND (c.start_time IS NULL OR c.start_time <= p.planned_at)
          AND (c.end_time IS NULL OR c.end_time >= p.planned_at)
          AND (
            (c.grid_code IS NOT NULL AND c.grid_code = g.grid_code)
            OR (c.location IS NOT NULL AND ST_Intersects(c.location, g.geomm))
          )
      ) construction ON true
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(e.name ORDER BY e.event_id) AS names
        FROM runtime.events e
        WHERE e.status IN ('scheduled', 'ongoing')
          AND (e.start_time IS NULL OR e.start_time <= p.planned_at)
          AND (e.end_time IS NULL OR e.end_time >= p.planned_at)
          AND (
            (e.grid_code IS NOT NULL AND e.grid_code = g.grid_code)
            OR (e.location IS NOT NULL AND ST_Intersects(e.location, g.geomm))
          )
      ) event ON true
      ORDER BY g.sample_row, g.sample_col
    `,
    [xMin, xMax, yMin, yMax, zTarget, cols, rows, at, timeZone]
  )
  const cells = await periodicContext.enrichCells(pool, result.rows, { at, timeZone })
  return { at, timeZone, cols, rows, cells }
}

async function close() {
  await pool.end()
}

module.exports = {
  DEFAULT_DATABASE,
  READ_ONLY,
  getStatus,
  getSummary,
  listFixedNodes,
  listBuildings,
  searchBuildings,
  getBuildingByName,
  listBuildingNearestNodes,
  getBuildingAccessPoints,
  listVehicleRules,
  listHighRiskCategories,
  listDrones,
  listGridCells,
  listDynamicCostInputs,
  getDynamicCostSurface,
  close,
}
