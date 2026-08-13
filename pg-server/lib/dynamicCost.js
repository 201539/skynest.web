const COST_PROFILES = Object.freeze({
  balanced: Object.freeze({
    riskScale: 4,
    weights: Object.freeze({ static: 0.3, population: 0.2, weather: 0.2, runtime: 0.2, energy: 0.1 }),
  }),
  safest: Object.freeze({
    riskScale: 6,
    weights: Object.freeze({ static: 0.35, population: 0.25, weather: 0.2, runtime: 0.15, energy: 0.05 }),
  }),
  fastest: Object.freeze({
    riskScale: 2.5,
    weights: Object.freeze({ static: 0.25, population: 0.1, weather: 0.15, runtime: 0.15, energy: 0.35 }),
  }),
})

const DEFAULT_THRESHOLDS = Object.freeze({
  minSuitability: 0.2,
  populationReference: 1000,
  holidayPopulationFactor: 0.6,
  windReference: 10,
  maxWindSpeed: 15,
  precipitationReference: 10,
  maxPrecipitation: 20,
  visibilityReference: 5000,
  minVisibility: 300,
  batteryReservePercent: 20,
  verticalReferenceMeters: 80,
})

function finiteNumber(value, fallback = null) {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function clamp01(value) {
  return clamp(finiteNumber(value, 0), 0, 1)
}

function round(value, precision = 4) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function asNames(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (value == null || value === '') return []
  return [String(value)]
}

function normalizeWeights(weights) {
  const normalized = {
    static: Math.max(finiteNumber(weights.static, 0), 0),
    population: Math.max(finiteNumber(weights.population, 0), 0),
    weather: Math.max(finiteNumber(weights.weather, 0), 0),
    runtime: Math.max(finiteNumber(weights.runtime, 0), 0),
    energy: Math.max(finiteNumber(weights.energy, 0), 0),
  }
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0)
  if (total <= 0) return { ...COST_PROFILES.balanced.weights }
  for (const key of Object.keys(normalized)) normalized[key] /= total
  return normalized
}

function normalizeThresholds(overrides = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_THRESHOLDS).map(([name, fallback]) => [
      name,
      finiteNumber(overrides[name], fallback),
    ])
  )
}

function resolveModel(options = {}) {
  const profileName = COST_PROFILES[options.profile] ? options.profile : 'balanced'
  const profile = COST_PROFILES[profileName]
  return {
    profile: profileName,
    riskScale: Math.max(finiteNumber(options.riskScale, profile.riskScale), 0),
    weights: normalizeWeights({ ...profile.weights, ...(options.weights || {}) }),
    thresholds: normalizeThresholds(options.thresholds),
  }
}

function calculateStaticRisk(cell) {
  const suitability = clamp01(finiteNumber(cell.static_suitability_score, 0.5))
  const sensitivity = clamp01(cell.sensitivity_level)
  const privacy = clamp01(cell.privacy_level)
  return {
    risk: clamp01((1 - suitability) * 0.7 + sensitivity * 0.2 + privacy * 0.1),
    suitability,
    sensitivity,
    privacy,
  }
}

function calculatePopulationRisk(cell, context, thresholds) {
  const periodicPopulation = finiteNumber(context.population_value)
  const staticPopulation = Math.max(finiteNumber(cell.pop, 0), 0)
  const rawPopulation = Math.max(periodicPopulation ?? staticPopulation, 0)
  const effectivePopulation = context.is_holiday
    ? rawPopulation * clamp(finiteNumber(thresholds.holidayPopulationFactor, 0.6), 0, 1)
    : rawPopulation
  const reference = Math.max(finiteNumber(thresholds.populationReference, 1000), 1)
  const risk = clamp01(Math.log1p(effectivePopulation) / Math.log1p(reference))
  return {
    risk,
    rawPopulation,
    effectivePopulation,
    source: periodicPopulation == null ? 'static' : 'periodic',
    isHoliday: Boolean(context.is_holiday),
  }
}

