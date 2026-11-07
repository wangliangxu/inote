import { useMemo, useRef, useState, type ReactNode } from "react";
import { FileText, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import type { Note } from "../../shared/types";

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  shortcut?: string;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  mode: "all" | "notes";
  commands: PaletteCommand[];
  notes: Note[];
  onOpenNote: (path: string) => void;
  onClose: () => void;
}

type Entry =
  | { kind: "command"; command: PaletteCommand }
  | { kind: "note"; note: Note };

const NOTE_LIMIT = 30;

function matches(haystack: string, terms: string[]): boolean {
  const value = haystack.toLowerCase();
  return terms.every((term) => value.includes(term));
}

export function CommandPalette({ open, mode, commands, notes, onOpenNote, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const commandEntries: Entry[] = mode === "all"
      ? commands
        .filter((command) => !command.disabled && matches(`${command.label} ${command.group} ${command.keywords ?? ""}`, terms))
        .map((command) => ({ kind: "command", command }))
      : [];
    const visibleNotes = notes.filter((note) => !note.path.startsWith(".trash/"));
    const noteEntries: Entry[] = (terms.length
      ? visibleNotes.filter((note) => matches(`${note.title} ${note.path} ${note.tags.join(" ")}`, terms))
        .sort((a, b) => {
          const term = terms[0];
          const aTitle = a.title.toLowerCase().startsWith(term) ? 0 : 1;
          const bTitle = b.title.toLowerCase().startsWith(term) ? 0 : 1;
          return aTitle - bTitle || b.updatedAt.localeCompare(a.updatedAt);
        })
      : [...visibleNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    ).slice(0, mode === "all" && !terms.length ? 8 : NOTE_LIMIT).map((note) => ({ kind: "note", note }));
    return [...commandEntries, ...noteEntries];
  }, [commands, mode, notes, query]);

  const close = () => {
    setQuery("");
    setHighlight(0);
    onClose();
  };

  function run(entry: Entry | undefined) {
    if (!entry) return;
    close();
    if (entry.kind === "command") entry.command.run();
    else onOpenNote(entry.note.path);
  }

  function moveHighlight(next: number) {
    const clamped = Math.max(0, Math.min(next, entries.length - 1));
    setHighlight(clamped);
    listRef.current?.querySelector(`#palette-option-${clamped}`)?.scrollIntoView({ block: "nearest" });
  }

  let lastGroup = "";
  return (
    <Modal open={open} onClose={close} label={t("palette.title")} className="palette-modal" boxClassName="command-palette w-[min(620px,94vw)] max-w-none p-0">
      <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3">
        <Search size={16} className="text-base-content/50" />
        <input
          id="command-palette-input"
          className="grow bg-transparent text-base outline-none"
          placeholder={mode === "notes" ? t("palette.notesPlaceholder") : t("palette.placeholder")}
          value={query}
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={entries.length ? `palette-option-${highlight}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveHighlight(highlight + 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveHighlight(highlight - 1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(entries[highlight]);
            }
          }}
        />
        <kbd className="kbd kbd-sm">Esc</kbd>
      </div>
      <ul id="command-palette-list" ref={listRef} className="m-0 max-h-[56vh] list-none overflow-y-auto p-2" role="listbox">
        {entries.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-base-content/60">{t("palette.empty")}</li>
        ) : null}
        {entries.map((entry, index) => {
          const group = entry.kind === "command" ? entry.command.group : t("palette.notes");
          const header = group !== lastGroup ? group : null;
          lastGroup = group;
          return (
            <li key={entry.kind === "command" ? `c-${entry.command.id}` : `n-${entry.note.path}`} role="presentation">
              {header ? <div className="palette-group">{header}</div> : null}
              <button
                id={`palette-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === highlight}
                className={`app-menu-item palette-option ${index === highlight ? "active" : ""}`}
                onMouseMove={() => index !== highlight && setHighlight(index)}
                onClick={() => run(entry)}
              >
                <span className="palette-option-icon">
                  {entry.kind === "command" ? entry.command.icon : <FileText size={15} />}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {entry.kind === "command" ? entry.command.label : entry.note.title}
                </span>
                {entry.kind === "command" && entry.command.shortcut ? <kbd className="kbd kbd-sm">{entry.command.shortcut}</kbd> : null}
                {entry.kind === "note" ? <span className="truncate text-xs text-base-content/50">{entry.note.category}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
