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
