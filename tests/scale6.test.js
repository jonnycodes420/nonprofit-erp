// tests/scale6.test.js · SCALE-6. GET /donors STOPS TIMING OUT UNDER LOAD.
//
// §1 The Donors list's reads ask each person's giving unit once per read, never per row.
//    The nightly load (Nov 19) had /donors at 14 s max with nine 5xx: a status filter
//    (status=major, a lifecycle, lapsing, retained) read donorStatus.statusSql, whose
//    lapse columns asked the linked people's last gift, the pledges that hold and the
//    stored rhythm once for every giver of the org. That cost estimate (1.7 million on
//    25,000 people) also turned on JIT in CI's and production's Postgres, which compiled
//    for 2 s per call (run 44756461721). Now:
//      a. every application connection runs with JIT off;
//      b. the org-wide statusSql reads the unit, the rhythm and an overdue pledge set-wise,
//         and its rows are byte-identical to the one-person form (which still reads them
//         per person) for every giver, on a fixture with links, pledges held and overdue,
//         post-dated and imported last gifts;
//      c. no list read (each status filter's page and count, and /donors/counts) runs a
//         correlated subquery over donor_relationships, pledges, donor_rhythm or
//         donor_scores for more than a page's worth of rows (EXPLAIN ANALYZE's loops).
//    Planted, each red: the unit read per giver in statusSql (§1b equal, §1c red); the
//    rhythm read per giver in countsSql (§1c red); jit=off taken off the pool (§1a red).
"use strict";
process.env.TEST_MODE = "1";
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_scale6list";
const PAGE_LOOPS = 60;   // a page is 50 rows; more reads than that is a read per row of the org
// The giving unit's tables. Not pledge_installments: a pledge reads its own installments
// (lapse.js PLEDGE_MADE) once per pledge inside the set-wise read, which is once per statement.
const UNIT_TABLES = new Set(["donor_relationships", "pledges", "donor_rhythm", "donor_scores"]);