function calculateWeatherRisk(context, thresholds) {
  const windSpeed = Math.max(finiteNumber(context.wind_speed, 0), 0)
  const precipitation = Math.max(finiteNumber(context.precipitation, 0), 0)
  const visibility = Math.max(finiteNumber(context.visibility, thresholds.visibilityReference), 0)
  const windRisk = clamp01(windSpeed / Math.max(finiteNumber(thresholds.windReference, 10), 0.1))
  const precipitationRisk = clamp01(
    precipitation / Math.max(finiteNumber(thresholds.precipitationReference, 10), 0.1)
  )
  const visibilityRisk = clamp01(
    1 - visibility / Math.max(finiteNumber(thresholds.visibilityReference, 5000), 1)
  )
  return {
    risk: clamp01(windRisk * 0.5 + precipitationRisk * 0.3 + visibilityRisk * 0.2),
    windSpeed,
    precipitation,
    visibility,
    windRisk,
    precipitationRisk,
    visibilityRisk,
    hasData: Boolean(context.weather_recorded_at),
  }
}

function calculateRuntimeRisk(context) {
  const constructionNames = asNames(context.construction_names)
  const eventNames = asNames(context.event_names)
  const explicitRisk = clamp01(context.runtime_risk)
  const constructionRisk = constructionNames.length ? 0.8 : 0
  const eventRisk = eventNames.length ? 0.55 : 0
  const coverageRisk = context.grid_data_missing ? 0.85 : 0
  return {
    risk: Math.max(explicitRisk, constructionRisk, eventRisk, coverageRisk),
    constructionNames,
    eventNames,
    explicitRisk,
    coverageRisk,
  }
}

function calculateEnergyRisk(context, thresholds) {
  const explicitRisk = finiteNumber(context.energy_risk)
  if (explicitRisk != null) return clamp01(explicitRisk)

  const battery = clamp(finiteNumber(context.drone_battery_percent, 100), 0, 100)
  const reserve = clamp(finiteNumber(thresholds.batteryReservePercent, 20), 0, 99)
  const batteryRisk = battery <= reserve ? 1 : clamp01((100 - battery) / (100 - reserve))
  const verticalMeters = Math.abs(finiteNumber(context.vertical_change_meters, 0))
  const verticalRisk = clamp01(
    verticalMeters / Math.max(finiteNumber(thresholds.verticalReferenceMeters, 80), 1)
  )
  return clamp01(batteryRisk * 0.6 + verticalRisk * 0.4)
}

