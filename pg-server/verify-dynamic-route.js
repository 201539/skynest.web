const assert = require('node:assert/strict')
const { haversineMeters, planRoute } = require('./lib/routePlanner')

const BBOX = { xMin: 118.94, xMax: 118.96, yMin: 32.108, yMax: 32.12 }
const START = { lng: 118.941, lat: 32.114, height: 80 }
const END = { lng: 118.959, lat: 32.114, height: 80 }

function createSurfaceProvider({ blockAll = false } = {}) {
  return async ({ xMin, xMax, yMin, yMax, cols, rows, at, timeZone }) => {
    const cells = []
    const wallColumn = Math.floor(cols / 2)
    for (let sampleRow = 0; sampleRow < rows; sampleRow++) {
      for (let sampleCol = 0; sampleCol < cols; sampleCol++) {
        const wallBlocked = sampleCol === wallColumn && sampleRow < rows - 2
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

  const directDistance = haversineMeters(START.lng, START.lat, END.lng, END.lat)
  assert.equal(dynamicPlan.algorithm, 'A*')
  assert.equal(dynamicPlan.costModel, 'dynamic-v1')
  assert.equal(dynamicPlan.dynamicCost.enabled, true)
  assert.ok(dynamicPlan.dynamicCost.summary.blocked > 0)
  assert.ok(dynamicPlan.totalLengthMeters > directDistance)
  assert.ok(dynamicPlan.route.points.length > 2)

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

  const staticFallback = await planRoute(
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
  )
  assert.equal(staticFallback.costModel, 'static-v1')
  assert.equal(staticFallback.dynamicCost.enabled, false)
  assert.equal(staticFallback.dynamicCost.fallbackReason, 'V3 unavailable for test')

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
