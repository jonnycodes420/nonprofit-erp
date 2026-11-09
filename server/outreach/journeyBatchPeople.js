// server/outreach/journeyBatchPeople.js · FLOWS-3 (W-1107-Fundraising-28). The
// Donors list's "Add to a journey" preview, person by person: who starts and,
// for each one who doesn't, why ("2 can start, 1 is already in it"), plus the
// day the steps count from when the journey has its own date.
"use strict";

const SHOW_MAX = 50;   // names listed in the dialog; the counts cover everyone

async function batchPeople(query, orgId, t, ids, split, today) {
  const JR = await import("../../shared/journeyStartRule.js");
  const DD = await import("../../shared/displayDate.js");
  const why = new Map();
  for (const [k, list] of Object.entries(split.skips || {})) for (const id of list) why.set(id, k);
  const shown = ids.slice(0, SHOW_MAX);
  const rows = shown.length ? await query(`SELECT id, name, birth_month, birth_day FROM donors WHERE org_id=? AND id = ANY(?::text[])`, [orgId, shown]) : [];
  const byId = new Map(rows.map(r => [r.id, r]));
  const people = shown.map(id => {
    const r = byId.get(id) || { id, name: "Someone no longer in Steward" };
    const k = why.get(id) || null;
    return { id, name: r.name, canStart: !k, reason: k, sentence: k ? JR.personWhy(k) : "Can start." };
  });
  // A birthday journey counts from each person's own day; the preview shows
  // the first person's. A yearly date is the same for everyone.
  const first = rows.find(r => !why.has(r.id)) || rows[0] || {};
  const anchor = JR.journeyAnchor(t, first, today);
  return {
    people, more: Math.max(0, ids.length - shown.length),
    breakdown: JR.breakdownSentence(ids.length, split.willStart.length, split.skips || {}),
    anchor,
    anchorNote: anchor !== today ? `The steps count from ${DD.displayDate(anchor)}, the journey's own date, not from today.` : null,
  };
}

module.exports = { batchPeople };
