import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Note, SaveState } from "../../shared/types";
import { countWords, readingMinutes } from "../../shared/textStats";

interface StatusBarProps {
  saveState: SaveState;
  saveLabel: string;
  status: string;
  /** Keep the message visible (for example after a save error). */
  pinStatus: boolean;
  reminderError: string;
  reminderConflictCount: number;
  onOpenSettings: () => void;
  activeNote?: Note;
  noteCount: number;
  totalWords: number;
}

const STATUS_VISIBLE_MS = 6000;

export function StatusBar(props: StatusBarProps) {
  const { t } = useTranslation();
  const [visibleStatus, setVisibleStatus] = useState(props.status);

  useEffect(() => {
    setVisibleStatus(props.status);
    if (props.pinStatus || !props.status) return;
    const timer = window.setTimeout(() => setVisibleStatus(""), STATUS_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [props.status, props.pinStatus]);

  const body = props.activeNote?.bodyLoaded === false ? undefined : props.activeNote?.body;
  const stats = useMemo(() => {
    if (body === undefined) return null;
    return { words: countWords(body), minutes: readingMinutes(body) };
  }, [body]);

  const hasReminderIssue = !!props.reminderError || props.reminderConflictCount > 0;

  return (
    <footer className="status-bar" aria-label={t("status.label")}>
      <div className="status-bar-left">
        <span className={`status-pill ${props.saveState}`} role="status">{props.saveLabel}</span>
        {hasReminderIssue && (
          <button
            type="button"
            className="status-sync-error"
            title={props.reminderError || t("reminders.conflictHint")}
            onClick={props.onOpenSettings}
          >
            <AlertTriangle size={12} /> {t("reminders.syncFailed")}
          </button>
        )}
      </div>
      <div className="status-bar-message" aria-live="polite" title={visibleStatus}>
        {visibleStatus}
      </div>
      <div className="status-bar-right">
        {props.activeNote ? (
          stats ? (
            <>
              <span>{t("status.words", { count: stats.words })}</span>
              <span>{t("status.readingTime", { count: stats.minutes })}</span>
            </>
          ) : null
        ) : (
          <>
            <span>{t("status.notes", { count: props.noteCount })}</span>
            <span>{t("status.totalWords", { count: props.totalWords })}</span>
          </>
        )}
      </div>
    </footer>
  );
}
