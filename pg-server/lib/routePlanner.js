// 与白模锚点 + eastMeters/northMeters 布局一致（118.944736, 32.107470 附近）
const CAMPUS = { lng: 118.951, lat: 32.114, pad: 0.018 }
const dynamicCost = require('./dynamicCost')

function clampToCampus(bbox) {
  return {
    xMin: Math.max(bbox.xMin, CAMPUS.lng - CAMPUS.pad),
    xMax: Math.min(bbox.xMax, CAMPUS.lng + CAMPUS.pad),
    yMin: Math.max(bbox.yMin, CAMPUS.lat - CAMPUS.pad),
    yMax: Math.min(bbox.yMax, CAMPUS.lat + CAMPUS.pad),
  }
}

function computeSearchBbox(start, end, options = {}) {
  const minPad = options.minPad ?? 0.002
  const ratio = options.ratio ?? 0.3
  const lngMin = Math.min(start.lng, end.lng)
  const lngMax = Math.max(start.lng, end.lng)
  const latMin = Math.min(start.lat, end.lat)
  const latMax = Math.max(start.lat, end.lat)
  const span = Math.max(lngMax - lngMin, latMax - latMin, 0.0008)
  const pad = Math.max(minPad, span * ratio)
  return clampToCampus({
    xMin: lngMin - pad,
    xMax: lngMax + pad,
    yMin: latMin - pad,
    yMax: latMax + pad,
  })
}

