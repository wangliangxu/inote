// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIndexedSearch } from './useIndexedSearch'
import { searchIndex } from '../shared/api'
import type { SearchResult } from '../shared/types'

vi.mock('../shared/api', () => ({ searchIndex: vi.fn() }))
describe('indexed search behavior', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(searchIndex).mockReset() })
  afterEach(() => { cleanup(); vi.useRealTimers() })
  it('debounces typing and searches only the latest query', async () => {
    vi.mocked(searchIndex).mockResolvedValue([])
    const onError = vi.fn()
    const hook = renderHook(({ query }) => useIndexedSearch('/vault', query, 0, onError), { initialProps: { query: 'r' } })
    act(() => { vi.advanceTimersByTime(100) })
    hook.rerender({ query: 'rust' })
    act(() => { vi.advanceTimersByTime(199) })
    expect(searchIndex).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(searchIndex).toHaveBeenCalledOnce()
    expect(searchIndex).toHaveBeenCalledWith({ vaultRoot: '/vault', query: 'rust' })
  })
  it('ignores old responses and refreshes the query when the index changes', async () => {
    let finish!: (results: SearchResult[]) => void
    vi.mocked(searchIndex).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValue([])
    const onError = vi.fn()
    const hook = renderHook(({ query, version }) => useIndexedSearch('/vault', query, version, onError), { initialProps: { query: 'old', version: 0 } })
    await act(async () => { vi.advanceTimersByTime(200) })
    hook.rerender({ query: 'new', version: 0 })
    await act(async () => { finish([{ path: 'old.md' } as SearchResult]); vi.advanceTimersByTime(200) })
    expect(hook.result.current[0]).toEqual([])
    hook.rerender({ query: 'new', version: 1 })
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(searchIndex).toHaveBeenCalledTimes(3)
  })
})
