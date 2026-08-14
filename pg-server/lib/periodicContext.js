const DEFAULT_RADII_METERS = Object.freeze({
  teaching: 120,
  access: 60,
  consumption: 120,
})

const WEEKDAY_INDEX = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
})

function finiteNumber(value, fallback = null) {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))]
}

function timeToSeconds(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0)
}

function localPlanningParts(at, timeZone = 'Asia/Shanghai') {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) throw new TypeError('at must be a valid date-time')
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value])
  )
  return {
    weekday: WEEKDAY_INDEX[parts.weekday],
    hour: Number(parts.hour),
    seconds: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  }
}

function scheduleIsOpen(schedule, seconds) {
  if (String(schedule.status || 'open').toLowerCase() !== 'open') return false
  const open = timeToSeconds(schedule.open_time)
  const close = timeToSeconds(schedule.close_time)
  if (open == null || close == null) return true
  if (open === close) return true
  return open < close
    ? seconds >= open && seconds < close
    : seconds >= open || seconds < close
}

function haversineMeters(left, right) {
  const radius = 6371000
  const leftLat = Number(left.lat) * Math.PI / 180
  const rightLat = Number(right.lat) * Math.PI / 180
  const deltaLat = rightLat - leftLat
  const deltaLng = (Number(right.lng) - Number(left.lng)) * Math.PI / 180
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(a))
}

function cellPoint(cell) {
  const xMin = finiteNumber(cell.x_min)
  const xMax = finiteNumber(cell.x_max)
  const yMin = finiteNumber(cell.y_min)
  const yMax = finiteNumber(cell.y_max)
  const lng = finiteNumber(cell.sample_lng,
    xMin == null || xMax == null ? null : (xMin + xMax) / 2)
  const lat = finiteNumber(cell.sample_lat,
    yMin == null || yMax == null ? null : (yMin + yMax) / 2)
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null
}

function normalizeBuilding(row) {
  return {
    name: String(row.building_name || ''),
    category: String(row.category || ''),
    lng: Number(row.lng),
    lat: Number(row.lat),
  }
}

function isTeachingBuilding(building) {
  return /公共教学楼|学院|学系|实验楼|医学中心|研究中心|逸夫楼|左涤江楼|常州楼|昆山楼|朱共山楼/.test(building.name)
}

function accessTargets(gateName, buildings) {
  const name = String(gateName || '')
  if (name.includes('公共教室')) {
    return buildings.filter((building) => /公共教学楼|逸夫楼/.test(building.name))
  }
  if (name.includes('宿舍')) {
    return buildings.filter((building) =>
      building.category === 'dormitory' || /学生宿舍|学生公寓/.test(building.name))
  }
  if (name.includes('图书馆')) {
    return buildings.filter((building) => building.name.includes('图书馆'))
  }
  return buildings.filter((building) => name.includes(building.name) || building.name.includes(name))
}

function consumptionTargets(area, buildings) {
  const name = String(area || '')
  if (name.includes('一组团')) {
    return buildings.filter((building) => building.name.includes('第四、五、六餐厅'))
  }
  if (name.includes('二组团')) {
    return buildings.filter((building) => /第八餐厅|第九餐厅|清真餐厅/.test(building.name))
  }
  if (name.includes('三组团')) {
    return buildings.filter((building) => /第十食堂|教工餐厅/.test(building.name))
  }
  return buildings.filter((building) => name.includes(building.name) || building.name.includes(name))
}

function ruleMatchesCell(rule, cell, point, radiusMeters) {
  if (rule.grid_code) return rule.grid_code === cell.grid_code
  if (!point) return false
  return rule.targets.some((target) => haversineMeters(point, target) <= radiusMeters)
}

function activeConsumptionRules(rows, planning) {
  const byArea = new Map()
  for (const row of rows) {
    const key = String(row.area || '')
    if (!byArea.has(key)) byArea.set(key, [])
    byArea.get(key).push(row)
  }
  const active = []
  for (const areaRows of byArea.values()) {
    const exactWeekday = areaRows.filter((row) => Number(row.weekday) === planning.weekday)
    const scheduleRows = exactWeekday.length
      ? exactWeekday
      : areaRows.filter((row) => Number(row.weekday) === 0)
    active.push(...scheduleRows.filter((row) => Number(row.hour) === planning.hour))
  }
  return active
}

