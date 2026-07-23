// test/helpers/mockFrappe.js
//
// Shared in-memory Frappe REST client mock for route/service tests. Backs
// GET (single doc + unfiltered list), POST (create, auto name), and PUT
// (update) against a small in-process doctype -> { name: doc } store, so
// tests can wire together multiple real services/orderStore/addonInvoiceService
// functions against one consistent "database" without a real Frappe instance.
//
// Callers that rely on server-side filtering (list endpoints) must re-filter
// results in JS, same as the rest of this codebase already assumes (see
// services/checkout/orderStore.js's reservedDraftRamMb) — this mock does NOT
// honor `params.filters`, it just returns every doc of that doctype.

function makeMockFrappe(seed = {}) {
  const store = {};
  Object.keys(seed).forEach((doctype) => {
    store[doctype] = { ...seed[doctype] };
  });

  const posts = [];
  const puts = [];
  let seq = 0;

  function prefixFor(doctype) {
    if (doctype === "Checkout Order") return "CHK";
    if (doctype === "Portal Invoice") return "PINV";
    if (doctype === "Capacity Request") return "CAP";
    if (doctype === "Web Account") return "WA";
    return "DOC";
  }

  // "/api/resource/<Doctype>" or "/api/resource/<Doctype>/<name>"
  function parseUrl(url) {
    const rest = decodeURIComponent(url.split("/api/resource/")[1] || "");
    const slash = rest.indexOf("/");
    if (slash === -1) return { doctype: rest, name: null };
    return { doctype: rest.slice(0, slash), name: rest.slice(slash + 1) };
  }

  const client = {
    store,
    posts,
    puts,
    get: async (url) => {
      const { doctype, name } = parseUrl(url);
      if (!store[doctype]) store[doctype] = {};
      if (name) {
        const doc = store[doctype][name];
        if (!doc) {
          const e = new Error("404");
          e.response = { status: 404 };
          throw e;
        }
        return { data: { data: doc } };
      }
      return { data: { data: Object.values(store[doctype]) } };
    },
    post: async (url, body) => {
      const { doctype } = parseUrl(url);
      if (!store[doctype]) store[doctype] = {};
      const name = `${prefixFor(doctype)}-${++seq}`;
      const doc = { name, ...body };
      store[doctype][name] = doc;
      posts.push({ url, body });
      return { data: { data: doc } };
    },
    put: async (url, body) => {
      const { doctype, name } = parseUrl(url);
      if (!store[doctype]) store[doctype] = {};
      if (!store[doctype][name]) store[doctype][name] = { name };
      Object.assign(store[doctype][name], body);
      puts.push({ url, body });
      return { data: { data: store[doctype][name] } };
    },
  };
  return client;
}

module.exports = { makeMockFrappe };
