import { useEffect, useSyncExternalStore } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getReminderConflicts, getReminderError, getReminderSettingsSnapshot, loadReminderSettings, subscribeReminders, syncReminders } from './reminders'

export function useReminderSync(vaultRoot: string, autoSync = true) {
  const config = useSyncExternalStore(subscribeReminders, getReminderSettingsSnapshot)
  const error = useSyncExternalStore(subscribeReminders, () => getReminderError(vaultRoot))
  const conflicts = useSyncExternalStore(subscribeReminders, () => getReminderConflicts(vaultRoot))
  useEffect(() => { void loadReminderSettings().catch(() => undefined) }, [])
  useEffect(() => {
    if (!autoSync || !config.supported || !config.enabled || !vaultRoot) return
    let disposed = false
    let running = false
    let pending = false
    let initial = true
    let timeout: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (disposed) return
      pending = true
      clearTimeout(timeout)
      timeout = setTimeout(() => { void run() }, 500)
    }
    const run = async () => {
      if (disposed || running) return
      running = true; pending = false
      try {
        const first = initial; initial = false
        if (first) await syncReminders(vaultRoot)
        else await syncReminders(vaultRoot, true)
      } finally { running = false; if (pending && !disposed) schedule() }
    }
    const subscription = listen('reminders://changed', schedule)
    subscription.catch(() => undefined)
    window.addEventListener('focus', schedule)
    // Recover missed notifications after sleep, reconnects, or background throttling.
    const interval = setInterval(schedule, 30_000)
    void run()
    return () => {
      disposed = true
      clearTimeout(timeout); clearInterval(interval)
      window.removeEventListener('focus', schedule)
      subscription.then((unlisten) => unlisten()).catch(() => undefined)
    }
  }, [autoSync, vaultRoot, config.supported, config.enabled, config.calendarId])
  return { config, error, conflicts }
}
