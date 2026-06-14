
import React, { useEffect, useState } from "react";
import {
  PayPalScriptProvider,
  PayPalCardFieldsProvider,
  PayPalNameField,
  PayPalNumberField,
  PayPalExpiryField,
  PayPalCVVField,
  usePayPalCardFields,
} from "@paypal/react-paypal-js";
import { CreditCard, ShieldCheck } from "lucide-react";
import {
  getPayPalConfig,
  createPayPalOrder,
  capturePayPalOrder,
} from "../services/paypal";

interface PayPalCardSectionProps {
  invoiceDocName?: string;
  onSuccess: (user?: any) => void;
  setStep: (step: "form" | "processing" | "success") => void;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  amountKes?: number;
  amountUsd?: number;
}

const SubmitCardButton: React.FC<{
  setStep: (step: "form" | "processing" | "success") => void;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}> = ({ setStep, setErrors }) => {
  const { cardFieldsForm } = usePayPalCardFields();

  const handleClick = async () => {
    try {
      setErrors((prev) => ({ ...prev, payment: "" }));

      if (!cardFieldsForm) {
        throw new Error("Card fields are not available.");
      }

      const formState = await cardFieldsForm?.getState?.();
      if (formState?.isFormValid === false) {
        throw new Error("Please complete valid card details.");
      }

      setStep("processing");
      await cardFieldsForm.submit();
    } catch (e: any) {
      setErrors((prev) => ({
        ...prev,
        payment: e?.message || "Card payment failed.",
      }));
      setStep("form");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy px-12 py-6 rounded-2xl font-black text-[12px] uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-transform"
    >
      Pay by Card
    </button>
  );
};

const fieldStyle = {
  input: {
    "font-size": "18px",
    "font-weight": "700",
    color: "#0f172a",
  },
  ".invalid": {
    color: "#ef4444",
  },
};

const PayPalCardSection: React.FC<PayPalCardSectionProps> = ({
  invoiceDocName,
  onSuccess,
  setStep,
  setErrors,
  amountKes,
  amountUsd,
}) => {
  const [paypalOptions, setPaypalOptions] = useState<any>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const cfg = await getPayPalConfig();
        if (!mounted) return;

        setPaypalOptions({
          "client-id": cfg.clientId,
          currency: cfg.currency || "USD",
          intent: cfg.intent || "capture",
          components: "card-fields",
          commit: true,
        });
      } catch (e: any) {
        if (mounted) {
          setErrors((prev) => ({
            ...prev,
            payment: e?.message || "Failed to load PayPal card fields.",
          }));
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [setErrors]);

  if (!paypalOptions) {
    return <div className="py-10 text-center">Loading card fields...</div>;
  }

  return (
    <PayPalScriptProvider options={paypalOptions}>
      <PayPalCardFieldsProvider
        createOrder={async () => {
          if (!invoiceDocName) throw new Error("Missing invoice reference.");
          return await createPayPalOrder(invoiceDocName);
        }}
        onApprove={async (data: any) => {
          try {
            if (!invoiceDocName) throw new Error("Missing invoice reference.");

            const result = await capturePayPalOrder(invoiceDocName, data.orderID);

            setStep("success");
            await new Promise((resolve) => setTimeout(resolve, 1200));
            onSuccess(result.user);
          } catch (e: any) {
            setErrors((prev) => ({
              ...prev,
              payment: e?.message || "Card capture failed.",
            }));
            setStep("form");
          }
        }}
        onError={(err: any) => {
          console.error("PayPal card fields error:", err);
          setErrors((prev) => ({
            ...prev,
            payment: "Something went wrong with card payment.",
          }));
          setStep("form");
        }}
        style={fieldStyle}
      >
        <div className="space-y-8 animate-fade-in">
          <div className="flex items-center gap-4 p-6 bg-murzak-cyan/5 border border-murzak-cyan/20 rounded-3xl">
            <ShieldCheck size={20} className="text-murzak-cyan" />
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest leading-relaxed">
              Secure card payment processed by PayPal
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Invoice amount
            </div>
            <div className="mt-2 text-xl font-black text-murzak-navy dark:text-white">
              KES {Number(amountKes || 0).toLocaleString()}
            </div>
            <div className="mt-1 text-[11px] font-bold text-slate-500">
              Card charge: USD {Number(amountUsd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Name on Card
              </label>
              <div className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-6 py-5">
                <PayPalNameField />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Card Number
              </label>
              <div className="relative w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-16 py-5">
                <CreditCard className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <PayPalNumberField />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                  Expiry
                </label>
                <div className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-8 py-5">
                  <PayPalExpiryField />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                  CVC
                </label>
                <div className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-8 py-5">
                  <PayPalCVVField />
                </div>
              </div>
            </div>
          </div>

          <SubmitCardButton setStep={setStep} setErrors={setErrors} />
        </div>
      </PayPalCardFieldsProvider>
    </PayPalScriptProvider>
  );
};

export default PayPalCardSection;
