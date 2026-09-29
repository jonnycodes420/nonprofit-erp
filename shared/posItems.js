// shared/posItems.js — INT-POS. A SALE IS NOT A GIFT.
//
// ── THE SENTENCE THIS BUILD HAS TO MAKE TRUE ───────────────────────────────
// "The money an organisation takes at a register shows up in Steward against
// the right person and the right event. Steward never takes the payment."
//
// A register is not a giving platform. On gala night one card reader takes
// raffle tickets, auction wins, drinks, a paddle-raise donation and a 5K
// shirt, and Square reports all five in the same shape. BUILD-95 answered that
// with a LOCATION gate — "these registers are giving, those are not" — which
// is right at the till and wrong at the gala, where one till takes all five.
//
// So the unit of classification is the LINE ITEM, and the classifier is the
// ORGANISATION, once, on a screen. Three classes and no fourth:
//
//   DONATION   becomes a gift through recordGift. Fees recorded. Deduped
//              against the same money arriving another way.
//   EVENT      attaches to a Steward event and lands on that event's report as
//              EVENT REVENUE. Never a gift, never on a giving receipt.
//   OTHER      revenue by category, and an attendance signal. Never a gift.
//
// UNMAPPED DEFAULTS TO OTHER, and the card says how many are unmapped. That
// direction is the whole safety argument: the failure mode of guessing wrong
// toward "gift" is a $45 lesson fee on somebody's lifetime giving, moving
// Drift, and reaching a tax receipt at year end. The failure mode of guessing
// wrong toward "other" is a donation that somebody has to map. One of those is
// a phone call from a donor's accountant and the other is a click.
//
// Pure: no DB, no network, no clock, no JSX.

export const CLASS_DONATION = "donation";
export const CLASS_EVENT = "event";
export const CLASS_OTHER = "other";
export const CLASSES = [CLASS_DONATION, CLASS_EVENT, CLASS_OTHER];

// THE DEFAULT, named as a constant because it is the safety property and not a
// preference. Changing it is changing what happens to money nobody classified.
export const DEFAULT_CLASS = CLASS_OTHER;

export const CLASS_META = {
  [CLASS_DONATION]: {
    key: CLASS_DONATION, label: "A donation",
    definition: "Money somebody gave. It becomes a gift on their record, with the fee, and it can go on a receipt.",
    becomesGift: true, onReceipt: true, isRevenue: false,
  },
  [CLASS_EVENT]: {
    key: CLASS_EVENT, label: "Part of an event",
    definition: "Tickets, raffle, auction, the bar, merchandise on the night. It lands on that event's report as event revenue. It is never a gift and never goes on a giving receipt.",
    becomesGift: false, onReceipt: false, isRevenue: true,
  },
  [CLASS_OTHER]: {
    key: CLASS_OTHER, label: "Everything else",
    definition: "Admissions, the shop, the cafe. Revenue by category, and a sign that somebody was there. Never a gift.",
    becomesGift: false, onReceipt: false, isRevenue: true,
  },
};

export const isValidClass = c => CLASSES.includes(c);

// THE TWO QUESTIONS THIS FILE EXISTS TO ANSWER, and they are deliberately
// separate functions rather than one flag, because "may it become a gift" and
// "may it appear on a giving receipt" are asked in different places and must
// never drift apart. A line that is not a donation answers no to both.
export function becomesGift(cls) { return CLASS_META[normalize(cls)].becomesGift === true; }
export function mayAppearOnGivingReceipt(cls) { return CLASS_META[normalize(cls)].onReceipt === true; }

function normalize(cls) { return isValidClass(cls) ? cls : DEFAULT_CLASS; }

// ── THE MAPPING ────────────────────────────────────────────────────────────
// One row per item the register sells, set once. The key is the item's own
// name, folded: a register's catalogue id changes when somebody re-creates the
// item, and the name is what the person mapping it actually recognises.
export const itemKey = name => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Classify one line item against the org's mapping.
 * @param {object} line   { name, amountCents, quantity, occurredAt, locationId }
 * @param {Map|object} mapping  itemKey → { class, eventId }
 * @param {object} opts   { events: [{id, date, location}] } for date+location fallback
 * @returns {{class:string, eventId:string|null, mapped:boolean, why:string}}
 */
export function classifyLine(line, mapping, { events = [] } = {}) {
  const key = itemKey(line && line.name);
  const get = mapping instanceof Map ? k => mapping.get(k) : k => (mapping || {})[k];
  const m = key ? get(key) : null;
  if (m && isValidClass(m.class)) {
    // An EVENT line with no event named falls back to the event that was on
    // that day at that place — the mapping said what KIND of thing it is, and
    // the calendar says which one, which is the pairing an org would make.
    const eventId = m.class === CLASS_EVENT
      ? (m.eventId || eventByDateAndPlace(line, events))
      : null;
    return { class: m.class, eventId, mapped: true,
             why: `"${line.name}" is mapped as ${CLASS_META[m.class].label.toLowerCase()}.` };
  }
  return { class: DEFAULT_CLASS, eventId: null, mapped: false,
           why: `Nobody has said what "${line && line.name ? line.name : "this item"}" is, so Steward counted it as revenue and not as a gift.` };
}

