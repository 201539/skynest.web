require('dotenv').config()

const assert = require('node:assert/strict')
const v3Database = require('./lib/v3Database')
const corridor = require('./lib/dynamicCostCorridor')

async function main() {
  try {
    const [origin, destination] = await Promise.all([
      v3Database.getBuildingAccessPoints('环境学院', { limitPerGroup: 1 }),
      v3Database.getBuildingAccessPoints('杜厦图书馆', { limitPerGroup: 1 }),
    ])
    const start = origin.departure_nodes[0].location
    const end = destination.receiving_nodes[0].location
    const result = await corridor.evaluateRouteCorridor({
      route: [start, end],
      corridor_meters: 90,
      z_target: 25,
      cols: 48,
      rows: 48,
      at: '2026-08-13T12:00:00+08:00',
      time_zone: 'Asia/Shanghai',
      profile: 'balanced',
      thresholds: { minSuitability: 0.25 },
    })

    assert.ok(result.data.length > 0, 'No dynamic cells were returned around the route')
    assert.equal(result.coverage.unique_grids, result.data.length)
    assert.equal(new Set(result.data.map((cell) => cell.grid_code)).size, result.data.length)
    assert.ok(result.data.every((cell) => cell.route_distance_m <= 90))
    assert.ok(result.data.every((cell) => Number.isFinite(cell.suitability_score)))
    assert.ok(result.data.every((cell) => Number.isFinite(cell.layer_scores.static)))
    assert.ok(result.data.every((cell) => Number.isFinite(cell.layer_scores.periodic)))
    assert.ok(result.data.every((cell) => Number.isFinite(cell.layer_scores.realtime)))
    assert.ok(result.data.every((cell) => [
      cell.x_min, cell.x_max, cell.y_min, cell.y_max, cell.z_min, cell.z_max,
    ].every((value) => Number.isFinite(Number(value)))))
    assert.ok(result.data.every((cell) => cell.layer_data_status.static === 'available'))
    assert.ok(result.summary.total === result.data.length)
    assert.equal(
      Object.values(result.summary.weather_data).reduce((sum, value) => sum + value, 0),
      result.data.length
    )
    assert.ok(result.data.some((cell) => cell.inputs.population_source === 'periodic'))
    assert.ok(result.data.every((cell) => ['realtime', 'configured_default', 'stale', 'not_available'].includes(
      cell.freshness?.weather?.status
    )))
    assert.ok(result.data
      .filter((cell) => cell.freshness?.weather?.status === 'configured_default')
      .every((cell) => (
        cell.inputs.wind_speed === 3
        && cell.inputs.precipitation === 0
        && cell.inputs.visibility === 5000
      )))

    console.log(JSON.stringify({
      ok: true,
      route: '环境学院 → 杜厦图书馆',
      corridor_meters: result.corridor_meters,
      evaluated_at: result.at,
      unique_grids: result.data.length,
      summary: result.summary,
      sample: {
        grid_code: result.data[0].grid_code,
        suitability_score: result.data[0].suitability_score,
        layer_scores: result.data[0].layer_scores,
        layer_data_status: result.data[0].layer_data_status,
        route_distance_m: result.data[0].route_distance_m,
      },
    }, null, 2))
  } finally {
    await v3Database.close()
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
