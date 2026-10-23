import { invoke, isTauri } from '@tauri-apps/api/core'

export interface ReminderSettings { supported: boolean; enabled: boolean; calendarId: string }
export interface ReminderCalendar { id: string; title: string; source: string }
export interface ReminderConnection { calendars: ReminderCalendar[]; defaultCalendarId: string }
export interface ReminderReport { updated: number; errors: string[] }
export const reminderTimings = ['at_due', '10_minutes', '1_day', 'none'] as const
export type ReminderTiming = typeof reminderTimings[number]

let config: ReminderSettings = { supported: false, enabled: false, calendarId: '' }
const listeners = new Set<() => void>()
const errors = new Map<string, Map<string, string>>()
const snapshots = new Map<string, string>()
let loading: Promise<ReminderSettings> | undefined
const fullSyncs = new Map<string, Promise<void>>()
export const subscribeReminders = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getReminderSettingsSnapshot = () => config
export const getReminderError = (root: string) => snapshots.get(root) ?? ''
const emit = () => listeners.forEach((listener) => listener())

function record(root: string, key: string, messages: string[]) {
  const current = errors.get(root) ?? new Map<string, string>()
  if (key === '*') current.clear()
  if (messages.length) current.set(key, messages.join('\n'))
  else current.delete(key)
  errors.set(root, current)
  snapshots.set(root, [...current.values()].join('\n'))
  emit()
}

export function loadReminderSettings(): Promise<ReminderSettings> {
  if (!isTauri()) return Promise.resolve(config)
  if (!loading) loading = invoke<ReminderSettings>('get_reminders_settings').then((saved) => { config = saved; emit(); return saved }).catch((error) => { loading = undefined; throw error })
  return loading
}

export async function connectReminders(): Promise<ReminderConnection> {
  return invoke('connect_reminders')
}

export async function configureReminders(enabled: boolean, calendarId: string): Promise<ReminderSettings> {
  const saved = await invoke<ReminderSettings>('configure_reminders', { enabled, calendarId })
  config = saved
  if (!saved.enabled) { errors.clear(); snapshots.clear() }
  loading = Promise.resolve(saved)
  emit()
  return saved
}

export function syncReminders(root: string): Promise<void> {
  if (!isTauri() || !root) return Promise.resolve()
  const running = fullSyncs.get(root)
  if (running) return running
  const sync = (async () => {
    try {
      const report = await invoke<ReminderReport>('sync_reminders', { vaultRoot: root })
      record(root, '*', report.errors)
    } catch (error) { record(root, '*', [String(error)]) }
  })().finally(() => { fullSyncs.delete(root) })
  fullSyncs.set(root, sync)
  return sync
}

/** A system sync failure must never reject a successfully persisted note. */
export async function syncCommittedReminder(root: string, oldPath: string, path: string | null): Promise<void> {
  if (!isTauri() || !root) return
  try {
    const report = await invoke<ReminderReport>('sync_note_reminder', { vaultRoot: root, oldPath, path })
    record(root, oldPath, report.errors)
  } catch (error) { record(root, oldPath, [String(error)]) }
}
