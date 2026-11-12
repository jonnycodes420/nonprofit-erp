// tests/reports-speed2.test.js · REPORTS-SPEED-2. YEAR-OVER-YEAR AND ANNUAL,
// THE SAME ANSWERS, AND THEY NO LONGER FILL THE POOL.
//
// The nightly load test was red: year-over-year p95 11.7 s, Annual 5.9 s, the
// web's ten connections all in use. Year-over-year now reads every span in one
// pass (shared/numbers/byYear.js orgYearsSql); Annual's reads go out together
// and every report statement takes a place in the report lane, a third of the
// pool (server/shared/reportLane.js). Both guard money figures on a screen.
//
//   §1  SAME ANSWERS. Four orgs: one with undated gifts and a July year, one
//       with refunds (a negative row and a gift refunded in full), one with
//       soft and matching credits, one with twelve years of history (calendar
//       years, an imported first gift, a deleted and an erased person, a gift
//       scheduled for next month). Year-over-year and Annual (this year, last
//       year, three years back, fiscal and calendar) through the server are
//       compared with main's own code, frozen in tests/lib/reportsSpeed2Main.js,
//       every number and every row (the JSON, byte for byte); and each year's
//       total, gift count and donors worked out by hand from the raw rows.
//   §2  KEEP IT FAST. A 10,000-person org (the load test's generator). Alone,
//       year-over-year sends four statements after sign-in (main: seven) and answers
//       under 1,000 ms, Annual under 1,500 ms. Then ten report reads at once
//       (year-over-year and Annual, never a stored answer) beside a stream of
//       Donors list reads: every report answers inside its budget, the list
//       keeps being served, and the connections report requests hold by any
//       path (the lane's, or one taken out directly) stay under 70% of
//       DB_POOL_MAX (reportLane.stats().heldPeak, on /health). The whole pool's
//       peak is not the measure here: the in-process queue and the Donors
//       list's own parallel reads move it whatever the reports do.
//
// HOW IT GOES RED (planted, seen red before green; REPORTS-SPEED-2 report):
//   * refunds counted: orgYearsSql's gift count without COUNTED (a refund row
//     counted as a gift) → §1 red on the refunds org.
//   * the per-year loop back: orgByYear asks orgYearsSql once per span → §2's
//     statement count red.
//   * a connection held across JS work: reportAnnual inside withClient → §2's
//     pool budget red.
//
// Standard scratch stack (tests/README.md), booted with TEST_MODE=1. Sends nothing.
"use strict";
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb, api, civilPlusDays } = require("./helpers");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const REF = require("./lib/reportsSpeed2Main");
const { CREDIT_TYPES } = require("../creditTypes");

const ORGS = [
  { id: "org_rs2undated", fiscal: 7, kind: "undated" },
  { id: "org_rs2refunds", fiscal: 1, kind: "refunds" },
  { id: "org_rs2soft", fiscal: 10, kind: "soft" },
  { id: "org_rs2long", fiscal: 1, kind: "long" },
];
const BIG = { n: 980, tier: "rs2", id: "org_rs2big", slug: "rs2big", name: "Report Speed Big", donors: 10000,
  gifts: 60000, interactions: 0, tasks: 0, subs: 0, users: 1 };
const NAMES = ["Ada Quill", "Bram Stoke", "Cora Lind", "Dex Morrow", "Edda Vance", "Finn Hale", "Gia Thorne", "Hugo Pell",
  "Iris Wren", "Jude Calloway", "Kit Ambrose", "Lena Fosse", "Milo Dunst", "Nora Pike", "Otto Brack", "Pia Lund",
  "Quinn Ash", "Rafe Moll", "Sela Brook", "Tam Oakes"];
const day = n => civilPlusDays(n);
const query = async (sql, args = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), args); };

