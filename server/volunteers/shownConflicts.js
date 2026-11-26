// server/volunteers/shownConflicts.js · FRESH-3 item 2 (W-1126-Volunteers-01).
// "Schedule conflicts stays 0 in both weeks while shift cards show conflict tags."
// The tags were the shifts ON SCREEN (scheduleRows for the week she is looking at);
// the counter was always the org's current week (weekProblems), whatever week was
// shown. Both now come from here, over the same rows: the person, the two shifts
// and the day, for every overlap that touches a shift in `shifts` (INPUT-1's rule:
// the count and the rows it opens are one list).
"use strict";

function conflictRows(shifts, conflicts) {
  const names = new Map();
  for (const s of shifts) for (const p of [...s.people, ...s.roles.flatMap(r => r.people)]) names.set(p.personId, p.name);
  const byId = new Map(shifts.map(s => [s.id, s]));
  const side = id => byId.get(id) ? { id, name: byId.get(id).name, when: byId.get(id).when } : { id };
  return conflicts.filter(c => byId.has(c.a) || byId.has(c.b))
    .map(c => ({ personId: c.personId, name: names.get(c.personId) || "", date: c.date, a: side(c.a), b: side(c.b) }));
}

module.exports = { conflictRows };
