<template>
  <nav class="role-switcher" aria-label="系统角色入口">
    <button
      v-for="role in roles"
      :key="role.id"
      type="button"
      :class="['role-button', { active: modelValue === role.id }]"
      :aria-pressed="modelValue === role.id"
      :title="role.description"
      @click="$emit('update:modelValue', role.id)"
    >
      {{ role.shortLabel || role.label }}
    </button>
    <span :class="['mode-badge', apiMode]">{{ apiModeLabel }}</span>
  </nav>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: String, required: true },
  roles: { type: Array, required: true },
  apiMode: { type: String, default: 'mock' },
})

defineEmits(['update:modelValue'])

const apiModeLabel = computed(() => {
  if (props.apiMode === 'real') return '真实接口'
  if (props.apiMode === 'auto') return '自动回退'
  return '模拟数据'
})
</script>

<style scoped>
.role-switcher {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid rgba(144, 202, 249, 0.25);
  border-radius: 9px;
  background: rgba(8, 19, 38, 0.58);
  pointer-events: auto;
}

.role-button {
  min-width: 64px;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #c7d2e3;
  font-size: 12px;
  cursor: pointer;
}

.role-button:hover {
  color: #fff;
  background: rgba(144, 202, 249, 0.12);
}

.role-button.active {
  color: #061426;
  background: linear-gradient(135deg, #90caf9, #4fc3f7);
  border-color: rgba(255, 255, 255, 0.5);
  font-weight: 700;
}

.mode-badge {
  margin-left: 2px;
  padding: 3px 7px;
  border-radius: 10px;
  font-size: 10px;
  white-space: nowrap;
  color: #cfd8dc;
  background: rgba(255, 255, 255, 0.08);
}

.mode-badge.mock { color: #ffe082; }
.mode-badge.real { color: #a5d6a7; }
.mode-badge.auto { color: #b39ddb; }
</style>
