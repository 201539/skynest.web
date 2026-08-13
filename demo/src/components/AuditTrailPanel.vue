<template>
  <section class="audit-trail" :aria-busy="loading">
    <div class="audit-summary">
      <div><strong>{{ workspace.summary.total }}</strong><span>全部记录</span></div>
      <div><strong>{{ workspace.summary.today }}</strong><span>今日操作</span></div>
      <div><strong>{{ workspace.summary.safety }}</strong><span>安全事件</span></div>
      <div><strong>{{ workspace.summary.exceptions }}</strong><span>熔断事件</span></div>
    </div>

    <div class="audit-toolbar">
      <label>
        <span>记录类型</span>
        <select v-model="categoryFilter">
          <option v-for="option in categoryOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="search-field">
        <span>搜索记录</span>
        <input v-model.trim="searchText" type="search" placeholder="任务编号、地点或操作人" />
      </label>
      <button type="button" class="export-btn" :disabled="!filteredRecords.length" @click="exportRecords">导出记录</button>
    </div>

    <div class="persistence-note">
      <strong>已开启数据库审计</strong>
      <span>任务申请、校方审批、运营执行与安全操作均由真实数据库保存。</span>
    </div>

    <div v-if="loading" class="audit-state">正在读取审计记录…</div>
    <div v-else-if="loadError" class="audit-state error-state">
      {{ loadError }}
      <button type="button" @click="loadAudit">重新加载</button>
    </div>
    <div v-else-if="!filteredRecords.length" class="audit-state">没有符合当前条件的记录。</div>

    <div v-else class="audit-timeline" aria-label="系统审计记录">
      <article v-for="record in filteredRecords" :key="record.id" class="audit-record" :class="record.category">
        <div class="timeline-marker">{{ categoryIcon(record.category) }}</div>
        <div class="record-content">
          <div class="record-heading">
            <div>
              <span class="category-badge">{{ categoryLabel(record.category) }}</span>
              <strong>{{ record.title }}</strong>
            </div>
            <time :datetime="record.created_at">{{ formatDateTime(record.created_at) }}</time>
          </div>
          <p>{{ record.description }}</p>
          <div class="record-context">
            <span>{{ roleLabel(record.actor?.role) }} · {{ record.actor?.name || '系统' }}</span>
            <span v-if="record.task_id">任务 {{ record.task_id }}</span>
            <span v-if="record.actor?.department">{{ record.actor.department }}</span>
          </div>
          <details v-if="metadataEntries(record.metadata).length">
            <summary>查看留痕详情</summary>
            <dl>
              <div v-for="entry in metadataEntries(record.metadata)" :key="entry.key">
                <dt>{{ metadataLabel(entry.key) }}</dt>
                <dd>{{ formatMetadataValue(entry.key, entry.value) }}</dd>
              </div>
            </dl>
          </details>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { AUDIT_CATEGORY } from '../domain/contracts'
import { demoApi } from '../services/demoApi'

const emit = defineEmits(['notify', 'count'])

const categoryOptions = Object.freeze([
  { value: 'all', label: '全部记录' },
  { value: AUDIT_CATEGORY.TASK, label: '任务申请' },
  { value: AUDIT_CATEGORY.APPROVAL, label: '校方审批' },
  { value: AUDIT_CATEGORY.OPERATION, label: '运营执行' },
  { value: AUDIT_CATEGORY.SAFETY, label: '安全管控' },
])

const workspace = ref({ records: [], summary: { total: 0, today: 0, safety: 0, exceptions: 0 } })
const loading = ref(false)
const loadError = ref('')
const categoryFilter = ref('all')
const searchText = ref('')

const filteredRecords = computed(() => {
  const query = searchText.value.toLocaleLowerCase('zh-CN')
  return workspace.value.records.filter((record) => {
    if (categoryFilter.value !== 'all' && record.category !== categoryFilter.value) return false
    if (!query) return true
    return [
      record.title,
      record.description,
      record.task_id,
      record.actor?.name,
      record.actor?.department,
      record.resource?.id,
    ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(query)
  })
})

function categoryLabel(category) {
  return {
    [AUDIT_CATEGORY.TASK]: '任务',
    [AUDIT_CATEGORY.APPROVAL]: '审批',
    [AUDIT_CATEGORY.OPERATION]: '运营',
    [AUDIT_CATEGORY.SAFETY]: '安全',
  }[category] || '系统'
}

function categoryIcon(category) {
  return {
    [AUDIT_CATEGORY.TASK]: '单',
    [AUDIT_CATEGORY.APPROVAL]: '审',
    [AUDIT_CATEGORY.OPERATION]: '运',
    [AUDIT_CATEGORY.SAFETY]: '安',
  }[category] || '记'
}

function roleLabel(role) {
  return { student: '师生端', school: '校方端', operator: '运营端', system: '系统' }[role] || '系统'
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

function metadataEntries(metadata = {}) {
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({ key, value }))
}

function metadataLabel(key) {
  return {
    decision: '审批结果', reason: '操作原因', item_category: '物品类型', weight_kg: '重量',
    needs_manual_review: '人工复核', drone_name: '执行无人机', drone_status: '无人机状态',
    node_name: '接驳节点', node_state: '节点状态', node_availability: '节点可用状态',
    task_status: '任务状态', radius_m: '限制半径', end_at: '结束时间', status: '限制状态',
    distance_change_percent: '航程变化', risk_change_percent: '风险变化', safety_buffer_meters: '安全缓冲',
    restriction_id: '限制区编号', drone_id: '无人机编号', node_id: '节点编号',
  }[key] || key
}

function formatMetadataValue(key, value) {
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (key.endsWith('_percent')) return `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(1)}%`
  if (key === 'weight_kg') return `${value} kg`
  if (key === 'radius_m' || key === 'safety_buffer_meters') return `${value} m`
  if (key === 'end_at') return formatDateTime(value)
  if (Array.isArray(value)) return value.join('、')
  return String(value)
}

async function loadAudit() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await demoApi.getAuditWorkspace()
    workspace.value = {
      records: Array.isArray(result?.records) ? result.records : [],
      summary: { total: 0, today: 0, safety: 0, exceptions: 0, ...(result?.summary || {}) },
    }
    emit('count', workspace.value.summary.total)
  } catch (error) {
    loadError.value = `审计记录加载失败：${error.message}`
  } finally {
    loading.value = false
  }
}