async function wipe(org) {
  for (const t of ["gift_soft_credits", "gift_fund_lines", "gifts", "org_summary", "interactions", "tasks"]) {
    await q(`DELETE FROM ${t} WHERE ${t === "org_summary" ? "org_key" : "org_id"}=$1`, [org]).catch(() => {});
  }
  await q(`DELETE FROM donors WHERE org_id=$1`, [org]);
}
async function fixture(o, i) {
  const org = o.id;
  await wipe(org);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,vocabulary_json)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',$4) ON CONFLICT (id) DO UPDATE SET vocabulary_json=EXCLUDED.vocabulary_json`,
    [org, `Report Speed Two ${i + 1}`, `report-speed-two-${i + 1}`, JSON.stringify({ fiscal_year_start_month: o.fiscal })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Rhea Speed','admin')
           ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, org_id=EXCLUDED.org_id`,
    [`u_${org}`, org, `admin@${org}.test`, bcrypt.hashSync("loadtest1234", 4)]);
  const yearsBack = o.kind === "long" ? 12 : 5;
  let g = 0;
  const gift = (id, amt, date, extra = {}) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,refunded_in_full,scheduled_on) VALUES ($1,$2,$3,$4,$5,$6,'Check',$7,$8)`,
    [`g_${org}_${++g}`, org, id, amt, date, extra.type || "cash", extra.refunded || null, extra.scheduled || null]);
  for (let p = 0; p < NAMES.length; p++) {
    const id = `d_${org}_${p}`;
    const imported = o.kind === "long" && p < 3 ? day(-(14 * 365)) : null;
    const deleted = o.kind === "long" && p === 5 ? `${day(-3)}T12:00:00.000Z` : null;
    const erased = o.kind === "long" && p === 6 ? `${day(-3)}T12:00:00.000Z` : null;
    await q(`INSERT INTO donors (id,org_id,name,email,kind,created_by,created_by_name,imported_first_gift_date,deleted_at,erased_at)
             VALUES ($1,$2,$3,$4,'individual',$5,'Rhea Speed',$6,$7,$8)`,
      [id, org, NAMES[p], `p${p}@${org}.test`, `u_${org}`, imported, deleted, erased]);
    // A rhythm per person: every year, lapsed, new this year, on and off.
    for (let y = yearsBack; y >= 0; y--) {
      const r = (p * 7 + y * 3 + i) % 5;
      if (r === 0 || (r === 1 && y > 2) || (r === 2 && y < 2) || (r === 3 && y % 2 === 0)) {
        const amt = 25 + ((p * 37 + y * 11 + i * 7) % 400) + (y % 3 ? 0.5 : 0);
        await gift(id, amt, day(-(y * 365 + 15 + ((p * 13 + i * 9) % 300))));
      }
    }
  }
  const P = n => `d_${org}_${n}`;
  if (o.kind === "undated") {
    await gift(P(1), 120, null); await gift(P(2), 80, ""); await gift(P(3), 45, "sometime in 2019");
  }
  if (o.kind === "refunds") {
    await gift(P(4), 200, day(-40)); await gift(P(4), -200, day(-35));               // given and taken back
    await gift(P(7), 150, day(-400), { refunded: true });                              // refunded in full, last year
    await gift(P(9), 60, day(-10)); await gift(P(9), -25, day(-8));                    // a partial refund
    await gift(P(11), -30, day(-20));                                                  // a refund alone in the year
  }
  if (o.kind === "soft") {
    await gift(P(2), 300, day(-50), { type: "soft credit" });
    await gift(P(3), 150, day(-420), { type: "matching gift credit" });
    const [hard] = await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2 AND amount > 0 ORDER BY date DESC LIMIT 1`, [org, P(0)]);
    if (hard) await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,role,created_by,created_by_name) VALUES ($1,$2,$3,$4,50,'other',$5,'Rhea Speed')`,
      [`sc_${org}_1`, org, hard.id, P(8), `u_${org}`]).catch(e => { throw new Error("soft credit row: " + e.message); });
  }
  if (o.kind === "long") {
    await gift(P(1), 500, day(30), { scheduled: day(30) });                              // scheduled for next month
    await gift(P(2), 90, day(-(13 * 365)));                                             // older than the ten years shown
  }
}
async function token(org) { return (await api("POST", "/auth/login", null, { email: `admin@${org}.test`, password: "loadtest1234" })).body.token; }
async function get(tok, path) {
  const t0 = performance.now();
  const r = await fetch(BASE + path, { headers: { authorization: `Bearer ${tok}` } });
  return { status: r.status, body: await r.text(), ms: Math.round(performance.now() - t0) };
}
const health = async () => (await (await fetch(BASE + "/health")).json()).pool || {};
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i < Math.max(a.length, b.length) ? `at ${i}: ${a.slice(i, i + 80)} | ${b.slice(i, i + 80)}` : null; };

