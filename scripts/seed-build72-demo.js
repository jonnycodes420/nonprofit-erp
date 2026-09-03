#!/usr/bin/env node
// BUILD-72 Part 5 — THE DEMO SEED.
//
// The demo is the pitch, and the pitch is MID-LEVEL DRIFT: eleven quiet $2,000
// donors who gave reliably for years and nothing this year. Never four hundred
// lapsed $50s — that is a mailing-list problem, not the problem this product
// solves, and a fundraiser can tell the difference in three seconds.
//
// IDEMPOTENT BY TEARDOWN, NOT BY RE-IMPORT (BUILD-72 Part 1 made this
// mandatory): re-importing the same file now legitimately creates duplicate
// gifts, which is the correct trade and must stay. So this script DROPS and
// RECREATES the demo organization rather than importing over itself. Safe to
// run at 9:55pm before a 10pm call, every time, with the same result.
//
// SAFETY — this script must be INCAPABLE of touching production or any Kingdom
// Builders database:
//   Layer 0  identity — /health must report product "steward" AND the database
//            name must match the one we are about to write to. Loopback is not
//            identity; a server on localhost may be a different product.
//   Layer 1  loopback default via prodGuard.writerBase.
//   Layer 2  a remote BASE additionally needs --i-know-this-is-prod.
//   Layer 3  a hard refusal on any database whose name is not an explicit
//            allowlisted scratch name — except the ONE deliberate production
//            path (prod db + prod BASE + --i-know-this-is-prod, BUILD-76
//            follow-up), which still touches only org_b72demo rows. Kingdom
//            Builders names refuse unconditionally.
//
// Usage:  node scripts/seed-build72-demo.js
//         (DATABASE_URL + BASE default to the scratch stack)

const guard = require("./lib/prodGuard");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const orgTime = require("../orgTime");

// Resolved INSIDE main(), not at module load. BUILD-73 Part 3 requires this
// file for its DRIFTED/SHAPE exports (tests/demo-shape.test.js), and
// writerBase() performs a live identity check — so at module scope, merely
// importing the seed hit the network and refused. The guard is unchanged and
// still runs before a single write; it just runs when the seed actually seeds.
let BASE;
const DB = process.env.DATABASE_URL || "postgres://steward@localhost:5544/steward_loadtest";

const ORG = "org_b72demo";
const ADMIN_EMAIL = "director@harborlight.demo";
const ADMIN_PASSWORD = "demo-harbor-2026";
const TZ = process.env.DEMO_TZ || "America/New_York";

// ── Layer 3: an explicit allowlist of database names this may write to.
// Kingdom Builders names fail closed ALWAYS. The production database
// ("postgres", Steward's Supabase) is reachable ONLY through the deliberate
// two-flag path below (BUILD-76 follow-up — Jonathan's standing item is to
// put the Harborlight demo org on production; the seed used to fail closed
// on prod unconditionally, which made that item impossible as written):
// a non-loopback BASE (which already forced --i-know-this-is-prod through
// writerBase) AND the server-vs-connection identity match. Even then the
// seed touches ONLY org_b72demo rows — every DELETE and INSERT is pinned to
// that org id.
const ALLOWED_DB = /^(steward_loadtest|steward_demo|steward_freshcheck|steward_build\w+)$/;
const KB_DB = /^(kb_|kingdom)/i;
const PROD_DB = "postgres";

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
// Civil dates only — the seed never stores an instant as a gift date (Part 4).
const TODAY = orgTime.orgToday({ timezone: TZ });
const YEAR = Number(TODAY.slice(0, 4));
const dateIn = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

// Deterministic PRNG — the same demo every single run. A demo that reshuffles
// between rehearsal and the call is a demo you cannot rehearse.
let _s = 0x72b72b72;
const rnd = () => (((_s = (_s * 1103515245 + 12345) & 0x7fffffff) >>> 8) / 0x7fffff);
const pick = arr => arr[Math.floor(rnd() * arr.length) % arr.length];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// No name mistakable for a real organization or person, and no implied social
// proof anywhere. Invented surnames, invented org.
const FIRST = ["Marguerite","Halvard","Ondine","Casper","Wilhelmina","Tobias","Rosalind","Emmett","Philippa","Gideon","Cordelia","Ansel","Beatrix","Rufus","Isolde","Barnaby","Clementine","Alaric","Perpetua","Silas","Verity","Osric","Henrietta","Leopold","Araminta","Fenwick","Drusilla","Cuthbert","Marisol","Thaddeus"];
const LAST  = ["Ashgrove","Bellwether","Cinderhalt","Dunmoor","Elmsworth","Fairweather","Glasswick","Hollowell","Ironvale","Jessamine","Kettleby","Lindquist","Marchbanks","Netherfield","Oakhampton","Pemberton","Quillfeather","Ravensmere","Stonebridge","Thornbury","Underhill","Vanterpool","Wexford","Yarrowdale","Ziegler","Applewhite","Braithwaite","Carrowmore","Dellacroix","Everhart"];

