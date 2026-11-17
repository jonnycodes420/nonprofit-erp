// server/smartMoves/index.js · SCALE-5. SMART MOVES FOR WHAT CHANGED, ONCE A NIGHT FOR THE REST.
//
// Before: every five minutes, every onboarded org (archived and test orgs
// included), autoLapseOrg from scratch: 56.6% of prod's database connection
// time on 17 Nov, up to four connections at once.
//
// Now:
//   · tick (every five minutes): only LIVE orgs (server/orgs/liveOrgs.js) that
//     changed since the last tick (marks.js reads org_changes), one org at a
//     time, each on ONE connection (withPinnedClient).
//   · nightly (an hourly job that acts once per org per day): every live org
//     once, in its own quiet hours (2 to 6 AM, the org's clock), to the end of
//     its list. A lapse that comes from the date alone (a year passes with no
//     gift, a pledge's hold runs out) needs no write, so it is found here.
//
// The moves are the same function's (autoLapseOrg, unlapseHeldByPledge): the
// rule did not change, only which orgs are asked and when. An org whose pass
// hit autoLapseOrg's 200-person limit wrote those 200 moves, which are
// themselves changes, so the next tick carries on where it stopped, as the old
// sweep did. tests/scale5.test.js §2 runs a scripted day both ways and compares.
"use strict";
const LIVE = require("../orgs/liveOrgs");
const MARKS = require("./marks");

const BATCH = 200;            // autoLapseOrg's LIMIT
const NIGHT_FROM = 2, NIGHT_TO = 6;
const NIGHT_MAX_ROUNDS = 100; // 20,000 people in one night, then the next night or tick goes on

// The live, onboarded orgs (the old sweep's onboarding_complete=1, narrowed).
async function liveOnboarded(query) {
  const ids = await LIVE.liveOrgIds(query);
  if (!ids.length) return [];
  return query(`SELECT id, timezone FROM orgs WHERE onboarding_complete=1 AND id = ANY(?::text[]) ORDER BY id`, [ids]);
}

// One org, one connection.
async function onOneConnection(fn) {
  const { withPinnedClient } = require("../db/query");
  return withPinnedClient(fn);
}

// THE FIVE-MINUTE TICK. Returns { orgs, worked, moved } for the tick figure and the tests.
// `onlyOrgs` and `markKey` are a suite's: its own orgs, its own kept mark, so
// it never moves another suite's people or the real tick's mark.
async function tick({ query, run, autoLapseOrg }, { onlyOrgs = null, markKey = "tick" } = {}) {
  const mark = await MARKS.markNow(query);          // before anything is read
  const prev = await MARKS.keptMark(query, markKey);
  let live = (await liveOnboarded(query)).map(o => o.id);
  if (onlyOrgs) live = live.filter(id => onlyOrgs.includes(id));
  // The first tick there has ever been has nothing to compare with: every live org once.
  const todo = prev == null ? live : await MARKS.changedSince(query, live, prev);
  let moved = 0;
  const orgs = [];   // jobAudit: the orgs a move was written in
  for (const orgId of todo) {
    try { const n = await onOneConnection(() => autoLapseOrg(orgId)); moved += n; if (n > 0) orgs.push(orgId); }
    catch (e) { console.error("[smart-move] org", orgId, e.message); }
  }
  await MARKS.keepMark(run, mark, markKey);
  return { live: live.length, worked: todo, moved, orgs, summary: `${todo.length} of ${live.length} live orgs changed; ${moved} moved` };
}

// THE NIGHTLY SWEEP. Every live org, once per its own day, in its quiet hours,
// until a pass moves fewer than a batch. `now` and `force` are for the tests.
async function nightly({ query, run, autoLapseOrg, orgClock }, { now = new Date(), force = false, onlyOrgs = null } = {}) {
  let orgs = await liveOnboarded(query);
  if (onlyOrgs) orgs = orgs.filter(o => onlyOrgs.includes(o.id));
  const done = new Map((await query(`SELECT org_key, swept_on FROM smart_move_sweeps WHERE org_key = ANY(?::text[])`, [orgs.map(o => o.id)]))
    .map(r => [r.org_key, r.swept_on]));
  const swept = [], movedIn = [];
  for (const org of orgs) {
    const clock = orgClock(org, now);   // ORG_TZ_SEAM_OK: the org's own night
    if (!force && (clock.hour < NIGHT_FROM || clock.hour >= NIGHT_TO || done.get(org.id) === clock.date)) continue;
    try {
      const n = await onOneConnection(async () => {
        let total = 0;
        for (let i = 0; i < NIGHT_MAX_ROUNDS; i++) { const m = await autoLapseOrg(org.id); total += m; if (m < BATCH) break; }
        return total;
      });
      if (n > 0) movedIn.push(org.id);
      await run(`INSERT INTO smart_move_sweeps (org_key, swept_on, swept_at) VALUES (?, ?, NOW())
                 ON CONFLICT (org_key) DO UPDATE SET swept_on = EXCLUDED.swept_on, swept_at = NOW()`, [org.id, clock.date]);
      swept.push(org.id);
    } catch (e) { console.error("[smart-move] nightly org", org.id, e.message); }
  }
  return { swept, orgs: movedIn, summary: `${swept.length} live orgs swept` };
}

module.exports = { tick, nightly, liveOnboarded, BATCH, NIGHT_FROM, NIGHT_TO };
