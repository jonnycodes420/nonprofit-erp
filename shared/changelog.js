// shared/changelog.js — TRUST-2 Part 2. WHAT'S NEW, FROM docs/changelog/*.md.
// Pure: the client bundles the files (import.meta.glob) and the server reads
// them from disk; both parse with this, so the page and the panel agree.
export function parseEntry(raw, file) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const [head, ...rest] = text.split(/\n---\n/);
  if (!rest.length) return null;
  const meta = {};
  for (const line of head.split("\n")) { const m = /^(\w+):\s*(.+)$/.exec(line.trim()); if (m) meta[m[1]] = m[2].trim(); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date || "") || !meta.title) return null;
  const id = String(file || "").split("/").pop().replace(/\.md$/, "");
  return { id, date: meta.date, title: meta.title, product: meta.product || "platform", body: rest.join("\n---\n").trim() };
}
export function entriesFrom(files) {
  return Object.entries(files || {}).filter(([f]) => !/README\.md$/.test(f))
    .map(([f, raw]) => parseEntry(raw, f)).filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
}
export const PRODUCT_WORDS = { crm: "CRM", giving: "Giving", volunteers: "Volunteers", agent: "Agent", security: "Security", platform: "Platform" };
export default { parseEntry, entriesFrom, PRODUCT_WORDS };
