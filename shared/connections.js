// shared/connections.js — INT-1. ONE PLACE THAT SAYS WHETHER THE MONEY IS
// STILL ARRIVING.
//
// An organisation's money comes in through four or five doors at once: their
// own Stripe, PayPal, Givebutter, Zeffy, a register, and a statement somebody
// drops in once a month. Steward could already read most of them. What it
// could not do was answer the question somebody asks at 7:40 in the morning:
//
//     "Is everything still connected, and does the money match?"
//
// That question has three parts, and this file holds the judgement for all
// three so one computation answers it everywhere:
//
//   1. IS IT HEALTHY. Four states, and "quiet" is the one that matters. A
//      connection that is broken says so loudly; a connection that has simply
//      stopped sending anything looks exactly like a quiet fortnight, and the
//      difference is the connection's OWN rhythm, not a fixed number of days.
//   2. WHAT CAME IN. Gifts and dollars over the last thirty days, from the
//      gift rows themselves — never a counter kept beside them.
//   3. DOES IT MATCH. Payouts against the gifts inside them, to the cent.
//
// Pure: no DB, no network, no clock (today is always a parameter), no JSX.

// ── THE FOUR STATES ────────────────────────────────────────────────────────
// Each one carries the sentence that DEFINES it, because "quiet" on a screen
// with no definition is a word somebody has to guess at.
export const STATUSES = {
  healthy: {
    key: "healthy", label: "Healthy",
    definition: "It checked in recently and money is arriving at about its usual rhythm.",
  },
  quiet: {
    key: "quiet", label: "Quiet",
    definition: "The connection works, but nothing has come through it for longer than it usually goes. That is either a slow fortnight or a door that has closed, and it is worth ten seconds to tell which.",
  },
  broken: {
    key: "broken", label: "Broken",
    definition: "The last check failed. Nothing is arriving through it until somebody reconnects it.",
  },
  not_connected: {
    key: "not_connected", label: "Not connected",
    definition: "Steward is not reading this one. Money taken through it is not in these figures.",
  },
};
export const STATUS_KEYS = Object.keys(STATUSES);

// The order the cards are read in: what is wrong first, what is missing last.
export const STATUS_RANK = { broken: 0, quiet: 1, healthy: 2, not_connected: 3 };

// ── THE RHYTHM, AND WHY IT IS NOT A NUMBER OF DAYS ─────────────────────────
// A parish that takes four PayPal gifts a week is in trouble after twelve
// days of silence. A foundation that takes one Givebutter gift a quarter is
// not in trouble after twelve WEEKS. A fixed threshold is wrong for both, and
// wrong in the direction that trains people to ignore it.
//
// So the rhythm is the connection's own: the mean gap between its gifts over
// the trailing window. Quiet is a multiple of that gap, floored so a brand new
// connection with two gifts an hour apart is not declared quiet by teatime,
// and capped so a genuinely dead connection is eventually noticed.
export const QUIET_MULTIPLE = 3;          // three of its own gaps, and no arithmetic beyond that
export const QUIET_MIN_DAYS = 7;          // never shout before a week, whatever the rhythm
export const QUIET_MAX_DAYS = 120;        // and never stay silent past a quarter
export const RHYTHM_MIN_GIFTS = 4;        // below this there is no rhythm to speak of
export const RHYTHM_WINDOW_DAYS = 120;

const DAY = 86400000;
const civil = d => {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d) ? null : d.toISOString().slice(0, 10);
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);

/**
 * The connection's own rhythm, from the dates of the gifts it brought in.
 * @param {string[]} giftDates civil dates, any order
 * @returns {{gifts:number, meanGapDays:number|null, perWeek:number|null, sentence:string}}
 */
export function rhythmOf(giftDates, today) {
  const t = civil(today);
  const dates = [...new Set((giftDates || []).map(civil).filter(Boolean))]
    .filter(d => !t || daysBetween(d, t) <= RHYTHM_WINDOW_DAYS)
    .sort();
  if (dates.length < RHYTHM_MIN_GIFTS)
    return { gifts: dates.length, meanGapDays: null, perWeek: null,
             sentence: dates.length ? `${dates.length} gift${dates.length === 1 ? "" : "s"} so far, which is not yet a rhythm.` : "Nothing has come through it yet." };
  const span = daysBetween(dates[0], dates[dates.length - 1]);
  const meanGapDays = span / (dates.length - 1);
  const perWeek = meanGapDays > 0 ? 7 / meanGapDays : null;
  const per = perWeek == null ? null : Math.round(perWeek * 10) / 10;
  return { gifts: dates.length, meanGapDays, perWeek,
           sentence: per != null && per >= 1
             ? `It usually sends about ${per} gift${per === 1 ? "" : "s"} a week.`
             : `It usually sends a gift every ${Math.round(meanGapDays)} days.` };
}

// How long this connection may be silent before silence is worth saying.
export function quietAfterDays(rhythm) {
  if (!rhythm || rhythm.meanGapDays == null) return QUIET_MAX_DAYS;
  const d = Math.round(rhythm.meanGapDays * QUIET_MULTIPLE);
  return Math.max(QUIET_MIN_DAYS, Math.min(QUIET_MAX_DAYS, d));
}

/**
 * The state of one connection, and the sentence that says why.
 *
 * Deliberately: BROKEN outranks QUIET. A connection whose last check failed is
 * also, necessarily, quiet; saying "quiet" about it would send somebody
 * looking at their donors when the answer is that the key expired.
 */
