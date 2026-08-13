const EARTH_RADIUS_METERS = 6371000
const DEFAULT_SAFETY_BUFFER_METERS = 50
const RING_VERTEX_COUNT = 24

const toRadians = (value) => (Number(value) * Math.PI) / 180
const toDegrees = (value) => (Number(value) * 180) / Math.PI
const roundOne = (value) => Math.round(value * 10) / 10

function toLocalMeters(point, center) {
  const centerLatRadians = toRadians(center.lat)
  return {
    x: toRadians(Number(point.lng) - Number(center.lng)) * EARTH_RADIUS_METERS * Math.cos(centerLatRadians),
    y: toRadians(Number(point.lat) - Number(center.lat)) * EARTH_RADIUS_METERS,
  }
}

function toGeographicPoint(point, center, height) {
  const centerLatRadians = toRadians(center.lat)
  return {
    lng: Number(center.lng) + toDegrees(point.x / (EARTH_RADIUS_METERS * Math.cos(centerLatRadians))),
    lat: Number(center.lat) + toDegrees(point.y / EARTH_RADIUS_METERS),
    height,
    eta: null,
  }
}

function pointDistance(point) {
  return Math.hypot(point.x, point.y)
}

function segmentLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function minimumSegmentDistanceToOrigin(a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return pointDistance(a)
  const projection = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared))
  return Math.hypot(a.x + projection * dx, a.y + projection * dy)
}

function segmentLengthInsideCircle(a, b, radius) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return pointDistance(a) < radius ? 0 : 0

  const coefficients = {
    a: dx * dx + dy * dy,
    b: 2 * (a.x * dx + a.y * dy),
    c: a.x * a.x + a.y * a.y - radius * radius,
  }
  const discriminant = coefficients.b * coefficients.b - 4 * coefficients.a * coefficients.c
  const breakpoints = [0, 1]
  if (discriminant >= 0) {
    const root = Math.sqrt(discriminant)
    const first = (-coefficients.b - root) / (2 * coefficients.a)
    const second = (-coefficients.b + root) / (2 * coefficients.a)
    if (first > 0 && first < 1) breakpoints.push(first)
    if (second > 0 && second < 1) breakpoints.push(second)
  }

  breakpoints.sort((left, right) => left - right)
  let insideLength = 0
  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const start = breakpoints[index]
    const end = breakpoints[index + 1]
    const midpoint = (start + end) / 2
    const sample = { x: a.x + dx * midpoint, y: a.y + dy * midpoint }
    if (pointDistance(sample) < radius) insideLength += (end - start) * length
  }
  return insideLength
}

function haversineDistance(a, b) {
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const deltaLat = lat2 - lat1
  const deltaLng = toRadians(Number(b.lng) - Number(a.lng))
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)))
}

export function computeRouteLengthMeters(waypoints = []) {
  let total = 0
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    total += haversineDistance(waypoints[index], waypoints[index + 1])
  }
  return total
}

export function inspectRouteRestrictionConflict(route, restriction) {
  const waypoints = route?.waypoints || route?.points || []
  const center = restriction?.center || {}
  const radius = Number(restriction?.radius_m)
  if (waypoints.length < 2 || !Number.isFinite(Number(center.lng)) || !Number.isFinite(Number(center.lat)) || !Number.isFinite(radius)) {
    return { conflicts: false, segment_indexes: [], restricted_distance_meters: 0 }
  }

  const localPoints = waypoints.map((point) => toLocalMeters(point, center))
  const segmentIndexes = []
  let restrictedDistance = 0
  for (let index = 0; index < localPoints.length - 1; index += 1) {
    const insideLength = segmentLengthInsideCircle(localPoints[index], localPoints[index + 1], radius)
    if (insideLength > 0.1 || minimumSegmentDistanceToOrigin(localPoints[index], localPoints[index + 1]) <= radius) {
      segmentIndexes.push(index)
      restrictedDistance += insideLength
    }
  }

  return {
    conflicts: segmentIndexes.length > 0,
    segment_indexes: segmentIndexes,
    conflict_segment_count: segmentIndexes.length,
    restricted_distance_meters: Math.round(restrictedDistance),
  }
}

