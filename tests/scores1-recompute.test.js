// tests/scores1-recompute.test.js · SCORES-1. ONE GIFT REWRITES ONE PERSON'S
// SCORE, NOT THE WHOLE ORG'S. Guards donor data and the database under it: on
// 4 Nov prod was down ~2.5 hours behind one autovacuum ANALYZE of donor_scores,
// a table that churned because every gift, merge, link, import and "profile
// with no score row" deleted and reinserted every row in the org.
//
// On a fresh org holding the 1,000-donor messy file (tests/fixtures/fix33):
//   §1 the import writes the org's rows once, and a full pass with nothing
//      changed writes none;
//   §2 one gift, one merge, one link each write at most 5 donor_scores rows;
//   §3 opening 20 profiles of people with no score row writes nothing inline
//      and queues at most one recompute, and each still shows a score;
//   §4 ten quick gifts queue at most two recomputes;
//   §5 between passes, the people a change touched are in the band the full
//      pass gives them (or the test names the cut-point case); after one full
//      pass every row equals a from-scratch compute of the org.
//
// "Rows written" is counted per org from the rows' own xmin (a row inserted or
// updated since the mark), so other suites on the same database cannot move
// it; "rows replaced" is the org's rows from before the mark that are gone or
// rewritten (each one a dead tuple). SCORES1_MEASURE=1 also reads
// pg_stat_user_tables for the REPORT's table (it waits for the stats to flush).
//
// HOW IT GOES RED ON MAIN: recomputeOrgScores deletes the org's rows and
// reinserts them all (§1, §2: ≥ 1,000 rows); GET /donors/:id/scores recomputes
// the org inline (§3). Planted: put `DELETE FROM donor_scores WHERE org_id = ?`
// back and §1/§2 go red (and the arch-check's score-deletes rule); take the
// fold out of server/donors/handlers/scores.js and §4 goes red.
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, importWorkSettled, drainQueue } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");

const ORG = "org_scores1";
const MEASURE = process.env.SCORES1_MEASURE === "1";
const TABLES = ["donor_scores", "donor_rhythm", "donor_drift", "donor_relationships", "audiences", "gifts", "interactions", "tasks", "threads",
  "import_merges", "imports", "donors", "households", "fin_transactions", "fin_funds", "accounts", "budgets", "job_queue", "users"];

async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (let i = 0; i < 25; i++) {
    const err = await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => null, e => e);
    if (!err) break;
    const t = err.table || (/on table "(\w+)"/.exec(err.message || "") || [])[1];
    if (!t || t === "orgs") throw err;
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]);
  }
}

