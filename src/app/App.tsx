import { useReminderSync } from '../features/todo/useReminderSync';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import {
  Archive,
  CalendarDays,
  Copy,
  Eye,
  FilePlus2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Focus,
  LayoutGrid,
  List,
  ListTodo,
  Network,
  PanelLeft,
  PanelRight,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Settings,
  Tags,
  TextCursorInput,
  Trash,
  Trash2,
} from "lucide-react";
const CalendarView = lazy(() =>
  import("../features/calendar/CalendarView").then((m) => ({
    default: m.CalendarView,
  })),
);
const Editor = lazy(() => import("../features/mindmap/MindMapEditor").then((module) => ({ default: module.Editor })));
import { MINDMAP_KEY, withMindMap } from "../features/mindmap/mindmap";
import type { MapCreation } from "../features/mindmap/MindMapDialog";
const MindMapDialog = lazy(() => import("../features/mindmap/MindMapDialog").then(m => ({ default: m.MindMapDialog })));
import { FeatureBoundary } from "./FeatureBoundary";
import { buildAgentNoteCommit } from "../features/agent/agentNoteCommit";
import { useNoteWorkspace } from "./useNoteWorkspace";
import { useVaultSync } from "./useVaultSync";
import { prepareWorkspaceClose } from "./closeWorkspace";
import { useWorkspaceSettings } from "./useWorkspaceSettings";
import { useIndexedSearch } from "./useIndexedSearch";
import { matchesSearchFilters, parseSearchQuery, rankLocalResults, rememberSearch } from "../features/search/searchQuery";
import { acknowledgeSave, mergeDiskNotes, createSerialQueue } from "../shared/notePersistence";
import { getFilenameForTitle, newNotePath, noteSavePath } from "../shared/notePaths";
import { localDateString, moveDueDate } from "../shared/dueDates";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { ContextMenu, type ContextMenuEntry } from "./components/ContextMenu";
import { EmptyState, Skeleton } from "./components/EmptyState";
import { FolderPicker, normalizeFolder, type FolderPickerRequest } from "./components/FolderPicker";
import { Modal } from "./components/Modal";
import { NoteListPanel, type NoteGroup } from "./components/NoteListPanel";
import { PromptDialog, type PromptRequest } from "./components/PromptDialog";
import { ResizeHandle } from "./components/ResizeHandle";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { ToastProvider, useToast } from "./components/Toast";
import { formatShortcut, useGlobalShortcuts } from "./shortcuts";
const NoteAgent = lazy(() =>
  import("../features/agent/NoteAgent").then((m) => ({ default: m.NoteAgent })),
);
const SettingsPanel = lazy(() =>
  import("../features/settings/SettingsPanel").then((m) => ({
    default: m.SettingsPanel,
  })),
);
const TagsPanel = lazy(() =>
  import("../features/tags/TagsPanel").then((m) => ({ default: m.TagsPanel })),
);
const TodoDashboard = lazy(() =>
  import("../features/todo/TodoDashboard").then((m) => ({
    default: m.TodoDashboard,
  })),
);
import { demoNotes } from "../shared/fixtures";
import {
  getEffectiveTheme,
  getThemeDatasetValue,
  readStoredThemePreference,
  readStoredColorTheme,
  THEME_PREFERENCE_KEY,
  COLOR_THEME_KEY,
  type ThemePreference,
  type ColorTheme,
} from "../shared/theme";
import type {
  LlmProviderSettings,
  Note,
  NoteLinks,
  SaveState,
  SearchResult,
  WorkspaceView,
} from "../shared/types";
import { hasNoteChanges } from "../shared/noteChanges";
import type { AgentResult } from "../features/agent/agentTypes";
import {
  createFolder,
  createNote,
  createTodayNote,
  deleteNote,
  emptyTrash,
  getNoteLinks,
  loadIndexedVault,
  loadLastAgentUndoSnapshot,
  migrateNoteImages,
  initializeVault,
  moveNote,
  noteToMarkdown,
  readNote,
  rebuildSearchIndex,
  loadUserSettings,
  saveWindowState,
  scanVaultAndRebuildIndex,
  parseMarkdownWithFrontmatter,
  getSetting,
  quitApp,
  commitNote,
  undoAgentChange,
  loadNoteDrafts,
  saveNoteDrafts,
  type NoteCommitInput,
} from "../shared/api";
import {
  filterNotesByCategory,
  getTodayNote,
  groupByCategory,
  searchNotes,
  sortByUpdatedDesc,
} from "../shared/vault";
import {
  createInitialWorkspaceState,
  LAST_ACTIVE_PATH_KEY,
  LAST_VAULT_KEY,
} from "./startup";

async function safeConfirm(message: string): Promise<boolean> {
  if (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI_IPC__" in window)
  ) {
    try {
      return await tauriConfirm(message);
    } catch {
      // Fallback if plugin fails
    }
  }
  return window.confirm(message);
}

const LLM_SETTINGS_KEY = "inote.llmSettings";
const BASE_FONT_SIZE_KEY = "inote.baseFontSize";
const FONT_FAMILY_KEY = "inote.fontFamily";
const OPEN_SETTINGS_EVENT = "inote://open-settings";

const defaultLlmSettings: LlmProviderSettings = {
  providerName: "OpenAI compatible",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
};

const NOTES_PAGE_SIZE = 60;
const LEFT_SIDEBAR_DEFAULT = 268;
const RIGHT_SIDEBAR_DEFAULT = 336;
const ARCHIVE_ROOT = "archive";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function folderOf(path: string): string {
  return path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
}

function uniquePath(target: string, existing: Set<string>): string {
  if (!existing.has(target)) return target;
  const base = target.replace(/\.md$/, "");
  let suffix = 2;
  while (existing.has(`${base}-${suffix}.md`)) suffix += 1;
  return `${base}-${suffix}.md`;
}

export function App() {
  return (
    <ToastProvider>
      <Workspace />
    </ToastProvider>
  );
}

