const EARTH_RADIUS_METERS = 6371000

function toRadians(value) {
  return (Number(value) * Math.PI) / 180
}

function toLocalMeters(point, center) {
  const centerLatitude = toRadians(center.lat)
  return {
    x: toRadians(Number(point.lng) - Number(center.lng)) * EARTH_RADIUS_METERS * Math.cos(centerLatitude),
    y: toRadians(Number(point.lat) - Number(center.lat)) * EARTH_RADIUS_METERS,
  }
}

function pointDistance(point) {
  return Math.hypot(point.x, point.y)
}

function minimumSegmentDistanceToOrigin(start, end) {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared === 0) return pointDistance(start)
  const projection = Math.max(0, Math.min(1, -(start.x * deltaX + start.y * deltaY) / lengthSquared))
  return Math.hypot(start.x + projection * deltaX, start.y + projection * deltaY)
}

function segmentLengthInsideCircle(start, end, radius) {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const length = Math.hypot(deltaX, deltaY)
  if (length === 0) return 0

  const coefficientA = deltaX * deltaX + deltaY * deltaY
  const coefficientB = 2 * (start.x * deltaX + start.y * deltaY)
  const coefficientC = start.x * start.x + start.y * start.y - radius * radius
  const discriminant = coefficientB * coefficientB - 4 * coefficientA * coefficientC
  const breakpoints = [0, 1]
  if (discriminant >= 0) {
    const root = Math.sqrt(discriminant)
    const first = (-coefficientB - root) / (2 * coefficientA)
    const second = (-coefficientB + root) / (2 * coefficientA)
    if (first > 0 && first < 1) breakpoints.push(first)
    if (second > 0 && second < 1) breakpoints.push(second)
  }

  breakpoints.sort((left, right) => left - right)
  let insideLength = 0
  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const intervalStart = breakpoints[index]
    const intervalEnd = breakpoints[index + 1]
    const midpoint = (intervalStart + intervalEnd) / 2
    const sample = {
      x: start.x + deltaX * midpoint,
      y: start.y + deltaY * midpoint,
    }
    if (pointDistance(sample) < radius) insideLength += (intervalEnd - intervalStart) * length
  }
  return insideLength
}

function inspectRouteRestrictionConflict(route, restriction) {
  const waypoints = route?.waypoints || route?.points || []
  const center = restriction?.center || {}
  const radius = Number(restriction?.radius_m)
  if (
    waypoints.length < 2 ||
    !Number.isFinite(Number(center.lng)) ||
    !Number.isFinite(Number(center.lat)) ||
    !Number.isFinite(radius)
  ) {
    return {
      conflicts: false,
      segment_indexes: [],
      conflict_segment_count: 0,
      restricted_distance_meters: 0,
      safety_buffer_meters: 0,
    }
  }

  const localPoints = waypoints.map((point) => toLocalMeters(point, center))
  const segmentIndexes = []
  let restrictedDistance = 0
  let minimumDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < localPoints.length - 1; index += 1) {
    const insideLength = segmentLengthInsideCircle(localPoints[index], localPoints[index + 1], radius)
    const segmentDistance = minimumSegmentDistanceToOrigin(localPoints[index], localPoints[index + 1])
    minimumDistance = Math.min(minimumDistance, segmentDistance)
    if (
      insideLength > 0.1 ||
      segmentDistance <= radius
    ) {
      segmentIndexes.push(index)
      restrictedDistance += insideLength
    }
  }

  return {
    conflicts: segmentIndexes.length > 0,
    segment_indexes: segmentIndexes,
    conflict_segment_count: segmentIndexes.length,
    restricted_distance_meters: Math.round(restrictedDistance),
    safety_buffer_meters: Number.isFinite(minimumDistance)
      ? Math.max(0, Math.round(minimumDistance - radius))
      : 0,
  }
}

module.exports = { inspectRouteRestrictionConflict }
