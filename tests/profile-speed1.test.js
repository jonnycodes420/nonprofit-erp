// tests/profile-speed1.test.js · PROFILE-SPEED-1. A PROFILE OPENS IN ONE TRIP,
// WITH THE SAME ANSWERS, AND NO ONE REQUEST TAKES THE POOL.
//
// Opening a profile was two requests at once (the record, and a bundle of what
// shows above the fold) and the two together could hold all ten of the web's
// connections. Now the first screen is one request, GET /donors/:id/profile
// (server/donors/profileBundle.js), whose every part is the separate route's
// own answer, and every web request's statements share five connections
// (server/shared/pools.js PER_REQUEST_MAX, server/shared/requestLimits.js).
// It guards donor data on a screen: the profile's numbers, rail, Next step and
// timeline.
//
//   §1  SAME ANSWERS. Seven made-up people in one org: two in a household, an
//       organisation, someone deceased, someone archived, someone with soft
//       credits, someone with open pledges, and twelve years of gifts. Each
//       one's stored lifetime (donors.total_giving) is set WRONG on purpose.
//       For each: every part of /donors/:id/profile is byte for byte the
//       separate route's answer (the routes main's code serves), and byte for
//       byte LOAD-1's /donors/:id/bundle answer for the same reads; and the
//       header's Lifetime (the record's figures.lifetime and the status
//       glance) is the sum of that person's gifts worked out by hand, not the
//       stored number.
//   §2  KEEP IT FAST. A 10,000-person org (the nightly's generator). Ten people
//       open profiles the way the browser does (the first screen, then the
//       below-the-fold bundle), two read the Donors list beside them, for
//       twenty seconds. No request holds more than five connections
//       (GET /perf/peaks, TEST_MODE), every answer is a 200, and the main pool
//       is at 70% or more for under three quarters of the share main's 13
//       separate calls spend there, run the same way in the same test.
//
// HOW IT GOES RED (planted, seen red before green; PROFILE-SPEED-1 report):
//   * the bundle reading the stored rollup: profileBundle.js answering the
//     header from donors.total_giving → §1's hand-worked Lifetime red.
//   * a request using the whole pool: pools.js PER_REQUEST_MAX = POOL_MAX
//     → §2's per-request peak red.
//   * the 13 separate calls back: PS1_SHAPE=many (the first screen asked for
//     read by read) → §2's pool share red.
//
// Standard scratch stack (tests/README.md), booted with TEST_MODE=1. Sends nothing.
// battery: last — §2 is load-shaped (a 10,000-person org, 20 s of profile opens) and measures the pool, so it goes after the rest of its shard.
"use strict";
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb, api, civilPlusDays, waitFor } = require("./helpers");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const { FIRST_SCREEN } = require("../server/donors/profileBundle");

const ORG = "org_ps1same";
const WHO = "system:tests/profile-speed1";
const BIG = { n: 981, tier: "ps1", id: "org_ps1big", slug: "ps1big", name: "Profile Speed Big", donors: 10000,
  gifts: 60000, interactions: 30000, tasks: 400, subs: 100, users: 1 };
const day = n => civilPlusDays(n);
const enc = encodeURIComponent;

// The seven people, and each one's gifts as [amount, days ago]. A refund is a
// negative row. The hand-worked lifetime is the sum of their own gift rows
// (hard credit, refunds off); a soft credit on someone else's gift is not in it.
const PEOPLE = [
  { id: "d_ps1_hh_a", name: "Wren Aldous", gifts: [[250, 30], [100, 400]], household: true },
  { id: "d_ps1_hh_b", name: "Ivo Aldous", gifts: [[75, 60]], household: true },
  { id: "d_ps1_org", name: "Bellweather Mills Fund", kind: "organisation", gifts: [[5000, 90], [2500, 500]] },
  { id: "d_ps1_dec", name: "Tobias Fenn", deceased: true, gifts: [[40, 900], [40, 1300]] },
  { id: "d_ps1_arch", name: "Marisol Quint", archived: true, gifts: [[15, 200]] },
  { id: "d_ps1_soft", name: "Ansel Rook", gifts: [[60, 20], [-60, 10], [35, 5]], softOn: "d_ps1_org" },
  { id: "d_ps1_pledge", name: "Greta Vail", gifts: [[200, 45]], pledges: [[1200, 120], [600, -30]] },
  { id: "d_ps1_long", name: "Hollis Brant", gifts: Array.from({ length: 12 }, (_, y) => [100 + 10 * y, 30 + 365 * y]) },
];
const cents = a => Math.round(a * 100);
const lifetimeCents = p => p.gifts.reduce((s, [a]) => s + cents(a), 0);

