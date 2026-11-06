// tests/lib/mergeSpeedLeg.js · SPEED-2 item 3. THE MERGE IS DONE IN UNDER 2 SECONDS.
//
// Muse's walk (6 Nov) sat on "Merging" for 10 s or more. The merge asked about
// each of its ~90 pointer tables one at a time (whether it has an id column,
// then its rows), so a pair cost about 250 statements, each paying prod's
// round trip to the database. Now it reads every table's rows in one
// statement and moves the tables that cannot collide in one more.
//
// A typical pair, made up: the kept person with 30 gifts, the other with 25
// gifts, 15 notes, 3 tasks and a relationship. The merge goes through POST
// /data-health/merge (the side-by-side screen's), and the side-by-side screen
// itself (GET /data-health/pair) is timed too: she waits on both. Each is
// charged what it took here PLUS its statements (X-Steward-Round-Trips,
// TEST_MODE) at prod's round trip, so the number does not depend on the
// runner's speed. Two bars:
//   · the merge and the pair, each under BUDGET_MS charged at prod's round trip
//   · the merge sends at most MAX_TRIPS statements, whatever the row count:
//     a merge that goes back to one row at a time fails here (44 rows moving)
// A reading over the time bar is measured once more and that reading is held
// to the same bar (FLAKE-1); the bar never moves. Its own org, org_perfmerge.
"use strict";
const ROUND_TRIP_MS = 17;   // prod's database round trip (FIX-55, 27 Oct)
const BUDGET_MS = 2000, MAX_TRIPS = 60;
const ORG = "org_perfmerge";

async function seedPair(q, n) {
  const k = `d_pm_kept_${n}`, m = `d_pm_other_${n}`, friend = `d_pm_friend_${n}`;
  await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES
           ($1,$4,'Odessa Quillfeather','odessa.q@example.org','system:test','Merge perf seed'),
           ($2,$4,'Odessa Quillfeather','odessa.q@example.org','system:test','Merge perf seed'),
           ($3,$4,'Barnaby Quillfeather',NULL,'system:test','Merge perf seed')`, [k, m, friend, ORG]);
  const gifts = [];
  for (let i = 0; i < 30; i++) gifts.push([`g_pm_k${n}_${i}`, k, 25 + i, `2025-${String(1 + (i % 12)).padStart(2, "0")}-1${i % 9}`]);
  for (let i = 0; i < 25; i++) gifts.push([`g_pm_m${n}_${i}`, m, 40 + i, `2024-${String(1 + (i % 12)).padStart(2, "0")}-2${i % 8}`]);
  await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, created_by, created_by_name)
           VALUES ${gifts.map((_, j) => `($${j * 4 + 1},'${ORG}',$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4},'system:test','Merge perf seed')`).join(",")}`, gifts.flat());
  for (let i = 0; i < 15; i++) await q(`INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name) VALUES ($1,$2,$3,'note',$4,'2026-09-01','system:test','Merge perf seed')`, [`int_pm_${n}_${i}`, ORG, m, `Note ${i}`]);
  for (let i = 0; i < 3; i++) await q(`INSERT INTO tasks (id, org_id, donor_id, title, created_by, created_by_name) VALUES ($1,$2,$3,$4,'system:test','Merge perf seed')`, [`t_pm_${n}_${i}`, ORG, m, `Call back ${i}`]);
  await q(`INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type, created_by, created_by_name) VALUES ($1,$2,$3,$4,'spouse','system:test','Merge perf seed')`, [`rel_pm_${n}`, ORG, m, friend]);
  await q(`UPDATE donors d SET gift_count = s.n, total_giving = s.t FROM (SELECT donor_id, COUNT(*) n, SUM(amount) t FROM gifts WHERE org_id=$1 GROUP BY donor_id) s WHERE d.id = s.donor_id AND d.org_id=$1`, [ORG]);
  return { keptId: k, mergedId: m };
}

async function timed(fetchIt) {
  const t0 = performance.now();
  const r = await fetchIt();
  const body = await r.json().catch(() => ({}));
  const ms = performance.now() - t0, trips = Number(r.headers.get("x-steward-round-trips"));
  return { status: r.status, body, ms, trips: Number.isFinite(trips) && r.headers.get("x-steward-round-trips") != null ? trips : null,
    atProd: ms + (Number.isFinite(trips) ? trips : 0) * ROUND_TRIP_MS };
}

async function oneMerge({ q, base, token, n }) {
  const pair = await seedPair(q, n);
  const H = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  const open = await timed(() => fetch(`${base}/data-health/pair?a=${pair.keptId}&b=${pair.mergedId}`, { headers: H }));
  const merge = await timed(() => fetch(`${base}/data-health/merge`, { method: "POST", headers: H, body: JSON.stringify({ keptId: pair.keptId, mergedId: pair.mergedId }) }));
  const [kept] = await q("SELECT gift_count, total_giving FROM donors WHERE id=$1", [pair.keptId]);
  return { pair, open, merge, kept };
}

async function mergeSpeedLeg({ ok, q, base, login, freshPerfOrg, log = console.log }) {
  const { token } = await freshPerfOrg(q, login, ORG, "Perf Merge Collective");
  let run = await oneMerge({ q, base, token, n: 1 });
  ok("merge budget: the pair merged (201), all 55 gifts on the kept person", run.merge.status === 201 && Number(run.kept.gift_count) === 55, { status: run.merge.status, body: run.merge.body, kept: run.kept });
  ok("merge budget: both answers say how many statements they sent (TEST_MODE)", run.merge.trips != null && run.open.trips != null, { merge: run.merge.trips, open: run.open.trips });
  log(`  merge: open ${Math.round(run.open.atProd)}ms (${Math.round(run.open.ms)}ms + ${run.open.trips} trips) · merge ${Math.round(run.merge.atProd)}ms (${Math.round(run.merge.ms)}ms + ${run.merge.trips} trips)`);
  const slow = r => !(r.open.atProd < BUDGET_MS && r.merge.atProd < BUDGET_MS);
  if (slow(run)) { log("  merge: over the bar; measured once more (FLAKE-1)"); run = await oneMerge({ q, base, token, n: 2 }); }
  ok(`merge budget: the side-by-side screen ${Math.round(run.open.atProd)}ms (${Math.round(run.open.ms)}ms + ${run.open.trips} statements × ${ROUND_TRIP_MS}ms) under ${BUDGET_MS}ms`,
    run.open.status === 200 && run.open.atProd < BUDGET_MS, { ms: run.open.ms, trips: run.open.trips });
  ok(`merge budget: the merge ${Math.round(run.merge.atProd)}ms (${Math.round(run.merge.ms)}ms + ${run.merge.trips} statements × ${ROUND_TRIP_MS}ms) under ${BUDGET_MS}ms`,
    run.merge.status === 201 && run.merge.atProd < BUDGET_MS, { ms: run.merge.ms, trips: run.merge.trips });
  ok(`merge budget: the merge sent ${run.merge.trips} statements for 44 rows moving, at most ${MAX_TRIPS} (one row at a time would be over 100)`,
    run.merge.trips != null && run.merge.trips <= MAX_TRIPS, { trips: run.merge.trips });
  return run;
}

module.exports = { mergeSpeedLeg, ROUND_TRIP_MS, BUDGET_MS, MAX_TRIPS };
