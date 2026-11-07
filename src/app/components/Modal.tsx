import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  boxClassName?: string;
  children: ReactNode;
}

/**
 * Accessible modal built on the native <dialog> element.
 * showModal() makes the rest of the page inert (focus stays inside) and maps Esc to close.
 * Focus returns to the element that opened the dialog once it closes.
 */
export function Modal({ open, onClose, label, className = "", boxClassName = "", children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") {
        try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); }
      } else {
        dialog.setAttribute("open", "");
      }
    }
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    // Fallback for environments without native dialog keyboard handling.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("keydown", handleKeyDown);
      if (dialog.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={`modal app-modal ${className}`}
      aria-label={label}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal-box ${boxClassName}`}>{children}</div>
    </dialog>
  );
}
