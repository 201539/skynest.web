const API_BASE = '/api'
const taskList = document.querySelector('#task-list')
const metrics = document.querySelector('#metrics')
const errorBox = document.querySelector('#error')
const refreshButton = document.querySelector('#refresh')
const roleHomeLink = document.querySelector('#role-home')

if (roleHomeLink && window.location.port === '3001') {
  roleHomeLink.href = `${window.location.protocol}//${window.location.hostname}:5173/`
}

const state = { tasks: [], busyTaskId: null }
const ADVANCE_STATUSES = new Set(['PROVIDER_ACCEPTED', 'READY_FOR_TAKEOFF', 'IN_FLIGHT'])

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || '企业服务暂不可用')
  return data
}

function actionFor(task) {
  if (task.status === 'APPROVED') return { name: 'accept', label: '接受任务并生成沙箱运单' }
  if (ADVANCE_STATUSES.has(task.status)) return { name: 'advance', label: task.status === 'IN_FLIGHT' ? '确认到达接驳点' : '推进至下一履约阶段' }
  return null
}

function render() {
  const active = state.tasks.filter((task) => ['PROVIDER_ACCEPTED', 'READY_FOR_TAKEOFF', 'IN_FLIGHT'].includes(task.status)).length
  const waiting = state.tasks.filter((task) => task.status === 'APPROVED').length
  const completed = state.tasks.filter((task) => ['ARRIVED', 'PICKED_UP', 'COMPLETED'].includes(task.status)).length
  metrics.innerHTML = `<div class="metric"><span>待接单</span><strong>${waiting}</strong></div><div class="metric"><span>履约中</span><strong>${active}</strong></div><div class="metric"><span>已送达</span><strong>${completed}</strong></div>`

  if (!state.tasks.length) {
    taskList.innerHTML = '<div class="empty">暂无已通过校方审核的配送任务</div>'
    return
  }

  taskList.innerHTML = state.tasks.map((task) => {
    const action = actionFor(task)
    const progress = Number(task.telemetry?.progress_percent || 0)
    return `<article class="task-card">
      <div class="task-head"><div><strong>${escapeHtml(task.origin_text)} → ${escapeHtml(task.destination_text)}</strong><small>${escapeHtml(task.request_no)}</small></div><span class="status">${escapeHtml(task.status_label)}</span></div>
      <div class="route">${escapeHtml(task.item_category)} · ${escapeHtml(task.weight_kg)}kg${task.route_summary?.total_length_meters ? ` · 推荐通道 ${escapeHtml(task.route_summary.total_length_meters)}m` : ''}</div>
      <div class="details"><span>运单：${escapeHtml(task.provider_order_no || '待企业接单')}</span><span>机型：${escapeHtml(task.provider_vehicle?.model || task.provider_vehicle || '待匹配')}</span></div>
      <div class="progress"><i style="width:${Math.max(0, Math.min(progress, 100))}%"></i></div><div class="progress-text">沙箱履约进度 ${progress}%</div>
      ${action ? `<button class="action" data-task-id="${task.id}" data-action="${action.name}" ${state.busyTaskId === task.id ? 'disabled' : ''}>${state.busyTaskId === task.id ? '处理中…' : action.label}</button>` : ''}
    </article>`
  }).join('')
}

async function loadTasks() {
  errorBox.textContent = ''
  refreshButton.disabled = true
  try {
    const data = await request('/enterprise/demo/tasks?limit=100')
    state.tasks = data.tasks || []
    render()
  } catch (error) {
    errorBox.textContent = error.message
  } finally {
    refreshButton.disabled = false
  }
}

taskList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-task-id]')
  if (!button || state.busyTaskId) return
  const taskId = String(button.dataset.taskId)
  state.busyTaskId = taskId
  render()
  try {
    await request(`/enterprise/demo/tasks/${taskId}/${button.dataset.action}`, { method: 'POST', body: '{}' })
    await loadTasks()
  } catch (error) {
    errorBox.textContent = error.message
  } finally {
    state.busyTaskId = null
    render()
  }
})

refreshButton.addEventListener('click', loadTasks)
loadTasks()
setInterval(loadTasks, 6000)
