import { useEffect, useRef, useState, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import {
  Archive,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  FilePlus2,
  FolderPlus,
  ListTodo,
  Network,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  Settings,
  Tags,
  Trash,
} from "lucide-react";
import type { WorkspaceView } from "../../shared/types";
import { formatShortcut, withShortcut } from "../shortcuts";
import { SearchBox } from "./SearchBox";

type SpecialView = "archive" | "trash" | "calendar" | "todo";

interface TitleBarProps {
  vaultName: string;
  leftSidebarVisible: boolean;
  onToggleLeftSidebar: () => void;
  rightSidebarVisible: boolean;
  onToggleRightSidebar: () => void;
  showRightSidebarToggle: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  onClearSearch: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  activeView: WorkspaceView;
  onToggleView: (view: SpecialView) => void;
  tagsOpen: boolean;
  onOpenTags: () => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  showTodayNoteButton: boolean;
  onCreateNote: () => void;
  onCreateToday: () => void;
  onCreateMindMap: () => void;
  onCreateFolder: () => void;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function TitleBar(props: TitleBarProps) {
  const { t } = useTranslation();
  const activeClass = "bg-base-content/10 text-primary";
  const viewButtons: Array<{ view: SpecialView; label: string; icon: typeof Archive }> = [
    { view: "todo", label: t("app.todo"), icon: ListTodo },
    { view: "calendar", label: t("app.calendar"), icon: CalendarDays },
    { view: "archive", label: t("app.archive"), icon: Archive },
    { view: "trash", label: t("app.trash"), icon: Trash },
  ];

  return (
    <header
      className="navbar title-bar bg-base-100/90 backdrop-blur border-b border-base-300 z-10 h-[52px] min-h-[52px] pl-[82px] pr-2 max-[900px]:pl-[74px] gap-1"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button, input, a, summary, [data-no-drag]")) return;
        if (e.button !== 0) return;
        e.preventDefault();
        getCurrentWindow()
          .startDragging()
          .catch(() => { });
      }}
    >
      <div className="mr-2 flex min-w-0 flex-none select-none flex-col items-start">
        <strong className="text-sm font-bold leading-tight">iNote</strong>
        <span className="max-w-[140px] truncate text-xs leading-tight text-base-content/60" title={props.vaultName}>
          {props.vaultName}
        </span>
      </div>
      <div className="flex flex-none items-center gap-0.5" data-no-drag style={noDrag}>
        <button
          className={`btn btn-square btn-ghost btn-sm ${props.leftSidebarVisible ? activeClass : ""}`}
          type="button"
          aria-pressed={props.leftSidebarVisible}
          onClick={props.onToggleLeftSidebar}
          title={withShortcut(t(props.leftSidebarVisible ? "app.hideLeftSidebar" : "app.showLeftSidebar"), "toggleLeftSidebar")}
          aria-label={t(props.leftSidebarVisible ? "app.hideLeftSidebar" : "app.showLeftSidebar")}
        >
          <PanelLeft size={18} />
        </button>
        <button
          className="btn btn-square btn-ghost btn-sm disabled:bg-transparent disabled:text-base-content/20 disabled:opacity-40"
          type="button"
          disabled={!props.canGoBack}
          onClick={props.onBack}
          title={withShortcut(t("app.previousNote"), "historyBack")}
          aria-label={t("app.previousNote")}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="btn btn-square btn-ghost btn-sm disabled:bg-transparent disabled:text-base-content/20 disabled:opacity-40"
          type="button"
          disabled={!props.canGoForward}
          onClick={props.onForward}
          title={withShortcut(t("app.nextNote"), "historyForward")}
          aria-label={t("app.nextNote")}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="flex-1" />
      <div className="min-w-0 flex-none px-1" style={noDrag}>
        <SearchBox query={props.query} onQueryChange={props.onQueryChange} onClear={props.onClearSearch} inputRef={props.searchInputRef} />
      </div>
      <div className="flex flex-none items-center gap-1" data-no-drag style={noDrag}>
        <CreateMenu {...props} />
        {props.showTodayNoteButton ? (
          <button
            className="btn btn-ghost btn-sm btn-square"
            type="button"
            onClick={props.onCreateToday}
            title={t("settings.todayNote")}
            aria-label={t("settings.todayNote")}
          >
            <FilePlus2 size={18} className="text-accent" />
          </button>
        ) : null}
        <div className="title-bar-group" role="group" aria-label={t("app.views")}>
          <button
            className={`btn btn-ghost btn-sm btn-square ${props.tagsOpen ? activeClass : ""}`}
            type="button"
            onClick={props.onOpenTags}
            title={t("app.tags")}
            aria-label={t("app.tags")}
          >
            <Tags size={17} />
          </button>
          {viewButtons.map(({ view, label, icon: Icon }) => (
            <button
              key={view}
              className={`btn btn-ghost btn-sm btn-square ${props.activeView === view ? activeClass : ""}`}
              type="button"
              aria-pressed={props.activeView === view}
              onClick={() => props.onToggleView(view)}
              title={label}
              aria-label={label}
            >
              <Icon size={17} />
            </button>
          ))}
        </div>
        <button
          className="btn btn-ghost btn-sm btn-square"
          type="button"
          onClick={props.onOpenPalette}
          title={withShortcut(t("palette.title"), "commandPalette")}
          aria-label={t("palette.title")}
        >
          <Command size={17} />
        </button>
        <button
          className={`btn btn-ghost btn-sm btn-square ${props.settingsOpen ? activeClass : ""}`}
          type="button"
          onClick={props.onOpenSettings}
          title={`${t("app.settings")} (⌘,)`}
          aria-label={t("app.settings")}
        >
          <Settings size={17} />
        </button>
        {props.showRightSidebarToggle && (
          <button
            className={`btn btn-ghost btn-sm btn-square ${props.rightSidebarVisible ? activeClass : ""}`}
            type="button"
            aria-pressed={props.rightSidebarVisible}
            onClick={props.onToggleRightSidebar}
            title={withShortcut(t(props.rightSidebarVisible ? "app.hideRightSidebar" : "app.showRightSidebar"), "toggleRightSidebar")}
            aria-label={t(props.rightSidebarVisible ? "app.hideRightSidebar" : "app.showRightSidebar")}
          >
            <PanelRight size={18} />
          </button>
        )}
      </div>
    </header>
  );
}

