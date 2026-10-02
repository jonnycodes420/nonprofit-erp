// shared/lostAndFound.js — LOST & FOUND. THE FREE DONOR AUDIT.
//
// A consultant charges $500 to $2,000 to tell a nonprofit which donors are
// slipping away. This is the arithmetic behind a better version, given away.
//
// ── THE RULE THAT SHAPES EVERY LINE OF THIS FILE ─────────────────────────
// THE DONOR FILE NEVER LEAVES THE COMPUTER. This module is PURE and runs in
// a Web Worker in the visitor's own browser: no fetch, no XMLHttpRequest, no
// import of anything that has one, no clock, no DOM. It takes rows and
// returns an audit. Everything a page could accidentally send starts here,
// so the guarantee is enforceable by reading one file.
//
// The only things that ever reach a server are (a) the three fields on the
// PDF form — name, email, organisation — which the visitor typed themselves,
// and (b) the opt-in benchmark, which is four aggregate numbers. Neither is
// produced here; `benchmarkPayload` below builds the second one and is the
// ONE function allowed to shape anything destined for a server, which is why
// it is written to be read at a glance.
//
// ── WHAT AN AUDIT IS ─────────────────────────────────────────────────────
// Five questions a development director cannot answer from a spreadsheet
// without a day of pivot tables:
//   1. who has gone quiet          gave in an earlier year, not this one
//   2. who is drifting             giving down 40% or more year on year
//   3. recurring gifts that stopped
//   4. the top 25 at risk, by dollars
//   5. the retention rate, and the dollars at risk
//
// Every number carries the sentence that defines it and the rows behind it,
// because this is the same product rule the rest of Steward keeps and
// because an audit whose numbers cannot be opened is an audit nobody acts
// on.

import { normalizeDate, normalizeMoney, normalizeName, normalizeEmail } from "./importShape.js";

// ── THE THRESHOLDS, AND WHY THEY ARE THESE ───────────────────────────────
// DRIFT_DROP 40%: the figure fundraising literature uses for a "significant
// decrease" donor, and the point at which a human would ring somebody. Lower
// and the list is everybody who rounded down; higher and it only catches
// people who have already left.
export const DRIFT_DROP = 0.40;
// A recurring gift is STOPPED when three of its own intervals have passed
// with nothing. Three rather than one, because a monthly donor whose card
// failed in the last four weeks is a dunning problem, not a lapse.
export const STOPPED_INTERVALS = 3;
export const TOP_AT_RISK = 25;

