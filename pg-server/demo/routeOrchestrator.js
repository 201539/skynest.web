const { computeSearchBbox, planRoute } = require('../lib/routePlanner')

// 与 demo/public/config/app.json 中的 fallbackModel.position 保持一致。
// places.json 存的是相对校园白模锚点的东/北向米坐标，而路径算法需要 WGS84 经纬度。
const MODEL_ANCHOR = Object.freeze({ lng: 118.944736, lat: 32.107470 })
const EARTH_RADIUS_METERS = 6378137

function createTaskError(message, code = 'TASK_ROUTE_ERROR') {
  const error = new Error(message)
  error.code = code
  error.statusCode = 400
  return error
}

function resolvePlaceByNodeId(places, nodeId, fallbackName) {
  const match = /^place:(\d+)$/.exec(String(nodeId || ''))
  if (match) {
    const place = places[Number(match[1])]
    if (place) return place
  }

  return places.find((place) => place.name === fallbackName) || null
}

function modelLocalMetersToWgs84(place, anchor = MODEL_ANCHOR) {
  const eastMeters = Number(place?.eastMeters)
  const northMeters = Number(place?.northMeters)
  if (!Number.isFinite(eastMeters) || !Number.isFinite(northMeters)) {
    throw createTaskError(`节点“${place?.name || '未知'}”缺少 eastMeters/northMeters 坐标`)
  }

  const anchorLatRad = (anchor.lat * Math.PI) / 180
  return {
    lng: anchor.lng + (eastMeters / (EARTH_RADIUS_METERS * Math.cos(anchorLatRad))) * (180 / Math.PI),
    lat: anchor.lat + (northMeters / EARTH_RADIUS_METERS) * (180 / Math.PI),
    height: Number(place.height) || 80,
  }
}

function resolveTaskEndpoints(task, places) {
  const originPlace = resolvePlaceByNodeId(places, task.origin_node_id, task.origin_text)
  const destinationPlace = resolvePlaceByNodeId(places, task.destination_node_id, task.destination_text)

  if (!originPlace || !destinationPlace) {
    throw createTaskError('任务起点或终点未找到对应校园节点，无法生成推荐通道')
  }
  if (originPlace.name === destinationPlace.name) {
    throw createTaskError('任务起点与终点相同，无法生成推荐通道')
  }

  return {
    originPlace,
    destinationPlace,
    start: modelLocalMetersToWgs84(originPlace),
    end: modelLocalMetersToWgs84(destinationPlace),
  }
}

async function planTaskRoute({
  pool,
  task,
  places,
  groundHeight = 50,
  generateDemoGrids,
  evaluateRoutePoints,
}) {
  const { originPlace, destinationPlace, start, end } = resolveTaskEndpoints(task, places)
  const searchBBox = computeSearchBbox(start, end)
  const plan = await planRoute(
    pool,
    start,
    end,
    {
      searchBBox,
      groundHeight,
      minScore: 0.25,
      gridSize: 48,
      simplifyToleranceMeters: 8,
      startName: originPlace.name,
      endName: destinationPlace.name,
      routeName: `${originPlace.name} → ${destinationPlace.name} 推荐通道`,
    },
    generateDemoGrids,
  )

  let evaluation = null
  let evaluationWarning = null
  try {
    evaluation = await evaluateRoutePoints(plan.route.points, groundHeight)
  } catch (error) {
    // 路线本身仍有效；评价数据不可用时明确标识，不伪造评分。
    evaluationWarning = `适航评分暂不可用：${error.message}`
  }

  return {
    ...plan,
    start,
    end,
    evaluation,
    evaluation_warning: evaluationWarning,
    planned_at: new Date().toISOString(),
    coordinate_source: 'campus_model_local_meters',
    source_nodes: {
      origin: { node_id: task.origin_node_id, name: originPlace.name },
      destination: { node_id: task.destination_node_id, name: destinationPlace.name },
    },
  }
}

module.exports = {
  MODEL_ANCHOR,
  modelLocalMetersToWgs84,
  resolvePlaceByNodeId,
  resolveTaskEndpoints,
  planTaskRoute,
}