function exportRecords() {
  const payload = {
    exported_at: new Date().toISOString(),
    filter: { category: categoryFilter.value, keyword: searchText.value },
    records: filteredRecords.value,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `skynest-audit-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  emit('notify', `已导出 ${filteredRecords.value.length} 条审计记录`)
}

defineExpose({ refresh: loadAudit })
onMounted(loadAudit)
</script>

<style scoped>
.audit-trail { color: #edf5ff; }
.audit-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
.audit-summary div { display: flex; flex-direction: column; align-items: center; padding: 8px 4px; background: rgba(126, 87, 194, 0.08); border: 1px solid rgba(179, 157, 219, 0.16); border-radius: 8px; }
.audit-summary strong { color: #d1c4e9; font-size: 18px; }
.audit-summary span { color: #90a4ae; font-size: 9px; }
.audit-toolbar { display: grid; grid-template-columns: 0.8fr 1.4fr auto; align-items: end; gap: 7px; margin-top: 10px; }
.audit-toolbar label { display: flex; flex-direction: column; gap: 4px; color: #90a4ae; font-size: 9px; }
.audit-toolbar select, .audit-toolbar input { box-sizing: border-box; width: 100%; padding: 7px 8px; color: #f5f9ff; background: rgba(4, 13, 27, 0.72); border: 1px solid rgba(179, 157, 219, 0.2); border-radius: 6px; outline: none; font: inherit; font-size: 9px; }
.export-btn { padding: 7px 8px; color: #f3e5f5; background: rgba(126, 87, 194, 0.18); border: 1px solid rgba(179, 157, 219, 0.28); border-radius: 6px; font-size: 9px; cursor: pointer; }
.export-btn:disabled { opacity: 0.45; cursor: default; }
.persistence-note { display: flex; flex-direction: column; gap: 2px; margin-top: 9px; padding: 8px; color: #c5e1a5; background: rgba(124, 179, 66, 0.07); border: 1px solid rgba(174, 213, 129, 0.16); border-radius: 7px; font-size: 9px; }
.persistence-note span { color: #90a4ae; }
.audit-state { margin-top: 10px; padding: 14px; color: #90a4ae; text-align: center; font-size: 10px; }
.audit-state.error-state { color: #ffab91; }
.audit-state button { margin-left: 5px; color: #80deea; background: none; border: 0; cursor: pointer; }
.audit-timeline { position: relative; display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.audit-timeline::before { position: absolute; top: 12px; bottom: 12px; left: 14px; width: 1px; content: ''; background: rgba(179, 157, 219, 0.22); }
.audit-record { position: relative; display: grid; grid-template-columns: 29px 1fr; gap: 8px; }
.timeline-marker { z-index: 1; display: grid; width: 28px; height: 28px; color: #d1c4e9; background: #18243a; border: 1px solid rgba(179, 157, 219, 0.35); border-radius: 50%; place-items: center; font-size: 9px; font-weight: 700; }
.audit-record.safety .timeline-marker { color: #ffccbc; border-color: rgba(255, 112, 67, 0.42); }
.audit-record.operation .timeline-marker { color: #b2ebf2; border-color: rgba(38, 198, 218, 0.4); }
.audit-record.approval .timeline-marker { color: #c8e6c9; border-color: rgba(102, 187, 106, 0.4); }
.record-content { min-width: 0; padding: 9px; background: rgba(4, 13, 27, 0.48); border: 1px solid rgba(179, 157, 219, 0.12); border-radius: 8px; }
.record-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.record-heading > div { display: flex; align-items: center; min-width: 0; gap: 5px; }
.record-heading strong { overflow: hidden; color: #e8eaf6; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.record-heading time { flex: 0 0 auto; color: #607d8b; font-size: 8px; }
.category-badge { padding: 2px 4px; color: #d1c4e9; background: rgba(126, 87, 194, 0.13); border-radius: 4px; font-size: 8px; }
.record-content p { margin: 5px 0; color: #aebdca; font-size: 9px; line-height: 1.45; }
.record-context { display: flex; flex-wrap: wrap; gap: 4px 9px; color: #78909c; font-size: 8px; }
.record-content details { margin-top: 7px; padding-top: 6px; border-top: 1px solid rgba(144, 202, 249, 0.1); }
.record-content summary { color: #b39ddb; font-size: 8px; cursor: pointer; }
.record-content dl { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin: 7px 0 0; }
.record-content dl div { min-width: 0; padding: 5px; background: rgba(21, 34, 52, 0.62); border-radius: 5px; }
.record-content dt { color: #607d8b; font-size: 7px; }
.record-content dd { overflow: hidden; margin: 2px 0 0; color: #cfd8dc; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 980px) {
  .audit-toolbar { grid-template-columns: 1fr 1fr; }
  .export-btn { grid-column: 2; justify-self: end; }
}
</style>
