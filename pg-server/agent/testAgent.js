const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { processTask, processStructuredTask } = require('./taskOrchestrator')

const placesPath = path.join(
  __dirname,
  '..',
  '..',
  'demo',
  'public',
  'data',
  'places.json',
)
const places = JSON.parse(fs.readFileSync(placesPath, 'utf8'))
const fixedNow = new Date('2026-08-07T10:00:00+08:00')

function runCase(name, message, verify) {
  const result = processTask(message, places, fixedNow)
  verify(result)
  console.log(`✓ ${name}`)
}

runCase(
  '完整任务可进入路径算法',
  '下午4点前，把2.5公斤需要防震的实验材料从图书馆送到实验中心',
  (result) => {
    assert.equal(result.workflow_status, 'ready_for_algorithm')
    assert.equal(result.can_submit_to_algorithm, true)
    assert.equal(result.task_draft.origin_node_id, 'place:1')
    assert.equal(result.task_draft.destination_node_id, 'place:9')
    assert.equal(result.task_draft.recommended_vehicle_class, 'light')
  },
)

runCase(
  '地点别名可以匹配正式节点',
  '下午4点前，把2公斤文件从图书馆送到实验楼',
  (result) => {
    assert.equal(result.workflow_status, 'ready_for_algorithm')
    assert.equal(result.location_matches.destination.match_method, 'alias')
    assert.equal(result.location_matches.destination.selected_node.name, '实验中心')
  },
)

runCase(
  '缺少字段时生成追问并阻止算法调用',
  '把文件从图书馆送到实验中心',
  (result) => {
    assert.equal(result.workflow_status, 'needs_clarification')
    assert.equal(result.can_submit_to_algorithm, false)
    assert.deepEqual(result.task_draft.missing_fields, ['weight_kg', 'deadline'])
    assert.equal(result.clarifying_questions.length, 2)
  },
)

runCase(
  '高风险物品必须人工审核',
  '下午5点前，把1公斤医疗样本从图书馆送到实验中心，需要冷链',
  (result) => {
    assert.equal(result.workflow_status, 'needs_manual_review')
    assert.equal(result.can_submit_to_algorithm, false)
    assert.equal(result.task_draft.needs_manual_review, true)
    assert.equal(result.vehicle_recommendation.vehicle, null)
  },
)

runCase(
  '未知地点不得虚构节点',
  '下午4点前，把2公斤实验材料从环境学院送到实验中心',
  (result) => {
    assert.equal(result.workflow_status, 'needs_location_confirmation')
    assert.equal(result.can_submit_to_algorithm, false)
    assert.equal(result.task_draft.origin_node_id, null)
  },
)

const structuredResult = processStructuredTask({
  origin_text: '图书馆',
  destination_text: '实验中心',
  item_category: 'document',
  weight_kg: 1.5,
  deadline: '2026-08-07T16:00',
  priority: 'normal',
  special_requirements: ['waterproof'],
}, places)
assert.equal(structuredResult.workflow_status, 'ready_for_algorithm')
assert.equal(structuredResult.task_draft.parse_status, 'structured')
assert.equal(structuredResult.task_draft.deadline, '2026-08-07T16:00:00+08:00')
assert.equal(structuredResult.task_draft.recommended_vehicle_class, 'light')
console.log('✓ 结构化表单任务可直接进入编排层')

console.log('Agent 编排层测试全部通过。')
