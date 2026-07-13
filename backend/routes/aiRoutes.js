const express = require("express");
const { processChat, getChatHistory } = require("../services/aiService");

module.exports = function createAiRouter({ requireAuth, frappeClient }) {
  const router = express.Router();

  // Middleware to ensure user has an active service/plan (to restrict access as requested)
  const requireActivePlan = (req, res, next) => {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: "Not authenticated." });
    
    const hasLiveSite = user.plan !== "None" && user.selectedServices && user.selectedServices.length > 0;
    if (!hasLiveSite) {
      return res.status(403).json({ error: "Murzaker is only available to clients with an active plan or live service." });
    }
    
    next();
  };

  // Get chat history
  router.get("/history", requireAuth, requireActivePlan, (req, res) => {
    try {
      const history = getChatHistory(req.session.user.id);
      res.json({ history });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Post a new message
  router.post("/chat", requireAuth, requireActivePlan, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Invalid message payload." });
      }

      const result = await processChat(req, message, frappeClient);
      res.json(result);
    } catch (error) {
      console.error("AI Chat Route Error:", error);
      res.status(500).json({ error: error.message || "Failed to process chat." });
    }
  });

  return router;
};