async function makeOrg() {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Scores One','scores1',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Scores Admin','admin')`,
    ["u_" + ORG, ORG, "scores1@test.local", bcrypt.hashSync("loadtest1234", 10)]);
  return login("scores1@test.local");
}

// The DonorImport page's own steps (as tests/groups2-starters.test.js drives them).
async function importThousand(tok) {
  const lib = await import("../shared/importShape.js");
  const cfs = await import("../shared/customFieldShape.js");
  const K = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "fix33", "answer-key.json"), "utf8"));
  const a = lib.analyzeCsvText(fs.readFileSync(path.join(__dirname, "fixtures", "fix33", "steward-test-1000-donors-messy.csv"), "utf8"));
  const tx = lib.autoDetectTxMapping(a.headers, a.rows);
  const plan = cfs.buildMapperPlan({ headers: a.physical.headerCells, fields: a.headers, rows: a.rows, txMap: tx });
  const flagColumns = {};
  for (const c of plan.columns) if (c.status === "flag" && c.flag !== "exclusion" && c.flag !== "frequency") flagColumns[c.flag] = c.field;
  const built = lib.buildTransactionRows({ headers: a.headers, rows: a.rows }, tx,
    { rowLines: a.rowLines, today: K.anchorDate, dateConvention: "mdy", flagColumns,
      coerceCustomValue: cfs.coerceCustomValue, parseBoolValue: cfs.parseBoolValue, parseExclusionValue: cfs.parseExclusionValue });
  const byD = new Map();
  for (const g of built.gifts) { if (!byD.has(g.donorIndex)) byD.set(g.donorIndex, []); byD.get(g.donorIndex).push(g); }
  for (let start = 0; start < built.donors.length; start += 500) {
    const slice = built.donors.slice(start, start + 500);
    const cg = [];
    slice.forEach((_, li) => (byD.get(start + li) || []).forEach(g => { const { donorIndex, ...rest } = g; cg.push({ ...rest, donorIndex: li }); }));
    const r = await api("POST", "/donors/import-combined", tok, { donors: slice, gifts: cg, identityResolved: true });
    if (r.status !== 200) throw new Error("import chunk " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
  }
  await importWorkSettled();
  return built.donors.length;
}

// ── COUNTING ────────────────────────────────────────────────────────────────
// On main a score job is enqueued without being waited for (after the answer,
// and after the after-change handler finishes), so a drain can return before
// its row exists. Settled is: drained, and no new score job a moment later.
async function settle() {
  const jobs = async () => (await q(`SELECT COUNT(*)::int AS n FROM job_queue WHERE org_id=$1 AND name='handler:scores'`, [ORG]))[0].n;
  for (let last = -1, n = await jobs(); n !== last; last = n, n = await jobs()) {
    await drainQueue({ orgId: ORG, scores: true, timeout: 120000 });
    await new Promise(r => setTimeout(r, 600));
  }
  await drainQueue({ orgId: ORG, scores: true, timeout: 120000 });
}
async function stat() {
  await q(`SELECT pg_stat_clear_snapshot()`);
  const [r] = await q(`SELECT n_tup_ins::int AS ins, n_tup_upd::int AS upd, n_tup_del::int AS del, n_dead_tup::int AS dead
                         FROM pg_stat_user_tables WHERE relname = 'donor_scores'`);
  return r;
}
const flushStats = () => new Promise(r => setTimeout(r, 11500));   // a backend flushes its counts within 10 s of going idle
async function mark() {
  const [{ x }] = await q(`SELECT (txid_current() % 4294967296)::bigint AS x`);
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM donor_scores WHERE org_id = $1`, [ORG]);
  const [{ j }] = await q(`SELECT COUNT(*)::int AS j FROM job_queue WHERE org_id = $1 AND name = 'handler:scores'`, [ORG]);
  return { x, n, j, stat: MEASURE ? (await flushStats(), await stat()) : null };
}
async function since(m) {
  const [r] = await q(
    `SELECT COUNT(*) FILTER (WHERE xmin::text::bigint >= $2)::int AS written,
            COUNT(*) FILTER (WHERE xmin::text::bigint < $2)::int AS kept
       FROM donor_scores WHERE org_id = $1`, [ORG, m.x]);
  const [{ j }] = await q(`SELECT COUNT(*)::int AS j FROM job_queue WHERE org_id = $1 AND name = 'handler:scores'`, [ORG]);
  const out = { written: r.written, replaced: m.n - r.kept, jobs: j - m.j };
  if (MEASURE) {
    await flushStats();
    const s = await stat();
    out.pgTuples = (s.ins - m.stat.ins) + (s.upd - m.stat.upd) + (s.del - m.stat.del);
    out.pgDead = s.dead - m.stat.dead;
  }
  return out;
}
const TABLE = [];
const row = (what, r) => { TABLE.push({ what, ...r }); console.log(`  ·  ${what}: ${JSON.stringify(r)}`); };

async function scoresOf(ids = null) {
  const rows = await q(`SELECT donor_id, engagement, generosity, band, pattern, on_time_through,
                               regexp_replace(COALESCE(reason, ''), ', the (latest|most recent touch) [^.,]*\\.$', '.') AS reason, last_touch, parts
                          FROM donor_scores WHERE org_id = $1${ids ? " AND donor_id = ANY($2)" : ""} ORDER BY donor_id`, ids ? [ORG, ids] : [ORG]);
  return new Map(rows.map(r => [r.donor_id, r]));
}
const fullPass = tok => api("POST", "/scores/recompute", tok);

