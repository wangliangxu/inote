// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { loadUserSettings } from '../shared/api'
import { demoNotes } from '../shared/fixtures'
import type { Note, UserSettings } from '../shared/types'
import { isMacPlatform } from './shortcuts'

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
  await waitFor(() => expect(screen.getByText('status.demoLoaded')).toBeTruthy())
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

  it.each(['app.cardView', 'app.summaryView'])('highlights matching titles and body context in %s', async (mode) => {
    await openWorkspace()
    fireEvent.click(screen.getByRole('button', { name: mode }))
    const input = screen.getByRole('textbox', { name: 'app.searchPlaceholder' })
    fireEvent.change(input, { target: { value: 'Tauri' } })
    const result = screen.getByRole('button', { name: /Tauri Architecture Notes/ })
    expect(result.querySelector('strong mark')?.textContent).toBe('Tauri')
    fireEvent.change(input, { target: { value: 'vault' } })
    const bodyResult = screen.getByRole('button', { name: /Tauri Architecture Notes/ })
    expect(bodyResult.querySelector('small mark')?.textContent).toBe('vault')
    fireEvent.click(screen.getByRole('button', { name: 'app.clearSearch' }))
    expect(document.querySelector('.note-list mark')).toBeNull()
  })

  it('shows highlighted matching tags when the title and summary do not match', async () => {
    await openWorkspace()
    fireEvent.change(screen.getByRole('textbox', { name: 'app.searchPlaceholder' }), { target: { value: '#desk' } })
    const result = screen.getByRole('button', { name: /Tauri Architecture Notes/ })
    expect(result.querySelector('.search-match-metadata')?.textContent).toContain('#desktop')
    expect(result.querySelector('.search-match-metadata mark')?.textContent).toBe('desk')
  })

  it('returns to all notes and the original selection on repeated Todo toggles', async () => {
    await openWorkspace()
    for (let cycle = 0; cycle < 2; cycle += 1) {
      expect(ordinaryNote()).toBeTruthy()
      clickView('app.todo')
      await screen.findByText('todo.title')
      expect(ordinaryNote()).toBeNull()
      clickView('app.todo')
      expect(ordinaryNote()).toBeTruthy()
      expect(screen.queryByText('todo.title')).toBeNull()
      expect((await screen.findByTestId('editor')).textContent).toBe(demoNotes[0].path)
    }
  })

  it.each(['app.calendar', 'app.archive', 'app.trash'])(
    'returns to all notes after switching from Todo through %s', async (specialView) => {
      await openWorkspace()
      clickView('app.todo')
      clickView(specialView)
      clickView('app.todo')
      await screen.findByText('todo.title')
      clickView('app.todo')
      expect(ordinaryNote()).toBeTruthy()
      expect(screen.queryByText('todo.title')).toBeNull()
      expect((await screen.findByTestId('editor')).textContent).toBe(demoNotes[0].path)
    },
  )

  it('uses all notes as the return view when restarting in Todo mode', async () => {
    await openWorkspace('todo')
    expect(ordinaryNote()).toBeNull()
    clickView('app.todo')
    expect(ordinaryNote()).toBeTruthy()
    expect(screen.getByText('app.allCategories', { selector: 'summary' })).toBeTruthy()
    expect(screen.queryByText('todo.title')).toBeNull()
    expect(screen.queryByTestId('editor')).toBeNull()
  })

  it('restores an empty selection after opening a task in Todo mode', async () => {
    await openWorkspace('todo')
    clickView('app.todo')
    clickView('app.todo')
    await screen.findByText('todo.title')
    fireEvent.click(screen.getByText(demoNotes[0].title, { selector: '.todo-card h4' }))
    expect((await screen.findByTestId('editor')).textContent).toBe(demoNotes[0].path)
    clickView('app.todo')
    expect(ordinaryNote()).toBeTruthy()
    expect(screen.queryByTestId('editor')).toBeNull()
  })
})

describe('workspace interactions', () => {
  const mod = () => (isMacPlatform() ? { metaKey: true } : { ctrlKey: true })

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

  it('opens a note context menu whose file actions need a real vault', async () => {
    await openWorkspace()
    const card = screen.getByRole('button', { name: new RegExp(demoNotes[1].title) })
    fireEvent.contextMenu(card)
    const menu = screen.getByRole('menu')
    expect(menu).toBeTruthy()
    expect((screen.getByRole('menuitem', { name: /menu.moveToTrash/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('menuitem', { name: 'menu.open' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.open' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect((await screen.findByTestId('editor')).textContent).toBe(demoNotes[1].path)
  })

  it('opens the command palette with the keyboard and runs a command', async () => {
    await openWorkspace()
    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', ...mod() })
    const input = await screen.findByRole('combobox', { name: '' })
    fireEvent.change(input, { target: { value: 'app.calendar' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByTestId('calendar')).toBeTruthy()
  })

  it('turns typed filters into removable chips', async () => {
    await openWorkspace()
    const input = screen.getByRole('textbox', { name: 'app.searchPlaceholder' })
    fireEvent.change(input, { target: { value: '#desktop ' } })
    expect(screen.getByRole('button', { name: 'search.removeFilter' })).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: /Tauri Architecture Notes/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Quick Thought/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'search.removeFilter' }))
    expect(screen.getByRole('button', { name: /Quick Thought/ })).toBeTruthy()
  })

  it('enters and leaves focus mode', async () => {
    await openWorkspace()
    await screen.findByTestId('editor')
    expect(document.querySelector('.status-bar')).toBeTruthy()
    fireEvent.keyDown(window, { code: 'Enter', key: 'Enter', shiftKey: true, ...mod() })
    expect(await screen.findByRole('button', { name: /focus.exit/ })).toBeTruthy()
    expect(document.querySelector('.status-bar')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.status-bar')).toBeTruthy())
  })
})