function haversineMeters(lng1, lat1, lng2, lat2) {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function getScoreAtPoint(grids, lng, lat, zTarget) {
  let best = null
  let bestZDist = Infinity
  for (const g of grids) {
    const xMin = parseFloat(g.x_min)
    const xMax = parseFloat(g.x_max)
    const yMin = parseFloat(g.y_min)
    const yMax = parseFloat(g.y_max)
    if (lng < xMin || lng > xMax || lat < yMin || lat > yMax) continue
    const zMid = (parseFloat(g.z_min) + parseFloat(g.z_max)) / 2
    const zDist = Math.abs(zMid - zTarget)
    if (zDist < bestZDist) {
      bestZDist = zDist
      best = g
    }
  }
  return best != null ? parseFloat(best.static_suitability_score) : null
}

function idx(c, r, cols) {
  return r * cols + c
}

const MOVE_DIRECTIONS = Object.freeze([
  Object.freeze({ dc: 1, dr: 0 }),
  Object.freeze({ dc: 1, dr: 1 }),
  Object.freeze({ dc: 0, dr: 1 }),
  Object.freeze({ dc: -1, dr: 1 }),
  Object.freeze({ dc: -1, dr: 0 }),
  Object.freeze({ dc: -1, dr: -1 }),
  Object.freeze({ dc: 0, dr: -1 }),
  Object.freeze({ dc: 1, dr: -1 }),
])
const NO_MOVE_DIRECTION = MOVE_DIRECTIONS.length
const DIRECTION_STATE_COUNT = MOVE_DIRECTIONS.length + 1
const TURN_EQUIVALENT_METERS_PER_45_DEGREES = 10

function turnAngleDegrees(fromDirection, toDirection) {
  if (
    fromDirection === NO_MOVE_DIRECTION
    || fromDirection == null
    || toDirection == null
    || fromDirection === toDirection
  ) return 0
  const directionDelta = Math.abs(fromDirection - toDirection)
  return Math.min(directionDelta, MOVE_DIRECTIONS.length - directionDelta) * 45
}

function turnEquivalentMeters(fromDirection, toDirection) {
  return (turnAngleDegrees(fromDirection, toDirection) / 45)
    * TURN_EQUIVALENT_METERS_PER_45_DEGREES
}

function directionBetweenNodes(fromIndex, toIndex, cols) {
  const fromCol = fromIndex % cols
  const fromRow = Math.floor(fromIndex / cols)
  const toCol = toIndex % cols
  const toRow = Math.floor(toIndex / cols)
  const dc = Math.sign(toCol - fromCol)
  const dr = Math.sign(toRow - fromRow)
  return MOVE_DIRECTIONS.findIndex((direction) => direction.dc === dc && direction.dr === dr)
}

function summarizePathManeuvers(pathNodes, cols) {
  let turnCount = 0
  let totalTurnAngleDegrees = 0
  for (let pathIndex = 2; pathIndex < pathNodes.length; pathIndex++) {
    const previousDirection = directionBetweenNodes(pathNodes[pathIndex - 2], pathNodes[pathIndex - 1], cols)
    const currentDirection = directionBetweenNodes(pathNodes[pathIndex - 1], pathNodes[pathIndex], cols)
    const angle = turnAngleDegrees(previousDirection, currentDirection)
    if (angle <= 0) continue
    turnCount++
    totalTurnAngleDegrees += angle
  }
  return {
    turnCount,
    totalTurnAngleDegrees,
    turnEquivalentMeters: (totalTurnAngleDegrees / 45)
      * TURN_EQUIVALENT_METERS_PER_45_DEGREES,
    climbMeters: 0,
    descentMeters: 0,
    climbCost: 0,
    descentCost: 0,
  }
}

function gridStepDistanceMeters(fromIndex, toIndex, bbox, cols, rows) {
  const from = nodeToLngLat(fromIndex, bbox, cols, rows)
  const to = nodeToLngLat(toIndex, bbox, cols, rows)
  return haversineMeters(from.lng, from.lat, to.lng, to.lat)
}

function astar(passable, costs, cols, rows, startIdx, endIdx, bbox, maneuverWeight = 0) {
  const totalNodes = cols * rows
  const totalStates = totalNodes * DIRECTION_STATE_COUNT
  const gScore = new Float64Array(totalStates).fill(Infinity)
  const fScore = new Float64Array(totalStates).fill(Infinity)
  const cameFrom = new Int32Array(totalStates).fill(-1)
  const closed = new Uint8Array(totalStates)
  let minimumTraversalCost = Infinity
  for (let nodeIndex = 0; nodeIndex < totalNodes; nodeIndex++) {
    if (passable[nodeIndex] && Number.isFinite(costs[nodeIndex])) {
      minimumTraversalCost = Math.min(minimumTraversalCost, Math.max(costs[nodeIndex], 0))
    }
  }
  if (!Number.isFinite(minimumTraversalCost)) minimumTraversalCost = 0
  const endPoint = nodeToLngLat(endIdx, bbox, cols, rows)
  const heuristic = (nodeIndex) => {
    const point = nodeToLngLat(nodeIndex, bbox, cols, rows)
    return haversineMeters(point.lng, point.lat, endPoint.lng, endPoint.lat)
      * minimumTraversalCost
  }

  const open = []
  const pushOpen = (stateIndex) => {
    let lo = 0
    let hi = open.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (fScore[open[mid]] < fScore[stateIndex]) lo = mid + 1
      else hi = mid
    }
    open.splice(lo, 0, stateIndex)
  }

  const startState = startIdx * DIRECTION_STATE_COUNT + NO_MOVE_DIRECTION
  gScore[startState] = 0
  fScore[startState] = heuristic(startIdx)
  pushOpen(startState)

  while (open.length) {
    const currentState = open.shift()
    const currentNode = Math.floor(currentState / DIRECTION_STATE_COUNT)
    const incomingDirection = currentState % DIRECTION_STATE_COUNT
    if (currentNode === endIdx) {
      const path = []
      let currentPathState = currentState
      while (currentPathState !== -1) {
        path.push(Math.floor(currentPathState / DIRECTION_STATE_COUNT))
        currentPathState = cameFrom[currentPathState]
      }
      return path.reverse()
    }
    if (closed[currentState]) continue
    closed[currentState] = 1

    const c = currentNode % cols
    const r = Math.floor(currentNode / cols)

    for (let directionIndex = 0; directionIndex < MOVE_DIRECTIONS.length; directionIndex++) {
      const { dc, dr } = MOVE_DIRECTIONS[directionIndex]
      const nc = c + dc
      const nr = r + dr
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
      const neighborNode = idx(nc, nr, cols)
      if (!passable[neighborNode]) continue
      if (dc !== 0 && dr !== 0) {
        const horizontalSideNode = idx(nc, r, cols)
        const verticalSideNode = idx(c, nr, cols)
        if (!passable[horizontalSideNode] || !passable[verticalSideNode]) continue
      }
      const neighborState = neighborNode * DIRECTION_STATE_COUNT + directionIndex
      if (closed[neighborState]) continue

      const stepDistanceMeters = gridStepDistanceMeters(
        currentNode,
        neighborNode,
        bbox,
        cols,
        rows
      )
      const maneuverCost = maneuverWeight * turnEquivalentMeters(incomingDirection, directionIndex)
      const tentative = gScore[currentState]
        + costs[neighborNode] * stepDistanceMeters
        + maneuverCost
      if (tentative >= gScore[neighborState]) continue

      cameFrom[neighborState] = currentState
      gScore[neighborState] = tentative
      fScore[neighborState] = tentative + heuristic(neighborNode)
      const existingOpenIndex = open.indexOf(neighborState)
      if (existingOpenIndex >= 0) open.splice(existingOpenIndex, 1)
      pushOpen(neighborState)
    }
  }

  return null
}

