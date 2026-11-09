// client/src/lib/candidateLine.js · POLISH-7 (W-1108-Finance-14X).
// Three "Faye Kovac" buttons with nothing to tell them apart. An ambiguous
// row's choice shows, for each candidate, their email, city and last gift,
// and says plainly when one of them is not on file.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = iso => { const s = String(iso || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}, ${s.slice(0, 4)}` : ""; };
const usd = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export function candidateParts(d = {}) {
  const amt = Number(d.lastAmount ?? d.last_gift_amount) || 0, when = day(d.lastGift ?? d.last_gift_date);
  return [
    d.email ? d.email : "no email",
    d.city ? d.city : "no city",
    when ? `last gift ${amt ? usd(amt) + " on " : ""}${when}` : "no gifts yet",
  ];
}
export const candidateLine = d => candidateParts(d).join(" · ");
