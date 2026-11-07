import { memo, useEffect, useMemo, useRef, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Clock, Flag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NoteCoverPreview } from "../../features/editor/NoteCoverPreview";
import { MindMapThumbnail, thumbnailMap } from "../../features/mindmap/MindMapThumbnail";
import { HighlightedText, SearchMatchMetadata } from "../../features/search/HighlightedText";
import { excerptAroundMatch } from "../../features/search/searchHighlight";
import { dueTone } from "../../shared/dueDates";
import type { Note, SearchResult } from "../../shared/types";

export const NOTE_DRAG_TYPE = "application/x-inote-note";

const excerptCache = new WeakMap<Note | SearchResult, string>();

export function stripMarkdownForSummary(value: string): string {
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

export function noteExcerpt(note: Note | SearchResult, query = ""): string {
  if (query.trim()) {
    for (const value of [note.excerpt, note.summary, "body" in note ? note.body : ""]) {
      if (!value) continue;
      const text = stripMarkdownForSummary(value.replace(/```[^\n]*\n?/g, ""));
      const excerpt = excerptAroundMatch(text, query);
      if (excerpt !== null) return excerpt;
    }
  }
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

export interface NoteItemProps {
  previewNote?: Note;
  vaultRoot?: string;
  note: Note | SearchResult;
  isActive: boolean;
  onSelect: (path: string) => void;
  onContextMenu?: (path: string, x: number, y: number) => void;
  searchQuery: string;
}

function startNoteDrag(event: DragEvent<HTMLElement>, note: Note | SearchResult) {
  event.dataTransfer.setData(NOTE_DRAG_TYPE, note.path);
  event.dataTransfer.setData("text/plain", note.path);
  event.dataTransfer.effectAllowed = "move";
}

function contextMenuHandlers(path: string, onContextMenu?: NoteItemProps["onContextMenu"]) {
  if (!onContextMenu) return {};
  return {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      onContextMenu(path, event.clientX, event.clientY);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onContextMenu(path, rect.left + 24, rect.top + Math.min(rect.height, 32));
      }
    },
  };
}

function DueBadge({ due, compact }: { due: string; compact?: boolean }) {
  const { t } = useTranslation();
  const tone = dueTone(due);
  return (
    <span
      className={`due-badge ${tone} flex items-center gap-1 rounded-full ${compact ? "px-1" : "px-1.5 py-0.5"}`}
      title={t("todo.dueTooltip", { due })}
    >
      <Clock size={10} />
      {due.split("T")[0]}
    </span>
  );
}

function PriorityFlag({ priority }: { priority: string }) {
  const { t } = useTranslation();
  return (
    <Flag
      size={12}
      aria-label={t("todo.priorityLabel", { priority: t(`editor.${priority}`) })}
      className={`shrink-0 ${priority === "high" ? "text-error" : priority === "medium" ? "text-warning" : "text-info"}`}
    />
  );
}

export const NoteCardItem = memo(function NoteCardItem({
  note,
  previewNote,
  vaultRoot = "",
  isActive,
  onSelect,
  onContextMenu,
  searchQuery,
}: NoteItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useMemo(() => thumbnailMap(previewNote ?? note), [note, previewNote]);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);

  const excerpt = <small className="text-xs text-base-content/60 leading-relaxed">
    <HighlightedText text={noteExcerpt(note, searchQuery)} query={searchQuery} />
  </small>;
  const coverNote = previewNote ?? ("body" in note ? note : undefined);
  return (
    <div
      ref={ref}
      className={isActive ? "note-card active" : "note-card"}
      draggable
      onDragStart={(event) => startNoteDrag(event, note)}
      {...contextMenuHandlers(note.path, onContextMenu)}
    >
      <button
        className={`note-card-select card bg-base-100 shadow-sm border border-base-200/50 hover:shadow-md hover:-translate-y-0.5 w-full text-left ${isActive ? "ring-2 ring-primary bg-primary/5 border-primary/20 transition-none" : "transition-all"}`}
        type="button"
        aria-current={isActive ? "true" : undefined}
        onClick={() => onSelect(note.path)}
      >
        <div className="card-body h-full p-0 gap-2">
          <div className="flex items-start justify-between gap-2">
            <strong className="text-sm font-bold leading-tight flex-1">
              <HighlightedText text={note.title} query={searchQuery} />
            </strong>
            {"priority" in note && note.priority && note.priority !== "none" && <PriorityFlag priority={note.priority} />}
          </div>
          {map && <MindMapThumbnail map={map} />}
          {map ? (searchQuery.trim() ? excerpt : null) : coverNote ? (
            <NoteCoverPreview note={coverNote} vaultRoot={vaultRoot} fallback={excerpt} showExcerpt={!!searchQuery.trim()} />
          ) : excerpt}
          <SearchMatchMetadata note={note} query={searchQuery} />
          <div className="note-card-footer flex items-center justify-between text-[10px] text-base-content/40 mt-auto font-mono">
            <time>{note.updatedAt || note.createdAt}</time>
            {"due" in note && note.due && <DueBadge due={note.due} />}
          </div>
        </div>
      </button>
    </div>
  );
});

export const NoteRowItem = memo(function NoteRowItem({
  note,
  isActive,
  onSelect,
  onContextMenu,
  searchQuery,
}: NoteItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);

  return (
    <div
      ref={ref}
      className="w-full min-w-0 max-w-full"
      draggable
      onDragStart={(event) => startNoteDrag(event, note)}
      {...contextMenuHandlers(note.path, onContextMenu)}
    >
      <button
        className={`note-row-select flex flex-col w-full min-w-0 max-w-full text-left px-3 py-2 rounded-lg transition-none ${isActive ? "bg-primary/10 text-primary" : ""}`}
        type="button"
        aria-current={isActive ? "true" : undefined}
        onClick={() => onSelect(note.path)}
      >
        <div className="flex items-center justify-between gap-2 w-full min-w-0 max-w-full">
          <strong
            className={`text-sm font-semibold truncate min-w-0 max-w-full ${isActive ? "text-primary" : "text-base-content"}`}
          >
            <HighlightedText text={note.title} query={searchQuery} />
          </strong>
          {"priority" in note && note.priority && note.priority !== "none" && <PriorityFlag priority={note.priority} />}
        </div>
        <div className="flex flex-col items-start w-full mt-0.5 gap-1">
          <small className="text-xs text-base-content/50 break-words whitespace-normal line-clamp-2 w-full text-left">
            <HighlightedText text={noteExcerpt(note, searchQuery)} query={searchQuery} />
          </small>
          <SearchMatchMetadata note={note} query={searchQuery} />
          <div className="flex items-center justify-end gap-2 w-full shrink-0 text-[10px]">
            {"due" in note && note.due && <DueBadge due={note.due} compact />}
            <time className="text-[10px] text-base-content/40 font-mono shrink-0">
              {note.updatedAt || note.createdAt}
            </time>
          </div>
        </div>
      </button>
    </div>
  );
});
