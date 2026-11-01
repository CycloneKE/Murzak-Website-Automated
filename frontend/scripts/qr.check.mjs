// node --experimental-strip-types scripts/qr.check.mjs
// Round-trip check for src/utils/qr.ts: encode, then decode the matrix with an
// independent reader (format bits -> unmask -> zig-zag read -> deinterleave ->
// Reed-Solomon syndromes must be zero -> byte-mode payload equals the input).
import { encodeQr, formatBits, rsDivisor, rsRemainder, QR_MAX_BYTES } from "../src/utils/qr.ts";

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ok:", m); else { failed++; console.error("  FAIL:", m); } };

// Known vector (ISO 18004 annex / widely published): "HELLO WORLD" 1-M.
const hello = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
ok(rsRemainder(hello, rsDivisor(10)).join() === "196,35,39,119,235,215,231,226,93,23", "Reed-Solomon matches the published 1-M example");
ok(formatBits(0).toString(2).padStart(15, "0") === "101010000010010", "format bits M/mask0 match the standard table");
ok(formatBits(5).toString(2).padStart(15, "0") === "100000011001110", "format bits M/mask5 match the standard table");

const ECC = [-1, 10, 16, 26, 18, 24, 16];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4];
const raw = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; } return r; };

function decode(m) {
  const size = m.length, ver = (size - 17) / 4;
  // format: read first copy, find mask by matching all 8 candidates
  let fmt = 0;
  const pos = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  pos.forEach(([x, y], i) => { if (m[y][x]) fmt |= 1 << i; });
  let mask = -1;
  for (let k = 0; k < 8; k++) if (formatBits(k) === fmt) mask = k;
  if (mask < 0) throw new Error("bad format bits");
  // second copy must agree
  let fmt2 = 0;
  for (let i = 0; i < 8; i++) if (m[8][size - 1 - i]) fmt2 |= 1 << i;
  for (let i = 8; i < 15; i++) if (m[size - 15 + i][8]) fmt2 |= 1 << i;
  if (fmt2 !== fmt) throw new Error("format copies differ");
  // function modules
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < size && y < size) fn[y][x] = true; };
  mark(0, 0, 8, 8); mark(size - 8, 0, size - 1, 8); mark(0, size - 8, 8, size - 1);
  mark(6, 0, 6, size - 1); mark(0, 6, size - 1, 6);
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const ap = [6]; for (let p = size - 7; ap.length < n; p -= step) ap.splice(1, 0, p);
    ap.forEach((a, i) => ap.forEach((b, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return;
      mark(a - 2, b - 2, a + 2, b + 2);
    }));
  }
  const maskFn = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask];
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = up ? size - 1 - v : v;
      if (!fn[y][x]) bits.push((m[y][x] ? 1 : 0) ^ (maskFn(x, y) ? 1 : 0));
    }
  }
  const total = Math.floor(raw(ver) / 8);
  const cw = [];
  for (let i = 0; i < total; i++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j]; cw.push(v); }
  // deinterleave
  const nb = BLOCKS[ver], el = ECC[ver], numShort = nb - (total % nb), shortLen = Math.floor(total / nb);
  const blocks = Array.from({ length: nb }, () => []);
  let k = 0;
  for (let i = 0; i < shortLen + 1; i++) for (let b = 0; b < nb; b++) {
    if (i === shortLen - el && b < numShort) { continue; } // short blocks have no byte here
    blocks[b].push(cw[k++]);
  }
  const data = [];
  for (const blk of blocks) {
    const d = blk.slice(0, blk.length - el), e = blk.slice(blk.length - el);
    const want = rsRemainder(d, rsDivisor(el));
    if (want.join() !== e.join()) throw new Error("Reed-Solomon check failed");
    data.push(...d);
  }
  // byte mode payload
  const bs = data.map((b) => b.toString(2).padStart(8, "0")).join("");
  if (bs.slice(0, 4) !== "0100") throw new Error("not byte mode");
  const len = parseInt(bs.slice(4, 12), 2);
  const out = [];
  for (let i = 0; i < len; i++) out.push(parseInt(bs.slice(12 + i * 8, 20 + i * 8), 2));
  return new TextDecoder().decode(new Uint8Array(out));
}

const samples = [
  "a", "https://webmail.murzaktech.tech/", "https://mail.acme.co.ke/", "HELLO WORLD",
  "https://mail.some-quite-long-company-name.example.co.ke/login?x=1",
  "x".repeat(14), "y".repeat(26), "z".repeat(42), "w".repeat(62), "v".repeat(84), "u".repeat(QR_MAX_BYTES),
  "café ✓",
];
for (const s of samples) {
  let got = null, err = "";
  try { got = decode(encodeQr(s)); } catch (e) { err = e.message; }
  ok(got === s, `round-trips ${JSON.stringify(s.length > 30 ? s.slice(0, 27) + "..." : s)} (${new TextEncoder().encode(s).length} bytes)${err ? " - " + err : ""}`);
}
let threw = false;
try { encodeQr("q".repeat(QR_MAX_BYTES + 1)); } catch { threw = true; }
ok(threw, "refuses text over the capacity");

if (failed) { console.error(`${failed} FAILED`); process.exit(1); }
console.log("ALL GREEN");
