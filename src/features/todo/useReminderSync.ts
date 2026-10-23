import { useEffect, useSyncExternalStore } from 'react'
import { getReminderError, getReminderSettingsSnapshot, loadReminderSettings, subscribeReminders, syncReminders } from './reminders'

export function useReminderSync(vaultRoot: string, autoSync = true) {
  const config = useSyncExternalStore(subscribeReminders, getReminderSettingsSnapshot)
  const error = useSyncExternalStore(subscribeReminders, () => getReminderError(vaultRoot))
  useEffect(() => { void loadReminderSettings().catch(() => undefined) }, [])
  useEffect(() => {
    if (!autoSync || !config.supported || !config.enabled || !vaultRoot) return
    // Reconcile committed disk tasks on startup, vault/list changes, and after enabling.
    void syncReminders(vaultRoot)
  }, [autoSync, vaultRoot, config.supported, config.enabled, config.calendarId])
  return { config, error }
}
