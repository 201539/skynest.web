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

function recommendVehicle(task) {
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

module.exports = {
  recommendVehicle,
  VEHICLE_CLASSES,
  HIGH_RISK_CATEGORIES,
}