const COST_COMPONENT_LABELS = Object.freeze({
  static: '静态环境',
  population: '周期人流',
  weather: '天气',
  runtime: '实时事件',
  energy: '能耗',
})

function roundCost(value, digits = 4) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function buildRouteDecisionTrace({
  pathNodes,
  resultByNode,
  cellByNode,
  cols,
  rows,
  bbox,
  intraCellDistanceMeters,
  model,
  totalTraversalCost,
  summary,
  dataCoverage,
  sampledAt,
  timeZone,
  flightHeight,
}) {
  const componentNames = Object.keys(COST_COMPONENT_LABELS)
  const maneuverSummary = summarizePathManeuvers(pathNodes, cols)
  const accumulators = Object.fromEntries(componentNames.map((name) => [name, {
    weightedRisk: 0,
    normalizedRisk: 0,
    rawCost: 0,
  }]))
  let stepDistanceUnits = 0
  let distanceMeters = 0
  let highestRiskCell = null

  for (let pathIndex = 1; pathIndex < pathNodes.length; pathIndex++) {
    const previousNode = pathNodes[pathIndex - 1]
    const currentNode = pathNodes[pathIndex]
    const previousCol = previousNode % cols
    const previousRow = Math.floor(previousNode / cols)
    const currentCol = currentNode % cols
    const currentRow = Math.floor(currentNode / cols)
    const stepMultiplier = Math.hypot(currentCol - previousCol, currentRow - previousRow)
    const stepDistanceMeters = gridStepDistanceMeters(
      previousNode,
      currentNode,
      bbox,
      cols,
      rows
    )
    const cellCost = resultByNode[currentNode]
    stepDistanceUnits += stepMultiplier
    distanceMeters += stepDistanceMeters

    for (const name of componentNames) {
      const breakdown = cellCost?.breakdown?.[name]
      const contribution = Number(breakdown?.contribution) || 0
      const normalizedRisk = Number(breakdown?.normalized_risk) || 0
      accumulators[name].weightedRisk += contribution * stepDistanceMeters
      accumulators[name].normalizedRisk += normalizedRisk * stepDistanceMeters
      accumulators[name].rawCost += model.riskScale * contribution * stepDistanceMeters
    }

    if (!highestRiskCell || Number(cellCost?.weighted_risk) > highestRiskCell.weighted_risk) {
      highestRiskCell = {
        grid_code: cellByNode[currentNode]?.grid_code || null,
        weighted_risk: Number(cellCost?.weighted_risk) || 0,
        suitability_score: Number(cellCost?.suitability_score) || 0,
        traversal_cost: Number(cellCost?.traversal_cost) || 0,
      }
    }
  }

  if (pathNodes.length === 1 && intraCellDistanceMeters > 0) {
    const currentNode = pathNodes[0]
    const cellCost = resultByNode[currentNode]
    distanceMeters += intraCellDistanceMeters

    for (const name of componentNames) {
      const breakdown = cellCost?.breakdown?.[name]
      const contribution = Number(breakdown?.contribution) || 0
      const normalizedRisk = Number(breakdown?.normalized_risk) || 0
      accumulators[name].weightedRisk += contribution * intraCellDistanceMeters
      accumulators[name].normalizedRisk += normalizedRisk * intraCellDistanceMeters
      accumulators[name].rawCost += model.riskScale * contribution * intraCellDistanceMeters
    }

    highestRiskCell = {
      grid_code: cellByNode[currentNode]?.grid_code || null,
      weighted_risk: Number(cellCost?.weighted_risk) || 0,
      suitability_score: Number(cellCost?.suitability_score) || 0,
      traversal_cost: Number(cellCost?.traversal_cost) || 0,
    }
  }

  const roundedTotalTraversalCost = roundCost(totalTraversalCost)
  const distanceCost = roundCost(distanceMeters * model.distanceWeight)
  const maneuverCost = roundCost(
    maneuverSummary.turnEquivalentMeters * model.maneuverWeight
  )
  const riskCost = roundCost(Math.max(
    0,
    totalTraversalCost
      - distanceMeters * model.distanceWeight
      - maneuverSummary.turnEquivalentMeters * model.maneuverWeight
  ))
  const rawRiskCost = componentNames.reduce((sum, name) => sum + accumulators[name].rawCost, 0)
  const contributionScale = rawRiskCost > 0 ? riskCost / rawRiskCost : 0
  const components = Object.fromEntries(componentNames.map((name) => {
    const accumulator = accumulators[name]
    const costContribution = accumulator.rawCost * contributionScale
    return [name, {
      label: COST_COMPONENT_LABELS[name],
      weight: roundCost(model.weights[name], 6),
      average_normalized_risk: distanceMeters > 0
        ? roundCost(accumulator.normalizedRisk / distanceMeters, 6)
        : 0,
      average_weighted_contribution: distanceMeters > 0
        ? roundCost(accumulator.weightedRisk / distanceMeters, 6)
        : 0,
      cost_contribution: roundCost(costContribution),
      share_of_risk_cost: riskCost > 0 ? roundCost(costContribution / riskCost, 6) : 0,
    }]
  }))
  const layers = {
    static: {
      label: '静态层',
      cost_contribution: components.static.cost_contribution,
    },
    periodic: {
      label: '周期层',
      cost_contribution: components.population.cost_contribution,
    },
    realtime: {
      label: '实时层',
      cost_contribution: roundCost(
        components.weather.cost_contribution
        + components.runtime.cost_contribution
        + components.energy.cost_contribution
      ),
    },
  }
  const primaryCandidate = componentNames.reduce((best, name) => (
    !best || components[name].cost_contribution > components[best].cost_contribution ? name : best
  ), null)
  const primaryComponent = primaryCandidate && components[primaryCandidate].cost_contribution > 0
    ? primaryCandidate
    : null
  const primaryLabel = primaryComponent ? COST_COMPONENT_LABELS[primaryComponent] : null
  const riskContributionSummary = primaryLabel
    ? `主要风险 Cost 贡献来自${primaryLabel}`
    : '本航线没有产生额外风险 Cost'
  const pathBreakdown = {
    total_traversal_cost: roundedTotalTraversalCost,
    base_distance_cost: distanceCost,
    risk_cost: riskCost,
    maneuver_cost: maneuverCost,
    risk_scale: roundCost(model.riskScale, 6),
    step_distance_units: roundCost(stepDistanceUnits),
    distance_meters: roundCost(distanceMeters),
    distance: {
      label: '航程距离',
      raw_distance_meters: roundCost(distanceMeters),
      weight: roundCost(model.distanceWeight, 6),
      cost_contribution: distanceCost,
      unit: 'm',
    },
    maneuver: {
      label: '飞行机动',
      turn_count: maneuverSummary.turnCount,
      total_turn_angle_degrees: maneuverSummary.totalTurnAngleDegrees,
      turn_equivalent_meters: maneuverSummary.turnEquivalentMeters,
      weight: roundCost(model.maneuverWeight, 6),
      cost_contribution: maneuverCost,
      climb_meters: maneuverSummary.climbMeters,
      descent_meters: maneuverSummary.descentMeters,
      climb_cost: maneuverSummary.climbCost,
      descent_cost: maneuverSummary.descentCost,
      unit: 'equivalent_m',
    },
    path_cell_count: Math.max(pathNodes.length - 1, 0),
    average_weighted_risk: distanceMeters > 0 && model.riskScale > 0
      ? roundCost(riskCost / model.riskScale / distanceMeters, 6)
      : 0,
    components,
    layers,
    highest_risk_cell: highestRiskCell
      ? Object.fromEntries(Object.entries(highestRiskCell).map(([key, value]) => [
          key,
          typeof value === 'number' ? roundCost(value, 6) : value,
        ]))
      : null,
  }
  const decisionTrace = {
    version: 'route-decision-v1',
    objective: 'minimum_total_traversal_cost',
    algorithm: 'A*',
    cost_model: 'dynamic-v1',
    formula: 'edge_cost = distance_meters × (distanceWeight + riskScale × Σ(normalized_risk × weight)) + maneuverWeight × turn_equivalent_meters',
    model: {
      profile: model.profile,
      distance_weight: roundCost(model.distanceWeight, 6),
      maneuver_weight: roundCost(model.maneuverWeight, 6),
      risk_scale: roundCost(model.riskScale, 6),
      weights: { ...model.weights },
    },
    path_cost: pathBreakdown,
    constraints: {
      blocked_cells: summary.blocked,
      blocked_reasons: summary.blocked_reasons,
      flight_height: {
        planned: roundCost(flightHeight, 2),
        minimum: roundCost(model.thresholds.minFlightHeight, 2),
        maximum: roundCost(model.thresholds.maxFlightHeight, 2),
        unit: 'm',
      },
    },
    data: {
      sampled_at: sampledAt,
      time_zone: timeZone,
      data_coverage: dataCoverage,
      weather_data: summary.weather_data,
    },
    selection_reason: {
      code: 'minimum_total_traversal_cost',
      primary_cost_factor: primaryComponent,
      summary: `在本次搜索格网、权重和硬约束下，A* 选择了累计通行 Cost 最低的可达路径；${riskContributionSummary}。`,
    },
  }

  return { pathBreakdown, decisionTrace }
}

