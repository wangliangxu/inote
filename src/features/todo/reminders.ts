import { invoke, isTauri } from '@tauri-apps/api/core'
import type { Note } from '../../shared/types'

export interface ReminderSettings { supported: boolean; enabled: boolean; calendarId: string }
export interface ReminderCalendar { id: string; title: string; source: string }
export interface ReminderConnection { calendars: ReminderCalendar[]; defaultCalendarId: string }
export interface ReminderFields { due: string | null; completed: boolean }
export interface ReminderConflict {
  path: string; fields: string[]; local: ReminderFields; localRevision: string
  remote: ReminderFields & { identifier: string; modifiedAt: number }
}
export interface ReminderReport { updated: number; errors: string[]; conflicts?: ReminderConflict[]; notes?: Note[] }
export const reminderTimings = ['at_due', '10_minutes', '1_day', 'none'] as const
export type ReminderTiming = typeof reminderTimings[number]

let config: ReminderSettings = { supported: false, enabled: false, calendarId: '' }
const listeners = new Set<() => void>()
const errors = new Map<string, Map<string, string>>()
const snapshots = new Map<string, string>()
const conflictSnapshots = new Map<string, readonly ReminderConflict[]>()
const noConflicts: readonly ReminderConflict[] = []
let loading: Promise<ReminderSettings> | undefined
const fullSyncs = new Map<string, { promise: Promise<void>; linkedOnly: boolean }>()
export const subscribeReminders = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getReminderSettingsSnapshot = () => config
export const getReminderError = (root: string) => snapshots.get(root) ?? ''
export const getReminderConflicts = (root: string) => conflictSnapshots.get(root) ?? noConflicts
const emit = () => listeners.forEach((listener) => listener())

function record(root: string, key: string, messages: string[], conflicts: ReminderConflict[] = []) {
  conflictSnapshots.set(root, [...(key === '*' ? [] : getReminderConflicts(root).filter((conflict) => conflict.path !== key)), ...conflicts])
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
  if (!saved.enabled) { errors.clear(); snapshots.clear(); conflictSnapshots.clear() }
  loading = Promise.resolve(saved)
  emit()
  return saved
}

export function syncReminders(root: string, linkedOnly = false): Promise<void> {
  if (!isTauri() || !root) return Promise.resolve()
  const running = fullSyncs.get(root)
  if (running) return !linkedOnly && running.linkedOnly ? running.promise.then(() => syncReminders(root)) : running.promise
  const sync = (async () => {
    try {
      const report = await invoke<ReminderReport>('sync_reminders', { vaultRoot: root, ...(linkedOnly ? { linkedOnly: true } : {}) })
      record(root, '*', report.errors, report.conflicts)
    } catch (error) { record(root, '*', [String(error)]) }
  })().finally(() => { fullSyncs.delete(root) })
  fullSyncs.set(root, { promise: sync, linkedOnly })
  return sync
}

/** A system sync failure must never reject a successfully persisted note. */
export async function syncCommittedReminder(root: string, oldPath: string, path: string | null): Promise<Note | undefined> {
  if (!isTauri() || !root) return
  try {
    const report = await invoke<ReminderReport>('sync_note_reminder', { vaultRoot: root, oldPath, path })
    record(root, oldPath, report.errors, report.conflicts)
    return report.notes?.find((note) => note.path === path)
  } catch (error) { record(root, oldPath, [String(error)]) }
}

export async function resolveReminderConflict(root: string, conflict: ReminderConflict, choice: 'local' | 'remote'): Promise<void> {
  try {
    const report = await invoke<ReminderReport>('resolve_reminder_conflict', { vaultRoot: root, resolution: { conflict, choice } })
    record(root, conflict.path, report.errors, report.conflicts)
  } catch (error) {
    record(root, conflict.path, [String(error)], [conflict])
    throw error
  }
}
