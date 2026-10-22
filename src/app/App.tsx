import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  Archive,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  FilePlus2,
  Flag,
  LayoutGrid,
  List,
  ListTodo,
  PanelLeft,
  PanelRight,
  Pencil,
  Search,
  Settings,
  Tags,
  Trash,
  XCircle,
} from "lucide-react";
const CalendarView = lazy(() =>
  import("../features/calendar/CalendarView").then((m) => ({
    default: m.CalendarView,
  })),
);
const Editor = lazy(() => import("../features/editor/Editor").then((module) => ({ default: module.Editor })));
import { FeatureBoundary } from "./FeatureBoundary";
import { buildAgentNoteCommit } from "../features/agent/agentNoteCommit";
import { useNoteWorkspace } from "./useNoteWorkspace";
import { useVaultSync } from "./useVaultSync";
import { prepareWorkspaceClose } from "./closeWorkspace";
import { useWorkspaceSettings } from "./useWorkspaceSettings";
import { useIndexedSearch } from "./useIndexedSearch";
import { acknowledgeSave, mergeDiskNotes, createSerialQueue } from "../shared/notePersistence";
import { newNotePath, noteSavePath } from "../shared/notePaths";
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

const excerptCache = new WeakMap<Note | SearchResult, string>();

function noteExcerpt(note: Note | SearchResult): string {
  const cached = excerptCache.get(note);
  if (cached !== undefined) return cached;
  const excerpt = note.excerpt ?? note.summary ??
        ("body" in note ? note.body
          .replace(/^# .*\n?/, "")
          .trim()
          .slice(0, 96) : "");
  const result = stripMarkdownForSummary(excerpt);
  excerptCache.set(note, result);
  return result;
}

const NOTES_PAGE_SIZE = 60;

interface NoteItemProps {
  note: Note | SearchResult;
  isActive: boolean;
  onSelect: (path: string) => void;
}

const NoteCardItem = memo(function NoteCardItem({
  note,
  isActive,
  onSelect,
}: NoteItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);

  return (
    <div ref={ref} className={isActive ? "note-card active" : "note-card"}>
      <button
        className={`note-card-select card bg-base-100 shadow-sm border border-base-200/50 hover:shadow-md hover:-translate-y-0.5 w-full text-left focus:outline-none ${isActive ? "ring-2 ring-primary bg-primary/5 border-primary/20 transition-none" : "transition-all"}`}
        type="button"
        onClick={() => onSelect(note.path)}
      >
        <div className="card-body h-full p-0 gap-2">
          <div className="flex items-start justify-between gap-2">
            <strong className="text-sm font-bold leading-tight flex-1">
              {note.title}
            </strong>
            {"priority" in note &&
              note.priority &&
              note.priority !== "none" && (
                <Flag
                  size={12}
                  className={`shrink-0 ${note.priority === "high" ? "text-error" : note.priority === "medium" ? "text-warning" : "text-info"}`}
                />
              )}
          </div>
          <small className="text-xs text-base-content/60 leading-relaxed">
            {noteExcerpt(note)}
          </small>
          <div className="note-card-footer flex items-center justify-between text-[10px] text-base-content/40 mt-auto font-mono">
            <time>{note.updatedAt || note.createdAt}</time>
            {"due" in note && note.due && (
              <span
                className="flex items-center gap-1 bg-warning/10 text-warning px-1.5 py-0.5 rounded-full"
                title={`Due: ${note.due}`}
              >
                <Clock size={10} />
                {note.due.split("T")[0]}
              </span>
            )}
          </div>
        </div>
      </button>
    </div>
  );
});

const NoteRowItem = memo(function NoteRowItem({
  note,
  isActive,
  onSelect,
}: NoteItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);

  return (
    <div ref={ref} className="w-full min-w-0 max-w-full">
      <button
        className={`flex flex-col w-full min-w-0 max-w-full text-left px-3 py-2 rounded-lg focus:outline-none transition-none ${isActive ? "bg-primary/10 text-primary" : ""}`}
        type="button"
        onClick={() => onSelect(note.path)}
      >
        <div className="flex items-center justify-between gap-2 w-full min-w-0 max-w-full">
          <strong
            className={`text-sm font-semibold truncate min-w-0 max-w-full ${isActive ? "text-primary" : "text-base-content"}`}
          >
            {note.title}
          </strong>
          {"priority" in note && note.priority && note.priority !== "none" && (
            <Flag
              size={12}
              className={`shrink-0 ${note.priority === "high" ? "text-error" : note.priority === "medium" ? "text-warning" : "text-info"}`}
            />
          )}
        </div>
        <div className="flex flex-col items-start w-full mt-0.5 gap-1">
          <small className="text-xs text-base-content/50 break-words whitespace-normal line-clamp-2 w-full text-left">
            {noteExcerpt(note)}
          </small>
          <div className="flex items-center justify-end gap-2 w-full shrink-0">
            {"due" in note && note.due && (
              <span
                className="flex items-center gap-1 text-[10px] bg-warning/10 text-warning px-1 rounded-full"
                title={`Due: ${note.due}`}
              >
                <Clock size={10} />
                {note.due.split("T")[0]}
              </span>
            )}
            <time className="text-[10px] text-base-content/40 font-mono shrink-0">
              {note.updatedAt || note.createdAt}
            </time>
          </div>
        </div>
      </button>
    </div>
  );
});

