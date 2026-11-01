import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal behaviour: focus moves in, Tab/Shift+Tab stay inside, Escape closes,
 * the page behind does not scroll, and focus returns to what opened it.
 */
export function useDialogA11y(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = ref.current;
    (
      root?.querySelector<HTMLElement>("input") ??
      root?.querySelector<HTMLElement>('button:not([aria-label="Close"])') ??
      root?.querySelector<HTMLElement>("button")
    )?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
    // Runs once on open: re-running would steal focus back to the first field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
