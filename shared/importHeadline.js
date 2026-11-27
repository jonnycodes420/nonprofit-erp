// shared/importHeadline.js · NUMBERS-10 item 6 (W-1127-Finance-02). THE IMPORT'S HEADLINE FOOTS THE FILE.
//
// "A director footing the file to the import still gets a different total without the scheduled-gift
// explanation in the headline." The receipt's footing line (server/imports/footing.js) said "imported
// + scheduled + set aside", but the headline she reads first said only "Imported 749 gifts ($206,375)":
// no rows, nothing set aside, and no word that some of those gifts are dated after today and count on
// their dates. One sentence now, on the preview and on the receipt, from the same rows:
//
//   "1,000 rows: 749 gifts $206,375 in (12 of them scheduled gifts, $13,050, that count on their
//    dates), 251 set aside ($62,050)."
//
// rows  = gifts + already here + pledges + set aside             (every row of the gift sheets)
// cents = gifts + already here + pledges + set aside, to the cent (the file's money)
// A scheduled gift is one of the gifts (it is on file), so it is said inside the gifts, never added.
// Pure, the same in the browser and on the server.

const usd = c => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const n = (k, one, many) => `${Number(k).toLocaleString("en-US")} ${k === 1 ? one : many}`;

export function importHeadline({ gifts = 0, giftCents = 0, scheduled = 0, scheduledCents = 0, pledges = 0, pledgeCents = 0,
  already = 0, alreadyCents = 0, aside = 0, asideCents = 0, done = false } = {}) {
  const rows = gifts + already + pledges + aside;
  const cents = giftCents + alreadyCents + pledgeCents + asideCents;
  if (!rows) return null;
  const parts = [];
  const verb = done ? "in" : "to bring in";
  if (gifts || !pledges) parts.push(`${n(gifts, "gift", "gifts")} ${usd(giftCents)} ${verb}`
    + (scheduled ? ` (${scheduled === gifts ? (scheduled === 1 ? "it is a scheduled gift" : `all ${scheduled.toLocaleString("en-US")} are scheduled gifts`) : `${scheduled.toLocaleString("en-US")} of them ${scheduled === 1 ? "a scheduled gift" : "scheduled gifts"}`}, ${usd(scheduledCents)}, that ${scheduled === 1 ? "counts on its date" : "count on their dates"})` : ""));
  if (pledges) parts.push(`${n(pledges, "pledge", "pledges")} ${usd(pledgeCents)} promised`);
  if (already) parts.push(`${already.toLocaleString("en-US")} already here (${usd(alreadyCents)})`);
  parts.push(`${aside.toLocaleString("en-US")} set aside${asideCents ? ` (${usd(asideCents)})` : ""}`);
  return { rows, cents, gifts, giftCents, scheduled, scheduledCents, pledges, pledgeCents, already, alreadyCents, aside, asideCents,
    sentence: `${n(rows, "row", "rows")}: ${parts.join(", ")}.` };
}

// The preview's figures, from what the reader decided (`u` of shared/sheetRead.js understand()).
// A first payment on a pledge rides on its pledge's row, so it is in the pledge, not a gift row.
export function previewHeadline(u) {
  if (!u) return null;
  const giftRows = (u.gifts || []).filter(g => g.kind !== "installment");
  const fut = new Set((((u.rowChecks || {}).future || {}).rows || []).map(r => `${r.sheet}:${r.line}`));
  const sched = giftRows.filter(g => fut.has(`${g.sheet}:${g.line}`));
  return importHeadline({
    gifts: giftRows.length, giftCents: giftRows.reduce((a, g) => a + (g.cents || 0), 0),
    scheduled: sched.length, scheduledCents: sched.reduce((a, g) => a + (g.cents || 0), 0),
    pledges: (u.pledges || []).length, pledgeCents: (u.pledges || []).reduce((a, p) => a + (p.pledgeCents || 0), 0),
    aside: (u.aside || []).length, asideCents: (u.aside || []).reduce((a, x) => a + (x.cents || 0), 0),
  });
}