// The date-and-place fallback: an event whose own date is the day of the sale
// and whose location matches the register's. Exactly one match, or nothing —
// two candidate events is an ambiguity a person resolves, not one a default
// resolves silently.
export function eventByDateAndPlace(line, events) {
  const day = String(line && line.occurredAt || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const place = String(line && line.locationName || "").trim().toLowerCase();
  const sameDay = (events || []).filter(e => String(e.date || "").slice(0, 10) === day);
  if (sameDay.length === 1) return sameDay[0].id;
  if (!place) return null;
  const samePlace = sameDay.filter(e => String(e.location || "").trim().toLowerCase() === place);
  return samePlace.length === 1 ? samePlace[0].id : null;
}

/**
 * A whole sale, classified. Returns the gift lines SEPARATELY from the revenue
 * lines, because they go to different places and nothing downstream should
 * have to re-derive which is which.
 */
export function classifySale(sale, mapping, opts = {}) {
  const lines = Array.isArray(sale && sale.lines) ? sale.lines : [];
  const out = { giftCents: 0, eventCents: 0, otherCents: 0, unmapped: 0, lines: [] };
  for (const line of lines) {
    const c = classifyLine(line, mapping, opts);
    const cents = Math.round(Number(line.amountCents) || 0);
    if (!c.mapped) out.unmapped++;
    if (c.class === CLASS_DONATION) out.giftCents += cents;
    else if (c.class === CLASS_EVENT) out.eventCents += cents;
    else out.otherCents += cents;
    out.lines.push({ ...line, ...c, amountCents: cents });
  }
  out.totalCents = out.giftCents + out.eventCents + out.otherCents;
  // Stated rather than implied: the only money that may leave this function as
  // a gift is the money classified as a donation, and it foots.
  out.sentence = out.giftCents
    ? `${money(out.totalCents)} at the register, of which ${money(out.giftCents)} was given.`
    : `${money(out.totalCents)} at the register, none of it a gift.`;
  return out;
}

export const money = cents => {
  const n = Math.round(Number(cents) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

// ── MATCHING A BUYER TO A PERSON ───────────────────────────────────────────
// Email, then phone, then an EXACT name. Anything less certain is shown for a
// human to confirm and merged by nobody: a register buyer called "J Smith" is
// not the J Smith who gives $5,000 a year on the strength of a fold and a
// shrug. A buyer with no match becomes a GUEST — a person record typed guest,
// never a donor, because they have not given a penny.
export const MATCH_ORDER = ["email", "phone", "exact_name"];

export function matchBuyer(buyer, people) {
  const email = String(buyer && buyer.email || "").trim().toLowerCase();
  const phone = digits(buyer && buyer.phone);
  const name = String(buyer && buyer.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (email) {
    const hits = people.filter(p => String(p.email || "").trim().toLowerCase() === email);
    if (hits.length === 1) return { personId: hits[0].id, by: "email", confident: true };
    if (hits.length > 1) return { personId: null, by: "email", confident: false, candidates: hits.map(p => p.id) };
  }
  if (phone) {
    const hits = people.filter(p => digits(p.phone) && digits(p.phone) === phone);
    if (hits.length === 1) return { personId: hits[0].id, by: "phone", confident: true };
    if (hits.length > 1) return { personId: null, by: "phone", confident: false, candidates: hits.map(p => p.id) };
  }
  if (name) {
    const hits = people.filter(p => String(p.name || "").trim().toLowerCase().replace(/\s+/g, " ") === name);
    if (hits.length === 1) return { personId: hits[0].id, by: "exact_name", confident: true };
    if (hits.length > 1) return { personId: null, by: "exact_name", confident: false, candidates: hits.map(p => p.id) };
  }
  return { personId: null, by: null, confident: false, candidates: [] };
}

const digits = v => String(v || "").replace(/\D+/g, "").slice(-10) || null;

// ── ATTENDANCE DRIFT ───────────────────────────────────────────────────────
// The same engine and the same wording as giving drift, on a different signal:
// somebody who came regularly and stopped. It is LABELLED as attendance and it
// never feeds giving drift, LYBUNT or SYBUNT — a person who stopped buying
// coffee has not stopped giving, and letting one stand for the other is how a
// retention figure quietly becomes fiction.
export const ATTENDANCE_MIN_VISITS = 4;
export const ATTENDANCE_QUIET_MULTIPLE = 3;
export const ATTENDANCE_MIN_DAYS = 30;

export function attendanceDrift(visitDates, today) {
  const dates = [...new Set((visitDates || []).map(d => String(d || "").slice(0, 10))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (dates.length < ATTENDANCE_MIN_VISITS)
    return { state: "not_eligible", sentence: `${dates.length} visit${dates.length === 1 ? "" : "s"} on file, which is not yet a pattern.` };
  const span = days(dates[0], dates[dates.length - 1]);
  const gap = span / (dates.length - 1);
  const silent = days(dates[dates.length - 1], String(today).slice(0, 10));
  const threshold = Math.max(ATTENDANCE_MIN_DAYS, Math.round(gap * ATTENDANCE_QUIET_MULTIPLE));
  if (silent > threshold)
    return { state: "drifting", kind: "attendance", visits: dates.length, silentDays: silent,
             meanGapDays: Math.round(gap), lastVisit: dates[dates.length - 1],
             sentence: `Came about every ${Math.round(gap)} days, ${dates.length} times, and has not been in for ${silent}.` };
  return { state: "ok", kind: "attendance", visits: dates.length, silentDays: silent,
           meanGapDays: Math.round(gap), lastVisit: dates[dates.length - 1],
           sentence: `Came ${dates.length} times, most recently ${silent} day${silent === 1 ? "" : "s"} ago.` };
}

const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export default { CLASSES, CLASS_DONATION, CLASS_EVENT, CLASS_OTHER, DEFAULT_CLASS, CLASS_META,
                 isValidClass, becomesGift, mayAppearOnGivingReceipt, itemKey, classifyLine,
                 classifySale, matchBuyer, attendanceDrift, money };
