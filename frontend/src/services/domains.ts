// Domain availability + pricing. Tries the backend registrar proxy first
// (POST /api/domains/check) and falls back to a deterministic local simulation
// so the upsell flow works before the upstream domain/registrar API is wired in.

export type TldOption = {
  tld: string; // e.g. ".co.ke"
  priceKes: number; // yearly
  popular?: boolean;
};

// Must stay in sync with DOMAIN_TLD_PRICES in backend/server.js and the
// domain-* entries in serviceCatalog.ts — this is a THIRD copy of the same
// numbers, used only as the client-side simulation fallback for when the
// backend endpoint isn't reachable. .com/.org/.net/.io corrected 2026-08-17;
// see backend/server.js DOMAIN_TLD_PRICES for the wholesale-cost math.
export const TLD_OPTIONS: TldOption[] = [
  { tld: ".co.ke", priceKes: 1200, popular: true },
  { tld: ".com", priceKes: 4200, popular: true },
  { tld: ".ke", priceKes: 1800 },
  { tld: ".org", priceKes: 3800 },
  { tld: ".net", priceKes: 3800 },
  { tld: ".africa", priceKes: 2500 },
  { tld: ".io", priceKes: 15500 },
];

export type DomainResult = {
  domain: string; // full domain, e.g. "acme.co.ke"
  tld: string;
  available: boolean;
  priceKes: number; // yearly
};

// Strip protocol, existing TLD, spaces and invalid chars from a raw query.
export function normalizeLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.[a-z.]+$/, "") // drop a trailing tld if the user typed one
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

// Stable hash so the same label always returns the same simulated availability.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function simulate(label: string, tlds: TldOption[]): DomainResult[] {
  return tlds.map((t) => {
    const domain = `${label}${t.tld}`;
    // ~70% available; deterministic per (label, tld)
    const available = hash(domain) % 10 >= 3;
    return { domain, tld: t.tld, available, priceKes: t.priceKes };
  });
}

export async function checkDomain(
  rawLabel: string,
  tlds: TldOption[] = TLD_OPTIONS
): Promise<DomainResult[]> {
  const label = normalizeLabel(rawLabel);
  if (!label) return [];

  try {
    const res = await fetch("/api/domains/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ label, tlds: tlds.map((t) => t.tld) }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.results) && data.results.length) {
        return data.results as DomainResult[];
      }
    }
  } catch {
    // fall through to simulation
  }

  return simulate(label, tlds);
}
