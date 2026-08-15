const PLACE_ALIASES = Object.freeze({
  图书馆: '杜厦图书馆',
  行政楼: '行政南楼',
  体育馆: '方肇周体育馆',
})

function normalizeName(value) {
  return String(value || '').trim()
}

function accessPointPredicate(role) {
  if (role === 'departure' || role === 'receiving') return "n.node_code ~ '^[A-G]$'"
  throw new TypeError('place role must be departure or receiving')
}

async function findBuilding(client, inputName) {
  const requestedName = normalizeName(inputName)
  const canonicalName = PLACE_ALIASES[requestedName] || requestedName
  const exact = await client.query(
    `SELECT
       building_id, building_name,
       ST_X(ST_Transform(location, 4326)) AS lng,
       ST_Y(ST_Transform(location, 4326)) AS lat
     FROM static.buildings
     WHERE building_name = $1
     LIMIT 1`,
    [canonicalName]
  )
  if (exact.rowCount) {
    return {
      row: exact.rows[0],
      requestedName,
      aliasUsed: canonicalName !== requestedName,
      candidates: [],
    }
  }

  const partial = await client.query(
    `SELECT building_name
     FROM static.buildings
     WHERE building_name ILIKE '%' || $1 || '%'
     ORDER BY length(building_name), building_name COLLATE "C"
     LIMIT 6`,
    [canonicalName]
  )
  return {
    row: null,
    requestedName,
    aliasUsed: false,
    candidates: partial.rows.map((row) => row.building_name),
  }
}

async function findNearestAccessPoint(client, buildingName, role) {
  const result = await client.query(
    `SELECT
       n.node_id, n.node_code, n.node_name, n.node_type,
       ST_X(ST_Transform(n.location, 4326)) AS lng,
       ST_Y(ST_Transform(n.location, 4326)) AS lat,
       d.distance_m
     FROM static.building_node_distance d
     JOIN static.fixed_nodes n ON n.node_code = d.node_code
     WHERE d.building_name = $1
       AND n.status = 'active'
       AND ${accessPointPredicate(role)}
     ORDER BY d.distance_m, n.node_id
     LIMIT 1`,
    [buildingName]
  )
  return result.rows[0] || null
}

async function resolvePlace(inputName, options = {}) {
  const name = normalizeName(inputName)
  if (!name) throw new TypeError('place name is required')
  if (!options.client) throw new TypeError('database client is required to resolve an official building')

  const match = await findBuilding(options.client, name)
  if (!match.row) {
    const error = new Error(match.candidates.length
      ? `地点“${name}”不是正式建筑名称，请从候选建筑中选择`
      : `未找到地点“${name}”，请从83栋正式校园建筑中选择`)
    error.code = 'PLACE_NOT_FOUND'
    error.details = { place: name, candidates: match.candidates }
    throw error
  }

  const role = options.role || 'receiving'
  const accessPoint = await findNearestAccessPoint(options.client, match.row.building_name, role)
  if (!accessPoint) {
    const error = new Error(`建筑“${match.row.building_name}”附近没有可用的L3三级运输节点`)
    error.code = 'PLACE_NOT_FOUND'
    error.details = { place: match.row.building_name, role }
    throw error
  }

  return {
    name: accessPoint.node_name,
    requested_name: name,
    building_id: Number(match.row.building_id),
    building_name: match.row.building_name,
    building_location: {
      lng: Number(match.row.lng),
      lat: Number(match.row.lat),
    },
    lng: Number(accessPoint.lng),
    lat: Number(accessPoint.lat),
    height: Number(options.height || 80),
    source: 'v3_building_node_distance',
    access_role: role,
    node_id: Number(accessPoint.node_id),
    node_code: accessPoint.node_code,
    node_type: accessPoint.node_type,
    distance_m: Number(accessPoint.distance_m),
    alias_used: match.aliasUsed,
  }
}

function supportedPlaceNames() {
  return Object.keys(PLACE_ALIASES)
}

module.exports = {
  PLACE_ALIASES,
  resolvePlace,
  supportedPlaceNames,
  _findBuilding: findBuilding,
  _findNearestAccessPoint: findNearestAccessPoint,
}