function snapToNode(lng, lat, bbox, cols, rows) {
  const stepX = (bbox.xMax - bbox.xMin) / cols
  const stepY = (bbox.yMax - bbox.yMin) / rows
  let c = Math.round((lng - bbox.xMin) / stepX - 0.5)
  let r = Math.round((lat - bbox.yMin) / stepY - 0.5)
  c = Math.max(0, Math.min(cols - 1, c))
  r = Math.max(0, Math.min(rows - 1, r))
  return { c, r, idx: idx(c, r, cols) }
}

function findNearestPassable(passable, cols, rows, c0, r0) {
  if (passable[idx(c0, r0, cols)]) return idx(c0, r0, cols)
  const maxR = Math.max(cols, rows)
  for (let radius = 1; radius <= maxR; radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue
        const c = c0 + dc
        const r = r0 + dr
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue
        const i = idx(c, r, cols)
        if (passable[i]) return i
      }
    }
  }
  return idx(c0, r0, cols)
}

function nodeToLngLat(nodeIndex, bbox, cols, rows) {
  const stepX = (bbox.xMax - bbox.xMin) / cols
  const stepY = (bbox.yMax - bbox.yMin) / rows
  const c = nodeIndex % cols
  const r = Math.floor(nodeIndex / cols)
  return {
    lng: bbox.xMin + (c + 0.5) * stepX,
    lat: bbox.yMin + (r + 0.5) * stepY,
  }
}

