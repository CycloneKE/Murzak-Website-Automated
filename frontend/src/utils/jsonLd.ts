/**
 * JSON-stringifies a JSON-LD object for embedding in a
 * `<script type="application/ld+json">` tag. Escapes `<` so a value that
 * happens to contain a literal `</script>` sequence can't break out of the
 * tag early — the same defense Breadcrumbs.tsx established first.
 */
export function toSafeJsonLdString(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}
