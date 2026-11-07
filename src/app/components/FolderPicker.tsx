import { useMemo, useState } from "react";
import { Folder, FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

export interface FolderPickerRequest {
  title: string;
  current: string;
  resolve: (folder: string | null) => void;
}

interface FolderPickerProps {
  request: FolderPickerRequest | null;
  folders: Array<{ name: string; count: number }>;
  onDone: () => void;
}

export function normalizeFolder(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export function FolderPicker({ request, folders, onDone }: FolderPickerProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [highlight, setHighlight] = useState(0);

  const close = (value: string | null) => {
    request?.resolve(value);
    setFilter("");
    setHighlight(0);
    onDone();
  };

  const normalizedFilter = normalizeFolder(filter);
  const options = useMemo(() => {
    const term = normalizedFilter.toLowerCase();
    const matches = folders.filter((folder) => !term || folder.name.toLowerCase().includes(term));
    const exact = folders.some((folder) => folder.name === normalizedFilter);
    return { matches, canCreate: !!normalizedFilter && !exact && !normalizedFilter.startsWith(".") };
  }, [folders, normalizedFilter]);

  const total = options.matches.length + (options.canCreate ? 1 : 0);

  function choose(index: number) {
    if (index < options.matches.length) close(options.matches[index].name);
    else if (options.canCreate) close(normalizedFilter);
  }

  return (
    <Modal open={!!request} onClose={() => close(null)} label={request?.title ?? ""} boxClassName="folder-picker w-[min(460px,92vw)] max-w-none p-0">
      {request ? (
        <div className="flex flex-col">
          <div className="border-b border-base-300 p-4">
            <h3 className="m-0 mb-1 text-base font-semibold">{request.title}</h3>
            <p className="m-0 mb-3 text-xs text-base-content/60">{t("folderPicker.current", { folder: request.current || "/" })}</p>
            <input
              id="folder-picker-filter"
              className="input input-bordered input-sm w-full"
              placeholder={t("folderPicker.placeholder")}
              value={filter}
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls="folder-picker-list"
              aria-activedescendant={total ? `folder-option-${highlight}` : undefined}
              onChange={(event) => {
                setFilter(event.target.value);
                setHighlight(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlight((index) => Math.min(index + 1, Math.max(total - 1, 0)));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlight((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (total) choose(highlight);
                }
              }}
            />
          </div>
          <ul id="folder-picker-list" className="folder-picker-list m-0 max-h-[50vh] list-none overflow-y-auto p-2" role="listbox">
            {options.matches.map((folder, index) => (
              <li key={folder.name} id={`folder-option-${index}`} className="app-menu-item" role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  className={`folder-picker-option ${index === highlight ? "active" : ""}`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(index)}
                  disabled={folder.name === request.current}
                >
                  <Folder size={14} />
                  <span className="flex-1 truncate">{folder.name}</span>
                  <span className="text-xs text-base-content/50">{folder.count}</span>
                </button>
              </li>
            ))}
            {options.canCreate ? (
              <li id={`folder-option-${options.matches.length}`} className="app-menu-item" role="option" aria-selected={highlight === options.matches.length}>
                <button
                  type="button"
                  className={`folder-picker-option ${highlight === options.matches.length ? "active" : ""}`}
                  onMouseEnter={() => setHighlight(options.matches.length)}
                  onClick={() => choose(options.matches.length)}
                >
                  <FolderPlus size={14} />
                  <span className="flex-1 truncate">{t("folderPicker.create", { folder: normalizedFilter })}</span>
                </button>
              </li>
            ) : null}
            {total === 0 ? <li className="px-3 py-4 text-sm text-base-content/60">{t("folderPicker.empty")}</li> : null}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}