function simplifyPath(points, toleranceMeters = 25, pathNodes, cols) {
  if (points.length <= 2) return points
  if (!Array.isArray(pathNodes) || pathNodes.length !== points.length || !Number.isInteger(cols)) {
    return points
  }

  const requiredIndices = new Set([0, 1, points.length - 2, points.length - 1])
  for (let i = 1; i < points.length - 1; i++) {
    const incomingDirection = directionBetweenNodes(pathNodes[i - 1], pathNodes[i], cols)
    const outgoingDirection = directionBetweenNodes(pathNodes[i], pathNodes[i + 1], cols)
    if (incomingDirection !== outgoingDirection) requiredIndices.add(i)
  }

  const keptIndices = [0]
  for (let i = 1; i < points.length - 1; i++) {
    const previousKeptPoint = points[keptIndices[keptIndices.length - 1]]
    const cur = points[i]
    const dist = haversineMeters(
      previousKeptPoint.lng,
      previousKeptPoint.lat,
      cur.lng,
      cur.lat
    )
    if (requiredIndices.has(i) || dist >= toleranceMeters) keptIndices.push(i)
  }
  keptIndices.push(points.length - 1)
  // 保留足够航点以呈现 A* 转折，避免被简化成直线
  if (keptIndices.length < 6 && points.length >= 6) {
    const step = Math.max(1, Math.floor((points.length - 2) / 4))
    for (let i = step; i < points.length - 1; i += step) keptIndices.push(i)
  }
  return [...new Set(keptIndices)]
    .sort((left, right) => left - right)
    .map((pointIndex) => points[pointIndex])
}

function straightLinePath(start, end, segments = 10) {
  const points = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    points.push({
      lng: start.lng + (end.lng - start.lng) * t,
      lat: start.lat + (end.lat - start.lat) * t,
      height: start.height + (end.height - start.height) * t,
    })
  }
  return points
}

