const crypto = require('crypto')
const { TASK_STATUS } = require('./taskState')

const PROVIDER = Object.freeze({
  code: 'skynest_partner_sandbox',
  name: 'SkyNest Partner Sandbox（沙箱仿真）',
  environment: 'mock',
})

const VEHICLES = Object.freeze({
  light: 'SKY-Lite 3（轻型配送无人机，≤3 kg）',
  medium: 'SKY-Mid 10（中型配送无人机，≤10 kg）',
  heavy: 'SKY-Heavy 30（重型配送无人机，≤30 kg）',
})

function createProviderError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function formatDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}${value.month}${value.day}`
}

function createPickupCode() {
  return `SN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
}

function vehicleForTask(task) {
  const recommended = task.agent_result_json?.task_draft?.recommended_vehicle_class
  return VEHICLES[recommended] || VEHICLES.light
}

function getProgress(status) {
  const progress = {
    ACCEPTED: 0,
    READY_FOR_TAKEOFF: 5,
    IN_FLIGHT: 55,
    ARRIVED: 100,
    EXCEPTION: 0,
  }
  return progress[status] ?? 0
}

function getRoutePosition(task, ratio) {
  const points = task.route_result_json?.route?.points || []
  if (!points.length) return null
  const safeRatio = Math.max(0, Math.min(1, ratio))
  const index = Math.round((points.length - 1) * safeRatio)
  const point = points[index]
  return {
    lng: point.lng,
    lat: point.lat,
    height: point.height,
    waypoint_index: index,
    waypoint_total: points.length,
  }
}

function buildTelemetry(task, providerStatus, now = new Date()) {
  const progressPercent = getProgress(providerStatus)
  return {
    simulation: true,
    provider_status: providerStatus,
    progress_percent: progressPercent,
    current_position: getRoutePosition(task, progressPercent / 100),
    estimated_arrival: providerStatus === 'ARRIVED'
      ? now.toISOString()
      : new Date(now.getTime() + Math.max(1, 100 - progressPercent) * 1000).toISOString(),
    updated_at: now.toISOString(),
  }
}

function createWaybill(task, now = new Date()) {
  if (!task.route_result_json?.route?.points?.length) {
    throw createProviderError('请先生成校园推荐通道，再请求企业运力')
  }
  if (task.status !== TASK_STATUS.APPROVED) {
    throw createProviderError('只有校方已批准的任务可以请求企业运力')
  }

  const providerStatus = 'ACCEPTED'
  return {
    provider: PROVIDER,
    provider_order_no: `SKY-SBX-${formatDay(now)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    provider_vehicle: vehicleForTask(task),
    provider_status: providerStatus,
    telemetry: buildTelemetry(task, providerStatus, now),
  }
}

function advanceStatus(task, now = new Date()) {
  const nextByTaskStatus = {
    [TASK_STATUS.PROVIDER_ACCEPTED]: {
      task_status: TASK_STATUS.READY_FOR_TAKEOFF,
      provider_status: 'READY_FOR_TAKEOFF',
      title: '企业已完成起飞准备',
      detail: '沙箱企业已完成机型与接驳点确认，等待模拟起飞。',
    },
    [TASK_STATUS.READY_FOR_TAKEOFF]: {
      task_status: TASK_STATUS.IN_FLIGHT,
      provider_status: 'IN_FLIGHT',
      title: '配送飞行中',
      detail: '沙箱企业正在推送模拟飞行遥测，不代表真实飞行。',
    },
    [TASK_STATUS.IN_FLIGHT]: {
      task_status: TASK_STATUS.ARRIVED,
      provider_status: 'ARRIVED',
      pickup_code: createPickupCode(),
      title: '已到达校园接驳点',
      detail: '沙箱航班已到达终点接驳点，等待用户取件。',
    },
  }
  const next = nextByTaskStatus[task.status]
  if (!next) {
    throw createProviderError('当前任务状态不能继续推进企业沙箱流程')
  }
  return {
    ...next,
    telemetry: buildTelemetry(task, next.provider_status, now),
  }
}

function simulateException(task, reason, now = new Date()) {
  if (![TASK_STATUS.PROVIDER_ACCEPTED, TASK_STATUS.READY_FOR_TAKEOFF, TASK_STATUS.IN_FLIGHT].includes(task.status)) {
    throw createProviderError('当前任务状态不能模拟企业配送异常')
  }
  const exceptionReason = String(reason || '沙箱模拟：天气窗口变化，航班暂缓执行。').trim()
  return {
    task_status: TASK_STATUS.EXCEPTION,
    provider_status: 'EXCEPTION',
    exception_reason: exceptionReason,
    title: '企业沙箱报告配送异常',
    detail: exceptionReason,
    telemetry: buildTelemetry(task, 'EXCEPTION', now),
  }
}

module.exports = {
  PROVIDER,
  VEHICLES,
  buildTelemetry,
  createWaybill,
  createPickupCode,
  advanceStatus,
  simulateException,
}
