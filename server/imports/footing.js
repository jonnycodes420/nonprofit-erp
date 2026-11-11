// server/imports/footing.js · MONEY-4 (W-1109-Finance-15, W-1109-Atlas-13X). AN IMPORT FOOTS IN ROWS AND DOLLARS.
//
// A 1,000-row import read "690 written + 310 set aside", which balances on
// rows, but $186,275 imported against the file's $268,425 with no dollar
// footing anywhere. And the Imports list flagged test-donors.csv "Does not
// reconcile" while its receipt's own line said ✓: the list read the stored
// columns, the receipt read the sheet ledger, two computations.
//
// One footing now, read by both: the receipt's line and the list's flag are
// this function's `balanced`, so they can never disagree.
//   rows:    file = written (gifts + pledges) + set aside + errored
//   dollars: file = imported + set aside + errored, the set-aside dollars by
//            reason: "File $268,425 = imported $186,275 + set aside $82,150
//            (future-dated $19,225; matches deleted people $62,925)"
//   and the stored columns against the summary's own copy of them.
// Pure: a stored imports row and its summary in, the footing out.
"use strict";
const money = require("../../money");

// The words for why a row was set aside, short, in the receipt's order.
const REASONS = [
  ["future", "future-dated", /after today|future/i],
  ["deleted", "matches deleted people", /someone you deleted/i],
  ["here", "already here", /already here|duplicate|same gift listed twice/i],
  ["refund", "refunds and money paid out", /refund|reversal|paid out/i],
  ["zero", "$0 or no amount", /\$0|no amount|not a number|zero/i],
  ["noname", "no name or email", /no name|no email|no organization/i],
  ["client", "marked as a client", /client/i],
  ["left", "left out by you", /left it out/i],
];
const reasonKey = text => (REASONS.find(([, , re]) => re.test(String(text || ""))) || ["other"])[0];
const LABEL = Object.fromEntries([...REASONS.map(([k, l]) => [k, l]), ["other", "other reasons"]]);

// The set-aside dollars by reason, in cents: the summary's own tally when it
// has one (written by the import, every row), else its list of set-aside rows.
function asideByReason(s) {
  if (s.asideByReason && typeof s.asideByReason === "object") return { ...s.asideByReason };
  const by = {};
  for (const a of Array.isArray(s.aside) ? s.aside : []) { const k = reasonKey(a.reason); by[k] = (by[k] || 0) + (Number(a.cents) || 0); }
  const dupC = Math.round((Number(s.duplicateDollars) || 0) * 100);
  if (dupC) by.here = (by.here || 0) + dupC;
  return by;
}

const usd = c => money.formatCents(c).replace(/\.00$/, "");