async function fetchGridsInBbox(pool, bbox, zMin, zMax, limit = 15000) {
  const result = await pool.query(
    `
    SELECT x_min, x_max, y_min, y_max, z_min, z_max, static_suitability_score
    FROM nanjing_uni_3d_grid_new
    WHERE x_max >= $1 AND x_min <= $2
      AND y_max >= $3 AND y_min <= $4
      AND ($5::double precision IS NULL OR z_max >= $5)
      AND ($6::double precision IS NULL OR z_min <= $6)
    ORDER BY x_min, y_min, z_min
    LIMIT $7
    `,
    [bbox.xMin, bbox.xMax, bbox.yMin, bbox.yMax, zMin, zMax, limit]
  )
  return result.rows
}

function createStaticNoSafeRouteError(searchBBox, details = {}) {
  const error = new Error('未找到满足当前静态约束的安全航线')
  error.code = 'NO_SAFE_ROUTE'
  error.details = {
    cost_model: 'static-v1',
    search_bbox: searchBBox,
    ...details,
  }
  return error
}

async function planStaticRoute(pool, start, end, options = {}, generateDemoGrids) {
  const searchBBox = options.searchBBox || computeSearchBbox(start, end, options)
  const groundHeight = options.groundHeight ?? 50
  const minScore = options.minScore ?? 0.25
  const flightHeight = start.height ?? end.height ?? 80
  const zTarget = flightHeight - groundHeight
  const gridSize = Math.min(70, Math.max(24, options.gridSize ?? 48))
  const cols = gridSize
  const rows = gridSize

  let grids = []
  let demo = false

  try {
    grids = await fetchGridsInBbox(pool, searchBBox, zTarget - 40, zTarget + 40, 18000)
  } catch {
    grids = []
  }

  if (!grids.length && typeof generateDemoGrids === 'function') {
    grids = generateDemoGrids(searchBBox, 3500)
    demo = true
  }

  const passable = new Array(cols * rows).fill(false)
  const costs = new Array(cols * rows).fill(Infinity)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { lng, lat } = nodeToLngLat(idx(c, r, cols), searchBBox, cols, rows)
      const score = getScoreAtPoint(grids, lng, lat, zTarget)
      const i = idx(c, r, cols)
      if (score == null) {
        passable[i] = true
        costs[i] = 1.2
      } else if (score >= minScore) {
        passable[i] = true
        costs[i] = 0.8 + (1 - score) * 5
      }
    }
  }

  const startSnap = snapToNode(start.lng, start.lat, searchBBox, cols, rows)
  const endSnap = snapToNode(end.lng, end.lat, searchBBox, cols, rows)
  if (!passable[startSnap.idx] || !passable[endSnap.idx]) {
    throw createStaticNoSafeRouteError(searchBBox, {
      endpoint: !passable[startSnap.idx] ? 'start' : 'end',
    })
  }
  const startNode = findNearestPassable(passable, cols, rows, startSnap.c, startSnap.r)
  const endNode = findNearestPassable(passable, cols, rows, endSnap.c, endSnap.r)
  const pathNodes = astar(passable, costs, cols, rows, startNode, endNode, searchBBox)
  if (!pathNodes) throw createStaticNoSafeRouteError(searchBBox)

  let points
  if (pathNodes.length === 1) {
    points = [
      { lng: start.lng, lat: start.lat, height: start.height ?? flightHeight },
      { lng: end.lng, lat: end.lat, height: end.height ?? flightHeight },
    ]
  } else {
    points = pathNodes.map((node) => {
      const { lng, lat } = nodeToLngLat(node, searchBBox, cols, rows)
      return { lng, lat, height: flightHeight }
    })
    points[0] = { lng: start.lng, lat: start.lat, height: start.height ?? flightHeight }
    points[points.length - 1] = { lng: end.lng, lat: end.lat, height: end.height ?? flightHeight }
    const simplifyTol = options.simplifyToleranceMeters ?? 8
    points = simplifyPath(points, simplifyTol, pathNodes, cols)
  }

  let totalLength = 0
  for (let i = 1; i < points.length; i++) {
    totalLength += haversineMeters(
      points[i - 1].lng,
      points[i - 1].lat,
      points[i].lng,
      points[i].lat
    )
  }

  const duration = Math.max(25, Math.min(120, Math.round(totalLength / 25)))

  return {
    searchBBox,
    demo,
    fallbackUsed: false,
    algorithm: 'A*',
    gridSize: { cols, rows },
    gridCount: grids.length,
    nodeCount: pathNodes.length,
    totalLengthMeters: Math.round(totalLength),
    route: {
      id: `planned-${Date.now()}`,
      name: options.routeName || '智能规划航线',
      description: '基于适航格网 A* 局部搜索生成',
      duration,
      points,
      planned: true,
      startName: options.startName,
      endName: options.endName,
    },
  }
}