// THE ELEVEN, hoisted to module scope and exported. They are the demo's thesis
// — consistent multi-year mid-level giving, then nothing — and BUILD-73 Part 3
// asserts on them by name (tests/demo-shape.test.js), so they must be readable
// without running the seed. Exported, not duplicated: a copy in the test would
// drift from the seed the first time either changed.
//
// BUILD-76 FOLLOW-UP — the roster is now [name, amount, pattern], and every
// pattern is constructed RELATIVE TO TODAY so all eleven assess as
// drifting/HIGH under the real engine (drift.js) on any run date. The old
// roster gave most of the eleven annual NOVEMBER gifts — under month-aware
// drift a November giver in September is simply not due yet, so only four of
// the eleven actually drifted (the fixture was wrong, not the engine — the
// exact failure mode BUILD-73 Part 3 caught once before, one layer deeper).
// Margaret Chen leads: she is the landing page's canonical example, and the
// demo must read her sentence ("$2,000 every <Month> since <year>. Nothing
// for 14 months.") in the Drifting section, not a bare follow-up task.
// Ondine Cinderhalt left the eleven for her own story (the failed card —
// below): a past_due subscription EXCLUDES a donor from drift by design, so
// she cannot be one of the eleven and be the failed-card fixture at once.
const DRIFTED = [
  ["Margaret Chen", 2000, "seasonal"],          // THE canonical example
  ["Marguerite Ashgrove", 2500, "seasonal"],
  ["Halvard Bellwether", 2000, "semiannual"],
  ["Casper Dunmoor", 1800, "semiannual"],
  ["Wilhelmina Elmsworth", 3000, "semiannual"],
  ["Tobias Fairweather", 2000, "quarterly"],
  ["Rosalind Glasswick", 2200, "quarterly"],
  ["Emmett Hollowell", 1900, "quarterly"],
  ["Philippa Ironvale", 2600, "semiannual"],
  ["Gideon Jessamine", 2100, "seasonal"],
  ["Cordelia Kettleby", 2800, "semiannual"],
];

// The gift dates for one of the eleven, RELATIVE TO TODAY — deterministic,
// and always drifting/high under drift.js:
//   seasonal    — one gift in the same calendar month for 7 straight years,
//                 the last ~14 months back (the window closed ~2 months ago;
//                 past the 30-day grace at any run date).
//   semiannual  — every ~182 days for 4 years, silent ~9–10 months
//                 (ratio ≈ 1.6× cadence; boundary 455d).
//   quarterly   — every ~91 days for 2 years, silent ~6.5 months
//                 (ratio ≈ 2.1×; boundary 227d — regenerated relative to
//                 today on every run, so it never ages into lapsed).
function driftedGiftDates(pattern, i) {
  if (pattern === "seasonal") {
    // i*4 (not i%3*12) so no two seasonal members share an anchor — twin
    // sentences on adjacent rows read as synthetic data.
    const anchor = orgTime.addDays(TODAY, -(420 + i * 4));          // ~14–15 months back
    const [ay, am] = [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))];
    const dates = [];
    for (let y = ay - 6; y <= ay; y++) dates.push(dateIn(y, am, 10));
    return dates;
  }
  if (pattern === "semiannual") {
    const end = 280 + (i % 4) * 8;                                  // 280–304 days silent
    return [7, 6, 5, 4, 3, 2, 1, 0].map(k => orgTime.addDays(TODAY, -(end + k * 182)));
  }
  // quarterly — silence >180d on purpose: every one of the eleven must sit
  // inside BOTH the drift window AND the older 180-day going-quiet figure
  // (the ImpactLine), so the two at-risk numbers agree about the thesis.
  const end = 185 + (i % 3) * 5;                                    // 185–195 days silent
  return [7, 6, 5, 4, 3, 2, 1, 0].map(k => orgTime.addDays(TODAY, -(end + k * 91)));
}

// The shape contract BUILD-73 Part 3 pins. The demo is the pitch, and the pitch
// is mid-level drift — eleven quiet donors, never four hundred lapsed $50s. A
// seed that regresses toward a flat file, or toward a file so top-heavy it
// reads as fake, tells a different story than the product's. These are ranges,
// not exact numbers: the tail is randomly generated on purpose, and a test that
// demanded an exact percentage would be pinning the random seed, not the shape.
const SHAPE = {
  driftedCount: 11,
  // Engine-verified drift (BUILD-76 follow-up): the eleven plus a bounded
  // handful of organic small-tail drifters. Below 11 the fixture un-drifted;
  // far above it the file is noise, not a story.
  driftingHighMin: 11, driftingHighMax: 20,
  topDecileShareMin: 0.62, topDecileShareMax: 0.82,   // top 10% of donors, share of lifetime revenue
  top200ShareMin: 0.82,    top200ShareMax: 0.93,      // the FEP figure the seed prints
  donorsMin: 1000,         donorsMax: 1150,
};

