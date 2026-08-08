const assert = require('node:assert/strict')
const {
  TASK_STATUS,
  canTransition,
  assertTransition,
  getStatusLabel,
} = require('./taskState')

assert.equal(canTransition(TASK_STATUS.AGENT_REVIEWED, TASK_STATUS.PENDING_APPROVAL), true)
assert.equal(canTransition(TASK_STATUS.PENDING_APPROVAL, TASK_STATUS.APPROVED), true)
assert.equal(canTransition(TASK_STATUS.PENDING_APPROVAL, TASK_STATUS.IN_FLIGHT), false)
assert.equal(canTransition(TASK_STATUS.ARRIVED, TASK_STATUS.PICKED_UP), true)
assert.equal(canTransition(TASK_STATUS.COMPLETED, TASK_STATUS.PENDING_APPROVAL), false)
assert.equal(getStatusLabel(TASK_STATUS.IN_FLIGHT), '配送飞行中')

assert.doesNotThrow(() => assertTransition(TASK_STATUS.PENDING_APPROVAL, TASK_STATUS.REJECTED))
assert.throws(
  () => assertTransition(TASK_STATUS.SUBMITTED, TASK_STATUS.APPROVED),
  /不允许任务从/, 
)

console.log('✓ Demo 任务状态机测试全部通过。')