function calculateCellCost(cell, context = {}, options = {}) {
  const model = resolveModel(options)
  const thresholds = model.thresholds
  const staticRisk = calculateStaticRisk(cell)
  const populationRisk = calculatePopulationRisk(cell, context, thresholds)
  const weatherRisk = calculateWeatherRisk(context, thresholds)
  const runtimeRisk = calculateRuntimeRisk(context)
  const energyRisk = calculateEnergyRisk(context, thresholds)
  const noFlyZoneNames = asNames(context.no_fly_zone_names)
  const hardConstraints = []

  if (context.no_fly === true || noFlyZoneNames.length) hardConstraints.push('active_no_fly_zone')
  if (staticRisk.suitability < finiteNumber(thresholds.minSuitability, 0.2)) {
    hardConstraints.push('static_suitability_below_minimum')
  }
  if (weatherRisk.windSpeed >= finiteNumber(thresholds.maxWindSpeed, 15)) {
    hardConstraints.push('wind_speed_exceeds_limit')
  }
  if (weatherRisk.precipitation >= finiteNumber(thresholds.maxPrecipitation, 20)) {
    hardConstraints.push('precipitation_exceeds_limit')
  }
  if (
    weatherRisk.hasData &&
    weatherRisk.visibility <= finiteNumber(thresholds.minVisibility, 300)
  ) {
    hardConstraints.push('visibility_below_minimum')
  }
  if (context.construction_blocked === true) hardConstraints.push('construction_blocked')
  if (context.force_blocked === true) hardConstraints.push(context.block_reason || 'manually_blocked')

  const components = {
    static: staticRisk.risk,
    population: populationRisk.risk,
    weather: weatherRisk.risk,
    runtime: runtimeRisk.risk,
    energy: energyRisk,
  }
  const contributions = {}
  let weightedRisk = 0
  for (const [name, value] of Object.entries(components)) {
    const contribution = value * model.weights[name]
    contributions[name] = round(contribution)
    weightedRisk += contribution
  }
  weightedRisk = clamp01(weightedRisk)

  const riskFactors = []
  if (staticRisk.risk >= 0.6) riskFactors.push('static_environment')
  if (populationRisk.risk >= 0.6) riskFactors.push('population_density')
  if (weatherRisk.risk >= 0.5) riskFactors.push('weather')
  if (runtimeRisk.constructionNames.length) riskFactors.push('construction')
  if (runtimeRisk.eventNames.length) riskFactors.push('event')
  if (runtimeRisk.coverageRisk > 0) riskFactors.push('data_coverage_gap')
  if (energyRisk >= 0.6) riskFactors.push('energy')
  if (noFlyZoneNames.length) riskFactors.push('no_fly_zone')

  const passable = hardConstraints.length === 0
  return {
    passable,
    traversal_cost: passable ? round(1 + model.riskScale * weightedRisk) : null,
    weighted_risk: round(weightedRisk),
    profile: model.profile,
    hard_constraints: hardConstraints,
    risk_factors: [...new Set(riskFactors)],
    active_context: {
      no_fly_zones: noFlyZoneNames,
      construction: runtimeRisk.constructionNames,
      events: runtimeRisk.eventNames,
    },
    inputs: {
      static_suitability: round(staticRisk.suitability),
      sensitivity: round(staticRisk.sensitivity),
      privacy: round(staticRisk.privacy),
      population: round(populationRisk.effectivePopulation, 2),
      population_source: populationRisk.source,
      is_holiday: populationRisk.isHoliday,
      wind_speed: round(weatherRisk.windSpeed, 2),
      precipitation: round(weatherRisk.precipitation, 2),
      visibility: round(weatherRisk.visibility, 2),
    },
    breakdown: Object.fromEntries(
      Object.entries(components).map(([name, value]) => [
        name,
        {
          normalized_risk: round(value),
          weight: round(model.weights[name]),
          contribution: contributions[name],
        },
      ])
    ),
  }
}

function evaluateCells(cells, options = {}) {
  const overrides = options.overrides || {}
  const byGridCode = overrides.by_grid_code || {}
  const globalOverrides = { ...overrides }
  delete globalOverrides.by_grid_code

  return cells.map((cell) => {
    const context = {
      ...cell,
      ...globalOverrides,
      ...(byGridCode[cell.grid_code] || {}),
    }
    return {
      new_id: cell.new_id,
      grid_code: cell.grid_code,
      bounds: {
        x_min: cell.x_min,
        x_max: cell.x_max,
        y_min: cell.y_min,
        y_max: cell.y_max,
        z_min: cell.z_min,
        z_max: cell.z_max,
      },
      ...calculateCellCost(cell, context, options),
    }
  })
}

function summarizeCosts(results) {
  const passable = results.filter((result) => result.passable)
  const costs = passable.map((result) => result.traversal_cost)
  const blockedReasons = {}
  for (const result of results) {
    for (const reason of result.hard_constraints) {
      blockedReasons[reason] = (blockedReasons[reason] || 0) + 1
    }
  }
  return {
    total: results.length,
    passable: passable.length,
    blocked: results.length - passable.length,
    average_traversal_cost: costs.length
      ? round(costs.reduce((sum, value) => sum + value, 0) / costs.length)
      : null,
    min_traversal_cost: costs.length ? round(Math.min(...costs)) : null,
    max_traversal_cost: costs.length ? round(Math.max(...costs)) : null,
    blocked_reasons: blockedReasons,
  }
}

function getModelConfig(options = {}) {
  return resolveModel(options)
}

module.exports = {
  COST_PROFILES,
  DEFAULT_THRESHOLDS,
  calculateCellCost,
  evaluateCells,
  summarizeCosts,
  getModelConfig,
}
