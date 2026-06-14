
import React, { useEffect, useState } from "react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { Wallet } from "lucide-react";
import { getPayPalConfig, createPayPalOrder, capturePayPalOrder } from "../services/paypal";

interface PayPalWalletSectionProps {
  invoiceDocName?: string;
  onSuccess: (user?: any) => void;
  setStep: (step: "form" | "processing" | "success") => void;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  amountKes?: number;
  amountUsd?: number;
}

const PayPalWalletSection: React.FC<PayPalWalletSectionProps> = ({
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
          components: "buttons",
          commit: true,
        });
      } catch (e: any) {
        if (mounted) {
          setErrors((prev) => ({
            ...prev,
            payment: e?.message || "Failed to load PayPal.",
          }));
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [setErrors]);

  if (!paypalOptions) {
    return <div className="py-10 text-center">Loading PayPal...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col items-center justify-center py-10 bg-slate-50 dark:bg-white/5 rounded-[3rem] border border-dashed border-slate-200 dark:border-white/10 text-center">
        <Wallet size={48} className="text-blue-500 mb-4 opacity-50" />
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">
          Complete payment using your PayPal account
        </p>
        <p className="text-[11px] font-bold text-slate-500 mb-6">
          Invoice: KES {Number(amountKes || 0).toLocaleString()} • PayPal charge: USD{" "}
          {Number(amountUsd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>

        <div className="w-full max-w-md px-6">
          <PayPalScriptProvider options={paypalOptions}>
            <PayPalButtons
              style={{ layout: "vertical", shape: "rect", label: "paypal" }}
              createOrder={async () => {
                if (!invoiceDocName) throw new Error("Missing invoice reference.");
                setErrors((prev) => ({ ...prev, payment: "" }));
                return await createPayPalOrder(invoiceDocName);
              }}
              onApprove={async (data) => {
                try {
                  if (!invoiceDocName) throw new Error("Missing invoice reference.");

                  setStep("processing");
                  const result = await capturePayPalOrder(invoiceDocName, data.orderID);
                  setStep("success");
                  await new Promise((resolve) => setTimeout(resolve, 1200));
                  onSuccess(result.user);
                } catch (e: any) {
                  setErrors((prev) => ({
                    ...prev,
                    payment: e?.message || "PayPal capture failed.",
                  }));
                  setStep("form");
                }
              }}
              onCancel={() => {
                setErrors((prev) => ({
                  ...prev,
                  payment: "PayPal payment was cancelled.",
                }));
              }}
              onError={(err) => {
                console.error("PayPal UI error:", err);
                setErrors((prev) => ({
                  ...prev,
                  payment: "Something went wrong with PayPal checkout.",
                }));
              }}
            />
          </PayPalScriptProvider>
        </div>
      </div>
    </div>
  );
};

export default PayPalWalletSection;
