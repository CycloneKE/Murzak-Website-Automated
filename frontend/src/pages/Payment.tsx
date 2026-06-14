
import React, { useState, useEffect } from 'react';
import { 
  RefreshCw, ArrowRight, ShieldCheck, CreditCard, Smartphone, 
  CheckCircle2, Building2, ChevronLeft, Lock, Info, 
  Wallet, AlertCircle
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

const Payment: React.FC<PaymentProps> = ({ onNavigate, onSuccess }) => {
  const [method, setMethod] = useState<PaymentMethod>('mpesa');
  const [step, setStep] = useState<'form' | 'processing' | 'success'>('form');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [cardData, setCardData] = useState({ number: '', expiry: '', cvc: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const { invoiceDocName } = useParams();
  const [invoice, setInvoice] = useState<any>(null);
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

  const validate = () => {
    const errs: Record<string, string> = {};
    if (method === 'mpesa') {
      const phoneRegex = /^(?:254|\+254|0)?(7|1)\d{8}$/;
      if (!phoneNumber.trim()) {
        errs.phoneNumber = 'Phone number is required';
      } else if (!phoneRegex.test(phoneNumber.replace(/\s+/g, ''))) {
        errs.phoneNumber = 'Invalid M-Pesa number (e.g. 07xx or 01xx)';
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
    { id: "mpesa", label: "M-Pesa Express", sub: "STK Push • KES", icon: <Smartphone size={24} />, color: "text-green-500" },
    { id: "card", label: "Card Payment", sub: "Visa / Mastercard • USD", icon: <CreditCard size={24} />, color: "text-slate-500" },
    { id: "paypal", label: "PayPal", sub: "Wallet • USD", icon: <Wallet size={24} />, color: "text-blue-500" },
  ];

  const renderCardForm = (title: string, subtitle: string) => (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center gap-4 p-6 bg-murzak-cyan/5 border border-murzak-cyan/20 rounded-3xl">
        <ShieldCheck size={20} className="text-murzak-cyan" />
        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest leading-relaxed">
          {subtitle}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6">
        <div className="space-y-3">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">{title} Card Number</label>
          <div className="relative">
            <CreditCard className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="text" 
              placeholder="•••• •••• •••• ••••" 
              className={`w-full bg-slate-50 dark:bg-white/5 border ${errors.cardNumber ? 'border-red-500' : 'border-slate-200 dark:border-white/10'} rounded-2xl px-16 py-5 text-lg font-bold text-murzak-navy dark:text-white focus:outline-none focus:ring-2 focus:ring-murzak-cyan`}
              value={cardData.number}
              onChange={e => { setCardData({...cardData, number: e.target.value}); if(errors.cardNumber) setErrors({...errors, cardNumber: ''}); }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Expiry</label>
            <input 
              type="text" 
              placeholder="MM / YY" 
              className={`w-full bg-slate-50 dark:bg-white/5 border ${errors.expiry ? 'border-red-500' : 'border-slate-200 dark:border-white/10'} rounded-2xl px-8 py-5 text-lg font-bold text-murzak-navy dark:text-white focus:outline-none focus:ring-2 focus:ring-murzak-cyan`}
              value={cardData.expiry}
              onChange={e => { setCardData({...cardData, expiry: e.target.value}); if(errors.expiry) setErrors({...errors, expiry: ''}); }}
            />
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">CVC</label>
            <input 
              type="password" 
              placeholder="•••" 
              className={`w-full bg-slate-50 dark:bg-white/5 border ${errors.cvc ? 'border-red-500' : 'border-slate-200 dark:border-white/10'} rounded-2xl px-8 py-5 text-lg font-bold text-murzak-navy dark:text-white focus:outline-none focus:ring-2 focus:ring-murzak-cyan`}
              value={cardData.cvc}
              onChange={e => { setCardData({...cardData, cvc: e.target.value}); if(errors.cvc) setErrors({...errors, cvc: ''}); }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-center py-20 lg:py-32 px-6 relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-murzak-navy">
        <img src="https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&w=1600&q=65" alt="Financial Infrastructure" className="w-full h-full object-cover opacity-20 dark:opacity-40 grayscale" />
        <div className="absolute inset-0 bg-gradient-to-b from-murzak-navy via-murzak-navy/95 to-murzak-navy/90 dark:from-murzak-deep"></div>
      </div>
      <div className="max-w-4xl w-full relative z-10">
        <div className="text-center mb-12">
          <button onClick={() => onNavigate('portal')} className="inline-flex items-center gap-2 text-slate-400 font-black text-[10px] uppercase tracking-[0.2em] mb-12 hover:text-white transition-colors">
            <ChevronLeft size={16} /> Return to Dashboard
          </button>
          <h1 className="text-5xl lg:text-7xl font-black text-white mb-6 tracking-tighter leading-none">
            Secure <br /><span className="text-murzak-cyan">settlement.</span>
          </h1>
        </div>
        <div className="bg-white/95 dark:bg-murzak-navy/95 backdrop-blur-3xl rounded-[4rem] border border-slate-200 dark:border-white/5 shadow-3xl overflow-hidden min-h-[500px] flex flex-col transition-all duration-500">
          {step === 'form' ? (
            <div className="flex flex-col lg:flex-row h-full">
              <div className="lg:w-1/3 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-white/5 p-8 lg:p-12 space-y-4">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6">Settlement Rail</h3>
                {methods.map((m) => (
                  <button key={m.id} onClick={() => { setMethod(m.id as PaymentMethod); setErrors({}); }} className={`w-full p-6 rounded-3xl flex items-center gap-4 transition-all border-2 text-left ${method === m.id ? 'bg-murzak-cyan/10 border-murzak-cyan' : 'bg-transparent border-transparent hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                    <div className={`${method === m.id ? 'text-murzak-cyan' : 'text-slate-400'}`}>{m.icon}</div>
                    <div>
                      <span className={`block text-xs font-black uppercase tracking-tight ${method === m.id ? 'text-murzak-navy dark:text-white' : 'text-slate-500'}`}>{m.label}</span>
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{m.sub}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex-grow p-8 lg:p-16">
                {invoiceErr && (
                  <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-widest">
                    {invoiceErr}
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    if (method === "paypal") {
                      e.preventDefault();
                      return;
                    }
                    handleProcessPayment(e);
                  }}
                  className="space-y-10"
                >
                  {method === 'mpesa' && (
                    <div className="space-y-8 animate-fade-in">
                      <div className="flex items-center gap-4 p-6 bg-green-500/5 border border-green-500/20 rounded-3xl">
                        <Info size={20} className="text-green-500" />
                        <p className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-widest leading-relaxed">Authorize settlement via STK Push.</p>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Phone Number</label>
                        <input 
                          type="tel" 
                          placeholder="e.g. 0712 345 678" 
                          className={`w-full bg-slate-50 dark:bg-white/5 border ${errors.phoneNumber ? 'border-red-500' : 'border-slate-200 dark:border-white/10'} rounded-2xl px-8 py-5 text-xl font-black text-murzak-navy dark:text-white focus:outline-none focus:ring-2 focus:ring-murzak-cyan`} 
                          value={phoneNumber} 
                          onChange={(e) => { setPhoneNumber(e.target.value); if(errors.phoneNumber) setErrors({...errors, phoneNumber: ''}); }} 
                        />
                        {errors.phoneNumber && <p className="text-[9px] text-red-500 font-bold uppercase tracking-widest mt-2 flex items-center gap-1"><AlertCircle size={10}/> {errors.phoneNumber}</p>}
                      </div>
                        <button
                          type="submit"
                          className="w-full sm:w-auto bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy px-12 py-6 rounded-2xl font-black text-[12px] uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-transform"
                        >
                          Authorize Rails <Lock size={16} />
                        </button>
                    </div>
                  )}
                  {method === "card" && (
                    <PayPalCardSection
                      invoiceDocName={invoiceDocName}
                      onSuccess={onSuccess}
                      setStep={setStep}
                      setErrors={setErrors}
                      amountKes={Number(invoice?.amount || 0)}
                      amountUsd={Number(invoice?.paypalAmountUsd || 0)}
                    />
                  )}

                  {method === "paypal" && (
                    <PayPalWalletSection
                      invoiceDocName={invoiceDocName}
                      onSuccess={onSuccess}
                      setStep={setStep}
                      setErrors={setErrors}
                      amountKes={Number(invoice?.amount || 0)}
                      amountUsd={Number(invoice?.paypalAmountUsd || 0)}
                    />
                  )}
                  <div className="pt-6 border-t border-slate-200 dark:border-white/5 flex flex-col sm:flex-row justify-between items-center gap-8">
                    <span className="text-3xl font-black text-murzak-navy dark:text-white tracking-tighter">
                      {loadingInvoice ? "Loading..." : `KES ${Number(invoice?.amount || 0).toLocaleString()}`}
                    </span>
                  </div>
                </form>
              </div>
            </div>
          ) : step === 'processing' ? (
            pollTimedOut ? (
              <div className="flex-grow flex flex-col items-center justify-center p-12 sm:p-20 text-center animate-fade-in max-w-xl mx-auto">
                <Smartphone size={48} className="text-murzak-cyan mb-6" />
                <h3 className="text-2xl sm:text-3xl font-black text-murzak-navy dark:text-white uppercase tracking-tighter mb-4">Awaiting Confirmation</h3>
                <p className="text-xs font-bold text-slate-500 leading-relaxed mb-8">
                  We sent an STK push to <span className="text-murzak-navy dark:text-white">{phoneNumber}</span> but haven't received confirmation yet.
                  If you entered your PIN, give it a moment and check again. If you didn't get a prompt, start over.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleCheckStatus}
                    disabled={checkingStatus}
                    className="bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy px-8 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50">
                    {checkingStatus ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    {checkingStatus ? "Checking..." : "I've paid — check now"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelProcessing}
                    disabled={checkingStatus}
                    className="bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 px-8 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-50">
                    Start over
                  </button>
                </div>
                {errors.payment && (
                  <p className="mt-6 text-[10px] text-red-500 font-bold uppercase tracking-widest flex items-center gap-1">
                    <AlertCircle size={12} /> {errors.payment}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex-grow flex flex-col items-center justify-center p-20 text-center animate-fade-in">
                <RefreshCw size={56} className="animate-spin text-murzak-cyan mb-8" />
                <h3 className="text-3xl font-black text-murzak-navy dark:text-white uppercase tracking-tighter mb-4">Verifying Transaction</h3>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Check your phone and enter your M-Pesa PIN...</p>
              </div>
            )
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center p-20 text-center animate-fade-in">
              <CheckCircle2 size={56} className="text-green-500 mb-8" />
              <h3 className="text-3xl font-black text-murzak-navy dark:text-white uppercase tracking-tighter mb-4">Settlement Verified</h3>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Handshake completed with financial hub.</p>
            </div>
          )}
          {errors.payment && (
            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-widest">
              {errors.payment}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Payment;