async function fixture() {
  for (const t of ["gift_soft_credits", "pledges", "gifts", "interactions", "tasks"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`UPDATE donors SET household_id=NULL WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM households WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Profile Speed Same','profile-speed-same',1,'active','team','America/New_York') ON CONFLICT (id) DO NOTHING`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Pell Hargrove','admin')
           ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, org_id=EXCLUDED.org_id`,
    [`u_${ORG}`, ORG, `admin@${ORG}.test`, bcrypt.hashSync("loadtest1234", 4)]);
  await q(`INSERT INTO households (id,org_id,name,created_by,created_by_name) VALUES ('hh_ps1',$1,'The Aldous household',$2,'PROFILE-SPEED-1 fixture')`, [ORG, WHO]);
  let g = 0;
  for (const p of PEOPLE) {
    // total_giving is WRONG on purpose: $1.00, so a screen that reads the stored rollup shows it.
    await q(`INSERT INTO donors (id,org_id,name,email,kind,deceased,deceased_date,archived_at,household_id,total_giving,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,'PROFILE-SPEED-1 fixture')`,
      [p.id, ORG, p.name, `${p.id}@example.test`, p.kind || null, !!p.deceased, p.deceased ? day(-700) : null,
       p.archived ? new Date(`${day(-100)}T12:00:00Z`) : null, p.household ? "hh_ps1" : null, WHO]);
    for (const [amt, ago] of p.gifts) {
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'cash','Check',$6,'PROFILE-SPEED-1 fixture')`,
        [`g_ps1_${++g}`, ORG, p.id, amt, day(-ago), WHO]);
    }
    for (const [amt, dueIn] of p.pledges || []) {
      await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'open',$6,'PROFILE-SPEED-1 fixture')`,
        [`pl_ps1_${++g}`, ORG, p.id, amt, day(dueIn), WHO]);
    }
  }
  // Ansel is soft-credited with the organisation's newest gift: recognition, not money.
  const soft = PEOPLE.find(p => p.softOn);
  const [{ id: onGift }] = await q(`SELECT id FROM gifts WHERE donor_id=$1 ORDER BY date DESC LIMIT 1`, [soft.softOn]);
  await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,role,created_by,created_by_name) VALUES ('sc_ps1',$1,$2,$3,5000,'soft',$4,'PROFILE-SPEED-1 fixture')`,
    [ORG, onGift, soft.id, WHO]);
}

const getText = async (tok, path) => {
  const r = await fetch(BASE + path, { headers: { authorization: `Bearer ${tok}` } });
  return { status: r.status, text: await r.text() };
};
// A part's body as the route would send it: the bundle places the route's
// JSON text as-is, so both sides are compared as canonical JSON text.
const canon = t => { try { return JSON.stringify(JSON.parse(t)); } catch { return t; } };
// Where two answers part: the first path whose values differ, for the failure message.
function firstDiff(a, b, at = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], at + "." + k); if (d) return d; }
  }
  return `${at || "."}: ${JSON.stringify(a).slice(0, 80)} vs ${JSON.stringify(b).slice(0, 80)}`;
}

