// routes/appsRoutes.js
//
// GET /api/apps/:app/address?name=…  — live "is this shop address free?"
// for the /get/:app setup page. Public on purpose: a buyer checks names
// before they have an account. Reads only; reservation happens at order time.

const express = require("express");
const shopAddress = require("../services/apps/shopAddress");
const tenantSlugs = require("../services/apps/tenantSlugStore");
const appOrder = require("../services/apps/appOrder");

module.exports = function (ctx) {
  const { frappeClient } = ctx;
  const router = express.Router();

  router.get("/api/apps/:app/address", async (req, res) => {
    if (!appOrder.APP_ADDRESS_SUFFIX[req.params.app]) {
      return res.status(404).json({ error: "Unknown app." });
    }
    const raw = String(req.query.name || "").slice(0, 120);
    const slug = shopAddress.slugFromName(raw);
    const rule = shopAddress.checkSlug(slug);
    if (!rule.ok) {
      return res.json({ ok: true, slug, available: false, reason: rule.reason, suggestions: [] });
    }
    try {
      const client = frappeClient();
      const nowMs = Date.now();
      const available = await tenantSlugs.isSlugAvailable(client, slug, nowMs);
      let suggestions = [];
      if (!available) {
        for (const s of shopAddress.suggestSlugs(slug)) {
          if (await tenantSlugs.isSlugAvailable(client, s, nowMs)) suggestions.push(s);
        }
      }
      return res.json({ ok: true, slug, available, ...(available ? {} : { reason: "taken" }), suggestions });
    } catch (err) {
      console.error("APP ADDRESS CHECK ERROR:", err.response?.data || err.message);
      return res.status(503).json({ error: "Couldn't check that address right now. Please try again." });
    }
  });

  return router;
};
