import { useEffect, useRef } from "react";

export type ShortcutId =
  | "newNote"
  | "commandPalette"
  | "quickOpen"
  | "focusSearch"
  | "toggleLeftSidebar"
  | "toggleRightSidebar"
  | "historyBack"
  | "historyForward"
  | "togglePreview"
  | "deleteNote"
  | "focusMode";

interface ShortcutDefinition {
  /** KeyboardEvent.code, so shortcuts work regardless of keyboard layout. */
  code: string;
  shift?: boolean;
  alt?: boolean;
  /** Skip while typing in inputs, rich text or code editors. */
  outsideEditable?: boolean;
  /** Skip inside code editors, where the combination already has a meaning. */
  outsideCodeEditor?: boolean;
  display: string;
}

export const SHORTCUTS: Record<ShortcutId, ShortcutDefinition> = {
  newNote: { code: "KeyN", display: "N" },
  commandPalette: { code: "KeyK", display: "K" },
  quickOpen: { code: "KeyP", display: "P" },
  focusSearch: { code: "KeyF", shift: true, display: "⇧F" },
  toggleLeftSidebar: { code: "Backslash", display: "\\" },
  toggleRightSidebar: { code: "Backslash", alt: true, display: "⌥\\" },
  historyBack: { code: "BracketLeft", outsideCodeEditor: true, display: "[" },
  historyForward: { code: "BracketRight", outsideCodeEditor: true, display: "]" },
  togglePreview: { code: "KeyE", display: "E" },
  deleteNote: { code: "Backspace", outsideEditable: true, display: "⌫" },
  focusMode: { code: "Enter", shift: true, display: "⇧↩" },
};

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return true;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad/i.test(platform);
}

export function formatShortcut(id: ShortcutId, mac = isMacPlatform()): string {
  const definition = SHORTCUTS[id];
  if (mac) return `⌘${definition.display}`;
  const parts = ["Ctrl"];
  if (definition.alt) parts.push("Alt");
  if (definition.shift) parts.push("Shift");
  const key = definition.display.replace("⇧", "").replace("⌥", "").replace("↩", "Enter").replace("⌫", "Backspace");
  parts.push(key);
  return parts.join("+");
}

/** Appends the shortcut to a tooltip, e.g. "New note (⌘N)". */
export function withShortcut(label: string, id: ShortcutId): string {
  return `${label} (${formatShortcut(id)})`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target.closest("[contenteditable='true'], .cm-editor");
}

export function matchShortcut(event: KeyboardEvent, mac = isMacPlatform()): ShortcutId | null {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  for (const [id, definition] of Object.entries(SHORTCUTS) as Array<[ShortcutId, ShortcutDefinition]>) {
    if (event.code !== definition.code) continue;
    if (!!definition.shift !== event.shiftKey || !!definition.alt !== event.altKey) continue;
    if (definition.outsideEditable && isEditableTarget(event.target)) return null;
    if (definition.outsideCodeEditor && event.target instanceof HTMLElement && event.target.closest(".cm-editor")) return null;
    return id;
  }
  return null;
}

export function useGlobalShortcuts(handlers: Partial<Record<ShortcutId, () => void>>, enabled = true) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const id = matchShortcut(event);
      if (!id) return;
      // Leave shortcuts to an open dialog, except toggling the palette itself.
      if (document.querySelector("dialog[open]") && id !== "commandPalette" && id !== "quickOpen") return;
      const handler = handlersRef.current[id];
      if (!handler) return;
      event.preventDefault();
      handler();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
