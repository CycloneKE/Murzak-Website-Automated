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

  // Neither the emailed link nor the signed-in progress page belongs in a search index.
  // index.html ships a blanket "index, follow" robots tag: override it while this page
  // is mounted (two conflicting tags are ambiguous) and put it back on the way out.
  useEffect(() => {
    const existing = Array.from(document.head.querySelectorAll<HTMLMetaElement>('meta[name="robots"]'));
    const previous = existing.map((m) => m.content);
    existing.forEach((m) => { m.content = "noindex,nofollow"; });
    let added: HTMLMetaElement | null = null;
    if (!existing.length) {
      added = document.createElement("meta");
      added.name = "robots";
      added.content = "noindex,nofollow";
      document.head.appendChild(added);
    }
    return () => {
      added?.remove();
      existing.forEach((m, i) => { m.content = previous[i]; });
    };
  }, []);
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-28 pb-20">
      <MailProgress orderId={orderId} token={token} />
    </div>
  );
};

export default MailOrder;
