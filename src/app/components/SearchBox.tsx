import { useState, type RefObject } from "react";
import { Clock, Search, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  clearRecentSearches,
  FILTER_TOKEN,
  joinSearchTokens,
  readRecentSearches,
  rememberSearch,
  splitSearchTokens,
} from "../../features/search/searchQuery";
import { withShortcut } from "../shortcuts";

interface SearchBoxProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClear: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function SearchBox({ query, onQueryChange, onClear, inputRef }: SearchBoxProps) {
  const { t } = useTranslation();
  const { tokens, text } = splitSearchTokens(query);
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches());
  // While typing, keep the raw text (including a trailing space) so the caret does not jump.
  const inputValue = draft ?? text;

  function update(nextTokens: string[], nextText: string) {
    onQueryChange(joinSearchTokens(nextTokens, nextText));
  }

  function handleChange(value: string) {
    const words = value.split(/\s+/);
    const endsWithSpace = /\s$/.test(value);
    const complete = endsWithSpace ? words.filter(Boolean) : words.slice(0, -1).filter(Boolean);
    const promoted = complete.filter((word) => FILTER_TOKEN.test(word));
    if (promoted.length) {
      const remaining = words.filter((word) => word && !promoted.includes(word)).join(" ");
      const nextText = endsWithSpace ? remaining : remaining;
      setDraft(nextText ? `${nextText}${endsWithSpace && nextText ? " " : ""}` : "");
      update([...tokens, ...promoted], nextText);
      return;
    }
    setDraft(value);
    update(tokens, value);
  }

  function remember() {
    if (query.trim()) setRecent(rememberSearch(query));
  }

  const showRecent = focused && !query.trim() && recent.length > 0;

  return (
    <div className="search-box relative" data-no-drag>
      <label className="input input-sm input-bordered flex w-[min(340px,28vw)] min-w-[200px] items-center gap-1.5 transition-all min-[1200px]:focus-within:w-[min(400px,32vw)]">
        <Search size={16} className="shrink-0 text-base-content/50" />
        {tokens.map((token, index) => (
          <span key={`${token}-${index}`} className="search-chip">
            {token}
            <button
              type="button"
              className="search-chip-remove"
              aria-label={t("search.removeFilter", { filter: token })}
              title={t("search.removeFilter", { filter: token })}
              onClick={() => update(tokens.filter((_, i) => i !== index), text)}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id="global-search"
          className="min-w-[60px] grow"
          aria-label={t("app.searchPlaceholder")}
          placeholder={tokens.length ? "" : withShortcut(t("app.searchPlaceholder"), "focusSearch")}
          value={inputValue}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setDraft(null);
            remember();
          }}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              remember();
            } else if (event.key === "Escape") {
              if (query) {
                event.preventDefault();
                setDraft(null);
                onClear();
              } else {
                event.currentTarget.blur();
              }
            } else if (event.key === "Backspace" && !inputValue && tokens.length) {
              event.preventDefault();
              const last = tokens[tokens.length - 1];
              setDraft(last);
              update(tokens.slice(0, -1), last);
            }
          }}
        />
        {query && (
          <button
            className="btn btn-ghost btn-xs btn-circle opacity-70 hover:opacity-100"
            type="button"
            onClick={() => {
              setDraft(null);
              onClear();
            }}
            title={t("app.clearSearch")}
            aria-label={t("app.clearSearch")}
          >
            <XCircle size={14} />
          </button>
        )}
      </label>
      {showRecent ? (
        <div className="search-recent" role="listbox" aria-label={t("search.recent")}>
          <div className="flex items-center justify-between px-2 pb-1 text-[11px] text-base-content/50">
            <span>{t("search.recent")}</span>
            <button
              type="button"
              className="hover:text-base-content"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                clearRecentSearches();
                setRecent([]);
              }}
            >
              {t("search.clearRecent")}
            </button>
          </div>
          {recent.map((item) => (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected="false"
              className="app-menu-item search-recent-item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setDraft(null);
                onQueryChange(item);
              }}
            >
              <Clock size={12} />
              <span className="truncate">{item}</span>
            </button>
          ))}
          <p className="m-0 px-2 pt-1 text-[11px] text-base-content/50">{t("search.syntaxHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
