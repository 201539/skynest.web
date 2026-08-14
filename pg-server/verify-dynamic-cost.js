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
  const classPeriod = dynamicCost.calculateCellCost(safeCell, {
    population_value: 100,
    class_period_active: true,
    class_period_no: 3,
    teaching_area: true,
  })
  const consumptionPeak = dynamicCost.calculateCellCost(safeCell, {
    population_value: 100,
    consumption_active: true,
    consumption_value: 1,
    consumption_areas: ['测试食堂'],
  })
  const accessClosed = dynamicCost.calculateCellCost(safeCell, {
    population_value: 100,
    access_closed: true,
    access_control_names: ['测试场馆'],
  })
  const freshWeather = dynamicCost.calculateCellCost(safeCell, {
    population_value: 100,
    weather_recorded_at: '2026-08-11T04:20:00.000Z',
    weather_age_seconds: 600,
    wind_speed: 2,
    visibility: 5000,
  })
  const staleWeather = dynamicCost.calculateCellCost(safeCell, {
    population_value: 100,
    weather_recorded_at: '2026-08-11T02:00:00.000Z',
    weather_age_seconds: 7200,
    wind_speed: 2,
    visibility: 5000,
  })
  const missingWeather = dynamicCost.calculateCellCost(safeCell, { population_value: 100 })
  const staleSevereWind = dynamicCost.calculateCellCost(safeCell, {
    weather_recorded_at: '2026-08-11T02:00:00.000Z',
    weather_age_seconds: 7200,
    wind_speed: 20,
    visibility: 5000,
  })

  assert.equal(normal.passable, true)
  assert.ok(crowded.traversal_cost > normal.traversal_cost)
  assert.ok(construction.traversal_cost > normal.traversal_cost)
  assert.equal(noFly.passable, false)
  assert.ok(noFly.hard_constraints.includes('active_no_fly_zone'))
  assert.equal(severeWind.passable, false)
  assert.ok(severeWind.hard_constraints.includes('wind_speed_exceeds_limit'))
  assert.equal(unsuitable.passable, false)
  assert.ok(unsuitable.hard_constraints.includes('static_suitability_below_minimum'))
  assert.ok(classPeriod.traversal_cost > normal.traversal_cost)
  assert.ok(classPeriod.risk_factors.includes('class_period'))
  assert.ok(classPeriod.layer_data_status.periodic_sources.includes('class_periods'))
  assert.ok(consumptionPeak.traversal_cost > normal.traversal_cost)
  assert.ok(consumptionPeak.risk_factors.includes('consumption_peak'))
  assert.equal(accessClosed.passable, false)
  assert.ok(accessClosed.hard_constraints.includes('periodic_access_closed'))
  assert.equal(freshWeather.layer_data_status.weather, 'realtime')
  assert.equal(staleWeather.layer_data_status.weather, 'stale')
  assert.equal(missingWeather.layer_data_status.weather, 'not_available')
  assert.ok(staleWeather.traversal_cost > freshWeather.traversal_cost)
  assert.ok(missingWeather.risk_factors.includes('weather_data_missing'))
  assert.ok(staleWeather.risk_factors.includes('weather_data_stale'))
  assert.equal(staleSevereWind.passable, true)
  assert.ok(!staleSevereWind.hard_constraints.includes('wind_speed_exceeds_limit'))
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
    assert.ok(
      source.rows.every((cell) => Object.hasOwn(cell, 'weather_age_seconds')),
      'Weather freshness age was not returned by the V3 query'
    )

    const teaching = await v3Database.listDynamicCostInputs({
      xMin: 118.95445,
      xMax: 118.95462,
      yMin: 32.11374,
      yMax: 32.11392,
      zMin: 0,
      zMax: 200,
      at: '2026-08-11T10:30:00+08:00',
      limit: 100,
    })
    assert.ok(
      teaching.rows.some((cell) => cell.class_period_active && cell.teaching_area),
      'Class-period context was not mapped to teaching-area grids'
    )

    const dining = await v3Database.listDynamicCostInputs({
      xMin: 118.94996,
      xMax: 118.95014,
      yMin: 32.11336,
      yMax: 32.11354,
      zMin: 0,
      zMax: 200,
      at: '2026-08-11T12:15:00+08:00',
      limit: 100,
    })
    assert.ok(
      dining.rows.some((cell) => cell.consumption_active && Number(cell.consumption_value) > 0),
      'Consumption schedule was not mapped to canteen-area grids'
    )

    const libraryClosed = await v3Database.listDynamicCostInputs({
      xMin: 118.95490,
      xMax: 118.95508,
      yMin: 32.11623,
      yMax: 32.11640,
      zMin: 0,
      zMax: 200,
      at: '2026-08-11T23:30:00+08:00',
      limit: 100,
    })
    assert.ok(
      libraryClosed.rows.some((cell) => cell.access_closed),
      'Closed access-control schedule was not mapped to library-area grids'
    )

    const baseline = dynamicCost.evaluateCells(source.rows, { profile: 'balanced' })
    const blocked = dynamicCost.evaluateCells(source.rows, {
      profile: 'balanced',
      overrides: { no_fly: true },
    })
    const baselineSummary = dynamicCost.summarizeCosts(baseline)
    const blockedSummary = dynamicCost.summarizeCosts(blocked)

    assert.equal(baseline.length, source.rows.length)
    assert.equal(
      Object.values(baselineSummary.weather_data).reduce((sum, value) => sum + value, 0),
      source.rows.length
    )
    assert.equal(blockedSummary.blocked, source.rows.length)
    assert.ok(blocked.every((cell) => cell.hard_constraints.includes('active_no_fly_zone')))

    console.log(
      JSON.stringify(
        {
          ok: true,
          database: process.env.PG_V3_DATABASE || v3Database.DEFAULT_DATABASE,
          evaluated_at: source.at,
          evaluated_cells: source.rows.length,
          periodic_context: {
            class_periods: teaching.rows.filter((cell) => cell.class_period_active && cell.teaching_area).length,
            consumption: dining.rows.filter((cell) => cell.consumption_active).length,
            access_closed: libraryClosed.rows.filter((cell) => cell.access_closed).length,
          },
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
