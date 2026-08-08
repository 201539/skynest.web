const API_BASE = '/api'
const storageKey = 'skynest.student.task-id'
const state = { taskId: localStorage.getItem(storageKey), polling: null, places: [] }

const formPanel = document.querySelector('#form-panel')
const taskPanel = document.querySelector('#task-panel')
const form = document.querySelector('#task-form')
const originSelect = document.querySelector('#origin')
const destinationSelect = document.querySelector('#destination')
const roleHomeLink = document.querySelector('#role-home')

if (roleHomeLink && window.location.port === '3001') {
  roleHomeLink.href = `${window.location.protocol}//${window.location.hostname}:5173/`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value))
}

async function request(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || '服务暂不可用，请稍后重试')
  return data
}

function setDeadlineDefault() {
  const value = new Date(Date.now() + 2 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value)
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  document.querySelector('#deadline').value = `${date.year}-${date.month}-${date.day}T${date.hour}:00`
}

function setDemoValues() {
  originSelect.value = '理科楼群'
  destinationSelect.value = '实验中心'
  document.querySelector('#item-category').value = 'experimental_material'
  document.querySelector('#weight').value = '2.5'
  document.querySelector('#priority').value = 'high'
  document.querySelector('#requirement').value = 'shockproof'
  document.querySelector('#agreement').checked = true
}

function renderPlaceOptions() {
  const options = state.places.map((place) => `<option value="${escapeHtml(place.name)}">${escapeHtml(place.name)}</option>`).join('')
  originSelect.innerHTML = options
  destinationSelect.innerHTML = options
  setDemoValues()
}

function statusClass(status) {
  if (['COMPLETED', 'ARRIVED'].includes(status)) return 'done'
  if (['PENDING_APPROVAL', 'AGENT_REVIEWED', 'APPROVED'].includes(status)) return 'waiting'
  return ''
}

function eventHtml(event) {
  return `<div class="timeline-item"><span class="dot"></span><div><div class="timeline-title">${escapeHtml(event.title)}</div><div>${escapeHtml(event.detail || '')}</div><div class="hint">${formatDate(event.created_at)}</div></div></div>`
}

function renderTask(task, events = []) {
  if (!task) {
    taskPanel.innerHTML = document.querySelector('#empty-task-template').innerHTML
    formPanel.hidden = false
    return
  }
  formPanel.hidden = true
  const route = task.route_summary
  const isWaiting = task.status === 'PENDING_APPROVAL'
  const submitButton = task.status === 'AGENT_REVIEWED'
    ? '<button id="submit-approval" class="primary-button" type="button">提交校方审核</button>'
    : ''
  const pickup = task.status === 'ARRIVED' && task.pickup_code
    ? `<div class="pickup"><div class="hint">接驳点取件码</div><div class="pickup-code">${escapeHtml(task.pickup_code)}</div><button id="pickup-button" class="primary-button" type="button">确认已取件</button></div>`
    : ''
  const provider = task.provider_display_name
    ? `<div class="mini-grid"><div class="metric"><span>执行运力</span><strong>${escapeHtml(task.provider_display_name)}</strong></div><div class="metric"><span>配送进度</span><strong>${task.telemetry?.progress_percent ?? 0}%</strong></div></div>`
    : ''
  taskPanel.innerHTML = `<div class="task-card">
    <div class="task-head"><div><span class="eyebrow">我的配送任务</span><h2>${escapeHtml(task.origin_text)} <span>→</span> ${escapeHtml(task.destination_text)}</h2><div class="request-no">${escapeHtml(task.request_no)}</div></div><span class="status ${statusClass(task.status)}">${escapeHtml(task.status_label)}</span></div>
    <div class="analysis">${escapeHtml(task.agent_summary || 'AI 正在分析运输需求。')}</div>
    ${route ? `<div class="route"><strong>校园推荐通道</strong><span>${route.total_length_meters ?? '—'} m · 约 ${route.duration_seconds ?? '—'} 秒</span></div>` : ''}
    <div class="mini-grid"><div class="metric"><span>物品</span><strong>${escapeHtml(task.item_category)} · ${task.weight_kg} kg</strong></div><div class="metric"><span>期望送达</span><strong>${formatDate(task.deadline)}</strong></div></div>
    ${provider}
    ${isWaiting ? '<p class="hint">任务已交由校方审核。页面会自动同步审核与配送进度。</p>' : ''}
    ${task.status === 'COMPLETED' ? '<p class="analysis success">本次配送已完成，感谢使用 SkyNest 校园低空配送服务。</p>' : ''}
    ${task.exception_reason ? `<p class="error">配送异常：${escapeHtml(task.exception_reason)}</p>` : ''}
    ${submitButton}${pickup}
    <div><span class="eyebrow">服务时间线</span><div class="timeline">${events.map(eventHtml).join('') || '<p class="hint">暂无状态记录</p>'}</div></div>
    <button id="new-task" class="secondary-button" type="button">发起新的演示任务</button>
  </div>`
  document.querySelector('#submit-approval')?.addEventListener('click', submitForApproval)
  document.querySelector('#pickup-button')?.addEventListener('click', confirmPickup)
  document.querySelector('#new-task')?.addEventListener('click', clearTask)
}

