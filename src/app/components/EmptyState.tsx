import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: ReactNode };
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`} role="status">
      {icon ? <div className="empty-state-icon" aria-hidden="true">{icon}</div> : null}
      <p className="empty-state-title">{title}</p>
      {description ? <p className="empty-state-description">{description}</p> : null}
      {action ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={action.onClick}>
          {action.icon}
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

/** Placeholder blocks shaped like the content that is loading. */
export function Skeleton({ variant, label }: { variant: "editor" | "board" | "calendar" | "panel"; label: string }) {
  const lines = variant === "editor" ? [60, 92, 86, 74, 90, 40] : [100, 100, 100];
  return (
    <div className={`skeleton-view skeleton-${variant}`} role="status" aria-busy="true" aria-label={label}>
      {variant === "editor" ? (
        <>
          <div className="skeleton-block h-8 w-1/2" />
          <div className="flex gap-2">
            <div className="skeleton-block h-5 w-16" />
            <div className="skeleton-block h-5 w-20" />
            <div className="skeleton-block h-5 w-14" />
          </div>
          <div className="skeleton-block h-9 w-full" />
          {lines.map((width, index) => (
            <div key={index} className="skeleton-block h-4" style={{ width: `${width}%` }} />
          ))}
        </>
      ) : variant === "board" ? (
        <div className="grid grid-cols-3 gap-3">
          {lines.map((_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <div className="skeleton-block h-6 w-1/2" />
              <div className="skeleton-block h-16 w-full" />
              <div className="skeleton-block h-16 w-full" />
            </div>
          ))}
        </div>
      ) : variant === "calendar" ? (
        <>
          <div className="skeleton-block h-8 w-1/3" />
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }, (_, index) => (
              <div key={index} className="skeleton-block h-14" />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="skeleton-block h-6 w-1/3" />
          <div className="skeleton-block h-4 w-full" />
          <div className="skeleton-block h-4 w-5/6" />
          <div className="skeleton-block h-4 w-2/3" />
        </>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}