async function sameAnswers() {
  await fixture();
  const tok = (await api("POST", "/auth/login", null, { email: `admin@${ORG}.test`, password: "loadtest1234" })).body.token;
  ok("§1 the fixture org signs in", !!tok);
  // INSIGHTS-2: an org's first insights are built on the queue, and until then
  // the panel says "preparing". Wait for the build, so every read below sees it.
  // And JOBS-1: a person's first read queues their scores (the fixture wrote
  // none), and while that runs the status says "updating"; two reads a moment
  // apart would differ for that reason alone. So each person is opened once
  // first, and the comparison waits until nothing is being recomputed.
  for (const p of PEOPLE) await getText(tok, `/donors/${enc(p.id)}/profile`);
  const ready = await waitFor(async () => {
    const r = await getText(tok, `/insights/donor/${enc(PEOPLE[0].id)}`);
    if (r.status !== 200 || JSON.parse(r.text).preparing) return false;
    for (const p of PEOPLE) { const st = await getText(tok, `/donors/${enc(p.id)}/status`); if (st.status !== 200 || JSON.parse(st.text).updating) return false; }
    return true;
  }, { timeout: 90000, interval: 250 });
  ok("§1 the fixture org's insights are built and its scores are not being recomputed", !!ready);
  const diffs = [], lifetimes = [];
  let compared = 0;
  for (const p of PEOPLE) {
    const paths = FIRST_SCREEN.map(s => s.split(":id").join(enc(p.id)));
    const one = await getText(tok, `/donors/${enc(p.id)}/profile`);
    const parts = one.status === 200 ? JSON.parse(one.text) : {};
    const old = await getText(tok, `/donors/${enc(p.id)}/bundle?` + paths.map(s => "p=" + enc(s)).join("&"));
    const oldParts = old.status === 200 ? JSON.parse(old.text) : {};
    if (one.status !== 200 || old.status !== 200) diffs.push(`${p.name}: profile ${one.status}, LOAD-1 bundle ${old.status}`);
    for (const path of paths) {
      const alone = await getText(tok, path);
      const part = parts[path] || {}, was = oldParts[path] || {};
      const mine = part.body === undefined ? "" : canon(JSON.stringify(part.body));
      compared++;
      if (part.status !== alone.status || (alone.status === 200 && mine !== canon(alone.text))) diffs.push(`${p.name} ${path}: the profile's part differs from the route alone (${part.status} vs ${alone.status}) at ${firstDiff(part.body, alone.status === 200 ? JSON.parse(alone.text) : null)}`);
      if (was.status !== part.status || JSON.stringify(was.body) !== JSON.stringify(part.body)) diffs.push(`${p.name} ${path}: differs from LOAD-1's bundle`);
    }
    const rec = (parts[`/donors/${enc(p.id)}`] || {}).body || {};
    const status = (parts[`/donors/${enc(p.id)}/status`] || {}).body || {};
    const header = rec.figures && rec.figures.lifetime ? rec.figures.lifetime.cents : null;
    const glance = status.glance && status.glance.lifetime ? status.glance.lifetime.cents : null;
    lifetimes.push({ who: p.name, byHand: lifetimeCents(p), header, glance, stored: Math.round(Number(rec.total_giving) * 100) });
  }
  ok(`§1 seven people, ${compared} parts: every part of the one-trip profile is the route's own answer, and LOAD-1's bundle's`, diffs.length === 0 && compared === PEOPLE.length * FIRST_SCREEN.length, diffs.slice(0, 6));
  const wrong = lifetimes.filter(l => l.header !== l.byHand || l.glance !== l.byHand);
  ok("§1 the header's Lifetime and the status glance are each person's gifts added up by hand, never the stored $1.00", wrong.length === 0, wrong);
  ok("§1 and the stored rollup really is wrong (the check is not vacuous)", lifetimes.every(l => l.byHand !== 100), lifetimes.map(l => l.byHand));
  return tok;
}

// §2 · what the browser sends to open a profile (client/src/lib/profileReads.js):
// the first screen in one request, then the below-the-fold bundle. PS1_SHAPE=many
// is the planted defect: the first screen asked for read by read, 13 requests.
const FIRST_MANY = id => [`/donors/${id}`, `/donors/${id}/status`, `/donors/${id}/scores`, `/donors/${id}/rail`, `/donors/${id}/relationship`,
  `/donors/${id}/plan`, `/threads?donorId=${id}`, `/insights/donor/${id}`, `/donors/${id}/before-meeting`, `/donors/${id}/blocked-mail`,
  `/people/${id}`, `/atlas/notes?place=person&id=${id}`, `/donors/${id}/journeys`];
const BELOW = id => [`/donors/${id}/journey-suggestion`, `/donors/${id}/groups`, `/donors/${id}/proposals`, `/donors/${id}/events`,
  `/donors/${id}/tasks`, `/donors/${id}/volunteer-hours`, `/donors/${id}/recurring-subscription`, `/donors/${id}/soft-credit`,
  `/donors/${id}/moves`, `/donors/${id}/move-suggestions`, `/donors/${id}/designations`,
  "/mailbox", "/sequences", "/org", "/journeys", "/fundraising/campaigns", "/custom-fields?entity=gift"];
const RUN_MS = 20000, OPENERS = 10, LISTERS = 2, THINK_MS = 1000;
// The share of the run the main pool spends at 70% or more of DB_POOL_MAX,
// held against main's way of opening a profile (the 13 separate calls) run
// the same way, on the same machine, in the same test: a fixed bar moved with
// the machine (at the cap of 5 the one-trip profile measured 12.5–17.2% alone
// and 25.5% beside a browser walk; the 13 calls 34.4–35.8% alone). The
// one-trip profile must spend under AT70_RATIO_MAX of main's share; planted
// (PS1_SHAPE=many) the two are the same shape and the ratio is ~1. (Jonathan,
// 12 Nov: the pool is held to its time at 70% or more, not to its momentary
// peak, which ten requests in one instant reach whatever each of them holds.)
const AT70_RATIO_MAX = 0.75;

