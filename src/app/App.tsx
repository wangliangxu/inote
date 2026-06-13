import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog'
import {
  Archive,
  Bot,
  CalendarDays,
  Check,
  FileMinus2,
  FilePlus2,
  FolderPlus,
  FolderTree,
  Eye,
  LayoutGrid,
  Link2,
  List,
  MoveRight,
  PanelLeft,
  PanelRight,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Tags,
  Trash2,
} from 'lucide-react'
const CalendarView = lazy(() => import('../features/calendar/CalendarView').then(m => ({ default: m.CalendarView })))
import { Editor } from '../features/editor/Editor'
const LlmAssistant = lazy(() => import('../features/llm/LlmAssistant').then(m => ({ default: m.LlmAssistant })))
const SettingsPanel = lazy(() => import('../features/settings/SettingsPanel').then(m => ({ default: m.SettingsPanel })))
const TagsPanel = lazy(() => import('../features/tags/TagsPanel').then(m => ({ default: m.TagsPanel })))
import { demoNotes } from '../shared/fixtures'
import { getEffectiveTheme, readStoredThemePreference, THEME_PREFERENCE_KEY, type ThemePreference } from '../shared/theme'
import type { LlmProviderSettings, Note, NoteLinks, SaveState, SearchResult, WorkspaceView } from '../shared/types'
import {
  archiveNote,
  createFolder,
  createInboxNote,
  createMonthlyReview,
  createNote,
  createTodayNote,
  createWeeklyReview,
  deleteNote,
  getNoteLinks,
  initializeVault,
  moveNote,
  noteToMarkdown,
  readNote,
  rebuildSearchIndex,
  loadUserSettings,
  saveUserSettings,
  scanVault,
  scanVaultAndRebuildIndex,
  searchIndex,
  writeNote,
  startVaultWatcher,
  stopVaultWatcher,
  parseMarkdownWithFrontmatter,
} from '../shared/api'
import { filterNotesByCategory, getTodayNote, groupByCategory, searchNotes, sortByUpdatedDesc } from '../shared/vault'
import { createInitialWorkspaceState, LAST_ACTIVE_PATH_KEY, LAST_VAULT_KEY } from './startup'

async function safeConfirm(message: string): Promise<boolean> {
  if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI_IPC__' in window)) {
    try {
      return await tauriConfirm(message)
    } catch {
      // Fallback if plugin fails
    }
  }
  return window.confirm(message)
}

const LLM_SETTINGS_KEY = 'inote.llmSettings'
const BASE_FONT_SIZE_KEY = 'inote.baseFontSize'
const OPEN_SETTINGS_EVENT = 'inote://open-settings'

const defaultLlmSettings: LlmProviderSettings = {
  providerName: 'OpenAI compatible',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
}

const excerptCache = new WeakMap<Note | SearchResult, string>()

