// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  config: { supported: true, enabled: true, calendarId: 'list' },
  load: vi.fn(async () => undefined), sync: vi.fn(async () => undefined),
}))
vi.mock('./reminders', () => ({
  subscribeReminders: () => () => undefined,
  getReminderSettingsSnapshot: () => mocks.config,
  getReminderError: () => '',
  loadReminderSettings: mocks.load,
  syncReminders: mocks.sync,
}))
import { useReminderSync } from './useReminderSync'

beforeEach(() => { vi.clearAllMocks(); mocks.config = { supported: true, enabled: true, calendarId: 'list' } })
afterEach(cleanup)

describe('automatic reminder reconciliation', () => {
  it('waits for workspace restoration and syncs only when the vault changes', () => {
    const { rerender } = renderHook(({ root, ready }) => useReminderSync(root, ready), { initialProps: { root: '/notes', ready: false } })
    expect(mocks.sync).not.toHaveBeenCalled()
    rerender({ root: '/notes', ready: true })
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith('/notes')
    rerender({ root: '/notes', ready: true })
    expect(mocks.sync).toHaveBeenCalledTimes(1)
    rerender({ root: '/other', ready: true })
    expect(mocks.sync).toHaveBeenLastCalledWith('/other')
  })
  it('does not reconcile when a settings-only observer mounts', () => {
    renderHook(() => useReminderSync('/notes', false))
    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(mocks.sync).not.toHaveBeenCalled()
  })
  it('does not invoke native sync while disabled or on unsupported platforms', () => {
    mocks.config = { supported: false, enabled: true, calendarId: 'list' }
    const { rerender } = renderHook(() => useReminderSync('/notes'))
    expect(mocks.sync).not.toHaveBeenCalled()
    mocks.config = { supported: true, enabled: false, calendarId: 'list' }
    rerender()
    expect(mocks.sync).not.toHaveBeenCalled()
  })
})
