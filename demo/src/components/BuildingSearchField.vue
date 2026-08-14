<template>
  <div class="building-field">
    <label :for="inputId" class="field-label">{{ label }} <b v-if="required">*</b></label>
    <div class="building-input-wrap">
      <input
        :id="inputId"
        :value="modelValue"
        type="search"
        :required="required"
        autocomplete="off"
        :placeholder="loading ? '正在加载正式建筑…' : placeholder"
        :disabled="loading"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="listboxId"
        :aria-invalid="Boolean(error)"
        @focus="open = true"
        @blur="closeLater"
        @input="handleInput"
      />
      <small v-if="exactBuilding" class="verified-badge">正式建筑</small>
      <div v-if="open && !loading" :id="listboxId" class="building-options" role="listbox">
        <button
          v-for="building in suggestions"
          :key="building.building_id"
          type="button"
          role="option"
          :aria-selected="building.building_name === modelValue"
          @mousedown.prevent="selectBuilding(building)"
        >
          <strong>{{ building.building_name }}</strong>
          <span>{{ Number(building.location.lng).toFixed(6) }}, {{ Number(building.location.lat).toFixed(6) }}</span>
        </button>
        <div v-if="!suggestions.length" class="no-building-result">
          未找到匹配建筑，请输入正式名称中的关键词。
        </div>
      </div>
    </div>
    <em v-if="error">{{ error }}</em>
    <small v-else-if="loadError" class="load-error">建筑库加载失败：{{ loadError }}</small>
    <small v-else-if="accessLoading" class="access-hint">正在查询最近{{ accessRoleLabel }}…</small>
    <small v-else-if="accessPoint" class="access-hint verified">
      {{ accessRoleLabel }}：{{ accessPoint.node_code }} · {{ accessPoint.node_name }} · 约{{ Math.round(accessPoint.distance_m) }}米
    </small>
    <small v-else-if="exactBuilding" class="access-hint">已匹配正式坐标，正在等待节点信息。</small>
    <small v-else class="source-hint">数据来源：V3 正式建筑库 · 支持名称搜索</small>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

let fieldSequence = 0

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  placeholder: { type: String, default: '输入建筑名称搜索' },
  buildings: { type: Array, default: () => [] },
  required: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  loadError: { type: String, default: '' },
  error: { type: String, default: '' },
  accessPoint: { type: Object, default: null },
  accessLoading: { type: Boolean, default: false },
  accessRole: { type: String, default: 'departure' },
  excludeName: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'select'])
const open = ref(false)
const fieldId = ++fieldSequence
const inputId = `building-input-${fieldId}`
const listboxId = `building-options-${fieldId}`

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/[\s·•・—_-]/g, '')
}

const exactBuilding = computed(() => {
  const query = normalize(props.modelValue)
  if (!query) return null
  return props.buildings.find((building) => normalize(building.building_name) === query) || null
})

const suggestions = computed(() => {
  const query = normalize(props.modelValue)
  const filtered = props.buildings.filter((building) => {
    if (building.building_name === props.excludeName) return false
    return !query || normalize(building.building_name).includes(query)
  })
  return filtered
    .sort((left, right) => {
      const leftName = normalize(left.building_name)
      const rightName = normalize(right.building_name)
      const leftExact = leftName === query ? 0 : leftName.startsWith(query) ? 1 : 2
      const rightExact = rightName === query ? 0 : rightName.startsWith(query) ? 1 : 2
      return leftExact - rightExact || left.building_name.localeCompare(right.building_name, 'zh-CN')
    })
    .slice(0, 8)
})

const accessRoleLabel = computed(() => props.accessRole === 'receiving' ? 'L3接驳箱' : '起飞节点')

function handleInput(event) {
  const value = event.target.value
  emit('update:modelValue', value)
  const exact = props.buildings.find((building) => normalize(building.building_name) === normalize(value)) || null
  emit('select', exact)
  open.value = true
}

function selectBuilding(building) {
  emit('update:modelValue', building.building_name)
  emit('select', building)
  open.value = false
}

function closeLater() {
  globalThis.setTimeout(() => { open.value = false }, 100)
}
</script>

<style scoped>
.building-field { position: relative; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field-label { color: #ced9e8; font-size: 11px; }
.building-field b { color: #ff8a80; }
.building-input-wrap { position: relative; }
input { width: 100%; box-sizing: border-box; padding: 8px 76px 8px 9px; color: #f5f9ff; background: rgba(4, 13, 27, 0.72); border: 1px solid rgba(144, 202, 249, 0.2); border-radius: 7px; outline: none; font: inherit; font-size: 12px; }
input:focus { border-color: #64b5f6; box-shadow: 0 0 0 2px rgba(100, 181, 246, 0.12); }
input:disabled { opacity: 0.65; }
.verified-badge { position: absolute; top: 8px; right: 8px; padding: 2px 5px; color: #a5d6a7; background: rgba(76, 175, 80, 0.14); border-radius: 999px; font-size: 8px; }
.building-options { position: absolute; z-index: 20; top: calc(100% + 4px); right: 0; left: 0; max-height: 214px; overflow-y: auto; padding: 4px; background: rgba(5, 17, 34, 0.98); border: 1px solid rgba(79, 195, 247, 0.32); border-radius: 8px; box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4); }
.building-options button { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 7px 8px; color: #e6f3ff; text-align: left; background: transparent; border: 0; border-radius: 5px; cursor: pointer; }
.building-options button:hover, .building-options button[aria-selected='true'] { background: rgba(79, 195, 247, 0.14); }
.building-options strong { font-size: 10px; font-weight: 600; }
.building-options span { color: #78909c; font-size: 8px; }
.no-building-result { padding: 12px 8px; color: #ffcc80; font-size: 9px; line-height: 1.5; }
.building-field em { color: #ffab91; font-size: 10px; font-style: normal; }
.building-field > small { font-size: 8px; line-height: 1.4; }
.source-hint { color: #607d8b; }
.access-hint { color: #90a4ae; }
.access-hint.verified { color: #80cbc4; }
.load-error { color: #ffab91; }
</style>