(async () => {
  await reset();
  const T = await makeOrg();
  const today = civilDay();

  // §1 THE IMPORT, AND A FULL PASS WITH NOTHING CHANGED ─────────────────────
  let m = await mark();
  const people = await importThousand(T);
  await settle();
  const imp = await since(m);
  row("the 1,000-person import, end to end", imp);
  ok(`the 1,000-donor file imported (${people} people)`, people >= 1000, people);
  const [{ n: scored }] = await q(`SELECT COUNT(*)::int AS n FROM donor_scores WHERE org_id=$1`, [ORG]);
  ok(`every person has a score row after the import (${scored})`, scored >= people, { scored, people });
  ok("the import queued at most two score recomputes, never one per gift or person", imp.jobs <= 2, imp);

  // Calls on file for 300 of them, on different days, so engagement has a
  // population too (the file holds gifts only).
  const all0 = (await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY id`, [ORG])).map(r => r.id);
  for (let i = 0; i < 300; i++) {
    for (let k = 0; k <= i % 4; k++)
      await q(`INSERT INTO interactions (id, org_id, donor_id, type, date, created_by) VALUES ($1,$2,$3,'call',$4,'system:test')`,
        [`ix_s1_${i}_${k}`, ORG, all0[i * 3], dayOffset(-((i * 7 + k * 31) % 600))]);
  }
  await fullPass(T);

  m = await mark();
  const fp = await fullPass(T);
  const quiet = await since(m);
  row("one full pass, nothing changed", quiet);
  ok("a full pass with nothing changed writes no donor_scores row", fp.status === 200 && quiet.written === 0 && quiet.replaced === 0, { status: fp.status, ...quiet });

  const ids = (await q(`SELECT d.id FROM donors d WHERE d.org_id=$1 AND d.deleted_at IS NULL ORDER BY d.id`, [ORG])).map(r => r.id);
  const before = await scoresOf();

  // §2 ONE GIFT, ONE MERGE, ONE LINK ─────────────────────────────────────────
  const giver = ids[17];
  m = await mark();
  const g = await api("POST", `/donors/${giver}/gifts`, T, { amount: 250, date: today, type: "one-time" });
  await settle();
  const oneGift = await since(m);
  row("one gift", oneGift);
  ok("one gift is recorded", g.status === 200 || g.status === 201, g.status);
  ok("one gift writes at most 5 donor_scores rows", oneGift.written <= 5 && oneGift.replaced <= 5, oneGift);
  const afterGift = await scoresOf([giver]);
  ok("the giver's own row is the one rewritten", JSON.stringify(afterGift.get(giver).parts) !== JSON.stringify(before.get(giver).parts));

  const [pa, pb] = [ids[40], ids[41]];
  m = await mark();
  const mg = await api("POST", "/donors/merge", T, { primaryId: pa, secondaryId: pb });
  await settle();
  const merge = await since(m);
  row("one merge", merge);
  ok("one merge goes through", mg.status === 200, { status: mg.status, body: mg.body });
  ok("one merge writes at most 5 donor_scores rows", merge.written <= 5 && merge.replaced <= 5, merge);

  const [la, lb] = [ids[60], ids[61]];
  m = await mark();
  const ln = await api("POST", `/donors/${la}/relationships`, T, { relatedDonorId: lb, relationshipType: "spouse" });
  await settle();
  const link = await since(m);
  row("one link (spouse)", link);
  ok("one link goes through", ln.status === 200 || ln.status === 201, { status: ln.status, body: ln.body });
  ok("one link writes at most 5 donor_scores rows", link.written <= 5 && link.replaced <= 5, link);

  // §3 OPENING PROFILES OF PEOPLE WITH NO SCORE ROW ─────────────────────────
  // Their rows are taken away (as a person added a moment ago has none), then
  // their profiles are opened, one after another, as a person clicking does.
  const fresh = ids.slice(100, 120);
  const want = await scoresOf(fresh);
  await q(`DELETE FROM donor_scores WHERE org_id=$1 AND donor_id = ANY($2)`, [ORG, fresh]);
  m = await mark();
  const shown = [];
  for (const id of fresh) shown.push((await api("GET", `/donors/${id}/scores`, T)).body);
  const inline = await since(m);
  const [{ w: waiting }] = await q(`SELECT COUNT(*)::int AS w FROM job_queue WHERE org_id=$1 AND name='handler:scores' AND status IN ('waiting','running')`, [ORG]);
  row("opening 20 profiles with no score row (inline, before the queue runs)", { ...inline, queuedOrRunning: waiting });
  ok("opening 20 profiles writes no donor_scores row inline", inline.written === 0, inline);
  ok("opening 20 profiles queues at most one recompute", inline.jobs <= 1 && waiting <= 1, { ...inline, waiting });
  // Each is scored on the fly against the stored population, which is missing
  // the other nineteen for now (the cut-point case): each score within 2 points.
  const offBy = fresh.map((id, i) => [id, shown[i] && shown[i].engagement, want.get(id).engagement, shown[i] && shown[i].generosity, want.get(id).generosity])
    .filter(([, e1, e2, g1, g2]) => !(Math.abs(e1 - e2) <= 2) || !(Math.abs(g1 - g2) <= 2));
  ok("each of the 20 shows a score within 2 points of the compute's (the stored population lacks the other 19)", offBy.length === 0, offBy.slice(0, 5));
  await settle();
  const later = await since(m);
  row("opening 20 profiles (after the queued recompute ran)", later);
  ok("the one queued recompute writes the 20 rows and no others", later.written <= 20 + 5, later);

  // §4 TEN QUICK GIFTS ──────────────────────────────────────────────────────
  const tenBefore = await scoresOf(ids.slice(200, 210));
  m = await mark();
  for (let i = 0; i < 10; i++) await api("POST", `/donors/${ids[200 + i]}/gifts`, T, { amount: 40 + i, date: today, type: "one-time" });
  await settle();
  const ten = await since(m);
  row("ten quick gifts (ten people)", ten);
  ok("ten quick gifts queue at most two recomputes", ten.jobs <= 2, ten);
  ok("ten quick gifts write at most 5 rows each", ten.written <= 50, ten);
  const tenAfter = await scoresOf(ids.slice(200, 210));
  const missed = ids.slice(200, 210).filter(id => JSON.stringify(tenAfter.get(id).parts) === JSON.stringify(tenBefore.get(id).parts));
  ok("all ten givers are rescored (a folded ask keeps everyone's people)", missed.length === 0, missed);

  // §5 BETWEEN PASSES, THEN ONE FULL PASS, THEN FROM SCRATCH ─────────────────
  const touched = [giver, pa, la, lb, ...ids.slice(200, 210)];
  const between = await scoresOf(touched);
  m = await mark();
  await fullPass(T);
  const pass = await since(m);
  row("one full scheduled pass after the changes", pass);
  const full = await scoresOf();
  const bandOff = touched.filter(id => between.get(id) && full.get(id) && between.get(id).band !== full.get(id).band);
  // The cut-point case: a person scored between passes against the stored
  // population, which the full pass then refreshes. Only their own value moved,
  // so their band can only differ when a score sits on a band's edge.
  ok("between passes, every changed person is in the band the full pass gives (cut-point case: none here)", bandOff.length === 0,
    bandOff.map(id => [id, between.get(id).engagement, full.get(id).engagement]));
  const genOff = touched.filter(id => between.get(id) && full.get(id) && Math.abs(between.get(id).generosity - full.get(id).generosity) > 2);
  ok("between passes, a changed person's generosity is within 2 points of the full pass's", genOff.length === 0,
    genOff.map(id => [id, between.get(id).generosity, full.get(id).generosity]));

  m = await mark();
  await fullPass(T);
  const again = await since(m);
  row("a second full pass, nothing changed", again);
  ok("a second full pass writes nothing", again.written === 0 && again.replaced === 0, again);

  // From scratch: the org's rows taken away, one full pass computes them all anew.
  await q(`DELETE FROM donor_scores WHERE org_id=$1`, [ORG]);
  await fullPass(T);
  const scratch = await scoresOf();
  const cols = ["engagement", "generosity", "band", "pattern", "on_time_through", "reason", "last_touch"];
  const differ = [...new Set([...full.keys(), ...scratch.keys()])].filter(id => {
    const a = full.get(id), b = scratch.get(id);
    return !a || !b || cols.some(c => String(a[c]) !== String(b[c])) || JSON.stringify(a.parts) !== JSON.stringify(b.parts);
  });
  ok(`after the changes and one full pass, every row equals a from-scratch compute (${scratch.size} people)`,
    differ.length === 0 && scratch.size === full.size, { differ: differ.slice(0, 5), full: full.size, scratch: scratch.size });
  ok("the merged-away person has no score row", !scratch.has(pb) && !full.has(pb));

  console.log("\n  SCORES-1 measurements\n" + TABLE.map(r => "  " + JSON.stringify(r)).join("\n"));
  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); await closeDb().catch(() => {}); summary(); });
