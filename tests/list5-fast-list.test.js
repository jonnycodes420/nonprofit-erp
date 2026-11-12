#!/usr/bin/env node
// LIST-5 · THE DONORS LIST OPENS FAST, AND SAYS THE SAME THING.
//
// Guards donor data: GET /donors was made faster (one grouped count for
// Everyone, Donors and Contacts; the page's total read off it; the page's own
// reads side by side; gifts_person_money so Lifetime's sort reads the index
// only). Speed is worth nothing if a row, a count or a number moved, so:
//
//   §1 SAME ANSWERS. On a 10,000-person org with contacts, archived people,
//      imported totals and a stored rollup that is stale for everyone, each
//      view's people, their order, the total, the role counts, each row's gift
//      count and Lifetime are what main's statements give: the role counts
//      counted one by one, the page as one flat SELECT, the total by its own
//      COUNT, gift counts by shared/numbers/giftCount.js and Lifetime by
//      shared/numbers/lifetime.js (the profile's two numbers).
//      Planted: the row's gift count read from the stored rollup → red.
//   §2 KEPT FAST. The default view (Donors, Lifetime order, page 1, the default
//      columns) answers in under 700 ms of server time, median of 5 after one
//      warm-up; and one read probes gifts fewer than 1.25 times per person in
//      the org (Lifetime's order is one probe per person; a second per-person
//      subquery over the whole org doubles it).
//      Planted: a per-person gift count put back into the WHERE → red.
//
// Against a booted server at $BASE (tests/README.md). Seeds its own org with
// made-up people (scripts/load/seed-many.js seedOrg).
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");
const { withinBudget } = require("./lib/budget");
const timed = withinBudget(ok);

const BASE = process.env.BASE || "http://localhost:5601";
const ORG = { id: "org_list5big", slug: "list5big", name: "Thornbury Sea Scouts", tier: "medium", n: 11,
  donors: 10000, gifts: 60000, interactions: 4000, tasks: 50, subs: 20, users: 1 };
const COLS = "name,stage,owner,lifetime,last_gift_date,engagement,generosity";
const W = (c, j = "and") => encodeURIComponent(JSON.stringify({ join: j, conditions: c }));