function noteExcerpt(note: Note | SearchResult): string {
  const cached = excerptCache.get(note)
  if (cached !== undefined) return cached
  const excerpt = 'excerpt' in note ? note.excerpt : (note.summary ?? note.body.replace(/^# .*\n?/, '').trim().slice(0, 96))
  const result = stripMarkdownForSummary(excerpt)
  excerptCache.set(note, result)
  return result
}

const NOTES_PAGE_SIZE = 60

interface NoteItemProps {
  note: Note | SearchResult
  isActive: boolean
  onSelect: (path: string) => void
  onDelete: (path: string) => void
}

const NoteCardItem = memo(function NoteCardItem({ note, isActive, onSelect, onDelete }: NoteItemProps) {
  return (
    <div className={isActive ? 'note-card active' : 'note-card'}>
      <button className="note-card-select" type="button" onClick={() => onSelect(note.path)}>
        <strong>{note.title}</strong>
        <small>{noteExcerpt(note)}</small>
        <time>{note.updatedAt}</time>
      </button>
      <button
        className="note-delete-action"
        type="button"
        title="Move note to trash"
        aria-label="Move note to trash"
        onClick={(event) => {
          event.stopPropagation()
          onDelete(note.path)
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
})

const NoteRowItem = memo(function NoteRowItem({ note, isActive, onSelect, onDelete }: NoteItemProps) {
  return (
    <div className={isActive ? 'note-row active' : 'note-row'}>
      <button className="note-row-select" type="button" onClick={() => onSelect(note.path)}>
        <strong>{note.title}</strong>
        <small>{noteExcerpt(note)}</small>
        <time>{note.updatedAt}</time>
      </button>
      <button
        className="note-delete-action"
        type="button"
        title="Move note to trash"
        aria-label="Move note to trash"
        onClick={(event) => {
          event.stopPropagation()
          onDelete(note.path)
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
})

function stripMarkdownForSummary(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function localDateString(date = new Date()): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

function getFilenameForTitle(title: string) {
  const trimmed = title.trim()
  if (/[^\x00-\x7F]/.test(trimmed)) {
    let sanitized = trimmed.replace(/[\\/:\*\?"<>\|]/g, '-')
    sanitized = sanitized.replace(/^[ -]+|[ -]+$/g, '')
    return sanitized || 'note'
  } else {
    let slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    slug = slug.replace(/^-|-$/g, '')
    return slug || 'note'
  }
}

export function App() {
  const initialWorkspace = useMemo(
    () => createInitialWorkspaceState(typeof window === 'undefined' ? undefined : window.localStorage),
    [],
  )
  const [notes, setNotes] = useState<Note[]>(initialWorkspace.notes)
  const [activeView, setActiveView] = useState<WorkspaceView>('today')
  const [activeCategory, setActiveCategory] = useState('journal')
  const [activeTag, setActiveTag] = useState('')
  const [activePath, setActivePath] = useState(initialWorkspace.activePath)
  const [query, setQuery] = useState('')
  const [selectedSearchCategories, setSelectedSearchCategories] = useState<string[]>([])
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false)
  const [noteListMode, setNoteListMode] = useState<'cards' | 'summary'>('cards')
  const [leftSidebarVisible, setLeftSidebarVisible] = useState(true)
  const [rightSidebarVisible, setRightSidebarVisible] = useState(true)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(268)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [vaultRoot, setVaultRoot] = useState(initialWorkspace.vaultRoot)
  const [status, setStatus] = useState(initialWorkspace.status)
  const [saveState, setSaveState] = useState<SaveState>(initialWorkspace.saveState)
  const [previewMode, setPreviewMode] = useState(false)
  const [indexedResults, setIndexedResults] = useState<SearchResult[]>([])
  const [noteLinks, setNoteLinks] = useState<NoteLinks>({ outgoing: [], backlinks: [] })
  const [linkVersion, setLinkVersion] = useState(0)
  const [llmSettings, setLlmSettings] = useState<LlmProviderSettings>(defaultLlmSettings)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    if (typeof window === 'undefined') return 'system'
    return readStoredThemePreference(window.localStorage)
  })
  const [defaultCategory, setDefaultCategory] = useState('knowledge')
  const [baseFontSize, setBaseFontSize] = useState<number>(() => {
    if (typeof window === 'undefined') return 16
    const stored = window.localStorage.getItem(BASE_FONT_SIZE_KEY)
    return stored ? parseInt(stored, 10) : 16
  })
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [promptConfig, setPromptConfig] = useState<{ message: string, defaultValue: string, resolve: (val: string | null) => void } | null>(null)
  
  const safePrompt = useCallback((message: string, defaultValue = '') => {
    return new Promise<string | null>((resolve) => {
      setPromptConfig({ message, defaultValue, resolve })
    })
  }, [])
  const categoryFilterRef = useRef<HTMLDetailsElement>(null)
  const categoryFilterPointerInsideRef = useRef(false)
  const skipNextSettingsSaveRef = useRef(true)
  const skipNextVaultChangeUntilRef = useRef(0)

  const activeNote = notes.find((note) => note.path === activePath) ?? notes[0]
  const effectiveTheme = useMemo(() => getEffectiveTheme(themePreference, systemPrefersDark), [systemPrefersDark, themePreference])
  const categoryOptions = useMemo(() => groupByCategory(notes), [notes])
  const searchCategorySet = useMemo(() => new Set(selectedSearchCategories), [selectedSearchCategories])
  const searchScopeLabel =
    selectedSearchCategories.length === 0
      ? 'All categories'
      : selectedSearchCategories.length === 1
        ? selectedSearchCategories[0]
        : `${selectedSearchCategories.length} categories`
  const totalWords = useMemo(() => notes.reduce((sum, note) => sum + note.wordCount, 0), [notes])
  const saveLabel = {
    loading: 'Loading',
    demo: 'Demo only',
    dirty: 'Unsaved changes',
    saving: 'Saving',
    saved: 'Saved',
    error: 'Save failed',
  }[saveState]

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches)
    }

    setSystemPrefersDark(query.matches)
    query.addEventListener('change', updateSystemTheme)
    return () => {
      query.removeEventListener('change', updateSystemTheme)
    }
  }, [])

  useLayoutEffect(() => {
    window.localStorage.setItem(THEME_PREFERENCE_KEY, themePreference)
    window.localStorage.setItem(BASE_FONT_SIZE_KEY, baseFontSize.toString())
    document.documentElement.dataset.theme = effectiveTheme
    document.documentElement.dataset.themePreference = themePreference
    document.documentElement.style.colorScheme = effectiveTheme
    document.documentElement.style.setProperty('--font-size-base', `${baseFontSize}px`)
  }, [effectiveTheme, themePreference, baseFontSize])

  const loadVaultFromDisk = useCallback(
    async (root: string, reason = 'Vault refreshed from disk.', preferredPath = '') => {
      const trimmedRoot = root.trim()
      if (!trimmedRoot) return
      const loadedNotes = await scanVaultAndRebuildIndex(trimmedRoot)
      setNotes(loadedNotes)
      setLinkVersion((current) => current + 1)
      setActivePath((current) => {
        if (preferredPath && loadedNotes.some((note) => note.path === preferredPath)) return preferredPath
        if (loadedNotes.some((note) => note.path === current)) return current
        return loadedNotes[0]?.path ?? ''
      })
      setSaveState('saved')
      setStatus(reason)
    },
    [],
  )

  const loadDemoWorkspace = useCallback(() => {
    setNotes(demoNotes)
    setActivePath(demoNotes[0]?.path ?? '')
    setVaultRoot('')
    setSaveState('demo')
    setStatus('Demo vault loaded. Enter a local path in Settings to open real notes.')
  }, [])

  const refreshVaultFromDisk = useCallback(
    async (reason = 'Vault refreshed from disk.') => {
      await loadVaultFromDisk(vaultRoot, reason)
    },
    [loadVaultFromDisk, vaultRoot],
  )

  useEffect(() => {
    let cancelled = false

    loadUserSettings()
      .then(async (savedSettings) => {
        if (cancelled) return
        const legacyVaultRoot = window.localStorage.getItem(LAST_VAULT_KEY) ?? ''
        const legacyActivePath = window.localStorage.getItem(LAST_ACTIVE_PATH_KEY) ?? ''
        const vaultRootFromSettings = savedSettings.vaultRoot || legacyVaultRoot
        if (vaultRootFromSettings) {
          setVaultRoot(vaultRootFromSettings)
        }

        let llmSettingsFromStorage = savedSettings.llmSettings
        if (savedSettings.defaultCategory) {
          setDefaultCategory(savedSettings.defaultCategory)
        }
        const savedLlmSettings = window.localStorage.getItem(LLM_SETTINGS_KEY)
        const hasStoredLlmSettings =
          savedSettings.llmSettings.providerName !== defaultLlmSettings.providerName ||
          savedSettings.llmSettings.apiBaseUrl !== defaultLlmSettings.apiBaseUrl ||
          savedSettings.llmSettings.apiKey !== defaultLlmSettings.apiKey ||
          savedSettings.llmSettings.model !== defaultLlmSettings.model
        if (!hasStoredLlmSettings && savedLlmSettings) {
          try {
            llmSettingsFromStorage = { ...defaultLlmSettings, ...JSON.parse(savedLlmSettings) }
          } catch {
            setStatus('LLM settings could not be loaded. Defaults restored.')
          }
        }
        setLlmSettings({ ...defaultLlmSettings, ...llmSettingsFromStorage })
        if (vaultRootFromSettings) {
          try {
            await loadVaultFromDisk(
              vaultRootFromSettings,
              savedSettings.vaultRoot
                ? 'Last vault restored from SQLite.'
                : 'Last vault migrated from browser fallback.',
              savedSettings.activePath || legacyActivePath,
            )
          } catch (error) {
            setSaveState('error')
            setStatus(error instanceof Error ? error.message : String(error))
          }
        } else {
          loadDemoWorkspace()
        }
      })
      .catch(async () => {
        if (cancelled) return
        const remembered = window.localStorage.getItem(LAST_VAULT_KEY)
        if (remembered) {
          setVaultRoot(remembered)
          try {
            await loadVaultFromDisk(
              remembered,
              'Last vault restored from browser fallback.',
              window.localStorage.getItem(LAST_ACTIVE_PATH_KEY) ?? '',
            )
          } catch (error) {
            setSaveState('error')
            setStatus(error instanceof Error ? error.message : String(error))
          }
        } else {
          loadDemoWorkspace()
        }
        const savedLlmSettings = window.localStorage.getItem(LLM_SETTINGS_KEY)
        if (savedLlmSettings) {
          try {
            setLlmSettings({ ...defaultLlmSettings, ...JSON.parse(savedLlmSettings) })
          } catch {
            setStatus('LLM settings could not be loaded. Defaults restored.')
          }
        }
      })
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [loadDemoWorkspace, loadVaultFromDisk])

  useEffect(() => {
    if (!settingsLoaded) return
    if (skipNextSettingsSaveRef.current) {
      skipNextSettingsSaveRef.current = false
      return
    }
    const timeout = window.setTimeout(() => {
      const activePathForStorage = vaultRoot.trim() ? activePath : ''
      saveUserSettings({ vaultRoot: vaultRoot.trim(), activePath: activePathForStorage, llmSettings, defaultCategory })
        .then(() => {
          window.localStorage.setItem(LAST_VAULT_KEY, vaultRoot.trim())
          window.localStorage.setItem(LAST_ACTIVE_PATH_KEY, activePathForStorage)
          window.localStorage.removeItem(LLM_SETTINGS_KEY)
        })
        .catch(() => {
          window.localStorage.setItem(LAST_VAULT_KEY, vaultRoot.trim())
          window.localStorage.setItem(LAST_ACTIVE_PATH_KEY, activePathForStorage)
          window.localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify({ ...llmSettings, apiKey: '' }))
        })
    }, 300)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [activePath, llmSettings, settingsLoaded, vaultRoot, defaultCategory])

  useEffect(() => {
    if (!vaultRoot.trim()) return
    let disposed = false
    let unlisten: undefined | (() => void)

    startVaultWatcher(vaultRoot.trim()).catch(() => {
      // Browser-only dev mode has no Tauri backend; keep the UI usable.
    })

    listen('vault://changed', () => {
      if (!disposed) {
        if (Date.now() < skipNextVaultChangeUntilRef.current) {
          skipNextVaultChangeUntilRef.current = 0
          return
        }
        refreshVaultFromDisk('Markdown files changed on disk. Vault refreshed.')
      }
    })
      .then((dispose) => {
        unlisten = dispose
      })
      .catch(() => {
        // Browser-only dev mode has no event bridge.
      })

    return () => {
      disposed = true
      unlisten?.()
      stopVaultWatcher().catch(() => {
        // Ignore when not running inside Tauri.
      })
    }
  }, [refreshVaultFromDisk, vaultRoot])

  useEffect(() => {
    if (!categoryFilterOpen) return

    function closeCategoryFilter(event: PointerEvent) {
      if (!categoryFilterRef.current?.contains(event.target as Node)) {
        setCategoryFilterOpen(false)
      }
    }

    window.addEventListener('pointerdown', closeCategoryFilter)
    return () => {
      window.removeEventListener('pointerdown', closeCategoryFilter)
    }
  }, [categoryFilterOpen])

  useEffect(() => {
    if (!settingsOpen) return

    function closeSettings(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
      }
    }

    window.addEventListener('keydown', closeSettings)
    return () => {
      window.removeEventListener('keydown', closeSettings)
    }
  }, [settingsOpen])

  useEffect(() => {
    let unlisten: undefined | (() => void)
    listen(OPEN_SETTINGS_EVENT, () => {
      setSettingsOpen(true)
    })
      .then((dispose) => {
        unlisten = dispose
      })
      .catch(() => {
        // Browser-only dev mode has no native application menu.
      })

    return () => {
      unlisten?.()
    }
  }, [])

  const visibleNotes = useMemo(() => {
    if (activeView === 'search') {
      const matchesSearchScope = (note: Pick<Note, 'category'>) =>
        searchCategorySet.size === 0 ||
        searchCategorySet.has(note.category) ||
        Array.from(searchCategorySet).some((category) => note.category.startsWith(`${category}/`))
      const searchResults = vaultRoot.trim() && query.trim() ? indexedResults : searchNotes(notes, query)
      return searchResults.filter(matchesSearchScope)
    }
    if (activeView === 'today') return getTodayNote(notes) ? [getTodayNote(notes)!] : sortByUpdatedDesc(notes).slice(0, 5)
    if (activeView === 'category') return filterNotesByCategory(notes, activeCategory)
    return sortByUpdatedDesc(notes)
  }, [activeCategory, activeView, indexedResults, notes, query, searchCategorySet, vaultRoot])

  const [renderedCount, setRenderedCount] = useState(NOTES_PAGE_SIZE)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  // Reset rendered count when the visible notes change (view/category/search switch)
  useEffect(() => {
    setRenderedCount(NOTES_PAGE_SIZE)
  }, [visibleNotes])

  // IntersectionObserver to load more notes when sentinel enters viewport
  useEffect(() => {
    const sentinel = loadMoreRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setRenderedCount((current) => Math.min(current + NOTES_PAGE_SIZE, visibleNotes.length))
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [visibleNotes.length])

  const visibleNoteGroups = useMemo(() => {
    const sliced = visibleNotes.slice(0, renderedCount)
    const groups = new Map<string, Array<Note | SearchResult>>()
    for (const note of sliced) {
      const month = note.createdAt.slice(0, 7)
      groups.set(month, [...(groups.get(month) ?? []), note])
    }
    return Array.from(groups.entries())
      .map(([month, groupedNotes]) => ({ month, notes: groupedNotes }))
      .sort((a, b) => b.month.localeCompare(a.month))
  }, [visibleNotes, renderedCount])

  useEffect(() => {
    if (!vaultRoot.trim() || !query.trim()) {
      setIndexedResults([])
      return
    }
    let cancelled = false
    searchIndex({ vaultRoot: vaultRoot.trim(), query })
      .then((results) => {
        if (!cancelled) setIndexedResults(results)
      })
      .catch((error) => {
        if (!cancelled) {
          setIndexedResults([])
          setStatus(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [query, vaultRoot])

  useEffect(() => {
    if (!activeNote || !vaultRoot.trim()) {
      setNoteLinks({ outgoing: [], backlinks: [] })
      return
    }
    let cancelled = false
    getNoteLinks({ vaultRoot: vaultRoot.trim(), path: activeNote.path })
      .then((links) => {
        if (!cancelled) setNoteLinks(links)
      })
      .catch(() => {
        if (!cancelled) setNoteLinks({ outgoing: [], backlinks: [] })
      })
    return () => {
      cancelled = true
    }
  }, [activeNote, linkVersion, vaultRoot])

  function updateActiveNote(fullContent: string) {
    if (!activeNote) return
    
    const { body, metadata } = parseMarkdownWithFrontmatter(fullContent)
    
    // MDXEditor normalizes table spacing and delimiter rows (e.g., adding spaces or converting |-| to |---|).
    // We normalize both bodies for comparison to avoid marking the note dirty just from toggling modes.
    const normalizeTableFormatting = (md: string) => {
      return md.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed.includes('|')) {
          let row = trimmed.replace(/(^\||\|$)/g, '');
          row = row.replace(/\s*\|\s*/g, '|').trim();
          if (/^[\-\|]+$/.test(row)) {
            row = '-';
          }
          return row;
        }
        return line;
      }).join('\n').trim();
    }

    const hasChanges =
      normalizeTableFormatting(body) !== normalizeTableFormatting(activeNote.body) ||
      (metadata.title !== undefined && metadata.title !== activeNote.title) ||
      (metadata.category !== undefined && metadata.category !== activeNote.category) ||
      (metadata.tags !== undefined && metadata.tags.join(',') !== activeNote.tags.join(',')) ||
      (metadata.summary !== undefined && metadata.summary !== activeNote.summary)

    if (!hasChanges) {
      return
    }

    setSaveState(vaultRoot.trim() ? 'dirty' : 'demo')
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            ...metadata,
            body,
            updatedAt: localDateString(),
            wordCount: body.trim() ? body.trim().split(/\s+/).length : 0,
          }
          : note,
      ),
    )
  }

  function updateActiveNoteTitle(title: string) {
    if (!activeNote) return
    setSaveState(vaultRoot.trim() ? 'dirty' : 'demo')
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            title,
            updatedAt: localDateString(),
          }
          : note,
      ),
    )
  }

  function updateActiveNoteCreatedAt(createdAt: string) {
    if (!activeNote) return
    setSaveState(vaultRoot.trim() ? 'dirty' : 'demo')
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            createdAt,
            updatedAt: localDateString(),
          }
          : note,
      ),
    )
  }

  function updateActiveNoteTags(value: string) {
    if (!activeNote) return
    const tags = value
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
      .filter((tag, index, all) => all.indexOf(tag) === index)
    setSaveState(vaultRoot.trim() ? 'dirty' : 'demo')
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            tags,
            updatedAt: localDateString(),
          }
          : note,
      ),
    )
  }

  async function openVault() {
    if (!vaultRoot.trim()) {
      setStatus('Enter a vault path first.')
      return
    }
    try {
      await refreshVaultFromDisk('Vault opened. Markdown notes indexed.')
      window.localStorage.setItem(LAST_VAULT_KEY, vaultRoot.trim())
      setSaveState('saved')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function initVault() {
    if (!vaultRoot.trim()) {
      setStatus('Enter a vault path first.')
      return
    }
    try {
      const loadedNotes = await initializeVault(vaultRoot.trim())
      await rebuildSearchIndex(vaultRoot.trim())
      setNotes(loadedNotes.length ? loadedNotes : [])
      setActivePath(loadedNotes[0]?.path ?? '')
      window.localStorage.setItem(LAST_VAULT_KEY, vaultRoot.trim())
      setSaveState('saved')
      setStatus('Starter vault folders are ready.')
    } catch (error) {
      setSaveState('error')
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before saving.')
      return
    }
    try {
      setSaveState('saving')
      
      let noteToSave = { ...activeNote }
      
      if (noteToSave.title === '无标题') {
        const now = new Date()
        const timestamp = now.getFullYear().toString() + 
          String(now.getMonth() + 1).padStart(2, '0') + 
          String(now.getDate()).padStart(2, '0') + 
          String(now.getHours()).padStart(2, '0') + 
          String(now.getMinutes()).padStart(2, '0') + 
          String(now.getSeconds()).padStart(2, '0')
        const randomDigits = Math.floor(1000 + Math.random() * 9000)
        noteToSave.title = `${timestamp}-${randomDigits}`
      }

      const expectedFilename = `${getFilenameForTitle(noteToSave.title)}.md`
      let expectedPath = noteToSave.category ? `${noteToSave.category}/${expectedFilename}` : expectedFilename
      expectedPath = expectedPath.replace(/\/+/g, '/')
      
      let finalPath = noteToSave.path
      
      if (noteToSave.path !== expectedPath) {
        try {
          const moved = await moveNote({ vaultRoot: vaultRoot.trim(), from: noteToSave.path, to: expectedPath })
          finalPath = moved.path
        } catch (error) {
          const newExpectedPath = expectedPath.replace(/\.md$/, `-${Math.floor(1000 + Math.random() * 9000)}.md`)
          const moved = await moveNote({ vaultRoot: vaultRoot.trim(), from: noteToSave.path, to: newExpectedPath })
          finalPath = moved.path
        }
        noteToSave.path = finalPath
      }

      const saved = await writeNote({
        vaultRoot: vaultRoot.trim(),
        path: finalPath,
        content: noteToMarkdown(noteToSave),
      })
      setLinkVersion((current) => current + 1)
      setNotes((current) => current.map((note) => (note.path === activeNote.path ? saved : note)))
      
      if (activeNote.path !== saved.path) {
        setActivePath(saved.path)
      }
      setActiveCategory(saved.category)
      setSaveState('saved')
      setStatus(`Saved ${saved.path}.`)
    } catch (error) {
      setSaveState('error')
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function checkExternalActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before checking disk changes.')
      return
    }
    try {
      const diskNote = await readNote(vaultRoot.trim(), activeNote.path)
      const changedOnDisk =
        diskNote.body !== activeNote.body ||
        diskNote.title !== activeNote.title ||
        diskNote.updatedAt !== activeNote.updatedAt ||
        diskNote.tags.join('\n') !== activeNote.tags.join('\n')

      if (!changedOnDisk) {
        setStatus('Disk version matches the editor.')
        return
      }

      const reload = await safeConfirm(`${activeNote.path} changed on disk. Reload the disk version?`)
      if (!reload) {
        setStatus('Kept editor version. Save to overwrite disk when ready.')
        setSaveState('dirty')
        return
      }

      setNotes((current) => current.map((note) => (note.path === diskNote.path ? diskNote : note)))
      setSaveState('saved')
      setStatus(`Reloaded ${diskNote.path} from disk.`)
    } catch (error) {
      setSaveState('error')
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function archiveActiveInboxNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before archiving inbox notes.')
      return
    }
    if (!activeNote.path.startsWith('00-inbox/')) {
      setStatus('Only inbox notes can use the archive flow.')
      return
    }
    const title = await safePrompt('Archive title', activeNote.title)
    if (!title) return
    const category = await safePrompt('Archive category', activeCategory && activeCategory !== '00-inbox' ? activeCategory : 'knowledge')
    if (!category) return
    try {
      const archived = await archiveNote({
        vaultRoot: vaultRoot.trim(),
        from: activeNote.path,
        title,
        category,
        tags: activeNote.tags.filter((tag) => tag !== 'inbox'),
        createdAt: activeNote.createdAt,
        body: activeNote.body,
      })
      setLinkVersion((current) => current + 1)
      setNotes((current) => [archived, ...current.filter((note) => note.path !== activeNote.path)])
      setActivePath(archived.path)
      setActiveCategory(archived.category)
      setActiveView('category')
      setSaveState('saved')
      setStatus(`Archived to ${archived.path}.`)
    } catch (error) {
      setSaveState('error')
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addTodayNote() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating today note.')
      return
    }
    try {
      const note = await createTodayNote(vaultRoot.trim())
      setLinkVersion((current) => current + 1)
      setNotes((current) => [note, ...current.filter((item) => item.path !== note.path)])
      setActivePath(note.path)
      setSaveState('saved')
      setStatus(`Opened ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addWeeklyReview() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating weekly review.')
      return
    }
    try {
      const today = localDateString()
      const note = await createWeeklyReview({ vaultRoot: vaultRoot.trim(), date: today })
      setLinkVersion((current) => current + 1)
      setNotes((current) => [note, ...current.filter((item) => item.path !== note.path)])
      setActivePath(note.path)
      setActiveCategory(note.category)
      setActiveView('category')
      setSaveState('saved')
      setStatus(`Created ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addMonthlyReview() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating monthly review.')
      return
    }
    try {
      const today = localDateString()
      const note = await createMonthlyReview({ vaultRoot: vaultRoot.trim(), date: today })
      setLinkVersion((current) => current + 1)
      setNotes((current) => [note, ...current.filter((item) => item.path !== note.path)])
      setActivePath(note.path)
      setActiveCategory(note.category)
      setActiveView('category')
      setSaveState('saved')
      setStatus(`Created ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addInboxNote() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating inbox note.')
      return
    }
    try {
      const note = await createInboxNote(vaultRoot.trim(), 'Quick Thought')
      setLinkVersion((current) => current + 1)
      setNotes((current) => [note, ...current])
      setActivePath(note.path)
      setSaveState('saved')
      setStatus(`Created ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addCategoryNote() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating notes.')
      return
    }
    const title = '无标题'
    const fallbackCategory = categoryOptions.length > 0 ? categoryOptions[0].name : 'knowledge'
    const category = defaultCategory || fallbackCategory
    try {
      const note = await createNote({ vaultRoot: vaultRoot.trim(), title, category })
      setLinkVersion((current) => current + 1)
      setNotes((current) => [note, ...current])
      setActivePath(note.path)
      setActiveCategory(note.category)
      setActiveView('category')
      setSaveState('saved')
      setStatus(`Created ${note.path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function addFolder() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before creating folders.')
      return
    }
    const path = await safePrompt('Folder path', activeCategory || 'knowledge/new-topic')
    if (!path) return
    try {
      await createFolder({ vaultRoot: vaultRoot.trim(), path })
      const loadedNotes = await scanVault(vaultRoot.trim())
      setNotes(loadedNotes)
      setActiveCategory(path)
      setActiveView('category')
      setStatus(`Created folder ${path}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function renameActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before renaming notes.')
      return
    }
    const currentName = activeNote.path.split('/').pop() ?? activeNote.path
    const nextName = await safePrompt('New filename', currentName)
    if (!nextName || nextName === currentName) return
    const folder = activeNote.path.includes('/') ? activeNote.path.split('/').slice(0, -1).join('/') : ''
    const normalized = nextName.endsWith('.md') ? nextName : `${nextName}.md`
    const to = folder ? `${folder}/${normalized}` : normalized
    await moveActiveNote(to)
  }

  async function moveActiveNotePrompt() {
    if (!activeNote) return
    const nextPath = await safePrompt('Move to path', activeNote.path)
    if (!nextPath || nextPath === activeNote.path) return
    await moveActiveNote(nextPath.endsWith('.md') ? nextPath : `${nextPath}.md`)
  }

  async function moveActiveNote(to: string) {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus('Open a real vault before moving notes.')
      return
    }
    try {
      const moved = await moveNote({ vaultRoot: vaultRoot.trim(), from: activeNote.path, to })
      setNotes((current) => current.map((note) => (note.path === activeNote.path ? moved : note)))
      setActivePath(moved.path)
      setActiveCategory(moved.category)
      setSaveState('saved')
      setStatus(`Moved to ${moved.path}.`)

      setLinkVersion((current) => current + 1)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function deleteNoteByPath(path: string) {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before deleting notes.')
      return
    }
    const confirmed = await safeConfirm(`Move ${path} to trash?`)
    if (!confirmed) return
    try {
      skipNextVaultChangeUntilRef.current = Date.now() + 1500
      await deleteNote(vaultRoot.trim(), path)
      const remaining = notes.filter((note) => note.path !== path)
      setNotes(remaining)
      setIndexedResults((current) => current.filter((note) => note.path !== path))
      setLinkVersion((current) => current + 1)
      setActivePath((current) => (current === path ? (remaining[0]?.path ?? '') : current))
      setSaveState('saved')
      setStatus(`Moved ${path} to trash.`)
    } catch (error) {
      skipNextVaultChangeUntilRef.current = 0
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  function deleteActiveNote() {
    if (!activeNote) return
    void deleteNoteByPath(activeNote.path)
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!leftSidebarVisible || event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = leftSidebarWidth

    function resize(moveEvent: PointerEvent) {
      const nextWidth = Math.min(560, Math.max(220, startWidth + moveEvent.clientX - startX))
      setLeftSidebarWidth(nextWidth)
    }

    function stopResize() {
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stopResize)
    }

    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stopResize)
  }

  async function rebuildIndex() {
    if (!vaultRoot.trim()) {
      setStatus('Open a real vault before rebuilding the index.')
      return
    }
    try {
      await rebuildSearchIndex(vaultRoot.trim())
      setLinkVersion((current) => current + 1)
      if (query.trim()) {
        setIndexedResults(await searchIndex({ vaultRoot: vaultRoot.trim(), query }))
      }
      setStatus('Search index rebuilt.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <main className="app-frame" data-theme={effectiveTheme}>
      <header
        className="window-topbar"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button, input, a, [data-no-drag]')) return
          if (e.button !== 0) return
          e.preventDefault()
          getCurrentWindow().startDragging().catch(() => { })
        }}
      >
        <button
          className={leftSidebarVisible ? 'topbar-icon-button active' : 'topbar-icon-button'}
          type="button"
          onClick={() => setLeftSidebarVisible((current) => !current)}
          title={leftSidebarVisible ? 'Hide left sidebar' : 'Show left sidebar'}
          aria-label={leftSidebarVisible ? 'Hide left sidebar' : 'Show left sidebar'}
        >
          <PanelLeft size={17} />
        </button>
        <div className="window-brand" aria-label="iNote window">
          <strong>iNote</strong>
          <span>{vaultRoot.trim() ? vaultRoot.split('/').filter(Boolean).pop() : 'Demo workspace'}</span>
        </div>
        <div className="command-box window-command">

          <Search size={17} />
          <input
            aria-label="Search notes"
            placeholder="Search notes"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveView('search')
            }}
          />
        </div>
        <div className="window-actions" aria-label="Window actions">
          <button className="icon-action" type="button" onClick={addCategoryNote} title="Create note" aria-label="Create note">
            <Pencil size={16} />
          </button>
          <button className="icon-action" type="button" onClick={addFolder} title="Create folder" aria-label="Create folder">
            <FolderPlus size={16} />
          </button>
          <button
            className={activeView === 'tags' ? 'icon-action active' : 'icon-action'}
            type="button"
            onClick={() => setActiveView('tags')}
            title="Tags"
            aria-label="Open tags"
          >
            <Tags size={17} />
          </button>
          <button
            className={activeView === 'calendar' ? 'icon-action active' : 'icon-action'}
            type="button"
            onClick={() => setActiveView('calendar')}
            title="Calendar"
            aria-label="Open calendar"
          >
            <CalendarDays size={17} />
          </button>
          <button
            className={settingsOpen ? 'icon-action active' : 'icon-action'}
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={17} />
          </button>
          <button
            className={rightSidebarVisible ? 'icon-action active' : 'icon-action'}
            type="button"
            onClick={() => setRightSidebarVisible((current) => !current)}
            title={rightSidebarVisible ? 'Hide right sidebar' : 'Show right sidebar'}
            aria-label={rightSidebarVisible ? 'Hide right sidebar' : 'Show right sidebar'}
          >
            <PanelRight size={17} />
          </button>
        </div>
      </header>

      <div
        className="app-shell"
        style={{
          gridTemplateColumns: `${leftSidebarVisible ? `${leftSidebarWidth}px 5px` : '0 0'} minmax(0, 1fr) ${rightSidebarVisible ? '336px' : '0'
            }`,
        }}
      >
        <aside className={leftSidebarVisible ? 'sidebar' : 'sidebar hidden'}>
          <div className="list-header">
            <details
              ref={categoryFilterRef}
              className="category-filter"
              data-no-drag
              open={categoryFilterOpen}
              onBlur={(event) => {
                if (categoryFilterPointerInsideRef.current) return
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setCategoryFilterOpen(false)
                }
              }}
              onPointerDownCapture={() => {
                categoryFilterPointerInsideRef.current = true
                window.setTimeout(() => {
                  categoryFilterPointerInsideRef.current = false
                }, 0)
              }}
              onToggle={(event) => setCategoryFilterOpen(event.currentTarget.open)}
            >
              <summary title={searchScopeLabel}>
                {activeView === 'today'
                  ? 'Today'
                  : activeView === 'search'
                    ? searchScopeLabel
                    : activeView === 'category'
                      ? activeCategory
                      : 'All notes'}
              </summary>
              <div className="category-filter-menu">
                <label>
                  <input
                    checked={selectedSearchCategories.length === 0}
                    type="checkbox"
                    onChange={() => {
                      setSelectedSearchCategories([])
                      setActiveView('search')
                    }}
                  />
                  <Check className="category-check" size={14} />
                  <span>All categories</span>
                </label>
                {categoryOptions.map((category) => (
                  <label key={category.name}>
                    <input
                      checked={searchCategorySet.has(category.name)}
                      type="checkbox"
                      onChange={(event) => {
                        setActiveView('search')
                        setSelectedSearchCategories((current) => {
                          if (event.target.checked) return [...current, category.name].sort((a, b) => a.localeCompare(b))
                          return current.filter((name) => name !== category.name)
                        })
                      }}
                    />
                    <Check className="category-check" size={14} />
                    <span>{category.name}</span>
                    <small>{category.count}</small>
                  </label>
                ))}
              </div>
            </details>
            <div className="note-list-tools" aria-label="Note list display mode">
              <small>{visibleNotes.length}</small>
              <button
                className={noteListMode === 'cards' ? 'active' : ''}
                type="button"
                onClick={() => setNoteListMode('cards')}
                title="Card view"
                aria-label="Card view"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                className={noteListMode === 'summary' ? 'active' : ''}
                type="button"
                onClick={() => setNoteListMode('summary')}
                title="Summary view"
                aria-label="Summary view"
              >
                <List size={14} />
              </button>
            </div>
          </div>
          <div className={`note-list ${noteListMode}`}>
            {visibleNoteGroups.map((group) => (
              <section className="note-month-group" key={group.month}>
                <div className="note-month-header">
                  <h3>{group.month}</h3>
                  <small>{group.notes.length}</small>
                </div>
                <div className={noteListMode === 'cards' ? 'note-card-grid' : 'note-summary-stack'}>
                  {group.notes.map((note) =>
                    noteListMode === 'cards' ? (
                      <NoteCardItem
                        key={note.path}
                        note={note}
                        isActive={note.path === activeNote?.path}
                        onSelect={setActivePath}
                        onDelete={deleteNoteByPath}
                      />
                    ) : (
                      <NoteRowItem
                        key={note.path}
                        note={note}
                        isActive={note.path === activeNote?.path}
                        onSelect={setActivePath}
                        onDelete={deleteNoteByPath}
                      />
                    ),
                  )}
                </div>
              </section>
            ))}
            {renderedCount < visibleNotes.length && (
              <div ref={loadMoreRef} className="load-more-sentinel" aria-hidden="true" />
            )}
          </div>
        </aside>
        <div
          className={leftSidebarVisible ? 'sidebar-resizer' : 'sidebar-resizer hidden'}
          onPointerDown={startSidebarResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize left sidebar"
        />

        <section className="workspace">

          {activeView === 'calendar' ? (
            <Suspense fallback={<div className="empty">Loading calendar…</div>}>
              <CalendarView notes={notes} onSelectNote={setActivePath} />
            </Suspense>
          ) : activeView === 'tags' ? (
            <Suspense fallback={<div className="empty">Loading tags…</div>}>
              <TagsPanel
                notes={notes}
                activeTag={activeTag}
                onSelectTag={setActiveTag}
                onSelectNote={(path) => {
                  setActivePath(path)
                }}
              />
            </Suspense>
          ) : (
            activeNote ? (
              <Editor
                vaultRoot={vaultRoot.trim()}
                note={activeNote}
                onChange={updateActiveNote}
                onSave={saveActiveNote}
                onCheckExternal={checkExternalActiveNote}
                onDelete={deleteActiveNote}
                previewMode={previewMode}
                onTogglePreview={() => setPreviewMode((current) => !current)}
                saveState={saveState}
              />
            ) : (
              <div className="empty">No note selected.</div>
            )
          )}
        </section>

        <aside className={rightSidebarVisible ? 'context-panel' : 'context-panel hidden'}>
          {activeNote ? (
            <>
              <section className="context-section">
                <p className="panel-title">
                  <PanelRight size={14} /> Context
                </p>
                <h3>{activeNote.title}</h3>
                <dl className="note-facts">
                  <div>
                    <dt>Path</dt>
                    <dd>{activeNote.path}</dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>{activeNote.category}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{activeNote.createdAt}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{activeNote.updatedAt}</dd>
                  </div>
                </dl>
                <div className="tag-strip">
                  {activeNote.tags.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </div>
                <label className="metadata-editor">
                  <span>Title</span>
                  <input value={activeNote.title} onChange={(event) => updateActiveNoteTitle(event.target.value)} />
                </label>
                <label className="metadata-editor">
                  <span>Created</span>
                  <input type="date" value={activeNote.createdAt} onChange={(event) => updateActiveNoteCreatedAt(event.target.value)} />
                </label>
                <label className="metadata-editor">
                  <span>Tags</span>
                  <input value={activeNote.tags.join(', ')} onChange={(event) => updateActiveNoteTags(event.target.value)} />
                </label>
                <div className="context-actions">
                  {activeNote.path.startsWith('00-inbox/') ? (
                    <button type="button" onClick={archiveActiveInboxNote} title="Archive inbox note">
                      <Archive size={15} />
                    </button>
                  ) : null}
                  <button type="button" onClick={renameActiveNote} title="Rename note">
                    <Pencil size={15} />
                  </button>
                  <button type="button" onClick={moveActiveNotePrompt} title="Move note">
                    <MoveRight size={15} />
                  </button>
                  <button type="button" onClick={deleteActiveNote} title="Delete note">
                    <FileMinus2 size={15} />
                  </button>
                </div>
              </section>
              <section className="context-section">
                <p className="panel-title">
                  <Sparkles size={14} /> Summary
                </p>
                <p className="summary-text">{activeNote.summary ?? activeNote.body.replace(/^# .*\n?/, '').trim().slice(0, 180)}</p>
              </section>
              <section className="context-section">
                <p className="panel-title">
                  <Link2 size={14} /> Links
                </p>
                <div className="link-group">
                  <h4>Backlinks</h4>
                  {noteLinks.backlinks.length ? (
                    noteLinks.backlinks.map((link) => (
                      <button key={`${link.sourcePath}-${link.label}`} type="button" onClick={() => setActivePath(link.sourcePath)}>
                        <strong>{link.sourceTitle}</strong>
                        <span>{link.sourcePath}</span>
                      </button>
                    ))
                  ) : (
                    <p>No backlinks.</p>
                  )}
                </div>
                <div className="link-group">
                  <h4>Outgoing</h4>
                  {noteLinks.outgoing.length ? (
                    noteLinks.outgoing.map((link) => (
                      <button key={`${link.targetPath}-${link.label}`} type="button" onClick={() => setActivePath(link.targetPath)}>
                        <strong>{link.targetTitle}</strong>
                        <span>{link.targetPath}</span>
                      </button>
                    ))
                  ) : (
                    <p>No outgoing links.</p>
                  )}
                </div>
              </section>
              <section className="context-section">
                <p className="panel-title">
                  <Bot size={14} /> Assistant
                </p>
                <Suspense fallback={<div className="empty">Loading assistant…</div>}>
                  <LlmAssistant note={activeNote} notes={notes} settings={llmSettings} />
                </Suspense>
              </section>
            </>
          ) : null}
        </aside>
      </div>

      {settingsOpen ? (
        <div className="settings-window-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <div
            className="settings-window"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Suspense fallback={<div className="empty">Loading settings…</div>}>
              <SettingsPanel
                vaultRoot={vaultRoot}
                status={status}
                llmSettings={llmSettings}
                themePreference={themePreference}
                effectiveTheme={effectiveTheme}
                baseFontSize={baseFontSize}
                defaultCategory={defaultCategory}
                categories={categoryOptions}
                onVaultRootChange={setVaultRoot}
                onLlmSettingsChange={setLlmSettings}
                onThemePreferenceChange={setThemePreference}
                onBaseFontSizeChange={setBaseFontSize}
                onDefaultCategoryChange={setDefaultCategory}
                onOpenVault={openVault}
                onInitializeVault={initVault}
                onCreateToday={addTodayNote}
                onCreateInbox={addInboxNote}
                onCreateWeeklyReview={addWeeklyReview}
                onCreateMonthlyReview={addMonthlyReview}
                onCreateFolder={addFolder}
                onRebuildIndex={rebuildIndex}
                onClose={() => setSettingsOpen(false)}
              />
            </Suspense>
          </div>
        </div>
      ) : null}

      {promptConfig ? (
        <div className="settings-window-backdrop" role="presentation" style={{ zIndex: 1000 }} onMouseDown={() => { promptConfig.resolve(null); setPromptConfig(null) }}>
          <div
            className="settings-window"
            role="dialog"
            aria-modal="true"
            aria-label={promptConfig.message}
            style={{ width: '400px', height: 'auto', minHeight: 'auto', padding: '24px' }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <form onSubmit={(e) => {
              e.preventDefault()
              const val = new FormData(e.currentTarget).get('val') as string
              promptConfig.resolve(val)
              setPromptConfig(null)
            }}>
              <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: 'var(--font-size-lg)', fontWeight: '600' }}>{promptConfig.message}</h3>
              <input
                name="val"
                defaultValue={promptConfig.defaultValue}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    promptConfig.resolve(null)
                    setPromptConfig(null)
                  }
                }}
                style={{ 
                  width: '100%', 
                  padding: '8px 12px', 
                  marginBottom: '24px', 
                  backgroundColor: 'var(--surface-sunken)', 
                  color: 'var(--text-primary)', 
                  border: '1px solid var(--border)', 
                  borderRadius: '4px',
                  outline: 'none',
                  fontSize: 'var(--font-size-base)'
                }}
              />
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => { promptConfig.resolve(null); setPromptConfig(null) }}>Cancel</button>
                <button type="submit" className="btn primary">OK</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <footer className="status-bar">
        <span className={`status-pill ${saveState}`}>{saveLabel}</span>
        <span>Vault: {vaultRoot.trim() ? vaultRoot.split('/').filter(Boolean).pop() : 'Demo workspace'}</span>
        <span>{notes.length} notes</span>
        <span>{status}</span>
        <span>{activeNote ? activeNote.path : 'No note'}</span>
        <span>{activeNote ? `${activeNote.wordCount} words` : `${totalWords} words total`}</span>
      </footer>
    </main>
  )
}
