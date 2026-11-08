// shared/giftOrder.js · POLISH-6 (W-1107-Finance-02X). The one gift order, in the browser (the SQL
// lists say it as "date DESC NULLS LAST, created_at DESC NULLS LAST, id DESC"):
// a gift list is newest first by date, then by when it was entered.
export function compareGifts(a, b) {
  const d = String(b.date || "").slice(0, 10).localeCompare(String(a.date || "").slice(0, 10));
  if (d) return d;
  if (!a.date !== !b.date) return a.date ? -1 : 1;
  const c = String(b.created_at || "").localeCompare(String(a.created_at || ""));
  return c || String(b.id || "").localeCompare(String(a.id || ""));
}
