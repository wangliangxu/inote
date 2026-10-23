// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  config: { supported: true, enabled: true, calendarId: 'list' },
  load: vi.fn(async () => undefined), sync: vi.fn(async () => undefined),
  listen: vi.fn(), unlisten: vi.fn(), callback: undefined as undefined | (() => void),
  conflicts: [] as unknown[],
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('./reminders', () => ({
  subscribeReminders: () => () => undefined,
  getReminderSettingsSnapshot: () => mocks.config,
  getReminderError: () => '',
  getReminderConflicts: () => mocks.conflicts,
  loadReminderSettings: mocks.load,
  syncReminders: mocks.sync,
}))
import { useReminderSync } from './useReminderSync'

beforeEach(() => {
  mocks.listen.mockImplementation(async (_event: string, callback: () => void) => { mocks.callback = callback; return mocks.unlisten })
  vi.clearAllMocks(); mocks.config = { supported: true, enabled: true, calendarId: 'list' } })
afterEach(() => { cleanup(); vi.useRealTimers() })

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
  it('debounces system notifications and stops listening after unmount', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useReminderSync('/notes'))
    await act(async () => { await Promise.resolve() })
    expect(mocks.listen).toHaveBeenCalledWith('reminders://changed', expect.any(Function))
    act(() => { mocks.callback?.(); mocks.callback?.() })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.sync).toHaveBeenCalledTimes(2)
    unmount()
    await act(async () => { await Promise.resolve() })
    expect(mocks.unlisten).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('checks again on focus and periodically after missed system events', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useReminderSync('/notes'))
    await act(async () => { await Promise.resolve() })
    act(() => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.sync).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(mocks.sync).toHaveBeenCalledTimes(3)
    unmount()
  })

})