async function loadCatalog(pool) {
  const [classPeriods, accessControls, consumption, buildings] = await Promise.all([
    pool.query('SELECT period_no, start_time, end_time FROM periodic.class_periods ORDER BY period_no'),
    pool.query(`
      SELECT gate_id, gate_name, area, grid_code, weekday, open_time, close_time, status
      FROM periodic.access_control
      ORDER BY gate_id
    `),
    pool.query(`
      SELECT id, area, grid_code, weekday, hour, category, consumption_value
      FROM periodic.consumption
      ORDER BY id
    `),
    pool.query(`
      SELECT building_name, category,
        ST_X(ST_Transform(location, 4326)) AS lng,
        ST_Y(ST_Transform(location, 4326)) AS lat
      FROM static.buildings
      ORDER BY building_id
    `),
  ])
  return {
    classPeriods: classPeriods.rows,
    accessControls: accessControls.rows,
    consumption: consumption.rows,
    buildings: buildings.rows.map(normalizeBuilding).filter((building) =>
      Number.isFinite(building.lng) && Number.isFinite(building.lat)),
  }
}

async function enrichCells(pool, cells, options = {}) {
  if (!Array.isArray(cells) || !cells.length) return cells || []
  const planning = localPlanningParts(options.at, options.timeZone)
  const radii = { ...DEFAULT_RADII_METERS, ...(options.radii || {}) }
  const catalog = options.catalog || await loadCatalog(pool)
  const isHoliday = cells.some((cell) => Boolean(cell.is_holiday))
  const classPeriod = planning.weekday >= 1 && planning.weekday <= 5 && !isHoliday
    ? catalog.classPeriods.find((period) => {
        const start = timeToSeconds(period.start_time)
        const end = timeToSeconds(period.end_time)
        return start != null && end != null && planning.seconds >= start && planning.seconds < end
      }) || null
    : null
  const teachingTargets = catalog.buildings.filter(isTeachingBuilding)
  const accessRules = catalog.accessControls
    .filter((rule) => rule.weekday == null || Number(rule.weekday) === planning.weekday)
    .map((rule) => ({ ...rule, targets: accessTargets(rule.gate_name, catalog.buildings) }))
  const consumptionRules = activeConsumptionRules(catalog.consumption, planning)
    .map((rule) => ({ ...rule, targets: consumptionTargets(rule.area, catalog.buildings) }))

  return cells.map((cell) => {
    const point = cellPoint(cell)
    const teachingArea = Boolean(
      point && teachingTargets.some((target) => haversineMeters(point, target) <= radii.teaching)
    )
    const matchedAccess = accessRules.filter((rule) =>
      ruleMatchesCell(rule, cell, point, radii.access))
    const accessOpen = matchedAccess.some((rule) => scheduleIsOpen(rule, planning.seconds))
    const accessClosed = matchedAccess.length > 0 && !accessOpen
    const matchedConsumption = consumptionRules.filter((rule) =>
      ruleMatchesCell(rule, cell, point, radii.consumption))
    const consumptionValue = matchedConsumption.reduce(
      (maximum, rule) => Math.max(maximum, finiteNumber(rule.consumption_value, 0)),
      0
    )

    return {
      ...cell,
      class_period_active: Boolean(classPeriod),
      class_period_no: classPeriod ? Number(classPeriod.period_no) : null,
      teaching_area: teachingArea,
      access_control_names: unique(matchedAccess.map((rule) => rule.gate_name)),
      access_closed: accessClosed,
      consumption_active: matchedConsumption.length > 0 && consumptionValue > 0,
      consumption_value: consumptionValue,
      consumption_areas: unique(matchedConsumption.map((rule) => rule.area)),
    }
  })
}

module.exports = {
  DEFAULT_RADII_METERS,
  enrichCells,
  localPlanningParts,
  scheduleIsOpen,
  _activeConsumptionRules: activeConsumptionRules,
  _accessTargets: accessTargets,
  _consumptionTargets: consumptionTargets,
  _haversineMeters: haversineMeters,
  _isTeachingBuilding: isTeachingBuilding,
}
