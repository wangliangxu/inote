import { useEffect, useRef, type KeyboardEvent, type RefObject, type UIEvent } from "react";
import { Archive, FilePlus2, LayoutGrid, List, ListTodo, SearchX, Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Note, SearchResult, WorkspaceView } from "../../shared/types";
import { EmptyState } from "./EmptyState";
import { NoteCardItem, NoteRowItem } from "./NoteListItems";

export interface NoteGroup {
  id: string;
  label: string;
  notes: Array<Note | SearchResult>;
  isCollapsed: boolean;
}

interface NoteListPanelProps {
  visible: boolean;
  activeView: WorkspaceView;
  activeCategory: string;
  searchScopeLabel: string;
  query: string;
  categoryOptions: Array<{ name: string; count: number }>;
  selectedSearchCategories: string[];
  onSelectAllCategories: () => void;
  onToggleSearchCategory: (name: string, checked: boolean) => void;
  categoryFilterOpen: boolean;
  setCategoryFilterOpen: (open: boolean) => void;
  categoryFilterRef: RefObject<HTMLDetailsElement | null>;
  noteListMode: "cards" | "summary";
  setNoteListMode: (mode: "cards" | "summary") => void;
  visibleCount: number;
  groups: NoteGroup[];
  notes: Note[];
  activePath: string;
  vaultRoot: string;
  onSelect: (path: string) => void;
  onNoteContextMenu: (path: string, x: number, y: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onCreateNote: () => void;
  canCreate: boolean;
}

export function NoteListPanel(props: NoteListPanelProps) {
  const { t } = useTranslation();
  const {
    visible, activeView, activeCategory, searchScopeLabel, query, categoryOptions, selectedSearchCategories,
    categoryFilterOpen, setCategoryFilterOpen, categoryFilterRef, noteListMode, setNoteListMode,
    visibleCount, groups, notes, activePath, vaultRoot, onSelect, onNoteContextMenu, onKeyDown, onScroll,
  } = props;
  const categoryFilterPointerInsideRef = useRef(false);
  const searchCategorySet = new Set(selectedSearchCategories);
  const searchQuery = activeView === "search" ? query : "";

  useEffect(() => {
    if (!categoryFilterOpen) return;
    function closeCategoryFilter(event: PointerEvent) {
      if (!categoryFilterRef.current?.contains(event.target as Node)) setCategoryFilterOpen(false);
    }
    window.addEventListener("pointerdown", closeCategoryFilter);
    return () => window.removeEventListener("pointerdown", closeCategoryFilter);
  }, [categoryFilterOpen, categoryFilterRef, setCategoryFilterOpen]);

  const viewLabel = activeView === "today"
    ? t("app.today")
    : activeView === "search"
      ? searchScopeLabel
      : activeView === "category"
        ? activeCategory
        : activeView === "archive"
          ? t("app.archive")
          : activeView === "trash"
            ? t("app.trash")
            : activeView === "todo"
              ? t("app.todo")
              : t("app.allNotes");

  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden bg-base-200/40 border-base-300 ${visible ? "border-r" : "invisible opacity-0 border-none"}`}
      aria-label={t("app.noteList")}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 bg-base-200/50">
        <details
          ref={categoryFilterRef}
          className="dropdown dropdown-bottom"
          data-no-drag
          open={categoryFilterOpen}
          onBlur={(event) => {
            if (categoryFilterPointerInsideRef.current) return;
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCategoryFilterOpen(false);
          }}
          onPointerDownCapture={() => {
            categoryFilterPointerInsideRef.current = true;
            window.setTimeout(() => {
              categoryFilterPointerInsideRef.current = false;
            }, 0);
          }}
          onToggle={(event) => setCategoryFilterOpen(event.currentTarget.open)}
        >
          <summary className="btn btn-sm btn-ghost px-2 font-medium" title={t("app.filterCategories")}>
            {viewLabel}
          </summary>
          <div className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52 max-h-[50vh] overflow-y-auto border border-base-300 flex-nowrap mt-1">
            <label className="label cursor-pointer justify-start gap-3 hover:bg-base-200 rounded px-2">
              <input
                className="checkbox checkbox-sm"
                checked={selectedSearchCategories.length === 0}
                type="checkbox"
                onChange={props.onSelectAllCategories}
              />
              <span className="label-text font-medium">{t("app.allCategories")}</span>
            </label>
            {categoryOptions.map((category) => (
              <label key={category.name} className="label cursor-pointer justify-start gap-3 hover:bg-base-200 rounded px-2">
                <input
                  className="checkbox checkbox-sm"
                  checked={searchCategorySet.has(category.name)}
                  type="checkbox"
                  onChange={(event) => props.onToggleSearchCategory(category.name, event.target.checked)}
                />
                <span className="label-text flex-1 truncate">{category.name}</span>
                <span className="badge badge-sm badge-ghost">{category.count}</span>
              </label>
            ))}
          </div>
        </details>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 bg-base-200/50 rounded-lg p-1" role="group" aria-label={t("app.listMode")}>
            <span className="text-[10px] font-mono text-base-content/50 px-1" title={t("app.noteCount", { count: visibleCount })}>
              {visibleCount}
            </span>
            <button
              className={`btn btn-xs btn-ghost btn-square ${noteListMode === "cards" ? "bg-base-content/20" : ""}`}
              type="button"
              aria-pressed={noteListMode === "cards"}
              onClick={() => setNoteListMode("cards")}
              title={t("app.cardView")}
              aria-label={t("app.cardView")}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              className={`btn btn-xs btn-ghost btn-square ${noteListMode === "summary" ? "bg-base-content/20" : ""}`}
              type="button"
              aria-pressed={noteListMode === "summary"}
              onClick={() => setNoteListMode("summary")}
              title={t("app.summaryView")}
              aria-label={t("app.summaryView")}
            >
              <List size={13} />
            </button>
          </div>
        </div>
      </div>
      <div
        className={`note-list flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-2 ${noteListMode}`}
        tabIndex={0}
        aria-label={t("app.noteListHint")}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
      >
        {groups.length === 0 ? <NoteListEmpty {...props} /> : null}
        {groups.map((group) => {
          const header = (
            <div className="flex items-center justify-between w-full">
              <h3 className="text-xs font-bold text-base-content/70 uppercase tracking-wider m-0">{group.label}</h3>
              <span className="text-[10px] bg-base-300 text-base-content/70 px-1.5 py-0.5 rounded-full">{group.notes.length}</span>
            </div>
          );
          const content = (
            <div className={`mt-2 ${noteListMode === "cards" ? "note-card-grid" : "note-summary-stack flex flex-col gap-0.5"}`}>
              {group.notes.map((note) =>
                noteListMode === "cards" ? (
                  <NoteCardItem
                    vaultRoot={vaultRoot}
                    previewNote={activeView === "search" ? notes.find((item) => item.path === note.path) : undefined}
                    key={note.path}
                    note={note}
                    isActive={note.path === activePath}
                    onSelect={onSelect}
                    onContextMenu={onNoteContextMenu}
                    searchQuery={searchQuery}
                  />
                ) : (
                  <NoteRowItem
                    key={note.path}
                    note={note}
                    isActive={note.path === activePath}
                    onSelect={onSelect}
                    onContextMenu={onNoteContextMenu}
                    searchQuery={searchQuery}
                  />
                ),
              )}
            </div>
          );
          return (
            <section className="mb-4 last:mb-0" key={group.id}>
              {group.isCollapsed ? (
                <details className="group" data-no-drag>
                  <summary className="flex items-center cursor-pointer select-none py-1.5 px-2 hover:bg-base-200/50 rounded-lg transition-colors marker:text-base-content/50 marker:text-xs">
                    {header}
                  </summary>
                  <div className="mt-1 px-1">{content}</div>
                </details>
              ) : (
                <>
                  <div className="flex items-center px-2 py-1.5 mb-1">{header}</div>
                  <div className="px-1">{content}</div>
                </>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function NoteListEmpty({ activeView, query, onCreateNote, canCreate }: NoteListPanelProps) {
  const { t } = useTranslation();
  const create = canCreate ? { label: t("app.createNote"), onClick: onCreateNote, icon: <FilePlus2 size={14} /> } : undefined;
  if (activeView === "search" && query.trim()) {
    return <EmptyState compact icon={<SearchX size={28} />} title={t("empty.searchTitle", { query: query.trim() })} description={t("empty.searchHint")} />;
  }
  if (activeView === "trash") return <EmptyState compact icon={<Trash size={28} />} title={t("empty.trashTitle")} description={t("empty.trashHint")} />;
  if (activeView === "archive") return <EmptyState compact icon={<Archive size={28} />} title={t("empty.archiveTitle")} description={t("empty.archiveHint")} />;
  if (activeView === "todo") return <EmptyState compact icon={<ListTodo size={28} />} title={t("empty.todoTitle")} description={t("empty.todoHint")} />;
  return <EmptyState compact icon={<FilePlus2 size={28} />} title={t("empty.listTitle")} description={t("empty.listHint")} action={create} />;
}