async function refreshTask() {
  if (!state.taskId) return renderTask(null)
  try {
    const [taskData, eventData] = await Promise.all([
      request(`/demo/tasks/${state.taskId}`),
      request(`/demo/tasks/${state.taskId}/events`),
    ])
    renderTask(taskData.task, eventData.events)
  } catch (error) {
    localStorage.removeItem(storageKey)
    state.taskId = null
    renderTask(null)
    showFormError(error.message)
  }
}

function showFormError(message) {
  form.querySelector('.error')?.remove()
  const error = document.createElement('p')
  error.className = 'error'
  error.textContent = message
  form.append(error)
}

async function createTask(event) {
  event.preventDefault()
  const button = document.querySelector('#create-task')
  if (originSelect.value === destinationSelect.value) return showFormError('起点与终点不能相同')
  button.disabled = true
  try {
    const requirement = document.querySelector('#requirement').value
    const data = await request('/demo/tasks', {
      method: 'POST',
      body: JSON.stringify({
        task: {
          origin_text: originSelect.value,
          destination_text: destinationSelect.value,
          item_category: document.querySelector('#item-category').value,
          weight_kg: Number(document.querySelector('#weight').value),
          deadline: document.querySelector('#deadline').value,
          priority: document.querySelector('#priority').value,
          special_requirements: requirement ? [requirement] : [],
        },
        requester: {
          role: 'student', org: '理科楼群实验室',
          contact_name: document.querySelector('#contact-name').value,
          contact_phone: document.querySelector('#contact-phone').value,
        },
      }),
    })
    state.taskId = data.task.id
    localStorage.setItem(storageKey, state.taskId)
    await refreshTask()
  } catch (error) {
    showFormError(error.message)
  } finally {
    button.disabled = false
  }
}

async function submitForApproval() {
  const button = document.querySelector('#submit-approval')
  button.disabled = true
  try { await request(`/demo/tasks/${state.taskId}/submit`, { method: 'POST', body: '{}' }); await refreshTask() }
  catch (error) { alert(error.message); button.disabled = false }
}

async function confirmPickup() {
  const button = document.querySelector('#pickup-button')
  button.disabled = true
  try {
    const taskData = await request(`/demo/tasks/${state.taskId}`)
    await request(`/demo/tasks/${state.taskId}/pickup`, { method: 'POST', body: JSON.stringify({ pickup_code: taskData.task.pickup_code }) })
    await refreshTask()
  } catch (error) { alert(error.message); button.disabled = false }
}

function clearTask() {
  state.taskId = null
  localStorage.removeItem(storageKey)
  renderTask(null)
}

async function initialize() {
  setDeadlineDefault()
  try {
    const data = await request('/places')
    state.places = Array.isArray(data) ? data : data.places || []
    renderPlaceOptions()
  } catch (error) {
    showFormError(`无法加载校园节点：${error.message}`)
  }
  form.addEventListener('submit', createTask)
  document.querySelector('#show-demo-values').addEventListener('click', setDemoValues)
  await refreshTask()
  state.polling = window.setInterval(refreshTask, 5000)
}

initialize()
