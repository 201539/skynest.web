const CONTEXT_TTL_MS = 30_000
let cachedContext = null
let cachedAt = 0

function toNumber(value) {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function loadAgentContext(pool, fallbackPlaceNames = []) {
  if (cachedContext && Date.now() - cachedAt < CONTEXT_TTL_MS) return cachedContext
  const fallbackPlaces = fallbackPlaceNames.map((name, index) => ({
    node_id: `campus:${index + 1}`,
    name,
    aliases: [],
    source: 'campus_places',
  }))
  try {
    const [nodes, vehicleRules, riskCategories] = await Promise.all([
      pool.query(`
        SELECT node_id, node_code, node_name, node_type, status,
               ST_X(location) AS lng, ST_Y(location) AS lat
        FROM static.fixed_nodes
        WHERE status = 'active'
        ORDER BY node_id
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
    const databasePlaces = nodes.rows.map((row) => ({
      node_id: Number(row.node_id),
      nodeCode: row.node_code,
      name: row.node_name,
      nodeType: row.node_type,
      aliases: [],
      lng: toNumber(row.lng),
      lat: toNumber(row.lat),
      source: 'static.fixed_nodes',
    }))
    const databaseNames = new Set(databasePlaces.map((place) => place.name))
    cachedContext = {
      places: [...databasePlaces, ...fallbackPlaces.filter((place) => !databaseNames.has(place.name))],
      vehicleRules: vehicleRules.rows,
      highRiskCategories: riskCategories.rows,
      source: 'v3_static_rules+campus_places',
    }
    cachedAt = Date.now()
    return cachedContext
  } catch (error) {
    return {
      places: fallbackPlaces,
      vehicleRules: [],
      highRiskCategories: [],
      source: 'campus_places_fallback',
      warning: error.message,
    }
  }
}

function clearAgentContextCache() {
  cachedContext = null
  cachedAt = 0
}

module.exports = { loadAgentContext, clearAgentContextCache }
