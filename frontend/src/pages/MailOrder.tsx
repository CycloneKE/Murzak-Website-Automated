import React, { useEffect } from "react";
import { useParams } from "react-router-dom";
import MailProgress from "../components/mail/MailProgress";

/**
 * Setup progress for a mail order. Two entrances share this page:
 *  - /mail/order/:orderId  signed in, straight after payment
 *  - /mail/status/:token   the no-login link in the customer's emails
 */
const MailOrder: React.FC = () => {
  const { orderId, token } = useParams<{ orderId?: string; token?: string }>();

  // The status link is a capability URL: never send it on as a Referer.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-28 pb-20">
      <MailProgress orderId={orderId} token={token} />
    </div>
  );
};

export default MailOrder;
