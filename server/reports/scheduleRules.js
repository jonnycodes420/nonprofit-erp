// server/reports/scheduleRules.js · REPORTS-6 item 1. WHEN A SCHEDULED REPORT GOES, IN THE ORG'S DAY.
//
// Pure: every input is a parameter (the org's civil date and hour come in from
// orgTime.orgClock), so the suite can prove each arm with its own clock.
//
//   weekly     on a weekday (0 Sunday .. 6 Saturday), at an hour
//   monthly    on a day of the month, 1 to 28 (29 to 31 are not in every
//              month, and a report that silently skips February is one nobody
//              trusts: the board pack's rule, shared/boardPack.js)
//   quarterly  on that day of the first month of each calendar quarter
//
// A send is due from its hour until the end of its day; the ledger row
// (report_schedule_sends, one per schedule and period) makes it once.
"use strict";

const FREQUENCIES = ["weekly", "monthly", "quarterly"];
const DAY_MIN = 1, DAY_MAX = 28;
const RECIPIENTS_MAX = 25;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

const civil = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const asDate = s => new Date(s + "T12:00:00Z");
const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = asDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const pad = n => String(n).padStart(2, "0");

// Recipients: typed by an admin, one address per line or comma. Lower-cased,
// each once, in the order typed. Anything that is not an address is refused by
// name, never dropped.
function parseRecipients(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(/[\n,;]+/);
  const out = [], bad = [];
  for (const r of list) {
    const e = String(r || "").trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) { bad.push(String(r).trim()); continue; }
    if (!out.includes(e)) out.push(e);
  }
  return { emails: out, bad };
}

function validateSchedule(b = {}) {
  const errors = [];
  const frequency = String(b.frequency || "");
  if (!FREQUENCIES.includes(frequency)) errors.push("Pick weekly, monthly or quarterly.");
  const day = Number(b.day);
  if (frequency === "weekly" && !(Number.isInteger(day) && day >= 0 && day <= 6)) errors.push("Pick the day of the week it goes.");
  if (frequency !== "weekly" && FREQUENCIES.includes(frequency) && !(Number.isInteger(day) && day >= DAY_MIN && day <= DAY_MAX)) {
    errors.push(`Pick a day between ${DAY_MIN} and ${DAY_MAX}. The 29th, 30th and 31st are not in every month.`);
  }
  const hour = Number(b.hour);
  if (!(Number.isInteger(hour) && hour >= 0 && hour <= 23)) errors.push("Pick the hour it goes, in your organization's time.");
  const r = parseRecipients(b.recipients);
  if (r.bad.length) errors.push(`${r.bad.map(x => `"${x}"`).join(", ")} ${r.bad.length === 1 ? "is not an email address" : "are not email addresses"}.`);
  if (!r.emails.length && !r.bad.length) errors.push("Type at least one address to send it to.");
  if (r.emails.length > RECIPIENTS_MAX) errors.push(`At most ${RECIPIENTS_MAX} people on one schedule.`);
  return { ok: errors.length === 0, errors, value: { frequency, day, hour, recipients: r.emails, enabled: b.enabled !== false } };
}

// Is `date` (the org's civil day) one this schedule sends on?
function isSendDay(s, date) {
  if (!civil(date)) return false;
  const d = asDate(date);
  if (s.frequency === "weekly") return d.getUTCDay() === Number(s.day);
  if (d.getUTCDate() !== Number(s.day)) return false;
  if (s.frequency === "monthly") return true;
  return s.frequency === "quarterly" && d.getUTCMonth() % 3 === 0;
}

// Due now: the send day, at or after its hour (the org's clock).
const isDue = (s, clock) => !!s && s.enabled !== false && isSendDay(s, clock.date) && Number(clock.hour) >= Number(s.hour);

// The ledger key: one send per schedule per week, month or quarter.
function periodKey(s, date) {
  if (s.frequency === "weekly") return `wk:${date}`;
  if (s.frequency === "monthly") return `mo:${date.slice(0, 7)}`;
  const m = Number(date.slice(5, 7));
  return `q:${date.slice(0, 4)}-Q${Math.floor((m - 1) / 3) + 1}`;
}

// The next send, from the org's clock: today if its hour has not passed and
// today is a send day, otherwise the next send day. `sentThisPeriod` is true
// when today's period already went, so today is not offered again.
function nextSend(s, clock, { sentThisPeriod = false } = {}) {
  if (!s || s.enabled === false) return null;
  let date = clock.date;
  if (isSendDay(s, date) && (Number(clock.hour) < Number(s.hour) || !sentThisPeriod)) return { date, hour: Number(s.hour) };
  for (let i = 1; i <= 400; i++) {
    date = addDays(clock.date, i);
    if (isSendDay(s, date)) return { date, hour: Number(s.hour) };
  }
  return null;
}

const hourWords = h => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);
const dayWords = date => `${WEEKDAYS[asDate(date).getUTCDay()]}, ${MON[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
const ordinal = n => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

// "Every Monday at 7 AM" · "On the 5th of every month at 7 AM" · "On the 5th of Jan, Apr, Jul and Oct at 7 AM"
function cadenceWords(s) {
  const at = `at ${hourWords(Number(s.hour))}`;
  if (s.frequency === "weekly") return `Every ${WEEKDAYS[Number(s.day)]} ${at}`;
  if (s.frequency === "monthly") return `On the ${ordinal(Number(s.day))} of every month ${at}`;
  return `On the ${ordinal(Number(s.day))} of Jan, Apr, Jul and Oct ${at}`;
}
function nextSendSentence(s, clock, opts) {
  const n = nextSend(s, clock, opts);
  if (!n) return "Off. Nothing will be sent until it is turned on again.";
  return `Next send: ${dayWords(n.date)}, at ${hourWords(n.hour)} your organization's time.`;
}

module.exports = { FREQUENCIES, DAY_MIN, DAY_MAX, RECIPIENTS_MAX, WEEKDAYS, parseRecipients, validateSchedule, isSendDay, isDue,
  periodKey, nextSend, cadenceWords, nextSendSentence, hourWords, dayWords, pad };
