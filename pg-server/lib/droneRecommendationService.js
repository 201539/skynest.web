const REQUIREMENT_CODES = Object.freeze({
  防震: 'shockproof', shockproof: 'shockproof',
  防水: 'waterproof', waterproof: 'waterproof',
  防漏: 'leakproof', leakproof: 'leakproof',
  冷链: 'cold_chain', cold_chain: 'cold_chain',
  恒温: 'temperature_controlled', temperature_controlled: 'temperature_controlled',
  静音要求: 'low_noise', low_noise: 'low_noise',
})

function requirementCodes(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => REQUIREMENT_CODES[String(value).trim()])
    .filter(Boolean))]
}

function round(value, digits = 2) {
  const scale = 10 ** digits
  return Math.round(Number(value) * scale) / scale
}

async function evaluateTaskCandidates(client, taskId, options = {}) {
  const safetyFactor = Number(options.safetyFactor || 0.7)
  const taskResult = await client.query(
    `SELECT t.*, r.route_id, r.distance_m
     FROM runtime.tasks t
     LEFT JOIN runtime.routes r ON r.task_id=t.task_id AND r.is_current
     WHERE t.task_id=$1`,
    [taskId]
  )
  if (!taskResult.rowCount) return null
  const task = taskResult.rows[0]
  if (!task.route_id || task.distance_m == null) return null

  const required = requirementCodes(task.special_requirements)
  const dronesResult = await client.query(`
    SELECT d.*, m.model_name, m.manufacturer, m.max_payload_kg,
           m.nominal_range_km, m.range_definition, m.wind_level_text,
           COALESCE(jsonb_object_agg(c.capability_code, jsonb_build_object(
             'status', c.support_status, 'method', c.support_method
           )) FILTER (WHERE c.capability_code IS NOT NULL), '{}'::jsonb) AS capabilities
    FROM runtime.drones d
    LEFT JOIN static.drone_models m ON m.model_id=d.model_id
    LEFT JOIN static.drone_model_capabilities c ON c.model_id=m.model_id
    GROUP BY d.drone_id, m.model_id
    ORDER BY d.drone_id
  `)

  const taskDistanceKm = Number(task.distance_m) / 1000
  const candidates = dronesResult.rows.map((drone) => {
    const battery = Number(drone.battery_level ?? 0)
    const payload = Number(drone.max_payload_kg ?? drone.payload_kg)
    const range = Number(drone.nominal_range_km ?? drone.range_km)
    const availableRange = Number.isFinite(range) ? range * battery / 100 * safetyFactor : NaN
    const payloadPassed = Number.isFinite(payload) && payload >= Number(task.weight_kg || 0)
    const rangePassed = Number.isFinite(availableRange) && availableRange >= taskDistanceKm
    const batteryPassed = battery >= 20
    const statusPassed = drone.status === 'idle' && drone.task_id == null && !drone.fault_code
    const capabilityRows = required.map((code) => ({ code, ...(drone.capabilities?.[code] || { status: 'unknown', method: '暂无能力数据' }) }))
    const missingCapabilities = capabilityRows.filter((item) => !['supported', 'requires_accessory'].includes(item.status))
    const accessoryCapabilities = capabilityRows.filter((item) => item.status === 'requires_accessory')
    const capabilityPassed = missingCapabilities.length === 0
    const rejectionReasons = []
    if (!payloadPassed) rejectionReasons.push(Number.isFinite(payload) ? `载重上限${payload}kg不足` : '载重数据未披露')
    if (!rangePassed) rejectionReasons.push(Number.isFinite(availableRange) ? `安全可用航程${round(availableRange)}km不足` : '航程数据未披露')
    if (!batteryPassed) rejectionReasons.push(`电量${battery}%低于20%`)
    if (!statusPassed) rejectionReasons.push(drone.fault_code ? `故障：${drone.fault_code}` : '当前非空闲或已被占用')
    if (!capabilityPassed) rejectionReasons.push(`缺少已确认能力：${missingCapabilities.map((item) => item.code).join('、')}`)
    const eligible = payloadPassed && rangePassed && batteryPassed && statusPassed && capabilityPassed
    return {
      drone,
      eligible,
      taskDistanceKm,
      availableRange: Number.isFinite(availableRange) ? round(availableRange) : null,
      battery,
      payload,
      payloadPassed,
      rangePassed,
      batteryPassed,
      statusPassed,
      capabilityPassed,
      matchedCapabilities: capabilityRows,
      missingCapabilities,
      accessoryCapabilities,
      rejectionReasons,
    }
  })

  const eligible = candidates.filter((item) => item.eligible).sort((left, right) => {
    const payloadWaste = (left.payload - Number(task.weight_kg || 0)) - (right.payload - Number(task.weight_kg || 0))
    if (payloadWaste !== 0) return payloadWaste
    return (left.availableRange - taskDistanceKm) - (right.availableRange - taskDistanceKm)
  })
  eligible.forEach((item, index) => { item.rank = index + 1 })
  const recommended = eligible[0] || null

  await client.query('DELETE FROM runtime.task_drone_candidates WHERE task_id=$1 AND route_id=$2', [taskId, task.route_id])
  for (const item of candidates) {
    const modelName = item.drone.model_name || item.drone.model || item.drone.drone_code
    const accessoryMethods = [...new Set(item.accessoryCapabilities.map((capability) => capability.method).filter(Boolean))]
    const accessoryText = accessoryMethods.length
      ? `；${accessoryMethods.join('；')}`
      : ''
    const reason = item.eligible
      ? `${modelName}载重上限${item.payload}kg，当前电量${item.battery}%，安全可用航程${item.availableRange}km，可覆盖${round(taskDistanceKm)}km任务航线${accessoryText}`
      : item.rejectionReasons.join('；')
    item.reason = reason
    await client.query(
      `INSERT INTO runtime.task_drone_candidates (
         task_id, route_id, drone_id, recommendation_rank, is_eligible, is_recommended,
         task_distance_km, available_range_km, battery_percent, safety_factor,
         payload_passed, range_passed, battery_passed, status_passed, capability_passed,
         matched_capabilities, missing_capabilities, rejection_reasons, recommendation_reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19)`,
      [taskId, task.route_id, item.drone.drone_id, item.rank || null, item.eligible, item === recommended,
       taskDistanceKm, item.availableRange, item.battery, safetyFactor,
       item.payloadPassed, item.rangePassed, item.batteryPassed, item.statusPassed, item.capabilityPassed,
       JSON.stringify(item.matchedCapabilities), JSON.stringify(item.missingCapabilities),
       JSON.stringify(item.rejectionReasons), reason]
    )
  }
  await client.query('UPDATE runtime.tasks SET recommended_drone_id=$2, updated_at=now() WHERE task_id=$1', [taskId, recommended?.drone.drone_id || null])
  return recommended ? {
    drone_id: Number(recommended.drone.drone_id),
    drone_code: recommended.drone.drone_code,
    model_name: recommended.drone.model_name || recommended.drone.model,
    manufacturer: recommended.drone.manufacturer,
    reason: recommended.reason,
    task_distance_km: round(taskDistanceKm),
    available_range_km: recommended.availableRange,
    battery_percent: recommended.battery,
    max_payload_kg: recommended.payload,
    accessory_requirements: [...new Set(recommended.accessoryCapabilities.map((item) => item.method).filter(Boolean))],
  } : null
}

module.exports = { evaluateTaskCandidates, requirementCodes }
