// utils/billingAmount.js
//
// Single source of truth for "how much do we actually collect to activate this
// invoice". Paid plans collect their real amount. Free / zero-amount plans
// (e.g. the Test Drive trial) collect a small verification amount so that EVERY
// activation is backed by a real card or M-Pesa transaction — there is no free,
// unverified activation path. The amount is refundable/nominal and configurable.
//
// Override with TRIAL_VERIFY_AMOUNT_KES (KES). Default: 1.
// NOTE for go-live: live card processors often reject charges below ~USD 0.50.
// If verifying free trials by card in production, set TRIAL_VERIFY_AMOUNT_KES to
// an amount whose USD conversion clears that floor (e.g. 70+). M-Pesa STK has no
// such floor, so KES 1 is fine for the M-Pesa rail.

function trialVerifyAmountKes() {
  const n = Number(process.env.TRIAL_VERIFY_AMOUNT_KES);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// The amount, in KES, that a payment rail must actually collect for this invoice.
// > 0 invoice amount  -> that exact amount (real paid plan; unchanged behaviour).
// 0 / missing amount  -> the trial verification amount (card / M-Pesa "for free").
function effectiveChargeKes(invoiceAmountKes) {
  const amt = Number(invoiceAmountKes || 0);
  if (Number.isFinite(amt) && amt > 0) return amt;
  return trialVerifyAmountKes();
}

// True when this invoice is a free/zero-amount invoice being collected purely as
// a payment-method verification (used for messaging / receipts).
function isVerificationOnly(invoiceAmountKes) {
  const amt = Number(invoiceAmountKes || 0);
  return !(Number.isFinite(amt) && amt > 0);
}

module.exports = { effectiveChargeKes, trialVerifyAmountKes, isVerificationOnly };
