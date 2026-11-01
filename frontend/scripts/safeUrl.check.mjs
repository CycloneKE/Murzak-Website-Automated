// Run: node --experimental-strip-types scripts/safeUrl.check.mjs
import { redactStatusPath, safeHref, isStatusPath } from "../src/utils/safeUrl.ts";

const T = "/mail/status/:token";
const cases = [
  ["/mail/status/abc.def", T],
  ["/mail/status/abc.def?x=1#h", T],
  ["https://murzaktech.tech/mail/status/abc.def?x=1#h", "https://murzaktech.tech" + T],
  ["%2Fmail%2Fstatus%2FTOKEN", T],
  ["/login?returnTo=%2Fmail%2Fstatus%2FTOKEN%3Fa%3D1", "/login?returnTo=" + T],
  ["/MAIL/Status/TOKEN", T],
  ["/%6Dail/status/TOKEN", T],
  ["/mail/%73tatus/TOKEN", T],
  ["/mail/order/CHK-1", "/mail/order/CHK-1"],
  ["/mail/order/CHK-1?x=1", "/mail/order/CHK-1?x=1"],
  ["/portal/domains", "/portal/domains"],
  ["https://x.com/", "https://x.com/"],
  ["", ""],
];
let bad = 0;
for (const [input, want] of cases) {
  const got = redactStatusPath(input);
  const ok = got === want && safeHref(input) === want;
  if (!ok) bad++;
  console.log(ok ? "ok  " : "FAIL", JSON.stringify(input), "=>", JSON.stringify(got));
}
const flag = isStatusPath("/mail/status/x") && isStatusPath("%2Fmail%2Fstatus%2Fx") && !isStatusPath("/mail/order/1");
if (!flag) bad++;
console.log(flag ? "ok   isStatusPath" : "FAIL isStatusPath");
console.log(bad ? `${bad} failed` : "all passed");
process.exit(bad ? 1 : 0);
