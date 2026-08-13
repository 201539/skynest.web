<template>
  <section class="model-status-card" :aria-busy="loading">
    <div class="model-status-heading">
      <div>
        <span>AGENT EXPLANATION</span>
        <strong>智能解释模型</strong>
      </div>
      <b :class="statusTone">{{ statusLabel }}</b>
    </div>

    <p>风险、机型和运输要求始终由 V3 数据库决定；模型只负责把结果解释给不同角色。</p>

    <div class="model-config-row">
      <label>
        <span>解释来源</span>
        <select v-model="provider" :disabled="saving">
          <option value="ollama">本地 Ollama</option>
          <option value="dashscope">阿里云百炼</option>
        </select>
      </label>
      <label class="model-switch">
        <input v-model="enabled" type="checkbox" :disabled="saving" />
        <span>{{ enabled ? '启用模型解释' : '仅规则说明' }}</span>
      </label>
      <button type="button" :disabled="loading || saving" @click="saveConfig">
        {{ saving ? '保存中…' : '应用' }}
      </button>
    </div>

    <div v-if="error" class="model-error" role="alert">{{ error }}</div>
    <div v-else class="model-meta">
      <span>模型：{{ status.model || '—' }}</span>
      <span>{{ status.note || connectivityLabel }}</span>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { demoApi } from '../services/demoApi'

const emit = defineEmits(['notify'])
const status = ref({})
const provider = ref('ollama')
const enabled = ref(false)
const loading = ref(false)
const saving = ref(false)
const error = ref('')

const statusTone = computed(() => {
  if (!enabled.value) return 'rules'
  if (status.value.provider === 'dashscope') return status.value.configured ? 'online' : 'warning'
  return status.value.reachable && status.value.model_installed ? 'online' : 'warning'
})
const statusLabel = computed(() => ({
  rules: '规则模式',
  online: '模型可用',
  warning: '安全降级',
}[statusTone.value]))
const connectivityLabel = computed(() => {
  if (!enabled.value) return '模型关闭，不会发起外部请求。'
  if (status.value.provider === 'dashscope') return status.value.configured ? '百炼已配置。' : '百炼密钥未在服务端配置。'
  if (!status.value.reachable) return 'Ollama 未连接，解析时会自动使用规则说明。'
  return status.value.model_installed ? '本地模型已安装。' : 'Ollama 已连接，但目标模型未安装。'
})

function applyStatus(data) {
  status.value = data || {}
  provider.value = status.value.provider || 'ollama'
  enabled.value = Boolean(status.value.enabled)
}

async function loadStatus() {
  loading.value = true
  error.value = ''
  try {
    applyStatus(await demoApi.getAgentModelStatus())
  } catch (requestError) {
    error.value = requestError.message || '模型状态读取失败'
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  saving.value = true
  error.value = ''
  try {
    applyStatus(await demoApi.updateAgentModelConfig({ provider: provider.value, enabled: enabled.value }))
    emit('notify', enabled.value ? '智能解释设置已更新；不可用时会自动回退到V3规则说明。' : '已切换为仅V3规则说明。')
  } catch (requestError) {
    error.value = requestError.message || '模型设置保存失败'
  } finally {
    saving.value = false
  }
}

onMounted(loadStatus)
</script>

<style scoped>
.model-status-card { margin: 10px 0; padding: 10px; color: #b0bec5; background: linear-gradient(135deg, rgba(20, 54, 78, 0.72), rgba(5, 18, 32, 0.82)); border: 1px solid rgba(79, 195, 247, 0.22); border-radius: 9px; }
.model-status-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.model-status-heading > div { display: flex; flex-direction: column; gap: 2px; }
.model-status-heading span { color: #4fc3f7; font-size: 8px; letter-spacing: 0.12em; }
.model-status-heading strong { color: #eef7ff; font-size: 11px; }
.model-status-heading b { padding: 3px 7px; border-radius: 999px; font-size: 9px; }
.model-status-heading b.rules { color: #b3e5fc; background: rgba(3, 169, 244, 0.12); }
.model-status-heading b.online { color: #c8e6c9; background: rgba(102, 187, 106, 0.13); }
.model-status-heading b.warning { color: #ffe0b2; background: rgba(255, 152, 0, 0.14); }
.model-status-card > p { margin: 7px 0 9px; color: #90a4ae; font-size: 9px; line-height: 1.5; }
.model-config-row { display: grid; grid-template-columns: 1fr auto auto; align-items: end; gap: 7px; }
.model-config-row label { display: flex; flex-direction: column; gap: 3px; color: #78909c; font-size: 8px; }
.model-config-row select { padding: 6px; color: #e5f1fb; background: rgba(4, 13, 27, 0.78); border: 1px solid rgba(144, 202, 249, 0.2); border-radius: 6px; font-size: 9px; }
.model-config-row .model-switch { flex-direction: row; align-items: center; gap: 4px; min-height: 28px; color: #b0bec5; }
.model-switch input { accent-color: #4fc3f7; }
.model-config-row button { min-height: 28px; padding: 5px 8px; color: #061426; font-weight: 700; background: #4fc3f7; border: 0; border-radius: 6px; font-size: 9px; cursor: pointer; }
.model-config-row button:disabled { opacity: 0.5; cursor: wait; }
.model-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 7px; color: #78909c; font-size: 8px; }
.model-error { margin-top: 7px; color: #ffab91; font-size: 9px; }
</style>
