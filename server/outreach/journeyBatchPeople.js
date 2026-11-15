// server/outreach/journeyBatchPeople.js · FLOWS-3 (W-1107-Fundraising-28). The
// Donors list's "Add to a journey" preview, person by person: who starts and,
// for each one who doesn't, why ("2 can start, 1 is already in it"), plus the
// day the steps count from when the journey has its own date.
"use strict";

const SHOW_MAX = 50;   // names listed in the dialog; the counts cover everyone

// FLOWS-12 item 4 (W-1114-Fundraising-28X): each person's own first step, from
// the one function the start dates it with (server/shared/journeySchedule.js).
// `steps` are the journey's validated steps (none: no dates are shown).
async function batchPeople(query, orgId, t, ids, split, today, steps = null) {
  const JR = await import("../../shared/journeyStartRule.js");
  const DD = await import("../../shared/displayDate.js");
  const why = new Map();
  for (const [k, list] of Object.entries(split.skips || {})) for (const id of list) why.set(id, k);
  const shown = ids.slice(0, SHOW_MAX);
  const rows = shown.length ? await query(`SELECT id, name, birth_month, birth_day FROM donors WHERE org_id=? AND id = ANY(?::text[])`, [orgId, shown]) : [];
  const byId = new Map(rows.map(r => [r.id, r]));
  const SCH = require("../shared/journeySchedule");
  const people = [];
  for (const id of shown) {
    const r = byId.get(id) || { id, name: "Someone no longer in Steward" };
    const k = why.get(id) || null;
    const own = !k && steps ? (await SCH.firstStepFor({ template: t, steps, person: r, today, byHand: true })).first : null;
    people.push({ id, name: r.name, canStart: !k, reason: k,
      firstStep: own ? { label: own.label, dueDate: own.dueDate, dueLabel: DD.displayDate(own.dueDate) } : null,
      sentence: k ? JR.personWhy(k) : own ? `Can start. First step due ${DD.displayDate(own.dueDate)}.` : "Can start." });
  }
  // A birthday journey counts from each person's own day, so each person
  // above carries their own date. A yearly date is the same for everyone.
  const first = rows.find(r => !why.has(r.id)) || rows[0] || {};
  const anchor = JR.journeyAnchor(t, first, today);
  const dues = new Set(people.filter(p => p.firstStep).map(p => p.firstStep.dueDate));
  return {
    people, more: Math.max(0, ids.length - shown.length),
    oneDate: dues.size <= 1,   // false: the people above start on different days
    breakdown: JR.breakdownSentence(ids.length, split.willStart.length, split.skips || {}),
    anchor,
    anchorNote: dues.size > 1 ? "The steps count from each person's own date, so each person's first step is listed with them."
      : anchor !== today ? `The steps count from ${DD.displayDate(anchor)}, the journey's own date, not from today.` : null,
  };
}

module.exports = { batchPeople };
