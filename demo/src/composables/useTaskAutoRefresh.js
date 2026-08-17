import { onBeforeUnmount, onMounted } from 'vue'
import { TASK_DATA_CHANGED_EVENT } from '../services/taskSync'

export const TASK_AUTO_REFRESH_INTERVAL_MS = 5000

export function useTaskAutoRefresh(refresh, options = {}) {
  const intervalMs = Number(options.intervalMs) || TASK_AUTO_REFRESH_INTERVAL_MS
  let timer = null
  let refreshing = false
  let refreshQueued = false
  let stopped = false

  async function runRefresh() {
    if (stopped || globalThis.document?.hidden) return
    if (refreshing) {
      refreshQueued = true
      return
    }

    refreshing = true
    try {
      await refresh({ quiet: true })
    } finally {
      refreshing = false
      if (refreshQueued && !stopped) {
        refreshQueued = false
        queueMicrotask(runRefresh)
      }
    }
  }

  function handleVisibilityChange() {
    if (!globalThis.document?.hidden) runRefresh()
  }

  onMounted(() => {
    stopped = false
    timer = globalThis.setInterval(runRefresh, intervalMs)
    globalThis.addEventListener(TASK_DATA_CHANGED_EVENT, runRefresh)
    globalThis.addEventListener('focus', runRefresh)
    globalThis.addEventListener('online', runRefresh)
    globalThis.document?.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onBeforeUnmount(() => {
    stopped = true
    globalThis.clearInterval(timer)
    globalThis.removeEventListener(TASK_DATA_CHANGED_EVENT, runRefresh)
    globalThis.removeEventListener('focus', runRefresh)
    globalThis.removeEventListener('online', runRefresh)
    globalThis.document?.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return { refreshNow: runRefresh }
}