async function main() {
  // ── Layer 0/3 — identity BEFORE anything is written ─────────────────────
  BASE = guard.writerBase("http://localhost:5601");         // Layers 1-2, before any write
  const health = guard.assertServerIdentity(BASE);          // refuses a non-steward product
  console.log(`[identity] ${BASE} → product=${health.product} database=${health.database}`);

  const client = new Client({ connectionString: DB, ssl: /localhost|127\.0\.0\.1/.test(DB) ? false : { rejectUnauthorized: false } });
  await client.connect();
  const [{ current_database: dbName }] = (await client.query("SELECT current_database()")).rows;

  const refuse = msg => { console.error(`\nREFUSED: ${msg}\n`); process.exit(1); };
  if (dbName !== health.database)
    refuse(`the server at ${BASE} reports database "${health.database}" but this connection is to "${dbName}". One of them is not what you think.`);
  if (KB_DB.test(dbName))
    refuse(`"${dbName}" is a Kingdom Builders database name. This seed writes STEWARD demo fiction and must never touch it — no flag overrides this.`);
  const isProdRun = dbName === PROD_DB;
  if (isProdRun) {
    // The deliberate path: prod db + non-loopback BASE (writerBase already
    // demanded --i-know-this-is-prod for that BASE) + identity match above.
    if (guard.isLoopback(BASE))
      refuse(`database "${dbName}" is production but BASE (${BASE}) is loopback — refusing a mismatched pair. A prod run points BASE at the prod backend so the identity check is against the server that owns this database.`);
    console.log(`\n*** PRODUCTION SEED ***`);
    console.log(`*** This drops and recreates ONLY the Harborlight demo org (${ORG}) — fiction, no real donors. ***`);
    console.log(`*** Every DELETE and INSERT below is pinned to org_id='${ORG}'. Nothing else is touched. ***\n`);
  } else if (!ALLOWED_DB.test(dbName)) {
    refuse(`"${dbName}" is not an allowlisted scratch database (${ALLOWED_DB}) and not the guarded prod path. Failing closed.`);
  } else {
    console.log(`[identity] database "${dbName}" is an allowlisted scratch target\n`);
  }

  const q = (sql, params = []) => client.query(sql, params).then(r => r.rows);

  // ── TEARDOWN — idempotent by dropping, never by importing over ──────────
  console.log("[teardown] removing any previous demo org…");
  await q(`UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["workflow_runs","workflows","digest_sends","moves","opportunities","tasks",
    "payment_recovery_events","recurring_subscriptions","receipts","pledges","fin_audit_log",
    "fin_transactions","interactions","gifts","milestone_drafts","note_reminders","donor_materials",
    "households","donors","campaigns","fin_funds","accounts","budgets","users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});

  // ── The organization ────────────────────────────────────────────────────
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,mission)
           VALUES ($1,'Harborlight Youth Collective','harborlight',1,'active','team',$2,
                   'After-school arts and mentoring for young people on the north shore.')`, [ORG, TZ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b72demo',$1,$2,$3,'Dana Reyes','admin')`,
          [ORG, ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b72demo_off',$1,'officer@harborlight.demo',$2,'Priya Raman','member')`,
          [ORG, bcrypt.hashSync(ADMIN_PASSWORD, 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b72demo',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b72demo_gen',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b72demo_sch',$1,'Scholarship Fund',true)`, [ORG]);
  // Goal is set AFTER the gifts exist, from what was actually raised (below) —
  // a demo whose first screen reads "666% · $1,018,277 over" looks broken, not
  // successful. Created here with a placeholder; corrected once totals are in.
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date)
           VALUES ('camp_b72demo',$1,'Annual Fund ' || $2,'appeal','active',1,$3,$4)`,
          [ORG, String(YEAR), dateIn(YEAR, 1, 1), dateIn(YEAR, 12, 31)]);

  const donors = [], gifts = [];
  let gid = 0, did = 0;
  const pinnedStage = [];   // donors whose stage is DELIBERATE, never re-inferred
  const addDonor = (name, email, o = {}) => {
    const id = `d_b72_${pad(++did)}`;
    donors.push({ id, name, email, ...o });
    if (o.pin) pinnedStage.push(id);
    return id;
  };
  const addGift = (donorId, amount, date, o = {}) =>
    gifts.push({ id: `g_b72_${String(++gid).padStart(4, "0")}`, donorId, amount, date, ...o });

  // ── THE ELEVEN. The thesis, and the first thing on the day view. ────────
  // Consistent multi-year giving at a real mid-level number, then NOTHING this
  // year. Not lapsed-and-forgotten — quietly gone, while still looking fine in
  // any report that only counts lifetime totals.
  console.log("[seed] the eleven drifted mid-level donors…");
  // THE SHAPE ASSERTION AT GENERATION TIME (BUILD-76 follow-up). The eleven
  // are assessed through the REAL engine (drift.js, a pure function) BEFORE a
  // single row is written. If any of them is not drifting/high, the fixture
  // is wrong — refuse to seed rather than silently un-drift. This runs on
  // EVERY target including production, where tests/demo-shape.test.js never
  // does; the suite is the committed guard, this is the last line.
  const driftEngine = require("../drift");
  const fixtureErrors = [];
  DRIFTED.forEach(([name, amt, pattern], i) => {
    const a = driftEngine.assessDrift(driftedGiftDates(pattern, i).map(date => ({ date, amount: amt })), TODAY);
    if (a.state !== "drifting" || a.confidence !== "high")
      fixtureErrors.push(`${name} (${pattern}): state=${a.state} confidence=${a.confidence}`);
  });
  if (fixtureErrors.length) {
    console.error("\nREFUSED: the fixture would not drift — the fixture is wrong, not the engine:");
    fixtureErrors.forEach(e => console.error("  " + e));
    process.exit(1);
  }
  const driftedIds = [];
  DRIFTED.forEach(([name, amt, pattern], i) => {
    const email = name.toLowerCase().replace(/ /g, ".") + "@example.demo";
    const id = addDonor(name, email, { status: "mid", stage: "cultivate",
                                      officer: i % 3 === 0 ? "u_b72demo_off" : "u_b72demo" });
    driftedIds.push(id);
    // The eleven belong to the director — they are the pitch, and they must be
    // in the portfolio of whoever is signed in during the demo. Steady
    // amounts on purpose: the drift reason then reads the donor's own pattern
    // ("$2,000 every July since 2019"), not "usually around".
    for (const date of driftedGiftDates(pattern, i))
      addGift(id, amt, date, { campaign: "Annual Fund " + date.slice(0, 4) });
  });

  // ── The rest of the file: ~1,000 donors on the FEP shape — roughly 200
  // carrying about 90% of revenue.
  console.log("[seed] the long tail on the FEP distribution…");
  const usedEmail = new Set(donors.map(d => d.email));
  const mkName = () => {
    for (let i = 0; i < 500; i++) {
      const n = `${pick(FIRST)} ${pick(LAST)}`;
      const e = n.toLowerCase().replace(/ /g, ".") + "@example.demo";
      if (!usedEmail.has(e)) { usedEmail.add(e); return [n, e]; }
    }
    const n = `Donor ${did + 1} Ashgrove`;
    return [n, `donor${did + 1}@example.demo`];
  };

  // 190 major/mid donors carrying the bulk of revenue. Each gives in ONE
  // season, every year through THIS year (BUILD-76 follow-up): random months
  // per year used to line up into accidental tight cadences, minting $10k+
  // organic drifters that outranked all eleven on the value-at-risk-ranked
  // home list — and no i%9 "quiet this year" majors for the same reason. The
  // quiet-major story is Verity Underhill (lapsed); the quiet story is the
  // eleven.
  for (let i = 0; i < 190; i++) {
    const [name, email] = mkName();
    const tier = i < 25 ? "major" : "mid";
    const base = tier === "major" ? between(10000, 45000) : between(1200, 6000);
    const givingMonth = between(1, 12);   // their season — annual givers give at their own time of year
    const id = addDonor(name, email, { status: tier, stage: i % 5 === 0 ? "steward" : "cultivate",
                                       officer: i % 4 === 0 ? "u_b72demo_off" : (i % 3 === 0 ? "u_b72demo" : null) });
    for (let y = YEAR - 3; y <= YEAR; y++) {
      addGift(id, base + between(-200, 400), dateIn(y, givingMonth, between(1, 28)),
              { campaign: y === YEAR ? "Annual Fund " + YEAR : "Annual Fund " + y });
    }
  }
  // ~810 small donors — the tail. Present, but not the story. Each gives in
  // one season across consecutive years (BUILD-76 follow-up — random
  // year/month scatter used to mint ~20 accidental organic drifters through
  // the two-interval variability quirk). Most run through THIS year; a
  // deterministic handful (~1 in 100) stopped last year — the file's
  // bounded, realistic organic drift.
  for (let i = 0; i < 810; i++) {
    const [name, email] = mkName();
    const id = addDonor(name, email, { status: "new", stage: i % 7 === 0 ? "qualify" : "prospect",
                                      pin: i % 7 === 0 });
    // Tuned so the top ~200 carry ~90% of revenue, not ~96%. A file that is
    // TOO top-heavy reads as fake to a fundraiser just as a flat one does.
    const m = between(1, 12);
    // A third of the tail CHURNED — their giving stopped one to three years
    // back, and churners carry only 1–2 gifts (that IS who churns; and 1–2
    // gifts can never be drifting/high, so churn can't bury the eleven).
    // Without this the file retained ~98% year over year — arithmetically
    // true and exactly as fake-reading as the 100%-on-16-donors card.
    const churnOffset = [0, 0, 0, 0, 0, 0, 1, 2, 3][between(0, 8)];
    const n = churnOffset > 0 ? between(1, 2) : between(1, 4);
    // Capped at $450 (was $620) so no tail donor's trailing-24-month giving
    // can reach $2,000 — Margaret Chen (the weakest of the eleven by value
    // at risk) is then guaranteed a place on the capped home drift list.
    const lastYear = i % 101 === 0 ? YEAR - 1 : YEAR - churnOffset;
    for (let k = 0; k < n; k++)
      addGift(id, between(40, 450), dateIn(lastYear - k, m, between(1, 28)));
  }

  // ── REALISTIC MESS — a file with none reads as fake to anyone who has
  // imported a real one.
  console.log("[seed] the mess…");
  // A lapsed MAJOR donor — the painful kind.
  const lapsedMajor = addDonor("Verity Underhill", "verity.underhill@example.demo",
                               { status: "major", stage: "lapsed" });
  for (let y = YEAR - 6; y <= YEAR - 2; y++) addGift(lapsedMajor, 25000, dateIn(y, 4, 18));

  // A donor with TWO addresses (same person, two records the merge tool finds).
  const twoAddr = addDonor("Osric Ravensmere", "osric.ravensmere@example.demo",
                           { status: "mid", stage: "cultivate", city: "Beverly", state: "MA" });
  addGift(twoAddr, 1500, dateIn(YEAR - 1, 6, 3));
  const twoAddrB = addDonor("Osric Ravensmere", "o.ravensmere@example.demo",
                            { status: "mid", stage: "cultivate", city: "Salem", state: "MA" });
  addGift(twoAddrB, 1200, dateIn(YEAR, 2, 14));

  // A household with two people.
  const hh1 = addDonor("Henrietta Stonebridge", "henrietta.stonebridge@example.demo",
                       { status: "mid", stage: "steward", city: "Marblehead", state: "MA" });
  const hh2 = addDonor("Leopold Stonebridge", "leopold.stonebridge@example.demo",
                       { status: "mid", stage: "steward", city: "Marblehead", state: "MA" });
  addGift(hh1, 3200, dateIn(YEAR, 3, 9));
  addGift(hh2, 1800, dateIn(YEAR, 3, 9));

  // BUILD-72 Part 5 (walk finding) — every PIPELINE STAGE must have donors in
  // it. The first seed left PROSPECT and SOLICIT empty, so the day view's
  // funnel showed "0 · — · 0% of pipeline" twice. Statistically true, reads as
  // broken, and it is the first screen of the pitch. A real donor file always
  // has people at every stage.
  for (let i = 0; i < 34; i++) {
    const [name, email] = mkName();
    // Real prospects: identified, reachable, no gift yet. They must stay
    // giftless — that IS what a prospect is — so the stage is pinned below.
    addDonor(name, email, { status: "new", stage: "prospect", pin: true,
                            city: pick(["Salem","Beverly","Marblehead","Danvers"]), state: "MA" });
  }
  for (let i = 0; i < 21; i++) {
    const [name, email] = mkName();
    const id = addDonor(name, email, { status: "mid", stage: "solicit", pin: true,
                                       officer: i % 2 === 0 ? "u_b72demo_off" : null });
    // A substantial gift 90–180 days back is exactly what "solicit" means.
    addGift(id, between(1200, 8000), orgTime.addDays(TODAY, -between(95, 175)));
  }

  // BUILD-72 Part 3 — a gift carrying CENTS, so the Step A truncation question
  // is visible on screen rather than theoretical. Since BUILD-73 Part 2 this
  // amount survives as $1,234.56 rather than storing as $1,235.
  const centsDonor = addDonor("Araminta Wexford", "araminta.wexford@example.demo",
                              { status: "mid", stage: "cultivate" });
  addGift(centsDonor, 1234.56, dateIn(YEAR, 4, 2), { cents: true });

  // BUILD-73 Part 3.2 — the pledge fixtures get their OWN donors.
  //
  // They used to hang off driftedIds[0] and driftedIds[1], which attached 2026
  // pledge PAYMENTS to two of the eleven and quietly un-drifted them: Marguerite
  // Ashgrove last gave 192 days ago and Halvard Bellwether 117, so two of the
  // demo's eleven were not quiet at all. Nothing said so — the seed printed
  // "the eleven drifted mid-level donors: 11" either way, because it counted the
  // list rather than checking the shape. tests/demo-shape.test.js found it, and
  // now asserts it, which is the whole point of that suite.
  //
  // The eleven must be SILENT. Anything that needs a current-year gift belongs
  // on a donor whose story is a current-year gift.
  const pledgeDonorA = addDonor("Isolde Fennimore", "isolde.fennimore@example.demo",
                                { status: "major", stage: "solicit", pin: true, officer: "u_b72demo" });
  const pledgeDonorB = addDonor("Barnaby Thistlewood", "barnaby.thistlewood@example.demo",
                                { status: "mid", stage: "steward", pin: true, officer: "u_b72demo_off" });

  // The failed-card donor (BUILD-76 follow-up — her OWN story, see the
  // subscription block below): $150/month for a year and a half, then the
  // card died two months ago. A past_due subscription EXCLUDES her from
  // drift by design — she routes to the failed-payment path instead.
  const recurDonor = addDonor("Ondine Cinderhalt", "ondine.cinderhalt@example.demo",
                              { status: "mid", stage: "steward", pin: true, officer: "u_b72demo" });
  for (let k = 17; k >= 2; k--)
    addGift(recurDonor, 150, orgTime.addDays(TODAY, -(k * 30 + 4)));

  await writeAll(client, donors, gifts);

  // ── Pledges: one PARTIALLY paid, one OVERPAID with a recorded surplus ────
  console.log("[seed] pledges (partial + overpaid surplus)…");
  const plPartial = "pl_b72_part", plOver = "pl_b72_over";
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,notes,campaign_id,status)
           VALUES ($1,$2,$3,10000,$4,'Capital pledge — three-year commitment','camp_b72demo','open')`,
          [plPartial, ORG, pledgeDonorA, dateIn(YEAR, 12, 31)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,pledge_id,campaign)
           VALUES ('g_b72_pl1',$1,$2,4000,$3,'check',$4,'Annual Fund ' || $5)`,
          [ORG, pledgeDonorA, dateIn(YEAR, 2, 20), plPartial, String(YEAR)]);
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,notes,campaign_id,status)
           VALUES ($1,$2,$3,5000,$4,'Scholarship pledge','camp_b72demo','open')`,
          [plOver, ORG, pledgeDonorB, dateIn(YEAR, 9, 30)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,pledge_id)
           VALUES ('g_b72_pl2',$1,$2,5750,$3,'check',$4)`,
          [ORG, pledgeDonorB, dateIn(YEAR, 5, 6), plOver]);

  // BUILD-72 Part 3 — the pledges were written directly, so derive their status
  // and surplus exactly as recalcPledgePayment() would. Without this the
  // overpaid pledge would sit at surplus 0 and the demo would show the OLD
  // (wrong) behavior on the very screen Part 3 fixed.
  await q(`
    WITH paid AS (
      SELECT p.id, p.amount::numeric AS amount, COALESCE(SUM(g.amount),0)::numeric AS paid
        FROM pledges p LEFT JOIN gifts g ON g.pledge_id = p.id AND g.org_id = p.org_id
       WHERE p.org_id = $1 GROUP BY p.id, p.amount)
    UPDATE pledges pl
       SET status         = CASE WHEN paid.amount > 0 AND paid.paid >= paid.amount THEN 'fulfilled' ELSE 'open' END,
           surplus_amount = CASE WHEN paid.amount > 0 AND paid.paid >  paid.amount THEN ROUND(paid.paid - paid.amount, 2) ELSE 0 END,
           fulfilled_at   = CASE WHEN paid.amount > 0 AND paid.paid >= paid.amount THEN NOW() ELSE NULL END
      FROM paid WHERE paid.id = pl.id AND pl.org_id = $1`, [ORG]);

  // ── A recurring gift with a FAILED card ─────────────────────────────────
  console.log("[seed] a recurring gift with a failed card…");
  // recurDonor (Ondine Cinderhalt) was created — with her monthly gift
  // history — BEFORE writeAll above; this block only attaches the failed
  // subscription. She is deliberately NOT one of the eleven: a past_due
  // subscription EXCLUDES a donor from drift by design, and her story lives
  // in the failed-payment path (same precedent as BUILD-73's pledge donors:
  // anything that needs a non-drift state belongs on a donor whose story IS
  // that state).
  await q(`INSERT INTO recurring_subscriptions
             (id,org_id,donor_id,amount,interval,status,stripe_subscription_id,fund_id,created_at)
           VALUES ('rs_b72demo',$1,$2,150,'month','past_due','sub_demo_b72','fund_b72demo_gen',NOW())`,
          [ORG, recurDonor]).catch(async () => {
    await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,amount,status)
             VALUES ('rs_b72demo',$1,$2,150,'past_due')`, [ORG, recurDonor]).catch(() => {});
  });

  // ── Derived state: totals, stages, ledger stamps ───────────────────────
  console.log("[seed] recomputing donor summaries…");
  await q(`
    UPDATE donors d SET
      total_giving    = COALESCE(s.total, 0),
      gift_count      = COALESCE(s.n, 0),
      last_gift_date  = s.last_date,
      last_gift_amount= COALESCE(s.last_amt, 0),
      first_gift_date = s.first_date
    FROM (
      SELECT g.donor_id,
             SUM(g.amount) AS total, COUNT(*) AS n,
             MAX(g.date) AS last_date, MIN(g.date) AS first_date,
             (ARRAY_AGG(g.amount ORDER BY g.date DESC))[1] AS last_amt
        FROM gifts g WHERE g.org_id = $1 GROUP BY g.donor_id
    ) s
    WHERE d.id = s.donor_id AND d.org_id = $1`, [ORG]);
  // Stage inference in the ORG's civil calendar (Part 4), not the DB session's.
  await q(`
    UPDATE donors SET stage = CASE
      WHEN total_giving = 0 AND last_gift_date IS NULL THEN 'prospect'
      WHEN last_gift_date IS NOT NULL AND ($2::date - last_gift_date::date) > 365 THEN 'lapsed'
      WHEN last_gift_date IS NOT NULL AND ($2::date - last_gift_date::date) < 90 AND total_giving > 0 THEN 'steward'
      WHEN total_giving > 0 THEN 'cultivate' ELSE 'prospect' END
    WHERE org_id = $1 AND id <> ALL($3)`, [ORG, TODAY, pinnedStage]);
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id)
           SELECT 'ft_' || g.id, g.org_id, g.date, 'Gift from ' || d.name, d.name, g.amount, 'income',
                  'acct_b72demo','fund_b72demo_gen', g.donor_id, 'seed', g.id
             FROM gifts g JOIN donors d ON d.id = g.donor_id
            WHERE g.org_id = $1 AND g.date >= $2
            ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING`,
          [ORG, orgTime.orgFiscalYearStart({ timezone: TZ })]);

  // A couple of open tasks so the day view has work on it.
  await q(`INSERT INTO tasks (id,org_id,donor_id,title,due,done,priority,type)
           VALUES ('tk_b72_1',$1,$2,'Call about the spring showcase',$3,0,'high','call')`,
          [ORG, driftedIds[0], TODAY]);
  await q(`INSERT INTO tasks (id,org_id,donor_id,title,due,done,priority,type)
           VALUES ('tk_b72_2',$1,$2,'Send the scholarship impact note',$3,0,'medium','email')`,
          [ORG, driftedIds[3], orgTime.addDays(TODAY, -3)]);

  // ── Goal from reality: ~85% of the way there reads like a live campaign ──
  const [raisedThisYear] = await q(
    `SELECT COALESCE(SUM(amount),0)::float d FROM gifts WHERE org_id=$1 AND date >= $2`,
    [ORG, dateIn(YEAR, 1, 1)]);
  const goal = Math.round((raisedThisYear.d / 0.85) / 5000) * 5000;
  await q(`UPDATE campaigns SET goal_amount=$2 WHERE id='camp_b72demo' AND org_id=$1`, [ORG, goal]);
  await q(`UPDATE gifts SET campaign_id='camp_b72demo', campaign='Annual Fund ' || $2
            WHERE org_id=$1 AND date >= $3`, [ORG, String(YEAR), dateIn(YEAR, 1, 1)]);

  // The activation checklist is for a NEW org. On a 1,000-donor demo it reads
  // as unfinished setup — dismiss it.
  await q(`UPDATE orgs SET setup_card_state='hidden' WHERE id=$1`, [ORG]);

  // A working office has logged touchpoints. Without these, "My Portfolio"
  // shows VISITS 0 / MOVES 0 on a file with a decade of giving.
  const fy = orgTime.orgFiscalYearStart({ timezone: TZ });
  let ic = 0;
  for (const [i, did] of driftedIds.entries()) {
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'u_b72demo','Dana Reyes')`,
            [`int_b72_${++ic}`, ORG, did, i % 2 ? "meeting" : "call",
             i % 2 ? "Coffee — talked about the studio program." : "Left a voicemail about the spring showcase.",
             // ≥35 days back on purpose: a meaningful contact inside
             // HANDLED_SNOOZE_DAYS (30) would suppress that donor from the
             // drift LIST — the first run of the fixed seed hid one of the
             // eleven exactly this way.
             orgTime.addDays(TODAY, -(35 + i * 9))]);
  }

  // ── THE SHAPE ASSERTION ON THE GENERATED FILE (BUILD-76 follow-up) ──────
  // Asserted HERE, after the write, on every target including production —
  // the committed guard is tests/demo-shape.test.js, but that suite never
  // runs against prod, and this file has silently un-drifted twice now
  // (BUILD-73 caught two of the eleven; BUILD-76's month-aware engine
  // caught seven more). Count of engine-drifting donors within a range, and
  // top-decile revenue share within a range, or the seed FAILS — teardown
  // idempotency makes a failed run safe to re-run after fixing.
  console.log("[assert] the generated file's shape…");
  const allGiftRows = await q(
    `SELECT g.donor_id, array_agg(g.date::text ORDER BY g.date) AS dates,
            array_agg(g.amount ORDER BY g.date) AS amounts
       FROM gifts g WHERE g.org_id = $1 GROUP BY g.donor_id`, [ORG]);
  const excludedFromDrift = new Set(
    (await q(`SELECT donor_id FROM recurring_subscriptions WHERE org_id=$1 AND status IN ('active','past_due','recovering','recovered','paused')
              UNION SELECT donor_id FROM pledges WHERE org_id=$1 AND status='open'`, [ORG])).map(r => r.donor_id));
  let driftingHigh = 0;
  const driftingById = new Map();
  for (const r of allGiftRows) {
    if (excludedFromDrift.has(r.donor_id)) continue;
    const a = driftEngine.assessDrift(r.dates.map((date, k) => ({ date: String(date).slice(0, 10), amount: parseFloat(r.amounts[k]) || 0 })), TODAY);
    if (a.state === "drifting" && a.confidence === "high") { driftingHigh++; driftingById.set(r.donor_id, a); }
  }
  const shapeFail = [];
  if (driftingHigh < SHAPE.driftingHighMin || driftingHigh > SHAPE.driftingHighMax)
    shapeFail.push(`engine-drifting/high count ${driftingHigh} outside [${SHAPE.driftingHighMin}, ${SHAPE.driftingHighMax}]`);
  for (const id of driftedIds)
    if (!driftingById.has(id)) shapeFail.push(`one of the eleven is NOT drifting/high: ${id}`);
  const decile = await q(
    `WITH totals AS (SELECT donor_id, SUM(amount)::float t FROM gifts WHERE org_id=$1 GROUP BY donor_id),
          n AS (SELECT COUNT(*)::int c FROM donors WHERE org_id=$1 AND deleted_at IS NULL)
     SELECT (SELECT SUM(t) FROM (SELECT t FROM totals ORDER BY t DESC LIMIT (SELECT GREATEST(1, ROUND(c * 0.1)) FROM n)) top)
            / NULLIF((SELECT SUM(t) FROM totals), 0) AS share`, [ORG]);
  const decileShare = parseFloat(decile[0]?.share) || 0;
  if (decileShare < SHAPE.topDecileShareMin || decileShare > SHAPE.topDecileShareMax)
    shapeFail.push(`top-decile revenue share ${(decileShare * 100).toFixed(1)}% outside [${SHAPE.topDecileShareMin * 100}%, ${SHAPE.topDecileShareMax * 100}%]`);
  if (shapeFail.length) {
    console.error("\nSHAPE ASSERTION FAILED — the generated file does not tell the story:");
    shapeFail.forEach(e => console.error("  " + e));
    process.exit(1);
  }
  console.log(`[assert] drifting/high ${driftingHigh} (range ${SHAPE.driftingHighMin}–${SHAPE.driftingHighMax}) · top-decile share ${(decileShare * 100).toFixed(1)}% — shape holds`);

  // ── Report ──────────────────────────────────────────────────────────────
  const [sum] = await q(`SELECT COUNT(DISTINCT d.id)::int donors,
                                COUNT(g.*)::int gifts,
                                COALESCE(SUM(g.amount),0)::float dollars
                           FROM donors d LEFT JOIN gifts g ON g.donor_id = d.id
                          WHERE d.org_id = $1`, [ORG]);
  const [thisYear] = await q(`SELECT COALESCE(SUM(amount),0)::float d FROM gifts WHERE org_id=$1 AND date >= $2`,
                             [ORG, dateIn(YEAR, 1, 1)]);
  const [top200] = await q(`SELECT COALESCE(SUM(t),0)::float d FROM (
                              SELECT SUM(g.amount) t FROM gifts g WHERE g.org_id=$1
                               GROUP BY g.donor_id ORDER BY t DESC LIMIT 200) x`, [ORG]);
  console.log(`\n─── Harborlight Youth Collective (${ORG}) ───`);
  console.log(`  donors ${sum.donors} · gifts ${sum.gifts} · lifetime $${Math.round(sum.dollars).toLocaleString()}`);
  console.log(`  top 200 donors carry ${((top200.d / sum.dollars) * 100).toFixed(1)}% of lifetime revenue (FEP shape)`);
  console.log(`  raised in ${YEAR}: $${Math.round(thisYear.d).toLocaleString()}`);
  console.log(`  the eleven drifted mid-level donors: ${driftedIds.length}`);
  console.log(`  timezone: ${TZ} · today here: ${TODAY}`);
  console.log(`\n  sign in:  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  officer:  officer@harborlight.demo / ${ADMIN_PASSWORD}\n`);

  await client.end();
}

