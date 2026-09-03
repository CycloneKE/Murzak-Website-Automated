import { toUserMessage } from "./errors";
/**
 * Mailbox API client — self-service for the "Email Hosting" product.
 *
 * Mailboxes live on Hostinger, but nothing here says so: the backend proxies
 * every call and returns an allow-listed shape, so the provider's name and
 * internal ids never reach the customer (white-label).
 */

export interface Mailbox {
  id: string;
  address: string;
  localPart: string;
  usedBytes: number;
  quotaBytes: number;
}

export interface MailboxSettings {
  host: string;
  port: number;
  security: string;
}

export interface MailboxesResponse {
  mailboxes: Mailbox[];
  used: number;
  /** null when the ceiling is genuinely unknown — render "—", never a guess. */
  limit: number | null;
  unlimited: boolean;
  canCreate: boolean;
  webmailUrl: string;
  imap: MailboxSettings;
  smtp: MailboxSettings;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(toUserMessage((data as any)?.error, "Request failed."));
  return data as T;
}

const JSON_REQ = {
  headers: { "Content-Type": "application/json" },
  credentials: "include" as const,
};

const base = (serviceId: string) =>
  `/api/portal/services/${encodeURIComponent(serviceId)}/mailboxes`;

export async function fetchMailboxes(serviceId: string): Promise<MailboxesResponse> {
  const res = await fetch(base(serviceId), { credentials: "include" });
  const data = await handleJson<{ ok: true } & MailboxesResponse>(res);
  return {
    mailboxes: data.mailboxes || [],
    used: Number(data.used) || 0,
    limit: data.limit === null || data.limit === undefined ? null : Number(data.limit),
    unlimited: !!data.unlimited,
    canCreate: !!data.canCreate,
    webmailUrl: data.webmailUrl || "",
    imap: data.imap,
    smtp: data.smtp,
  };
}

export async function createMailbox(
  serviceId: string,
  input: { localPart: string; password: string }
): Promise<{ mailbox: Mailbox }> {
  const res = await fetch(base(serviceId), {
    method: "POST",
    ...JSON_REQ,
    body: JSON.stringify(input),
  });
  return handleJson(res);
}

export async function changeMailboxPassword(
  serviceId: string,
  mailboxId: string,
  password: string
): Promise<{ message: string }> {
  const res = await fetch(`${base(serviceId)}/${encodeURIComponent(mailboxId)}/password`, {
    method: "PATCH",
    ...JSON_REQ,
    body: JSON.stringify({ password }),
  });
  return handleJson(res);
}

export async function deleteMailbox(
  serviceId: string,
  mailboxId: string
): Promise<{ message: string }> {
  const res = await fetch(`${base(serviceId)}/${encodeURIComponent(mailboxId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return handleJson(res);
}
