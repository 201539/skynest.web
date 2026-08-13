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

function astar(passable, costs, cols, rows, startIdx, endIdx) {
  const total = cols * rows
  const gScore = new Float64Array(total).fill(Infinity)
  const fScore = new Float64Array(total).fill(Infinity)
  const cameFrom = new Int32Array(total).fill(-1)
  const closed = new Uint8Array(total)

  const open = []
  const pushOpen = (i) => {
    let lo = 0
    let hi = open.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (fScore[open[mid]] < fScore[i]) lo = mid + 1
      else hi = mid
    }
    open.splice(lo, 0, i)
  }

  gScore[startIdx] = 0
  fScore[startIdx] = 0
  pushOpen(startIdx)

  const neighbors = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ]

  const endC = endIdx % cols
  const endR = Math.floor(endIdx / cols)

  while (open.length) {
    const current = open.shift()
    if (current === endIdx) {
      const path = []
      let cur = current
      while (cur !== -1) {
        path.push(cur)
        cur = cameFrom[cur]
      }
      return path.reverse()
    }
    if (closed[current]) continue
    closed[current] = 1

    const c = current % cols
    const r = Math.floor(current / cols)

    for (const [dc, dr, stepCost] of neighbors) {
      const nc = c + dc
      const nr = r + dr
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
      const ni = idx(nc, nr, cols)
      if (!passable[ni] || closed[ni]) continue

      const tentative = gScore[current] + costs[ni] * stepCost
      if (tentative >= gScore[ni]) continue

      cameFrom[ni] = current
      gScore[ni] = tentative
      fScore[ni] = tentative + Math.hypot(nc - endC, nr - endR)
      const existingOpenIndex = open.indexOf(ni)
      if (existingOpenIndex >= 0) open.splice(existingOpenIndex, 1)
      pushOpen(ni)
    }
  }

  return null
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

function simplifyPath(points, toleranceMeters = 25) {
  if (points.length <= 2) return points
  const result = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1]
    const cur = points[i]
    const dist = haversineMeters(prev.lng, prev.lat, cur.lng, cur.lat)
    if (dist >= toleranceMeters) result.push(cur)
  }
  result.push(points[points.length - 1])
  // 保留足够航点以呈现 A* 转折，避免被简化成直线
  if (result.length < 6 && points.length >= 6) {
    const step = Math.max(1, Math.floor((points.length - 2) / 4))
    const dense = [points[0]]
    for (let i = step; i < points.length - 1; i += step) dense.push(points[i])
    dense.push(points[points.length - 1])
    return dense
  }
  return result
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
  const startNode = findNearestPassable(passable, cols, rows, startSnap.c, startSnap.r)
  const endNode = findNearestPassable(passable, cols, rows, endSnap.c, endSnap.r)

  let pathNodes = astar(passable, costs, cols, rows, startNode, endNode)
  let fallbackUsed = false

  if (!pathNodes || pathNodes.length < 2) {
    pathNodes = null
    fallbackUsed = true
  }

  let points
  if (pathNodes) {
    points = pathNodes.map((node) => {
      const { lng, lat } = nodeToLngLat(node, searchBBox, cols, rows)
      return { lng, lat, height: flightHeight }
    })
    points[0] = { lng: start.lng, lat: start.lat, height: start.height ?? flightHeight }
    points[points.length - 1] = { lng: end.lng, lat: end.lat, height: end.height ?? flightHeight }
    const simplifyTol = options.simplifyToleranceMeters ?? 8
    points = simplifyPath(points, simplifyTol)
  } else {
    points = straightLinePath(
      { lng: start.lng, lat: start.lat, height: start.height ?? flightHeight },
      { lng: end.lng, lat: end.lat, height: end.height ?? flightHeight },
      12
    )
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
    fallbackUsed,
    algorithm: fallbackUsed ? 'straight-line-fallback' : 'A*',
    gridSize: { cols, rows },
    gridCount: grids.length,
    nodeCount: pathNodes ? pathNodes.length : points.length,
    totalLengthMeters: Math.round(totalLength),
    route: {
      id: `planned-${Date.now()}`,
      name: options.routeName || '智能规划航线',
      description: fallbackUsed
        ? '局部格网未找到可行路径，已使用直线备选航线'
        : '基于适航格网 A* 局部搜索生成',
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
    if (options.requireDynamicCost) throw error
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
        fallbackReason: error.message,
      },
      route: {
        ...staticPlan.route,
        costModel: 'static-v1',
      },
    }
  }

  const costCells = surface.cells.map((cell) => ({
    ...cell,
    grid_data_missing: cell.new_id == null,
  }))
  const costOptions = options.dynamicCostOptions || {}
  const costResults = dynamicCost.evaluateCells(costCells, costOptions)
  const passable = new Array(cols * rows).fill(false)
  const costs = new Array(cols * rows).fill(Infinity)
  const resultByNode = new Array(cols * rows)

  for (let surfaceIndex = 0; surfaceIndex < costCells.length; surfaceIndex++) {
    const cell = costCells[surfaceIndex]
    const result = costResults[surfaceIndex]
    const nodeIndex = idx(Number(cell.sample_col), Number(cell.sample_row), cols)
    passable[nodeIndex] = result.passable
    costs[nodeIndex] = result.passable ? result.traversal_cost : Infinity
    resultByNode[nodeIndex] = result
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
  const pathNodes = astar(passable, costs, cols, rows, startNode, endNode)

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
    points = simplifyPath(points, options.simplifyToleranceMeters ?? 8)
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
  const model = dynamicCost.getModelConfig(costOptions)
  const coveredGridCount = surface.cells.filter((cell) => cell.new_id != null).length
  const duration = Math.max(25, Math.min(120, Math.round(totalLength / 25)))
  let totalTraversalCost = 0
  for (let pathIndex = 1; pathIndex < pathNodes.length; pathIndex++) {
    const previousNode = pathNodes[pathIndex - 1]
    const currentNode = pathNodes[pathIndex]
    const previousCol = previousNode % cols
    const previousRow = Math.floor(previousNode / cols)
    const currentCol = currentNode % cols
    const currentRow = Math.floor(currentNode / cols)
    const stepMultiplier = Math.hypot(currentCol - previousCol, currentRow - previousRow)
    totalTraversalCost += costs[currentNode] * stepMultiplier
  }
  const pathRiskFactors = [...new Set(
    pathNodes.flatMap((node) => resultByNode[node]?.risk_factors || [])
  )]
  const avoidedZones = [...new Set(
    costResults.flatMap((result) => result.active_context?.no_fly_zones || [])
  )]

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
      fallbackReason: null,
      dataCoverage: {
        sampled: surface.cells.length,
        matched: coveredGridCount,
        missing: surface.cells.length - coveredGridCount,
      },
    },
    gridSize: { cols, rows },
    gridCount: coveredGridCount,
    nodeCount: pathNodes.length,
    totalLengthMeters: Math.round(totalLength),
    totalTraversalCost: Math.round(totalTraversalCost * 10000) / 10000,
    route: {
      id: `planned-${Date.now()}`,
      name: options.routeName || '动态 Cost 智能规划航线',
      description: '基于静态、周期与实时三层数据的动态 Cost A* 航线',
      duration,
      points,
      planned: true,
      costModel: 'dynamic-v1',
      dynamicCostSummary: summary,
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
