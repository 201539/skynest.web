const assert = require('assert')
const {
  MODEL_ANCHOR,
  modelLocalMetersToWgs84,
  resolveTaskEndpoints,
} = require('./routeOrchestrator')

const places = [
  { name: '起点', eastMeters: 0, northMeters: 0, height: 80 },
  { name: '终点', eastMeters: 200, northMeters: 300, height: 90 },
]

const anchorPoint = modelLocalMetersToWgs84(places[0])
assert.strictEqual(anchorPoint.lng, MODEL_ANCHOR.lng)
assert.strictEqual(anchorPoint.lat, MODEL_ANCHOR.lat)

const endpoints = resolveTaskEndpoints({
  origin_node_id: 'place:0',
  destination_node_id: 'place:1',
  origin_text: '起点',
  destination_text: '终点',
}, places)
assert.strictEqual(endpoints.originPlace.name, '起点')
assert.strictEqual(endpoints.destinationPlace.name, '终点')
assert(endpoints.end.lng > endpoints.start.lng)
assert(endpoints.end.lat > endpoints.start.lat)

console.log('routeOrchestrator tests passed')