function importFooting(row, summary) {
  const n = v => Number(v) || 0;
  const c = v => money.toCents(v) ?? 0;
  const s = summary && typeof summary === "object" ? summary : {};
  const sc = s.counts && typeof s.counts === "object" && row.shape === "sheet" ? s.counts : {};
  // Rows (FIX-52: a pledge is a row the file brought in, as much as a gift is).
  const rowsIn = n(row.rows_in), created = n(row.gifts_created), pledges = n(s.pledgesCreated ?? sc.pledgesCreated),
        aside = n(row.rows_set_aside), errored = n(row.rows_errored);
  const rows = { file: rowsIn, written: created + pledges, gifts: created, pledges, aside, errored, balanced: rowsIn === created + pledges + aside + errored };
  // Dollars.
  const inC = c(row.dollars_in), madeC = c(row.dollars_created),
        pledgeC = s.pledgeDollarsCreated != null ? c(s.pledgeDollarsCreated) : sc.pledgeCents != null ? n(sc.pledgeCents) : 0,
        asideC = c(s.dollarsSetAside), errC = c(s.dollarsErrored);
  const importedC = madeC + pledgeC;
  const by = asideByReason(s);
  const parts = Object.entries(by).filter(([, v]) => v > 0);
  const named = parts.reduce((t, [, v]) => t + v, 0);
  if (asideC > named) parts.push(["other", asideC - named]);   // what the tally does not name is still said
  const order = k => { const i = REASONS.findIndex(([x]) => x === k); return i < 0 ? 99 : i; };
  parts.sort((a, b) => order(a[0]) - order(b[0]));
  // TRUTH-6: of what was imported, the part stored as scheduled (dated after the
  // day it ran), said on its own: "imported $250,700 + scheduled $17,725".
  const schedC = Math.min(n(s.scheduledCents), importedC);
  const dollars = { fileCents: inC, importedCents: importedC, giftCents: madeC, pledgeCents: pledgeC, asideCents: asideC, erroredCents: errC,
    scheduledCents: schedC, importedNowCents: importedC - schedC,
    asideBy: parts.map(([k, v]) => ({ key: k, label: LABEL[k] || k, cents: v })), balanced: inC === importedC + asideC + errC };
  // The stored columns against the summary's own copy of the same figures.
  const stored = [];
  for (const [k, v] of [["rowsIn", rowsIn], ["giftsCreated", created], ["donorsCreated", n(row.donors_created)], ["rowsSetAside", aside], ["rowsErrored", errored]]) {
    if (s[k] != null && Number(s[k]) !== v) stored.push(`Stored ${k} is ${v} but the receipt shows ${Number(s[k])}.`);
  }
  if (s.dollarsIn != null && c(s.dollarsIn) !== inC) stored.push(`Stored dollars in is ${money.formatCents(inC)} but the receipt shows ${money.formatCents(c(s.dollarsIn))}.`);
  if (s.dollarsCreated != null && c(s.dollarsCreated) !== madeC) stored.push(`Stored dollars created is ${money.formatCents(madeC)} but the receipt shows ${money.formatCents(c(s.dollarsCreated))}.`);
  const balanced = rows.balanced && dollars.balanced && stored.length === 0;
  const mark = balanced ? "✓" : "✗";
  const rowsSentence = `${rowsIn.toLocaleString("en-US")} rows in the file = ${(created + pledges).toLocaleString("en-US")} written`
    + ` + ${aside.toLocaleString("en-US")} set aside${errored ? ` + ${errored.toLocaleString("en-US")} errored` : ""} ${rows.balanced ? "✓" : "✗"}`;
  const dollarsSentence = `File ${usd(inC)} = imported ${usd(importedC - schedC)}${schedC ? ` + scheduled ${usd(schedC)}` : ""} + set aside ${usd(asideC)}`
    + (dollars.asideBy.length ? ` (${dollars.asideBy.map(p => `${p.label} ${usd(p.cents)}`).join("; ")})` : "")
    + (errC ? ` + errored ${usd(errC)}` : "") + ` ${dollars.balanced ? "✓" : "✗"}`;
  return { rows, dollars, stored, balanced, mark, rowsSentence, dollarsSentence };
}

// The findings the receipt lists, from the same footing (so none = reconciled).
function footingFindings(f) {
  const out = [];
  const r = f.rows, d = f.dollars;
  if (!r.balanced) out.push(`Rows do not reconcile: ${r.file} in the file, ${r.gifts} gifts${r.pledges ? ` + ${r.pledges} pledges` : ""} created + ${r.aside} set aside + ${r.errored} errored = ${r.gifts + r.pledges + r.aside + r.errored}.`);
  if (!d.balanced) out.push(`Dollars do not reconcile: ${money.formatCents(d.fileCents)} in the file, ${money.formatCents(d.giftCents)} in gifts${d.pledgeCents ? ` + ${money.formatCents(d.pledgeCents)} in pledges` : ""} created + ${money.formatCents(d.asideCents)} set aside + ${money.formatCents(d.erroredCents)} errored = ${money.formatCents(d.importedCents + d.asideCents + d.erroredCents)}.`);
  return out.concat(f.stored);
}

module.exports = { importFooting, footingFindings, reasonKey, asideByReason };