async function clean() {
  const tabs = await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`);
  await q("SET session_replication_role = replica");
  for (const t of tabs) await q(`DELETE FROM ${t.table_name} WHERE org_id = $1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id = $1`, [ORG]);
  await q("SET session_replication_role = origin");
}

// The fixture: 1,500 made-up people and their gifts (seed-many), then what the
// giving unit reads: links of every unit type and one that is not, pledges open,
// fulfilled recently and long ago, installments paid and past due, last gifts
// dated after today (NUMBERS-7's case) and imported last gifts, and a stored rhythm.
async function seed() {
  const SM = require("../scripts/load/seed-many.js");
  await SM.seedOrg({ id: ORG, slug: "scale6list", name: "Fernhollow Reading Circle", tier: "medium", n: 6, donors: 1500, gifts: 9000,
    interactions: 600, tasks: 20, subs: 10, users: 1 }, bcrypt.hashSync("loadtest1234", 8));
  const W = "'system:test', 'SCALE-6 fixture'";
  await q(`INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type, created_by, created_by_name)
           SELECT $1 || '_rl' || i, $1, $1 || '_d' || i, $1 || '_d' || (i + 1 + (i % 37)),
                  (ARRAY['spouse','partner','owner','works_at','sibling'])[1 + i % 5], ${W}
             FROM generate_series(1, 1400, 4) i`, [ORG]);
  await q(`INSERT INTO pledges (id, org_id, donor_id, amount, due_date, status, created_at, created_by, created_by_name)
           SELECT $1 || '_pl' || i, $1, $1 || '_d' || i, 500, to_char(CURRENT_DATE + ((i % 400) - 250), 'YYYY-MM-DD'),
                  (ARRAY['open','fulfilled','open','cancelled'])[1 + i % 4], NOW() - ((i % 700) || ' days')::interval, ${W}
             FROM generate_series(2, 1490, 6) i`, [ORG]);
  await q(`INSERT INTO pledge_installments (id, org_id, pledge_id, seq, due_date, amount, paid_gift_id)
           SELECT p.id || '_i' || s, p.org_id, p.id, s, to_char(p.created_at::date + s * 90, 'YYYY-MM-DD'), 125,
                  CASE WHEN s = 1 THEN (SELECT g.id FROM gifts g WHERE g.org_id = p.org_id AND g.donor_id = p.donor_id LIMIT 1) END
             FROM pledges p, generate_series(1, 3) s WHERE p.org_id = $1 AND (substring(p.id from '_pl(\\d+)$')::int % 3) = 0`, [ORG]);
  await q(`UPDATE donors SET last_gift_date = to_char(CURRENT_DATE + 20, 'YYYY-MM-DD') WHERE org_id = $1 AND (substring(id from '_d(\\d+)$')::int % 23) = 0`, [ORG]);
  await q(`UPDATE donors SET imported_last_gift_date = to_char(CURRENT_DATE - 300, 'YYYY-MM-DD') WHERE org_id = $1 AND (substring(id from '_d(\\d+)$')::int % 29) = 0`, [ORG]);
  await q(`INSERT INTO donor_rhythm (org_id, donor_id, expected_next, created_by, created_by_name)
           SELECT $1, id, (CURRENT_DATE + ((substring(id from '_d(\\d+)$')::int % 120) - 60)), ${W} FROM donors
            WHERE org_id = $1 AND (substring(id from '_d(\\d+)$')::int % 3) = 0 ON CONFLICT DO NOTHING`, [ORG]);
  await q("ANALYZE donors; ANALYZE gifts; ANALYZE pledges; ANALYZE pledge_installments; ANALYZE donor_relationships; ANALYZE donor_rhythm");
}

// The top-level SubPlans of a plan (a correlated subquery; one nested inside another is
// part of its parent): its root's loops are how many outer rows it ran for. A page column
// runs for the page's rows (50); the defect runs for every giver of the org. Its tables
// are every relation in its subtree.
const subplans = (n, out = []) => {
  if (n["Parent Relationship"] === "SubPlan") { out.push(n); return out; }
  for (const c of n.Plans || []) subplans(c, out);
  return out;
};
const relations = (n, out = new Set()) => { if (n["Relation Name"]) out.add(n["Relation Name"]); for (const c of n.Plans || []) relations(c, out); return out; };
const num = sql => { let i = 0; return sql.replace(/\?/g, () => "$" + (++i)); };
async function perRowReads(sql, args) {
  const [row] = await q("EXPLAIN (ANALYZE, FORMAT JSON) " + num(sql), args);
  const plan = row["QUERY PLAN"][0].Plan;
  return subplans(plan).filter(n => n["Actual Loops"] > PAGE_LOOPS && [...relations(n)].some(r => UNIT_TABLES.has(r)))
    .map(n => `${[...relations(n)].filter(r => UNIT_TABLES.has(r)).join("+")} x${n["Actual Loops"]}`);
}

// ── §2 NO REQUEST WAITS FOREVER FOR A CONNECTION (item 2) ──────────────────
// In-process, on this process's own pools (server/shared/requestLimits.js).
//   a. A web request whose statement waits on a full pool answers "busy" (503,
//      "Steward is busy, try again.") at WAIT_MS (3 s), not at the 10 s limit.
//   b. Background work (no request) leaves the last RESERVE (2) connections of the
//      main pool to web reads: with every other connection held by background work,
//      a further background checkout waits while a web read still gets one, and it
//      goes ahead as soon as one comes back. A background callback's own second
//      statement is never held back (a transaction cannot wait on itself).
//   c. The client asks a read again once on "busy", and never a write.
// Planted, each red: the wait clock at the scope's limit (§2a); the background gate
// off (§2b).
async function section2() {
  const LIMITS = require("../server/shared/requestLimits");
  const { Pool } = require("pg");
  const opts = { connectionString: process.env.DATABASE_URL, ssl: /disable/.test(process.env.DB_SSL || "") ? false : undefined };
  console.log("\n§2a a request that cannot get a connection answers busy at 3 s");
  const tiny = new Pool({ ...opts, max: 1 });
  const holder = await tiny.connect();
  const fakeReq = { method: "GET", path: "/donors", __stewardInProcess: false };
  const fakeRes = { on() {}, json: x => x, statusCode: 200, status() { return this; } };
  const t0 = Date.now();
  const err = await new Promise(resolve => LIMITS.middleware(async () => {})(fakeReq, fakeRes, () => {
    LIMITS.checkout(tiny).then(c => { LIMITS.release(c); resolve(null); }, resolve);
  }));
  const waited = Date.now() - t0;
  holder.release(); await tiny.end();
  ok("§2a the wait ends as busy, a 503 with the plain sentence", !!err && err.code === "busy" && err.status === 503 && err.message === "Steward is busy, try again.", err && { code: err.code, msg: err.message });
  ok("§2a it ends at about 3 s, well before the 10 s limit", waited >= LIMITS.WAIT_MS - 100 && waited < LIMITS.WAIT_MS + 1500, waited);
  const sent = {};
  const res = { headersSent: false, status(c) { sent.status = c; return this; }, set(k, v) { sent[k] = v; return this; }, json(b) { sent.body = b; return this; } };
  LIMITS.answerError(err || {}, { method: "GET", id: "t" }, res, "/donors");
  ok("§2a the answer is 503, Retry-After 1, code busy", sent.status === 503 && sent["Retry-After"] === "1" && sent.body && sent.body.code === "busy", sent);

  console.log("\n§2b background work leaves the last two connections to web reads");
  const { pool } = require("../server/db/pool");
  // Drain what this process holds, so the count below is ours alone.
  await new Promise(r => setTimeout(r, 200));
  const max = pool.options.max, held = [];
  const fill = max - LIMITS.RESERVE - (pool.totalCount - pool.idleCount);
  for (let i = 0; i < fill; i++) held.push(await LIMITS.checkout(pool));
  let bgGot = false;
  const bg = LIMITS.checkout(pool).then(c => { bgGot = true; return c; });
  await new Promise(r => setTimeout(r, 400));
  ok(`§2b with ${max - LIMITS.RESERVE} of ${max} held by background work, one more background checkout waits`, !bgGot, { total: pool.totalCount, idle: pool.idleCount });
  const web = await new Promise((resolve, reject) => LIMITS.middleware(async () => {})({ method: "GET", path: "/donors" }, fakeRes, () => {
    LIMITS.checkout(pool).then(resolve, reject);
  }));
  ok("§2b a web read still gets a connection at once", !!web);
  LIMITS.release(web);
  LIMITS.release(held.pop());
  const bgc = await Promise.race([bg, new Promise(r => setTimeout(() => r(null), 1500))]);
  ok("§2b the waiting background checkout goes ahead when one comes back", !!bgc);
  if (bgc) LIMITS.release(bgc);
  // A background callback holding a connection asks for a second one: never held back.
  const outer = await LIMITS.checkout(pool);
  for (let i = held.length; i < max - LIMITS.RESERVE - 1; i++) held.push(await LIMITS.checkout(pool));
  const inner = await LIMITS.holding(() => Promise.race([LIMITS.checkout(pool), new Promise(r => setTimeout(() => r(null), 1500))]), outer);
  ok("§2b a background transaction's own next statement is not held back", !!inner);
  if (inner) LIMITS.release(inner);
  LIMITS.release(outer);
  while (held.length) LIMITS.release(held.pop());

  console.log("\n§2c the browser asks a busy read again once, never a write");
  const BR = await import(require("url").pathToFileURL(require("path").join(__dirname, "../client/src/lib/busyRetry.js")).href);
  ok("§2c busy is a 503 whose code is busy, and only that", BR.isBusyAnswer(503, { code: "busy" }) && !BR.isBusyAnswer(503, { code: "request_timeout" }) && !BR.isBusyAnswer(500, { code: "busy" }));
  ok("§2c a GET is asked again, a POST, PUT, PATCH or DELETE never", BR.retriesOnBusy("GET") && BR.retriesOnBusy(undefined) && !["POST", "PUT", "PATCH", "DELETE"].some(m => BR.retriesOnBusy(m)));
  const api = require("fs").readFileSync(require("path").join(__dirname, "../client/src/api.js"), "utf8");
  ok("§2c api.js asks again once (busyTries 0 only), with the retry's wait", /busyTries === 0 && isBusyAnswer\(res\.status, err\) && retriesOnBusy\(options\.method\)/.test(api) && /return apiFetchNow\(path, options, 1\)/.test(api));
}

// ── §3 THE FIRST SCREEN AFTER A SAVE SHOWS THE NEW ANSWER (item 3) ─────────
// W-1112-Volunteers-01X, nine nights. Each write the fleet named, as the screen sends
// it, against the kinds each screen showing that data actually subscribes to, read
// from its source line (so a screen that stops listening is red here, not on the
// fleet's tenth night). And the write-announce ratchet: no new write in client/src
// may announce nothing.
// Planted, each red: the sidebar badge no longer hears tasks (§3); a new write with
// no rule (§3 ratchet).
async function section3() {
  const fs = require("fs"), path = require("path");
  const CH = await import(require("url").pathToFileURL(path.join(__dirname, "../client/src/lib/changes.js")).href);
  const src = f => fs.readFileSync(path.join(__dirname, "../client/src", f), "utf8");
  // The kinds on the subscription line that carries `anchor` in file `f`.
  const kindsAt = (f, anchor) => {
    const line = src(f).split("\n").find(l => l.includes(anchor) && /use(Changed|ChangeRev|WriteRev)\(/.test(l));
    if (!line) return null;
    if (/useWriteRev\(VOLUNTEER_WRITES\)/.test(line)) return ["volunteer"];
    if (/useChanged\(PROFILE_KINDS/.test(line)) return [...(src("lib/profileRefresh.js").match(/PROFILE_KINDS = \[([^\]]*)\]/) || ["", ""])[1].matchAll(/"([a-z]+)"/g)].map(m => m[1]);
    const arr = /use(?:Changed|ChangeRev)\(\s*\[([^\]]*)\]/.exec(line);
    return arr ? [...arr[1].matchAll(/"([a-z]+)"/g)].map(m => m[1]) : null;
  };
  const P = "d_person", E = "e_event";
  const READ = {
    pledgeCard: ["Profile → Giving: pledges (useProfileGiving.jsx)", "components/profile/useProfileGiving.jsx", "loadPledges();if(fundAffinity", null],
    fundraising: ["Fundraising totals (Fundraising.jsx)", "components/Fundraising.jsx", "refresh);", null],
    header: ["Profile header: Lifetime, last gift (profileRefresh.js)", "lib/profileRefresh.js", "PROFILE_KINDS, c =>", { person: P }],
    byYear: ["Profile → Giving: By year (ByYear.jsx)", "components/profile/ByYear.jsx", "useChangeRev", { person: P }],
    portfolioDonors: ["Donors → portfolio totals (Donors.jsx)", "components/Donors.jsx", "loadOfficers();", null],
    portfolioHome: ["Home → portfolio card (PortfolioCard.jsx)", "components/home/PortfolioCard.jsx", "useChangeRev", null],
    volHeader: ["Volunteers header and counts (VolunteersHub.jsx)", "components/VolunteersHub.jsx", "const volRev", null],
    volPanel: ["Profile → Volunteer hours (VolunteerPanel.jsx)", "components/VolunteerPanel.jsx", "loadProf();", { person: P }],
    attendees: ["Event → attendee list (EventsDesk.jsx)", "components/EventsDesk.jsx", "{ event: event.id }", { event: E }],
    eventCards: ["Events → each event's summary (EventsDesk.jsx)", "components/EventsDesk.jsx", "each card's counts", null],
    eventsList: ["Events list (Events.jsx)", "components/Events.jsx", "const listRev", null],
    badge: ["Sidebar Tasks badge (taskBadge.js)", "lib/taskBadge.js", "() => load(), null, 150", null],
  };
  const PAIRS = [
    ["Pledge saved on a profile", "POST", `/donors/${P}/pledges`, null, ["pledgeCard", "fundraising", "byYear"]],
    ["Pledge payment", "PUT", "/pledges/pl_1/installments", { donorId: P }, ["pledgeCard", "fundraising"]],
    ["Gift deleted on a profile", "DELETE", "/gifts/g_1", null, ["header", "byYear", "pledgeCard", "portfolioDonors", "portfolioHome", "fundraising"]],
    ["Volunteer hours logged (Volunteers)", "POST", `/donors/${P}/volunteer-hours`, null, ["volHeader", "volPanel", "header"]],
    ["Event guest added", "POST", `/events/${E}/attendees`, null, ["attendees", "eventCards", "eventsList"]],
    ["Task completed (Tasks)", "POST", "/tasks/t_1/complete", null, ["badge"]],
    ["Next step done (Home's drift row)", "POST", `/drift/${P}/done`, null, ["badge", "header"]],
    ["Plan step done (profile rail)", "POST", "/plan-steps/ps_1/done", null, ["badge"]],
    ["Owners assigned from Home", "POST", "/home/owners/assign", null, ["portfolioDonors", "portfolioHome"]],
  ];
  console.log("\n§3 each write the fleet named reaches every screen that shows what it changed");
  for (const [what, method, p, body, reads] of PAIRS) {
    const w = CH.kindsOfWrite(p, method, body ? JSON.stringify(body) : undefined);
    const misses = [];
    for (const r of reads) {
      const [name, file, anchor, ids] = READ[r];
      const kinds = kindsAt(file, anchor);
      if (!kinds) { misses.push(`${name}: no subscription found`); continue; }
      if (!CH.reaches(w, kinds, ids)) misses.push(`${name} hears ${kinds.join(",")}, the write says ${[...w.kinds].join(",")}`);
    }
    ok(`§3 ${what} (${method} ${p}) → ${reads.map(r => READ[r][0].split(" (")[0]).join("; ")}`, !misses.length, misses);
  }
  const W2R = await import(require("url").pathToFileURL(path.join(__dirname, "../client/src/lib/writeToRead.js")).href);
  const listed = new Set(W2R.WRITE_TO_READ.map(e => `${e.method} ${e.path}`));
  ok("§3 the fleet's writes are in the write-to-read list (writeToRead.js), which flows13 checks too",
    PAIRS.every(([, m, p]) => listed.has(`${m} ${p}`)), PAIRS.filter(([, m, p]) => !listed.has(`${m} ${p}`)).map(x => x[0]));

  console.log("\n§3 no new write in client/src announces nothing (scripts/ci/write-announce-scan.mjs)");
  const scan = await import(require("url").pathToFileURL(path.join(__dirname, "../scripts/ci/write-announce-scan.mjs")).href);
  const r = scan.check();
  ok(`§3 every write in client/src announces what it changed, or is in the shrinking baseline (${r.all.length} writes, ${r.missing.length - r.fresh.length} in the baseline)`,
    r.all.length > 500 && !r.fresh.length, r.fresh.map(w => `${w.method} ${w.path} ${w.file}:${w.line}`));
}

(async () => {
  await clean();
  await seed();
  const { query } = require("../db");
  const DS = require("../donorStatus");
  const GR = require("../groups");
  const LP = require("../server/donors/listPage");
  const PC = require("../server/donors/peopleCounts");
  const today = await DS.todayFor(ORG), cuts = await DS.cutsFor(ORG);

  console.log("\n§1a every application connection runs with JIT off");
  const [{ jit }] = await query("SELECT current_setting('jit') AS jit");
  ok("§1a the pool's connections say jit = off", jit === "off", jit);

  console.log("\n§1b the org-wide status rows are the one-person rows, for every giver");
  const st = DS.statusSql(ORG, today, cuts);
  const all = await query(st.sql, st.args);
  const fx = (await q(`SELECT
      (SELECT COUNT(*)::int FROM donor_relationships WHERE org_id = $1) AS links,
      (SELECT COUNT(*)::int FROM pledges WHERE org_id = $1) AS pledges,
      (SELECT COUNT(*)::int FROM donor_rhythm WHERE org_id = $1) AS rhythms`, [ORG]))[0];
  const tally = k => all.filter(r => r[k] === true || r.lifecycle === k).length;
  ok("§1b the fixture exercises the unit: links, pledges, held, overdue, lapsing, lapsed, stored rhythms",
    fx.links > 300 && fx.pledges > 200 && fx.rhythms > 300 && tally("pledge_held") > 0 && tally("pledge_overdue") > 0 && tally("lapsing") > 0 && tally("lapsed") > 0,
    { ...fx, held: tally("pledge_held"), overdue: tally("pledge_overdue"), lapsing: tally("lapsing"), lapsed: tally("lapsed") });
  let differ = 0, first = null;
  for (const r of all) {
    const one = DS.statusSql(ORG, today, cuts, { donorId: r.donor_id });
    const [p] = await query(one.sql, one.args);
    if (JSON.stringify(p) !== JSON.stringify(r)) { differ++; first = first || { org: r, one: p }; }
  }
  ok(`§1b all ${all.length} givers: the org-wide row equals the one-person row, byte for byte`, all.length > 1000 && differ === 0, { differ, first });

  console.log("\n§1c no list read asks the giving unit once per person");
  const variants = [{}, { status: "major" }, { level: "mid" }, { lifecycle: "lapsed" }, { lifecycle: "current" }, { lapsing: "1" }, { retained: "1" }];
  for (const qs of variants) {
    const f = await GR.buildDonorFilter(ORG, qs, { hideArchived: true });
    const [sql, args] = LP.pageSql({ ...f, limit: 50, offset: 0 });
    const page = await perRowReads(sql, args);
    const count = await perRowReads(`SELECT COUNT(*) AS c FROM donors WHERE ${f.whereSql}`, f.params);
    ok(`§1c /donors ${JSON.stringify(qs)}: the page and its count read the unit tables a page's worth at most`, !page.length && !count.length, { page, count });
  }
  const c = PC.countsSql(ORG, today, null);
  const counts = await perRowReads(c.sql, c.args);
  ok("§1c /donors/counts reads the unit tables a page's worth at most", !counts.length, counts);

  await section2();
  await section3();

  await clean();
  summary();
  await closeDb();
})().catch(e => { console.error(e); process.exit(1); });
