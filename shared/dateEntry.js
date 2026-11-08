// shared/dateEntry.js · POLISH-6 (W-1107-Finance-19X). WHAT A TYPED DATE MEANS.
//
// Typing eight digits into the browser's own date box garbled the year
// ("72026"), and Cancel kept the garbled draft. A date is typed as text and
// read here, once: MM/DD/YYYY, M/D/YY (20YY up to ten years ahead, else 19YY),
// eight digits MMDDYYYY, or a pasted ISO YYYY-MM-DD. A day that does not exist
// (Feb 30) or a year outside 1900 to 2100 is not a date. Pure: no clock.
export function parseDateEntry(raw, { pivotYear = null } = {}) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { ok: true, iso: "" };
  let y, m, d;
  let k;
  if ((k = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s))) { y = +k[1]; m = +k[2]; d = +k[3]; }
  else if ((k = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
    m = +k[1]; d = +k[2]; y = +k[3];
    if (k[3].length === 2) { const p = pivotYear != null ? pivotYear : 2036; y = 2000 + y > p ? 1900 + y : 2000 + y; }
  } else if ((k = /^(\d{2})(\d{2})(\d{4})$/.exec(s))) { m = +k[1]; d = +k[2]; y = +k[3]; }
  else return { ok: false, error: "Type a date as MM/DD/YYYY." };
  if (y < 1900 || y > 2100) return { ok: false, error: "That year is not one Steward can use. Type a date as MM/DD/YYYY." };
  if (m < 1 || m > 12) return { ok: false, error: "There is no month " + m + ". Type a date as MM/DD/YYYY." };
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d < 1 || d > last) return { ok: false, error: `That month has no day ${d}. Type a date as MM/DD/YYYY.` };
  const p2 = n => String(n).padStart(2, "0");
  return { ok: true, iso: `${y}-${p2(m)}-${p2(d)}` };
}
// "2026-11-07" → "11/07/2026" (what the box shows for a saved date).
export function showDateEntry(iso) {
  const k = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return k ? `${k[2]}/${k[3]}/${k[1]}` : "";
}