export function assessConnection({ connected, lastError, lastGiftDate, giftDates = [], today }) {
  const t = civil(today) || new Date().toISOString().slice(0, 10);
  if (!connected) return { status: "not_connected", ...STATUSES.not_connected, sentence: STATUSES.not_connected.definition };
  if (lastError) return { status: "broken", ...STATUSES.broken, sentence: String(lastError) };

  const rhythm = rhythmOf(giftDates, t);
  const last = civil(lastGiftDate);
  const silentDays = last ? Math.max(0, daysBetween(last, t)) : null;
  const threshold = quietAfterDays(rhythm);

  if (last && silentDays > threshold) {
    return { status: "quiet", ...STATUSES.quiet, rhythm, silentDays, quietAfterDays: threshold,
             sentence: `Nothing has arrived through it in ${silentDays} days. ${rhythm.sentence}` };
  }
  return { status: "healthy", ...STATUSES.healthy, rhythm, silentDays, quietAfterDays: threshold,
           sentence: last
             ? `The last gift through it arrived ${silentDays === 0 ? "today" : silentDays === 1 ? "yesterday" : `${silentDays} days ago`}. ${rhythm.sentence}`
             : "Connected. Nothing has come through it yet." };
}

// ── DOES IT MATCH ──────────────────────────────────────────────────────────
// One payout, the gifts inside it and the fees, in INTEGER CENTS. A payout
// that does not reconcile is never rounded into one that does: the difference
// is stated, with its sign, and the rows that make it up are handed back so
// the screen can show exactly which ones do not line up.
export function reconcile({ payoutCents, giftCents, feeCents, refundCents = 0 }) {
  const p = Math.round(Number(payoutCents) || 0);
  const g = Math.round(Number(giftCents) || 0);
  const f = Math.round(Number(feeCents) || 0);
  const r = Math.round(Number(refundCents) || 0);
  // gifts − fees − refunds should equal what hit the bank.
  const expected = g - f - r;
  const differenceCents = p - expected;
  return {
    payoutCents: p, giftCents: g, feeCents: f, refundCents: r,
    expectedCents: expected, differenceCents, matches: differenceCents === 0,
    sentence: differenceCents === 0
      ? `${money(g)} in gifts, less ${money(f)} of fees${r ? ` and ${money(r)} refunded` : ""}, is ${money(p)} in the bank.`
      : `${money(g)} in gifts, less ${money(f)} of fees${r ? ` and ${money(r)} refunded` : ""}, is ${money(expected)} — but ${money(p)} arrived. ${money(Math.abs(differenceCents))} ${differenceCents > 0 ? "more than" : "less than"} Steward can account for.`,
  };
}

export const money = cents => {
  const n = Math.round(Number(cents) || 0) / 100;
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US",
    { minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

// ── THE SYNC LOG, IN SENTENCES ─────────────────────────────────────────────
// One line per check, in the words somebody would use. Never a raw error code:
// the code is a fact about a vendor's API and the sentence is a fact about
// this organisation's money. A check that read nothing says so rather than
// printing zeros, because five identical rows of zeros is how a log stops
// being read.
export function syncLogLine({ at, ok, rowsRead = 0, giftsCreated = 0, centsCreated = 0,
                              duplicates = 0, dropped = {}, duplicateQuestions = 0,
                              error = null, reason = "scheduled" } = {}) {
  const when = civil(at) || "";
  if (!ok) return { at: when, ok: false, sentence: error
    ? `The check failed. ${String(error)}`
    : "The check failed, and Steward could not say why. The next check will try again." };
  const parts = [];
  if (giftsCreated) parts.push(`${giftsCreated} new gift${giftsCreated === 1 ? "" : "s"} worth ${money(centsCreated)}`);
  if (duplicates) parts.push(`${duplicates} already on file`);
  const droppedTotal = Object.values(dropped || {}).reduce((a, b) => a + Number(b || 0), 0);
  if (droppedTotal) parts.push(`${droppedTotal} row${droppedTotal === 1 ? "" : "s"} that were not gifts`);
  if (duplicateQuestions) parts.push(`${duplicateQuestions} to ask you about`);
  const head = reason === "manual" ? "You checked" : "Steward checked";
  if (!rowsRead) return { at: when, ok: true, sentence: `${head}, and the provider had nothing new.` };
  return { at: when, ok: true,
    sentence: `${head} and read ${rowsRead} row${rowsRead === 1 ? "" : "s"}: ${parts.length ? parts.join(", ") : "nothing that was a gift"}.` };
}

// Why a row was not written, in words rather than in the reason codes the
// normaliser uses. An unknown reason keeps its own key rather than being
// flattened into "other", because a reason nobody has words for yet is still
// a reason, and hiding it is how a count stops adding up.
export const DROP_WORDS = {
  not_positive: "money going out, not coming in",
  refund: "a refund",
  failed: "a payment that failed",
  no_amount: "no amount on the row",
  no_date: "no date on the row",
  duplicate: "already on file",
};
export const dropWords = key => DROP_WORDS[key] || String(key || "").replace(/_/g, " ");

export default { STATUSES, STATUS_KEYS, STATUS_RANK, assessConnection, rhythmOf,
                 quietAfterDays, reconcile, syncLogLine, money, dropWords };
