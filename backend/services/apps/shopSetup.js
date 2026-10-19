// services/apps/shopSetup.js
//
// "Set up my shop for my business": the industry packs a new Murzak POS owner
// chooses from while their shop builds, the checks on their answers, and the
// plan the host applies once the shop exists.
//
// Why the answers live on the Checkout Order (config.shopSetup)
//   They arrive while the shop is still being built, so they cannot ride on the
//   Provisioning Job (already queued). The order's existing config_json needs no
//   Frappe schema change (a new doctype field would be silently dropped until the
//   doctype is re-imported), the same reason welcomeEmail keeps its marker there.
//
// What the packs may offer
//   ONLY things murzak_pos really has, so no switch is shown that does nothing:
//     - the business kind (setup_api.save_business_kind: pharmacy | retail |
//       services | other), which only ADDS screens and never hides any
//     - kitchen settings (kitchen_api: enabled, screens, stations, defaultStation,
//       quickNotes). A "bar till" is simply a second station.
//   Adding a pack option that is not in that list means the POS app gets it first.
//
// The host script (deploy/vps/bin/murzak-shop-setup) turns `plan` into those two
// calls. This file never talks to the shop.

const ORDER_DOCTYPE = "Checkout Order";

const PACK_IDS = ["restaurant", "retail", "services"];
const MAX_BRANCHES = 99;
const MAX_STAFF = 500;

const QUICK_NOTES = ["No onions", "Extra spicy", "No ice", "Less sugar", "Well done", "Take away"];

// Item groups the kitchen and bar stations serve. The host adds them to the
// shop when missing (additive only) so a "Bar" never starts out serving nothing.
const FOOD_GROUP = "Food";
const DRINKS_GROUP = "Drinks";

const PACKS = Object.freeze([
  {
    id: "restaurant",
    label: "Restaurant or bar",
    blurb: "Food and drinks, with orders sent to a kitchen or a bar.",
    kind: "other",
    styles: [
      { id: "restaurant", label: "Restaurant or cafe", blurb: "Food is cooked and served.", defaults: { kitchenTickets: true, barTill: false } },
      { id: "bar", label: "Bar or pub", blurb: "Mostly drinks, maybe some snacks.", defaults: { kitchenTickets: false, barTill: true } },
      { id: "both", label: "Restaurant with a bar", blurb: "A kitchen and a separate bar.", defaults: { kitchenTickets: true, barTill: true } },
    ],
    defaultStyle: "restaurant",
    options: [
      {
        id: "kitchenTickets",
        label: "Kitchen till",
        help: "Orders you ring up appear on a kitchen list, so the cooks see what to make.",
      },
      {
        id: "barTill",
        label: "Bar till",
        help: "Drinks go to their own bar list, so the barman sees them and the kitchen does not.",
      },
      {
        id: "stationScreens",
        label: "Screens for the kitchen and bar",
        help: "Each station shows its orders on a screen. Leave off if you prefer to call orders out.",
        default: false,
        needsStation: true,
      },
      {
        id: "quickNotes",
        label: "Quick notes on orders",
        help: "One tap adds a note such as \"No onions\" or \"Extra spicy\" to an order.",
        default: true,
        needsStation: true,
      },
    ],
    includes: [],
  },
  {
    id: "retail",
    label: "Retail shop",
    blurb: "Goods on shelves: groceries, clothes, hardware, electronics and more.",
    kind: "retail",
    styles: [],
    options: [],
    includes: ["Barcodes and units come first when you add a product, which is how most shops list goods."],
  },
  {
    id: "services",
    label: "Services or salon",
    blurb: "You sell your time and skill: salons, barbers, garages, spas.",
    kind: "services",
    styles: [],
    options: [],
    includes: ["Services are listed before goods, so the till opens on what you sell most."],
  },
]);

function packById(id) {
  return PACKS.find((p) => p.id === id) || null;
}

/** What a client needs to draw the questionnaire. Plain data, safe to serve. */
function catalogForClient() {
  return { packs: PACKS, maxBranches: MAX_BRANCHES, maxStaff: MAX_STAFF };
}

function boundedInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n >= min && n <= max ? n : null;
}

/** The option values a pack starts from for a given style: the recommendation. */
function defaultOptions(pack, styleId) {
  const style = pack.styles.find((s) => s.id === styleId) || pack.styles.find((s) => s.id === pack.defaultStyle);
  const out = {};
  for (const opt of pack.options) {
    if (style && Object.prototype.hasOwnProperty.call(style.defaults, opt.id)) out[opt.id] = style.defaults[opt.id];
    else out[opt.id] = opt.default === true;
  }
  return out;
}

/**
 * Check what the browser sent. Never trusts it: unknown keys are dropped, flags
 * must be exactly `true` to count, and a missing option takes the recommendation.
 *
 * @returns {{ok: true, answers: object} | {ok: false, error: string}}
 */
