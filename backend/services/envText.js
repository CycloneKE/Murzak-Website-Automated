/**
 * Parse pasted `.env` text (the portal's "Developer view") into variable rows.
 * Skips blanks and # comments, accepts a leading `export`, strips one layer of
 * matching quotes. Returns `{ rows, errors }` — never throws, never logs values.
 */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseEnvText(text) {
  const rows = [];
  const errors = [];
  String(text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    const key = (eq === -1 ? line : line.slice(0, eq)).replace(/^export\s+/, "").trim();
    if (eq === -1 || !ENV_KEY_RE.test(key)) {
      errors.push(`Line ${i + 1}: expected NAME=value.`);
      return;
    }
    let value = line.slice(eq + 1);
    const q = value[0];
    if ((q === '"' || q === "'") && value.length > 1 && value.endsWith(q)) value = value.slice(1, -1);
    rows.push({ key, value });
  });
  return { rows, errors };
}

module.exports = { parseEnvText, ENV_KEY_RE };
