// services/apps/shopProgress.js
//
// "How far has this owner got with their new shop?" The checklist in the portal
// and (later) the follow-up emails both read this, so they only ever say what
// really happened inside the shop.
//
// WHERE THE FACTS COME FROM
//   The shop's data lives on the VPS bench, which this backend cannot reach. The
//   host script (deploy/vps/bin/murzak-shop-setup, `progress` mode) reads a few
//   counts from each young shop, read-only, and saves them on the Checkout
//   Order's existing config_json under `shopProgress`:
//
//     { signedIn: bool, products: int, staff: int, tillOpened: bool,
//       firstSale: bool, checkedAt: ISO, firstSeenAt: ISO, complete: bool }
//
//   Same no-schema-change reasoning as welcomeEmail and shopSetup.
//
// HOW EACH FACT IS READ IN THE SHOP (see the host script)
//   signedIn    a user whose last_active is 10+ minutes after their account was
//               created. Not User.last_login: murzak_pos sign-ins do not set it.
//   products    enabled Items
//   staff       enabled users other than Administrator and Guest (the owner is one)
//   tillOpened  any POS Opening Entry
//   firstSale   any POS Invoice with docstatus 1 (a saved draft is not a sale)

const MILESTONES = Object.freeze([
  {
    id: "signedIn",
    label: "Sign in to your shop",
    help: "Open your shop address and sign in with the email and first password on your welcome page.",
  },
  {
    id: "products",
    label: "Add your products",
    help: "Add what you sell, with prices, so the till has something to ring up.",
  },
  {
    id: "tillOpened",
    label: "Open your till",
    help: "Open the till for the day with your starting cash.",
  },
  {
    id: "firstSale",
    label: "Make your first sale",
    help: "Ring up a sale and take payment. A saved but unpaid sale does not count yet.",
  },
  {
    id: "staff",
    label: "Add a cashier or staff member",
    help: "Each person gets their own login. Skip this if you work alone.",
    optional: true,
  },
]);

const MAX_COUNT = 1_000_000;

function count(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_COUNT ? n : 0;
}

/** Clean what the host wrote; anything unexpected reads as "not done". */
function normalizeSignals(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    signedIn: raw.signedIn === true,
    products: count(raw.products),
    staff: count(raw.staff),
    tillOpened: raw.tillOpened === true,
    firstSale: raw.firstSale === true,
    checkedAt: typeof raw.checkedAt === "string" ? raw.checkedAt : null,
  };
}

function isDone(id, s) {
  switch (id) {
    case "signedIn": return s.signedIn;
    case "products": return s.products >= 1;
    case "tillOpened": return s.tillOpened;
    case "firstSale": return s.firstSale;
    case "staff": return s.staff >= 2; // the owner is the first user
    default: return false;
  }
}

/**
 * What the portal shows. `checked` is false until the host has looked at the
 * shop at least once, so the page can say "we update this every few minutes"
 * instead of showing a row of unticked steps as though they were facts.
 */
function progressView(config) {
  const s = normalizeSignals(config?.shopProgress);
  const steps = MILESTONES.map((m) => ({
    id: m.id,
    label: m.label,
    help: m.help,
    optional: m.optional === true,
    done: s ? isDone(m.id, s) : false,
  }));
  const required = steps.filter((x) => !x.optional);
  const doneCount = required.filter((x) => x.done).length;
  const next = required.find((x) => !x.done) || null;
  return {
    checked: !!s,
    checkedAt: s?.checkedAt || null,
    steps,
    doneCount,
    total: required.length,
    complete: !!s && doneCount === required.length,
    nextStepId: s && next ? next.id : null,
  };
}

module.exports = { MILESTONES, normalizeSignals, isDone, progressView };
