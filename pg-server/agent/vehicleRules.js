const VEHICLE_CLASSES = {
  light: {
    code: 'light',
    label: '轻型配送无人机',
    max_weight_kg: 3,
  },
  medium: {
    code: 'medium',
    label: '中型配送无人机',
    max_weight_kg: 10,
  },
  heavy: {
    code: 'heavy',
    label: '重型配送无人机',
    max_weight_kg: 30,
  },
}

const HIGH_RISK_CATEGORIES = new Set([
  'medical_sample',
  'biological_material',
  'hazardous_chemical',
  'flammable_explosive',
])

const V3_VEHICLE_CLASSES = Object.freeze({
  micro: { code: 'micro', label: '微型配送无人机' },
  light: { code: 'light', label: '轻型配送无人机' },
  medium: { code: 'medium', label: '中型配送无人机' },
  heavy: { code: 'heavy', label: '重型配送无人机' },
})

const CATEGORY_DATABASE_MAP = Object.freeze({
  餐食饮品: { rule: '食品饮料', risk: '餐食饮品' },
  文件图书: { rule: '文件文书', risk: '文件图书' },
  日用小件: { rule: '其它', risk: '日用小件' },
  实验材料: { rule: '实验材料', risk: '实验材料' },
  医疗样本: { rule: '医疗样本', risk: '医疗样本' },
  生物材料: { rule: '生物材料', risk: '生物材料' },
  危险化学品: { rule: '化学试剂', risk: '危险化学品' },
  高价值设备: { rule: '电子产品', risk: '高价值设备' },
  '其他/无法识别': { rule: '其它', risk: '无法识别物品' },
})

const FALLBACK_HIGH_RISK = new Set(['实验材料', '医疗样本', '生物材料', '危险化学品', '高价值设备', '其他/无法识别'])

function normalizeRequirements(taskRequirements, databaseRule, riskRule) {
  const values = [...(taskRequirements || [])]
  if (databaseRule?.special_handling) values.push(...String(databaseRule.special_handling).split(/[+、，,]/))
  if (riskRule?.requires_cold_chain) values.push('冷链')
  if (riskRule?.requires_shockproof) values.push('防震')
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function findV3Rule(task, rules, databaseCategory) {
  return rules.find((rule) => {
    const min = Number(rule.min_weight_kg || 0)
    const max = rule.max_weight_kg == null ? Infinity : Number(rule.max_weight_kg)
    return rule.item_category === databaseCategory && task.weight_kg >= min && task.weight_kg <= max
  }) || rules.find((rule) => {
    const min = Number(rule.min_weight_kg || 0)
    const max = rule.max_weight_kg == null ? Infinity : Number(rule.max_weight_kg)
    return rule.item_category === '其它' && task.weight_kg >= min && task.weight_kg <= max
  })
}

function recommendLegacyVehicle(task) {
  if (task.weight_kg == null || !task.item_category) {
    return {
      vehicle: null,
      needs_manual_review: false,
      reason: '缺少重量或物品类型，暂不能推荐机型。',
    }
  }

  if (HIGH_RISK_CATEGORIES.has(task.item_category)) {
    return {
      vehicle: null,
      needs_manual_review: true,
      reason: '物品属于高风险类别，须由校方管理人员审核后再选择机型。',
    }
  }

  if (task.weight_kg <= 0) {
    return {
      vehicle: null,
      needs_manual_review: true,
      reason: '重量必须大于0公斤。',
    }
  }

  const vehicle = Object.values(VEHICLE_CLASSES).find(
    (item) => task.weight_kg <= item.max_weight_kg,
  )

  if (!vehicle) {
    return {
      vehicle: null,
      needs_manual_review: true,
      reason: '任务重量超过当前演示机型的30公斤上限，需人工制定运输方案。',
    }
  }

  return {
    vehicle,
    needs_manual_review: false,
    reason: `任务重量为${task.weight_kg}公斤，未超过${vehicle.max_weight_kg}公斤载荷上限。`,
  }
}

function recommendV3Vehicle(task, context = {}) {
  if (!task.item_category || !Number.isFinite(task.weight_kg) || task.weight_kg <= 0) {
    return { vehicle: null, needs_manual_review: true, required_handling: task.special_requirements || [], reason: '缺少有效的重量或物品类型，暂不能推荐机型。' }
  }
  const mapped = CATEGORY_DATABASE_MAP[task.item_category] || CATEGORY_DATABASE_MAP['其他/无法识别']
  const riskRule = (context.highRiskCategories || []).find((item) => item.category_name === mapped.risk)
  const highRisk = riskRule ? Boolean(riskRule.requires_manual) : FALLBACK_HIGH_RISK.has(task.item_category)
  const databaseRule = findV3Rule(task, context.vehicleRules || [], mapped.rule)
  const modelCandidates = databaseRule?.remarks
    ? String(databaseRule.remarks).replace(/^[^:：]+[:：]\s*/, '').split(/\s*[/、]\s*/).filter(Boolean)
    : []
  const vehicle = databaseRule ? {
    code: databaseRule.vehicle_class,
    label: V3_VEHICLE_CLASSES[databaseRule.vehicle_class]?.label || databaseRule.vehicle_class,
    max_weight_kg: Number(databaseRule.max_weight_kg),
    database_category: mapped.rule,
    rule_source: 'static.vehicle_rules',
    model_candidates: modelCandidates,
  } : null
  const requiredHandling = normalizeRequirements(task.special_requirements, databaseRule, riskRule)
  if (!vehicle) {
    return {
      vehicle: null,
      needs_manual_review: true,
      required_handling: requiredHandling,
      reason: `V3机型规则中没有覆盖“${mapped.rule}”${task.weight_kg}公斤的组合，需要校方制定运输方案。`,
    }
  }
  return {
    vehicle,
    needs_manual_review: highRisk,
    required_handling: requiredHandling,
    reason: highRisk
      ? `V3规则按“${mapped.rule}”和${task.weight_kg}公斤载重建议${modelCandidates.length ? modelCandidates.join('或') : vehicle.label}，但“${task.item_category}”触发专项人工复核。`
      : `V3规则按“${mapped.rule}”和${task.weight_kg}公斤载重建议${modelCandidates.length ? modelCandidates.join('或') : vehicle.label}；具体执行单机还需结合航程、电量、状态和功能配置筛选。`,
  }
}

function recommendVehicle(task, context = {}) {
  return CATEGORY_DATABASE_MAP[task.item_category] || context.vehicleRules || context.highRiskCategories
    ? recommendV3Vehicle(task, context)
    : recommendLegacyVehicle(task)
}

module.exports = {
  recommendVehicle,
  VEHICLE_CLASSES,
  HIGH_RISK_CATEGORIES,
  V3_VEHICLE_CLASSES,
  CATEGORY_DATABASE_MAP,
  FALLBACK_HIGH_RISK,
}
