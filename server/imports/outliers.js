// server/imports/outliers.js · IMPORT-11 item 3. THE IMPORT PREVIEW'S GIFTS FAR OUTSIDE THE PATTERN.
//
// The gift form's rule (shared/numbers/giftOutlier.js), asked of every gift
// row the preview will write: at least 100 times the person's usual gift and
// at least 10 times the largest gift the org has. "The person" is the record
// the row matched (their gifts in Steward) plus the file's own other rows for
// them; "the org's largest" is the largest of Steward's gifts and the file's
// other rows. The preview lists them under their own heading with "import
// them" (the default: nothing is dropped unasked) or "set them aside"
// (answers.outliers = "skip" with answers.outlierRows, which the one reader
// honours by row key, shared/importRowChecks.js). Two reads, set-wise.
"use strict";
const O = require("../../shared/numbers/giftOutlier");
const { MONEY, LIVE } = require("../../shared/numbers/money");

const median = xs => {
  const a = xs.filter(x => x > 0).sort((p, q) => p - q);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

async function importOutliers(query, orgId, u, matches) {
  const gifts = (u.gifts || []).filter(g => g.kind !== "installment" && g.cents > 0);
  if (!gifts.length) return null;
  const [o] = await query(`SELECT ROUND(100 * MAX(g.amount))::bigint AS largest FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                           WHERE g.org_id = ? AND g.amount > 0 AND ${MONEY("g")} AND ${LIVE("d")}`, [orgId]);
  const orgLargest = o && o.largest != null ? Number(o.largest) : 0;
  // the file's two largest, so a row is never measured against itself
  const sorted = gifts.map(g => g.cents).sort((p, q) => q - p);
  const largestBut = c => Math.max(orgLargest, c === sorted[0] ? (sorted[1] || 0) : sorted[0]);
  const candidates = gifts.filter(g => largestBut(g.cents) > 0 && g.cents >= O.ORG_TIMES * largestBut(g.cents));
  if (!candidates.length) return null;
  const idOf = k => { const m = matches && matches.get(k); const x = m && m.members.find(y => y.status === "matched"); return x ? x.id : null; };
  const ids = [...new Set(candidates.map(g => idOf(g.personKey)).filter(Boolean))];
  const held = new Map();
  if (ids.length) {
    const rows = await query(`SELECT g.donor_id, ROUND(100 * g.amount)::bigint AS c FROM gifts g WHERE g.org_id = ? AND g.donor_id = ANY(?) AND g.amount > 0 AND ${MONEY("g")}`, [orgId, ids]);
    for (const r of rows) { if (!held.has(r.donor_id)) held.set(r.donor_id, []); held.get(r.donor_id).push(Number(r.c)); }
  }
  const out = [];
  for (const g of candidates) {
    const own = gifts.filter(x => x.personKey === g.personKey && x !== g).map(x => x.cents);
    const usual = median([...(held.get(idOf(g.personKey)) || []), ...own]);
    const f = O.farOutside({ cents: g.cents, usualCents: usual, largestCents: largestBut(g.cents) });
    if (f) out.push({ key: `${g.sheet}:${g.line}`, sheet: g.sheet, line: g.line, who: g.who, cents: g.cents, sentence: O.sentence(f).replace(/ Record it\?$/, "") });
  }
  if (!out.length) return null;
  return { count: out.length, rows: out, keys: out.map(r => r.key) };
}

module.exports = { importOutliers };
