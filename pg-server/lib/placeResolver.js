const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_ANCHOR = { lng: 118.944736, lat: 32.10747, height: 0 }
const EARTH_RADIUS_METERS = 6378137
const PLACE_ALIASES = Object.freeze({
  环境学院: '理科楼群',
  二期实验楼: '实验中心',
  体育馆: '方肇周体育馆',
  南门: '南门入口',
  北门: '北门广场',
})

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

const appConfig = readJson(
  path.join(__dirname, '..', '..', 'demo', 'public', 'config', 'app.json'),
  {}
)
const anchor = appConfig.fallbackModel?.position || appConfig.campusCenter || DEFAULT_ANCHOR
const configuredPlaces = readJson(
  path.join(__dirname, '..', '..', 'demo', 'public', 'data', 'places.json'),
  []
)

function localMetersToWgs84(eastMeters, northMeters, height = 80) {
  const lat = Number(anchor.lat) + (Number(northMeters) / EARTH_RADIUS_METERS) * (180 / Math.PI)
  const lng = Number(anchor.lng) + (
    Number(eastMeters) / (EARTH_RADIUS_METERS * Math.cos(Number(anchor.lat) * Math.PI / 180))
  ) * (180 / Math.PI)
  return { lng, lat, height: Number(height) || 80 }
}

const placeIndex = new Map(configuredPlaces.map((place) => [
  String(place.name).trim(),
  {
    name: String(place.name).trim(),
    ...localMetersToWgs84(place.eastMeters, place.northMeters, place.height),
    source: 'campus_places',
  },
]))

function findConfiguredPlace(inputName) {
  const name = String(inputName || '').trim()
  const canonicalName = PLACE_ALIASES[name] || name
  const exact = placeIndex.get(canonicalName)
  if (exact) return { ...exact, requested_name: name, alias_used: canonicalName !== name }

  const candidates = [...placeIndex.values()].filter((place) =>
    place.name.includes(canonicalName) || canonicalName.includes(place.name)
  )
  if (candidates.length === 1) {
    return { ...candidates[0], requested_name: name, alias_used: candidates[0].name !== name }
  }
  return null
}

async function resolvePlace(inputName, options = {}) {
  const name = String(inputName || '').trim()
  if (!name) throw new TypeError('place name is required')
  const client = options.client
  if (client) {
    const fixedNode = await client.query(
      `
        SELECT node_id, node_name, ST_X(location) AS lng, ST_Y(location) AS lat
        FROM static.fixed_nodes
        WHERE status = 'active'
          AND (node_name = $1 OR node_code = $1 OR node_name ILIKE '%' || $1 || '%')
        ORDER BY CASE WHEN node_name = $1 OR node_code = $1 THEN 0 ELSE 1 END, node_id
        LIMIT 2
      `,
      [name]
    )
    if (fixedNode.rowCount === 1) {
      return {
        name: fixedNode.rows[0].node_name,
        requested_name: name,
        lng: Number(fixedNode.rows[0].lng),
        lat: Number(fixedNode.rows[0].lat),
        height: Number(options.height || 80),
        source: 'v3_fixed_node',
        node_id: Number(fixedNode.rows[0].node_id),
        alias_used: fixedNode.rows[0].node_name !== name,
      }
    }
  }

  const configured = findConfiguredPlace(name)
  if (configured) return { ...configured, height: Number(options.height || configured.height || 80) }

  const error = new Error(`无法定位地点“${name}”，请使用已标定的校园建筑名称`)
  error.code = 'PLACE_NOT_FOUND'
  error.details = { place: name, supported_places: supportedPlaceNames() }
  throw error
}

function supportedPlaceNames() {
  return [...new Set([...placeIndex.keys(), ...Object.keys(PLACE_ALIASES)])].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

module.exports = {
  resolvePlace,
  supportedPlaceNames,
  localMetersToWgs84,
  _anchor: anchor,
}
