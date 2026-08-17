const dynamicCost = require('./dynamicCost')
const v3Database = require('./v3Database')

function normalizeRoute(value) {
  const route = Array.isArray(value) ? value.map((point) => ({
    lng: Number(point?.lng),
    lat: Number(point?.lat),
  })) : []
  if (route.length < 2 || route.some((point) => !Number.isFinite(point.lng) || !Number.isFinite(point.lat))) {
    throw new TypeError('route must contain at least two lng/lat points')
  }
  return route
}

function buildCorridorBbox(route, corridorMeters) {
  const metersPerDegreeLng = 111320 * Math.max(Math.cos(route[0].lat * Math.PI / 180), 0.2)
  const lngPad = corridorMeters / metersPerDegreeLng
  const latPad = corridorMeters / 111320
  return {
    xMin: Math.min(...route.map((point) => point.lng)) - lngPad,
    xMax: Math.max(...route.map((point) => point.lng)) + lngPad,
    yMin: Math.min(...route.map((point) => point.lat)) - latPad,
    yMax: Math.max(...route.map((point) => point.lat)) + latPad,
  }
}

function distanceToSegmentMeters(point, start, end, metersPerDegreeLng) {
  const px = (point.lng - start.lng) * metersPerDegreeLng
  const py = (point.lat - start.lat) * 111320
  const ex = (end.lng - start.lng) * metersPerDegreeLng
  const ey = (end.lat - start.lat) * 111320
  const lengthSquared = ex * ex + ey * ey
  const ratio = lengthSquared > 0 ? Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared)) : 0
  return Math.hypot(px - ratio * ex, py - ratio * ey)
}

function filterCorridorCells(route, sourceCells, evaluated, corridorMeters) {
  const metersPerDegreeLng = 111320 * Math.max(Math.cos(route[0].lat * Math.PI / 180), 0.2)
  const samples = evaluated.map((result, index) => {
    const source = sourceCells[index]
    const point = { lng: Number(source.sample_lng), lat: Number(source.sample_lat) }
    let routeDistance = Number.POSITIVE_INFINITY
    for (let routeIndex = 1; routeIndex < route.length; routeIndex += 1) {
      routeDistance = Math.min(
        routeDistance,
        distanceToSegmentMeters(point, route[routeIndex - 1], route[routeIndex], metersPerDegreeLng),
      )
    }
    return {
      sample_col: source.sample_col == null ? null : Number(source.sample_col),
      sample_row: source.sample_row == null ? null : Number(source.sample_row),
      sample_lng: point.lng,
      sample_lat: point.lat,
      route_distance_m: Math.round(routeDistance * 10) / 10,
      ...result,
      x_min: result.bounds?.x_min,
      x_max: result.bounds?.x_max,
      y_min: result.bounds?.y_min,
      y_max: result.bounds?.y_max,
      z_min: result.bounds?.z_min,
      z_max: result.bounds?.z_max,
    }
  }).filter((cell) => cell.route_distance_m <= corridorMeters)

  const cellsByGrid = new Map()
  for (const cell of samples) {
    if (cell.new_id == null || cell.bounds?.x_min == null || cell.bounds?.y_min == null) continue
    const key = cell.grid_code || String(cell.new_id)
    const previous = cellsByGrid.get(key)
    if (!previous || cell.route_distance_m < previous.route_distance_m) cellsByGrid.set(key, cell)
  }
  const data = [...cellsByGrid.values()].sort((left, right) =>
    left.route_distance_m - right.route_distance_m || left.sample_row - right.sample_row || left.sample_col - right.sample_col)
  return { samples, data }
}

async function evaluateRouteCorridor(body = {}, options = {}) {
  const route = normalizeRoute(body.route)
  const corridorMeters = Math.min(Math.max(Number(body.corridor_meters) || 90, 25), 300)
  const zTarget = Number(body.z_target)
  if (!Number.isFinite(zTarget)) throw new TypeError('z_target must be a finite number')
  const bbox = buildCorridorBbox(route, corridorMeters)
  const surface = options.surfaceProvider
    ? await options.surfaceProvider({
        ...bbox,
        zTarget,
        cols: body.cols,
        rows: body.rows,
        at: body.at,
        timeZone: body.time_zone,
      })
    : await v3Database.listDynamicCostInputs({
        ...bbox,
        route,
        corridorMeters,
        zTarget,
        at: body.at,
        timeZone: body.time_zone,
        unlimited: true,
      }).then((result) => ({
        at: result.at,
        timeZone: result.timeZone,
        cols: null,
        rows: null,
        cells: result.rows,
      }))
  const sourceCells = surface.cells.map((cell) => ({ ...cell, grid_data_missing: cell.new_id == null }))
  const costOptions = {
    profile: body.profile,
    weights: body.weights,
    riskScale: body.risk_scale,
    thresholds: body.thresholds,
    overrides: body.overrides,
  }
  const evaluated = dynamicCost.evaluateCells(sourceCells, costOptions)
  const { samples, data } = filterCorridorCells(route, sourceCells, evaluated, corridorMeters)
  return {
    at: surface.at,
    time_zone: surface.timeZone,
    corridor_meters: corridorMeters,
    bbox,
    cols: surface.cols,
    rows: surface.rows,
    query_mode: options.surfaceProvider ? 'sampled-surface' : 'complete-corridor',
    model: dynamicCost.getModelConfig(costOptions),
    summary: dynamicCost.summarizeCosts(data),
    coverage: {
      sampled: samples.length,
      matched_samples: samples.filter((cell) => cell.new_id != null).length,
      unique_grids: data.length,
    },
    data,
  }
}

module.exports = {
  evaluateRouteCorridor,
  buildCorridorBbox,
  distanceToSegmentMeters,
  filterCorridorCells,
}
