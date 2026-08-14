const CONTEXT_TTL_MS = 30_000
let cachedContext = null
let cachedAt = 0

function toNumber(value) {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function loadAgentContext(pool) {
  if (cachedContext && Date.now() - cachedAt < CONTEXT_TTL_MS) return cachedContext
  try {
    const [buildings, vehicleRules, riskCategories] = await Promise.all([
      pool.query(`
        SELECT
          b.building_id,
          b.building_name,
          ST_X(ST_Transform(b.location, 4326)) AS lng,
          ST_Y(ST_Transform(b.location, 4326)) AS lat,
          COALESCE(departure.nodes, '[]'::jsonb) AS departure_nodes,
          COALESCE(receiving.nodes, '[]'::jsonb) AS receiving_nodes
        FROM static.buildings b
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'node_id', ranked.node_id,
              'node_code', ranked.node_code,
              'node_name', ranked.node_name,
              'node_type', ranked.node_type,
              'distance_m', ranked.distance_m,
              'lng', ranked.lng,
              'lat', ranked.lat
            ) ORDER BY ranked.distance_m, ranked.node_id
          ) AS nodes
          FROM (
            SELECT
              n.node_id, n.node_code, n.node_name, n.node_type, d.distance_m,
              ST_X(ST_Transform(n.location, 4326)) AS lng,
              ST_Y(ST_Transform(n.location, 4326)) AS lat
            FROM static.building_node_distance d
            JOIN static.fixed_nodes n ON n.node_code = d.node_code
            WHERE d.building_name = b.building_name
              AND n.status = 'active'
              AND (n.node_code = 'hub' OR n.node_code ~ '^[a-e]$')
            ORDER BY d.distance_m, n.node_id
            LIMIT 3
          ) ranked
        ) departure ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'node_id', ranked.node_id,
              'node_code', ranked.node_code,
              'node_name', ranked.node_name,
              'node_type', ranked.node_type,
              'distance_m', ranked.distance_m,
              'lng', ranked.lng,
              'lat', ranked.lat
            ) ORDER BY ranked.distance_m, ranked.node_id
          ) AS nodes
          FROM (
            SELECT
              n.node_id, n.node_code, n.node_name, n.node_type, d.distance_m,
              ST_X(ST_Transform(n.location, 4326)) AS lng,
              ST_Y(ST_Transform(n.location, 4326)) AS lat
            FROM static.building_node_distance d
            JOIN static.fixed_nodes n ON n.node_code = d.node_code
            WHERE d.building_name = b.building_name
              AND n.status = 'active'
              AND n.node_code ~ '^[A-G]$'
            ORDER BY d.distance_m, n.node_id
            LIMIT 3
          ) ranked
        ) receiving ON true
        ORDER BY b.building_name COLLATE "C", b.building_id
      `),
      pool.query(`
        SELECT item_category, min_weight_kg, max_weight_kg,
               vehicle_class, special_handling, remarks
        FROM static.vehicle_rules
        ORDER BY item_category, min_weight_kg, max_weight_kg
      `),
      pool.query(`
        SELECT category_name, requires_manual, requires_cold_chain,
               requires_shockproof, max_weight_no_review
        FROM static.high_risk_categories
        ORDER BY category_name
      `),
    ])
    const normalizeAccessPoint = (node) => ({
      node_id: Number(node.node_id),
      node_code: node.node_code,
      node_name: node.node_name,
      node_type: node.node_type,
      distance_m: toNumber(node.distance_m),
      lng: toNumber(node.lng),
      lat: toNumber(node.lat),
    })
    const databasePlaces = buildings.rows.map((row) => ({
      building_id: Number(row.building_id),
      name: row.building_name,
      aliases: [],
      lng: toNumber(row.lng),
      lat: toNumber(row.lat),
      departure_nodes: (row.departure_nodes || []).map(normalizeAccessPoint),
      receiving_nodes: (row.receiving_nodes || []).map(normalizeAccessPoint),
      nearest_departure: row.departure_nodes?.length ? normalizeAccessPoint(row.departure_nodes[0]) : null,
      nearest_receiving: row.receiving_nodes?.length ? normalizeAccessPoint(row.receiving_nodes[0]) : null,
      source: 'static.buildings',
    }))
    cachedContext = {
      places: databasePlaces,
      vehicleRules: vehicleRules.rows,
      highRiskCategories: riskCategories.rows,
      source: 'v3_static_buildings+distance_matrix+rules',
    }
    cachedAt = Date.now()
    return cachedContext
  } catch (error) {
    return {
      places: [],
      vehicleRules: [],
      highRiskCategories: [],
      source: 'v3_static_buildings_unavailable',
      warning: error.message,
    }
  }
}

function clearAgentContextCache() {
  cachedContext = null
  cachedAt = 0
}

module.exports = { loadAgentContext, clearAgentContextCache }
