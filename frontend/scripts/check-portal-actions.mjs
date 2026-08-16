#!/usr/bin/env node
/**
 * Guard against orphaned portal actions.
 *
 * Portal.tsx used to be one 3,150-line file holding the shell, the state and
 * every tab body inline. Splitting it into pages/portal/{PortalShell,tabs/*}
 * moved the MODALS into the shell but left the BUTTONS that opened them in the
 * deleted inline bodies. The result: four fully-built modals — delete a
 * service (the Danger Zone), stop a service, scaling settings, and the upgrade
 * prompt — that render correctly, close correctly, and can never be opened.
 * Nothing failed. Typecheck passed, tests passed, the code shipped and
 * deployed, and the feature was simply absent from the product.
 *
 * That class of bug is invisible to a type checker (every symbol is still
 * used — just only ever to close) so this script encodes the missing check:
 *
 *   1. DEAD STATE   — a key returned by usePortalState that no tab or
 *                     component ever reads.
 *   2. DEAD MODAL   — a setter that is only ever called with a "closing"
 *                     argument (null / false / "" / undefined). Something can
 *                     be dismissed but never summoned.
 *
 * Exits non-zero on any finding, so CI fails the way it should have the first
 * time. Add a genuine exception to ALLOWED below with a reason, never by
 * loosening the detection.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const STATE_FILE = join(SRC, "pages", "portal", "usePortalState.tsx");

// Files that define/forward the state rather than consume it. A reference here
// is not evidence that a real UI surface uses the action.
const NON_CONSUMERS = [
  join("pages", "portal", "usePortalState.tsx"),
  join("pages", "portal", "PortalContext.tsx"),
];

/**
 * Deliberate exceptions. Every entry needs a reason — an action parked here is
 * a promise to either wire it up or delete it, not a way to silence the check.
 */
const ALLOWED = {
  // e.g. "setFoo": "opened only by a native event handler the regex can't see",
};

/** Arguments that dismiss rather than summon. */
const CLOSING = /^\s*(null|false|""|''|undefined|\{\s*\}|\[\s*\])\s*$/;

/** Read normalised to LF — the repo carries a mix of CRLF and LF. */
function read(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** The keys usePortalState hands to the rest of the portal. */
function exposedKeys(source) {
  // The final `return { ... };` of the hook, at two-space indentation.
  const block = source.match(/\n {2}return \{\n([\s\S]*?)\n {2}\};/);
  if (!block) {
    console.error("check-portal-actions: could not locate the usePortalState return block.");
    console.error("If the hook was refactored, update this matcher — do not delete the check.");
    process.exit(2);
  }
  return block[1]
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => /^[A-Za-z][A-Za-z0-9]*$/.test(line));
}

/**
 * Every call to `name(...)` in `source`, returned as the raw argument text.
 * Depth-aware so nested parens — setFoo(bar(1)) — yield "bar(1)", not "bar(1".
 */
function callArgs(source, name) {
  const args = [];
  const pattern = new RegExp(`\\b${name}\\(`, "g");
  let match;
  while ((match = pattern.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
    args.push(source.slice(start, i - 1));
  }
  return args;
}

const allFiles = walk(SRC);
// Reachability and consumption are different questions and need different
// corpora. "Is this read by a UI surface?" must exclude the hook that defines
// it and the context that forwards it, or everything trivially passes. "Can
// this ever be opened?" must INCLUDE the hook — plenty of state is opened by a
// wrapper the hook exports (openDeployLog wraps setDeployLogView) or by a
// keyboard handler living in the hook, and those are genuinely reachable.
const consumers = new Map(
  allFiles
    .filter((f) => !NON_CONSUMERS.some((skip) => f.endsWith(skip)))
    .map((f) => [f, read(f)])
);
const everywhere = new Map(allFiles.map((f) => [f, read(f)]));
const keys = exposedKeys(read(STATE_FILE));

const deadState = [];
const deadModals = [];

for (const key of keys) {
  if (key in ALLOWED) continue;

  const word = new RegExp(`\\b${key}\\b`);
  if (![...consumers].some(([, src]) => word.test(src))) {
    deadState.push(key);
    continue;
  }

  // A setter that is never called with anything but a closing value is a
  // surface the user can dismiss but never reach.
  if (!/^set[A-Z]/.test(key)) continue;
  const args = [...everywhere].flatMap(([, src]) => callArgs(src, key));
  if (args.length === 0) continue; // passed around as a prop, not called here
  if (args.every((a) => CLOSING.test(a))) {
    deadModals.push({
      key,
      calls: args.length,
      where: [...everywhere]
        .filter(([, src]) => callArgs(src, key).length > 0)
        .map(([f]) => relative(SRC, f).replace(/\\/g, "/")),
    });
  }
}

let failed = false;

if (deadState.length) {
  failed = true;
  console.error("\nDEAD STATE — returned by usePortalState, read by nothing:\n");
  for (const key of deadState) console.error(`  ${key}`);
  console.error("\n  Wire it to a UI surface, or remove it from the hook's return.");
}

if (deadModals.length) {
  failed = true;
  console.error("\nDEAD MODAL — this can be closed, but nothing ever opens it:\n");
  for (const { key, calls, where } of deadModals) {
    console.error(`  ${key}  (${calls} call${calls === 1 ? "" : "s"}, all closing)`);
    for (const w of where) console.error(`      ${w}`);
  }
  console.error("\n  Add the trigger that opens it, or delete the surface it guards.");
}

if (failed) {
  console.error(`\n${deadState.length + deadModals.length} orphaned portal action(s).\n`);
  process.exit(1);
}

console.log(`check-portal-actions: ${keys.length} portal actions, all reachable.`);