async function seed() {
  const tabs = await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`);
  await q("SET session_replication_role = replica");
  for (const t of tabs) await q(`DELETE FROM ${t.table_name} WHERE org_id=$1`, [ORG.id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG.id]);
  await q("SET session_replication_role = origin");
  const SM = require("../scripts/load/seed-many.js");
  await SM.seedOrg(ORG, bcrypt.hashSync("loadtest1234", 8));
  // The shapes a real file has: one in five a contact (not a donor), some
  // archived, some with an old system's total, and a stored rollup that is
  // wrong for everyone (so a list that reads it cannot agree by accident).
  await q(`UPDATE donors SET person_types='["volunteer"]'::jsonb WHERE org_id=$1 AND id ~ '_d[0-9]*[37]$'`, [ORG.id]);
  await q(`UPDATE donors SET archived_at=NOW() WHERE org_id=$1 AND id ~ '_d[0-9]*11$'`, [ORG.id]);
  await q(`UPDATE donors SET imported_total=2500, imported_through='2023-12-31' WHERE org_id=$1 AND id ~ '_d[0-9]*5$'`, [ORG.id]);
  await q(`UPDATE donors SET gift_count=COALESCE(gift_count,0)+3, total_giving=COALESCE(total_giving,0)+1 WHERE org_id=$1`, [ORG.id]);
  await SM.pool.query("ANALYZE donors; ANALYZE gifts");
}

const stTimes = h => Object.fromEntries(String(h || "").split(",").map(p => /(\w+);dur=(\d+)/.exec(p)).filter(Boolean).map(m => [m[1], +m[2]]));
// The read's own time: its steps in order (the page's reads run side by side under "rows").
const serverMs = st => ["roles", "filter", "page", "rows"].reduce((n, k) => n + (st[k] || 0), 0);

(async () => {
  console.log("list5-fast-list (LIST-5)");
  await seed();
  // gifts_person_money is built in the background after boot; wait for it.
  for (let i = 0; i < 120; i++) {
    const [r] = await q(`SELECT bool_or(i.indisvalid) AS v FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname='gifts_person_money'`);
    if (r && r.v) break;
    await new Promise(r => setTimeout(r, 500));
  }
  const tok = (await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `admin@${ORG.slug}.load`, password: "loadtest1234" }) })).json()).token;
  const get = async qs => { const r = await fetch(`${BASE}/donors?${qs}`, { headers: { Authorization: "Bearer " + tok } }); return { status: r.status, st: stTimes(r.headers.get("server-timing")), body: await r.json() }; };

  // ── §1 SAME ANSWERS ───────────────────────────────────────────────────────
  console.log("\n§1 every view says what main's statements say");
  const GR = require("../groups.js");
  const GC = require("../shared/numbers/giftCount");
  const LT = require("../shared/numbers/lifetime");
  const PM = require("../server/donors/personMatch");
  const PT = await import("../shared/personType.js");
  const num = sql => { let i = 0; return sql.replace(/\?/g, () => "$" + (++i)); };
  const qq = (sql, args) => q(num(sql), args);
  // main's buildDonorListFilter, for an admin (no portfolio narrowing)
  const filterOf = async p => {
    if (String(p.archived || "") === "1") return GR.buildDonorFilter(ORG.id, p, {}).then(f => ({ ...f, whereSql: `${f.whereSql} AND archived_at IS NOT NULL` }));
    if (String(p.search || "").trim()) return GR.buildDonorFilter(ORG.id, p, {});
    return GR.buildDonorFilter(ORG.id, p, { hideArchived: true });
  };
  const countOf = async f => parseInt((await qq(`SELECT COUNT(*) AS c FROM donors WHERE ${f.whereSql}`, f.params))[0].c, 10);
  async function mainAnswer(p) {
    let role = p.role;
    const everyone = await countOf(await filterOf({ ...p, role: "" }));
    const donors = await countOf(await filterOf({ ...p, role: "donor" }));
    if (role === "auto" && String(p.search || "").trim()) role = "";
    if (role === "auto") {
      const [{ c }] = await qq(`SELECT COUNT(*) AS c FROM donors WHERE org_id=? AND deleted_at IS NULL AND archived_at IS NULL AND ${PT.donorOnlySql()}`, [ORG.id]);
      role = parseInt(c, 10) > 0 ? "donor" : "";
    }
    const f = await filterOf({ ...p, role });
    let orderBy = f.orderBy, orderArgs = [];
    const s = String(p.search || "").trim();
    if (s && !p.dir) { orderBy = `(${PM.FOLD("donors.name")} LIKE ? ESCAPE '\\') DESC, ${orderBy}`; orderArgs = [PM.foldedPattern(s)]; }
    const rows = await qq(`SELECT donors.*${f.selectCols} FROM donors WHERE ${f.whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...f.selectArgs, ...f.params, ...orderArgs, Number(p.limit), Number(p.offset || 0)]);
    const ids = rows.map(r => r.id);
    return { ids, total: await countOf(f), roleCounts: { everyone, donors, contacts: everyone - donors },
      gc: await GC.giftCounts(qq, ORG.id, ids), lt: await LT.lifetimeCents(qq, ORG.id, ids) };
  }
  const VIEWS = [
    { label: "the default view (Donors, page 1)", p: { role: "auto" } },
    { label: "Everyone", p: {} },
    { label: "Donors", p: { role: "donor" } },
    { label: "Contacts", p: { role: "contact" } },
    { label: "Donors, page 3", p: { role: "donor", offset: 100 } },
    { label: "a search (smi)", p: { role: "auto", search: "smi" } },
    { label: "a search among donors (oak)", p: { role: "donor", search: "oak" } },
    { label: "sorted by total given", p: { role: "donor", sort: "total_giving" } },
    { label: "Lifetime, lowest first", p: { role: "donor", sort: "lifetime", dir: "asc" } },
    { label: "Name", p: { role: "donor", sort: "name" } },
    { label: "Last gift, oldest first", p: { role: "donor", sort: "last_gift_date", dir: "asc" } },
    { label: "a level (Major)", p: { role: "donor", level: "major" } },
    { label: "a stage", p: { role: "donor", stage: "cultivate" } },
    { label: "archived", p: { archived: "1" } },
    { label: "a saved view: two conditions (and)", p: { role: "donor", where: [[{ field: "lifetime", op: "gte", value: "100" }, { field: "last_gift_date", op: "after", value: "2024-01-01" }], "and"] } },
    { label: "a saved view: two conditions (or)", p: { role: "auto", where: [[{ field: "lifetime", op: "gte", value: "5000" }, { field: "state", op: "is", value: "AL" }], "or"] } },
  ];
  for (const v of VIEWS) {
    const p = { limit: 50, offset: 0, ...v.p };
    const qs = Object.entries({ ...p, roleCounts: 1, cols: COLS }).map(([k, x]) => `${k}=${k === "where" ? W(...x) : encodeURIComponent(x)}`).join("&");
    const ref = await mainAnswer(p.where ? { ...p, where: JSON.stringify({ join: p.where[1], conditions: p.where[0] }) } : p);
    const now = await get(qs);
    const rows = now.body.donors || [];
    const got = { ids: rows.map(d => d.id), total: now.body.total, roleCounts: now.body.roleCounts };
    const want = { ids: ref.ids, total: ref.total, roleCounts: ref.roleCounts };
    const badCount = rows.filter(d => d.gift_count !== (ref.gc.get(d.id) || 0)).map(d => [d.id, d.gift_count, ref.gc.get(d.id)]);
    const badLife = rows.filter(d => Math.round(Number(d.total_giving) * 100) !== ref.lt.get(d.id)).map(d => [d.id, d.total_giving, ref.lt.get(d.id)]);
    ok(`§1 ${v.label}: the same ${want.ids.length} people in the same order, total ${want.total}, roles ${JSON.stringify(want.roleCounts)}`,
      now.status === 200 && JSON.stringify(got) === JSON.stringify(want),
      now.status !== 200 ? now.body : { got: { ...got, ids: got.ids.slice(0, 5) }, want: { ...want, ids: want.ids.slice(0, 5) } });
    ok(`§1 ${v.label}: every row's gift count and Lifetime are the profile's`, badCount.length === 0 && badLife.length === 0, { badCount: badCount.slice(0, 3), badLife: badLife.slice(0, 3) });
  }
  // The fixture really has the shapes the views are about.
  const [shape] = await q(`SELECT COUNT(*) FILTER (WHERE person_types @> '["volunteer"]') AS contacts, COUNT(*) FILTER (WHERE archived_at IS NOT NULL) AS archived,
      COUNT(*) FILTER (WHERE imported_total IS NOT NULL) AS imported FROM donors WHERE org_id=$1`, [ORG.id]);
  ok("§1 the fixture has contacts, archived people and imported totals", shape.contacts > 0 && shape.archived > 0 && shape.imported > 0, shape);

  // ── §2 KEPT FAST ──────────────────────────────────────────────────────────
  console.log("\n§2 the default view on 10,000 people");
  const DEFAULT = `limit=50&offset=0&role=auto&roleCounts=1&cols=${COLS}`;
  await get(DEFAULT);   // warm once
  const runs = [];
  for (let i = 0; i < 5; i++) runs.push(serverMs((await get(DEFAULT)).st));
  const median = runs.slice().sort((a, b) => a - b)[2];
  timed("§2 the default view's server time, median of 5, is under 700 ms", { ms: median, budget: 700, extra: { median, runs } });
  // Index probes of gifts by one read, from the database's own counters (each
  // backend reports them up to 10 s after it goes idle, so a reading counts once it has held for 11 s).
  const probes = async () => Number((await q(`SELECT COALESCE(idx_scan,0) + COALESCE(seq_scan,0) AS n FROM pg_stat_user_tables WHERE relname='gifts'`))[0].n);
  const settle = async () => { let last = -1, same = 0; for (let i = 0; i < 80 && same < 22; i++) { await new Promise(r => setTimeout(r, 500)); const n = await probes(); same = n === last ? same + 1 : 0; last = n; } return last; };
  const before = await settle();
  await get(DEFAULT);
  const after = await settle();
  const people = 10000, perRead = after - before;
  ok(`§2 one read probes gifts fewer than ${people * 1.25} times (${people} people: Lifetime's order is one probe each, nothing else per person)`,
    perRead > 0 && perRead < people * 1.25, perRead);

  summary();
  await closeDb();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
