
// config/paypal.js
const isLive = (process.env.PAYPAL_ENV || "sandbox") === "live";

const paypalConfig = {
  env: isLive ? "live" : "sandbox",
  isLive,
  clientId: isLive
    ? process.env.PAYPAL_LIVE_CLIENT_ID
    : process.env.PAYPAL_SANDBOX_CLIENT_ID,
  clientSecret: isLive
    ? process.env.PAYPAL_LIVE_CLIENT_SECRET
    : process.env.PAYPAL_SANDBOX_CLIENT_SECRET,
  webhookId: isLive
    ? process.env.PAYPAL_LIVE_WEBHOOK_ID
    : process.env.PAYPAL_SANDBOX_WEBHOOK_ID,
  baseUrl: isLive
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com",
};

module.exports = { paypalConfig };
