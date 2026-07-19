/**
 * Developer-terminal access gates — Web Account fields that must be true
 * before a terminal session can ever be minted. Being on an Enterprise plan
 * is necessary but not sufficient (see the design spec): staff must also
 * approve, and the customer must accept the one-time disclosure. Both are
 * re-checked from the live Frappe record on every mint attempt — never
 * trusted from the client or a stale session field.
 */

function isEnterprisePlan(plan) {
  return String(plan || "None").toLowerCase().includes("enterprise");
}

/** @returns {Promise<{approved: boolean, disclosureAccepted: boolean}>} never throws. */
async function fetchTerminalGates(client, webAccountName) {
  try {
    const res = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
    const rec = res.data?.data || {};
    return {
      approved: !!rec.terminal_access_approved_at,
      disclosureAccepted: !!rec.terminal_disclosure_accepted_at,
    };
  } catch (e) {
    return { approved: false, disclosureAccepted: false };
  }
}

module.exports = { isEnterprisePlan, fetchTerminalGates };
