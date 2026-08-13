require('dotenv').config()

const assert = require('node:assert/strict')
const dynamicCost = require('./lib/dynamicCost')
const v3Database = require('./lib/v3Database')

function runPureModelChecks() {
  const safeCell = {
    new_id: 1,
    grid_code: 'test-grid',
    pop: 100,
    static_suitability_score: 0.85,
    sensitivity_level: 0.2,
    privacy_level: 0.1,
  }
  const normal = dynamicCost.calculateCellCost(safeCell, {
    population_value: 100,
    weather_recorded_at: '2026-08-11T04:00:00.000Z',
    wind_speed: 2,
    precipitation: 0,
    visibility: 5000,
  })
  const crowded = dynamicCost.calculateCellCost(safeCell, { population_value: 3000 })
  const construction = dynamicCost.calculateCellCost(safeCell, {
    population_value: 100,
    construction_names: ['测试施工点'],
  })
  const noFly = dynamicCost.calculateCellCost(safeCell, {
    no_fly_zone_names: ['测试禁飞区'],
  })
  const severeWind = dynamicCost.calculateCellCost(safeCell, {
    weather_recorded_at: '2026-08-11T04:00:00.000Z',
    wind_speed: 20,
    visibility: 5000,
  })
  const unsuitable = dynamicCost.calculateCellCost(
    { ...safeCell, static_suitability_score: 0.1 },
    {}
  )

  assert.equal(normal.passable, true)
  assert.ok(crowded.traversal_cost > normal.traversal_cost)
  assert.ok(construction.traversal_cost > normal.traversal_cost)
  assert.equal(noFly.passable, false)
  assert.ok(noFly.hard_constraints.includes('active_no_fly_zone'))
  assert.equal(severeWind.passable, false)
  assert.ok(severeWind.hard_constraints.includes('wind_speed_exceeds_limit'))
  assert.equal(unsuitable.passable, false)
  assert.ok(unsuitable.hard_constraints.includes('static_suitability_below_minimum'))
}

async function main() {
  try {
    runPureModelChecks()

    const source = await v3Database.listDynamicCostInputs({
      xMin: 118.949584,
      xMax: 118.949652,
      yMin: 32.114723,
      yMax: 32.114791,
      zMin: 0,
      zMax: 200,
      at: '2026-08-11T12:00:00+08:00',
      limit: 20,
    })
    assert.ok(source.rows.length > 0, 'No V3 cells were returned for dynamic Cost evaluation')
    assert.ok(
      source.rows.some((cell) => cell.population_value != null),
      'Periodic population data was not joined to the V3 grid cells'
    )

    const baseline = dynamicCost.evaluateCells(source.rows, { profile: 'balanced' })
    const blocked = dynamicCost.evaluateCells(source.rows, {
      profile: 'balanced',
      overrides: { no_fly: true },
    })
    const baselineSummary = dynamicCost.summarizeCosts(baseline)
    const blockedSummary = dynamicCost.summarizeCosts(blocked)

    assert.equal(baseline.length, source.rows.length)
    assert.equal(blockedSummary.blocked, source.rows.length)
    assert.ok(blocked.every((cell) => cell.hard_constraints.includes('active_no_fly_zone')))

    console.log(
      JSON.stringify(
        {
          ok: true,
          database: process.env.PG_V3_DATABASE || v3Database.DEFAULT_DATABASE,
          evaluated_at: source.at,
          evaluated_cells: source.rows.length,
          baseline: baselineSummary,
          simulated_no_fly: blockedSummary,
        },
        null,
        2
      )
    )
  } finally {
    await v3Database.close()
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