function normalizeAnswers(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Tell us what kind of business this is." };
  const pack = packById(String(raw.pack || ""));
  if (!pack) return { ok: false, error: "Choose one of the business types shown." };

  let style = "";
  if (pack.styles.length) {
    style = String(raw.style || pack.defaultStyle);
    if (!pack.styles.some((s) => s.id === style)) return { ok: false, error: "Choose one of the options shown." };
  }

  const base = defaultOptions(pack, style);
  const sent = raw.options && typeof raw.options === "object" && !Array.isArray(raw.options) ? raw.options : {};
  const options = {};
  for (const opt of pack.options) {
    options[opt.id] = Object.prototype.hasOwnProperty.call(sent, opt.id) ? sent[opt.id] === true : base[opt.id];
  }

  const answers = { pack: pack.id, options };
  if (style) answers.style = style;
  const branches = boundedInt(raw.branches, 1, MAX_BRANCHES);
  const staff = boundedInt(raw.staff, 1, MAX_STAFF);
  if (branches) answers.branches = branches;
  if (staff) answers.staff = staff;
  return { ok: true, answers };
}

/**
 * The settings to apply to the shop, in the shapes murzak_pos accepts.
 * `kitchen` is null when there is nothing to turn on (the shop keeps its
 * defaults); `itemGroups` lists groups the stations need.
 */
function buildPlan(answers) {
  const pack = packById(answers?.pack);
  if (!pack) return null;
  const plan = { version: 1, kind: pack.kind, kitchen: null, itemGroups: [] };

  if (pack.id === "restaurant") {
    const o = answers.options || {};
    const stations = [];
    if (o.kitchenTickets) stations.push({ id: "kitchen", name: "Kitchen", groups: [FOOD_GROUP] });
    if (o.barTill) stations.push({ id: "bar", name: "Bar", groups: [DRINKS_GROUP] });
    if (stations.length) {
      plan.kitchen = {
        enabled: true,
        screens: o.stationScreens === true,
        stations,
        defaultStation: stations[0].id,
        quickNotes: o.quickNotes === true ? QUICK_NOTES : [],
      };
      plan.itemGroups = stations.flatMap((s) => s.groups);
    }
  }
  return plan;
}

/** Plain-language lines saying what was (or will be) set up. Shown to the owner. */
function describePlan(answers) {
  const pack = packById(answers?.pack);
  if (!pack) return [];
  const lines = [`Business type: ${pack.label}.`];
  if (pack.id === "restaurant") {
    const o = answers.options || {};
    lines.push(o.kitchenTickets ? "Kitchen till is on: orders appear on the kitchen list." : "Kitchen till is off.");
    lines.push(o.barTill ? "Bar till is on: drinks go to the bar list." : "Bar till is off.");
    if (o.kitchenTickets || o.barTill) {
      lines.push(o.stationScreens ? "The kitchen and bar use screens." : "The kitchen and bar do not use screens.");
      if (o.quickNotes) lines.push(`Quick notes added: ${QUICK_NOTES.join(", ")}.`);
    }
  }
  for (const text of pack.includes) lines.push(text);
  return lines;
}

function parseJson(s, fallback) {
  try {
    const v = JSON.parse(s || "");
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read-modify-write of one order's config_json, re-reading just before the
 * write so a concurrent sweep's marker (welcomeEmail) is carried, not lost.
 * The window left is a few milliseconds; each writer touches its own key.
 */
async function mergeOrderConfig(client, orderName, mutate) {
  const res = await client.get(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderName)}`);
  const current = parseJson(res.data?.data?.config_json, {});
  const next = mutate({ ...current });
  await client.put(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderName)}`, {
    config_json: JSON.stringify(next),
  });
  return next;
}

/** The part of config the browser may see. */
function publicSetup(config) {
  const s = config?.shopSetup;
  if (!s) return null;
  return {
    state: s.state,
    skipped: s.skipped === true,
    answers: s.answers || null,
    summary: Array.isArray(s.summary) ? s.summary : [],
    savedAt: s.savedAt || null,
    appliedAt: s.appliedAt || null,
  };
}

/**
 * Save the owner's answers (or their choice to skip) on the order.
 *
 * @returns {Promise<{ok: true, setup: object} | {ok: false, status: number, error: string}>}
 */
async function saveShopSetup({ client, order, body, nowMs = Date.now() }) {
  if (order?.status !== "Paid" || !order?.config?.app) {
    return { ok: false, status: 409, error: "Shop setup is available once your shop order is paid." };
  }
  const existing = order.config.shopSetup;
  if (existing && (existing.state === "applying" || existing.state === "applied")) {
    return {
      ok: false,
      status: 409,
      error: "Your shop has already been set up. You can change these settings from inside your POS.",
    };
  }

  let setup;
  if (body?.skip === true) {
    setup = { state: "skipped", skipped: true, savedAt: new Date(nowMs).toISOString() };
  } else {
    const checked = normalizeAnswers(body?.answers);
    if (!checked.ok) return { ok: false, status: 400, error: checked.error };
    setup = {
      state: "saved",
      answers: checked.answers,
      plan: buildPlan(checked.answers),
      summary: describePlan(checked.answers),
      savedAt: new Date(nowMs).toISOString(),
    };
  }

  const next = await mergeOrderConfig(client, order.id, (cfg) => {
    cfg.shopSetup = setup;
    return cfg;
  });
  return { ok: true, setup: publicSetup(next) };
}

module.exports = {
  PACKS,
  PACK_IDS,
  QUICK_NOTES,
  catalogForClient,
  defaultOptions,
  normalizeAnswers,
  buildPlan,
  describePlan,
  mergeOrderConfig,
  publicSetup,
  saveShopSetup,
};
