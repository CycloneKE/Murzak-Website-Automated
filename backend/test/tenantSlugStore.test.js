/**
 * Tenant Slug reservation store — node test/tenantSlugStore.test.js
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }
async function rejects(fn, code, msg) {
  try { await fn(); ok(false, `${msg} (expected ${code})`); }
  catch (e) { ok(e.code === code, `${msg} -> ${e.code}`); }
}

const store = require("../services/apps/tenantSlugStore");

// Minimal Frappe double: docs keyed by name (= slug, per autoname field:slug).
function makeClient() {
  const docs = {};
  const nameOf = (url) => decodeURIComponent(url.split("?")[0].split("/").pop());
  return {
    docs,
    get: async (url, opts) => {
      if (/\/Tenant(%20| )Slug$/.test(url)) {
        const filters = JSON.parse(opts?.params?.filters || "[]");
        const rows = Object.values(docs).filter((d) =>
          filters.every(([f, op, v]) => (op === "=" ? d[f] === v : op === "in" ? v.includes(d[f]) : true)));
        return { data: { data: rows } };
      }
      const n = nameOf(url);
      if (!docs[n]) { const e = new Error("404"); e.response = { status: 404 }; throw e; }
      return { data: { data: docs[n] } };
    },
    post: async (url, body) => {
      if (docs[body.slug]) { const e = new Error("dup"); e.response = { status: 409 }; throw e; }
      docs[body.slug] = { name: body.slug, ...body };
      return { data: { data: docs[body.slug] } };
    },
    put: async (url, body) => { const n = nameOf(url); Object.assign(docs[n], body); return { data: { data: docs[n] } }; },
  };
}

const T0 = 1_800_000_000_000;
const MIN = 60 * 1000;

(async () => {
  section("reserve, availability, expiry");
  {
    const c = makeClient();
    ok(await store.isSlugAvailable(c, "mamanjeri", T0), "unknown slug is available");
    await store.reserveSlug(c, { slug: "mamanjeri", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    ok(c.docs.mamanjeri?.status === "reserved" && c.docs.mamanjeri.web_account === "A", "reserved for A");
    ok(!(await store.isSlugAvailable(c, "mamanjeri", T0 + 5 * MIN)), "held while the reservation is live");
    await rejects(
      () => store.reserveSlug(c, { slug: "mamanjeri", app: "pos", webAccount: "B", orderId: "CHK-2", nowMs: T0 + 5 * MIN }),
      "slug_taken", "another account cannot take a live reservation");
    await store.reserveSlug(c, { slug: "mamanjeri", app: "pos", webAccount: "A", orderId: "CHK-3", nowMs: T0 + 5 * MIN });
    ok(c.docs.mamanjeri.checkout_order === "CHK-3", "the holder can re-reserve for a fresh order");
    ok(await store.isSlugAvailable(c, "mamanjeri", T0 + 5 * MIN + store.SLUG_RESERVATION_TTL_MS + 1), "free again once expired");
    await store.reserveSlug(c, { slug: "mamanjeri", app: "pos", webAccount: "B", orderId: "CHK-4", nowMs: T0 + 5 * MIN + store.SLUG_RESERVATION_TTL_MS + 1 });
    ok(c.docs.mamanjeri.web_account === "B", "an expired reservation can be taken over");
  }

section("isSlugAvailableTo — a buyer's own hold is not a lock-out");
  {
    const c = makeClient();
    await store.reserveSlug(c, { slug: "own1", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    ok(typeof store.isSlugAvailableTo === "function", "isSlugAvailableTo is exported");
    ok(await store.isSlugAvailableTo(c, "own1", "A", T0 + 5 * MIN), "own live reservation is available to its holder");
    ok(!(await store.isSlugAvailableTo(c, "own1", "B", T0 + 5 * MIN)), "another account's live reservation is not available");
    ok(await store.isSlugAvailableTo(c, "own1", "A", T0 + store.SLUG_RESERVATION_TTL_MS + 1), "own expired reservation is available to its holder");
    ok(await store.isSlugAvailableTo(c, "own1", "B", T0 + store.SLUG_RESERVATION_TTL_MS + 1), "an expired reservation is available to anyone");
    ok(await store.isSlugAvailableTo(c, "never-seen", "A", T0), "unknown slug is available");
    c.docs.own1.status = "active";
    ok(!(await store.isSlugAvailableTo(c, "own1", "A", T0 + 5 * MIN)), "an active slug is not available even to its own account");
    ok(!(await store.isSlugAvailableTo(c, "own1", "B", T0 + 5 * MIN)), "an active slug is not available to others");
  }

  section("heartbeat keeps a reservation alive");
  {
    const c = makeClient();
    await store.reserveSlug(c, { slug: "duka1", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    await store.touchSlug(c, { slug: "duka1", webAccount: "A", nowMs: T0 + 25 * MIN });
    ok(!(await store.isSlugAvailable(c, "duka1", T0 + 40 * MIN)), "touched reservation outlives its first TTL");
    await store.touchSlug(c, { slug: "duka1", webAccount: "B", nowMs: T0 + 41 * MIN });
    ok(await store.isSlugAvailable(c, "duka1", T0 + 25 * MIN + store.SLUG_RESERVATION_TTL_MS + 1), "a non-holder's touch does nothing");
  }

  section("invoice link and activation");
  {
    const c = makeClient();
    await store.reserveSlug(c, { slug: "chain", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    await store.linkSlugInvoice(c, { slug: "chain", webAccount: "A", invoiceDocName: "PINV-9", nowMs: T0 + MIN });
    ok(c.docs.chain.invoice === "PINV-9", "invoice linked");
    ok(!(await store.isSlugAvailable(c, "chain", T0 + 20 * 60 * MIN)), "an invoiced reservation is held through the payment grace window");
    ok((await store.activateSlugForInvoice(c, "PINV-9")) === "chain", "activation returns the slug");
    ok(c.docs.chain.status === "active", "status active after payment");
    ok(!(await store.isSlugAvailable(c, "chain", T0 + 365 * 24 * 60 * MIN)), "an active slug is never available again");
    ok((await store.activateSlugForInvoice(c, "PINV-unknown")) === null, "no slug for an unrelated invoice");
  }

  section("re-reserve keeps the invoice history and the 24h hold");
  {
    const c = makeClient();
    await store.reserveSlug(c, { slug: "retry1", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    await store.linkSlugInvoice(c, { slug: "retry1", webAccount: "A", invoiceDocName: "PINV-1", nowMs: T0 + MIN });
    await store.reserveSlug(c, { slug: "retry1", app: "pos", webAccount: "A", orderId: "CHK-2", nowMs: T0 + 10 * MIN });
    ok(c.docs.retry1.invoice === "PINV-1", "re-reserve leaves the invoice alone");
    ok(c.docs.retry1.checkout_order === "CHK-2", "re-reserve points at the new order");
    ok(c.docs.retry1.status === "reserved", "still reserved");
    ok(!(await store.isSlugAvailable(c, "retry1", T0 + 20 * 60 * MIN)), "24h payment grace is not shortened by a retry");
    await store.linkSlugInvoice(c, { slug: "retry1", webAccount: "A", invoiceDocName: "PINV-2", nowMs: T0 + 11 * MIN });
    ok(c.docs.retry1.invoice === "PINV-1,PINV-2", "a second invoice is appended, not replaced");
    ok((await store.activateSlugForInvoice(c, "PINV-1")) === "retry1", "the late-paid first invoice still activates the slug");
    ok(c.docs.retry1.status === "active", "active after the first invoice is paid");
    ok((await store.activateSlugForInvoice(c, "PINV-2")) === "retry1", "the second invoice also resolves the slug");
  }

  section("a later retry extends a short hold but never shortens a long one");
  {
    const c = makeClient();
    await store.reserveSlug(c, { slug: "retry2", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    await store.reserveSlug(c, { slug: "retry2", app: "pos", webAccount: "A", orderId: "CHK-2", nowMs: T0 + 20 * MIN });
    ok(!(await store.isSlugAvailable(c, "retry2", T0 + 20 * MIN + store.SLUG_RESERVATION_TTL_MS - MIN)), "retry extends a short hold");
  }

  section("invoice matching is exact, not a prefix");
  {
    const c = makeClient();
    c.docs.longname = { name: "longname", slug: "longname", status: "reserved", invoice: "PINV-10" };
    ok((await store.activateSlugForInvoice(c, "PINV-1")) === null, "PINV-1 does not match PINV-10");
    ok(c.docs.longname.status === "reserved", "the PINV-10 slug was left untouched");
  }

  section("losing the insert race and refusing an owned slug");
  {
    const c = makeClient();
    const realPost = c.post;
    let once = true;
    c.post = async (url, body) => {
      if (once) { once = false; const e = new Error("dup"); e.response = { status: 409 }; throw e; }
      return realPost(url, body);
    };
    await rejects(
      () => store.reserveSlug(c, { slug: "race1", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 }),
      "slug_taken", "a 409 on insert becomes slug_taken");
    const d = makeClient();
    await store.reserveSlug(d, { slug: "owned1", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    await store.linkSlugInvoice(d, { slug: "owned1", webAccount: "A", invoiceDocName: "PINV-5", nowMs: T0 + MIN });
    await store.activateSlugForInvoice(d, "PINV-5");
    await rejects(
      () => store.reserveSlug(d, { slug: "owned1", app: "pos", webAccount: "A", orderId: "CHK-2", nowMs: T0 + 2 * MIN }),
      "slug_taken", "an active slug cannot be re-reserved, even by its owner");
  }

  section("findActiveSlugForAccount — a renewal adopts the account's own shop");
  {
    const c = makeClient();
    ok(typeof store.findActiveSlugForAccount === "function", "findActiveSlugForAccount is exported");
    ok((await store.findActiveSlugForAccount(c, { webAccount: "A", app: "pos" })) === null, "no rows -> null");
    await store.reserveSlug(c, { slug: "mine1", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    ok((await store.findActiveSlugForAccount(c, { webAccount: "A", app: "pos" })) === null, "a merely reserved slug is not an active shop");
    await store.linkSlugInvoice(c, { slug: "mine1", webAccount: "A", invoiceDocName: "PINV-1", nowMs: T0 + MIN });
    await store.activateSlugForInvoice(c, "PINV-1");
    ok((await store.findActiveSlugForAccount(c, { webAccount: "A", app: "pos" })) === "mine1", "returns the account's active slug");
    ok((await store.findActiveSlugForAccount(c, { webAccount: "B", app: "pos" })) === null, "another account does not see it");
    ok((await store.findActiveSlugForAccount(c, { webAccount: "A", app: "erp" })) === null, "another app does not match");

    // A server that ignores the filters (or a mock) must not leak other rows: JS re-verifies.
    const leaky = { ...c, get: async () => ({ data: { data: [{ name: "x", slug: "x", web_account: "B", app: "pos", status: "active" }, { name: "y", slug: "y", web_account: "A", app: "pos", status: "reserved" }] } }) };
    ok((await store.findActiveSlugForAccount(leaky, { webAccount: "A", app: "pos" })) === null, "rows for another account / non-active rows returned by the server are ignored");

    // A failed lookup propagates (the caller must treat it as unresolved, not as "no shop").
    const down = { get: async () => { throw new Error("frappe down"); } };
    let threw = null;
    try { await store.findActiveSlugForAccount(down, { webAccount: "A", app: "pos" }); } catch (e) { threw = e; }
    ok(threw && /frappe down/.test(threw.message), "a failed lookup throws instead of returning null");
  }

  section("a hung Frappe call times out and never wedges the queue");
  {
    ok(store.SLUG_STORE_TIMEOUT_MS === 15000, "production timeout is 15 seconds");
    store.setSlugStoreTimeoutMsForTests(60);
    try {
      const hung = { get: () => new Promise(() => {}), put: async () => ({}), post: async () => ({}) };
      const t0 = Date.now();
      let err = null;
      try { await store.reserveSlug(hung, { slug: "hungshop", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 }); } catch (e) { err = e; }
      ok(err && err.code === "slug_store_timeout" && err.statusCode === 503, `hung read rejects with slug_store_timeout / 503 (got ${err && err.code} ${err && err.statusCode})`);
      ok(Date.now() - t0 < 2000, "and it did so promptly, not after the production timeout");

      // The chain must still run: queue a healthy operation behind the hung one.
      const c = makeClient();
      let hungErr = null;
      const first = store.linkSlugInvoice(hung, { slug: "hungshop", webAccount: "A", invoiceDocName: "PINV-1", nowMs: T0 }).catch((e) => { hungErr = e; });
      const second = store.reserveSlug(c, { slug: "freeshop", app: "pos", webAccount: "A", orderId: "CHK-2", nowMs: T0 });
      await first;
      await second;
      ok(hungErr && hungErr.code === "slug_store_timeout", "a second hung operation also times out");
      ok(c.docs.freeshop?.status === "reserved", "a healthy operation queued behind a hung one still completes");
      ok((await store.isSlugAvailable(c, "another-free", T0)) === true, "later operations keep working");

    } finally {
      store.setSlugStoreTimeoutMsForTests();
    }
  }

  section("bad input never reaches Frappe");
  {
    const c = makeClient();
    await rejects(
      () => store.reserveSlug(c, { slug: "api", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 }),
      "slug_invalid", "reserved word refused");
    ok(Object.keys(c.docs).length === 0, "nothing written");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error(fails.join("\n")); process.exit(1); }
})();
