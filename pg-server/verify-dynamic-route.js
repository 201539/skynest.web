const assert = require('node:assert/strict')
const { haversineMeters, planRoute } = require('./lib/routePlanner')

const BBOX = { xMin: 118.94, xMax: 118.96, yMin: 32.108, yMax: 32.12 }
const START = { lng: 118.941, lat: 32.114, height: 80 }
const END = { lng: 118.959, lat: 32.114, height: 80 }
const MANEUVER_BBOX = {
  xMin: 118.949,
  xMax: 118.95156,
  yMin: 32.1128,
  yMax: 32.11496,
}
const MANEUVER_GRID_SIZE = 24

function gridCenter(bbox, col, row, size = MANEUVER_GRID_SIZE) {
  return {
    lng: bbox.xMin + ((col + 0.5) / size) * (bbox.xMax - bbox.xMin),
    lat: bbox.yMin + ((row + 0.5) / size) * (bbox.yMax - bbox.yMin),
    height: 80,
  }
}

function pointWithinGridCell(bbox, col, row, colOffset, rowOffset, size = MANEUVER_GRID_SIZE) {
  return {
    lng: bbox.xMin + ((col + colOffset) / size) * (bbox.xMax - bbox.xMin),
    lat: bbox.yMin + ((row + rowOffset) / size) * (bbox.yMax - bbox.yMin),
    height: 80,
  }
}

const MANEUVER_START = gridCenter(MANEUVER_BBOX, 2, 12)
const MANEUVER_END = gridCenter(MANEUVER_BBOX, 21, 12)
const CORNER_START = gridCenter(MANEUVER_BBOX, 10, 10)
const CORNER_END = gridCenter(MANEUVER_BBOX, 11, 11)
const SIMPLIFICATION_START = gridCenter(MANEUVER_BBOX, 10, 10)
const SIMPLIFICATION_END = gridCenter(MANEUVER_BBOX, 12, 10)
const SAME_CELL_START = pointWithinGridCell(MANEUVER_BBOX, 10, 10, 0.2, 0.2)
const SAME_CELL_END = pointWithinGridCell(MANEUVER_BBOX, 10, 10, 0.8, 0.8)

function createSurfaceProvider({ blockAll = false, wall = true } = {}) {
  return async ({ xMin, xMax, yMin, yMax, cols, rows, at, timeZone }) => {
    const cells = []
    const wallColumn = Math.floor(cols / 2)
    for (let sampleRow = 0; sampleRow < rows; sampleRow++) {
      for (let sampleCol = 0; sampleCol < cols; sampleCol++) {
        const wallBlocked = wall && sampleCol === wallColumn && sampleRow < rows - 2
        cells.push({
          sample_col: sampleCol,
          sample_row: sampleRow,
          new_id: sampleRow * cols + sampleCol + 1,
          grid_code: `test-${sampleCol}-${sampleRow}`,
          x_min: xMin + (sampleCol / cols) * (xMax - xMin),
          x_max: xMin + ((sampleCol + 1) / cols) * (xMax - xMin),
          y_min: yMin + (sampleRow / rows) * (yMax - yMin),
          y_max: yMin + ((sampleRow + 1) / rows) * (yMax - yMin),
          z_min: 20,
          z_max: 40,
          pop: 80,
          static_suitability_score: 0.9,
          sensitivity_level: 0.1,
          privacy_level: 0.1,
          no_fly_zone_names: blockAll || wallBlocked ? ['测试禁飞墙'] : [],
          construction_names: [],
          event_names: [],
        })
      }
    }
    return {
      at: at || '2026-08-11T04:00:00.000Z',
      timeZone: timeZone || 'Asia/Shanghai',
      cols,
      rows,
      cells,
    }
  }
}

