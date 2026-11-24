
import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { X, Plus, AlertCircle, Loader2 } from "lucide-react";
import type { ServiceItem } from "../config/serviceCatalog";
import { toUserMessage } from "../services/errors";

type Props = {
  isOpen: boolean;
  planLabel: string;
  disabledReason?: string | null; // e.g. "Pay subscription first"
  addons: ServiceItem[];
  /** Optional service selected as soon as the modal opens. */
  preselectedId?: string | null;
  onClose: () => void;
  onApplySelection: (args: { chargeable: ServiceItem[] }) => Promise<void>;
};

export default function AddonsModal({
  isOpen,
  planLabel,
  disabledReason,
  addons,
  preselectedId,
  onClose,
  onApplySelection,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string>("");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]);
  const scrollYRef = useRef(0);

  const selectedList = useMemo(() => {
    const map = new Map(addons.map((a) => [a.id, a]));
    return selectedOrder.map((id) => map.get(id)).filter(Boolean) as ServiceItem[];
  }, [addons, selectedOrder]);

  // Every selected add-on is billed at its real catalog price — matching the
  // initial checkout, which never offers a free service.
  const selectedDisplay = useMemo(() => {
    return selectedList.map((s) => ({
      id: s.id,
      name: s.name,
      tier: s.tier,
      category: s.category,
      price: Number(s?.pricing?.monthlyKes || 0),
    }));
  }, [selectedList]);

  const total = useMemo(() => {
    return selectedList.reduce((sum, s) => sum + Number(s?.pricing?.monthlyKes || 0), 0);
  }, [selectedList]);

  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => {
      bodyRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }, 0);
  }, [isOpen]);

  // Applied only when the modal opens or the preselected id changes, never on a
  // later `addons` identity change (that would wipe the user's own picks).
  const addonsRef = useRef(addons);
  addonsRef.current = addons;
  useEffect(() => {
    if (!isOpen || !preselectedId) return;
    if (!addonsRef.current.some((a) => a.id === preselectedId)) return;
    setSelectedIds({ [preselectedId]: true });
    setSelectedOrder([preselectedId]);
  }, [isOpen, preselectedId]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedIds({});
      setSelectedOrder([]);
      setErr("");
      setSubmitting(false);
    }
  }, [isOpen]);

