// server/donors/rhythmUnit.js · FLOWS-6 (W-1110-Donors-33X). ONE VERDICT PER PERSON.
//
// After a person was linked to a foundation, the tag said Current (their giving
// unit gave: server/donors/currentThrough.js) while Giving rhythm, which reads
// only their own gifts, said "Due now · Late". Two verdicts on one screen. Now
// the rhythm reads the same giving unit as the tag: when the person is Current
// only through a household or gives-through link and their own next gift is
// due or late, the rhythm says both in one sentence:
//   "Their own giving: due now. Current through Harborview Fund."
// and is no longer drawn as late. A read only: nothing here writes.
"use strict";

async function rhythmForUnit(query, orgId, donorId, rhythm, today) {
  if (!rhythm || !(rhythm.dueNow || rhythm.late)) return rhythm;
  const DS = require("../../donorStatus");
  const { row } = await DS.statusFor(orgId, donorId, { today });
  const through = await require("./currentThrough").currentThrough(query, orgId, donorId, row, today);
  if (!through) return rhythm;
  return {
    ...rhythm,
    sentence: `Their own giving: ${rhythm.dueNow ? "due now" : "late"}. Current through ${through.name}.`,
    through: { name: through.name, how: through.how },
    late: false,
  };
}

module.exports = { rhythmForUnit };
