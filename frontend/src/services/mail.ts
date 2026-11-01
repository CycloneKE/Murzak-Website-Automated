import { toUserMessage } from "./errors";
import { planForService } from "../config/serviceCatalog";
import type { MailSetup, MailStatus } from "../types";

/**
 * Business email client: placing a mail order, finding the owner's status link,
 * and reading the no-login status page. Every message shown to a customer goes
 * through toUserMessage(); raw error text is never rendered.
 */

export class MailError extends Error {
  status: number;
  code?: string;
  /** Field-level problems from the order check, keyed by field name. */
  fieldErrors: Record<string, string>;
  constructor(message: string, status = 0, fieldErrors: Record<string, string> = {}, code?: string) {
    super(message);
    this.name = "MailError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}

const NETWORK = "We couldn't reach our servers. Check your connection and try again.";

async function call<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", ...init });
  } catch {
    throw new MailError(NETWORK, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fields: Record<string, string> = {};
    if (data && typeof data.errors === "object" && data.errors) {
      for (const [k, v] of Object.entries(data.errors)) if (typeof v === "string") fields[k] = toUserMessage(v, fallback);
    }
    throw new MailError(toUserMessage(data?.error, fallback), res.status, fields, typeof data?.code === "string" ? data.code : undefined);
  }
  return data as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Creates the Checkout Order for a mail plan; the caller then goes to /checkout/:orderId. */
export async function createMailOrder(setup: MailSetup): Promise<{ orderId: string }> {
  const data = await call<{ order?: { id?: string } }>(
    "/api/orders",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        serviceId: setup.planId,
        planKey: planForService(setup.planId) || "Starter",
        source: "mail-order",
        config: {},
        mailSetup: setup,
      }),
    },
    "We couldn't start your order. Please try again.",
  );
  if (!data?.order?.id) throw new MailError("We couldn't start your order. Please try again.", 0);
  return { orderId: data.order.id };
}

/** The signed-in owner's token for their order's status page. */
export function fetchMyMailLink(orderId: string): Promise<{ statusUrl: string; token: string }> {
  return call(`/api/mail/my/${encodeURIComponent(orderId)}/link`, {}, "We couldn't open your email setup. Please try again.");
}

export function fetchMailStatus(token: string): Promise<MailStatus> {
  return call(`/api/mail/status/${encodeURIComponent(token)}`, {}, "We couldn't load your email setup. Please try again.");
}

export function requestMailCode(token: string, purpose: "reset" | "add"): Promise<{ sent: boolean }> {
  return call(
    `/api/mail/status/${encodeURIComponent(token)}/code`,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ purpose }) },
    "We couldn't send the code just now. Please try again.",
  );
}

export function setMailboxPassword(
  token: string,
  local: string,
  password: string,
  code?: string,
): Promise<{ address: string; passwordSet: boolean }> {
  return call(
    `/api/mail/status/${encodeURIComponent(token)}/mailboxes/${encodeURIComponent(local)}/password`,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ password, ...(code ? { code } : {}) }) },
    "We couldn't set that password. Please try again.",
  );
}

export function addMailbox(token: string, localPart: string, code: string): Promise<{ address: string; passwordSet: boolean }> {
  return call(
    `/api/mail/status/${encodeURIComponent(token)}/mailboxes`,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ localPart, code }) },
    "We couldn't add that mailbox. Please try again.",
  );
}

// ---- Mailbox name rules: must match backend/services/email/mailInput.js ----

const MAILBOX_LOCAL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const RESERVED = new Set(["admin", "abuse", "noreply", "root", "postmaster"]);

/** Returns a plain-words problem with a mailbox name, or "" when it is fine. */
export function mailboxNameProblem(name: string): string {
  if (!name) return "Type a name, for example info.";
  if (name.length > 64) return "That name is too long (64 characters at most).";
  if (RESERVED.has(name)) return `"${name}" is reserved. Pick another name.`;
  if (!MAILBOX_LOCAL_RE.test(name)) return "Use lowercase letters, numbers, dots and hyphens, and don't start, end or double up a dot.";
  return "";
}

/** 2547XXXXXXXX (also accepts 07XXXXXXXX / 01XXXXXXXX / +254 and normalises). */
export function normalizeMpesa(raw: string): string | null {
  const t = raw.replace(/[\s-]/g, "");
  const m = /^(?:\+?254|0)([71]\d{8})$/.exec(t);
  return m ? `254${m[1]}` : null;
}
