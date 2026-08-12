
import React, { useEffect, useState } from 'react';
import {
  ShieldCheck, ChevronLeft, AlertCircle, Clock3, Loader2, Info,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PaymentMethods from '../components/PaymentMethods';
import { getService, formatKes, monthlyEquivalentKes, postPurchaseCopy, GENERIC_POST_PURCHASE_COPY, isYearlyBilled } from '../config/serviceCatalog';

interface CheckoutProps {
  onSuccess: (user?: any) => void;
}

interface OrderView {
  id: string;
  status: 'Draft' | 'Paid' | 'Cancelled';
  serviceId: string;
  serviceName: string;
  tier: string;
  category: string;
  monthlyKes: number;
  setupKes: number;
  totalDueKes: number;
  reservationExpiresAt: string;
  invoiceDocName: string | null;
  config: Record<string, any>;
}

interface InvoicePricing {
  docName: string;
  chargeKes: number;
  paypalAmountUsd: number;
}

// Re-GET the order this often while it's unpaid — well inside the 30-minute
// reservation window, so the heartbeat keeps renewing it with wide margin.
const HEARTBEAT_MS = 5 * 60 * 1000;

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const Checkout: React.FC<CheckoutProps> = ({ onSuccess }) => {
  const navigate = useNavigate();
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const deepLinkServiceId = (searchParams.get('serviceId') || '').trim();

  const [order, setOrder] = useState<OrderView | null>(null);
  const [invoice, setInvoice] = useState<InvoicePricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Capacity waitlist — shown when POST /api/orders (the /checkout/new
  // deep-link) comes back 409 CAPACITY.
  const [waitlistServiceId, setWaitlistServiceId] = useState('');
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);
  const [waitlistError, setWaitlistError] = useState('');

  // Reservation countdown.
  const [now, setNow] = useState(() => Date.now());
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState('');

  // ---- /checkout/new?serviceId=<id> — create the draft order, then move to
  // /checkout/:orderId. Only runs when there's no orderId in the URL yet. ----
  useEffect(() => {
    if (orderId) return;
    if (!deepLinkServiceId) {
      setError('Missing service to check out.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ serviceId: deepLinkServiceId, source: 'deep-link' }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.status === 409 && data?.code === 'CAPACITY') {
          setWaitlistServiceId(deepLinkServiceId);
          setShowWaitlist(true);
          setLoading(false);
          return;
        }
        if (res.status === 400) {
          navigate('/cloud', { replace: true });
          return;
        }
        if (!res.ok || !data?.order) {
          throw new Error(data?.error || 'Failed to start checkout.');
        }
        navigate(`/checkout/${data.order.id}`, { replace: true });
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to start checkout.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, deepLinkServiceId]);

  // ---- /checkout/:orderId — load the order, prepare the invoice, price it. ----
  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');

        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data?.order) {
          throw new Error(data?.error || "We couldn't find that order.");
        }

        const ord: OrderView = data.order;
        setOrder(ord);

        if (ord.status === 'Paid') {
          navigate('/portal/overview', { replace: true });
          return;
        }
        if (ord.status === 'Cancelled') {
          setError('This order was cancelled.');
          setLoading(false);
          return;
        }

        const prepRes = await fetch(
          `/api/orders/${encodeURIComponent(orderId)}/prepare-payment`,
          { method: 'POST', credentials: 'include' }
        );
        const prepData = await prepRes.json().catch(() => ({}));
        if (cancelled) return;
        if (!prepRes.ok || !prepData?.invoiceDocName) {
          throw new Error(prepData?.error || 'Failed to prepare payment.');
        }

        const invRes = await fetch(
          `/api/billing/invoice/${encodeURIComponent(prepData.invoiceDocName)}`,
          { credentials: 'include' }
        );
        const invData = await invRes.json().catch(() => ({}));
        if (cancelled) return;
        if (!invRes.ok || !invData?.invoice) {
          throw new Error(invData?.error || 'Failed to load invoice.');
        }

        setInvoice({
          docName: prepData.invoiceDocName,
          chargeKes: Number(invData.invoice.chargeKes ?? invData.invoice.amount ?? 0),
          paypalAmountUsd: Number(invData.invoice.paypalAmountUsd || 0),
        });
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Something went wrong loading your order.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, navigate]);

  // ---- Heartbeat: re-GET every 5 minutes while unpaid, to keep the reservation alive. ----
  useEffect(() => {
    if (!orderId || !order || order.status !== 'Draft') return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data?.order) return;
        setOrder(data.order);
        if (data.order.status === 'Paid') {
          navigate('/portal/overview', { replace: true });
          return;
        }
        if (data.order.status === 'Cancelled') {
          // Mirror handleResume's Cancelled handling: stop polling and fall
          // back to the same "order cancelled" error state the initial-load
          // and resume paths already use, so a stale invoiceDocName never
          // stays on screen behind a live PaymentMethods form.
          setError('This order was cancelled.');
          clearInterval(interval);
        }
      } catch {
        // Transient network issue — the next heartbeat retries.
      }
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId, order?.status, navigate]);

  // ---- Countdown clock, ticking every second. ----
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const reservationMs = order ? Date.parse(order.reservationExpiresAt) - now : 0;
  const reservationExpired = !!order && order.status === 'Draft' && reservationMs <= 0;

  const handleResume = async () => {
    if (!orderId) return;
    setResuming(true);
    setResumeError('');
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.order) {
        throw new Error(data?.error || 'Failed to resume checkout.');
      }
      const ord: OrderView = data.order;
      setOrder(ord);

      if (ord.status === 'Paid') {
        navigate('/portal/overview', { replace: true });
        return;
      }
      if (ord.status === 'Cancelled') {
        setError('This order was cancelled.');
        return;
      }
      // The renewal heartbeat only extends a reservation that hasn't already
      // lapsed (see orderStore.getOrder) — if it's still expired after this
      // GET, there's no way to force a fresh hold on THIS order doc. Instead
      // of dead-ending here, reserve a brand-new order for the same
      // service/config (the same POST /api/orders the catalog deep-link
      // uses, capacity-checked the same way) and hand off to it.
      const stillExpired = Date.parse(ord.reservationExpiresAt) <= Date.now();
      if (!stillExpired) return;

      const createRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ serviceId: ord.serviceId, config: ord.config, source: 'resume' }),
      });
      const createData = await createRes.json().catch(() => ({}));

      if (createRes.status === 409 && createData?.code === 'CAPACITY') {
        setWaitlistServiceId(ord.serviceId);
        setShowWaitlist(true);
        return;
      }
      if (!createRes.ok || !createData?.order) {
        throw new Error(createData?.error || "We couldn't reserve a new spot. Please start over from the catalog.");
      }
      navigate(`/checkout/${createData.order.id}`, { replace: true });
    } catch (e: any) {
      setResumeError(e?.message || 'Failed to resume checkout.');
    } finally {
      setResuming(false);
    }
  };

  const handleJoinWaitlist = async () => {
    if (!waitlistServiceId) return;
    setWaitlistBusy(true);
    setWaitlistError('');
    try {
      const res = await fetch('/api/orders/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ serviceId: waitlistServiceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to join the waitlist.');
      setWaitlisted(true);
    } catch (e: any) {
      setWaitlistError(e?.message || 'Failed to join the waitlist.');
    } finally {
      setWaitlistBusy(false);
    }
  };

  const svcForOrder = order ? getService(order.serviceId) : undefined;
  const period = svcForOrder && isYearlyBilled(svcForOrder) ? "/yr" : "/mo";
  const afterPaymentCopy = svcForOrder ? postPurchaseCopy(svcForOrder) : GENERIC_POST_PURCHASE_COPY;

  const chrome = (children: React.ReactNode) => (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-start sm:justify-center py-10 sm:py-20 lg:py-28 px-4 sm:px-6 relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-murzak-ink">
        <img
          src="https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&w=1600&q=65"
          alt=""
          className="w-full h-full object-cover opacity-20 dark:opacity-40 grayscale"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-murzak-ink via-murzak-ink/95 to-murzak-ink/90"></div>
      </div>
      <div className="max-w-2xl w-full relative z-10">
        <button
          onClick={() => navigate('/portal')}
          className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 font-black text-label uppercase tracking-[0.2em] mb-6 hover:text-murzak-ink transition-colors"
        >
          <ChevronLeft size={16} /> Back to your portal
        </button>
        <div className="mb-6">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-murzak-ink dark:text-slate-100 mb-2 tracking-tighter leading-none">
            Check <span className="text-murzak-accent">out.</span>
          </h1>
          <p className="inline-flex items-center gap-2 text-sm font-bold text-slate-500">
            <ShieldCheck size={16} className="text-murzak-accent" />
            Payments are processed by Safaricom M-Pesa and PayPal. We never see or store your card details.
          </p>
        </div>
        {children}
      </div>
    </div>
  );

  if (loading && !showWaitlist) {
    return chrome(
      <div className="glass-card rounded-3xl p-8 flex items-center gap-3 text-slate-600 dark:text-slate-400 font-bold">
        <Loader2 size={18} className="animate-spin text-murzak-accent" />
        Setting up your checkout…
      </div>
    );
  }

  if (showWaitlist) {
    return chrome(
      <div className="glass-card rounded-3xl p-6 sm:p-8 space-y-4">
        <div className="flex items-start gap-2 text-murzak-ink dark:text-slate-100">
          <AlertCircle size={20} className="text-murzak-accent shrink-0 mt-0.5" />
          <div>
            <p className="font-black text-lg">We're at capacity right now.</p>
            <p className="text-sm font-bold text-slate-500 mt-1">
              Our shared node is fully booked at the moment. Join the waitlist and we'll email you the
              moment a slot opens.
            </p>
          </div>
        </div>
        {waitlisted ? (
          <p className="text-sm font-bold text-murzak-accent flex items-center gap-2">
            You're on the list — we'll email you the moment a slot opens.
          </p>
        ) : (
          <>
            {waitlistError && (
              <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" /> {waitlistError}
              </div>
            )}
            <button
              onClick={handleJoinWaitlist}
              disabled={waitlistBusy}
              className="w-full px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-murzak-accent text-murzak-ink flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {waitlistBusy ? <Loader2 size={16} className="animate-spin" /> : null}
              Join the waitlist
            </button>
          </>
        )}
      </div>
    );
  }

  if (error) {
    return chrome(
      <div className="glass-card rounded-3xl p-6 sm:p-8">
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
        <button
          onClick={() => navigate('/cloud')}
          className="mt-4 w-full px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest border border-murzak-border text-murzak-ink dark:text-slate-100 hover:border-murzak-accent transition-colors"
        >
          Back to the catalog
        </button>
      </div>
    );
  }

  if (!order) {
    return chrome(
      <div className="glass-card rounded-3xl p-8 flex items-center gap-3 text-slate-600 dark:text-slate-400 font-bold">
        <Loader2 size={18} className="animate-spin text-murzak-accent" />
        Loading your order…
      </div>
    );
  }

  return chrome(
    <div className="space-y-4">
      {/* Order summary */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-label font-black text-slate-600 dark:text-slate-400 uppercase tracking-widest">
              Order summary
            </p>
            <p className="text-sm font-bold text-slate-500 mt-1">
              {order.serviceName}
              {order.tier ? <span className="text-slate-500 font-semibold"> · {order.tier}</span> : null}
            </p>
            {order.config?.domain ? (
              <p className="text-base font-black text-murzak-ink dark:text-slate-100 mt-1">
                {order.config.domain}
              </p>
            ) : null}
          </div>
          <span className="text-right whitespace-nowrap">
            {period === "/yr" ? (
              <>
                <span className="block text-2xl font-black text-murzak-ink dark:text-slate-100 tracking-tighter">
                  {formatKes(monthlyEquivalentKes(order.monthlyKes))}/mo
                </span>
                <span className="block text-xs font-bold text-slate-600 dark:text-slate-400">
                  billed annually at {formatKes(order.monthlyKes)}
                </span>
              </>
            ) : (
              <span className="block text-2xl font-black text-murzak-ink dark:text-slate-100 tracking-tighter">
                {formatKes(order.monthlyKes)}{period}
              </span>
            )}
          </span>
        </div>
        <div className="mt-4 pt-4 border-t border-murzak-border space-y-1">
          <div className="flex items-center justify-between text-sm font-black text-murzak-ink dark:text-slate-100">
            <span>Due now</span>
            <span>{formatKes(order.monthlyKes)}</span>
          </div>
          {order.setupKes > 0 && (
            <p className="text-xs font-semibold text-slate-500 pt-1">
              This service also lists a one-time setup fee of {formatKes(order.setupKes)}, which is not part of
              today's charge.
            </p>
          )}
        </div>
      </div>

      {/* What happens after payment */}
      <div className="glass-card rounded-3xl p-6 flex items-start gap-3">
        <Info size={18} className="text-murzak-accent shrink-0 mt-0.5" />
        <p className="text-sm font-bold text-slate-500 leading-relaxed">{afterPaymentCopy}</p>
      </div>

      {/* Reservation timer */}
      {!reservationExpired && (
        <div className="flex items-center justify-center gap-2 text-sm font-black text-slate-600 dark:text-slate-400">
          <Clock3 size={16} className="text-murzak-accent" />
          We're holding your spot · {formatCountdown(Math.max(0, reservationMs))}
        </div>
      )}

      {reservationExpired ? (
        <div className="glass-card rounded-3xl p-6 sm:p-8 space-y-4 text-center">
          <p className="font-black text-murzak-ink dark:text-slate-100">Your reservation has expired.</p>
          <p className="text-sm font-bold text-slate-500">
            No worries — resume checkout and we'll try to hold your spot again.
          </p>
          {resumeError && (
            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold flex items-start gap-2 text-left">
              <AlertCircle size={16} className="shrink-0 mt-0.5" /> {resumeError}
            </div>
          )}
          <button
            onClick={handleResume}
            disabled={resuming}
            className="w-full px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-murzak-accent text-murzak-ink flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {resuming ? <Loader2 size={16} className="animate-spin" /> : null}
            Resume checkout
          </button>
        </div>
      ) : invoice ? (
        <PaymentMethods
          invoiceDocName={invoice.docName}
          chargeKes={invoice.chargeKes}
          amountUsd={invoice.paypalAmountUsd}
          onSuccess={onSuccess}
          successContent={<p className="text-sm font-bold text-slate-500 leading-relaxed">{afterPaymentCopy}</p>}
        />
      ) : (
        <div className="glass-card rounded-3xl p-8 flex items-center gap-3 text-slate-600 dark:text-slate-400 font-bold">
          <Loader2 size={18} className="animate-spin text-murzak-accent" />
          Preparing payment…
        </div>
      )}
    </div>
  );
};

export default Checkout;
