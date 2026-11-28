// shared/giftExtras.js · IMPORT-12 item 4. WHAT THE OLD SYSTEM KNEW ABOUT A
// GIFT SURVIVES THE MOVE.
//
// Every system our prospects run writes more on a gift row than an amount and a
// date: who else is credited (a soft credit), whom it honors (a tribute),
// whether the donor asked not to be named, whether it is one of a monthly
// series, which pledge it pays, and whether it was refunded. Before this the
// one reader set every refund aside (so Steward held more than the file) and
// kept the rest as notes. Here each becomes what Steward already has a home for:
//   · a refund is a negative row against its gift (gifts.refund_of, MONEY-4),
//     so totals net it out exactly as "Record a refund" does;
//   · a soft credit is a gift_soft_credits row, never money (creditTypes.js):
//     it is in nobody's lifetime;
//   · a tribute is the gift's tribute_type and tribute_name;
//   · anonymous is gifts.anonymous;
//   · a pledge payment is a gift on its pledge (pledge_id), the pledge recalculated.
// Pure: no DB, no clock. The reader (sheetRead.js) calls `extrasOf` per gift
// row and `settleRefunds` once; the commit (routes/sheetImport.js) writes them.
"use strict";

const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

// The roles a column may take, by its whole header (the imports rule: matched
// whole, never by substring). Each system's own spelling is here.
export const GIFT_EXTRA_HEADER_ROLES = [
  ["softCredit", ["soft credit", "soft credits", "soft credit name", "soft credit name(s)", "soft credit names", "soft credit contact", "soft credit account number",
    "soft credit to", "soft credited to", "soft credit donor"]],
  ["tributeName", ["honoree", "honoree name", "tribute", "tribute name", "tribute hon./mem. name", "in memory/honor of", "in honor of", "in memory of", "in honor/memory of", "tribute honoree"]],
  ["tributeLast", ["tribute last name", "honoree last name"]],
  ["tributeType", ["tribute type", "tribute dedication", "memory/honor", "honor/memory", "memory honor", "memory_honor"]],
  ["anonymous", ["anonymous", "is anonymous", "anonymous gift", "anonymous type", "make donation anonymous"]],
  ["pledgeLink", ["plink", "pledge id", "pledge transaction number", "pledge number", "parent pledge id"]],
  ["giftLink", ["glink", "parent gift id", "linked gift id", "soft credit of gift"]],
  ["refunded", ["is refunded", "refunded"]],
  ["refundDate", ["refund date"]],
  ["recurring", ["recurring donation", "recurring", "is recurring", "recurring gift", "monthly"]],
];
export const GIFT_EXTRA_ROLE_LABELS = {
  softCredit: "Soft credit (who else is credited)", tributeName: "Tribute: in honor or memory of", tributeLast: "Tribute: the honoree's last name", tributeType: "Tribute type",
  anonymous: "Anonymous gift", pledgeLink: "Pledge this pays", giftLink: "The gift this row credits", refunded: "Refunded (yes or no)",
  refundDate: "Refund date", recurring: "Part of a recurring series",
};
export const GIFT_EXTRA_ROLES = new Set(Object.keys(GIFT_EXTRA_ROLE_LABELS));

const YES = /^(y|yes|true|t|1|x|anonymous|anonymous to public|fully anonymous)$/i;
const NO = /^(n|no|false|f|0|not anonymous|none)$/i;
const yes = v => YES.test(s(v));

// "In Memory Of", "Memorial", "M", "IMO" → memorial; "In Honor Of", "Honor", "H", "IHO" → honor.
export function tributeTypeOf(raw, nameRaw = "") {
  const t = s(raw).toLowerCase(), n = s(nameRaw);
  if (/^(m|imo|memorial|in memory( of)?|memory)$/.test(t) || /^(imo|in memory of)\b/i.test(n)) return "memorial";
  if (/^(h|iho|honor|honour|in honor( of)?|in honour( of)?|honorary)$/.test(t) || /^(iho|in hono(u)?r of)\b/i.test(n)) return "honor";
  return t ? "honor" : (n ? "honor" : null);
}
const tributeNameOf = raw => s(raw).replace(/^(imo|iho|in memory of|in hono(u)?r of)\s+/i, "") || null;

// One gift row's extras, from its cells by role. get(role) → the raw cell.
export function extrasOf(get, has) {
  const out = {};
  if (has("softCredit")) { const v = s(get("softCredit")); if (v) out.softCredit = v.split(/\s*;\s*/).filter(Boolean); }
  const tn = [has("tributeName") ? s(get("tributeName")) : "", has("tributeLast") ? s(get("tributeLast")) : ""].filter(Boolean).join(" ");
  const tt = has("tributeType") ? s(get("tributeType")) : "";
  // DonorPerfect writes the honoree in two cells (GFNAME first, GLNAME last); the reader joins them as one
  if (tn || (tt && !NO.test(tt))) {
    const name = tributeNameOf(tn);
    if (name) out.tribute = { type: tributeTypeOf(tt, tn), name };
  }
  if (has("anonymous") && yes(get("anonymous"))) out.anonymous = true;
  if (has("pledgeLink")) { const v = s(get("pledgeLink")); if (v) out.pledgeLink = v.toLowerCase(); }
  if (has("giftLink")) { const v = s(get("giftLink")); if (v) out.giftLink = v.toLowerCase(); }
  if (has("refunded") && yes(get("refunded"))) out.refunded = { date: has("refundDate") ? s(get("refundDate")) || null : null };
  if (has("recurring")) { const v = s(get("recurring")); if (v && !NO.test(v)) out.recurring = true; }
  return out;
}