function createManeuverChoiceSurfaceProvider() {
  return async ({ xMin, xMax, yMin, yMax, cols, rows, at, timeZone }) => {
    const allowed = new Set()
    for (let col = 2; col <= 6; col++) allowed.add(`${col}:12`)
    for (let row = 10; row <= 12; row++) allowed.add(`6:${row}`)
    for (let col = 6; col <= 10; col++) allowed.add(`${col}:10`)
    for (let row = 10; row <= 14; row++) allowed.add(`10:${row}`)
    for (let col = 10; col <= 14; col++) allowed.add(`${col}:14`)
    for (let row = 12; row <= 14; row++) allowed.add(`14:${row}`)
    for (let col = 14; col <= 21; col++) allowed.add(`${col}:12`)
    for (let row = 12; row <= 18; row++) {
      allowed.add(`2:${row}`)
      allowed.add(`21:${row}`)
    }
    for (let col = 2; col <= 21; col++) allowed.add(`${col}:18`)

    const cells = []
    for (let sampleRow = 0; sampleRow < rows; sampleRow++) {
      for (let sampleCol = 0; sampleCol < cols; sampleCol++) {
        const passable = allowed.has(`${sampleCol}:${sampleRow}`)
        cells.push({
          sample_col: sampleCol,
          sample_row: sampleRow,
          new_id: sampleRow * cols + sampleCol + 1,
          grid_code: `maneuver-${sampleCol}-${sampleRow}`,
          x_min: xMin + (sampleCol / cols) * (xMax - xMin),
          x_max: xMin + ((sampleCol + 1) / cols) * (xMax - xMin),
          y_min: yMin + (sampleRow / rows) * (yMax - yMin),
          y_max: yMin + ((sampleRow + 1) / rows) * (yMax - yMin),
          z_min: 20,
          z_max: 40,
          pop: 0,
          static_suitability_score: 1,
          sensitivity_level: 0,
          privacy_level: 0,
          no_fly_zone_names: passable ? [] : ['blocked-for-maneuver-test'],
          construction_names: [],
          event_names: [],
        })
      }
    }
    return {
      at: at || '2026-08-11T04:00:00.000Z',
      timeZone: timeZone || 'Asia/Shanghai',
      cols,
      rows,
      cells,
    }
  }
}

function createSparseSurfaceProvider(
  passableCellKeys,
  gridPrefix,
  { staticSuitabilityScore = 1 } = {}
) {
  return async ({ xMin, xMax, yMin, yMax, cols, rows, at, timeZone }) => {
    const passableCells = new Set(passableCellKeys)
    const cells = []
    for (let sampleRow = 0; sampleRow < rows; sampleRow++) {
      for (let sampleCol = 0; sampleCol < cols; sampleCol++) {
        const passable = passableCells.has(`${sampleCol}:${sampleRow}`)
        cells.push({
          sample_col: sampleCol,
          sample_row: sampleRow,
          new_id: sampleRow * cols + sampleCol + 1,
          grid_code: `${gridPrefix}-${sampleCol}-${sampleRow}`,
          x_min: xMin + (sampleCol / cols) * (xMax - xMin),
          x_max: xMin + ((sampleCol + 1) / cols) * (xMax - xMin),
          y_min: yMin + (sampleRow / rows) * (yMax - yMin),
          y_max: yMin + ((sampleRow + 1) / rows) * (yMax - yMin),
          z_min: 20,
          z_max: 40,
          pop: 0,
          static_suitability_score: staticSuitabilityScore,
          sensitivity_level: 0,
          privacy_level: 0,
          no_fly_zone_names: passable ? [] : [`blocked-for-${gridPrefix}-test`],
          construction_names: [],
          event_names: [],
        })
      }
    }
    return {
      at: at || '2026-08-11T04:00:00.000Z',
      timeZone: timeZone || 'Asia/Shanghai',
      cols,
      rows,
      cells,
    }
  }
}

function createCornerCutSurfaceProvider(openSideCells = []) {
  return createSparseSurfaceProvider(['10:10', '11:11', ...openSideCells], 'corner')
}

function createSimplificationSurfaceProvider() {
  return createSparseSurfaceProvider(
    ['10:10', '10:9', '11:9', '12:9', '12:10'],
    'simplification'
  )
}

function createStaticDemoGrids(bbox) {
  return [
    {
      x_min: bbox.xMin,
      x_max: bbox.xMax,
      y_min: bbox.yMin,
      y_max: bbox.yMax,
      z_min: -100,
      z_max: 200,
      static_suitability_score: 0.9,
    },
  ]
}

