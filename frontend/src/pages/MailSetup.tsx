import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import MailSetupForm, { MAIL_PLAN_IDS } from "../components/mail/MailSetupForm";
import { createMailOrder } from "../services/mail";
import type { MailPlanId } from "../types";

interface Props {
  user: any | null;
  onUserUpdate: (user: any) => void;
}

/** /email/setup: the business email order form. Submitting creates the order and hands off to /checkout/:orderId. */
const MailSetup: React.FC<Props> = ({ user, onUserUpdate }) => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const asked = params.get("plan") as MailPlanId | null;
  const initialPlanId = asked && MAIL_PLAN_IDS.includes(asked) ? asked : "mail-starter";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-28 pb-20">
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-murzak-ink dark:text-slate-100">Get business email</h1>
      <p className="mt-2 mb-8 text-slate-600 dark:text-slate-400 font-medium">
        Email on your own domain, paid by M-Pesa. Start with your domain and we handle the rest.
      </p>
      <MailSetupForm
        user={user}
        onUserUpdate={onUserUpdate}
        initialPlanId={initialPlanId}
        onSubmit={async (setup) => {
          const { orderId } = await createMailOrder(setup);
          navigate(`/checkout/${encodeURIComponent(orderId)}`);
        }}
      />
    </div>
  );
};

export default MailSetup;
