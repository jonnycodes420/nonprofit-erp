// shared/numbers/scheduled.js · TRUTH-6 (W-1110-Finance-25, W-1109-Finance-15). A GIFT DATED AFTER TODAY IS SCHEDULED.
//
// The fleet found one kind of gift handled two ways: a postdated check typed
// in by hand counted in Lifetime and showed as the Last gift the day it was
// entered, while an import set the same gift aside, so a 1,000-row file came
// in short exactly its 76 future-dated rows and never footed.
//
// The rule (the way Bloomerang and Raiser's Edge keep a postdated check), one
// for every door: a gift recorded with a date after the org's today is stored
// as SCHEDULED (gifts.scheduled_on = that day). It is on file and listed
// ("Scheduled, Dec 15") on the profile and in a Scheduled row on reports, and
// it is in no total, count, Lifetime, Last gift or year until its day comes.
// On its day it counts like any other gift, with no job to run: the rule
// reads the org's today each time.
//
// money.js MONEY and GIFT read DUE, so every total and count in Steward that
// goes through them leaves a scheduled gift out until its day.
"use strict";
const orgTime = require("../../orgTime");

// SQL: the org's today, YYYY-MM-DD, for gift row `g`'s org.
const ORG_TODAY = (g = "g") => `to_char(${orgTime.orgTodaySql(orgTime.orgTzSql(`${g}.org_id`))}, 'YYYY-MM-DD')`;
// SQL: gift row `g` counts today: it is not scheduled, or its day has come.
// The CASE keeps the org lookup off every ordinary row.
const DUE = (g = "g") => `(CASE WHEN ${g}.scheduled_on IS NULL THEN TRUE ELSE ${g}.scheduled_on <= ${ORG_TODAY(g)} END)`;
// SQL: gift row `g` is scheduled and its day has not come.
const SCHEDULED = (g = "g") => `(NOT ${DUE(g)})`;

// JS: the scheduled_on a new gift dated `date` is stored with, given the org's today.
const scheduledOn = (date, today) => {
  const d = String(date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && today && d > String(today).slice(0, 10) ? d : null;
};
// JS: a row already read ({ scheduled_on | scheduledOn }) is scheduled on `today`.
const isScheduled = (r, today) => {
  const s = r && (r.scheduled_on ?? r.scheduledOn);
  if (!s) return false;
  return today ? String(s).slice(0, 10) > String(today).slice(0, 10) : r.scheduled === true;
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Scheduled, Dec 15" (the year said only when it is not this one).
function scheduledLabel(date, today = null) {
  const d = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "Scheduled";
  const yr = today && String(today).slice(0, 4) !== d.slice(0, 4) ? `, ${d.slice(0, 4)}` : "";
  return `Scheduled, ${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}${yr}`;
}

const SENTENCE = "A gift dated after today is scheduled: it is on file and listed as Scheduled, and it counts in no total, count, Lifetime or Last gift until its date.";

// The scheduled gifts in a set of gift rows, as one line a report shows:
// { n, cents, sentence } or null.
async function scheduledLine(query, orgId, { donorId = null } = {}) {
  const rows = await query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS cents, MIN(g.scheduled_on) AS next
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND d.deleted_at IS NULL AND ${SCHEDULED("g")}${donorId ? " AND g.donor_id = ?" : ""}`,
    donorId ? [orgId, donorId] : [orgId]);
  const r = rows[0] || {};
  const n = Number(r.n) || 0, cents = Number(r.cents) || 0;
  if (!n) return null;
  const usd = "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return { n, cents, next: r.next, label: "Scheduled",
    sentence: `Scheduled: ${n} ${n === 1 ? "gift" : "gifts"}, ${usd}, dated after today (the next ${scheduledLabel(r.next).replace("Scheduled, ", "")}). ${n === 1 ? "It counts" : "They count"} on ${n === 1 ? "its" : "their"} date, not before.` };
}

module.exports = { ORG_TODAY, DUE, SCHEDULED, scheduledOn, isScheduled, scheduledLabel, scheduledLine, SENTENCE };