(async () => {
  console.log("REPORTS-SPEED-2: year-over-year and Annual, the same answers, and they no longer fill the pool\n");

  // ── §1 SAME ANSWERS ─────────────────────────────────────────────────────
  const ref = REF.main(query);
  const diffs = [];
  let compared = 0;
  for (const [i, o] of ORGS.entries()) {
    await fixture(o, i);
    const tok = await token(o.id);
    const [org] = await q(`SELECT * FROM orgs WHERE id=$1`, [o.id]);
    const yoy = await get(tok, "/reports/year-over-year");
    if (yoy.status !== 200) { diffs.push(`${o.id} year-over-year ${yoy.status} ${yoy.body.slice(0, 120)}`); continue; }
    const today = JSON.parse(yoy.body).today;
    const want = JSON.stringify(await ref.orgByYear(query, { ...org, id: o.id }, today));
    compared++;
    if (want !== yoy.body) diffs.push(`${o.id} year-over-year ${firstDiff(want, yoy.body)}`);
    // And by hand, from the raw rows (an independent key, ARCHITECTURE.md "Tests"): each year's
    // money (credit rows out, a gift scheduled after today out, a deleted person's out), its
    // counted gifts (above zero, not refunded in full) and its donors (a row above zero, not erased).
    const raw = await q(`SELECT g.amount::text AS amount, LEFT(g.date, 10) AS date, LOWER(TRIM(COALESCE(g.type, ''))) AS type, g.refunded_in_full,
                                g.scheduled_on, g.donor_id, d.deleted_at, d.erased_at
                           FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id WHERE g.org_id = $1`, [o.id]);
    for (const yr of JSON.parse(yoy.body).years) {
      const rows = raw.filter(r => !r.deleted_at && r.date && r.date >= yr.from && r.date <= yr.to && !CREDIT_TYPES.includes(r.type)
        && (!r.scheduled_on || r.scheduled_on <= today));
      const cents = rows.reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0);
      const count = rows.filter(r => Number(r.amount) > 0 && !r.refunded_in_full).length;
      const donors = new Set(rows.filter(r => Number(r.amount) > 0 && !r.erased_at).map(r => r.donor_id)).size;
      if (cents !== yr.cents || count !== yr.giftCount || donors !== yr.donors)
        diffs.push(`${o.id} ${yr.label} by hand: ${cents}/${count}/${donors} vs ${yr.cents}/${yr.giftCount}/${yr.donors}`);
    }
    const y = Number(today.slice(0, 4));
    for (const yearMode of ["fiscal", "calendar"]) {
      for (const year of [y, y - 1, y - 3]) {
        const a = await get(tok, `/reports/annual?year=${year}&yearMode=${yearMode}`);
        if (a.status !== 200) { diffs.push(`${o.id} annual ${year} ${yearMode}: ${a.status}`); continue; }
        const p = { year, yearMode, fiscalStartMonth: o.fiscal, today, org: { ...org, id: o.id } };
        const wantA = JSON.stringify(await ref.reportAnnual(o.id, p));
        compared++;
        if (wantA !== a.body) diffs.push(`${o.id} annual ${year} ${yearMode} ${firstDiff(wantA, a.body)}`);
      }
    }
  }
  ok(`§1 four orgs, ${compared} answers: year-over-year and Annual are main's, every number and every row`, diffs.length === 0 && compared === 4 * 7, diffs.slice(0, 6));
  const [refundsYoy] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND amount < 0`, [ORGS[1].id]);
  ok("§1 and the refunds org has refunds to count (the comparison is not vacuous)", refundsYoy.n >= 3, refundsYoy);

  // ── §2 KEEP IT FAST ─────────────────────────────────────────────────────
  const [have] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [BIG.id]);
  if (have.n !== BIG.donors) {
    await wipe(BIG.id);
    const { seedOrg, pool } = require("../scripts/load/seed-many");
    await seedOrg(BIG, bcrypt.hashSync("loadtest1234", 4));
    await pool.query("ANALYZE");   // every table, as ten-orgs.js seed does: fresh statistics, or the planner takes the org for one row (FIX-21)
    await pool.end();
  }
  const bigTok = (await api("POST", "/auth/login", null, { email: `admin@${BIG.slug}.load`, password: "loadtest1234" })).body.token;
  ok("§2 the 10,000-person org signs in", !!bigTok);
  const yearNow = Number(civilPlusDays(0).slice(0, 4));
  // Never a stored answer: Annual two and three years back computes every time (storedReports.isStoredAsk).
  const ANNUAL = k => `/reports/annual?year=${yearNow - 2 - (k % 2)}&yearMode=${k % 2 ? "fiscal" : "calendar"}`;
  const kindOf = path => path.match(/reports\/([a-z-]+)/)[1];
  // One quiet read of each: the time alone, and how many statements it sends after sign-in.
  const trips = r => Number(r.headers || NaN);
  const getT = async (tok, path) => {
    const t0 = performance.now();
    const r = await fetch(BASE + path, { headers: { authorization: `Bearer ${tok}` } });
    return { status: r.status, body: await r.text(), ms: Math.round(performance.now() - t0), headers: r.headers.get("x-steward-round-trips") };
  };
  await getT(bigTok, "/reports/year-over-year"); await getT(bigTok, ANNUAL(0));   // the first connect is not the report's
  const qy = await getT(bigTok, "/reports/year-over-year"), qa = await getT(bigTok, ANNUAL(0));
  console.log(`   alone: year-over-year ${qy.ms} ms in ${qy.headers} statements, Annual ${qa.ms} ms in ${qa.headers} statements`);
  ok("§2 year-over-year reads every year in one pass: 4 statements after sign-in (the org's settings twice, the first date, then every year at once)", qy.status === 200 && trips(qy) <= 4, { status: qy.status, statements: qy.headers });
  ok("§2 alone on 10,000 people: year-over-year under 1,000 ms, Annual under 1,500 ms", qy.ms < 1000 && qa.ms < 1500 && qa.status === 200, { yoy: qy.ms, annual: qa.ms });

  // Ten at once, and one person reading the Donors list over and over beside them.
  const REPORTS = [...Array(5)].flatMap((_, k) => ["/reports/year-over-year", ANNUAL(k)]);
  const BURST_MS = 8000;   // under the 10 s a statement may take before the report says it took too long
  const h0 = await health();
  const max = h0.max || 10;
  let streaming = true;
  const listMs = [];
  const stream = (async () => { while (streaming) { const r = await get(bigTok, "/donors?limit=50"); listMs.push(r.status === 200 ? r.ms : Infinity); } })();
  const results = await Promise.all(REPORTS.map(path => get(bigTok, path).then(r => ({ path, ...r }))));
  streaming = false; await stream;
  const h1 = await health();
  const lane = h1.reportLane || {};
  const over = results.filter(r => r.status !== 200 || r.ms > BURST_MS);
  console.log("   ten at once:", results.map(r => `${kindOf(r.path)} ${r.ms} ms`).join(", "));
  console.log(`   connections held by reports at most ${lane.heldPeak} of ${max} (lane ${lane.max}); ${listMs.length} Donors list reads beside them, slowest ${Math.max(...listMs)} ms`);
  ok(`§2 ten reports at once on 10,000 people: every one answers, none over ${BURST_MS} ms`, over.length === 0, over.map(r => `${r.path} ${r.status} ${r.ms} ms`));
  ok("§2 the connections report requests hold, by any path, stay under 70% of the pool", lane.heldPeak != null && lane.heldPeak < 0.7 * max, { heldPeak: lane.heldPeak, max });
  // Main: 3 reads, the slowest 2,288 ms (the reports had the pool); this build: 11, the slowest 359 ms (laptop).
  ok("§2 the Donors list kept being served beside them, none over 2,000 ms", listMs.length >= 3 && listMs.every(ms => ms < 2000), { reads: listMs.length, slowest: Math.max(...listMs) });

  summary();
  await closeDb();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
