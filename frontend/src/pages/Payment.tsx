
import React, { useState, useEffect } from 'react';
import {
  ShieldCheck, CheckCircle2, ChevronLeft, Info, AlertCircle
} from 'lucide-react';
import { Page } from '../types';
import { useParams } from "react-router-dom";
import PaymentMethods from "../components/PaymentMethods";
import { toUserMessage } from "../services/errors";

interface PaymentProps {
  onNavigate: (page: Page) => void;
  onSuccess: (user?: any) => void;
}

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
        if (mounted) setInvoiceErr(toUserMessage(e, "Failed to load invoice."));
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

  const services = invoice?.services || [];

  const orderSummary = (
    <div className="mb-8 rounded-3xl border border-murzak-border bg-black/10 p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <p className="text-label font-black text-slate-600 dark:text-slate-400 uppercase tracking-widest">Order summary</p>
          <p className="text-sm font-bold text-slate-500 mt-1">
            Invoice {invoice?.invoiceNo || "…"}{invoice?.plan ? ` · ${invoice.plan} plan` : ""}
          </p>
        </div>
        <span className="text-2xl font-black text-murzak-ink dark:text-slate-100 tracking-tighter whitespace-nowrap">
          {loadingInvoice ? "…" : `KES ${chargeKes.toLocaleString()}`}
        </span>
      </div>
      {services.length > 0 && (
        <ul className="space-y-2 border-t border-murzak-border pt-4">
          {services.map((s) => (
            <li key={s.serviceId || s.serviceName} className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-400">
              <CheckCircle2 size={14} className="text-murzak-accent shrink-0" />
              {s.serviceName || s.serviceId}
              {s.tier ? <span className="text-slate-500 font-semibold">· {s.tier}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {isVerification && (
        <p className="mt-4 flex items-start gap-2 text-sm font-bold text-slate-500 leading-relaxed border-t border-murzak-border pt-4">
          <Info size={16} className="text-murzak-accent shrink-0 mt-0.5" />
          This is a one-time KES {chargeKes.toLocaleString()} verification charge to start your free trial.
          It confirms your payment method is real. Your trial begins the moment it goes through.
        </p>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-center py-20 lg:py-32 px-6 relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-murzak-ink">
        <img src="/images/checkout-flow-bg.webp" alt="" className="w-full h-full object-cover opacity-20 dark:opacity-15 grayscale" />
        <div className="absolute inset-0 bg-gradient-to-b from-murzak-ink via-murzak-ink/95 to-murzak-ink/90"></div>
      </div>
      <div className="max-w-4xl w-full relative z-10">
        <div className="text-center mb-12">
          <button onClick={() => onNavigate('portal')} className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 font-black text-label uppercase tracking-[0.2em] mb-12 hover:text-murzak-ink transition-colors">
            <ChevronLeft size={16} /> Back to your portal
          </button>
          <h1 className="text-5xl lg:text-7xl font-black text-murzak-ink dark:text-slate-100 mb-4 tracking-tighter leading-none">
            Pay <span className="text-murzak-accent">securely.</span>
          </h1>
          <p className="inline-flex items-center gap-2 text-sm font-bold text-slate-500">
            <ShieldCheck size={16} className="text-murzak-accent" />
            Payments are processed by Safaricom M-Pesa and PayPal. We never see or store your card details.
          </p>
        </div>
        {invoiceErr && (
          <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {invoiceErr}
          </div>
        )}
        {orderSummary}
        <PaymentMethods
          invoiceDocName={invoiceDocName || ""}
          chargeKes={chargeKes}
          amountUsd={Number(invoice?.paypalAmountUsd || 0)}
          disabled={loadingInvoice}
          onSuccess={onSuccess}
          successContent={
            <p className="text-sm font-bold text-slate-500 leading-relaxed">
              {isVerification
                ? "Your trial is starting now. Head to your portal to begin exploring."
                : "We're setting up your services. Instant services go live right away; managed setups (like Murzak ERP) are configured by our team within 24 hours. You can watch progress in your portal."}
            </p>
          }
        />
      </div>
    </div>
  );
};

export default Payment;
