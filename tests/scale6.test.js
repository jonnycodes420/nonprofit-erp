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

  await clean();
  summary();
  await closeDb();
})().catch(e => { console.error(e); process.exit(1); });
