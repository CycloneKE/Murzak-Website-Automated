
import React, { useState, useEffect } from 'react';
import {
  RefreshCw, ShieldCheck, CreditCard, Smartphone,
  CheckCircle2, ChevronLeft, Lock, Info,
  Wallet, AlertCircle, Receipt
} from 'lucide-react';
import { Page } from '../types';
import { useParams } from "react-router-dom";
import PayPalWalletSection from "../components/PayPalWalletSection";
import PayPalCardSection from "../components/PayPalCardSection";

interface PaymentProps {
  onNavigate: (page: Page) => void;
  onSuccess: (user?: any) => void;
}

type PaymentMethod = 'mpesa' | 'card' | 'paypal';

interface InvoiceView {
  docName: string;
  invoiceNo: string;
  amount: number;
  chargeKes?: number;
  verificationOnly?: boolean;
  paypalAmountUsd?: number;
  status: string;
  type?: string;
  plan?: string;
  date?: string;
  services?: { serviceId: string; serviceName: string; tier?: string; status?: string }[];
}

const Payment: React.FC<PaymentProps> = ({ onNavigate, onSuccess }) => {
  const [method, setMethod] = useState<PaymentMethod>('mpesa');
  const [step, setStep] = useState<'form' | 'processing' | 'success'>('form');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [mpesaReceipt, setMpesaReceipt] = useState<string | null>(null);
  const { invoiceDocName } = useParams();
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(true);
  const [invoiceErr, setInvoiceErr] = useState("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoadingInvoice(true);
        setInvoiceErr("");

        if (!invoiceDocName) throw new Error("Missing invoice reference.");

        const res = await fetch(`/api/billing/invoice/${encodeURIComponent(invoiceDocName || "")}`, {
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to load invoice.");

        if (mounted) setInvoice(data.invoice);
      } catch (e: any) {
        if (mounted) setInvoiceErr(e?.message || "Failed to load invoice.");
      } finally {
        if (mounted) setLoadingInvoice(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [invoiceDocName]);

  // What the customer is actually charged: real invoices bill their amount;
  // free-trial verification invoices bill the small verification charge.
  const chargeKes = Number(invoice?.chargeKes ?? invoice?.amount ?? 0);
  const isVerification = !!invoice?.verificationOnly;

  const validate = () => {
    const errs: Record<string, string> = {};
    if (method === 'mpesa') {
      const phoneRegex = /^(?:254|\+254|0)?(7|1)\d{8}$/;
      if (!phoneNumber.trim()) {
        errs.phoneNumber = 'Phone number is required';
      } else if (!phoneRegex.test(phoneNumber.replace(/\s+/g, ''))) {
        errs.phoneNumber = 'That doesn\'t look like an M-Pesa number (e.g. 0712 345 678)';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // One status check. Returns true if the invoice is now paid.
  const checkPaidOnce = async (): Promise<boolean> => {
    const statusRes = await fetch(
      `/api/billing/mpesa/status/${encodeURIComponent(invoiceDocName || "")}`,
      { credentials: "include" }
    );
    const statusData = await statusRes.json().catch(() => ({}));
    if (statusData?.receipt) setMpesaReceipt(String(statusData.receipt));
    return !!statusData?.paid;
  };

  // Mark success + activate services once payment is confirmed.
  const finalizePaid = async () => {
    setStep("success");
    await new Promise((r) => setTimeout(r, 1200));

    const activateRes = await fetch("/api/billing/activate-services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ invoiceDocName }),
    });
    const activateData = await activateRes.json().catch(() => ({}));
    if (!activateRes.ok) throw new Error(activateData?.error || "Failed to activate services.");

    onSuccess(activateData.user);
  };

  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsProcessing(true);
    setPollTimedOut(false);
    setErrors((prev) => ({ ...prev, payment: "" }));
    setStep('processing');

    try {
      // 1) Initiate real M-Pesa STK Push
      const pushRes = await fetch("/api/billing/mpesa/stk-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phoneNumber, invoiceDocName }),
      });

      const pushData = await pushRes.json().catch(() => ({}));
      if (!pushRes.ok) {
        throw new Error(pushData?.error || "Failed to initiate M-Pesa payment.");
      }

      // 2) Poll for payment confirmation (max ~120 s, every 3 s)
      const MAX_POLLS  = 40;
      const POLL_MS    = 3000;
      let paid         = false;

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (await checkPaidOnce()) { paid = true; break; }
      }

      if (!paid) {
        // Don't discard the in-flight payment — let the user confirm manually.
        setPollTimedOut(true);
        return;
      }

      await finalizePaid();
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, payment: e?.message || "Payment failed." }));
      setStep("form");
    } finally {
      setIsProcessing(false);
    }
  };

  // Manual "I've paid — check now" used after a polling timeout.
  const handleCheckStatus = async () => {
    setCheckingStatus(true);
    setErrors((prev) => ({ ...prev, payment: "" }));
    try {
      if (await checkPaidOnce()) {
        setPollTimedOut(false);
        await finalizePaid();
      } else {
        setErrors((prev) => ({
          ...prev,
          payment: "We haven't received this payment yet. If you completed it, wait a moment and check again.",
        }));
      }
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, payment: e?.message || "Could not check status." }));
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleCancelProcessing = () => {
    setPollTimedOut(false);
    setStep("form");
  };

  const methods = [
    { id: "mpesa", label: "M-Pesa", sub: "Pay from your phone • KES", icon: <Smartphone size={24} />, color: "text-green-500" },
    { id: "card", label: "Card", sub: "Visa / Mastercard • USD", icon: <CreditCard size={24} />, color: "text-slate-500" },
    { id: "paypal", label: "PayPal", sub: "PayPal balance • USD", icon: <Wallet size={24} />, color: "text-blue-500" },
  ];

  const services = invoice?.services || [];

  const orderSummary = (
    <div className="mb-8 rounded-3xl border border-white/10 bg-black/10 p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Order summary</p>
          <p className="text-sm font-bold text-slate-400 mt-1">
            Invoice {invoice?.invoiceNo || "…"}{invoice?.plan ? ` · ${invoice.plan} plan` : ""}
          </p>
        </div>
        <span className="text-2xl font-black text-murzak-navy dark:text-white tracking-tighter whitespace-nowrap">
          {loadingInvoice ? "…" : `KES ${chargeKes.toLocaleString()}`}
        </span>
      </div>
      {services.length > 0 && (
        <ul className="space-y-2 border-t border-white/10 pt-4">
          {services.map((s) => (
            <li key={s.serviceId || s.serviceName} className="flex items-center gap-2 text-sm font-bold text-slate-300">
              <CheckCircle2 size={14} className="text-murzak-cyan shrink-0" />
              {s.serviceName || s.serviceId}
              {s.tier ? <span className="text-slate-500 font-semibold">· {s.tier}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {isVerification && (
        <p className="mt-4 flex items-start gap-2 text-sm font-bold text-slate-400 leading-relaxed border-t border-white/10 pt-4">
          <Info size={16} className="text-murzak-cyan shrink-0 mt-0.5" />
          This is a one-time KES {chargeKes.toLocaleString()} verification charge to start your free trial —
          it confirms your payment method is real. Your trial begins the moment it goes through.
        </p>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-center py-20 lg:py-32 px-6 relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-murzak-navy">
        <img src="https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&w=1600&q=65" alt="" className="w-full h-full object-cover opacity-20 dark:opacity-40 grayscale" />
        <div className="absolute inset-0 bg-gradient-to-b from-murzak-navy via-murzak-navy/95 to-murzak-navy/90 dark:from-murzak-deep"></div>
      </div>
      <div className="max-w-4xl w-full relative z-10">
        <div className="text-center mb-12">
          <button onClick={() => onNavigate('portal')} className="inline-flex items-center gap-2 text-slate-400 font-black text-[11px] uppercase tracking-[0.2em] mb-12 hover:text-white transition-colors">
            <ChevronLeft size={16} /> Back to your portal
          </button>
          <h1 className="text-5xl lg:text-7xl font-black text-white mb-4 tracking-tighter leading-none">
            Pay <span className="text-murzak-cyan">securely.</span>
          </h1>
          <p className="inline-flex items-center gap-2 text-sm font-bold text-slate-400">
            <ShieldCheck size={16} className="text-murzak-cyan" />
            Payments are processed by Safaricom M-Pesa and PayPal. We never see or store your card details.
          </p>
        </div>
        <div className="glass-card shadow-2xl overflow-hidden min-h-[500px] flex flex-col transition-all duration-500 border border-white/10">
          {step === 'form' ? (
            <div className="flex flex-col lg:flex-row h-full">
              <div className="lg:w-1/3 border-b lg:border-b-0 lg:border-r border-white/10 p-8 lg:p-12 space-y-4 bg-black/10">
                <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-6">Payment method</h3>
                {methods.map((m) => (
                  <button key={m.id} onClick={() => { setMethod(m.id as PaymentMethod); setErrors({}); }} className={`w-full p-6 rounded-3xl flex items-center gap-4 transition-all border-2 text-left ${method === m.id ? 'glass-card border-murzak-cyan shadow-[0_0_15px_rgba(46,166,255,0.2)]' : 'bg-transparent border-transparent hover:bg-white/5'}`}>
                    <div className={`${method === m.id ? 'text-murzak-cyan' : 'text-slate-400'}`}>{m.icon}</div>
                    <div>
                      <span className={`block text-sm font-black tracking-tight ${method === m.id ? 'text-murzak-navy dark:text-white' : 'text-slate-500'}`}>{m.label}</span>
                      <span className="text-[11px] font-bold text-slate-400">{m.sub}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex-grow p-8 lg:p-14">
                {invoiceErr && (
                  <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold flex items-start gap-2">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" /> {invoiceErr}
                  </div>
                )}
                {orderSummary}
                <form
                  onSubmit={(e) => {
                    if (method === "paypal") {
                      e.preventDefault();
                      return;
                    }
                    handleProcessPayment(e);
                  }}
                  className="space-y-8"
                >
                  {method === 'mpesa' && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="flex items-center gap-3 p-5 bg-green-500/5 border border-green-500/20 rounded-3xl">
                        <Info size={18} className="text-green-500 shrink-0" />
                        <p className="text-sm font-bold text-green-600 dark:text-green-400 leading-relaxed">
                          We'll send a payment request to your phone. Enter your M-Pesa PIN to approve it.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest ml-1">M-Pesa phone number</label>
                        <input
                          type="tel"
                          placeholder="e.g. 0712 345 678"
                          className={`w-full glass-input rounded-2xl px-8 py-5 text-xl font-black text-white focus:outline-none focus:ring-2 focus:ring-murzak-cyan ${errors.phoneNumber ? 'border-red-500 ring-1 ring-red-500/50' : ''}`}
                          value={phoneNumber}
                          onChange={(e) => { setPhoneNumber(e.target.value); if(errors.phoneNumber) setErrors({...errors, phoneNumber: ''}); }}
                        />
                        {errors.phoneNumber && <p className="text-sm text-red-400 font-bold mt-2 flex items-center gap-1.5"><AlertCircle size={14}/> {errors.phoneNumber}</p>}
                      </div>
                        <button
                          type="submit"
                          disabled={isProcessing || loadingInvoice}
                          className="w-full sm:w-auto bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy px-12 py-6 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                        >
                          {isProcessing ? <>Sending…</> : <>Pay KES {chargeKes.toLocaleString()} <Lock size={16} /></>}
                        </button>
                    </div>
                  )}
                  {method === "card" && (
                    <PayPalCardSection
                      invoiceDocName={invoiceDocName}
                      onSuccess={onSuccess}
                      setStep={setStep}
                      setErrors={setErrors}
                      amountKes={chargeKes}
                      amountUsd={Number(invoice?.paypalAmountUsd || 0)}
                    />
                  )}

                  {method === "paypal" && (
                    <PayPalWalletSection
                      invoiceDocName={invoiceDocName}
                      onSuccess={onSuccess}
                      setStep={setStep}
                      setErrors={setErrors}
                      amountKes={chargeKes}
                      amountUsd={Number(invoice?.paypalAmountUsd || 0)}
                    />
                  )}
                </form>
              </div>
            </div>
          ) : step === 'processing' ? (
            pollTimedOut ? (
              <div className="flex-grow flex flex-col items-center justify-center p-12 sm:p-20 text-center animate-fade-in max-w-xl mx-auto">
                <Smartphone size={48} className="text-murzak-cyan mb-6" />
                <h3 className="text-2xl sm:text-3xl font-black text-murzak-navy dark:text-white tracking-tighter mb-4">Waiting for your payment</h3>
                <p className="text-sm font-bold text-slate-400 leading-relaxed mb-8">
                  We sent a payment request to <span className="text-murzak-navy dark:text-white">{phoneNumber}</span> but haven't received confirmation yet.
                  If you entered your PIN, give it a moment and check again. If no prompt arrived, start over.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleCheckStatus}
                    disabled={checkingStatus}
                    className="bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50">
                    {checkingStatus ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    {checkingStatus ? "Checking..." : "I've paid — check now"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelProcessing}
                    disabled={checkingStatus}
                    className="bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50">
                    Start over
                  </button>
                </div>
                {errors.payment && (
                  <p className="mt-6 text-sm text-red-400 font-bold flex items-center gap-1.5">
                    <AlertCircle size={14} /> {errors.payment}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex-grow flex flex-col items-center justify-center p-20 text-center animate-fade-in">
                <RefreshCw size={56} className="animate-spin text-murzak-cyan mb-8" />
                <h3 className="text-3xl font-black text-murzak-navy dark:text-white tracking-tighter mb-4">Check your phone</h3>
                <p className="text-sm font-bold text-slate-400">Enter your M-Pesa PIN to approve the payment of KES {chargeKes.toLocaleString()}.</p>
              </div>
            )
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center p-12 sm:p-20 text-center animate-fade-in max-w-xl mx-auto">
              <CheckCircle2 size={56} className="text-green-500 mb-8" />
              <h3 className="text-3xl font-black text-murzak-navy dark:text-white tracking-tighter mb-4">Payment received</h3>
              {mpesaReceipt && (
                <p className="inline-flex items-center gap-2 text-sm font-bold text-slate-300 bg-white/5 border border-white/10 rounded-2xl px-5 py-3 mb-6">
                  <Receipt size={16} className="text-murzak-cyan" /> M-Pesa confirmation: <span className="font-black text-white">{mpesaReceipt}</span>
                </p>
              )}
              <p className="text-sm font-bold text-slate-400 leading-relaxed">
                {isVerification
                  ? "Your trial is starting now — head to your portal to begin exploring."
                  : "We're setting up your services. Instant services go live right away; managed setups (like ERPNext) are configured by our team within 24 hours — you can watch progress in your portal."}
              </p>
            </div>
          )}
          {step === 'form' && errors.payment && (
            <div className="mx-8 mb-8 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" /> {errors.payment}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Payment;
