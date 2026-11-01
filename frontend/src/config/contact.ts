/**
 * Public-facing contact details.
 *
 * Single source so this can't drift into three independent copies again —
 * which is exactly how it broke: Footer.tsx, About.tsx and ContactPage.tsx
 * each hardcoded their own `support@murzaktech.com`, silently pointed at a
 * domain that lapsed and dropped out of the registry (confirmed via RDAP,
 * 2026-09). Anyone could have re-registered it and read every message sent
 * through this address.
 *
 * SUPPORT_EMAIL here matches the backend's SUPPORT_EMAIL env value
 * (backend/utils/mailer.js) — the address already configured for real
 * outbound support mail, so the page now shows the inbox that's actually
 * read instead of a second, independently-maintained guess.
 */
export const SUPPORT_EMAIL = "murzaktechnologies@gmail.com";

/**
 * Public mail server name customers type into phone and desktop mail apps
 * (IMAP/SMTP). Set VITE_MAIL_HOSTNAME to override per environment; the default
 * is the shared Murzak mail host.
 */
export const MAIL_HOSTNAME: string =
  ((import.meta as any).env?.VITE_MAIL_HOSTNAME as string | undefined)?.trim() || "mail.murzaktech.tech";

/**
 * Release 1 sells email on a domain the customer already owns. Registering a
 * new domain through the email order is off until the checkout can bill it
 * (the server refuses it too unless MAIL_NEW_DOMAIN_ENABLED=1 there).
 */
export const MAIL_NEW_DOMAIN_ENABLED: boolean =
  ((import.meta as any).env?.VITE_MAIL_NEW_DOMAIN_ENABLED as string | undefined) === "1";
