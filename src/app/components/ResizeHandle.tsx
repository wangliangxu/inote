import { useRef, type KeyboardEvent, type PointerEvent } from "react";

interface ResizeHandleProps {
  /** Current width of the panel this handle resizes. */
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  /** "left": the panel sits left of the handle (dragging right grows it). "right": the panel sits to the right. */
  side: "left" | "right";
  onResize: (width: number) => void;
  /** Called once a drag or keyboard change settles, for persisting the width. */
  onResizeEnd?: (width: number) => void;
  label: string;
  hidden?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const KEY_STEP = 16;

export function clampWidth(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Shared column resizer. Uses pointer capture so trackpad and mouse drags keep tracking
 * outside the handle, supports arrow keys, and resets to the default width on double-click.
 */
export function ResizeHandle({
  width, min, max, defaultWidth, side, onResize, onResizeEnd, label, hidden = false, className = "", style,
}: ResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startWidth: number; last: number } | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (hidden || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: width, last: width };
    document.body.classList.add("is-resizing");
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    const next = clampWidth(drag.startWidth + (side === "left" ? delta : -delta), min, max);
    if (next !== drag.last) {
      drag.last = next;
      onResize(next);
    }
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    document.body.classList.remove("is-resizing");
    onResizeEnd?.(drag.last);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (event.key === grow) next = width + KEY_STEP;
    else if (event.key === shrink) next = width - KEY_STEP;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else if (event.key === "Enter") next = defaultWidth;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampWidth(next, min, max);
    onResize(clamped);
    onResizeEnd?.(clamped);
  }

  return (
    <div
      className={`resize-handle ${hidden ? "invisible opacity-0" : ""} ${className}`}
      style={style}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      title={label}
      tabIndex={hidden ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => {
        onResize(defaultWidth);
        onResizeEnd?.(defaultWidth);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