// The reader's two calls per row. A soft-credit row (status) is recognition on
// its own person; a gift row carries its extras, and a refund row (or a gift
// marked refunded) becomes a refund candidate. true: the row is used up.
export function softCreditRow({ t, b, pkey, who, cents, get, normalizeDate }) {
  return { sheet: t.sheet, line: b.line, personKey: pkey, who: who.name, cents, date: normalizeDate(get("date")).value || null, giftLink: get("giftLink").toLowerCase() || null };
}
export function takeGiftExtras({ base, isRefund, get, has, refundCands, columnCredits, normalizeDate }) {
  const gx = extrasOf(get, has);
  const at = { sheet: base.sheet, line: base.line, personKey: base.personKey, who: base.who };
  if (isRefund) { refundCands.push({ rowId: "rf:" + base.rowId, ...at, cents: base.cents, date: base.date, ref: s(get("note")) || gx.giftLink || "" }); return true; }
  base.extras = gx;
  if (gx.softCredit) columnCredits.push({ giftRowId: base.rowId, sheet: base.sheet, line: base.line, refs: gx.softCredit });
  if (gx.refunded) refundCands.push({ rowId: "rf:" + base.rowId, of: base.rowId, ...at, cents: -base.cents, date: (gx.refunded.date && normalizeDate(gx.refunded.date).value) || base.date });
  return false;
}

// A row type that is a soft credit, not money: DonorPerfect's record type S
// and Little Green Light's gift type "Soft Credit". Read as status words.
export const SOFT_CREDIT_STATUS = "soft credit";