async function keepItFast(sameTok) {
  const [have] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [BIG.id]);
  if (have.n < BIG.donors) {
    const { seedOrg, pool } = require("../scripts/load/seed-many");
    await seedOrg(BIG, bcrypt.hashSync("loadtest1234", 4));
    await pool.query("ANALYZE");   // fresh statistics, or the planner takes the org for one row (FIX-21)
    await pool.end();
  }
  const tok = (await api("POST", "/auth/login", null, { email: `admin@${BIG.slug}.load`, password: "loadtest1234" })).body.token;
  ok("§2 the 10,000-person org signs in", !!tok);
  const other = await getText(sameTok, `/donors/${enc(BIG.id + "_d1")}/profile`);
  ok("§2 another org's person is a 404 for the whole one-trip answer", other.status === 404, other.status);

  const shape = process.env.PS1_SHAPE === "many" ? "many" : "one";
  const base = await loadShape(tok, "many");   // main's way, the yardstick
  const run = await loadShape(tok, shape);
  for (const [r, label] of [[base, "main's 13 calls"], [run, `the ${shape === "one" ? "one-trip profile" : "planted 13 calls"}`]]) {
    console.log(`   ${label}: ${r.opens.length} profile opens p95 ${r.p95opens} ms, ${r.lists.length} Donors list reads p95 ${r.p95lists} ms`);
    console.log(`     pool: most in use at once ${r.pool.peak} of ${r.pool.max}; at 70% or more ${r.pool.pctAt70}% of the run, full ${r.pool.pctAtFull}%; most one request held ${r.peaks.perRequestPeak} (cap ${r.peaks.perRequestMax}), past the cap ${r.peaks.overCap || 0} time(s)`);
  }
  ok(`§2 ${OPENERS} people opening profiles and ${LISTERS} reading the Donors list for ${RUN_MS / 1000} s, twice: every answer is a 200`,
    [base, run].every(r => r.bad.length === 0 && r.opens.length >= OPENERS), [...base.bad, ...run.bad].slice(0, 5));
  ok("§2 no request held more than five connections at once", [base, run].every(r => r.peaks.perRequestPeak != null && r.peaks.perRequestMax === 5 && r.peaks.perRequestPeak <= 5), [base.peaks, run.peaks]);
  ok("§2 main's way really fills the pool (the comparison is not vacuous)", base.pool.samples > 50 && base.pool.pctAt70 >= 10, base.pool);
  const ratio = base.pool.pctAt70 ? run.pool.pctAt70 / base.pool.pctAt70 : 1;
  ok(`§2 the pool was at 70% or more for under ${AT70_RATIO_MAX * 100}% of main's share (${run.pool.pctAt70}% against ${base.pool.pctAt70}%, ${ratio.toFixed(2)})`,
    run.pool.samples > 50 && ratio < AT70_RATIO_MAX, { run: run.pool, main: base.pool });
}

async function loadShape(tok, shape) {
  let seed = 4242;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const think = () => new Promise(r => setTimeout(r, THINK_MS * (0.5 + rnd())));
  const get = async path => {
    const t0 = performance.now();
    const r = await fetch(BASE + path, { headers: { authorization: `Bearer ${tok}` } });
    await r.arrayBuffer();
    return { path, status: r.status, ms: performance.now() - t0 };
  };
  await get(`/donors/${BIG.id}_d1/profile`);   // the first connects are not the run's
  await api("POST", "/perf/peaks/reset", tok);
  const sampler = require("../scripts/load/poolSampler").startPoolSampler(BASE, 50);
  const t0 = performance.now(), bad = [], opens = [], lists = [];
  const note = r => { if (r.status !== 200) bad.push(`${r.status} ${r.path.slice(0, 60)}`); return r; };
  const openers = Array.from({ length: OPENERS }, async () => {
    while (performance.now() - t0 < RUN_MS) {
      const id = `${BIG.id}_d${1 + Math.floor(rnd() * BIG.donors)}`, o0 = performance.now();
      const first = shape === "many" ? FIRST_MANY(id) : [`/donors/${id}/profile`];
      (await Promise.all(first.map(get))).forEach(note);
      note(await get(`/donors/${id}/bundle?` + BELOW(id).map(p => "p=" + enc(p)).join("&")));
      opens.push(performance.now() - o0);
      await think();
    }
  });
  const listers = Array.from({ length: LISTERS }, async () => {
    while (performance.now() - t0 < RUN_MS) {
      const [list] = await Promise.all([get("/donors?limit=50"), get("/donors/counts")].map(p => p.then(note)));
      lists.push(list.ms);
      await think();
    }
  });
  await Promise.all([...openers, ...listers]);
  const pool = await sampler.stop();
  const peaks = (await api("GET", "/perf/peaks", tok)).body || {};
  const p95 = a => Math.round(a.slice().sort((x, y) => x - y)[Math.max(0, Math.ceil(a.length * 0.95) - 1)] || 0);
  return { pool, peaks, bad, opens, lists, p95opens: p95(opens), p95lists: p95(lists) };
}

module.exports = { PEOPLE, lifetimeCents, BIG };
if (require.main === module) {
  (async () => {
    const tok = await sameAnswers();
    await keepItFast(tok);
    summary();
    await closeDb();
  })().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
}