async function writeAll(client, donors, gifts) {
  console.log(`[seed] writing ${donors.length} donors, ${gifts.length} gifts…`);
  const B = 500;
  for (let i = 0; i < donors.length; i += B) {
    const batch = donors.slice(i, i + B);
    const vals = [], params = [];
    batch.forEach((d, k) => {
      const o = k * 10;
      vals.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10})`);
      params.push(d.id, ORG, d.name, d.email, d.status || "new", d.stage || "prospect",
                  d.city || null, d.state || null, d.officer || null,
                  d.officer ? (d.officer === "u_b72demo_off" ? "Priya Raman" : "Dana Reyes") : null);
    });
    await client.query(
      `INSERT INTO donors (id,org_id,name,email,status,stage,city,state,assigned_to,assigned_to_name)
       VALUES ${vals.join(",")}`, params);
  }
  for (let i = 0; i < gifts.length; i += B) {
    const batch = gifts.slice(i, i + B);
    const vals = [], params = [];
    batch.forEach((g, k) => {
      const o = k * 7;
      vals.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7})`);
      params.push(g.id, ORG, g.donorId, g.amount, g.date, "check", g.campaign || null);
    });
    await client.query(
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ${vals.join(",")}`, params);
  }
}

module.exports = { DRIFTED, SHAPE, ORG, ADMIN_EMAIL, ADMIN_PASSWORD };

// Only run when invoked directly — tests/demo-shape.test.js requires this file
// for DRIFTED/SHAPE and must not trigger a seed by importing it.
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
