"use strict";
/**
 * The visitor's address as nginx saw it.
 *
 * Production runs nginx -> Traefik -> this app. nginx sets `X-Real-IP` from its
 * own connection (overwriting anything a visitor sent), so it is the one header
 * a visitor cannot forge on that route. `X-Forwarded-For` is deliberately NOT
 * used: nginx appends to whatever the visitor sent, so its FIRST entry is
 * visitor-controlled.
 *
 * This only carries the real address once Traefik is told to trust nginx
 * (`entrypoints.<name>.forwardedheaders.trustedips`). Until then the header
 * holds the proxy's own internal address, which is still returned (that is what
 * was recorded before), never a visitor-supplied string.
 *
 * Use it for records (audit fields, lead forms). It is not a security boundary:
 * a request that reaches the app without passing nginx can set the header.
 */
const IP_LIKE = /^[0-9a-fA-F:.]{3,45}$/;

/** True for something that looks like an IPv4 or IPv6 address (shape only). */
function isPlausibleIp(value) {
  return IP_LIKE.test(String(value || "").trim());
}

function clientIp(req) {
  const real = String(req?.headers?.["x-real-ip"] || "").split(",")[0].trim();
  if (isPlausibleIp(real)) return real;
  return String(req?.ip || req?.socket?.remoteAddress || "").trim();
}

module.exports = { clientIp, isPlausibleIp };