function stripMarkdownForSummary(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function localDateString(date = new Date()): string {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(0, 10);
}

export function App() {
  const { t } = useTranslation();
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
  const [showTodayNoteButton, setShowTodayNoteButton] = useState(false);
  const [lockUpdateTime, setLockUpdateTime] = useState(false);
  const [autoSaveOnExit, setAutoSaveOnExit] = useState(false);
  const [tagsPopoverOpen, setTagsPopoverOpen] = useState(false);
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
  const [indexedResults, setIndexedResults] = useIndexedSearch(vaultRoot, query, linkVersion, setStatus);
  const [llmSettings, setLlmSettings] =
    useState<LlmProviderSettings>(defaultLlmSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
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
  const [promptConfig, setPromptConfig] = useState<{
    message: string;
    defaultValue: string;
    resolve: (val: string | null) => void;
  } | null>(null);

  const safePrompt = useCallback((message: string, defaultValue = "") => {
    return new Promise<string | null>((resolve) => {
      setPromptConfig({ message, defaultValue, resolve });
    });
  }, []);
  const categoryFilterRef = useRef<HTMLDetailsElement>(null);
  const categoryFilterPointerInsideRef = useRef(false);
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
  }>({ view: "today", category: "journal", path: "" });

  const toggleSpecialView = useCallback(
    (view: "archive" | "trash" | "calendar") => {
      if (activeView === view) {
        setActiveView(previousViewRef.current.view);
        setActiveCategory(previousViewRef.current.category);
        if (previousViewRef.current.path) {
          setActivePath(previousViewRef.current.path);
        }
      } else {
        if (
          activeView !== "archive" &&
          activeView !== "trash" &&
          activeView !== "calendar"
        ) {
          previousViewRef.current = {
            view: activeView,
            category: activeCategory,
            path: activePath,
          };
        }
        setActiveView(view);
      }
    },
    [activeView, activeCategory, activePath],
  );
  const activeNote = activePath
    ? notes.find((note) => note.path === activePath)
    : undefined;

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
        : `${selectedSearchCategories.length} categories`;
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
      reason = "Vault refreshed from disk.",
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
    setStatus(
      "Demo vault loaded. Enter a local path in Settings to open real notes.",
    );
  }, []);

  const refreshVaultFromDisk = useCallback(
    async (reason = "Vault refreshed from disk.") => {
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
          const [tocOpen, tocNum, viewMode] = await Promise.all([
            getSetting("mdxeditor-toc-open"),
            getSetting("mdxeditor-toc-numbering"),
            getSetting("mdxeditor-view-mode"),
          ]);
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
            setStatus("LLM settings could not be loaded. Defaults restored.");
          }
        }
        setLlmSettings({ ...defaultLlmSettings, ...llmSettingsFromStorage });
        if (vaultRootFromSettings) {
          try {
            await restoreVaultOnStartup(
              vaultRootFromSettings,
              savedSettings.vaultRoot
                ? "Last vault restored from SQLite."
                : "Last vault migrated from browser fallback.",
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
              "Last vault restored from browser fallback.",
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
            setStatus("LLM settings could not be loaded. Defaults restored.");
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
    if (!categoryFilterOpen) return;

    function closeCategoryFilter(event: PointerEvent) {
      if (!categoryFilterRef.current?.contains(event.target as Node)) {
        setCategoryFilterOpen(false);
      }
    }

    window.addEventListener("pointerdown", closeCategoryFilter);
    return () => {
      window.removeEventListener("pointerdown", closeCategoryFilter);
    };
  }, [categoryFilterOpen]);

  useEffect(() => {
    if (!settingsOpen) return;

    function closeSettings(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    }

    window.addEventListener("keydown", closeSettings);
    return () => {
      window.removeEventListener("keydown", closeSettings);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (!tagsPopoverOpen) return;

    function closeTags(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTagsPopoverOpen(false);
      }
    }

    window.addEventListener("keydown", closeTags);
    return () => {
      window.removeEventListener("keydown", closeTags);
    };
  }, [tagsPopoverOpen]);

  useEffect(() => {
    const unlistenPromise = listen("inote://empty-trash", async () => {
      if (!vaultRoot.trim()) return;

      // Yield to event loop to allow menu interaction to finish
      await new Promise((resolve) => setTimeout(resolve, 50));

      const confirmed = await safeConfirm(
        "Are you sure you want to permanently empty the trash? This action cannot be undone.",
      );
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
        setStatus("Trash emptied.");
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
  }, [vaultRoot, safeConfirm]);

  useEffect(() => {
    const unlistenPromise = listen("inote://rebuild-index", async () => {
      if (!vaultRoot.trim()) return;
      await rebuildSearchIndex(vaultRoot.trim(), true);
      await refreshVaultFromDisk("Full index rebuilt.");
    });

    return () => {
      unlistenPromise.then((dispose) => dispose()).catch(() => { });
    };
  }, [vaultRoot, refreshVaultFromDisk]);

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
            confirmClose: () => safeConfirm("有未保存的笔记。草稿已保留，是否退出？"),
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
      const searchResults =
        vaultRoot.trim() && query.trim()
          ? indexedResults
          : searchNotes(notes, query);
      return searchResults.filter(matchesSearchScope);
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
    query,
    searchCategorySet,
    vaultRoot,
  ]);

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

  const visibleNoteGroups = useMemo(() => {
    const sliced = visibleNotes.slice(0, renderedCount);
    if (activeView === "todo") {
      const today = localDateString();
      const groups = {
        Overdue: [] as Array<Note | SearchResult>,
        "Due Today": [] as Array<Note | SearchResult>,
        Upcoming: [] as Array<Note | SearchResult>,
        "No Due Date": [] as Array<Note | SearchResult>,
        "Recently Completed": [] as Array<Note | SearchResult>,
      };

      for (const note of sliced) {
        if ("status" in note && note.status === "done") {
          groups["Recently Completed"].push(note);
        } else if ("due" in note && note.due) {
          const dueDate = note.due.slice(0, 10);
          if (dueDate < today) {
            groups["Overdue"].push(note);
          } else if (dueDate === today) {
            groups["Due Today"].push(note);
          } else {
            groups["Upcoming"].push(note);
          }
        } else {
          groups["No Due Date"].push(note);
        }
      }

      return [
        { month: "Overdue", notes: groups["Overdue"], isCollapsed: false },
        { month: "Due Today", notes: groups["Due Today"], isCollapsed: false },
        { month: "Upcoming", notes: groups["Upcoming"], isCollapsed: false },
        {
          month: "No Due Date",
          notes: groups["No Due Date"],
          isCollapsed: false,
        },
        {
          month: "Recently Completed",
          notes: groups["Recently Completed"],
          isCollapsed: true,
        },
      ].filter((g) => g.notes.length > 0);
    }

    const groups = new Map<string, Array<Note | SearchResult>>();
    for (const note of sliced) {
      const dateToUse = note.updatedAt || note.createdAt;
      const month = dateToUse.slice(0, 7);
      groups.set(month, [...(groups.get(month) ?? []), note]);
    }
    return Array.from(groups.entries())
      .map(([month, groupedNotes]) => ({
        month,
        notes: groupedNotes,
        isCollapsed: false,
      }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [visibleNotes, renderedCount, activeView]);

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

  async function updateNoteStatus(path: string, status: string) {
    if (!vaultRoot.trim()) return;
    const noteToUpdate = notes.find((n) => n.path === path);
    if (!noteToUpdate) return;

    if (activeNote && activeNote.path === path) {
      updateActiveNoteStatus(status);
      return;
    }

    try {
      const loaded = noteToUpdate.bodyLoaded === false ? await readNote(vaultRoot.trim(), path) : noteToUpdate;
      const updatedNote = {
        ...loaded,
        status,
        updatedAt: lockUpdateTime ? noteToUpdate.updatedAt : localDateString(),
      };
      const saved = await saveNoteWithPathSync(updatedNote, undefined, noteToUpdate);
      setStatus(`Updated status for ${saved.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
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
      setStatus("Enter a vault path first.");
      return;
    }
    try {
      await loadVaultFromDisk(vaultPathInput.trim(), "Vault opened. Markdown notes indexed.");
      window.localStorage.setItem(LAST_VAULT_KEY, vaultPathInput.trim());
      setSaveError(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function initVault() {
    if (!vaultPathInput.trim()) {
      setStatus("Enter a vault path first.");
      return;
    }
    try {
      await initializeVault(vaultPathInput.trim());
      await loadVaultFromDisk(vaultPathInput.trim(), "Starter vault folders are ready.");
      window.localStorage.setItem(LAST_VAULT_KEY, vaultPathInput.trim());
      setSaveError(false);
      setStatus("Starter vault folders are ready.");
    } catch (error) {
      setSaveError(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveActiveNote(): Promise<boolean> {
    if (closeRequestInProgressRef.current) return false;
    const savingRoot = vaultRef.current.trim();
    if (!activeNote || !vaultRoot.trim()) {
      setStatus("Open a real vault before saving.");
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
      setStatus(`Saved ${saved.path}.`);
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
      if (root !== vaultRef.current.trim()) throw new Error("The active vault changed before saving.");
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
    if (!before || !vaultRef.current.trim()) throw new Error("Open a real vault before applying agent changes.");
    const root = vaultRef.current;
    const change = buildAgentNoteCommit(before, result, selectedOperationIndexes, turnId, sessionId, lockUpdateTime ? before.updatedAt : localDateString(), false);
    setIsSaving(true);
    try {
      const saved = await saveNoteWithPathSync(change.note, change.agent, before);
      if (vaultRef.current !== root) return;
      setLinkVersion((version) => version + 1);
      setActivePath((path) => path === before.path ? saved.path : path);
      setSaveError(false);
      setStatus(`Agent updated ${change.changedFields.join(", ") || "note"}.`);
    } catch (error) {
      setSaveError(true);
      setStatus(String(error));
      throw error;
    } finally { setIsSaving(false); }
  }

  async function checkExternalActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus("Open a real vault before checking disk changes.");
      return;
    }
    try {
      const diskNote = await readNote(vaultRoot.trim(), activeNote.path);
      const changedOnDisk = diskNote.sourceRevision !== activeNote.sourceRevision;

      if (!changedOnDisk) {
        setStatus("Disk version matches the editor.");
        return;
      }

      const reload = await safeConfirm(
        `${activeNote.path} changed on disk. Reload the disk version?`,
      );
      if (!reload) {
        setStatus("Kept editor version. Save to overwrite disk when ready.");
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
      setStatus(`Reloaded ${diskNote.path} from disk.`);
    } catch (error) {
      setSaveError(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function archiveActiveInboxNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus("Open a real vault before archiving inbox notes.");
      return;
    }
    if (!activeNote.path.startsWith("00-inbox/")) {
      setStatus("Only inbox notes can use the archive flow.");
      return;
    }
    const title = await safePrompt("Archive title", activeNote.title);
    if (!title) return;
    const category = await safePrompt(
      "Archive category",
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
      setStatus(`Archived to ${archived.path}.`);
    } catch (error) {
      setSaveError(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function addTodayNote() {
    if (!vaultRoot.trim()) {
      setStatus("Open a real vault before creating today note.");
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
      setStatus(`Opened ${note.path}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function addCategoryNote() {
    if (!vaultRoot.trim()) {
      setStatus("Open a real vault before creating notes.");
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
      setStatus(`Created ${note.path}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function createAgentNote(result: AgentResult, selectedOperationIndexes: number[], turnId: string, sessionId: string) {
    const before = activeNoteRef.current;
    const root = vaultRef.current.trim();
    if (!before || !root) throw new Error("Open a real vault before creating notes.");
    const change = buildAgentNoteCommit(before, result, selectedOperationIndexes, turnId, sessionId, localDateString(), true, notesRef.current.map((note) => note.path));
    const saved = await saveQueueRef.current(() => commitNote({ vaultRoot: root, path: change.note.path, create: true, content: noteToMarkdown(change.note), agent: change.agent, sourceCheck: before.sourceRevision ? { path: before.path, revision: before.sourceRevision } : undefined }));
    if (vaultRef.current.trim() !== root) return;
    setNotes((current) => [saved, ...current.filter((note) => note.path !== saved.path)]);
    setLinkVersion((version) => version + 1);
    setActivePath((path) => path === before.path ? saved.path : path);
    setSaveError(false);
    setStatus(`Agent created ${saved.path}.`);
  }

  async function undoLastAgentApply() {
    const before = activeNoteRef.current;
    const root = vaultRef.current.trim();
    if (!before || !root) throw new Error("Open a real vault before undoing Agent changes.");
    const snapshot = await loadLastAgentUndoSnapshot({ vaultRoot: root, notePath: before.path });
    if (!snapshot) throw new Error("No Agent undo snapshot is available.");
    if (notesRef.current.some((note) => note.isDirty && (note.path === before.path || note.path === snapshot.createdNotePath))) throw new Error("请先保存当前草稿，再撤销 Agent 修改。");
    const result = await saveQueueRef.current(() => undoAgentChange(root, before.path));
    if (vaultRef.current.trim() !== root) return;
    setNotes((current) => {
      const remaining = current.filter((note) => note.path !== result.removedPath);
      return result.restored ? acknowledgeSave(remaining, before, result.restored) : remaining;
    });
    setActivePath((path) => path === before.path || path === result.removedPath ? result.activePath : path);
    setLinkVersion((version) => version + 1);
    setSaveError(false);
    setStatus("已撤销上次 Agent 修改。");
  }

  async function addFolder() {
    if (!vaultRoot.trim()) {
      setStatus("Open a real vault before creating folders.");
      return;
    }
    const path = await safePrompt(
      "Folder path",
      activeCategory || "knowledge/new-topic",
    );
    if (!path) return;
    try {
      await createFolder({ vaultRoot: vaultRoot.trim(), path });
      setActiveCategory(path);
      setActiveView("category");
      setStatus(`Created folder ${path}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function renameActiveNote() {
    if (!activeNote || !vaultRoot.trim()) {
      setStatus("Open a real vault before renaming notes.");
      return;
    }
    const currentName = activeNote.path.split("/").pop() ?? activeNote.path;
    const nextName = await safePrompt("New filename", currentName);
    if (!nextName || nextName === currentName) return;
    const folder = activeNote.path.includes("/")
      ? activeNote.path.split("/").slice(0, -1).join("/")
      : "";
    const normalized = nextName.endsWith(".md") ? nextName : `${nextName}.md`;
    const to = folder ? `${folder}/${normalized}` : normalized;
    await moveActiveNote(to);
  }

  async function moveActiveNotePrompt() {
    if (!activeNote) return;
    const nextPath = await safePrompt("Move to path", activeNote.path);
    if (!nextPath || nextPath === activeNote.path) return;
    await moveActiveNote(
      nextPath.endsWith(".md") ? nextPath : `${nextPath}.md`,
    );
  }

  async function moveActiveNote(to: string) {
    const before = activeNoteRef.current;
    const root = vaultRef.current.trim();
    if (!before || !root) return;
    try {
      setIsSaving(true);
      const moved = await saveQueueRef.current(() => commitNote({ vaultRoot: root, path: before.path, targetPath: to, expectedRevision: before.sourceRevision, content: noteToMarkdown(before) }));
      if (vaultRef.current.trim() !== root) return;
      setNotes((current) => acknowledgeSave(current, before, moved));
      setActivePath((path) => path === before.path ? moved.path : path);
      setLinkVersion((version) => version + 1);
      setSaveError(false);
      setStatus(`Moved to ${moved.path}.`);
    } catch (error) { setStatus(String(error)); }
    finally { setIsSaving(false); }
  }

  async function deleteNoteByPath(path: string) {
    if (!vaultRoot.trim()) {
      setStatus("Open a real vault before deleting notes.");
      return;
    }
    const isTrash = path.startsWith(".trash/");
    const confirmed = await safeConfirm(
      isTrash ? `Permanently delete ${path}?` : `Move ${path} to trash?`,
    );
    if (!confirmed) return;
    try {
      await deleteNote(vaultRoot.trim(), path);
      const remaining = notesRef.current.filter((note) => note.path !== path);
      setNotes((current) => current.filter((note) => note.path !== path));
      setIndexedResults((current) =>
        current.filter((note) => note.path !== path),
      );
      setLinkVersion((current) => current + 1);
      setActivePath((current) =>
        current === path ? (remaining[0]?.path ?? "") : current,
      );
      setSaveError(false);
      setStatus(
        isTrash ? `Permanently deleted ${path}.` : `Moved ${path} to trash.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function deleteActiveNote() {
    if (!activeNote) return;
    void deleteNoteByPath(activeNote.path);
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!leftSidebarVisible || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftSidebarWidth;

    function resize(moveEvent: PointerEvent) {
      const nextWidth = Math.min(
        560,
        Math.max(220, Math.round(startWidth + moveEvent.clientX - startX)),
      );
      setLeftSidebarWidth(nextWidth);
    }

    function stopResize() {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
    }

    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
  }

  function startRightSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!rightSidebarVisible || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightSidebarWidth;

    function resize(moveEvent: PointerEvent) {
      // Moving left increases width, moving right decreases width
      const nextWidth = Math.min(
        560,
        Math.max(220, Math.round(startWidth - (moveEvent.clientX - startX))),
      );
      setRightSidebarWidth(nextWidth);
    }

    function stopResize() {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
    }

    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
  }

  async function rebuildIndex() {
    if (!vaultRoot.trim()) {
      setStatus("Open a real vault before rebuilding the index.");
      return;
    }
    try {
      await rebuildSearchIndex(vaultRoot.trim(), true);
      await refreshVaultFromDisk("Search index rebuilt.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main
      inert={isClosing}
      className="flex flex-col h-screen w-screen bg-base-100 text-base-content overflow-hidden"
      data-theme={themeDatasetValue}
    >
      <header
        className="navbar bg-base-100/90 backdrop-blur border-b border-base-300 z-10 h-[52px] min-h-[52px] pl-[82px] pr-2 max-[900px]:pl-[74px]"
        style={{ WebkitAppRegion: "drag" } as any}
        onMouseDown={(e) => {
          if (
            (e.target as HTMLElement).closest(
              "button, input, a, [data-no-drag]",
            )
          )
            return;
          if (e.button !== 0) return;
          e.preventDefault();
          getCurrentWindow()
            .startDragging()
            .catch(() => { });
        }}
      >
        <div className="mr-2 flex min-w-0 flex-none select-none flex-col items-start">
          <strong className="text-sm font-bold leading-tight">iNote</strong>
          <span className="max-w-[140px] truncate text-xs leading-tight text-base-content/60">
            {vaultRoot.trim()
              ? vaultRoot.split("/").filter(Boolean).pop()
              : "Demo workspace"}
          </span>
        </div>
        <div
          className="flex-none"
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <button
            className={`btn btn-square btn-ghost btn-sm ${leftSidebarVisible ? "bg-base-content/10 text-primary" : ""}`}
            type="button"
            onClick={() => setLeftSidebarVisible((current) => !current)}
            title={
              leftSidebarVisible ? "Hide left sidebar" : "Show left sidebar"
            }
            aria-label={
              leftSidebarVisible ? "Hide left sidebar" : "Show left sidebar"
            }
          >
            <PanelLeft size={18} />
          </button>
        </div>
        <div
          className="flex flex-none items-center gap-0.5"
          data-no-drag
          aria-label={t("app.noteNavigation")}
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <button
            className="btn btn-square btn-ghost btn-sm disabled:bg-transparent disabled:text-base-content/20 disabled:opacity-40"
            type="button"
            disabled={previousHistoryIndex < 0}
            onClick={() => navigateNoteHistory(previousHistoryIndex)}
            title={t("app.previousNote")}
            aria-label={t("app.previousNote")}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="btn btn-square btn-ghost btn-sm disabled:bg-transparent disabled:text-base-content/20 disabled:opacity-40"
            type="button"
            disabled={nextHistoryIndex < 0}
            onClick={() => navigateNoteHistory(nextHistoryIndex)}
            title={t("app.nextNote")}
            aria-label={t("app.nextNote")}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="flex-1" />
        <div
          className="min-w-0 flex-none px-2"
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <label className="input input-sm input-bordered flex w-[min(320px,28vw)] min-w-[180px] items-center gap-2 transition-all focus-within:w-[min(380px,34vw)]">
            <Search size={16} className="text-base-content/50" />
            <input
              className="grow"
              aria-label={t("app.searchPlaceholder")}
              placeholder={t("app.searchPlaceholder")}
              value={query}
              onChange={(event) => {
                if (query !== "" && event.target.value === "") {
                  initialScrollDoneRef.current = false;
                }
                setQuery(event.target.value);
                setActiveView("search");
              }}
            />
            {query && (
              <button
                className="btn btn-ghost btn-xs btn-circle opacity-70 hover:opacity-100"
                type="button"
                onClick={() => {
                  initialScrollDoneRef.current = false;
                  setQuery("");
                }}
                title={t("app.clearSearch")}
                aria-label={t("app.clearSearch")}
              >
                <XCircle size={14} />
              </button>
            )}
          </label>
        </div>
        <div
          className="flex flex-none items-center gap-1"
          aria-label="Window actions"
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <button
            className="btn btn-ghost btn-sm btn-square"
            type="button"
            onClick={addCategoryNote}
            title={t("app.createNote")}
            aria-label={t("app.createNote")}
          >
            <Pencil size={18} className="text-accent" />
          </button>

          {showTodayNoteButton ? (
            <button
              className="btn btn-ghost btn-sm btn-square"
              type="button"
              onClick={addTodayNote}
              title={t("settings.todayNote")}
              aria-label={t("settings.todayNote")}
            >
              <FilePlus2 size={18} className="text-accent" />
            </button>
          ) : null}

          <button
            className={`btn btn-ghost btn-sm btn-square ${tagsPopoverOpen ? "bg-base-content/10 text-primary" : ""}`}
            type="button"
            onClick={() => setTagsPopoverOpen(true)}
            title={t("app.tags")}
            aria-label={t("app.tags")}
          >
            <Tags size={18} />
          </button>
          <button
            className={`btn btn-ghost btn-sm btn-square ${activeView === "todo" ? "bg-base-content/10 text-primary" : ""}`}
            type="button"
            onClick={() => {
              if (activeView === "todo") {
                setActiveView(previousViewRef.current.view);
                setActiveCategory(previousViewRef.current.category);
                if (previousViewRef.current.path) {
                  setActivePath(previousViewRef.current.path);
                }
              } else {
                if (
                  activeView !== "archive" &&
                  activeView !== "trash" &&
                  activeView !== "calendar"
                ) {
                  previousViewRef.current = {
                    view: activeView,
                    category: activeCategory,
                    path: activePath,
                  };
                }
                setActiveView("todo");
                setActivePath("");
              }
            }}
            title="Todo List"
            aria-label="Toggle Todo List"
          >
            <ListTodo size={18} />
          </button>
          <button
            className={`btn btn-ghost btn-sm btn-square ${activeView === "calendar" ? "bg-base-content/10 text-primary" : ""}`}
            type="button"
            onClick={() => toggleSpecialView("calendar")}
            title={t("app.calendar")}
            aria-label={t("app.calendar")}
          >
            <CalendarDays size={18} />
          </button>
          <button
            className={`btn btn-ghost btn-sm btn-square ${activeView === "archive" ? "bg-base-content/10 text-primary" : ""}`}
            type="button"
            onClick={() => toggleSpecialView("archive")}
            title={t("app.archive")}
            aria-label={t("app.archive")}
          >
            <Archive size={18} />
          </button>
          <button
            className={`btn btn-ghost btn-sm btn-square ${activeView === "trash" ? "bg-base-content/10 text-primary" : ""}`}
            type="button"
            onClick={() => toggleSpecialView("trash")}
            title={t("app.trash")}
            aria-label={t("app.trash")}
          >
            <Trash size={18} />
          </button>
          <button
            className={`btn btn-ghost btn-sm btn-square ${settingsOpen ? "bg-base-content/10 text-primary" : ""}`}
            type="button"
            onClick={() => setSettingsOpen(true)}
            title={t("app.settings")}
            aria-label={t("app.settings")}
          >
            <Settings size={18} />
          </button>
          <button
            className={`btn btn-ghost btn-sm btn-square ${rightSidebarVisible ? "bg-base-content/10 text-primary" : ""}`}
            type="button"
            onClick={() => setRightSidebarVisible((current) => !current)}
            title={
              rightSidebarVisible ? "Hide right sidebar" : "Show right sidebar"
            }
            aria-label={
              rightSidebarVisible ? "Hide right sidebar" : "Show right sidebar"
            }
          >
            <PanelRight size={18} />
          </button>
        </div>
      </header>

      <div
        className="flex-1 grid min-h-0 overflow-hidden bg-base-100"
        style={{
          gridTemplateColumns: `${leftSidebarVisible ? `${leftSidebarWidth}px 5px` : "0 0"} minmax(0, 1fr) ${rightSidebarVisible ? `5px ${rightSidebarWidth}px` : "0 0"
            }`,
        }}
      >
        <aside
          className={`flex min-h-0 flex-col overflow-hidden bg-base-200/40 border-base-300 ${leftSidebarVisible ? "border-r" : "invisible opacity-0 border-none"}`}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 bg-base-200/50">
            <details
              ref={categoryFilterRef}
              className="dropdown dropdown-bottom"
              data-no-drag
              open={categoryFilterOpen}
              onBlur={(event) => {
                if (categoryFilterPointerInsideRef.current) return;
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  setCategoryFilterOpen(false);
                }
              }}
              onPointerDownCapture={() => {
                categoryFilterPointerInsideRef.current = true;
                window.setTimeout(() => {
                  categoryFilterPointerInsideRef.current = false;
                }, 0);
              }}
              onToggle={(event) =>
                setCategoryFilterOpen(event.currentTarget.open)
              }
            >
              <summary
                className="btn btn-sm btn-ghost px-2 font-medium"
                title={searchScopeLabel}
              >
                {activeView === "today"
                  ? t("app.today")
                  : activeView === "search"
                    ? searchScopeLabel
                    : activeView === "category"
                      ? activeCategory
                      : activeView === "archive"
                        ? t("app.archive")
                        : activeView === "trash"
                          ? t("app.trash")
                          : t("app.allNotes")}
              </summary>
              <div className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52 max-h-[50vh] overflow-y-auto border border-base-300 flex-nowrap mt-1">
                <label className="label cursor-pointer justify-start gap-3 hover:bg-base-200 rounded px-2">
                  <input
                    className="checkbox checkbox-sm"
                    checked={selectedSearchCategories.length === 0}
                    type="checkbox"
                    onChange={() => {
                      setSelectedSearchCategories([]);
                      setActiveView("search");
                    }}
                  />
                  <span className="label-text font-medium">
                    {t("app.allCategories")}
                  </span>
                </label>
                {categoryOptions.map((category) => (
                  <label
                    key={category.name}
                    className="label cursor-pointer justify-start gap-3 hover:bg-base-200 rounded px-2"
                  >
                    <input
                      className="checkbox checkbox-sm"
                      checked={searchCategorySet.has(category.name)}
                      type="checkbox"
                      onChange={(event) => {
                        setActiveView("search");
                        setSelectedSearchCategories((current) => {
                          if (event.target.checked)
                            return [...current, category.name].sort((a, b) =>
                              a.localeCompare(b),
                            );
                          return current.filter(
                            (name) => name !== category.name,
                          );
                        });
                      }}
                    />
                    <span className="label-text flex-1 truncate">
                      {category.name}
                    </span>
                    <span className="badge badge-sm badge-ghost">
                      {category.count}
                    </span>
                  </label>
                ))}
              </div>
            </details>
            <div className="flex items-center gap-1">
              <div
                className="flex items-center gap-1 bg-base-200/50 rounded-lg p-1"
                aria-label="Note list display mode"
              >
                <span className="text-[10px] font-mono text-base-content/50 px-1">
                  {visibleNotes.length}
                </span>
                <button
                  className={`btn btn-xs btn-ghost btn-square ${noteListMode === "cards" ? "bg-base-content/20" : ""}`}
                  type="button"
                  onClick={() => setNoteListMode("cards")}
                  title="Card view"
                  aria-label="Card view"
                >
                  <LayoutGrid size={13} />
                </button>
                <button
                  className={`btn btn-xs btn-ghost btn-square ${noteListMode === "summary" ? "bg-base-content/20" : ""}`}
                  type="button"
                  onClick={() => setNoteListMode("summary")}
                  title="Summary view"
                  aria-label="Summary view"
                >
                  <List size={13} />
                </button>
              </div>
            </div>
          </div>
          <div
            className={`note-list flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-2 ${noteListMode}`}
            tabIndex={0}
            onKeyDown={handleNoteListKeyDown}
            onScroll={handleNoteListScroll}
          >
            {visibleNoteGroups.map((group) => {
              const header = (
                <div className="flex items-center justify-between w-full">
                  <h3 className="text-xs font-bold text-base-content/70 uppercase tracking-wider m-0">
                    {group.month}
                  </h3>
                  <span className="text-[10px] bg-base-300 text-base-content/70 px-1.5 py-0.5 rounded-full">
                    {group.notes.length}
                  </span>
                </div>
              );
              const content = (
                <div
                  className={`mt-2 ${noteListMode === "cards" ? "note-card-grid" : "note-summary-stack flex flex-col gap-0.5"}`}
                >
                  {group.notes.map((note) =>
                    noteListMode === "cards" ? (
                      <NoteCardItem
                        key={note.path}
                        note={note}
                        isActive={note.path === activePath}
                        onSelect={setActivePath}
                      />
                    ) : (
                      <NoteRowItem
                        key={note.path}
                        note={note}
                        isActive={note.path === activePath}
                        onSelect={setActivePath}
                      />
                    ),
                  )}
                </div>
              );

              return (
                <section className="mb-4 last:mb-0" key={group.month}>
                  {group.isCollapsed ? (
                    <details className="group" data-no-drag>
                      <summary className="flex items-center cursor-pointer select-none py-1.5 px-2 hover:bg-base-200/50 rounded-lg transition-colors marker:text-base-content/50 marker:text-xs">
                        {header}
                      </summary>
                      <div className="mt-1 px-1">{content}</div>
                    </details>
                  ) : (
                    <>
                      <div className="flex items-center px-2 py-1.5 mb-1">
                        {header}
                      </div>
                      <div className="px-1">{content}</div>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </aside>
        <div
          className={`w-full h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/50 transition-colors z-10 ${leftSidebarVisible ? "" : "invisible opacity-0"}`}
          onPointerDown={startSidebarResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize left sidebar"
        />

        <section className="flex min-h-0 flex-col min-w-0 bg-base-100 relative shadow-inner">
          {activeView === "calendar" ? (
            <Suspense fallback={<div className="empty">Loading calendar…</div>}>
              <CalendarView
                notes={notes}
                onSelectNote={setActivePath}
                onClose={() => toggleSpecialView("calendar")}
              />
            </Suspense>
          ) : activeView === "todo" && !activeNote ? (
            <Suspense
              fallback={<div className="empty">Loading todo dashboard…</div>}
            >
              <TodoDashboard
                notes={visibleNotes}
                onSelectNote={setActivePath}
                onUpdateNoteStatus={updateNoteStatus}
              />
            </Suspense>
          ) : activeNote ? (
            startupMigrationPath === activeNote.path ? (
              <div className="empty">Optimizing embedded note images…</div>
            ) : !editorPaintReady || activeNote.bodyLoaded === false ? (
              <div className="empty">Loading note…</div>
            ) : (
              <FeatureBoundary resetKey={activeNote.path}><Suspense fallback={<div className="empty">Loading note…</div>}><Editor
                key={activeNote.path}
                vaultRoot={vaultRoot.trim()}
                note={activeNote}
                onChange={updateActiveNote}
                onSave={saveActiveNote}
                onRename={renameActiveNote}
                onMove={moveActiveNotePrompt}
                onCheckExternal={checkExternalActiveNote}
                onDelete={deleteActiveNote}
                previewMode={previewMode || isSaving}
                onTogglePreview={() => setPreviewMode((current) => !current)}
                saveState={saveState}
                noteLinks={noteLinks}
                onUpdateTitle={updateActiveNoteTitle}
                onUpdateCreatedAt={updateActiveNoteCreatedAt}
                onUpdateUpdatedAt={updateActiveNoteUpdatedAt}
                onUpdateDue={updateActiveNoteDue}
                onUpdateStatus={updateActiveNoteStatus}
                onUpdatePriority={updateActiveNotePriority}
                onUpdateProject={updateActiveNoteProject}
                onUpdateTags={updateActiveNoteTags}
                onArchiveInboxNote={archiveActiveInboxNote}
                onNavigateLink={setActivePath}
              /></Suspense></FeatureBoundary>
            )
          ) : (
            <div className="empty">
              {activeView === "search" && query.startsWith("#")
                ? t("app.noNoteSelected")
                : t("app.noNoteSelected")}
            </div>
          )}
        </section>

        <div
          className={`w-full h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/50 transition-colors z-10 ${rightSidebarVisible ? "" : "invisible opacity-0"}`}
          onPointerDown={startRightSidebarResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right sidebar"
        />

        <aside
          className={`flex min-h-0 flex-col overflow-hidden bg-base-200/40 border-base-300 ${rightSidebarVisible ? "border-l" : "invisible opacity-0 border-none"}`}
        >
          {rightSidebarVisible && activeNote && activeNote.bodyLoaded !== false ? (
            <FeatureBoundary resetKey={activeNote.path}>
              <Suspense
                fallback={<div className="empty">Loading note agent...</div>}
              >
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

      {settingsOpen ? (
        <div
          className="settings-window-backdrop modal modal-open"
          role="presentation"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <div
            className="settings-window modal-box h-[min(760px,86vh)] max-h-[86vh] w-[min(840px,92vw)] max-w-none overflow-hidden p-0"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Suspense fallback={<div className="empty">Loading settings…</div>}>
              <SettingsPanel
                vaultRoot={vaultPathInput}
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
          </div>
        </div>
      ) : null}

      {tagsPopoverOpen ? (
        <div
          className="tags-popover-backdrop modal modal-open"
          role="presentation"
          onMouseDown={() => setTagsPopoverOpen(false)}
        >
          <div
            className="modal-box max-h-[86vh] w-[min(760px,92vw)] max-w-none overflow-hidden p-0"
            role="dialog"
            aria-modal="true"
            aria-label="Tags"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Suspense fallback={<div className="empty">Loading tags…</div>}>
              <TagsPanel
                notes={notes}
                onSelectNote={(path) => {
                  setActivePath(path);
                }}
                onClose={() => setTagsPopoverOpen(false)}
              />
            </Suspense>
          </div>
        </div>
      ) : null}

      {promptConfig ? (
        <div
          className="settings-window-backdrop modal modal-open"
          role="presentation"
          style={{ zIndex: 1000 }}
          onMouseDown={() => {
            promptConfig.resolve(null);
            setPromptConfig(null);
          }}
        >
          <div
            className="settings-window modal-box w-[min(420px,92vw)] max-w-none p-6"
            role="dialog"
            aria-modal="true"
            aria-label={promptConfig.message}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const val = new FormData(e.currentTarget).get("val") as string;
                promptConfig.resolve(val);
                setPromptConfig(null);
              }}
            >
              <h3 className="mb-4 mt-0 text-lg font-semibold">
                {promptConfig.message}
              </h3>
              <input
                className="input input-bordered mb-6 w-full"
                name="val"
                defaultValue={promptConfig.defaultValue}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    promptConfig.resolve(null);
                    setPromptConfig(null);
                  }
                }}
              />
              <div className="modal-action">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    promptConfig.resolve(null);
                    setPromptConfig(null);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  OK
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <footer className="status-bar">
        <span className={`status-pill ${saveState}`}>{saveLabel}</span>
        <span>
          Vault:{" "}
          {vaultRoot.trim()
            ? vaultRoot.split("/").filter(Boolean).pop()
            : "Demo workspace"}
        </span>
        <span>{notes.length} notes</span>
        <span>{status}</span>
        <span>{activeNote ? activeNote.path : "No note"}</span>
        <span>
          {activeNote
            ? `${activeNote.wordCount} words`
            : `${totalWords} words total`}
        </span>
      </footer>
    </main>
  );
}