async function planRoute(pool, start, end, options = {}, generateDemoGrids) {
  if (typeof options.dynamicCostSurfaceProvider !== 'function') {
    const staticPlan = await planStaticRoute(pool, start, end, options, generateDemoGrids)
    return {
      ...staticPlan,
      costModel: 'static-v1',
      dynamicCost: {
        enabled: false,
        source: null,
        sampledAt: null,
        timeZone: options.timeZone || null,
        model: null,
        summary: null,
        fallbackReason: null,
      },
      route: {
        ...staticPlan.route,
        costModel: 'static-v1',
      },
    }
  }

  const searchBBox = options.searchBBox || computeSearchBbox(start, end, options)
  const groundHeight = options.groundHeight ?? 50
  const flightHeight = start.height ?? end.height ?? 80
  const zTarget = flightHeight - groundHeight
  const gridSize = Math.min(70, Math.max(24, options.gridSize ?? 48))
  const cols = gridSize
  const rows = gridSize
  let surface

  try {
    surface = await options.dynamicCostSurfaceProvider({
      xMin: searchBBox.xMin,
      xMax: searchBBox.xMax,
      yMin: searchBBox.yMin,
      yMax: searchBBox.yMax,
      zTarget,
      cols,
      rows,
      at: options.planningAt,
      timeZone: options.timeZone,
    })
    if (!Array.isArray(surface?.cells) || surface.cells.length !== cols * rows) {
      throw new Error('Dynamic Cost surface is incomplete')
    }
  } catch (error) {
    throw error
  }

  const costCells = surface.cells.map((cell) => ({
    ...cell,
    flight_height: flightHeight,
    grid_data_missing: cell.new_id == null,
  }))
  const costOptions = options.dynamicCostOptions || {}
  const model = dynamicCost.getModelConfig(costOptions)
  const costResults = dynamicCost.evaluateCells(costCells, costOptions)
  const passable = new Array(cols * rows).fill(false)
  const costs = new Array(cols * rows).fill(Infinity)
  const resultByNode = new Array(cols * rows)
  const cellByNode = new Array(cols * rows)

  for (let surfaceIndex = 0; surfaceIndex < costCells.length; surfaceIndex++) {
    const cell = costCells[surfaceIndex]
    const result = costResults[surfaceIndex]
    const nodeIndex = idx(Number(cell.sample_col), Number(cell.sample_row), cols)
    passable[nodeIndex] = result.passable
    costs[nodeIndex] = result.passable ? result.traversal_cost : Infinity
    resultByNode[nodeIndex] = result
    cellByNode[nodeIndex] = cell
  }

  const startSnap = snapToNode(start.lng, start.lat, searchBBox, cols, rows)
  const endSnap = snapToNode(end.lng, end.lat, searchBBox, cols, rows)
  if (!passable[startSnap.idx] || !passable[endSnap.idx]) {
    const error = new Error('航线起点或终点位于当前硬约束区域内')
    error.code = 'NO_SAFE_ROUTE'
    error.details = {
      endpoint: !passable[startSnap.idx] ? 'start' : 'end',
      start_constraints: resultByNode[startSnap.idx]?.hard_constraints || [],
      end_constraints: resultByNode[endSnap.idx]?.hard_constraints || [],
      cost_summary: dynamicCost.summarizeCosts(costResults),
      search_bbox: searchBBox,
    }
    throw error
  }
  const startNode = findNearestPassable(passable, cols, rows, startSnap.c, startSnap.r)
  const endNode = findNearestPassable(passable, cols, rows, endSnap.c, endSnap.r)
  const pathNodes = astar(
    passable,
    costs,
    cols,
    rows,
    startNode,
    endNode,
    searchBBox,
    model.maneuverWeight
  )

  if (!pathNodes?.length) {
    const error = new Error('未找到满足当前动态约束的安全航线')
    error.code = 'NO_SAFE_ROUTE'
    error.details = {
      cost_summary: dynamicCost.summarizeCosts(costResults),
      search_bbox: searchBBox,
    }
    throw error
  }

  let points
  if (pathNodes.length === 1) {
    points = [
      { lng: start.lng, lat: start.lat, height: start.height ?? flightHeight },
      { lng: end.lng, lat: end.lat, height: end.height ?? flightHeight },
    ]
  } else {
    points = pathNodes.map((node) => {
      const { lng, lat } = nodeToLngLat(node, searchBBox, cols, rows)
      return { lng, lat, height: flightHeight }
    })
    points[0] = { lng: start.lng, lat: start.lat, height: start.height ?? flightHeight }
    points[points.length - 1] = {
      lng: end.lng,
      lat: end.lat,
      height: end.height ?? flightHeight,
    }
    points = simplifyPath(points, options.simplifyToleranceMeters ?? 8, pathNodes, cols)
  }

  let totalLength = 0
  for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
    totalLength += haversineMeters(
      points[pointIndex - 1].lng,
      points[pointIndex - 1].lat,
      points[pointIndex].lng,
      points[pointIndex].lat
    )
  }

  const summary = dynamicCost.summarizeCosts(costResults)
  const coveredGridCount = surface.cells.filter((cell) => cell.new_id != null).length
  const duration = Math.max(25, Math.min(120, Math.round(totalLength / 25)))
  const intraCellDistanceMeters = pathNodes.length === 1 ? totalLength : 0
  let totalTraversalCost = 0
  for (let pathIndex = 1; pathIndex < pathNodes.length; pathIndex++) {
    const previousNode = pathNodes[pathIndex - 1]
    const currentNode = pathNodes[pathIndex]
    const stepDistanceMeters = gridStepDistanceMeters(
      previousNode,
      currentNode,
      searchBBox,
      cols,
      rows
    )
    totalTraversalCost += costs[currentNode] * stepDistanceMeters
  }
  if (intraCellDistanceMeters > 0) {
    totalTraversalCost += costs[pathNodes[0]] * intraCellDistanceMeters
  }
  const maneuverSummary = summarizePathManeuvers(pathNodes, cols)
  totalTraversalCost += maneuverSummary.turnEquivalentMeters * model.maneuverWeight
  const pathRiskFactors = [...new Set(
    pathNodes.flatMap((node) => resultByNode[node]?.risk_factors || [])
  )]
  const avoidedZones = [...new Set(
    costResults.flatMap((result) => result.active_context?.no_fly_zones || [])
  )]
  const dataCoverage = {
    sampled: surface.cells.length,
    matched: coveredGridCount,
    missing: surface.cells.length - coveredGridCount,
  }
  const { pathBreakdown, decisionTrace } = buildRouteDecisionTrace({
    pathNodes,
    resultByNode,
    cellByNode,
    cols,
    rows,
    bbox: searchBBox,
    intraCellDistanceMeters,
    model,
    totalTraversalCost,
    summary,
    dataCoverage,
    sampledAt: surface.at,
    timeZone: surface.timeZone,
    flightHeight,
  })

  return {
    searchBBox,
    demo: false,
    fallbackUsed: false,
    algorithm: 'A*',
    costModel: 'dynamic-v1',
    dynamicCost: {
      enabled: true,
      source: 'v3',
      sampledAt: surface.at,
      timeZone: surface.timeZone,
      model,
      summary,
      pathBreakdown,
      fallbackReason: null,
      dataCoverage,
    },
    decisionTrace,
    gridSize: { cols, rows },
    gridCount: coveredGridCount,
    nodeCount: pathNodes.length,
    totalLengthMeters: Math.round(totalLength),
    totalTraversalCost: pathBreakdown.total_traversal_cost,
    route: {
      id: `planned-${Date.now()}`,
      name: options.routeName || '动态 Cost 智能规划航线',
      description: '基于静态、周期与实时三层数据的动态 Cost A* 航线',
      duration,
      points,
      planned: true,
      costModel: 'dynamic-v1',
      dynamicCostSummary: summary,
      decisionTrace,
      mainRiskFactors: pathRiskFactors,
      avoidedZones,
      startName: options.startName,
      endName: options.endName,
    },
  }
}

module.exports = {
  CAMPUS,
  clampToCampus,
  computeSearchBbox,
  haversineMeters,
  planRoute,
  straightLinePath,
}
