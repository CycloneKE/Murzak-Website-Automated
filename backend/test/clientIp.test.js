/**
 * clientIp: the visitor address recorded on the trial and contact forms.
 * node test/clientIp.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log("  ok:", msg); } else { failed++; console.error("  FAIL:", msg); } }

const { clientIp, isPlausibleIp } = require("../utils/clientIp");
const req = (headers = {}, ip, remote) => ({ headers, ip, socket: { remoteAddress: remote } });

console.log("# uses the address nginx saw");
ok(clientIp(req({ "x-real-ip": "105.163.2.236" }, "10.0.1.1")) === "105.163.2.236", "X-Real-IP wins over req.ip");
ok(clientIp(req({ "x-real-ip": "2001:db8::1" }, "10.0.1.1")) === "2001:db8::1", "IPv6 is accepted");
ok(clientIp(req({ "x-real-ip": "198.51.100.4, 10.0.0.1" }, "10.0.1.1")) === "198.51.100.4", "only the first address of a list is used");

console.log("# a visitor cannot choose the recorded address with X-Forwarded-For");
ok(clientIp(req({ "x-forwarded-for": "6.6.6.6, 105.163.2.236", "x-real-ip": "105.163.2.236" }, "10.0.1.1")) === "105.163.2.236", "a forged first X-Forwarded-For entry is ignored");
ok(clientIp(req({ "x-forwarded-for": "6.6.6.6" }, "10.0.1.1")) === "10.0.1.1", "with no X-Real-IP the forged header is still ignored");

console.log("# falls back safely");
ok(clientIp(req({}, "10.0.1.1")) === "10.0.1.1", "no header: the connection address, as before the change");
ok(clientIp(req({}, undefined, "::ffff:127.0.0.1")) === "::ffff:127.0.0.1", "no req.ip: the socket address");
ok(clientIp(req({ "x-real-ip": "<script>alert(1)</script>" }, "10.0.1.1")) === "10.0.1.1", "a non-address value is ignored, not stored");
ok(clientIp(req({ "x-real-ip": "x".repeat(300) }, "10.0.1.1")) === "10.0.1.1", "an oversized value is ignored");
ok(clientIp({}) === "" && clientIp(null) === "", "a bare or missing request never throws");

console.log("# shape check");
ok(isPlausibleIp("203.0.113.7") && isPlausibleIp("::1") && !isPlausibleIp("hello") && !isPlausibleIp(""), "isPlausibleIp");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