function CreateMenu({ onCreateNote, onCreateToday, onCreateMindMap, onCreateFolder, showTodayNoteButton }: TitleBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={ref} className="create-menu relative flex items-center">
      <div className="join">
        <button
          className="btn btn-ghost btn-sm join-item px-2"
          type="button"
          onClick={onCreateNote}
          title={withShortcut(t("app.createNote"), "newNote")}
          aria-label={t("app.createNote")}
        >
          <Plus size={18} className="text-accent" />
        </button>
        <button
          className="btn btn-ghost btn-sm join-item px-1"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          title={t("app.createMenu")}
          aria-label={t("app.createMenu")}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {open ? (
        <div className="create-menu-popover" role="menu" aria-label={t("app.createMenu")}>
          <button type="button" className="app-menu-item" role="menuitem" onClick={run(onCreateNote)} autoFocus>
            <Pencil size={15} /> <span className="flex-1">{t("app.createNote")}</span>
            <kbd>{formatShortcut("newNote")}</kbd>
          </button>
          {showTodayNoteButton ? (
            <button type="button" className="app-menu-item" role="menuitem" onClick={run(onCreateToday)}>
              <FilePlus2 size={15} /> <span className="flex-1">{t("settings.todayNote")}</span>
            </button>
          ) : null}
          <button type="button" className="app-menu-item" role="menuitem" onClick={run(onCreateMindMap)}>
            <Network size={15} /> <span className="flex-1">{t("mindmap.title")}</span>
          </button>
          <button type="button" className="app-menu-item" role="menuitem" onClick={run(onCreateFolder)}>
            <FolderPlus size={15} /> <span className="flex-1">{t("app.newFolder")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
