// JOBS-1 · THE AFTER-CHANGE STEP AS A HANDLER (LIVE-1's step, afterChange.js).
//
//   gift.recorded   the gift's person: rhythm, Drift, groups by rule (a "joins
//                   a group" journey hears about it here), scores and the org's
//                   stored figures. recordGift wrote the totals itself; an
//                   event whose door died before the rollup recomputes them.
//   donor.changed   every other door (afterChange() writes this event).
//
// Idempotent: the totals and the rhythm are recomputed, never added to, and a
// person crosses into a group once (group_sweep_seen). An error the step hit
// is thrown, so the queue tries it again.
"use strict";
const OUTBOX = require("../../shared/outbox");

const joinedGroup = (deps, orgId) => (did, gid) => deps.maybeStartJourneyFromServer(orgId, did, "joined_group", { groupId: gid });
async function step(deps, orgId, ids, opts) {
  const r = await deps.afterChangeNow(orgId, ids, opts);
  if (r && r.error) throw new Error(`after-change (${opts.door}): ${r.error}`);
}

OUTBOX.on("gift.recorded", "afterChange", async (p, deps) => {
  await step(deps, p.orgId, [p.donorId], { door: p.door || "gift_form", history: p.history === true, recalc: !p.ready,
    fire: p.oldHistory || p.fromImport ? null : joinedGroup(deps, p.orgId) });
}, { applies: (p) => p.afterChange !== false });

OUTBOX.on("donor.changed", "afterChange", async (p, deps) => {
  await step(deps, p.orgId, p.donorIds, { door: p.door, history: p.history === true, recalc: p.recalc === true, runTag: p.runTag || null,
    fire: p.startsJourneys && !p.history ? joinedGroup(deps, p.orgId) : null });
});
