import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** While true, Escape / backdrop / close button do nothing. */
  busy?: boolean;
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" } as const;

/**
 * Flat dialog. Rendered into document.body so no ancestor transform or
 * overflow can trap it (the App.tsx containing-block bug of 2026-08-04).
 */
export default function Modal({ open, onClose, title, children, footer, busy, size = "md" }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="portal fixed inset-0 z-200 flex items-end sm:items-center justify-center p-0 sm:p-4 !bg-transparent">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-p="modal"
        className={`relative w-full ${SIZES[size]} max-h-[90dvh] flex flex-col rounded-t-lg sm:rounded-lg border border-p-border bg-p-panel text-p-text shadow-2xl outline-none`}
      >
        <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-p-border">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label="Close"
            className="p-1.5 rounded-md text-p-muted hover:text-p-text hover:bg-p-panel-2 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 px-5 py-3.5 border-t border-p-border">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