useLayoutEffect(() => {
  if (!isOpen) return;

  // capture current scroll
  const y = window.scrollY || 0;
  scrollYRef.current = y;

  // lock body (prevents background scroll, but does NOT break inner modal scrolling)
  const prev = {
    overflow: document.body.style.overflow,
    position: document.body.style.position,
    top: document.body.style.top,
    width: document.body.style.width,
  };

  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${y}px`;
  document.body.style.width = "100%";

  // optional: if you still want to disable portal scroll container, ONLY hide overflow (no touchAction)
  const scroller = document.getElementById("portal-scroll");
  const prevScrollerOverflow = scroller?.style.overflow;
  if (scroller) scroller.style.overflow = "hidden";

  // reset modal scroll to top
  requestAnimationFrame(() => {
    bodyRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });

  return () => {
    // restore portal container
    if (scroller) scroller.style.overflow = prevScrollerOverflow || "";

    // restore body
    document.body.style.overflow = prev.overflow;
    document.body.style.position = prev.position;
    document.body.style.top = prev.top;
    document.body.style.width = prev.width;

    // restore scroll position
    window.scrollTo(0, scrollYRef.current || 0);
  };
}, [isOpen]);  

  if (!isOpen) return null;  

  const toggle = (id: string) => {
    setErr("");
    setSelectedIds((prev) => {
      const next = { ...prev };
      const turningOn = !next[id];
      if (turningOn) next[id] = true;
      else delete next[id];
      return next;
    });

    setSelectedOrder((prev) => {
      const exists = prev.includes(id);
      if (exists) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  };

  const removeSelected = (id: string) => {
    setErr("");
    setSelectedIds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSelectedOrder((prev) => prev.filter((x) => x !== id));
  };

  const handleCreate = async () => {
    setErr("");
    if (disabledReason) {
      setErr(disabledReason);
      return;
    }
    if (selectedList.length === 0) {
      setErr("Select at least one add-on service.");
      return;
    }
    try {
      setSubmitting(true);
      await onApplySelection({ chargeable: selectedList });
      onClose();
      setSelectedOrder([]);
    } catch (e: any) {
      setErr(toUserMessage(e, "Failed to create add-on invoice."));
    } finally {
      setSubmitting(false);
    }
  };

return createPortal(
  <div className="fixed inset-0 z-140">
    <div className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div className="relative z-10 flex min-h-full items-center justify-center p-3 sm:p-6">
      <div className="relative w-full max-w-6xl md:max-w-7xl max-h-[95vh] sm:max-h-[90vh] bg-p-panel rounded-lg sm:rounded-lg overflow-hidden border border-p-border flex flex-col min-h-0 shadow-2xl">
        {/* header */}
        <div className="px-4 sm:px-8 py-3 sm:pt-5 sm:pb-5 border-b border-p-accent/40 bg-p-panel text-p-text flex items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <p className="text-xs sm:text-xs font-semibold text-p-accent-text">
              Add-ons for {planLabel}
            </p>
            <h3 className="text-base sm:text-2xl sm:leading-(--text-2xl--line-height) font-semibold text-p-text mt-0.5 sm:mt-1 leading-tight">
              Purchase extra services
            </h3>
            <p className="hidden sm:block text-xs font-medium text-p-muted mt-2 max-w-2xl">
              Add-ons are charged separately and will appear as an Add-on invoice in Billing.
            </p>
            <p className="sm:hidden text-xs font-medium text-p-muted mt-1 leading-snug">
              Charged separately • shows in Billing
            </p>
          </div>

          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-2 sm:p-3 border border-p-border text-p-muted hover:text-p-accent-text hover:border-p-accent transition-all bg-p-panel-2 hover:bg-p-panel-2"
            aria-label="Close"
          >
            <X size={18} className="sm:hidden" />
            <X size={20} className="hidden sm:block" />
          </button>
        </div>

{/* body + summary layout */}
<div className="flex-1 min-h-0 flex flex-col sm:flex-row">
  {/* LEFT: scrollable services list */}
  <div
    ref={bodyRef}
    className="p-5 pb-24 sm:pb-6 sm:p-6 sm:w-[68%] flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y"
    style={{ WebkitOverflowScrolling: "touch" }}
  >
    {addons.length === 0 ? (
      <div className="text-center py-16 rounded-lg border border-dashed border-p-border bg-p-panel-2 ">
        <p className="text-xs font-semibold text-p-muted ">
          No add-ons available for this plan tier yet.
        </p>
      </div>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {addons.map((a) => {
          const on = !!selectedIds[a.id];
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(a.id)}
              aria-pressed={on}
              className={`text-left rounded-lg p-5 border transition-all ${
                on
                  ? "border-p-accent bg-p-accent-soft"
                  : "border-p-accent/40 bg-p-panel hover:border-p-accent"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-p-muted ">
                    {a.category} • {a.tier}
                  </p>
                  <p className="text-sm sm:text-base font-semibold text-p-text mt-2">
                    {a.name}
                  </p>
                  <p className="text-xs font-medium text-p-muted mt-2 line-clamp-2">
                    {a.description}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-xs font-semibold text-p-muted ">
                    Monthly
                  </p>
                  <p className="text-lg font-semibold text-p-text ">
                    KES {Number(a?.pricing?.monthlyKes || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    )}

    {err && (
      <div className="mt-6 p-4 rounded-lg border border-p-danger/40 bg-p-danger-soft text-p-danger flex items-start gap-3">
        <AlertCircle className="w-4 h-4 mt-0.5" />
        <div className="text-xs font-semibold ">
          {err}
        </div>
      </div>
    )}
  </div>

  {/* RIGHT: desktop sticky summary */}
  <div className="hidden sm:block sm:w-[32%] border-l border-p-border p-5 sm:p-6">
    <div className="sticky top-4 space-y-4">
      {/* Selected list */}
      <div className="rounded-lg border border-p-border bg-p-panel p-5">
        <p className="text-xs font-semibold text-p-muted ">
          Selected
        </p>

        {selectedDisplay.length === 0 ? (
          <p className="mt-4 text-xs font-medium text-p-muted ">
            Pick add-ons to continue.
          </p>
        ) : (
          <div className="mt-4 space-y-3 max-h-[36vh] overflow-y-auto pr-1">
            {selectedDisplay.map((row, idx) => (
              <div
                key={row.id}
                className="rounded-lg border border-p-border bg-p-panel p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-p-muted ">
                      #{idx + 1} • {row.tier}
                    </p>
                    <p className="text-sm font-semibold text-p-text mt-1 truncate">
                      {row.name}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-p-accent-text">
                      KES {Number(row.price || 0).toLocaleString()}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeSelected(row.id)}
                      className="mt-2 rounded-md p-2 border border-p-border bg-p-panel hover:border-p-danger/40 hover:bg-p-danger-soft transition-all"
                      aria-label={`Remove ${row.name}`}
                      title="Remove"
                    >
                      <X className="w-4 h-4 text-p-muted" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Total + CTA */}
      <div className="rounded-lg border border-p-border bg-p-panel p-5">
        <p className="text-xs font-semibold text-p-muted ">
          Total monthly
        </p>
        <p className="text-2xl font-semibold text-p-accent-text mt-2">
          KES {total.toLocaleString()}
        </p>
        <p className="text-xs font-semibold text-p-muted mt-2">
          Selected: {selectedList.length}
        </p>

        {disabledReason && (
          <div className="mt-4 p-3 rounded-md border border-p-warning/40 bg-p-warning-soft text-p-warning flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-xs font-medium leading-relaxed">{disabledReason}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting || !!disabledReason || addons.length === 0}
          className={`mt-5 w-full px-5 py-3 rounded-lg font-semibold text-xs transition-all flex items-center justify-center gap-2 ${
            submitting || !!disabledReason || addons.length === 0
              ? "bg-p-panel-2 text-p-muted cursor-not-allowed"
              : "bg-p-accent text-p-accent-fg "
          }`}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Creating…
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" /> Create Add-on Invoice
            </>
          )}
        </button>
      </div>
    </div>
  </div>
</div>

{/* MOBILE: compact fixed footer */}
<div className="sm:hidden p-4 border-t border-p-border bg-p-panel ">
  <div className="flex items-center justify-between gap-3">
    <div>
      <p className="text-xs font-semibold text-p-muted ">
        Total monthly
      </p>
      <p className="text-lg font-semibold text-p-accent-text">
        KES {total.toLocaleString()}
      </p>
      <p className="text-xs font-semibold text-p-muted ">
        Selected: {selectedList.length}
      </p>
    </div>

    <button
      type="button"
      onClick={handleCreate}
      disabled={submitting || !!disabledReason || addons.length === 0}
      className={`px-4 py-3 rounded-lg font-semibold text-xs transition-all flex items-center justify-center gap-2 ${
        submitting || !!disabledReason || addons.length === 0
          ? "bg-p-panel-2 text-p-muted cursor-not-allowed"
          : "bg-p-accent text-p-accent-fg"
      }`}
    >
      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
      {submitting ? "..." : "Invoice"}
    </button>
  </div>

  {disabledReason && (
    <div className="mt-3 p-3 rounded-md border border-p-warning/40 bg-p-warning-soft text-p-warning flex items-start gap-2">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <p className="text-xs font-medium leading-relaxed">{disabledReason}</p>
    </div>
  )}

  {/* Mobile selected list (small) */}
  {selectedDisplay.length > 0 && (
    <div className="mt-3 max-h-[22vh] overflow-y-auto space-y-2 pr-1">
      {selectedDisplay.map((row) => (
        <div
          key={row.id}
          className="flex items-center justify-between gap-3 rounded-md border border-p-border bg-p-panel p-3"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate text-p-text ">
              {row.name}
            </p>
            <p className="text-xs font-semibold text-p-muted ">
              KES {Number(row.price || 0).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => removeSelected(row.id)}
            className="rounded-lg p-2 border border-p-border bg-p-panel "
            aria-label={`Remove ${row.name}`}
            title="Remove"
          >
            <X className="w-4 h-4 text-p-muted" />
          </button>
        </div>
      ))}
    </div>
  )}
</div>

      </div>
    </div>
    </div>,
  document.body
  );
}
