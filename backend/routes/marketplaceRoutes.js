// routes/marketplaceRoutes.js
//
// GET /api/marketplace/catalog — what a Murzak POS owner can buy from inside the POS, with real prices.
// Public and read-only: it is the same price list the public website shows. The POS server asks for it (a browser
// on a shop's own address is not allowed by this site's CORS rules, by design) and keeps it for a few minutes.

const express = require("express");
const marketplace = require("../services/marketplace");

module.exports = function () {
  const router = express.Router();

  router.get("/api/marketplace/catalog", (req, res) => {
    res.set("Cache-Control", "public, max-age=60");
    res.json({ ok: true, ...marketplace.buildCatalog() });
  });

  return router;
};
