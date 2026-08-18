const assert = require('node:assert/strict')
const { parseNaturalLanguageTask } = require('./taskParser')
const { processNaturalLanguage } = require('./taskOrchestrator')
const { matchLocation } = require('./locationMatcher')

const fixedNow = new Date('2026-08-17T12:00:00+08:00')
const access = (code, distance) => ({ node_id: code.charCodeAt(0), node_code: code, distance_m: distance })
const place = (name, departureCode, receivingCode) => ({
  name,
  departure_nodes: [access(departureCode, 30)],
  receiving_nodes: [access(receivingCode, 35)],
  nearest_departure: access(departureCode, 30),
  nearest_receiving: access(receivingCode, 35),
})
const places = [
  place('学生宿舍22栋', 'c', 'C'),
  place('学生宿舍23栋', 'd', 'D'),
  place('杜厦图书馆', 'b', 'B'),
  place('环境学院', 'a', 'A'),
  place('大气科学学院', 'e', 'E'),
  place('110报警中心', 'f', 'F'),
]
const context = { places, vehicleRules: [], highRiskCategories: [], source: 'automated_test' }
const parse = (text) => parseNaturalLanguageTask(text, { now: fixedNow })

const glass = parse('从22栋宿舍送两箱玻璃瓶到杜厦图书馆，重量3公斤，明天下午五点前送达')
assert.equal(glass.item_category, '其他/无法识别')
assert.equal(glass.item_description, '两箱玻璃瓶')
assert.equal(glass.deadline, '2026-08-18T17:00:00+08:00')
console.log('✓ 未知物品保留具体名称，并归入其他/无法识别')

const arabicTime = parse('从环境学院送一份文件到杜厦图书馆，1公斤，明天下午5点前送达')
assert.equal(arabicTime.deadline, glass.deadline)
console.log('✓ “明天下午五点”和“明天下午5点”解析一致')

const halfHour = parse('从杜厦图书馆送三本教材到环境学院，2公斤，今天晚上八点半前送达')
assert.equal(halfHour.deadline, '2026-08-17T20:30:00+08:00')
assert.equal(halfHour.item_description, '三本教材')
console.log('✓ 中文半点和具体数量解析正确')

const matched = matchLocation('22栋宿舍', places)
assert.equal(matched.status, 'matched')
assert.equal(matched.selected_building.name, '学生宿舍22栋')
assert.equal(matched.match_method, 'semantic')
console.log('✓ 非标准建筑名自动映射到83栋正式名称')

const routed = processNaturalLanguage('从22栋宿舍送两箱玻璃瓶到杜厦图书馆，重量3公斤，明天下午五点前送达', context, fixedNow)
assert.equal(routed.origin, '学生宿舍22栋')
assert.equal(routed.agent_analysis.access_point_plan.departure.node_code, 'c')
assert.equal(routed.agent_analysis.access_point_plan.receiving.node_code, 'B')
console.log('✓ 建筑匹配后自动带出起点和终点L3接入点')

const ambiguous = matchLocation('宿舍', places)
assert.notEqual(ambiguous.status, 'matched')
console.log('✓ 多个相似建筑不会被自动乱选')