function findShortestDetour(start, end, restriction, safetyBufferMeters) {
  const center = restriction.center
  const radius = Number(restriction.radius_m)
  const localStart = toLocalMeters(start, center)
  const localEnd = toLocalMeters(end, center)
  const endpointClearance = Math.min(pointDistance(localStart), pointDistance(localEnd)) - 1
  if (endpointClearance <= radius) throw new Error('航线起点或终点位于限制区内，必须人工调整任务接驳点')

  const clearanceRadius = Math.max(radius + 1, Math.min(radius + safetyBufferMeters, endpointClearance))
  const ringRadius = clearanceRadius / Math.cos(Math.PI / RING_VERTEX_COUNT)
  const nodes = [localStart]
  for (let index = 0; index < RING_VERTEX_COUNT; index += 1) {
    const angle = (index / RING_VERTEX_COUNT) * Math.PI * 2
    nodes.push({ x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius })
  }
  nodes.push(localEnd)

  const distances = Array(nodes.length).fill(Number.POSITIVE_INFINITY)
  const previous = Array(nodes.length).fill(-1)
  const visited = Array(nodes.length).fill(false)
  distances[0] = 0

  for (let step = 0; step < nodes.length; step += 1) {
    let current = -1
    for (let index = 0; index < nodes.length; index += 1) {
      if (!visited[index] && (current < 0 || distances[index] < distances[current])) current = index
    }
    if (current < 0 || !Number.isFinite(distances[current])) break
    if (current === nodes.length - 1) break
    visited[current] = true

    for (let next = 0; next < nodes.length; next += 1) {
      if (next === current || visited[next]) continue
      if (minimumSegmentDistanceToOrigin(nodes[current], nodes[next]) < clearanceRadius - 0.5) continue
      const candidate = distances[current] + segmentLength(nodes[current], nodes[next])
      if (candidate < distances[next]) {
        distances[next] = candidate
        previous[next] = current
      }
    }
  }

  const destinationIndex = nodes.length - 1
  if (!Number.isFinite(distances[destinationIndex])) throw new Error('未找到满足安全间隔的绕行路径')
  const path = []
  for (let index = destinationIndex; index >= 0; index = previous[index]) {
    path.unshift(nodes[index])
    if (index === 0) break
  }
  return { path, clearanceRadius }
}

export function replanRouteAroundRestriction(route, restriction, options = {}) {
  const waypoints = route?.waypoints || route?.points || []
  const conflict = inspectRouteRestrictionConflict(route, restriction)
  if (!conflict.conflicts) throw new Error('当前航线未穿越该限制区，无需重新规划')

  const firstSegment = conflict.segment_indexes[0]
  const lastSegment = conflict.segment_indexes.at(-1)
  const start = waypoints[firstSegment]
  const end = waypoints[lastSegment + 1]
  const safetyBufferMeters = Number(options.safetyBufferMeters ?? DEFAULT_SAFETY_BUFFER_METERS)
  const detour = findShortestDetour(start, end, restriction, safetyBufferMeters)
  const averageHeight = (Number(start.height || 80) + Number(end.height || 80)) / 2
  const detourWaypoints = detour.path
    .slice(1, -1)
    .map((point) => toGeographicPoint(point, restriction.center, averageHeight))
  const newWaypoints = [
    ...waypoints.slice(0, firstSegment + 1),
    ...detourWaypoints,
    ...waypoints.slice(lastSegment + 1),
  ]

  const remainingConflict = inspectRouteRestrictionConflict({ waypoints: newWaypoints }, restriction)
  if (remainingConflict.conflicts) throw new Error('绕行结果仍与限制区冲突，请转人工规划')

  const originalGeometryLength = computeRouteLengthMeters(waypoints)
  const replannedGeometryLength = computeRouteLengthMeters(newWaypoints)
  const declaredOriginalLength = Number(route.total_length_meters) || originalGeometryLength
  const distanceScale = originalGeometryLength > 0 ? declaredOriginalLength / originalGeometryLength : 1
  const replannedDeclaredLength = Math.round(replannedGeometryLength * distanceScale)
  const distanceChangePercent = roundOne(((replannedGeometryLength / originalGeometryLength) - 1) * 100)
  const originalRiskCost = originalGeometryLength + conflict.restricted_distance_meters * 4
  const replannedRiskCost = replannedGeometryLength + remainingConflict.restricted_distance_meters * 4
  const riskChangePercent = roundOne(((replannedRiskCost / originalRiskCost) - 1) * 100)
  const generatedAt = new Date().toISOString()

  return {
    ...route,
    algorithm: '动态 Cost 绕行（可视图）',
    previous_waypoints: waypoints.map((point) => ({ ...point })),
    waypoints: newWaypoints,
    main_risk_factors: [...new Set([...(route.main_risk_factors || []), `临时限制：${restriction.name}`])],
    avoided_zones: [...new Set([...(route.avoided_zones || []), restriction.name])],
    distance_change_percent: distanceChangePercent,
    risk_change_percent: riskChangePercent,
    total_length_meters: replannedDeclaredLength,
    estimated_duration_seconds: Math.max(1, Math.round(Number(route.estimated_duration_seconds || 180) * (1 + distanceChangePercent / 100))),
    replanned_at: generatedAt,
    trigger_restriction_id: restriction.id,
    replan_summary: {
      trigger_name: restriction.name,
      conflict_segment_count: conflict.conflict_segment_count,
      restricted_distance_meters: conflict.restricted_distance_meters,
      original_length_meters: Math.round(declaredOriginalLength),
      replanned_length_meters: replannedDeclaredLength,
      distance_change_percent: distanceChangePercent,
      risk_change_percent: riskChangePercent,
      safety_buffer_meters: Math.round(detour.clearanceRadius - Number(restriction.radius_m)),
      risk_model: '限制区内航程按5倍阻力计入动态Cost',
    },
    generated_at: generatedAt,
  }
}