function createStaticCellGrids(bbox, passableCellKeys, size = MANEUVER_GRID_SIZE) {
  const passableCells = new Set(passableCellKeys)
  const grids = []
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      grids.push({
        x_min: bbox.xMin + (col / size) * (bbox.xMax - bbox.xMin),
        x_max: bbox.xMin + ((col + 1) / size) * (bbox.xMax - bbox.xMin),
        y_min: bbox.yMin + (row / size) * (bbox.yMax - bbox.yMin),
        y_max: bbox.yMin + ((row + 1) / size) * (bbox.yMax - bbox.yMin),
        z_min: -100,
        z_max: 200,
        static_suitability_score: passableCells.has(`${col}:${row}`) ? 0.9 : 0,
      })
    }
  }
  return grids
}

async function main() {
  const unavailablePool = { query: async () => { throw new Error('legacy database unavailable') } }
  const dynamicPlan = await planRoute(
    unavailablePool,
    START,
    END,
    {
      searchBBox: BBOX,
      groundHeight: 50,
      gridSize: 24,
      dynamicCostSurfaceProvider: createSurfaceProvider(),
      dynamicCostOptions: { profile: 'balanced' },
      planningAt: '2026-08-11T12:00:00+08:00',
      timeZone: 'Asia/Shanghai',
    },
    createStaticDemoGrids
  )
  const distanceWeightedPlan = await planRoute(
    unavailablePool,
    START,
    END,
    {
      searchBBox: BBOX,
      groundHeight: 50,
      gridSize: 24,
      dynamicCostSurfaceProvider: createSurfaceProvider(),
      dynamicCostOptions: {
        profile: 'balanced',
        weights: { distance: 2 },
      },
      planningAt: '2026-08-11T12:00:00+08:00',
      timeZone: 'Asia/Shanghai',
    },
    createStaticDemoGrids
  )
  const straightPlan = await planRoute(
    unavailablePool,
    START,
    END,
    {
      searchBBox: BBOX,
      groundHeight: 50,
      gridSize: 24,
      dynamicCostSurfaceProvider: createSurfaceProvider({ wall: false }),
      dynamicCostOptions: { profile: 'balanced', riskScale: 0 },
    },
    createStaticDemoGrids
  )
  const zeroManeuverPlan = await planRoute(
    unavailablePool,
    MANEUVER_START,
    MANEUVER_END,
    {
      searchBBox: MANEUVER_BBOX,
      groundHeight: 50,
      gridSize: MANEUVER_GRID_SIZE,
      dynamicCostSurfaceProvider: createManeuverChoiceSurfaceProvider(),
      dynamicCostOptions: { profile: 'balanced', riskScale: 0, weights: { maneuver: 0 } },
    },
    createStaticDemoGrids
  )
  const smoothManeuverPlan = await planRoute(
    unavailablePool,
    MANEUVER_START,
    MANEUVER_END,
    {
      searchBBox: MANEUVER_BBOX,
      groundHeight: 50,
      gridSize: MANEUVER_GRID_SIZE,
      dynamicCostSurfaceProvider: createManeuverChoiceSurfaceProvider(),
      dynamicCostOptions: { profile: 'balanced', riskScale: 0, weights: { maneuver: 2 } },
    },
    createStaticDemoGrids
  )

  const directDistance = haversineMeters(START.lng, START.lat, END.lng, END.lat)
  assert.equal(dynamicPlan.algorithm, 'A*')
  assert.equal(dynamicPlan.costModel, 'dynamic-v1')
  assert.equal(dynamicPlan.dynamicCost.enabled, true)
  assert.ok(dynamicPlan.dynamicCost.summary.blocked > 0)
  assert.ok(dynamicPlan.totalLengthMeters > directDistance)
  assert.ok(dynamicPlan.route.points.length > 2)
  assert.equal(dynamicPlan.decisionTrace?.version, 'route-decision-v1')
  assert.equal(dynamicPlan.decisionTrace?.objective, 'minimum_total_traversal_cost')
  assert.equal(dynamicPlan.dynamicCost.model.distanceWeight, 1)
  assert.equal(dynamicPlan.dynamicCost.model.maneuverWeight, 1)
  assert.equal(dynamicPlan.decisionTrace?.model?.distance_weight, 1)
  assert.equal(dynamicPlan.decisionTrace?.model?.maneuver_weight, 1)
  assert.deepEqual(dynamicPlan.decisionTrace?.constraints?.flight_height, {
    planned: 80,
    minimum: 40,
    maximum: 120,
    unit: 'm',
  })
  assert.equal(
    dynamicPlan.dynamicCost.pathBreakdown?.total_traversal_cost,
    dynamicPlan.totalTraversalCost
  )
  assert.ok(Math.abs(
    dynamicPlan.dynamicCost.pathBreakdown?.components?.static?.weight
      - dynamicPlan.dynamicCost.model.weights.static
  ) < 1e-6)
  assert.ok(dynamicPlan.dynamicCost.pathBreakdown?.risk_cost > 0)
  assert.ok(dynamicPlan.decisionTrace?.selection_reason?.summary)
  const pathBreakdown = dynamicPlan.dynamicCost.pathBreakdown
  assert.equal(pathBreakdown.distance.unit, 'm')
  assert.equal(pathBreakdown.distance.weight, 1)
  assert.ok(pathBreakdown.distance.raw_distance_meters > directDistance)
  assert.ok(Math.abs(
    pathBreakdown.distance.cost_contribution
      - pathBreakdown.distance.raw_distance_meters
  ) < 0.01)
  assert.equal(pathBreakdown.base_distance_cost, pathBreakdown.distance.cost_contribution)
  assert.ok(pathBreakdown.maneuver.turn_count > 0)
  assert.ok(pathBreakdown.maneuver.total_turn_angle_degrees > 0)
  assert.equal(pathBreakdown.maneuver.climb_meters, 0)
  assert.equal(pathBreakdown.maneuver.descent_meters, 0)
  assert.equal(pathBreakdown.maneuver.climb_cost, 0)
  assert.equal(pathBreakdown.maneuver.descent_cost, 0)
  assert.equal(
    pathBreakdown.maneuver.cost_contribution,
    pathBreakdown.maneuver.turn_equivalent_meters * pathBreakdown.maneuver.weight
  )
  assert.match(dynamicPlan.decisionTrace.formula, /distanceWeight/)
  assert.match(dynamicPlan.decisionTrace.formula, /maneuverWeight/)
  assert.equal(distanceWeightedPlan.dynamicCost.model.distanceWeight, 2)
  assert.equal(distanceWeightedPlan.dynamicCost.pathBreakdown.distance.weight, 2)
  assert.ok(Math.abs(
    distanceWeightedPlan.dynamicCost.pathBreakdown.distance.cost_contribution
      - distanceWeightedPlan.dynamicCost.pathBreakdown.distance.raw_distance_meters * 2
  ) < 0.01)
  assert.ok(distanceWeightedPlan.totalTraversalCost > dynamicPlan.totalTraversalCost)
  const componentValues = Object.values(pathBreakdown.components)
  const layerValues = Object.values(pathBreakdown.layers)
  assert.ok(Math.abs(
    pathBreakdown.total_traversal_cost
      - pathBreakdown.base_distance_cost
      - pathBreakdown.risk_cost
      - pathBreakdown.maneuver_cost
  ) < 0.001)
  assert.ok(Math.abs(
    componentValues.reduce((sum, component) => sum + component.cost_contribution, 0)
      - pathBreakdown.risk_cost
  ) < 0.001)
  assert.ok(Math.abs(
    layerValues.reduce((sum, layer) => sum + layer.cost_contribution, 0)
      - pathBreakdown.risk_cost
  ) < 0.001)
  assert.ok(Math.abs(
    componentValues.reduce((sum, component) => sum + component.share_of_risk_cost, 0) - 1
  ) < 0.001)
  assert.match(dynamicPlan.decisionTrace.selection_reason.summary, /主要风险 Cost 贡献/)
  assert.equal(straightPlan.dynamicCost.pathBreakdown.maneuver.turn_count, 0)
  assert.equal(straightPlan.dynamicCost.pathBreakdown.maneuver.total_turn_angle_degrees, 0)
  assert.equal(straightPlan.dynamicCost.pathBreakdown.maneuver.cost_contribution, 0)
  assert.equal(zeroManeuverPlan.dynamicCost.model.maneuverWeight, 0)
  assert.equal(smoothManeuverPlan.dynamicCost.model.maneuverWeight, 2)
  assert.ok(
    zeroManeuverPlan.dynamicCost.pathBreakdown.maneuver.turn_count
      > smoothManeuverPlan.dynamicCost.pathBreakdown.maneuver.turn_count
  )
  assert.ok(
    zeroManeuverPlan.dynamicCost.pathBreakdown.distance.raw_distance_meters
      < smoothManeuverPlan.dynamicCost.pathBreakdown.distance.raw_distance_meters
  )

  const cornerPlanOptions = (openSideCells) => ({
    searchBBox: MANEUVER_BBOX,
    groundHeight: 50,
    gridSize: MANEUVER_GRID_SIZE,
    dynamicCostSurfaceProvider: createCornerCutSurfaceProvider(openSideCells),
    dynamicCostOptions: { profile: 'balanced', riskScale: 0, weights: { maneuver: 0 } },
  })

  await assert.rejects(
    () => planRoute(
      unavailablePool,
      CORNER_START,
      CORNER_END,
      cornerPlanOptions([]),
      createStaticDemoGrids
    ),
    (error) => error.code === 'NO_SAFE_ROUTE'
  )

  const oneSideCornerPlan = await planRoute(
    unavailablePool,
    CORNER_START,
    CORNER_END,
    cornerPlanOptions(['11:10']),
    createStaticDemoGrids
  )

  const openCornerPlan = await planRoute(
    unavailablePool,
    CORNER_START,
    CORNER_END,
    cornerPlanOptions(['11:10', '10:11']),
    createStaticDemoGrids
  )
  assert.ok(openCornerPlan.route.points.length >= 2)
  assert.ok(
    oneSideCornerPlan.dynamicCost.pathBreakdown.distance.raw_distance_meters
      > openCornerPlan.dynamicCost.pathBreakdown.distance.raw_distance_meters
  )
  assert.ok(
    oneSideCornerPlan.dynamicCost.pathBreakdown.maneuver.turn_count
      > openCornerPlan.dynamicCost.pathBreakdown.maneuver.turn_count
  )

  const simplificationPlan = await planRoute(
    unavailablePool,
    SIMPLIFICATION_START,
    SIMPLIFICATION_END,
    {
      searchBBox: MANEUVER_BBOX,
      groundHeight: 50,
      gridSize: MANEUVER_GRID_SIZE,
      simplifyToleranceMeters: 10000,
      dynamicCostSurfaceProvider: createSimplificationSurfaceProvider(),
      dynamicCostOptions: { profile: 'balanced', riskScale: 0, weights: { maneuver: 0 } },
    },
    createStaticDemoGrids
  )
  assert.ok(simplificationPlan.route.points.length > 2)
  assert.ok(simplificationPlan.route.points.some(
    (point) => Math.abs(point.lat - SIMPLIFICATION_START.lat) > 1e-8
  ))

  const sameCellPlan = await planRoute(
    unavailablePool,
    SAME_CELL_START,
    SAME_CELL_END,
    {
      searchBBox: MANEUVER_BBOX,
      groundHeight: 50,
      gridSize: MANEUVER_GRID_SIZE,
      dynamicCostSurfaceProvider: createSparseSurfaceProvider(
        ['10:10'],
        'same-cell',
        { staticSuitabilityScore: 0.5 }
      ),
      dynamicCostOptions: {
        profile: 'balanced',
        riskScale: 2,
        weights: {
          static: 1,
          population: 0,
          weather: 0,
          runtime: 0,
          energy: 0,
          maneuver: 0,
        },
      },
    },
    createStaticDemoGrids
  )
  assert.equal(sameCellPlan.nodeCount, 1)
  assert.equal(sameCellPlan.route.points.length, 2)
  assert.ok(sameCellPlan.totalLengthMeters > 0)
  assert.ok(sameCellPlan.totalTraversalCost > 0)
  assert.ok(sameCellPlan.dynamicCost.pathBreakdown.distance.raw_distance_meters > 0)
  assert.ok(sameCellPlan.dynamicCost.pathBreakdown.risk_cost > 0)
  assert.ok(Math.abs(
    sameCellPlan.totalTraversalCost
      - sameCellPlan.dynamicCost.pathBreakdown.base_distance_cost
      - sameCellPlan.dynamicCost.pathBreakdown.risk_cost
  ) < 0.001)

  await assert.rejects(
    () => planRoute(
      unavailablePool,
      START,
      END,
      {
        searchBBox: BBOX,
        groundHeight: 50,
        gridSize: 24,
        dynamicCostSurfaceProvider: createSurfaceProvider({ blockAll: true }),
        dynamicCostOptions: { profile: 'balanced' },
      },
      createStaticDemoGrids
    ),
    (error) => error.code === 'NO_SAFE_ROUTE'
  )

  await assert.rejects(
    () => planRoute(
      unavailablePool,
      START,
      END,
      {
        searchBBox: BBOX,
        groundHeight: 50,
        gridSize: 24,
        dynamicCostSurfaceProvider: createSurfaceProvider(),
        dynamicCostOptions: {
          profile: 'balanced',
          thresholds: {
            minFlightHeight: 90,
            maxFlightHeight: 120,
          },
        },
      },
      createStaticDemoGrids
    ),
    (error) => (
      error.code === 'NO_SAFE_ROUTE' &&
      error.details?.start_constraints?.includes('flight_height_out_of_range')
    )
  )

  await assert.rejects(
    () => planRoute(
      unavailablePool,
      START,
      END,
      {
        searchBBox: BBOX,
        groundHeight: 50,
        gridSize: 24,
        dynamicCostSurfaceProvider: async () => { throw new Error('V3 unavailable for test') },
      },
      createStaticDemoGrids
    ),
    (error) => error.message === 'V3 unavailable for test'
  )

  await assert.rejects(
    () => planRoute(
      unavailablePool,
      SAME_CELL_START,
      SIMPLIFICATION_END,
      {
        searchBBox: MANEUVER_BBOX,
        groundHeight: 50,
        gridSize: MANEUVER_GRID_SIZE,
      },
      (bbox) => createStaticCellGrids(bbox, ['11:10', '12:10'])
    ),
    (error) => (
      error.code === 'NO_SAFE_ROUTE'
      && error.details?.cost_model === 'static-v1'
      && error.details?.endpoint === 'start'
    )
  )

  await assert.rejects(
    () => planRoute(
      unavailablePool,
      MANEUVER_START,
      MANEUVER_END,
      {
        searchBBox: MANEUVER_BBOX,
        groundHeight: 50,
        gridSize: MANEUVER_GRID_SIZE,
      },
      (bbox) => createStaticCellGrids(bbox, ['2:12', '21:12'])
    ),
    (error) => error.code === 'NO_SAFE_ROUTE' && error.details?.cost_model === 'static-v1'
  )

  const staticSameCellPlan = await planRoute(
    unavailablePool,
    SAME_CELL_START,
    SAME_CELL_END,
    {
      searchBBox: MANEUVER_BBOX,
      groundHeight: 50,
      gridSize: MANEUVER_GRID_SIZE,
    },
    (bbox) => createStaticCellGrids(bbox, ['10:10'])
  )
  assert.equal(staticSameCellPlan.costModel, 'static-v1')
  assert.equal(staticSameCellPlan.algorithm, 'A*')
  assert.equal(staticSameCellPlan.fallbackUsed, false)
  assert.equal(staticSameCellPlan.nodeCount, 1)
  assert.equal(staticSameCellPlan.route.points.length, 2)

  console.log(JSON.stringify({
    ok: true,
    dynamic_route_points: dynamicPlan.route.points.length,
    direct_distance_meters: Math.round(directDistance),
    dynamic_distance_meters: dynamicPlan.totalLengthMeters,
    blocked_sample_cells: dynamicPlan.dynamicCost.summary.blocked,
    no_safe_route_rejected: true,
    static_fallback_verified: true,
  }, null, 2))
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
