export const TASK_DATA_CHANGED_EVENT = 'skynest-task-data-changed'

const CHANNEL_NAME = 'skynest-task-sync-v1'
const STORAGE_SIGNAL_KEY = 'skynest-task-sync-signal-v1'
const seenMessageIds = new Set()

function rememberMessage(messageId) {
  if (!messageId || seenMessageIds.has(messageId)) return false
  seenMessageIds.add(messageId)
  if (seenMessageIds.size > 100) {
    const oldestMessageId = seenMessageIds.values().next().value
    seenMessageIds.delete(oldestMessageId)
  }
  return true
}

function dispatchRemoteChange(payload) {
  if (!payload || !rememberMessage(payload.message_id)) return
  globalThis.dispatchEvent(new CustomEvent(TASK_DATA_CHANGED_EVENT, { detail: payload }))
}

let channel = null

if (typeof globalThis.addEventListener === 'function') {
  if (typeof globalThis.BroadcastChannel === 'function') {
    channel = new globalThis.BroadcastChannel(CHANNEL_NAME)
    channel.addEventListener('message', (event) => dispatchRemoteChange(event.data))
  }

  globalThis.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_SIGNAL_KEY || !event.newValue) return
    try {
      dispatchRemoteChange(JSON.parse(event.newValue))
    } catch {
      // Ignore malformed or stale synchronization signals.
    }
  })
}

export function notifyTaskDataChanged(detail = {}) {
  const payload = {
    ...detail,
    message_id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    changed_at: new Date().toISOString(),
  }

  channel?.postMessage(payload)

  try {
    globalThis.localStorage?.setItem(STORAGE_SIGNAL_KEY, JSON.stringify(payload))
  } catch {
    // Polling remains the fallback when browser storage is unavailable.
  }
}