// ── READING A FILE THAT NOBODY TIDIED ────────────────────────────────────
// A real export has the donor's name in one column or two, the amount with a
// dollar sign and a comma, and the date in whichever order that country
// writes it. `importShape` already solves all three for Steward's own
// import; this reuses it rather than growing a second, worse copy.
const CANDIDATES = {
  email:     ["email", "email address", "e-mail", "donor email", "primary email"],
  name:      ["name", "donor name", "full name", "donor", "constituent", "account name", "display name"],
  firstName: ["first name", "firstname", "first", "given name"],
  lastName:  ["last name", "lastname", "last", "surname", "family name"],
  amount:    ["amount", "gift amount", "donation amount", "total", "gift", "value", "paid amount", "transaction amount"],
  date:      ["date", "gift date", "donation date", "transaction date", "close date", "received date", "payment date"],
  recurring: ["recurring", "is recurring", "frequency", "gift type", "type", "schedule", "recurrence"],
};
const norm = h => String(h || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");

export function mapColumns(headers = []) {
  const byNorm = new Map(headers.map(h => [norm(h), h]));
  const out = {};
  for (const [field, cands] of Object.entries(CANDIDATES)) {
    out[field] = cands.map(c => byNorm.get(c)).find(Boolean) || null;
  }
  // A file with first and last but no single name column is the common case
  // and must not read as "no names".
  if (!out.name && (out.firstName || out.lastName)) out.name = null;
  return out;
}

// What the file is missing, said before anything is computed. An audit built
// on a file with no dates is an audit about nothing, and saying so is worth
// more than a page of zeroes.
export function fileReadiness(map) {
  const missing = [];
  if (!map.amount) missing.push({ field: "amount", message: "No column looks like a gift amount." });
  if (!map.date) missing.push({ field: "date", message: "No column looks like a gift date." });
  if (!map.name && !map.firstName && !map.lastName && !map.email)
    missing.push({ field: "who", message: "No column looks like a donor's name or email." });
  return {
    ok: missing.length === 0, missing,
    sentence: missing.length
      ? `This file is missing something the audit needs: ${missing.map(m => m.message).join(" ")}`
      : "Steward found the donor, the amount and the date. Running the audit.",
  };
}

// ── ONE GIFT, FROM ONE ROW ───────────────────────────────────────────────
// `dateConvention` and `amountConvention` come from the file as a whole
// (importShape infers both), so 03/04 is the same month in every row rather
// than guessed row by row.
export function giftFromRow(row, map, opts = {}) {
  const get = col => (col ? row[col] : undefined);
  const amount = normalizeMoney(get(map.amount), { convention: opts.amountConvention });
  if (amount === null || amount === undefined || !Number.isFinite(amount.value) || amount.value <= 0) return null;
  // `normalizeDate` and `normalizeEmail` return `{ value, warn }`, not the
  // bare value. Reading `.iso` compiled fine and silently produced an audit
  // of zero gifts on a perfectly good file — the first thing this module
  // got wrong, and the reason the harness below feeds a real fixture rather
  // than trusting that the parse worked.
  const date = normalizeDate(get(map.date), { convention: opts.dateConvention });
  const iso = date && date.value ? String(date.value).slice(0, 10) : null;
  if (!iso) return null;

  const em = normalizeEmail(get(map.email));
  const email = (em && em.value) || null;
  const nameRaw = map.name ? get(map.name)
    : [get(map.firstName), get(map.lastName)].filter(Boolean).join(" ");
  const name = normalizeName(nameRaw) || null;
  if (!name && !email) return null;

  const recurringRaw = String(get(map.recurring) ?? "").trim().toLowerCase();
  const recurring = /recurring|monthly|quarterly|annual|sustainer|pledge|subscription|yes|true/.test(recurringRaw)
    ? (/quarter/.test(recurringRaw) ? "quarterly" : /annual|year/.test(recurringRaw) ? "annual" : "monthly")
    : null;

  return { name, email, cents: Math.round(amount.value * 100), date: iso, year: Number(iso.slice(0, 4)), recurring };
}

// ── ONE DONOR, FROM MANY GIFTS ───────────────────────────────────────────
// Matched on EMAIL where there is one, on the normalised name where there is
// not. Never on both at once with a merge, because merging two people who
// share a name is the one mistake a free audit must not make: it would tell
// somebody a donor is fine when two different people gave.
export function groupDonors(gifts) {
  const by = new Map();
  for (const g of gifts) {
    const key = g.email ? "e:" + g.email : "n:" + String(g.name || "").toLowerCase();
    if (!by.has(key)) by.set(key, { key, name: g.name, email: g.email, gifts: [], byYear: new Map(), recurring: null });
    const d = by.get(key);
    if (!d.name && g.name) d.name = g.name;
    if (!d.email && g.email) d.email = g.email;
    if (g.recurring && !d.recurring) d.recurring = g.recurring;
    d.gifts.push(g);
    d.byYear.set(g.year, (d.byYear.get(g.year) || 0) + g.cents);
  }
  for (const d of by.values()) {
    d.gifts.sort((a, b) => a.date.localeCompare(b.date));
    d.first = d.gifts[0];
    d.last = d.gifts[d.gifts.length - 1];
    d.lifetimeCents = d.gifts.reduce((a, g) => a + g.cents, 0);
  }
  return [...by.values()];
}

// ── THE AUDIT ────────────────────────────────────────────────────────────
// `today` is PASSED IN. This module has no clock: a pure function that reads
// the wall clock is a function whose answer changes under a test, and the
// retention figures are all relative to "this year".
export function audit(gifts, { today }) {
  const thisYear = Number(String(today).slice(0, 4));
  const lastYear = thisYear - 1;
  const donors = groupDonors(gifts);

  const gaveLastYear = donors.filter(d => (d.byYear.get(lastYear) || 0) > 0);
  const gaveThisYear = donors.filter(d => (d.byYear.get(thisYear) || 0) > 0);
  const gaveLastNotThis = gaveLastYear.filter(d => !(d.byYear.get(thisYear) > 0));

  // QUIET: gave in SOME earlier year and not this one. A superset of the
  // lapsed-last-year list, and the two are reported separately because they
  // are two different conversations.
  const quiet = donors.filter(d =>
    !(d.byYear.get(thisYear) > 0) && [...d.byYear.keys()].some(y => y < thisYear));

  // DRIFTING: gave in both years, and this year is 40% or more down. Only
  // people who ARE still giving can drift; somebody who stopped is quiet,
  // not drifting, and counting them in both is how a free audit inflates
  // its own headline.
  const drifting = [];
  for (const d of donors) {
    const now = d.byYear.get(thisYear) || 0, before = d.byYear.get(lastYear) || 0;
    if (!(now > 0 && before > 0)) continue;
    const drop = (before - now) / before;
    if (drop >= DRIFT_DROP) drifting.push({ ...d, dropPct: Math.round(drop * 100), fromCents: before, toCents: now });
  }
  drifting.sort((a, b) => (b.fromCents - b.toCents) - (a.fromCents - a.toCents));

  // RECURRING GIFTS THAT STOPPED. The donor's own interval, three of them
  // elapsed with nothing since.
  const intervalDays = { monthly: 31, quarterly: 92, annual: 366 };
  const stopped = [];
  for (const d of donors) {
    if (!d.recurring) continue;
    const gap = daysBetween(d.last.date, today);
    const need = (intervalDays[d.recurring] || 31) * STOPPED_INTERVALS;
    if (gap !== null && gap > need) {
      stopped.push({ ...d, sinceDays: gap, cadence: d.recurring,
        monthlyCents: Math.round(d.lifetimeCents / Math.max(1, d.gifts.length)) });
    }
  }
  stopped.sort((a, b) => b.monthlyCents - a.monthlyCents);

  // AT RISK, BY DOLLARS. Quiet and drifting together, ranked by what is
  // actually at stake: for somebody quiet that is what they last gave in a
  // year; for somebody drifting it is the size of the drop.
  const atRisk = [
    ...quiet.map(d => ({ ...d, why: "quiet", atRiskCents: bestYearCents(d) })),
    ...drifting.map(d => ({ ...d, why: "drifting", atRiskCents: d.fromCents - d.toCents })),
  ].sort((a, b) => b.atRiskCents - a.atRiskCents);
  const dollarsAtRiskCents = atRisk.reduce((a, d) => a + d.atRiskCents, 0);

  // RETENTION, the standard definition: of the donors who gave last year,
  // what share gave again this year. Said with its denominator, because a
  // retention rate without one is a number anybody can move.
  const retained = gaveLastYear.filter(d => d.byYear.get(thisYear) > 0).length;
  const retentionRate = gaveLastYear.length ? retained / gaveLastYear.length : null;

  const lastYearLostCents = gaveLastNotThis.reduce((a, d) => a + (d.byYear.get(lastYear) || 0), 0);

  return {
    today, thisYear, lastYear,
    totals: {
      donors: donors.length, gifts: gifts.length,
      lifetimeCents: donors.reduce((a, d) => a + d.lifetimeCents, 0),
      firstGiftDate: gifts.length ? gifts.reduce((m, g) => (g.date < m ? g.date : m), gifts[0].date) : null,
      lastGiftDate: gifts.length ? gifts.reduce((m, g) => (g.date > m ? g.date : m), gifts[0].date) : null,
    },
    sections: [
      { key: "lapsed", label: "Gave last year, not this year",
        count: gaveLastNotThis.length, cents: lastYearLostCents,
        sentence: gaveLastNotThis.length
          ? `${gaveLastNotThis.length} ${gaveLastNotThis.length === 1 ? "donor who gave" : "donors who gave"} ${money(lastYearLostCents)} last year have not given this year.`
          : `Everybody who gave in ${lastYear} has given again in ${thisYear}.`,
        definition: `Donors with at least one gift dated in ${lastYear} and none dated in ${thisYear}.`,
        rows: gaveLastNotThis.map(d => row(d, { cents: d.byYear.get(lastYear) || 0, note: `gave ${money(d.byYear.get(lastYear) || 0)} in ${lastYear}` })) },
      { key: "quiet", label: "Gone quiet",
        count: quiet.length, cents: quiet.reduce((a, d) => a + bestYearCents(d), 0),
        sentence: quiet.length
          ? `${quiet.length} ${quiet.length === 1 ? "donor has" : "donors have"} given in some year and not in ${thisYear}. Their best year was worth ${money(quiet.reduce((a, d) => a + bestYearCents(d), 0))}.`
          : `Nobody on this file has gone quiet.`,
        definition: `Donors with at least one gift in any year before ${thisYear}, and none in ${thisYear}. A superset of the list above.`,
        rows: quiet.map(d => row(d, { cents: bestYearCents(d), note: `last gave ${d.last.date}` })) },
      { key: "drifting", label: "Giving down 40% or more",
        count: drifting.length, cents: drifting.reduce((a, d) => a + (d.fromCents - d.toCents), 0),
        sentence: drifting.length
          ? `${drifting.length} ${drifting.length === 1 ? "donor is" : "donors are"} still giving, and giving at least ${DRIFT_DROP * 100}% less than last year. Between them that is ${money(drifting.reduce((a, d) => a + (d.fromCents - d.toCents), 0))} less.`
          : "Nobody who is still giving has dropped by 40% or more.",
        definition: `Donors who gave in both ${lastYear} and ${thisYear}, where ${thisYear} is at least ${DRIFT_DROP * 100}% below ${lastYear}. Somebody who stopped entirely is counted as quiet, not as drifting.`,
        rows: drifting.map(d => row(d, { cents: d.fromCents - d.toCents, note: `${money(d.fromCents)} to ${money(d.toCents)}, down ${d.dropPct}%` })) },
      { key: "stopped", label: "Recurring gifts that stopped",
        count: stopped.length, cents: stopped.reduce((a, d) => a + d.monthlyCents, 0),
        sentence: stopped.length
          ? `${stopped.length} recurring ${stopped.length === 1 ? "donor has" : "donors have"} stopped, `
            + `worth ${money(stopped.reduce((a, d) => a + d.monthlyCents, 0))} between them every time they used to give.`
          : "No recurring gift on this file has stopped.",
        definition: `Donors whose file marks them recurring and whose last gift is more than ${STOPPED_INTERVALS} of their own intervals ago. Three intervals rather than one, because a card that failed last month is a card problem, not a lapse.`,
        rows: stopped.map(d => row(d, { cents: d.monthlyCents, note: `${d.cadence}, nothing for ${d.sinceDays} days` })) },
      { key: "atRisk", label: `Top ${TOP_AT_RISK} at risk, by dollars`,
        count: Math.min(TOP_AT_RISK, atRisk.length), cents: atRisk.slice(0, TOP_AT_RISK).reduce((a, d) => a + d.atRiskCents, 0),
        sentence: atRisk.length
          ? `The ${Math.min(TOP_AT_RISK, atRisk.length)} people with the most at stake account for ${money(atRisk.slice(0, TOP_AT_RISK).reduce((a, d) => a + d.atRiskCents, 0))} of the ${money(dollarsAtRiskCents)} at risk.`
          : "Nothing is at risk on this file.",
        definition: "Everybody quiet or drifting, ranked by what is at stake: the best year of somebody quiet, or the size of the drop for somebody drifting.",
        rows: atRisk.slice(0, TOP_AT_RISK).map(d => row(d, { cents: d.atRiskCents, note: d.why === "quiet" ? `quiet since ${d.last.date}` : `down ${d.dropPct}%` })) },
    ],
    headline: {
      dollarsAtRiskCents,
      dollarsAtRisk: money(dollarsAtRiskCents),
      retentionRate,
      retentionPct: retentionRate === null ? null : Math.round(retentionRate * 100),
      retentionSentence: retentionRate === null
        ? `Nobody on this file gave in ${lastYear}, so there is no retention rate to work out.`
        : `${Math.round(retentionRate * 100)}% of the ${gaveLastYear.length} ${gaveLastYear.length === 1 ? "donor" : "donors"} who gave in ${lastYear} gave again in ${thisYear}.`,
      atRiskSentence: `${money(dollarsAtRiskCents)} is at risk: what quiet donors used to give, plus what drifting donors have stopped giving.`,
      thisYearCount: gaveThisYear.length,
    },
  };
}

// One row, in the shape every section's list uses. The donor's name and
// email are IN IT, because the whole audit is for the person who owns the
// file — and they never leave the browser.
function row(d, { cents, note }) {
  return { name: d.name || d.email, email: d.email || null, cents, amount: money(cents),
           lifetimeCents: d.lifetimeCents, lastGift: d.last.date, gifts: d.gifts.length, note };
}
function bestYearCents(d) { return Math.max(0, ...[...d.byYear.values()]); }
function daysBetween(a, b) {
  const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const x = p(a), y = p(b);
  return x === null || y === null ? null : Math.round((y - x) / 86400000);
}
export function money(cents) {
  const n = Math.round(Number(cents || 0)) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// ── THE ONLY THING THAT MAY BE SENT ──────────────────────────────────────
// Four aggregate numbers, opt-in, for a benchmark nobody's donors appear in.
// Written as an EXPLICIT object literal with four named keys — never a spread
// of the audit, never a filter over it — so what leaves is provable by
// reading eight lines rather than by trusting a blocklist. A band rather than
// a count, because "1,284 donors" plus a city is a fingerprint and "1,000 to
// 5,000" is not.
export const DONOR_BANDS = [
  { max: 250, label: "under 250" }, { max: 1000, label: "250 to 1,000" },
  { max: 5000, label: "1,000 to 5,000" }, { max: 25000, label: "5,000 to 25,000" },
  { max: Infinity, label: "more than 25,000" },
];
export function donorBand(n) {
  return (DONOR_BANDS.find(b => Number(n) <= b.max) || DONOR_BANDS[DONOR_BANDS.length - 1]).label;
}
export function benchmarkPayload(a) {
  const donors = a.totals.donors || 0;
  const quiet = (a.sections.find(s => s.key === "quiet") || { count: 0 }).count;
  const drifting = (a.sections.find(s => s.key === "drifting") || { count: 0 }).count;
  return {
    donorBand: donorBand(donors),
    retentionPct: a.headline.retentionPct,
    shareLapsedPct: donors ? Math.round((quiet / donors) * 100) : null,
    shareDriftingPct: donors ? Math.round((drifting / donors) * 100) : null,
  };
}

// The words at the end of every report. Fixed here so the screen and the PDF
// cannot say it differently.
export const REPORT_FOOTER =
  "This report was generated by Lost & Found, a free tool from Steward. We think every nonprofit "
  + "should have this. Want it running automatically, every week, with next steps attached? That's Steward.";
export const PRIVACY_LINE = "Your donor file never leaves your browser. Nothing is uploaded.";
