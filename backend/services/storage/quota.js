/** Pure quota-headroom check, split out of the routes so it's independently testable. */
function hasQuotaHeadroom({ usedBytes, incomingBytes, quotaBytes }) {
  if (!(Number(quotaBytes) > 0)) return false;
  return Number(usedBytes) + Number(incomingBytes) <= Number(quotaBytes);
}

module.exports = { hasQuotaHeadroom };
