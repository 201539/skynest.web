const assert = require('assert')
const { TASK_STATUS } = require('./taskState')
const { createWaybill, advanceStatus, simulateException } = require('./mockProvider')

const baseTask = {
  status: TASK_STATUS.APPROVED,
  agent_result_json: { task_draft: { recommended_vehicle_class: 'light' } },
  route_result_json: {
    route: { points: [
      { lng: 118.94, lat: 32.10, height: 80 },
      { lng: 118.95, lat: 32.11, height: 80 },
    ] },
  },
}

const waybill = createWaybill(baseTask, new Date('2026-08-08T08:00:00+08:00'))
assert(waybill.provider_order_no.startsWith('SKY-SBX-20260808-'))
assert.strictEqual(waybill.provider_status, 'ACCEPTED')
assert.strictEqual(waybill.telemetry.simulation, true)

const ready = advanceStatus({ ...baseTask, status: TASK_STATUS.PROVIDER_ACCEPTED })
assert.strictEqual(ready.task_status, TASK_STATUS.READY_FOR_TAKEOFF)
const inflight = advanceStatus({ ...baseTask, status: TASK_STATUS.READY_FOR_TAKEOFF })
assert.strictEqual(inflight.task_status, TASK_STATUS.IN_FLIGHT)
const arrived = advanceStatus({ ...baseTask, status: TASK_STATUS.IN_FLIGHT })
assert.strictEqual(arrived.task_status, TASK_STATUS.ARRIVED)
assert.match(arrived.pickup_code, /^SN-[A-F0-9]{6}$/)
const exception = simulateException({ ...baseTask, status: TASK_STATUS.IN_FLIGHT }, '测试异常')
assert.strictEqual(exception.task_status, TASK_STATUS.EXCEPTION)
assert.strictEqual(exception.exception_reason, '测试异常')

console.log('mockProvider tests passed')