// REFUNDS NET OUT. A negative row, or a gift marked refunded, is a refund of a
// gift on the same person: the one it names (a refund's own "Refund of …"
// link, or a gift id), else the latest earlier gift of the same amount, else
// the latest earlier gift at least that large. Each gift is refunded at most
// up to its amount. A refund with no gift to stand against is set aside, as
// before: Steward never writes money that left with nothing it came from.
// candidates: [{ personKey, cents (negative), date, sheet, line, who, of: rowId|null, ref: text }]
export function settleRefunds(candidates, gifts) {
  const byPerson = new Map();
  for (const g of gifts) {
    if (g.kind !== "gift" || !(g.cents > 0)) continue;
    if (!byPerson.has(g.personKey)) byPerson.set(g.personKey, []);
    byPerson.get(g.personKey).push(g);
  }
  const byRow = new Map(gifts.map(g => [g.rowId, g]));
  const byExt = new Map(gifts.filter(g => g.externalId).map(g => [String(g.externalId).toLowerCase(), g]));
  const left = new Map(gifts.map(g => [g.rowId, g.cents]));
  const refunds = [], unmatched = [];
  for (const c of candidates) {
    const want = -c.cents;
    let g = c.of ? byRow.get(c.of) : null;
    if (!g && c.ref) { const m = String(c.ref).match(/\b(\d{4,}|[A-Za-z0-9]{15,18})\b/); if (m) g = byExt.get(m[1].toLowerCase()) || null; if (g && g.personKey !== c.personKey) g = null; }
    if (!g) {
      const mine = (byPerson.get(c.personKey) || []).filter(x => (left.get(x.rowId) || 0) >= want && (!c.date || !x.date || x.date <= c.date));
      const later = (a, b) => String(b.date || "").localeCompare(String(a.date || ""));
      g = mine.filter(x => x.cents === want).sort(later)[0] || mine.sort(later)[0] || null;
    }
    if (!g || (left.get(g.rowId) || 0) < want) { unmatched.push(c); continue; }
    left.set(g.rowId, left.get(g.rowId) - want);
    refunds.push({ rowId: c.rowId, sheet: c.sheet, line: c.line, personKey: g.personKey, who: c.who, cents: c.cents, date: c.date || g.date, undated: !(c.date || g.date),
      method: g.method, methodOriginal: g.methodOriginal, fund: g.fund, campaign: g.campaign, externalId: null, note: `Refund of the ${dollars(g.cents)} gift of ${g.date || "no date"}`,
      frequency: "unknown", frequencyOriginal: null, flags: [], kind: "refund", refundOf: g.rowId, full: left.get(g.rowId) === 0 });
  }
  return { refunds, unmatched };
}
const dollars = c => "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// SOFT CREDITS FIND THEIR GIFT AND THEIR PERSON. Two shapes:
//   a column on the gift naming who else is credited (Bloomerang, Neon,
//     Salesforce reports): the name or ID is looked up among the file's people;
//   a row of its own (DonorPerfect S, LGL "Soft Credit"): the row's person is
//     credited for the gift its link names (GLINK, Parent Gift ID), else the
//     gift of the same amount on the same day.
// people: the reader's people map values; returns [{ giftRowId, personKey, cents, how }] and the ones it could not place.
export function settleSoftCredits({ columnCredits, rowCredits }, gifts, people) {
  const byExt = new Map(), byName = new Map();
  // a name as letters and spaces: "Rafferty J. Redfern" is "rafferty j redfern" on both sides
  const nk = v => String(v || "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
  for (const p of people) {
    for (const id of p.ids || [p.externalId].filter(Boolean)) byExt.set(String(id).toLowerCase(), p.key);
    for (const id of p.otherIds || []) byExt.set(String(id).toLowerCase(), p.key);
    if (p.name) { const k = nk(p.name); byName.set(k, byName.has(k) && byName.get(k) !== p.key ? null : p.key); }
    for (const q of p.people || []) if (q && q.name) { const k = nk(q.name); if (!byName.has(k)) byName.set(k, p.key); }
  }
  const giftExt = new Map(gifts.filter(g => g.externalId).map(g => [String(g.externalId).toLowerCase(), g]));
  const out = [], unplaced = [];
  const seen = new Set();
  const add = (g, personKey, how) => {
    const k = `${g.rowId}|${personKey}`;
    if (seen.has(k) || personKey === g.personKey) return;
    seen.add(k); out.push({ giftRowId: g.rowId, personKey, cents: g.cents, how });
  };
  for (const c of columnCredits) {
    const g = gifts.find(x => x.rowId === c.giftRowId);
    for (const ref of c.refs) {
      const pk = byExt.get(ref.toLowerCase()) || byName.get(nk(ref)) || null;
      if (g && pk) add(g, pk, "column"); else unplaced.push({ ...c, ref });
    }
  }
  for (const c of rowCredits) {
    let g = c.giftLink ? giftExt.get(c.giftLink) : null;
    if (!g) g = gifts.find(x => x.kind === "gift" && x.cents === c.cents && x.date === c.date && x.personKey !== c.personKey) || null;
    if (g) add(g, c.personKey, "row"); else unplaced.push(c);
  }
  return { credits: out, unplaced };
}

// Everything above, once every row is read (the reader's one call). What
// cannot be placed is said: a refund with no gift is set aside, a soft-credit
// row with no gift is set aside, a soft-credit name nobody in the file has is
// kept on the gift's note.
export function settleGiftExtras({ refundCands, columnCredits, rowCredits, gifts, pledges, people, aside, fmt$ }) {
  const settled = settleRefunds(refundCands, gifts);
  // IMPORT-13: listed by name, and the server looks for the gift among the org's own (server/imports/knownGifts.js)
  for (const c of settled.unmatched) aside.push({ sheet: c.sheet, line: c.line, who: c.who, cents: c.cents, reason: `a refund with no gift to match (${fmt$(c.cents)})`,
    refundUnmatched: true, personKey: c.personKey, date: c.date || null, rowId: c.rowId, ref: c.ref || "" });
  const soft = settleSoftCredits({ columnCredits, rowCredits }, gifts, people);
  for (const c of soft.unplaced.filter(x => !x.giftRowId)) aside.push({ sheet: c.sheet, line: c.line, who: c.who, cents: 0, reason: `a soft credit (${fmt$(c.cents)}) for a gift this file does not have, so recognition with nothing to stand on` });
  const byRow = new Map(gifts.map(g => [g.rowId, g]));
  for (const c of soft.unplaced.filter(x => x.giftRowId)) {
    const g = byRow.get(c.giftRowId);
    if (g) g.note = [g.note, `Soft credit in your file: ${c.ref} (not found among this file's people)`].filter(Boolean).join(". ");
  }
  const pledgeOf = linkPledgePayments(gifts, pledges);
  for (const g of gifts) if (pledgeOf.has(g.rowId)) g.pledgeOf = pledgeOf.get(g.rowId);
  return { refunds: settled.refunds, soft };
}

// PLEDGE PAYMENTS APPLY TO THEIR PLEDGE. A gift whose pledge link names a
// pledge in the file (its own ID) pays that pledge; the pledge's open balance
// is what is left. Returns giftRowId → pledgeRowId.
export function linkPledgePayments(gifts, pledges) {
  const byExt = new Map(pledges.filter(p => p.externalId).map(p => [String(p.externalId).toLowerCase(), p]));
  const links = new Map();
  for (const g of gifts) {
    if (!g.extras || !g.extras.pledgeLink) continue;
    const p = byExt.get(g.extras.pledgeLink);
    if (p && p.personKey === g.personKey) links.set(g.rowId, p.rowId);
  }
  return links;
}
