<template>
  <aside class="role-overview" :aria-busy="loading">
    <div class="overview-kicker">当前工作台</div>
    <h2>{{ overview?.title || '正在加载角色信息' }}</h2>
    <p class="overview-description">{{ overview?.description || '请稍候…' }}</p>

    <div v-if="loading" class="overview-loading">正在读取工作台数据…</div>

    <template v-else-if="overview">
      <div class="metric-grid">
        <div v-for="metric in overview.metrics" :key="metric.label" class="metric-card">
          <strong>{{ metric.value }}</strong>
          <span>{{ metric.label }}</span>
        </div>
      </div>

      <div class="next-actions">
        <div class="actions-title">本角色主要入口</div>
        <ol>
          <li v-for="action in overview.next_actions" :key="action">{{ action }}</li>
        </ol>
      </div>

      <div class="overview-footer">
        <span :class="['source-dot', overview.source]"></span>
        {{ sourceLabel }} · {{ updatedTime }}
      </div>
    </template>

    <div v-else class="overview-error">工作台数据暂不可用</div>
  </aside>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  role: { type: String, required: true },
  overview: { type: Object, default: null },
  loading: { type: Boolean, default: false },
})

const sourceLabel = computed(() => (props.overview?.source === 'mock' ? '模拟数据' : '真实接口'))
const updatedTime = computed(() => {
  const value = props.overview?.updated_at
  if (!value) return '尚未更新'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
})
</script>

<style scoped>
.role-overview {
  position: absolute;
  top: 62px;
  right: 16px;
  width: 306px;
  box-sizing: border-box;
  padding: 16px;
  color: #edf5ff;
  background: linear-gradient(155deg, rgba(12, 28, 52, 0.94), rgba(16, 24, 40, 0.88));
  border: 1px solid rgba(144, 202, 249, 0.26);
  border-radius: 14px;
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
  z-index: 998;
}

.overview-kicker {
  margin-bottom: 4px;
  color: #64b5f6;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

h2 {
  margin: 0;
  font-size: 18px;
}

.overview-description {
  margin: 8px 0 14px;
  color: #b9c7d9;
  font-size: 12px;
  line-height: 1.55;
}

.overview-loading,
.overview-error {
  padding: 18px 0;
  color: #b0bec5;
  font-size: 12px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.metric-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 4px;
  border-radius: 9px;
  background: rgba(144, 202, 249, 0.08);
  border: 1px solid rgba(144, 202, 249, 0.12);
}

.metric-card strong {
  color: #81d4fa;
  font-size: 20px;
}

.metric-card span {
  color: #b0bec5;
  font-size: 10px;
}

.next-actions {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.actions-title {
  color: #dce9f7;
  font-size: 12px;
  font-weight: 600;
}

ol {
  margin: 8px 0 0;
  padding-left: 22px;
  color: #b9c7d9;
  font-size: 12px;
  line-height: 1.75;
}

.overview-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  color: #78909c;
  font-size: 10px;
}

.source-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #90a4ae;
}

.source-dot.mock { background: #ffd54f; }
.source-dot.real { background: #66bb6a; }

@media (max-width: 980px) {
  .role-overview {
    right: 10px;
    width: 270px;
  }
}
</style>
