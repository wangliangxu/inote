// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { loadUserSettings } from '../shared/api'
import { demoNotes } from '../shared/fixtures'
import type { Note, UserSettings } from '../shared/types'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../shared/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../shared/api')>(),
  loadUserSettings: vi.fn(),
  getSetting: vi.fn(async () => null),
  saveUserSettings: vi.fn(async () => undefined),
}))
vi.mock('../shared/fixtures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/fixtures')>()
  return { demoNotes: actual.demoNotes.map((note, index) => index === 0 ? { ...note, status: 'todo' } : note) }
})
vi.mock('../features/editor/Editor', () => ({
  Editor: ({ note }: { note: Note }) => <div data-testid="editor">{note.path}</div>,
}))
vi.mock('../features/calendar/CalendarView', () => ({
  CalendarView: () => <div data-testid="calendar">Calendar</div>,
}))

function clickView(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function ordinaryNote() {
  return screen.queryByRole('button', { name: new RegExp(demoNotes[1].title) })
}

async function openWorkspace(activeView: UserSettings['activeView'] = 'search') {
  vi.mocked(loadUserSettings).mockResolvedValue({
    vaultRoot: '', activePath: '', activeView, activeCategory: 'journal',
    selectedSearchCategories: [], rightSidebarVisible: false,
    llmSettings: { providerName: 'test', apiBaseUrl: '', apiKey: '', model: '' },
  })
  render(<App />)
  await waitFor(() => expect(screen.getByText('Demo vault loaded. Enter a local path in Settings to open real notes.')).toBeTruthy())
}

describe('workspace view navigation', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('returns to all notes and the original selection on repeated Todo toggles', async () => {
    await openWorkspace()
    for (let cycle = 0; cycle < 2; cycle += 1) {
      expect(ordinaryNote()).toBeTruthy()
      clickView('Toggle Todo List')
      await screen.findByText('todo.title')
      expect(ordinaryNote()).toBeNull()
      clickView('Toggle Todo List')
      expect(ordinaryNote()).toBeTruthy()
      expect(screen.queryByText('todo.title')).toBeNull()
      expect((await screen.findByTestId('editor')).textContent).toBe(demoNotes[0].path)
    }
  })

  it.each(['app.calendar', 'app.archive', 'app.trash'])(
    'returns to all notes after switching from Todo through %s', async (specialView) => {
      await openWorkspace()
      clickView('Toggle Todo List')
      clickView(specialView)
      clickView('Toggle Todo List')
      await screen.findByText('todo.title')
      clickView('Toggle Todo List')
      expect(ordinaryNote()).toBeTruthy()
      expect(screen.queryByText('todo.title')).toBeNull()
      expect((await screen.findByTestId('editor')).textContent).toBe(demoNotes[0].path)
    },
  )

  it('uses all notes as the return view when restarting in Todo mode', async () => {
    await openWorkspace('todo')
    expect(ordinaryNote()).toBeNull()
    clickView('Toggle Todo List')
    expect(ordinaryNote()).toBeTruthy()
    expect(screen.getByText('app.allCategories', { selector: 'summary' })).toBeTruthy()
    expect(screen.queryByText('todo.title')).toBeNull()
    expect(screen.queryByTestId('editor')).toBeNull()
  })

  it('restores an empty selection after opening a task in Todo mode', async () => {
    await openWorkspace('todo')
    clickView('Toggle Todo List')
    clickView('Toggle Todo List')
    await screen.findByText('todo.title')
    fireEvent.click(screen.getByText(demoNotes[0].title, { selector: '.todo-card h4' }))
    expect((await screen.findByTestId('editor')).textContent).toBe(demoNotes[0].path)
    clickView('Toggle Todo List')
    expect(ordinaryNote()).toBeTruthy()
    expect(screen.queryByTestId('editor')).toBeNull()
  })
})
