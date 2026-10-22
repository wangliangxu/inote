// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import { useVaultSync } from './useVaultSync'
import { useNoteWorkspace } from './useNoteWorkspace'
import { createSerialQueue } from '../shared/notePersistence'
import { demoNotes } from '../shared/fixtures'
import * as api from '../shared/api'
import { listen } from '@tauri-apps/api/event'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../shared/api', () => ({ allowVaultAssets: vi.fn(), migrateNoteImages: vi.fn(), readNote: vi.fn(), refreshVaultPaths: vi.fn(), saveNoteDrafts: vi.fn(), startVaultWatcher: vi.fn(), stopVaultWatcher: vi.fn() }))

describe('vault synchronization behavior', () => {
  let notify: (event: { payload: { paths: string[] } }) => void
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(listen).mockImplementation(async (_event, listener) => { notify = listener as typeof notify; return vi.fn() })
    vi.mocked(api.allowVaultAssets).mockResolvedValue()
    vi.mocked(api.startVaultWatcher).mockResolvedValue()
    vi.mocked(api.stopVaultWatcher).mockResolvedValue()
    vi.mocked(api.saveNoteDrafts).mockResolvedValue()
  })
  afterEach(cleanup)
  it('keeps an edited body when a watcher response arrives and sends the changed paths', async () => {
    const draft = { ...demoNotes[0], isDirty: true, body: 'local draft' }
    vi.mocked(api.refreshVaultPaths).mockResolvedValue({ notes: [{ ...demoNotes[0], body: '', bodyLoaded: false, sourceRevision: 'external' }], removedPaths: [] })
    const hook = renderHook(() => {
      const workspace = useNoteWorkspace([draft], '/vault')
      const loadedRoot = useRef('/vault')
      const queue = useRef(createSerialQueue())
      const [, setLinkVersion] = useState(0)
      const [, setStatus] = useState('')
      useVaultSync({ ...workspace, loadedRoot, queue, vaultRoot: '/vault', settingsLoaded: true, setLinkVersion, setStatus })
      return workspace
    })
    await waitFor(() => expect(api.startVaultWatcher).toHaveBeenCalledOnce())
    await act(async () => { notify({ payload: { paths: ['/vault/changed.md'] } }) })
    expect(api.refreshVaultPaths).toHaveBeenCalledWith('/vault', ['/vault/changed.md'])
    expect(hook.result.current.notes[0].body).toBe('local draft')
    expect(hook.result.current.notes[0].isDirty).toBe(true)
  })
  it('ignores an active-note read after the user switches notes', async () => {
    let finish!: (note: typeof demoNotes[number]) => void
    vi.mocked(api.readNote).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValue(demoNotes[1])
    const hook = renderHook(({ path }) => {
      const workspace = useNoteWorkspace(demoNotes.slice(0, 2).map((note) => ({ ...note, body: '', bodyLoaded: false })), '/vault')
      const loadedRoot = useRef('/vault')
      const queue = useRef(createSerialQueue())
      const [, setLinkVersion] = useState(0)
      const [, setStatus] = useState('')
      useVaultSync({ ...workspace, activeNote: workspace.notes.find((note) => note.path === path), loadedRoot, queue, vaultRoot: '/vault', settingsLoaded: true, setLinkVersion, setStatus })
      return workspace
    }, { initialProps: { path: demoNotes[0].path } })
    hook.rerender({ path: demoNotes[1].path })
    await act(async () => { finish(demoNotes[0]) })
    expect(hook.result.current.notes[0].bodyLoaded).toBe(false)
    expect(hook.result.current.notes[1].body).toBe(demoNotes[1].body)
  })
})
