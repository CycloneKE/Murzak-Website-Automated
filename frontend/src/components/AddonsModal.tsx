
import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { X, Plus, AlertCircle, Loader2 } from "lucide-react";
import type { ServiceItem } from "../config/serviceCatalog";

type Props = {
  isOpen: boolean;
  planLabel: string;
  disabledReason?: string | null; // e.g. "Pay subscription first"
  addons: ServiceItem[];
  onClose: () => void;
  onApplySelection: (args: { chargeable: ServiceItem[] }) => Promise<void>;
};

export default function AddonsModal({
  isOpen,
  planLabel,
  disabledReason,
  addons,
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
      setErr(e?.message || "Failed to create add-on invoice.");
    } finally {
      setSubmitting(false);
    }
  };

return createPortal(
  <div className="fixed inset-0 z-[140]">
    <div className="absolute inset-0 bg-murzak-ink/50 backdrop-blur-xl" onClick={onClose} />
    <div className="relative z-10 flex min-h-full items-center justify-center p-3 sm:p-6">
      <div className="relative w-full max-w-6xl md:max-w-7xl max-h-[95vh] sm:max-h-[90vh] bg-white/95 backdrop-blur-xl rounded-2xl sm:rounded-[2.5rem] overflow-hidden border border-murzak-border flex flex-col min-h-0 shadow-2xl">
        {/* header */}
        <div className="px-4 sm:px-8 py-3 sm:pt-5 sm:pb-5 border-b border-murzak-accent/20 bg-murzak-ink text-white flex items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-murzak-accent/90">
              Add-ons for {planLabel}
            </p>
            <h3 className="text-base sm:text-2xl font-black tracking-tighter text-white mt-0.5 sm:mt-1 leading-tight">
              Purchase extra services
            </h3>
            <p className="hidden sm:block text-[10px] font-bold text-white/80 mt-2 max-w-2xl">
              Add-ons are charged separately and will appear as an Add-on invoice in Billing.
            </p>
            <p className="sm:hidden text-[9px] font-bold text-white/75 mt-1 leading-snug">
              Charged separately • shows in Billing
            </p>
          </div>

          <button
            onClick={onClose}
            className="shrink-0 rounded-xl p-2 sm:p-3 border border-white/15 text-white/80 hover:text-murzak-accent hover:border-murzak-accent transition-all bg-black/5 hover:bg-black/5"
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
      <div className="text-center py-16 rounded-[2rem] border border-dashed border-slate-200 dark:border-murzak-border bg-slate-50/50 dark:bg-black/5">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
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
              className={`text-left rounded-[1.75rem] p-5 border transition-all ${
                on
                  ? "border-murzak-accent bg-murzak-accent/10 shadow-[0_0_0_3px_rgba(34,211,238,0.12)]"
                  : "border-murzak-accent/25 bg-white/60 dark:bg-black/5 hover:border-murzak-accent/60"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                    {a.category} • {a.tier}
                  </p>
                  <p className="text-sm sm:text-base font-black text-murzak-ink mt-2">
                    {a.name}
                  </p>
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-500 mt-2 line-clamp-2">
                    {a.description}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                    Monthly
                  </p>
                  <p className="text-lg font-black text-murzak-ink">
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
      <div className="mt-6 p-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-500 flex items-start gap-3">
        <AlertCircle className="w-4 h-4 mt-0.5" />
        <div className="text-[10px] font-black uppercase tracking-widest">
          {err}
        </div>
      </div>
    )}
  </div>

  {/* RIGHT: desktop sticky summary */}
  <div className="hidden sm:block sm:w-[32%] border-l border-slate-200 dark:border-murzak-border p-5 sm:p-6">
    <div className="sticky top-4 space-y-4">
      {/* Selected list */}
      <div className="rounded-[2rem] border border-slate-200 dark:border-murzak-border bg-white/60 dark:bg-black/5 p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-500">
          Selected
        </p>

        {selectedDisplay.length === 0 ? (
          <p className="mt-4 text-[10px] font-bold text-slate-500 dark:text-slate-500">
            Pick add-ons to continue.
          </p>
        ) : (
          <div className="mt-4 space-y-3 max-h-[36vh] overflow-y-auto pr-1">
            {selectedDisplay.map((row, idx) => (
              <div
                key={row.id}
                className="rounded-2xl border border-slate-200 dark:border-murzak-border bg-white/70 dark:bg-black/10 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                      #{idx + 1} • {row.tier}
                    </p>
                    <p className="text-sm font-black text-murzak-ink mt-1 truncate">
                      {row.name}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-black text-murzak-accent">
                      KES {Number(row.price || 0).toLocaleString()}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeSelected(row.id)}
                      className="mt-2 rounded-xl p-2 border border-slate-200 dark:border-murzak-border bg-white/70 dark:bg-black/5 hover:border-red-500/40 hover:bg-red-500/10 transition-all"
                      aria-label={`Remove ${row.name}`}
                      title="Remove"
                    >
                      <X className="w-4 h-4 text-slate-500" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Total + CTA */}
      <div className="rounded-[2rem] border border-slate-200 dark:border-murzak-border bg-white/60 dark:bg-black/5 p-5">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
          Total monthly
        </p>
        <p className="text-2xl font-black text-murzak-accent mt-2">
          KES {total.toLocaleString()}
        </p>
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mt-2">
          Selected: {selectedList.length}
        </p>

        {disabledReason && (
          <div className="mt-4 p-3 rounded-xl border border-orange-500/20 bg-orange-500/10 text-orange-600 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-[10px] font-bold leading-relaxed">{disabledReason}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting || !!disabledReason || addons.length === 0}
          className={`mt-5 w-full px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
            submitting || !!disabledReason || addons.length === 0
              ? "bg-slate-100 dark:bg-black/5 text-slate-500 cursor-not-allowed"
              : "bg-murzak-accent text-murzak-ink hover:scale-[1.02]"
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
<div className="sm:hidden p-4 border-t border-slate-200 dark:border-murzak-border bg-white/95">
  <div className="flex items-center justify-between gap-3">
    <div>
      <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
        Total monthly
      </p>
      <p className="text-lg font-black text-murzak-accent">
        KES {total.toLocaleString()}
      </p>
      <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
        Selected: {selectedList.length}
      </p>
    </div>

    <button
      type="button"
      onClick={handleCreate}
      disabled={submitting || !!disabledReason || addons.length === 0}
      className={`px-4 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
        submitting || !!disabledReason || addons.length === 0
          ? "bg-slate-100 dark:bg-black/5 text-slate-500 cursor-not-allowed"
          : "bg-murzak-accent text-murzak-ink"
      }`}
    >
      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
      {submitting ? "..." : "Invoice"}
    </button>
  </div>

  {disabledReason && (
    <div className="mt-3 p-3 rounded-xl border border-orange-500/20 bg-orange-500/10 text-orange-600 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <p className="text-[10px] font-bold leading-relaxed">{disabledReason}</p>
    </div>
  )}

  {/* Mobile selected list (small) */}
  {selectedDisplay.length > 0 && (
    <div className="mt-3 max-h-[22vh] overflow-y-auto space-y-2 pr-1">
      {selectedDisplay.map((row) => (
        <div
          key={row.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-murzak-border bg-white/70 dark:bg-black/5 p-3"
        >
          <div className="min-w-0">
            <p className="text-[9px] font-black truncate text-murzak-ink">
              {row.name}
            </p>
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
              KES {Number(row.price || 0).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => removeSelected(row.id)}
            className="rounded-lg p-2 border border-slate-200 dark:border-murzak-border bg-white/70 dark:bg-black/5"
            aria-label={`Remove ${row.name}`}
            title="Remove"
          >
            <X className="w-4 h-4 text-slate-500" />
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