function Workspace() {
  const { t } = useTranslation();
  const toast = useToast();
  // Stable translator for long-lived callbacks (startup effects must not re-run on language change).
  const tRef = useRef(t);
  tRef.current = t;
  const initialWorkspace = useMemo(
    () =>
      createInitialWorkspaceState(
        typeof window === "undefined" ? undefined : window.localStorage,
      ),
    [],
  );
  const [activeView, setActiveView] = useState<WorkspaceView>("today");
  const [activeCategory, setActiveCategory] = useState("journal");
  const [activePath, setActivePath] = useState(initialWorkspace.activePath);
  const [query, setQuery] = useState("");
  const [selectedSearchCategories, setSelectedSearchCategories] = useState<
    string[]
  >([]);
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  const [noteListMode, setNoteListMode] = useState<"cards" | "summary">(
    "cards",
  );
  const [leftSidebarVisible, setLeftSidebarVisible] = useState(true);
  const [rightSidebarVisible, setRightSidebarVisible] = useState(true);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(268);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(336);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mindMapTarget, setMindMapTarget] = useState<{ root: string; category: string } | null>(null);
  const [showTodayNoteButton, setShowTodayNoteButton] = useState(false);
  const [lockUpdateTime, setLockUpdateTime] = useState(false);
  const [autoSaveOnExit, setAutoSaveOnExit] = useState(false);
  const [tagsPopoverOpen, setTagsPopoverOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"all" | "notes" | null>(null);
  const [folderRequest, setFolderRequest] = useState<FolderPickerRequest | null>(null);
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const [focusMode, setFocusMode] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [vaultRoot, setVaultRoot] = useState(initialWorkspace.vaultRoot);
  const [vaultPathInput, setVaultPathInput] = useState(initialWorkspace.vaultRoot);
  const { notes, setNotes, notesRef, vaultRef } = useNoteWorkspace(initialWorkspace.notes, vaultRoot);
  const [status, setStatus] = useState(initialWorkspace.status);
  const [isSaving, setIsSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [noteLinks, setNoteLinks] = useState<NoteLinks>({
    outgoing: [],
    backlinks: [],
  });
  const [linkVersion, setLinkVersion] = useState(0);
  const parsedQuery = useMemo(() => parseSearchQuery(query), [query]);
  const searchHighlightQuery = parsedQuery.indexQuery;
  const [indexedResults, setIndexedResults] = useIndexedSearch(vaultRoot, parsedQuery.indexQuery, linkVersion, setStatus);
  const [llmSettings, setLlmSettings] =
    useState<LlmProviderSettings>(defaultLlmSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const { config: reminderConfig, error: reminderError, conflicts: reminderConflicts } = useReminderSync(vaultRoot.trim(), settingsLoaded);
  const [startupMigrationPath, setStartupMigrationPath] = useState("");
  const [editorPaintReady, setEditorPaintReady] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    () => {
      if (typeof window === "undefined") return "system";
      return readStoredThemePreference(window.localStorage);
    },
  );
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
    if (typeof window === "undefined") return "default";
    return readStoredColorTheme(window.localStorage);
  });
  const [defaultCategory, setDefaultCategory] = useState("knowledge");
  const [baseFontSize, setBaseFontSize] = useState<number>(() => {
    if (typeof window === "undefined") return 16;
    const stored = window.localStorage.getItem(BASE_FONT_SIZE_KEY);
    return stored ? parseInt(stored, 10) : 16;
  });
  const [fontFamily, setFontFamily] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(FONT_FAMILY_KEY) || "";
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [promptConfig, setPromptConfig] = useState<PromptRequest | null>(null);

  const safePrompt = useCallback((message: string, defaultValue = "") => {
    return new Promise<string | null>((resolve) => {
      setPromptConfig({ message, defaultValue, resolve });
    });
  }, []);
  const categoryFilterRef = useRef<HTMLDetailsElement>(null);
  const loadSequenceRef = useRef(0);
  const loadedRootRef = useRef(initialWorkspace.vaultRoot);
  const saveQueueRef = useRef(createSerialQueue());
  const closeRequestInProgressRef = useRef(false);
  const activeNoteRef = useRef<Note | undefined>(undefined);
  const autoSaveOnExitRef = useRef(false);
  const noteHistoryNavigationRef = useRef(false);
  const [noteHistory, setNoteHistory] = useState<string[]>([]);
  const [noteHistoryIndex, setNoteHistoryIndex] = useState(-1);
  const previousViewRef = useRef<{
    view: WorkspaceView;
    category: string;
    path: string;
  }>({ view: "search", category: "journal", path: "" });

  const toggleSpecialView = useCallback(
    (view: "archive" | "trash" | "calendar" | "todo") => {
      if (activeView === view) {
        setActiveView(previousViewRef.current.view);
        setActiveCategory(previousViewRef.current.category);
        setActivePath(previousViewRef.current.path);
      } else {
        if (
          activeView !== "archive" &&
          activeView !== "trash" &&
          activeView !== "calendar" &&
          activeView !== "todo"
        ) {
          previousViewRef.current = {
            view: activeView,
            category: activeCategory,
            path: activePath,
          };
        }
        setActiveView(view);
        if (view === "todo") setActivePath("");
      }
    },
    [activeView, activeCategory, activePath],
  );
  const activeNote = activePath
    ? notes.find((note) => note.path === activePath)
    : undefined;
  const mindMapActive = activeNote?.frontmatter?.[MINDMAP_KEY] !== undefined;
  const rightPanelVisible = rightSidebarVisible && !mindMapActive;

  useEffect(() => {
    setEditorPaintReady(false);
    if (
      !settingsLoaded ||
      !activeNote ||
      startupMigrationPath === activeNote.path
    )
      return;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setEditorPaintReady(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [activeNote?.path, settingsLoaded, startupMigrationPath]);

  useEffect(() => {
    activeNoteRef.current = activeNote;
  }, [activeNote]);

  useEffect(() => {
    if (!activePath) return;
    if (noteHistoryNavigationRef.current) {
      noteHistoryNavigationRef.current = false;
      return;
    }
    setNoteHistory((current) => [
      ...current.slice(0, noteHistoryIndex + 1),
      activePath,
    ]);
    setNoteHistoryIndex(noteHistoryIndex + 1);
  }, [activePath]);

  useEffect(() => {
    autoSaveOnExitRef.current = autoSaveOnExit;
  }, [autoSaveOnExit]);

  const saveState: SaveState = !vaultRoot.trim()
    ? "demo"
    : saveError
      ? "error"
      : isSaving
        ? "saving"
        : activeNote?.isDirty
          ? "dirty"
          : "saved";

  useEffect(() => {
    setSaveError(false);
  }, [activePath]);

  const effectiveTheme = useMemo(
    () => getEffectiveTheme(themePreference, systemPrefersDark),
    [systemPrefersDark, themePreference],
  );
  const themeDatasetValue = useMemo(
    () => getThemeDatasetValue(effectiveTheme, colorTheme),
    [effectiveTheme, colorTheme],
  );
  const categoryOptions = useMemo(() => groupByCategory(notes), [notes]);
  const searchCategorySet = useMemo(
    () => new Set(selectedSearchCategories),
    [selectedSearchCategories],
  );
  const searchScopeLabel =
    selectedSearchCategories.length === 0
      ? t("app.allCategories")
      : selectedSearchCategories.length === 1
        ? selectedSearchCategories[0]
        : t("app.categoriesCount", { count: selectedSearchCategories.length });
  const totalWords = useMemo(
    () => notes.reduce((sum, note) => sum + note.wordCount, 0),
    [notes],
  );
  const saveLabel = {
    loading: t("app.loading"),
    demo: t("app.demoOnly"),
    dirty: t("app.unsavedChanges"),
    saving: t("app.saving"),
    saved: t("app.saved"),
    error: t("app.saveFailed"),
  }[saveState];

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(query.matches);
    query.addEventListener("change", updateSystemTheme);
    return () => {
      query.removeEventListener("change", updateSystemTheme);
    };
  }, []);

  useLayoutEffect(() => {
    window.localStorage.setItem(THEME_PREFERENCE_KEY, themePreference);
    window.localStorage.setItem(COLOR_THEME_KEY, colorTheme);
    window.localStorage.setItem(BASE_FONT_SIZE_KEY, baseFontSize.toString());
    window.localStorage.setItem(FONT_FAMILY_KEY, fontFamily);
    document.documentElement.dataset.theme = getThemeDatasetValue(
      effectiveTheme,
      colorTheme,
    );
    document.documentElement.dataset.themePreference = themePreference;
    document.documentElement.style.colorScheme = effectiveTheme;
    document.documentElement.style.setProperty(
      "--font-size-base",
      `${baseFontSize}px`,
    );
    if (fontFamily) {
      document.documentElement.style.setProperty(
        "--font-family-base",
        fontFamily,
      );
    } else {
      document.documentElement.style.removeProperty("--font-family-base");
    }
  }, [effectiveTheme, themePreference, colorTheme, baseFontSize, fontFamily]);

  const loadVaultFromDisk = useCallback(
    async (
      root: string,
      reason = tRef.current("status.vaultRefreshed"),
      preferredPath = "",
    ) => {
      const trimmedRoot = root.trim();
      if (!trimmedRoot) return;
      const sequence = ++loadSequenceRef.current;
      const sameVault = loadedRootRef.current === trimmedRoot;
      if (!sameVault && loadedRootRef.current) {
        const previousRoot = loadedRootRef.current;
        await saveQueueRef.current(() => saveNoteDrafts(previousRoot, notesRef.current.filter((note) => note.isDirty)));
      }
      const loadedNotes = await scanVaultAndRebuildIndex(trimmedRoot);
      const drafts = !sameVault ? await loadNoteDrafts(trimmedRoot) : [];
      if (sequence !== loadSequenceRef.current) return;
      loadedRootRef.current = trimmedRoot;
      setVaultRoot(trimmedRoot);
      setVaultPathInput(trimmedRoot);
      setNotes((current) => mergeDiskNotes(sameVault ? current : drafts.map((note) => ({ ...note, isDirty: true })), loadedNotes));
      setLinkVersion((current) => current + 1);
      setActivePath((current) => {
        if (
          preferredPath &&
          loadedNotes.some((note) => note.path === preferredPath)
        )
          return preferredPath;
        if (loadedNotes.some((note) => note.path === current)) return current;
        return loadedNotes[0]?.path ?? "";
      });
      setSaveError(false);
      setStatus(reason);
    },
    [],
  );

  const restoreVaultOnStartup = useCallback(
    async (
      root: string,
      reason: string,
      preferredPath = "",
    ) => {
      const trimmedRoot = root.trim();
      if (!trimmedRoot) return;
      const sequence = ++loadSequenceRef.current;

      let cachedNotes: Note[] | null = null;
      try {
        cachedNotes = await loadIndexedVault(trimmedRoot);
      } catch (error) {
        console.warn("Failed to restore cached vault index", error);
      }

      if (sequence !== loadSequenceRef.current) return;

      if (cachedNotes === null) {
        await loadVaultFromDisk(trimmedRoot, reason, preferredPath);
        const recovered = await loadNoteDrafts(trimmedRoot);
        if (loadedRootRef.current === trimmedRoot) setNotes((current) => mergeDiskNotes(mergeDiskNotes(current, recovered.map((note) => ({ ...note, isDirty: true }))), current));
        return;
      }

      const recovered = await loadNoteDrafts(trimmedRoot);
      if (sequence !== loadSequenceRef.current) return;
      loadedRootRef.current = trimmedRoot;
      setVaultPathInput(trimmedRoot);
      setNotes(mergeDiskNotes(recovered.map((note) => ({ ...note, isDirty: true })), cachedNotes));
      setActivePath((current) => {
        if (
          preferredPath &&
          cachedNotes.some((note) => note.path === preferredPath)
        )
          return preferredPath;
        if (cachedNotes.some((note) => note.path === current)) return current;
        return cachedNotes[0]?.path ?? "";
      });
      setSaveError(false);
      setStatus(reason);

      const cachedActiveNote =
        cachedNotes.find((note) => note.path === preferredPath) ??
        cachedNotes[0];
      const migrationPath = cachedActiveNote?.body.includes("data:image/")
        ? cachedActiveNote.path
        : "";
      setStartupMigrationPath(migrationPath);

      void (async () => {
        try {
          if (migrationPath) {
            const migrated = await migrateNoteImages({
              vaultRoot: trimmedRoot,
              notePath: migrationPath,
            });
            if (migrated) {
              setNotes((current) =>
                current.map((note) =>
                  note.path === migrated.path
                    ? { ...migrated, isDirty: false }
                    : note,
                ),
              );
            }
          }
        } catch (error) {
          console.error("Failed to migrate embedded note images", error);
        } finally {
          setStartupMigrationPath("");
        }

        if (sequence === loadSequenceRef.current) await loadVaultFromDisk(trimmedRoot, reason, preferredPath);
      })().catch((error) => {
        setSaveError(true);
        setStatus(error instanceof Error ? error.message : String(error));
      });
    },
    [loadVaultFromDisk],
  );

  const loadDemoWorkspace = useCallback(() => {
    setNotes(demoNotes);
    setActivePath(demoNotes[0]?.path ?? "");
    setVaultRoot("");
    setSaveError(false);
    setStatus(tRef.current("status.demoLoaded"));
  }, []);

  const refreshVaultFromDisk = useCallback(
    async (reason = tRef.current("status.vaultRefreshed")) => {
      await loadVaultFromDisk(vaultRoot, reason);
    },
    [loadVaultFromDisk, vaultRoot],
  );

  useEffect(() => {
    let cancelled = false;

    loadUserSettings()
      .then(async (savedSettings) => {
        if (cancelled) return;

        try {
          const [tocOpen, tocNum, viewMode, tocWidth, metadataWidth] = await Promise.all([
            getSetting("mdxeditor-toc-open"),
            getSetting("mdxeditor-toc-numbering"),
            getSetting("mdxeditor-view-mode"),
            getSetting("mdxeditor-toc-width"),
            getSetting("mdxeditor-metadata-width"),
          ]);
          if (tocWidth !== null)
            window.localStorage.setItem("mdxeditor-toc-width", tocWidth);
          if (metadataWidth !== null)
            window.localStorage.setItem("mdxeditor-metadata-width", metadataWidth);
          if (tocOpen !== null)
            window.localStorage.setItem("mdxeditor-toc-open", tocOpen);
          if (tocNum !== null)
            window.localStorage.setItem("mdxeditor-toc-numbering", tocNum);
          if (viewMode !== null)
            window.localStorage.setItem("mdxeditor-view-mode", viewMode);
        } catch (e) {
          console.error("Failed to pre-hydrate editor settings", e);
        }

        const legacyVaultRoot =
          window.localStorage.getItem(LAST_VAULT_KEY) ?? "";
        const legacyActivePath =
          window.localStorage.getItem(LAST_ACTIVE_PATH_KEY) ?? "";
        const vaultRootFromSettings =
          savedSettings.vaultRoot || legacyVaultRoot;
        if (vaultRootFromSettings) {
          setVaultRoot(vaultRootFromSettings);
        }

        let llmSettingsFromStorage = savedSettings.llmSettings;
        if (savedSettings.defaultCategory) {
          setDefaultCategory(savedSettings.defaultCategory);
        }
        if (savedSettings.activeView) {
          setActiveView(savedSettings.activeView);
        }
        if (savedSettings.activeCategory) {
          setActiveCategory(savedSettings.activeCategory);
        }
        if (savedSettings.selectedSearchCategories) {
          setSelectedSearchCategories(savedSettings.selectedSearchCategories);
        }
        if (savedSettings.leftSidebarVisible !== undefined)
          setLeftSidebarVisible(savedSettings.leftSidebarVisible);
        if (savedSettings.rightSidebarVisible !== undefined)
          setRightSidebarVisible(savedSettings.rightSidebarVisible);
        if (savedSettings.leftSidebarWidth !== undefined)
          setLeftSidebarWidth(savedSettings.leftSidebarWidth);
        if (savedSettings.rightSidebarWidth !== undefined)
          setRightSidebarWidth(savedSettings.rightSidebarWidth);
        if (savedSettings.showTodayNoteButton !== undefined)
          setShowTodayNoteButton(savedSettings.showTodayNoteButton);
        if (savedSettings.lockUpdateTime !== undefined)
          setLockUpdateTime(savedSettings.lockUpdateTime);
        if (savedSettings.autoSaveOnExit !== undefined)
          setAutoSaveOnExit(savedSettings.autoSaveOnExit);
        if (savedSettings.fontFamily !== undefined)
          setFontFamily(savedSettings.fontFamily);
        const savedLlmSettings = window.localStorage.getItem(LLM_SETTINGS_KEY);
        const hasStoredLlmSettings =
          savedSettings.llmSettings.providerName !==
          defaultLlmSettings.providerName ||
          savedSettings.llmSettings.apiBaseUrl !==
          defaultLlmSettings.apiBaseUrl ||
          savedSettings.llmSettings.apiKey !== defaultLlmSettings.apiKey ||
          savedSettings.llmSettings.model !== defaultLlmSettings.model;
        if (!hasStoredLlmSettings && savedLlmSettings) {
          try {
            llmSettingsFromStorage = {
              ...defaultLlmSettings,
              ...JSON.parse(savedLlmSettings),
            };
          } catch {
            setStatus(tRef.current("status.llmSettingsReset"));
          }
        }
        setLlmSettings({ ...defaultLlmSettings, ...llmSettingsFromStorage });
        if (vaultRootFromSettings) {
          try {
            await restoreVaultOnStartup(
              vaultRootFromSettings,
              savedSettings.vaultRoot
                ? tRef.current("status.vaultRestored")
                : tRef.current("status.vaultMigrated"),
              savedSettings.activePath || legacyActivePath,
            );
          } catch (error) {
            setSaveError(true);
            setStatus(error instanceof Error ? error.message : String(error));
          }
        } else {
          loadDemoWorkspace();
        }
      })
      .catch(async () => {
        if (cancelled) return;
        const remembered = window.localStorage.getItem(LAST_VAULT_KEY);
        if (remembered) {
          setVaultRoot(remembered);
          try {
            await restoreVaultOnStartup(
              remembered,
              tRef.current("status.vaultRestored"),
              window.localStorage.getItem(LAST_ACTIVE_PATH_KEY) ?? "",
            );
          } catch (error) {
            setSaveError(true);
            setStatus(error instanceof Error ? error.message : String(error));
          }
        } else {
          loadDemoWorkspace();
        }
        const savedLlmSettings = window.localStorage.getItem(LLM_SETTINGS_KEY);
        if (savedLlmSettings) {
          try {
            setLlmSettings({
              ...defaultLlmSettings,
              ...JSON.parse(savedLlmSettings),
            });
          } catch {
            setStatus(tRef.current("status.llmSettingsReset"));
          }
        }
      })
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [loadDemoWorkspace, restoreVaultOnStartup]);

  useWorkspaceSettings(settingsLoaded, {
    vaultRoot: vaultRoot.trim(), activePath: vaultRoot.trim() ? activePath : "", activeView, activeCategory,
    selectedSearchCategories, llmSettings, defaultCategory, leftSidebarVisible, rightSidebarVisible,
    leftSidebarWidth, rightSidebarWidth, showTodayNoteButton, lockUpdateTime, autoSaveOnExit, fontFamily,
  }, setStatus);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("__TAURI_INTERNALS__" in window || "__TAURI_IPC__" in window)
    )
      return;

    const appWindow = getCurrentWindow();
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    let timeout: number | undefined;

    const saveState = async () => {
      try {
        const factor = await appWindow.scaleFactor();
        const size = await appWindow.innerSize();
        const logicalSize = size.toLogical(factor);
        const pos = await appWindow.innerPosition();
        const logicalPos = pos.toLogical(factor);
        const isMaximized = await appWindow.isMaximized();

        await saveWindowState({
          width: Math.round(logicalSize.width),
          height: Math.round(logicalSize.height),
          x: Math.round(logicalPos.x),
          y: Math.round(logicalPos.y),
          maximized: isMaximized,
        });
      } catch { }
    };

    const debouncedSave = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(saveState, 500);
    };

    appWindow.onResized(debouncedSave).then((u) => {
      unlistenResize = u;
    });
    appWindow.onMoved(debouncedSave).then((u) => {
      unlistenMove = u;
    });

    return () => {
      window.clearTimeout(timeout);
      unlistenResize?.();
      unlistenMove?.();
    };
  }, []);

  useVaultSync({ vaultRoot, notes, notesRef, activeNote, settingsLoaded, loadedRoot: loadedRootRef, vaultRef, queue: saveQueueRef, setNotes, setActivePath, setLinkVersion, setStatus });

  useEffect(() => {
    const unlistenPromise = listen("inote://empty-trash", async () => {
      if (!vaultRoot.trim()) return;

      // Yield to event loop to allow menu interaction to finish
      await new Promise((resolve) => setTimeout(resolve, 50));

      const confirmed = await safeConfirm(t("app.emptyTrashConfirm"));
      if (!confirmed) return;

      // Yield to event loop to allow macOS NSAlert dialog to close completely
      await new Promise((resolve) => setTimeout(resolve, 50));

      try {
        await emptyTrash(vaultRoot.trim());
        setNotes((current) =>
          current.filter((n) => !n.path.startsWith(".trash/")),
        );
        setIndexedResults((current) =>
          current.filter((n) => !n.path.startsWith(".trash/")),
        );
        setStatus(t("app.trashEmptied"));
        toast.show({ message: t("app.trashEmptied"), tone: "success" });
        setActivePath((current) =>
          current.startsWith(".trash/") ? "" : current,
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      unlistenPromise.then((dispose) => dispose()).catch(() => { });
    };
  }, [vaultRoot, safeConfirm, t, toast]);

  useEffect(() => {
    const unlistenPromise = listen("inote://rebuild-index", async () => {
      if (!vaultRoot.trim()) return;
      await rebuildSearchIndex(vaultRoot.trim(), true);
      await refreshVaultFromDisk(t("status.indexRebuilt"));
    });

    return () => {
      unlistenPromise.then((dispose) => dispose()).catch(() => { });
    };
  }, [vaultRoot, refreshVaultFromDisk, t]);

  useEffect(() => {
    const unlistenPromise = listen(OPEN_SETTINGS_EVENT, () => {
      setSettingsOpen(true);
    });

    return () => {
      unlistenPromise.then((dispose) => dispose()).catch(() => { });
    };
  }, []);

  const saveActiveNoteRef = useRef(saveActiveNote);
  useEffect(() => {
    saveActiveNoteRef.current = saveActiveNote;
  }, [saveActiveNote]);

  useEffect(() => {
    const unlistenPromise = listen("inote://save", () => {
      saveActiveNoteRef.current();
    });

    return () => {
      unlistenPromise.then((dispose) => dispose()).catch(() => { });
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("__TAURI_INTERNALS__" in window || "__TAURI_IPC__" in window)
    )
      return;

    const appWindow = getCurrentWindow();
    const unlistenPromise = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      if (closeRequestInProgressRef.current) return;

      closeRequestInProgressRef.current = true;
      setIsClosing(true);
      setIsSaving(true);
      try {
        const root = vaultRef.current.trim();
        if (root) {
          const close = await prepareWorkspaceClose({
            autoSave: autoSaveOnExitRef.current,
            getNotes: () => notesRef.current,
            save: (note) => saveNoteWithPathSyncRef.current(note),
            persistDrafts: (drafts) => saveQueueRef.current(() => saveNoteDrafts(root, drafts)),
            confirmClose: () => safeConfirm(tRef.current("confirm.quitWithDrafts")),
          });
          if (!close) { closeRequestInProgressRef.current = false; return; }
        }
        await quitApp();
      } catch (error) {
        closeRequestInProgressRef.current = false;
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setIsClosing(false);
        setIsSaving(false);
      }
    });

    return () => {
      unlistenPromise.then((dispose) => dispose()).catch(() => { });
    };
  }, []);

  const visibleNotes = useMemo(() => {
    const isSpecialCategory = (note: Pick<Note, "category" | "path">) =>
      note.category === "archive" ||
      note.category.startsWith("archive/") ||
      note.path.startsWith(".trash/");

    if (activeView === "archive") {
      return sortByUpdatedDesc(
        notes.filter(
          (note) =>
            note.category === "archive" || note.category.startsWith("archive/"),
        ),
      );
    }
    if (activeView === "trash") {
      return sortByUpdatedDesc(
        notes.filter((note) => note.path.startsWith(".trash/")),
      );
    }

    if (activeView === "search") {
      const matchesSearchScope = (note: Pick<Note, "category" | "path">) => {
        if (searchCategorySet.size === 0) {
          return !isSpecialCategory(note);
        }
        return (
          searchCategorySet.has(note.category) ||
          Array.from(searchCategorySet).some((category) =>
            note.category.startsWith(`${category}/`),
          )
        );
      };
      const textQuery = parsedQuery.indexQuery;
      const searchResults: Array<Note | SearchResult> =
        vaultRoot.trim() && textQuery.trim()
          ? indexedResults
          : rankLocalResults(searchNotes(notes, textQuery), textQuery);
      const hasFieldFilters = parsedQuery.folders.length > 0 || parsedQuery.statuses.length > 0;
      const notesByPath = hasFieldFilters ? new Map(notes.map((note) => [note.path, note])) : null;
      return searchResults.filter((result) => {
        if (!matchesSearchScope(result)) return false;
        if (!notesByPath) return true;
        const note = notesByPath.get(result.path) ?? result;
        return matchesSearchFilters({ category: note.category, status: "status" in note ? note.status : undefined }, parsedQuery);
      });
    }
    if (activeView === "today")
      return getTodayNote(notes)
        ? [getTodayNote(notes)!]
        : sortByUpdatedDesc(notes.filter((n) => !isSpecialCategory(n))).slice(
          0,
          5,
        );
    if (activeView === "category")
      return filterNotesByCategory(notes, activeCategory);
    if (activeView === "todo") {
      const priorityWeights: Record<string, number> = {
        high: 3,
        medium: 2,
        low: 1,
        none: 0,
      };
      const todoNotes = notes.filter(
        (n) =>
          !isSpecialCategory(n) &&
          (n.status === "todo" ||
            n.status === "in_progress" ||
            n.status === "done" ||
            (n.due && n.status !== "cancelled")),
      );
      return todoNotes.sort((a, b) => {
        // Sort by due date
        if (a.due && b.due) {
          const aDue = a.due.localeCompare(b.due);
          if (aDue !== 0) return aDue;
        } else if (a.due) {
          return -1;
        } else if (b.due) {
          return 1;
        }

        // Sort by priority
        const aPri = priorityWeights[a.priority ?? "none"] ?? 0;
        const bPri = priorityWeights[b.priority ?? "none"] ?? 0;
        if (aPri !== bPri) return bPri - aPri; // high to low

        // Sort by update date
        return b.updatedAt.localeCompare(a.updatedAt);
      });
    }

    return sortByUpdatedDesc(notes.filter((n) => !isSpecialCategory(n)));
  }, [
    activeCategory,
    activeView,
    indexedResults,
    notes,
    parsedQuery,
    searchCategorySet,
    vaultRoot,
  ]);
  const visibleNotesRef = useRef(visibleNotes);
  visibleNotesRef.current = visibleNotes;

  const [renderedCount, setRenderedCount] = useState(NOTES_PAGE_SIZE);
  const initialScrollDoneRef = useRef(false);

  // Reset rendered count when the view/category/search switch
  useEffect(() => {
    setRenderedCount(NOTES_PAGE_SIZE);
  }, [activeView, activeCategory, query, selectedSearchCategories, vaultRoot]);

  // Initial scroll to active note
  useEffect(() => {
    if (
      settingsLoaded &&
      visibleNotes.length > 0 &&
      !initialScrollDoneRef.current
    ) {
      const activeIndex = visibleNotes.findIndex((n) => n.path === activePath);
      if (activeIndex !== -1) {
        initialScrollDoneRef.current = true;
        if (activeIndex >= renderedCount) {
          setRenderedCount(activeIndex + 20);
        }
        window.setTimeout(() => {
          const activeElement = document.querySelector(
            ".note-card.active, .note-row.active",
          );
          if (activeElement) {
            activeElement.scrollIntoView({
              block: "center",
              behavior: "smooth",
            });
          }
        }, 150);
      } else if (notes.length > 0) {
        initialScrollDoneRef.current = true;
      }
    }
  }, [settingsLoaded, visibleNotes, activePath, renderedCount, notes.length]);

  const handleNoteListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 400) {
      if (renderedCount < visibleNotes.length) {
        setRenderedCount((current) =>
          Math.min(current + NOTES_PAGE_SIZE, visibleNotes.length),
        );
      }
    }
  }, [renderedCount, visibleNotes.length]);

  const visibleNoteGroups = useMemo<NoteGroup[]>(() => {
    const sliced = visibleNotes.slice(0, renderedCount);
    if (activeView === "todo") {
      const today = localDateString();
      const groups: Record<string, Array<Note | SearchResult>> = {
        overdue: [],
        dueToday: [],
        upcoming: [],
        noDueDate: [],
        recentlyCompleted: [],
      };

      for (const note of sliced) {
        if ("status" in note && note.status === "done") {
          groups.recentlyCompleted.push(note);
        } else if ("due" in note && note.due) {
          const dueDate = note.due.slice(0, 10);
          if (dueDate < today) {
            groups.overdue.push(note);
          } else if (dueDate === today) {
            groups.dueToday.push(note);
          } else {
            groups.upcoming.push(note);
          }
        } else {
          groups.noDueDate.push(note);
        }
      }

      return Object.entries(groups)
        .map(([id, groupNotes]) => ({
          id,
          label: t(`todo.${id}`),
          notes: groupNotes,
          isCollapsed: id === "recentlyCompleted",
        }))
        .filter((group) => group.notes.length > 0);
    }

    const groups = new Map<string, Array<Note | SearchResult>>();
    for (const note of sliced) {
      const dateToUse = note.updatedAt || note.createdAt;
      const month = dateToUse.slice(0, 7);
      groups.set(month, [...(groups.get(month) ?? []), note]);
    }
    return Array.from(groups.entries())
      .map(([month, groupedNotes]) => ({
        id: month,
        label: month,
        notes: groupedNotes,
        isCollapsed: false,
      }))
      .sort((a, b) => b.id.localeCompare(a.id));
  }, [visibleNotes, renderedCount, activeView, t]);

  const handleNoteListKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      if (visibleNotes.length === 0) return;
      const currentIndex = visibleNotes.findIndex((n) => n.path === activePath);
      if (currentIndex === -1) {
        setActivePath(visibleNotes[0].path);
        return;
      }

      let nextIndex = currentIndex;
      if ((e.key === "ArrowDown" || e.key === "ArrowRight") && currentIndex < visibleNotes.length - 1) {
        nextIndex = currentIndex + 1;
      } else if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && currentIndex > 0) {
        nextIndex = currentIndex - 1;
      }

      if (nextIndex !== currentIndex) {
        if (nextIndex >= renderedCount) {
          setRenderedCount((current) => Math.min(current + NOTES_PAGE_SIZE, visibleNotes.length));
        }
        setActivePath(visibleNotes[nextIndex].path);
      }
    }
  }, [visibleNotes, activePath, renderedCount]);

  const existingNotePaths = useMemo(
    () => new Set(notes.map((note) => note.path)),
    [notes],
  );
  const previousHistoryIndex = useMemo(() => {
    for (let index = noteHistoryIndex - 1; index >= 0; index -= 1) {
      if (existingNotePaths.has(noteHistory[index])) return index;
    }
    return -1;
  }, [existingNotePaths, noteHistory, noteHistoryIndex]);
  const nextHistoryIndex = noteHistory.findIndex(
    (path, index) => index > noteHistoryIndex && existingNotePaths.has(path),
  );

  const navigateNoteHistory = useCallback(
    (index: number) => {
      const path = noteHistory[index];
      if (!path || !existingNotePaths.has(path)) return;
      noteHistoryNavigationRef.current = true;
      setNoteHistoryIndex(index);
      setActivePath(path);
    },
    [existingNotePaths, noteHistory],
  );

  const activeNotePath = activeNote?.path;

  useEffect(() => {
    if (!activeNotePath || !vaultRoot.trim()) {
      setNoteLinks({ outgoing: [], backlinks: [] });
      return;
    }
    let cancelled = false;
    getNoteLinks({ vaultRoot: vaultRoot.trim(), path: activeNotePath })
      .then((links) => {
        if (!cancelled) setNoteLinks(links);
      })
      .catch(() => {
        if (!cancelled) setNoteLinks({ outgoing: [], backlinks: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [activeNotePath, linkVersion, vaultRoot]);

  function updateActiveNote(fullContent: string) {
    if (!activeNote) return;
    let parsed: ReturnType<typeof parseMarkdownWithFrontmatter>;
    try { parsed = parseMarkdownWithFrontmatter(fullContent); }
    catch (error) {
      setNotes((current) => current.map((note) => note.path === activeNote.path ? { ...note, rawMarkdown: fullContent, isDirty: true } : note));
      setSaveError(true);
      setStatus(String(error));
      return;
    }
    const { body, metadata } = parsed;
    const hasChanges = hasNoteChanges(activeNote, { body, metadata });

    if (!hasChanges && activeNote.rawMarkdown === undefined) {
      return;
    }

    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            ...metadata,
            body,
            rawMarkdown: undefined,
            updatedAt: metadata.updatedAt && metadata.updatedAt !== note.updatedAt ? metadata.updatedAt : (lockUpdateTime ? note.updatedAt : localDateString()),
            wordCount: body.trim() ? body.trim().split(/\s+/).length : 0,
            isDirty: true,
          }
          : note,
      ),
    );
  }

  function updateActiveNoteTitle(title: string) {
    if (!activeNote) return;
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            title,
            updatedAt: lockUpdateTime ? note.updatedAt : localDateString(),
            isDirty: true,
          }
          : note,
      ),
    );
  }

  function updateActiveNoteCreatedAt(createdAt: string) {
    if (!activeNote) return;
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            createdAt,
            updatedAt: lockUpdateTime ? note.updatedAt : localDateString(),
            isDirty: true,
          }
          : note,
      ),
    );
  }

  function updateActiveNoteUpdatedAt(updatedAt: string) {
    if (!activeNote) return;
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            updatedAt,
            isDirty: true,
          }
          : note,
      ),
    );
  }

  function updateActiveNoteDue(due: string) {
    if (!activeNote) return;
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            due,
            updatedAt: lockUpdateTime ? note.updatedAt : localDateString(),
            isDirty: true,
          }
          : note,
      ),
    );
  }

  function updateActiveNoteReminder(reminder: string) {
    if (!activeNote) return;
    setNotes((current) => current.map((note) => note.path === activeNote.path ? {
      ...note,
      frontmatter: { ...note.frontmatter, reminder },
      updatedAt: lockUpdateTime ? note.updatedAt : localDateString(),
      isDirty: true,
    } : note));
  }

  function updateActiveNoteStatus(status: string) {
    if (!activeNote) return;
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            status,
            updatedAt: lockUpdateTime ? note.updatedAt : localDateString(),
            isDirty: true,
          }
          : note,
      ),
    );
  }

  function updateActiveNotePriority(priority: string) {
    if (!activeNote) return;
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            priority,
            updatedAt: lockUpdateTime ? note.updatedAt : localDateString(),
            isDirty: true,
          }
          : note,
      ),
    );
  }

  function updateActiveNoteProject(project: string) {
    if (!activeNote) return;
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            project,
            updatedAt: lockUpdateTime ? note.updatedAt : localDateString(),
            isDirty: true,
          }
          : note,
      ),
    );
  }

  function updateActiveNoteTags(value: string) {
    if (!activeNote) return;
    const tags = value
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean)
      .filter((tag, index, all) => all.indexOf(tag) === index);
    setNotes((current) =>
      current.map((note) =>
        note.path === activeNote.path
          ? {
            ...note,
            tags,
            updatedAt: lockUpdateTime ? note.updatedAt : localDateString(),
            isDirty: true,
          }
          : note,
      ),
    );
  }

  async function openVault() {
    if (!vaultPathInput.trim()) {
      setStatus(t("status.enterVaultPath"));
      return;
    }
    try {
      await loadVaultFromDisk(vaultPathInput.trim(), t("status.vaultOpened"));
      window.localStorage.setItem(LAST_VAULT_KEY, vaultPathInput.trim());
      setSaveError(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function initVault() {
    if (!vaultPathInput.trim()) {
      setStatus(t("status.enterVaultPath"));
      return;
    }
    try {
      await initializeVault(vaultPathInput.trim());
      await loadVaultFromDisk(vaultPathInput.trim(), t("status.vaultInitialized"));
      window.localStorage.setItem(LAST_VAULT_KEY, vaultPathInput.trim());
      setSaveError(false);
      setStatus(t("status.vaultInitialized"));
    } catch (error) {
      setSaveError(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveActiveNote(): Promise<boolean> {
    if (closeRequestInProgressRef.current) return false;
    const savingRoot = vaultRef.current.trim();
    if (!activeNote || !vaultRoot.trim()) {
      setStatus(t("status.openVaultFirst"));
      return false;
    }
    try {
      setIsSaving(true);

      let noteToSave = { ...activeNote };

      if (noteToSave.title === "无标题" || noteToSave.title === "Untitled") {
        const firstH1Match = noteToSave.body.match(/^#\s+(.+)$/m);
        if (firstH1Match && firstH1Match[1].trim()) {
          noteToSave.title = firstH1Match[1].trim();
        } else {
          const now = new Date();
          const timestamp =
            now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, "0") +
            String(now.getDate()).padStart(2, "0") +
            String(now.getHours()).padStart(2, "0") +
            String(now.getMinutes()).padStart(2, "0") +
            String(now.getSeconds()).padStart(2, "0");
          const randomDigits = Math.floor(1000 + Math.random() * 9000);
          noteToSave.title = `${timestamp}-${randomDigits}`;
        }
      }

      const saved = await saveNoteWithPathSync(noteToSave, undefined, activeNote);
      if (savingRoot !== vaultRef.current.trim()) return true;
      setLinkVersion((current) => current + 1);
      if (activeNote.path !== saved.path) setActivePath((path) => path === activeNote.path ? saved.path : path);
      if (activeNoteRef.current?.path === activeNote.path) setActiveCategory(saved.category);
      setSaveError(false);
      setStatus(t("status.saved", { path: saved.path }));
      return true;
    } catch (error) {
      setSaveError(true);
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function saveNoteWithPathSync(note: Note, agent?: NoteCommitInput['agent'], submitted = note): Promise<Note> {
    const root = vaultRef.current.trim();
    return saveQueueRef.current(async () => {
      if (root !== vaultRef.current.trim()) throw new Error(t("errors.vaultChanged"));
      const saved = await commitNote({
        vaultRoot: root,
        path: note.path,
        targetPath: noteSavePath(note),
        expectedRevision: note.sourceRevision,
        content: noteToMarkdown(note),
        agent,
      });
      if (root === vaultRef.current.trim()) setNotes((current) => acknowledgeSave(current, submitted, saved));
      return saved;
    });
  }
  const saveNoteWithPathSyncRef = useRef(saveNoteWithPathSync);
  saveNoteWithPathSyncRef.current = saveNoteWithPathSync;

  async function applyAgentCurrentNote(result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) {
    const before = activeNoteRef.current;
    if (!before || !vaultRef.current.trim()) throw new Error(t("status.openVaultFirst"));
    const root = vaultRef.current;
    const change = buildAgentNoteCommit(before, result, selectedOperationIndexes, turnId, sessionId, lockUpdateTime ? before.updatedAt : localDateString(), false);
    setIsSaving(true);
    try {
      const saved = await saveNoteWithPathSync(change.note, change.agent, before);
      if (vaultRef.current !== root) return;
      setLinkVersion((version) => version + 1);
      setActivePath((path) => path === before.path ? saved.path : path);
      setSaveError(false);
      setStatus(t("status.agentUpdated", { fields: change.changedFields.join(", ") || t("status.noteFallback") }));
    } catch (error) {
      setSaveError(true);
      setStatus(String(error));
      throw error;
    } finally { setIsSaving(false); }
  }

  async function checkExternalActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus(t("status.openVaultFirst"));
      return;
    }
    try {
      const diskNote = await readNote(vaultRoot.trim(), activeNote.path);
      const changedOnDisk = diskNote.sourceRevision !== activeNote.sourceRevision;

      if (!changedOnDisk) {
        setStatus(t("status.diskMatches"));
        toast.show({ message: t("status.diskMatches") });
        return;
      }

      const reload = await safeConfirm(
        t("confirm.reloadFromDisk", { path: activeNote.path }),
      );
      if (!reload) {
        setStatus(t("status.keptEditorVersion"));
        setNotes((current) =>
          current.map((note) =>
            note.path === diskNote.path ? { ...note, isDirty: true, sourceRevision: diskNote.sourceRevision } : note,
          ),
        );
        return;
      }

      setNotes((current) =>
        current.map((note) => (note.path === diskNote.path ? diskNote : note)),
      );
      setSaveError(false);
      setStatus(t("status.reloaded", { path: diskNote.path }));
    } catch (error) {
      setSaveError(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function archiveActiveInboxNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus(t("status.openVaultFirst"));
      return;
    }
    if (!activeNote.path.startsWith("00-inbox/")) {
      setStatus(t("status.inboxOnly"));
      return;
    }
    const title = await safePrompt(t("prompt.archiveTitle"), activeNote.title);
    if (!title) return;
    const category = await safePrompt(
      t("prompt.archiveCategory"),
      activeCategory && activeCategory !== "00-inbox"
        ? activeCategory
        : "knowledge",
    );
    if (!category) return;
    try {
      const before = activeNote;
      const root = vaultRef.current.trim();
      const targetPath = newNotePath(title, category, notesRef.current.filter((note) => note.path !== before.path).map((note) => note.path));
      const next = { ...before, title, category, tags: before.tags.filter((tag) => tag !== "inbox") };
      const archived = await saveQueueRef.current(() => commitNote({ vaultRoot: root, path: before.path, targetPath, expectedRevision: before.sourceRevision, content: noteToMarkdown(next) }));
      if (vaultRef.current.trim() !== root) return;
      setLinkVersion((current) => current + 1);
      setNotes((current) => acknowledgeSave(current, before, archived));
      setActivePath(archived.path);
      setActiveCategory(archived.category);
      setActiveView("category");
      setSaveError(false);
      setStatus(t("status.archivedTo", { path: archived.path }));
    } catch (error) {
      setSaveError(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function addTodayNote() {
    if (!vaultRoot.trim()) {
      setStatus(t("status.openVaultFirst"));
      toast.show({ message: t("status.openVaultFirst"), tone: "error" });
      return;
    }

    const fallbackCategory =
      categoryOptions.length > 0 ? categoryOptions[0].name : "journal";
    let category = defaultCategory || fallbackCategory;
    if (activeView === "category") {
      category = activeCategory;
    } else if (
      activeView === "search" &&
      selectedSearchCategories.length === 1
    ) {
      category = selectedSearchCategories[0];
    }

    try {
      const note = await createTodayNote(vaultRoot.trim(), category);
      setLinkVersion((current) => current + 1);
      setNotes((current) => mergeDiskNotes(current, [note, ...current.filter((item) => item.path !== note.path)]));
      setActivePath(note.path);
      setActiveCategory(note.category);
      setActiveView("category");
      setSaveError(false);
      setStatus(t("status.opened", { path: note.path }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function addCategoryNote() {
    if (!vaultRoot.trim()) {
      setStatus(t("status.openVaultFirst"));
      toast.show({ message: t("status.openVaultFirst"), tone: "error" });
      return;
    }
    const title = "无标题";
    const fallbackCategory =
      categoryOptions.length > 0 ? categoryOptions[0].name : "knowledge";

    let category = defaultCategory || fallbackCategory;
    if (activeView === "category") {
      category = activeCategory;
    } else if (
      activeView === "search" &&
      selectedSearchCategories.length === 1
    ) {
      category = selectedSearchCategories[0];
    }

    try {
      const note = await createNote({
        vaultRoot: vaultRoot.trim(),
        title,
        category,
      });
      setLinkVersion((current) => current + 1);
      setNotes((current) => [note, ...current]);
      setActivePath(note.path);
      setActiveCategory(note.category);
      setActiveView("category");
      setSaveError(false);
      setStatus(t("status.created", { path: note.path }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function createMindMapNote(item: MapCreation) {
    const target = mindMapTarget;
    if (!target?.root || vaultRef.current.trim() !== target.root) throw new Error(t("mindmap.openVault"));
    const saved = await saveQueueRef.current(async () => {
      if (vaultRef.current.trim() !== target.root) throw new Error(t("mindmap.openVault"));
      // Imported root text may be a paragraph; keep filenames within filesystem limits.
      const fileTitle = Array.from(item.title.split(/\r?\n/)[0]).slice(0, 60).join("");
      const path = newNotePath(fileTitle, target.category, notesRef.current.map(note => note.path));
      const date = localDateString();
      const note: Note = withMindMap({ path, title: item.title, category: target.category, tags: [], createdAt: date, updatedAt: date, body: "", wordCount: 0 }, item.map);
      return commitNote({ vaultRoot: target.root, path, create: true, content: noteToMarkdown(note) });
    });
    if (vaultRef.current.trim() !== target.root) return;
    setNotes(current => [saved, ...current.filter(note => note.path !== saved.path)]);
    setActivePath(saved.path);
    setActiveCategory(saved.category);
    setActiveView("category");
    setLinkVersion(version => version + 1);
    setSaveError(false);
    setStatus(t("mindmap.created", { path: saved.path }));
  }

  async function createAgentNote(result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) {
    const before = activeNoteRef.current;
    const root = vaultRef.current.trim();
    if (!before || !root) throw new Error(t("status.openVaultFirst"));
    const change = buildAgentNoteCommit(before, result, selectedOperationIndexes, turnId, sessionId, localDateString(), true, notesRef.current.map((note) => note.path));
    const saved = await saveQueueRef.current(() => commitNote({ vaultRoot: root, path: change.note.path, create: true, content: noteToMarkdown(change.note), agent: change.agent, sourceCheck: before.sourceRevision ? { path: before.path, revision: before.sourceRevision } : undefined }));
    if (vaultRef.current.trim() !== root) return;
    setNotes((current) => [saved, ...current.filter((note) => note.path !== saved.path)]);
    setLinkVersion((version) => version + 1);
    setActivePath((path) => path === before.path ? saved.path : path);
    setSaveError(false);
    setStatus(t("status.agentCreated", { path: saved.path }));
  }

  async function undoLastAgentApply() {
    const before = activeNoteRef.current;
    const root = vaultRef.current.trim();
    if (!before || !root) throw new Error(t("status.openVaultFirst"));
    const snapshot = await loadLastAgentUndoSnapshot({ vaultRoot: root, notePath: before.path });
    if (!snapshot) throw new Error(t("errors.noAgentUndo"));
    if (notesRef.current.some((note) => note.isDirty && (note.path === before.path || note.path === snapshot.createdNotePath))) throw new Error(t("errors.saveBeforeAgentUndo"));
    const result = await saveQueueRef.current(() => undoAgentChange(root, before.path));
    if (vaultRef.current.trim() !== root) return;
    setNotes((current) => {
      const remaining = current.filter((note) => note.path !== result.removedPath);
      return result.restored ? acknowledgeSave(remaining, before, result.restored) : remaining;
    });
    setActivePath((path) => path === before.path || path === result.removedPath ? result.activePath : path);
    setLinkVersion((version) => version + 1);
    setSaveError(false);
    setStatus(t("status.agentUndone"));
  }

  async function addFolder() {
    if (!vaultRoot.trim()) {
      setStatus(t("status.openVaultFirst"));
      toast.show({ message: t("status.openVaultFirst"), tone: "error" });
      return;
    }
    const path = await safePrompt(
      t("prompt.folderPath"),
      activeCategory || "knowledge/new-topic",
    );
    if (!path) return;
    try {
      await createFolder({ vaultRoot: vaultRoot.trim(), path });
      setActiveCategory(path);
      setActiveView("category");
      setStatus(t("status.folderCreated", { path }));
      toast.show({ message: t("status.folderCreated", { path }), tone: "success" });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteNoteByPath(path: string) {
    if (!vaultRoot.trim()) {
      setStatus(t("status.openVaultFirst"));
      return;
    }
    const isTrash = path.startsWith(".trash/");
    const note = notesRef.current.find((item) => item.path === path);
    if (isTrash && !(await safeConfirm(t("confirm.permanentDelete", { title: note?.title ?? path })))) return;
    if (!isTrash && note?.isDirty && !(await safeConfirm(t("confirm.deleteDirty", { title: note.title })))) return;
    try {
      const trashedPath = await deleteNote(vaultRoot.trim(), path);
      const visible = visibleNotesRef.current;
      const index = visible.findIndex((item) => item.path === path);
      const neighbour = visible[index + 1] ?? visible[index - 1];
      const remaining = notesRef.current.filter((item) => item.path !== path);
      setNotes((current) => current.filter((item) => item.path !== path));
      setIndexedResults((current) => current.filter((item) => item.path !== path));
      setLinkVersion((current) => current + 1);
      setActivePath((current) => current === path ? (neighbour?.path ?? remaining[0]?.path ?? "") : current);
      setSaveError(false);
      const title = note?.title ?? path;
      if (isTrash || !trashedPath) {
        setStatus(t("status.deletedPermanently", { title }));
        toast.show({ message: t("status.deletedPermanently", { title }) });
      } else {
        setStatus(t("status.movedToTrash", { title }));
        toast.show({
          message: t("toast.movedToTrash", { title }),
          actionLabel: t("common.undo"),
          onAction: () => void restoreTrashedNote(trashedPath, path),
        });
      }
    } catch (error) {
      setStatus(errorMessage(error));
      toast.show({ message: errorMessage(error), tone: "error" });
    }
  }

  function deleteActiveNote() {
    if (!activeNote) return;
    void deleteNoteByPath(activeNote.path);
  }


  async function rebuildIndex() {
    if (!vaultRoot.trim()) {
      setStatus(t("status.openVaultFirst"));
      return;
    }
    try {
      await rebuildSearchIndex(vaultRoot.trim(), true);
      await refreshVaultFromDisk(t("status.indexRebuilt"));
      toast.show({ message: t("status.indexRebuilt"), tone: "success" });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function pickFolder(title: string, current: string) {
    return new Promise<string | null>((resolve) => {
      setFolderRequest({ title, current, resolve });
    });
  }

  /** Commits a note under a new path (rename or move), optionally changing fields at the same time. */
  async function commitPathChange(path: string, to: string, patch: Partial<Note> = {}, successMessage?: string): Promise<Note | null> {
    const root = vaultRef.current.trim();
    const before = notesRef.current.find((note) => note.path === path);
    if (!before || !root) {
      setStatus(t("status.openVaultFirst"));
      return null;
    }
    try {
      setIsSaving(true);
      const loaded = before.bodyLoaded === false ? await readNote(root, path) : before;
      const existing = new Set(notesRef.current.filter((note) => note.path !== path).map((note) => note.path));
      const targetPath = uniquePath(to, existing);
      const moved = await saveQueueRef.current(() => commitNote({ vaultRoot: root, path, targetPath, expectedRevision: loaded.sourceRevision, content: noteToMarkdown({ ...loaded, ...patch }) }));
      if (vaultRef.current.trim() !== root) return null;
      setNotes((current) => before.bodyLoaded === false
        ? current.map((note) => (note.path === path ? { ...moved, isDirty: false } : note))
        : acknowledgeSave(current, before, moved));
      setActivePath((current) => (current === path ? moved.path : current));
      setLinkVersion((version) => version + 1);
      setSaveError(false);
      setStatus(successMessage ?? t("status.movedTo", { path: moved.path }));
      return moved;
    } catch (error) {
      setStatus(errorMessage(error));
      toast.show({ message: errorMessage(error), tone: "error" });
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function moveNoteToFolder(path: string, folder: string, options: { undoable?: boolean; message?: string } = {}) {
    const target = normalizeFolder(folder);
    if (folderOf(path) === target) return;
    const filename = (path.split("/").pop() ?? path).replace(path.startsWith(".trash/") ? /^\d{4}-\d{2}-\d{2}-/ : /^$/, "");
    const moved = await commitPathChange(path, target ? `${target}/${filename}` : filename, { category: target });
    if (!moved) return;
    const originalFolder = folderOf(path);
    const undo = options.undoable === false || path.startsWith(".trash/")
      ? {}
      : {
        actionLabel: t("common.undo"),
        onAction: () => void moveNoteToFolder(moved.path, originalFolder, { undoable: false, message: t("toast.moveUndone") }),
      };
    toast.show({ message: options.message ?? t("toast.moved", { title: moved.title, folder: target || "/" }), ...undo });
  }

  async function moveNotePrompt(path: string) {
    const note = notesRef.current.find((item) => item.path === path);
    if (!note || !vaultRoot.trim()) {
      setStatus(t("status.openVaultFirst"));
      return;
    }
    const inTrash = path.startsWith(".trash/");
    const folder = await pickFolder(t(inTrash ? "folderPicker.restoreTitle" : "folderPicker.moveTitle", { title: note.title }), inTrash ? "" : folderOf(path));
    if (folder === null) return;
    await moveNoteToFolder(path, folder);
  }

  async function renameNoteFile(path: string) {
    if (!vaultRoot.trim() || !notesRef.current.some((note) => note.path === path)) {
      setStatus(t("status.openVaultFirst"));
      return;
    }
    const currentName = path.split("/").pop() ?? path;
    const nextName = (await safePrompt(t("prompt.newFilename"), currentName))?.trim().replace(/[\\/]/g, "-");
    if (!nextName || nextName === currentName) return;
    const normalized = nextName.endsWith(".md") ? nextName : `${nextName}.md`;
    const folder = folderOf(path);
    const moved = await commitPathChange(path, folder ? `${folder}/${normalized}` : normalized);
    if (moved) toast.show({ message: t("toast.renamed", { name: moved.path.split("/").pop() }) });
  }

  /** Inline title edit: updates the title and renames the file to match. */
  async function renameActiveNoteTitle(nextTitle: string) {
    const before = activeNoteRef.current;
    const title = nextTitle.trim();
    if (!before || !title || title === before.title) return;
    if (!vaultRef.current.trim()) {
      updateActiveNoteTitle(title);
      return;
    }
    const folder = folderOf(before.path);
    const filename = `${getFilenameForTitle(title)}.md`;
    const moved = await commitPathChange(
      before.path,
      folder ? `${folder}/${filename}` : filename,
      { title, updatedAt: lockUpdateTime ? before.updatedAt : localDateString() },
      t("status.renamedTitle", { title }),
    );
    if (moved) toast.show({ message: t("toast.titleRenamed", { title }) });
  }

  function archiveTarget(note: Note): string {
    return [ARCHIVE_ROOT, note.category].filter(Boolean).join("/");
  }

  async function restoreTrashedNote(trashedPath: string, originalPath: string) {
    const root = vaultRef.current.trim();
    if (!root) return;
    try {
      const existing = new Set(notesRef.current.map((note) => note.path));
      const target = uniquePath(originalPath, existing);
      const moved = await saveQueueRef.current(() => moveNote({ vaultRoot: root, from: trashedPath, to: target }));
      const restored = await readNote(root, moved.path).catch(() => moved);
      if (vaultRef.current.trim() !== root) return;
      setNotes((current) => [restored, ...current.filter((note) => note.path !== restored.path && note.path !== trashedPath)]);
      setIndexedResults((current) => current.filter((note) => note.path !== trashedPath));
      setLinkVersion((version) => version + 1);
      setActivePath(restored.path);
      setStatus(t("status.restored", { path: restored.path }));
      toast.show({ message: t("toast.restored", { title: restored.title }), tone: "success" });
    } catch (error) {
      toast.show({ message: errorMessage(error), tone: "error" });
    }
  }

  async function updateNoteFields(path: string, patch: Partial<Note>, message: string) {
    if (!vaultRoot.trim()) {
      setStatus(t("status.openVaultFirst"));
      return;
    }
    const noteToUpdate = notesRef.current.find((n) => n.path === path);
    if (!noteToUpdate) return;

    if (activeNoteRef.current?.path === path) {
      setNotes((current) => current.map((note) => note.path === path ? {
        ...note,
        ...patch,
        updatedAt: lockUpdateTime ? note.updatedAt : localDateString(),
        isDirty: true,
      } : note));
      setStatus(t("status.unsavedFieldChange"));
      return;
    }

    try {
      const loaded = noteToUpdate.bodyLoaded === false ? await readNote(vaultRoot.trim(), path) : noteToUpdate;
      const updatedNote = {
        ...loaded,
        ...patch,
        updatedAt: lockUpdateTime ? noteToUpdate.updatedAt : localDateString(),
      };
      await saveNoteWithPathSync(updatedNote, undefined, noteToUpdate);
      setStatus(message);
    } catch (error) {
      setStatus(errorMessage(error));
      toast.show({ message: errorMessage(error), tone: "error" });
    }
  }

  async function updateNoteStatus(path: string, status: string) {
    const note = notesRef.current.find((item) => item.path === path);
    await updateNoteFields(path, { status }, t("status.statusUpdated", { title: note?.title ?? path }));
  }

  async function setNoteDue(path: string, date: string) {
    const note = notesRef.current.find((item) => item.path === path);
    if (!note) return;
    const due = moveDueDate(note.due, date);
    await updateNoteFields(path, { due }, t("status.dueUpdated", { title: note.title, date }));
    toast.show({ message: t("toast.dueSet", { title: note.title, date }) });
  }

  async function createTask(title: string, status: string) {
    const root = vaultRef.current.trim();
    if (!root) {
      toast.show({ message: t("status.openVaultFirst"), tone: "error" });
      return;
    }
    try {
      const category = defaultCategory || categoryOptions[0]?.name || "knowledge";
      const created = await createNote({ vaultRoot: root, title, category });
      setNotes((current) => [created, ...current.filter((note) => note.path !== created.path)]);
      const saved = await saveNoteWithPathSync({ ...created, status, updatedAt: localDateString() }, undefined, created);
      setLinkVersion((version) => version + 1);
      setStatus(t("status.created", { path: saved.path }));
      toast.show({ message: t("toast.taskCreated", { title: saved.title }), tone: "success" });
    } catch (error) {
      toast.show({ message: errorMessage(error), tone: "error" });
    }
  }

  async function copyNoteLink(note: Note) {
    const link = `[[${note.title}]]`;
    try {
      await navigator.clipboard.writeText(link);
      toast.show({ message: t("toast.linkCopied", { link }) });
    } catch {
      toast.show({ message: t("toast.copyFailed"), tone: "error" });
    }
  }

  async function revealNote(path: string) {
    const root = vaultRef.current.trim();
    if (!root) return;
    try {
      await revealItemInDir(`${root.replace(/\/$/, "")}/${path}`);
    } catch (error) {
      toast.show({ message: errorMessage(error), tone: "error" });
    }
  }

  function openNote(path: string) {
    if (activeView === "search" && query.trim()) rememberSearch(query);
    setActivePath(path);
  }

  function openFolder(folder: string) {
    setActiveCategory(folder);
    setActiveView("category");
    setLeftSidebarVisible(true);
  }

  function noteContextItems(path: string): ContextMenuEntry[] {
    const note = notes.find((item) => item.path === path);
    if (!note) return [];
    const real = !!vaultRoot.trim();
    const isTauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI_IPC__" in window);
    const inTrash = path.startsWith(".trash/");
    const archived = note.category === ARCHIVE_ROOT || note.category.startsWith(`${ARCHIVE_ROOT}/`);
    const open = { id: "open", label: t("menu.open"), icon: <Eye size={14} />, onSelect: () => openNote(path) };
    if (inTrash) {
      return [
        open,
        { id: "restore", label: t("menu.restoreTo"), icon: <FolderInput size={14} />, disabled: !real, onSelect: () => void moveNotePrompt(path) },
        "separator",
        { id: "delete", label: t("menu.deletePermanently"), icon: <Trash2 size={14} />, danger: true, disabled: !real, onSelect: () => void deleteNoteByPath(path) },
      ];
    }
    return [
      open,
      "separator",
      { id: "rename", label: t("menu.renameFile"), icon: <TextCursorInput size={14} />, disabled: !real, onSelect: () => void renameNoteFile(path) },
      { id: "move", label: t("menu.moveTo"), icon: <FolderInput size={14} />, disabled: !real, onSelect: () => void moveNotePrompt(path) },
      archived
        ? { id: "unarchive", label: t("menu.unarchive"), icon: <Archive size={14} />, disabled: !real, onSelect: () => void moveNoteToFolder(path, note.category.replace(/^archive\/?/, "") || defaultCategory || "knowledge") }
        : { id: "archive", label: t("menu.archive"), icon: <Archive size={14} />, disabled: !real, onSelect: () => void moveNoteToFolder(path, archiveTarget(note)) },
      "separator",
      { id: "copy-link", label: t("menu.copyLink"), icon: <Copy size={14} />, onSelect: () => void copyNoteLink(note) },
      { id: "reveal", label: t("menu.reveal"), icon: <FolderOpen size={14} />, disabled: !real || !isTauri, onSelect: () => void revealNote(path) },
      "separator",
      { id: "delete", label: t("menu.moveToTrash"), icon: <Trash2 size={14} />, danger: true, shortcut: formatShortcut("deleteNote"), disabled: !real, onSelect: () => void deleteNoteByPath(path) },
    ];
  }

  const leftVisible = leftSidebarVisible && !focusMode;
  // The assistant works on the open note, so its column only takes space while a note is open.
  const rightVisible = rightPanelVisible && !focusMode && !!activeNote;

  const toggleLeftSidebar = () => {
    if (focusMode) setFocusMode(false);
    setLeftSidebarVisible((current) => (focusMode ? true : !current));
  };
  const toggleRightSidebar = () => {
    if (focusMode) setFocusMode(false);
    setRightSidebarVisible((current) => (focusMode ? true : !current));
  };

  useGlobalShortcuts({
    newNote: () => void addCategoryNote(),
    commandPalette: () => setPaletteMode((mode) => (mode === "all" ? null : "all")),
    quickOpen: () => setPaletteMode((mode) => (mode === "notes" ? null : "notes")),
    focusSearch: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    toggleLeftSidebar,
    toggleRightSidebar: () => {
      if (!mindMapActive) toggleRightSidebar();
    },
    historyBack: () => {
      if (previousHistoryIndex >= 0) navigateNoteHistory(previousHistoryIndex);
    },
    historyForward: () => {
      if (nextHistoryIndex >= 0) navigateNoteHistory(nextHistoryIndex);
    },
    togglePreview: () => {
      if (activeNote) setPreviewMode((current) => !current);
    },
    deleteNote: () => {
      if (activeNote) void deleteNoteByPath(activeNote.path);
    },
    focusMode: () => {
      if (activeNote) setFocusMode((current) => !current);
    },
  });

  useEffect(() => {
    if (!focusMode) return;
    function exitFocus(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open], .context-menu")) return;
      setFocusMode(false);
    }
    window.addEventListener("keydown", exitFocus);
    return () => window.removeEventListener("keydown", exitFocus);
  }, [focusMode]);

  useEffect(() => {
    if (!activeNote && focusMode) setFocusMode(false);
  }, [activeNote, focusMode]);

  const paletteCommands: PaletteCommand[] = paletteMode === "all" ? [
    { id: "new-note", group: t("palette.groupCreate"), label: t("app.createNote"), icon: <Pencil size={15} />, shortcut: formatShortcut("newNote"), run: () => void addCategoryNote() },
    { id: "today-note", group: t("palette.groupCreate"), label: t("settings.todayNote"), icon: <FilePlus2 size={15} />, run: () => void addTodayNote() },
    { id: "mind-map", group: t("palette.groupCreate"), label: t("mindmap.title"), icon: <Network size={15} />, run: () => openMindMapDialog() },
    { id: "new-folder", group: t("palette.groupCreate"), label: t("app.newFolder"), icon: <FolderPlus size={15} />, run: () => void addFolder() },
    { id: "search", group: t("palette.groupNavigate"), label: t("palette.focusSearch"), icon: <Search size={15} />, shortcut: formatShortcut("focusSearch"), run: () => window.setTimeout(() => searchInputRef.current?.focus(), 0) },
    { id: "quick-open", group: t("palette.groupNavigate"), label: t("palette.quickOpen"), icon: <Search size={15} />, shortcut: formatShortcut("quickOpen"), run: () => window.setTimeout(() => setPaletteMode("notes"), 0) },
    { id: "todo", group: t("palette.groupNavigate"), label: t("app.todo"), icon: <ListTodo size={15} />, run: () => toggleSpecialView("todo") },
    { id: "calendar", group: t("palette.groupNavigate"), label: t("app.calendar"), icon: <CalendarDays size={15} />, run: () => toggleSpecialView("calendar") },
    { id: "archive", group: t("palette.groupNavigate"), label: t("app.archive"), icon: <Archive size={15} />, run: () => toggleSpecialView("archive") },
    { id: "trash", group: t("palette.groupNavigate"), label: t("app.trash"), icon: <Trash size={15} />, run: () => toggleSpecialView("trash") },
    { id: "tags", group: t("palette.groupNavigate"), label: t("app.tags"), icon: <Tags size={15} />, run: () => setTagsPopoverOpen(true) },
    { id: "save", group: t("palette.groupNote"), label: t("editor.save"), icon: <Save size={15} />, shortcut: "⌘S", disabled: !activeNote, run: () => void saveActiveNote() },
    { id: "rename", group: t("palette.groupNote"), label: t("menu.renameFile"), icon: <TextCursorInput size={15} />, disabled: !activeNote, run: () => activeNote && void renameNoteFile(activeNote.path) },
    { id: "move", group: t("palette.groupNote"), label: t("menu.moveTo"), icon: <FolderInput size={15} />, disabled: !activeNote, run: () => activeNote && void moveNotePrompt(activeNote.path) },
    { id: "check-file", group: t("palette.groupNote"), label: t("editor.checkFile"), icon: <RefreshCw size={15} />, disabled: !activeNote, run: () => void checkExternalActiveNote() },
    { id: "preview", group: t("palette.groupNote"), label: t(previewMode ? "palette.exitPreview" : "palette.preview"), icon: <Eye size={15} />, shortcut: formatShortcut("togglePreview"), disabled: !activeNote, run: () => setPreviewMode((current) => !current) },
    { id: "focus", group: t("palette.groupNote"), label: t(focusMode ? "focus.exit" : "focus.enter"), icon: <Focus size={15} />, shortcut: formatShortcut("focusMode"), disabled: !activeNote, run: () => setFocusMode((current) => !current) },
    { id: "delete", group: t("palette.groupNote"), label: t("menu.moveToTrash"), icon: <Trash2 size={15} />, shortcut: formatShortcut("deleteNote"), disabled: !activeNote, run: () => activeNote && void deleteNoteByPath(activeNote.path) },
    { id: "left", group: t("palette.groupView"), label: t(leftVisible ? "app.hideLeftSidebar" : "app.showLeftSidebar"), icon: <PanelLeft size={15} />, shortcut: formatShortcut("toggleLeftSidebar"), run: toggleLeftSidebar },
    { id: "right", group: t("palette.groupView"), label: t(rightVisible ? "app.hideRightSidebar" : "app.showRightSidebar"), icon: <PanelRight size={15} />, shortcut: formatShortcut("toggleRightSidebar"), disabled: mindMapActive, run: toggleRightSidebar },
    { id: "cards", group: t("palette.groupView"), label: t("app.cardView"), icon: <LayoutGrid size={15} />, run: () => setNoteListMode("cards") },
    { id: "summary", group: t("palette.groupView"), label: t("app.summaryView"), icon: <List size={15} />, run: () => setNoteListMode("summary") },
    { id: "settings", group: t("palette.groupApp"), label: t("app.settings"), icon: <Settings size={15} />, shortcut: "⌘,", run: () => setSettingsOpen(true) },
    { id: "rebuild-index", group: t("palette.groupApp"), label: t("settings.rebuildIndex"), icon: <RefreshCw size={15} />, disabled: !vaultRoot.trim(), run: () => void rebuildIndex() },
  ] : [];

  function openMindMapDialog() {
    setMindMapTarget({ root: vaultRoot.trim(), category: activeView === "category" ? activeCategory : activeView === "search" && selectedSearchCategories.length === 1 ? selectedSearchCategories[0] : defaultCategory || "knowledge" });
  }

  const contextMenuNote = contextMenu ? notes.find((note) => note.path === contextMenu.path) : undefined;

  return (
    <main
      inert={isClosing}
      className={`app-root flex flex-col h-screen w-screen bg-base-100 text-base-content overflow-hidden ${focusMode ? "focus-mode" : ""}`}
      data-theme={themeDatasetValue}
    >
      <TitleBar
        vaultName={vaultRoot.trim() ? vaultRoot.split("/").filter(Boolean).pop() ?? "" : t("app.demoWorkspace")}
        leftSidebarVisible={leftVisible}
        onToggleLeftSidebar={toggleLeftSidebar}
        rightSidebarVisible={rightVisible}
        onToggleRightSidebar={toggleRightSidebar}
        showRightSidebarToggle={!mindMapActive}
        canGoBack={previousHistoryIndex >= 0}
        canGoForward={nextHistoryIndex >= 0}
        onBack={() => navigateNoteHistory(previousHistoryIndex)}
        onForward={() => navigateNoteHistory(nextHistoryIndex)}
        query={query}
        onQueryChange={(next) => {
          if (query !== "" && next === "") initialScrollDoneRef.current = false;
          setQuery(next);
          setActiveView("search");
        }}
        onClearSearch={() => {
          initialScrollDoneRef.current = false;
          setQuery("");
        }}
        searchInputRef={searchInputRef}
        activeView={activeView}
        onToggleView={toggleSpecialView}
        tagsOpen={tagsPopoverOpen}
        onOpenTags={() => setTagsPopoverOpen(true)}
        settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPalette={() => setPaletteMode("all")}
        showTodayNoteButton={showTodayNoteButton}
        onCreateNote={() => void addCategoryNote()}
        onCreateToday={() => void addTodayNote()}
        onCreateMindMap={openMindMapDialog}
        onCreateFolder={() => void addFolder()}
      />

      <div
        className="flex-1 grid min-h-0 overflow-hidden bg-base-100"
        style={{
          gridTemplateColumns: `${leftVisible ? `${leftSidebarWidth}px 5px` : "0 0"} minmax(0, 1fr) ${rightVisible ? `5px ${rightSidebarWidth}px` : "0 0"}`,
        }}
      >
        <NoteListPanel
          visible={leftVisible}
          activeView={activeView}
          activeCategory={activeCategory}
          searchScopeLabel={searchScopeLabel}
          query={searchHighlightQuery}
          categoryOptions={categoryOptions}
          selectedSearchCategories={selectedSearchCategories}
          onSelectAllCategories={() => {
            setSelectedSearchCategories([]);
            setActiveView("search");
          }}
          onToggleSearchCategory={(name, checked) => {
            setActiveView("search");
            setSelectedSearchCategories((current) => checked
              ? [...current, name].sort((a, b) => a.localeCompare(b))
              : current.filter((item) => item !== name));
          }}
          categoryFilterOpen={categoryFilterOpen}
          setCategoryFilterOpen={setCategoryFilterOpen}
          categoryFilterRef={categoryFilterRef}
          noteListMode={noteListMode}
          setNoteListMode={setNoteListMode}
          visibleCount={visibleNotes.length}
          groups={visibleNoteGroups}
          notes={notes}
          activePath={activePath}
          vaultRoot={vaultRoot}
          onSelect={openNote}
          onNoteContextMenu={(path, x, y) => setContextMenu({ path, x, y })}
          onKeyDown={handleNoteListKeyDown}
          onScroll={handleNoteListScroll}
          onCreateNote={() => void addCategoryNote()}
          canCreate={!!vaultRoot.trim()}
        />
        <ResizeHandle
          side="left"
          hidden={!leftVisible}
          width={leftSidebarWidth}
          min={220}
          max={560}
          defaultWidth={LEFT_SIDEBAR_DEFAULT}
          onResize={setLeftSidebarWidth}
          label={t("app.resizeLeftSidebar")}
          className="w-full h-full z-10"
        />

        <section className="workspace-main flex min-h-0 flex-col min-w-0 bg-base-100 relative shadow-inner">
          {activeView === "calendar" ? (
            <Suspense fallback={<Skeleton variant="calendar" label={t("loading.calendar")} />}>
              <CalendarView
                notes={notes}
                onSelectNote={setActivePath}
                onClose={() => toggleSpecialView("calendar")}
                onSetDue={setNoteDue}
              />
            </Suspense>
          ) : activeView === "todo" && !activeNote ? (
            <Suspense fallback={<Skeleton variant="board" label={t("loading.todo")} />}>
              <TodoDashboard
                notes={visibleNotes}
                onSelectNote={setActivePath}
                onUpdateNoteStatus={updateNoteStatus}
                onCreateTask={createTask}
                canCreate={!!vaultRoot.trim()}
              />
            </Suspense>
          ) : activeNote ? (
            startupMigrationPath === activeNote.path ? (
              <EmptyState icon={<RefreshCw size={28} className="animate-spin" />} title={t("loading.migratingImages")} />
            ) : !editorPaintReady || activeNote.bodyLoaded === false ? (
              <Skeleton variant="editor" label={t("loading.note")} />
            ) : (
              <FeatureBoundary resetKey={activeNote.path}><Suspense fallback={<Skeleton variant="editor" label={t("loading.note")} />}><Editor
                key={activeNote.path}
                vaultRoot={vaultRoot.trim()}
                note={activeNote}
                searchQuery={activeView === "search" ? searchHighlightQuery : ""}
                onChange={updateActiveNote}
                onSave={saveActiveNote}
                onRename={() => void renameNoteFile(activeNote.path)}
                onRenameTitle={(title) => void renameActiveNoteTitle(title)}
                onMove={() => void moveNotePrompt(activeNote.path)}
                onCheckExternal={checkExternalActiveNote}
                onDelete={deleteActiveNote}
                onNavigateFolder={openFolder}
                focusMode={focusMode}
                onToggleFocusMode={() => setFocusMode((current) => !current)}
                previewMode={previewMode}
                onTogglePreview={() => setPreviewMode((current) => !current)}
                saveState={saveState}
                noteLinks={noteLinks}
                onUpdateTitle={updateActiveNoteTitle}
                onUpdateCreatedAt={updateActiveNoteCreatedAt}
                onUpdateUpdatedAt={updateActiveNoteUpdatedAt}
                onUpdateDue={updateActiveNoteDue}
                remindersEnabled={reminderConfig.enabled && reminderConfig.supported}
                onUpdateReminder={updateActiveNoteReminder}
                onUpdateStatus={updateActiveNoteStatus}
                onUpdatePriority={updateActiveNotePriority}
                onUpdateProject={updateActiveNoteProject}
                onUpdateTags={updateActiveNoteTags}
                onArchiveInboxNote={archiveActiveInboxNote}
                onNavigateLink={setActivePath}
              /></Suspense></FeatureBoundary>
            )
          ) : (
            <EmptyState
              icon={<FilePlus2 size={32} />}
              title={t("empty.noNoteTitle")}
              description={t("empty.noNoteHint", { newNote: formatShortcut("newNote"), quickOpen: formatShortcut("quickOpen") })}
              action={vaultRoot.trim() ? { label: t("app.createNote"), onClick: () => void addCategoryNote(), icon: <Pencil size={14} /> } : { label: t("app.settings"), onClick: () => setSettingsOpen(true), icon: <Settings size={14} /> }}
            />
          )}
        </section>

        <ResizeHandle
          side="right"
          hidden={!rightVisible}
          width={rightSidebarWidth}
          min={220}
          max={560}
          defaultWidth={RIGHT_SIDEBAR_DEFAULT}
          onResize={setRightSidebarWidth}
          label={t("app.resizeRightSidebar")}
          className="w-full h-full z-10"
        />

        <aside
          className={`flex min-h-0 flex-col overflow-hidden bg-base-200/40 border-base-300 ${rightVisible ? "border-l" : "invisible opacity-0 border-none"}`}
          aria-label={t("app.assistant")}
        >
          {rightVisible && activeNote && activeNote.bodyLoaded !== false ? (
            <FeatureBoundary resetKey={activeNote.path}>
              <Suspense fallback={<Skeleton variant="panel" label={t("loading.agent")} />}>
                <NoteAgent
                  note={activeNote}
                  notes={notes}
                  vaultRoot={vaultRoot}
                  settings={llmSettings}
                  onApplyCurrentNote={applyAgentCurrentNote}
                  onCreateNote={createAgentNote}
                  onUndoLastApply={undoLastAgentApply}
                />
              </Suspense>
            </FeatureBoundary>
          ) : null}
        </aside>
      </div>

      {mindMapTarget && <Suspense fallback={null}><MindMapDialog onClose={() => setMindMapTarget(null)} onCreate={createMindMapNote} canCreate={!!mindMapTarget.root && mindMapTarget.root === vaultRoot.trim()} /></Suspense>}

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        label={t("app.settings")}
        boxClassName="settings-window h-[min(760px,86vh)] max-h-[86vh] w-[min(840px,92vw)] max-w-none overflow-hidden p-0"
      >
        <Suspense fallback={<Skeleton variant="panel" label={t("loading.settings")} />}>
          <SettingsPanel
            vaultRoot={vaultPathInput}
            reminderVaultRoot={vaultRoot.trim()}
            status={status}
            llmSettings={llmSettings}
            themePreference={themePreference}
            effectiveTheme={effectiveTheme}
            colorTheme={colorTheme}
            baseFontSize={baseFontSize}
            defaultCategory={defaultCategory}
            categories={categoryOptions}
            showTodayNoteButton={showTodayNoteButton}
            onShowTodayNoteButtonChange={setShowTodayNoteButton}
            lockUpdateTime={lockUpdateTime}
            onLockUpdateTimeChange={setLockUpdateTime}
            autoSaveOnExit={autoSaveOnExit}
            onAutoSaveOnExitChange={setAutoSaveOnExit}
            onVaultRootChange={setVaultPathInput}
            onLlmSettingsChange={setLlmSettings}
            onThemePreferenceChange={setThemePreference}
            onColorThemeChange={setColorTheme}
            onBaseFontSizeChange={setBaseFontSize}
            fontFamily={fontFamily}
            onFontFamilyChange={setFontFamily}
            onDefaultCategoryChange={setDefaultCategory}
            onOpenVault={openVault}
            onInitializeVault={initVault}
            onCreateToday={addTodayNote}
            onCreateFolder={addFolder}
            onRebuildIndex={rebuildIndex}
            onClose={() => setSettingsOpen(false)}
          />
        </Suspense>
      </Modal>

      <Modal
        open={tagsPopoverOpen}
        onClose={() => setTagsPopoverOpen(false)}
        label={t("app.tags")}
        boxClassName="max-h-[86vh] w-[min(760px,92vw)] max-w-none overflow-hidden p-0"
      >
        <Suspense fallback={<Skeleton variant="panel" label={t("loading.tags")} />}>
          <TagsPanel
            notes={notes}
            onSelectNote={(path) => {
              setActivePath(path);
            }}
            onClose={() => setTagsPopoverOpen(false)}
          />
        </Suspense>
      </Modal>

      <PromptDialog request={promptConfig} onDone={() => setPromptConfig(null)} />
      <FolderPicker request={folderRequest} folders={categoryOptions.filter((folder) => !folder.name.startsWith("."))} onDone={() => setFolderRequest(null)} />
      <CommandPalette
        open={paletteMode !== null}
        mode={paletteMode ?? "all"}
        commands={paletteCommands}
        notes={notes}
        onOpenNote={(path) => {
          if (activeView === "todo" || activeView === "calendar") toggleSpecialView(activeView);
          setActivePath(path);
        }}
        onClose={() => setPaletteMode(null)}
      />
      {contextMenu && contextMenuNote ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={t("menu.label", { title: contextMenuNote.title })}
          items={noteContextItems(contextMenu.path)}
          onClose={closeContextMenu}
        />
      ) : null}

      {focusMode ? (
        <button type="button" className="focus-mode-exit" onClick={() => setFocusMode(false)}>
          <Focus size={14} /> {t("focus.exit")} <kbd>Esc</kbd>
        </button>
      ) : (
        <StatusBar
          saveState={saveState}
          saveLabel={saveLabel}
          status={status}
          pinStatus={saveError}
          reminderError={reminderError}
          reminderConflictCount={reminderConflicts.length}
          onOpenSettings={() => setSettingsOpen(true)}
          activeNote={activeNote}
          noteCount={notes.length}
          totalWords={totalWords}
        />
      )}
    </main>
  );
}
