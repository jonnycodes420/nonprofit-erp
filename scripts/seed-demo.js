#!/usr/bin/env node
// THE DEMO SEED — Harborlight Youth Collective, the org the pitch is given on.
//
// FIX-1 §11: THE DEMO IS ITS OWN ORG, NEVER A TEST FIXTURE. The walk found the
// demo repeating a line the walk scripts and suites write (a donor asking for
// a report that only exists in the tests). So the demo has this one seed, in
// the words a real development office would leave in its own file; NO SUITE
// logs in to or writes this org (tests/fix1-walk.test.js §11 greps for ORG
// and ADMIN_EMAIL); CI and tests/run-all.sh seed it before the battery, so
// tests/demo-shape never skips. It was scripts/seed-build72-demo.js (BUILD-72
// Part 5); the history below is that file's.
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
// Usage:  node scripts/seed-demo.js
//         (DATABASE_URL + BASE default to the scratch stack)

const guard = require("./lib/prodGuard");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const orgTime = require("../orgTime");
const { findRealPeople } = require("./lib/demoRealPeople");

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
// The only users this seed creates. Anyone else in the demo org is a real
// account holder (FIX-3 C, finding 8), and the seed removes them.
const SEEDED_USER_EMAILS = [ADMIN_EMAIL, "officer@harborlight.demo"];
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
// FIX-1: the per-worktree scratch databases (steward_fix1_a, steward_chore1…)
// are scratch too, and run-all.sh seeds the demo on whichever one it runs.
// CHORE-2: and the per-SHARD ones. `steward_shard_<n>` is created by
// tests/shard.sh at the start of a shard and dropped at the end of it, on the
// loopback scratch Postgres; the shard holding demo-shape seeds the demo into
// its own. The pattern is deliberately narrow — a digit, nothing else — so it
// cannot match anything a person would name by hand.
// GTM-1a — `steward_<tag>_shard_<n>`, not only `steward_shard_<n>`. CLAUDE.md
// requires a database per WORKTREE, and the way to get one per worktree AND
// per shard is SHARD_DB_PREFIX. A worktree that set it found the seed refuse,
// smoke-walk fail with "the demo org is on this database", and the failure
// read as a product defect when it was this allowlist. The pattern still
// pins both ends: it must start `steward_` and end `shard_<digits>`, so it
// widens to sharded scratch databases and to nothing else.
// VOL-1 — the prefix list had grown one entry per build family (build, fix,
// chore, gtm), so every new family met the same refusal and read as a product
// defect. It is one pattern now: `steward_` plus letters, digits and
// underscores, which is every scratch database this repo has ever created and
// is still incapable of matching `postgres`, a `kb_`/`kingdom` database, or
// anything with a hyphen or a dot in it. The two ends are still pinned.
const ALLOWED_DB = /^steward_[a-z0-9_]+$/;
const KB_DB = /^(kb_|kingdom)/i;
const PROD_DB = "postgres";

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
// FIN-1 — n days from a civil date, as a civil date. `dateIn` already exists
// and takes (year, month, day); this one takes an ISO day and an offset,
// which is what every "forty-one days from today" in the seed wants.
const dateIn2 = (iso, n) =>
  new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);
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
//                 the last ~14.5 months back. FIX-1: it was 420 days, which
//                 put late-month run dates INSIDE the engine's grace (drift
//                 starts a month after the anchor month ENDS), so Margaret
//                 Chen read "ok" on the 26th of September and the seed
//                 refused. 440 was swept against every run date in a year;
//                 all eleven drift/high on each (430–450 are all clean).
//   semiannual  — every ~182 days for 4 years, silent ~9–10 months
//                 (ratio ≈ 1.6× cadence; boundary 455d).
//   quarterly   — every ~91 days for 2 years, silent ~6.5 months
//                 (ratio ≈ 2.1×; boundary 227d — regenerated relative to
//                 today on every run, so it never ages into lapsed).
function driftedGiftDates(pattern, i) {
  if (pattern === "seasonal") {
    // i*4 (not i%3*12) so no two seasonal members share an anchor — twin
    // sentences on adjacent rows read as synthetic data.
    const anchor = orgTime.addDays(TODAY, -(440 + i * 4));          // ~14.5–16 months back
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
  // FIX-3 C, finding 14 — a real mid-sized nonprofit's channel mix, by the
  // Reports rule (a gift is online when it carries a Stripe payment id),
  // over the trailing twelve months: 30–45% of dollars, well over half of
  // gifts (the small gifts come in online, the large ones by cheque, stock and
  // DAF), and a monthly-giving programme.
  onlineShareMin: 0.30,    onlineShareMax: 0.45,
  onlineCountShareMin: 0.60,
  monthlyGiversMin: 50,
};

// FIX-3 C, finding 14 — THE GALA. One night, about five months back, with
// ticket and sponsorship levels, a guest list that mostly came, and a paddle
// raise for the scholarship fund on the night. Tickets are bought online in
// the weeks before; sponsors pay by cheque; paddle-raise gifts are charged to
// a card at the table. Every gift carries the gala's name as its campaign, and
// the event's revenue is their sum.
const GALA = {
  name: "Harbor Lights Gala",
  venue: "Lanternside Hall, Salem",
  ticketBuyersMin: 60,
  paddleGiftsMin: 30,
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

  // ── FIX-3 C, finding 8 — a real person in the demo is named and removed
  // FIRST, by the same rule the prod check reads, so the run's log says who
  // was in the pitch org before the teardown takes everything else.
  await removeRealPeople(q, ORG, { seededUserEmails: SEEDED_USER_EMAILS, log: console.log });

  // ── TEARDOWN — idempotent by dropping, never by importing over ──────────
  console.log("[teardown] removing any previous demo org…");
  await q(`UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["threads","workflow_runs","workflows","digest_sends","moves","opportunities","tasks",
    "payment_recovery_events","recurring_subscriptions","receipts","pledges","fin_audit_log",
    "fin_transactions","interactions","gifts","milestone_drafts","note_reminders","donor_materials",
    "households","donors","campaigns","fin_funds","accounts","budgets","users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await teardownOrg(q, ORG);

  // ── The organization ────────────────────────────────────────────────────
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,mission,emails_enabled,is_demo_org)
           VALUES ($1,'Harborlight Youth Collective','harborlight',1,'active','team',$2,
                   'After-school arts and mentoring for young people on the north shore.',
                   false,true)`, [ORG, TZ]);   // INCIDENT 2026-09-22: a seeded org sends nothing
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b72demo',$1,$2,$3,'Dana Reyes','admin')`,
          [ORG, ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b72demo_off',$1,'officer@harborlight.demo',$2,'Priya Raman','member')`,
          [ORG, bcrypt.hashSync(ADMIN_PASSWORD, 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b72demo',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b72demo_gen',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b72demo_sch',$1,'Scholarship Fund',true)`, [ORG]);
  // FIN-1 — a THIRD fund, and it is restricted and actually holds money. The
  // demo had two funds and a restricted balance of zero, so the one screen
  // that exists to answer "how much of this is not ours to spend" answered
  // nothing, and a treasurer opening it learned less than from the bank.
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted,description)
           VALUES ('fund_b72demo_boat',$1,'Harbour Skills Boat',true,'The Meridian Foundation grant for the second training boat.')`, [ORG]);
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
  const addGift = (donorId, amount, date, o = {}) => {
    const id = `g_b72_${String(++gid).padStart(4, "0")}`;
    gifts.push({ id, donorId, amount, date, ...o });
    return id;
  };

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
  const tail = [];   // FIX-3 C — who in the tail is still giving (monthly givers and gala guests come from here)
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
    tail.push({ id, giving: lastYear === YEAR });
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

  // ── FIX-1 §11/§13 — ORGANISATIONS GIVE TOO ──────────────────────────────
  // A foundation, a church and a business, so the demo can show Steward
  // calling an organisation what it is and never one of her "sponsors". Each
  // gave this year, so none of them is a drift story (organisations are
  // excluded from drift anyway; this keeps the seed's own shape check honest).
  const ORGS = [
    ["Tidewater Community Foundation", "grants@tidewatercf.example.demo", "community_foundation", [5000, 5000, 7500]],
    ["Grace Chapel", "office@gracechapel.example.demo", "church", [1200, 1200, 1500]],
    ["Saltbox Printing", "hello@saltboxprinting.example.demo", "corporate", [750, 1000, 1000]],
  ];
  const orgDonors = [];
  for (const [name, email, funderType, amounts] of ORGS) {
    const id = addDonor(name, email, { status: "mid", stage: "steward", pin: true, officer: "u_b72demo" });
    orgDonors.push([id, funderType]);
    amounts.forEach((amt, k) => addGift(id, amt, orgTime.addDays(TODAY, -(40 + (amounts.length - 1 - k) * 365)),
                                        { campaign: "Annual Fund " + orgTime.addDays(TODAY, -(40 + (amounts.length - 1 - k) * 365)).slice(0, 4) }));
  }


  // ── FIX-3 C, finding 14 — HOW THE MONEY CAME IN ─────────────────────────
  // The walk: Reports read "Online $2 (2)" against $433,215 offline, because
  // every seeded gift was a cheque with no Stripe id, and the report's rule
  // for online is `stripe_payment_id IS NOT NULL`. A real mid-sized nonprofit
  // takes most of its GIFTS online and a third or so of its DOLLARS: the small
  // gifts come through the giving page, the large ones by cheque, stock and
  // DAF. Everything below is appended AFTER the file above was generated, so
  // the PRNG stream that shapes the eleven and the FEP distribution is
  // untouched.

  // No gift from the future. Annual givers were generated "every year through
  // THIS year" in their own month, which put this year's October–December
  // gifts in the future (166 gifts, $373k on 27 Sep): Reports' fiscal year
  // then counted money nobody has given yet. A donor whose season is still to
  // come simply has not given yet this year; a donor whose ONLY gift was in
  // the future gave it last year instead.
  {
    const hasPast = new Set(gifts.filter(g => g.date <= TODAY).map(g => g.donorId));
    for (let k = gifts.length - 1; k >= 0; k--) {
      const g = gifts[k];
      if (g.date <= TODAY) continue;
      if (hasPast.has(g.donorId)) gifts.splice(k, 1);
      else g.date = `${Number(g.date.slice(0, 4)) - 1}${g.date.slice(4)}`;
    }
  }

  // MONTHLY GIVERS — a programme, not one donor. Twenty who came in as
  // monthly donors, and about fifty of the small tail who moved to monthly
  // (their annual gifts before the switch stay; after it, one charge a month
  // on the same day, through this month). Each charge is what the Stripe
  // webhook writes: a payment id, payment_method Card, the subscription id.
  console.log("[seed] monthly givers…");
  const monthly = [];   // { subId, donorId, amount, start }
  const MONTHLY_AMOUNTS = [10, 15, 20, 25, 25, 25, 35, 50, 50, 75, 100, 150];
  const monthlySeries = (donorId, subId, amount, start) => {
    let [y, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
    const day = Number(start.slice(8, 10));
    for (let date = dateIn(y, m, day); date <= TODAY; date = dateIn(y, m, day)) {
      addGift(donorId, amount, date, { online: true, sub: subId, notes: "Monthly gift via the giving page" });
      if (++m > 12) { m = 1; y++; }
    }
  };
  const newMonthly = (donorId, { minDays, maxDays }) => {
    const subId = `rs_b72m_${pad(monthly.length + 1)}`;
    const s = orgTime.addDays(TODAY, -between(minDays, maxDays));
    const start = dateIn(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Math.min(28, Number(s.slice(8, 10))));
    const amount = pick(MONTHLY_AMOUNTS);
    monthly.push({ subId, donorId, amount, start });
    return { subId, start, amount };
  };
  for (let i = 0; i < 20; i++) {
    const [name, email] = mkName();
    const id = addDonor(name, email, { status: "new", stage: "steward" });
    const { subId, start, amount } = newMonthly(id, { minDays: 120, maxDays: 1000 });
    monthlySeries(id, subId, amount, start);
  }
  const switched = new Set();
  tail.filter(t => t.giving).forEach((t, k) => {
    if (k % 11 !== 5) return;
    const { subId, start, amount } = newMonthly(t.id, { minDays: 200, maxDays: 900 });
    for (let j = gifts.length - 1; j >= 0; j--) if (gifts[j].donorId === t.id && gifts[j].date >= start) gifts.splice(j, 1);
    monthlySeries(t.id, subId, amount, start);
    switched.add(t.id);
  });
  // Ondine's monthly history was a card charge too — on the subscription that
  // later failed (it is attached below, after the write).
  for (const g of gifts) if (g.donorId === recurDonor) Object.assign(g, { online: true, sub: "rs_b72demo", notes: "Monthly gift via the giving page" });

  // THE GALA — see GALA at the top.
  console.log("[seed] the gala…");
  let galaDate = orgTime.addDays(TODAY, -140);
  while (new Date(galaDate + "T12:00:00Z").getUTCDay() !== 6) galaDate = orgTime.addDays(galaDate, -1);   // a Saturday night
  const gala = { id: "ev_b72_gala", campaignId: "camp_b72gala", name: `${GALA.name} ${galaDate.slice(0, 4)}`, date: galaDate,
                 levels: [], guests: [] };
  const galaGift = { campaign: gala.name, campaignId: gala.campaignId };
  const level = (id, kind, name, price, fmv, recognition = null) => { const l = { id, kind, name, price, fmv, recognition }; gala.levels.push(l); return l; };
  const DINNER = level("evl_b72_dinner", "ticket", "Dinner ticket", 250, 95);
  const SPONSOR = [
    level("evl_b72_presenting", "sponsor", "Presenting sponsor", 15000, 950, "Presenting sponsor"),
    level("evl_b72_lighthouse", "sponsor", "Lighthouse sponsor", 7500, 570, "Lighthouse sponsor"),
    level("evl_b72_harbor", "sponsor", "Harbor sponsor", 2500, 190, "Harbor sponsor"),
  ];
  // Sponsors: two local businesses new to the file, the printer who already
  // gives, and a household that stretched. They pay by cheque, weeks ahead.
  const newSponsors = [
    ["Halyard & Pike Architects", "office@halyardpike.example.demo", SPONSOR[0]],
    ["Brinewood Hardware", "owner@brinewoodhardware.example.demo", SPONSOR[1]],
  ].map(([name, email, lvl]) => {
    const id = addDonor(name, email, { status: "mid", stage: "steward", pin: true, officer: "u_b72demo" });
    orgDonors.push([id, "corporate"]);
    return [id, lvl];
  });
  for (const [id, lvl] of [...newSponsors, [orgDonors[2][0], SPONSOR[2]], [hh1, SPONSOR[2]]]) {
    const giftId = addGift(id, lvl.price, orgTime.addDays(galaDate, -between(20, 60)),
      { ...galaGift, online: false, method: ["check", "Check"], qpq: lvl.fmv,
        qpqDesc: `${lvl.name} sponsorship benefits to ${gala.name}`, notes: `1 × ${lvl.name}, ${gala.name}` });
    gala.guests.push({ donorId: id, level: lvl, qty: 1, giftId, amount: lvl.price, status: "attended", recognition: lvl.recognition });
  }
  // Ticket buyers: fifty of the small tail who are still giving (not the
  // monthly switchers), and twenty guests new to the file — the gala is how a
  // lot of people meet an organisation. Bought online in the five weeks
  // before; most bought a pair.
  const buyers = tail.filter(t => t.giving && !switched.has(t.id)).filter((t, k) => k % 7 === 2).slice(0, 50).map(t => t.id);
  for (let i = 0; i < 20; i++) { const [name, email] = mkName(); buyers.push(addDonor(name, email, { status: "new", stage: "steward" })); }
  for (const id of buyers) {
    const qty = rnd() < 0.6 ? 2 : 1;
    const giftId = addGift(id, DINNER.price * qty, orgTime.addDays(galaDate, -between(3, 35)),
      { ...galaGift, online: true, qpq: DINNER.fmv * qty,
        qpqDesc: `${qty === 1 ? "one" : qty} ${DINNER.name} ${qty === 1 ? "ticket" : "tickets"} to ${gala.name}`,
        notes: `${qty} × ${DINNER.name}, ${gala.name}` });
    gala.guests.push({ donorId: id, level: DINNER, qty, giftId, amount: DINNER.price * qty, status: rnd() < 0.9 ? "attended" : "no_show" });
  }
  // The paddle raise for the scholarship fund, on the night, charged to a
  // card at the table.
  const PADDLE = [100, 250, 250, 500, 500, 1000, 1000, 1000, 2500, 2500, 5000];
  const inRoom = gala.guests.filter(g => g.status === "attended" && g.level.kind === "ticket");
  inRoom.filter((g, k) => k % 3 !== 1).slice(0, 45).forEach(g =>
    addGift(g.donorId, pick(PADDLE), galaDate, { ...galaGift, online: true, notes: `Paddle raise for the scholarship fund, ${gala.name}` }));

  // THE CHANNEL. Per donor (people keep the way they give): the story donors
  // above are cheques by design (the eleven's "cheque every spring" is the
  // pitch); otherwise a major donor gives online 8% of the time, a mid-level
  // donor 55%, a small donor 80%, and offline money comes by cheque, ACH,
  // stock or DAF by band.
  const fixedOffline = new Set([...driftedIds, lapsedMajor, twoAddr, twoAddrB, hh1, hh2, centsDonor,
                                pledgeDonorA, pledgeDonorB, ...orgDonors.map(([id]) => id)]);
  const ONLINE_P = { major: 0.08, mid: 0.55, new: 0.8 };
  const OFFLINE = {
    major: [["check", "Check"], ["check", "Check"], ["stock", "Stock"], ["daf", "DAF"], ["ach", "ACH"]],
    mid: [["check", "Check"], ["check", "Check"], ["check", "Check"], ["ach", "ACH"], ["daf", "DAF"]],
    new: [["check", "Check"], ["check", "Check"], ["check", "Check"], ["cash", "Cash"]],
  };
  const channel = new Map();
  for (const d of donors) {
    const band = ONLINE_P[d.status] !== undefined ? d.status : "new";
    const online = fixedOffline.has(d.id) ? false : rnd() < ONLINE_P[band];
    channel.set(d.id, { online, method: fixedOffline.has(d.id) ? ["check", "Check"] : pick(OFFLINE[band]) });
  }
  for (const g of gifts) {
    const c = channel.get(g.donorId);
    if (g.online === undefined) g.online = c.online;
    if (!g.online && !g.method) g.method = c.method;
  }

  await writeAll(client, donors, gifts);
  for (const [id, funderType] of orgDonors)
    await q(`UPDATE donors SET kind='organisation', funder_type=$3 WHERE id=$1 AND org_id=$2`, [id, ORG, funderType]);

  // ── Pledges: one PARTIALLY paid, one OVERPAID with a recorded surplus ────
  console.log("[seed] pledges (partial + overpaid surplus)…");
  const plPartial = "pl_b72_part", plOver = "pl_b72_over";
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,notes,campaign_id,status)
           VALUES ($1,$2,$3,10000,$4,'Capital pledge — three-year commitment','camp_b72demo','open')`,
          [plPartial, ORG, pledgeDonorA, dateIn(YEAR, 12, 31)]);
  // FIX-3 C — a payment dated after today moves back a year (a January run
  // used to seed May's payment in the future).
  const pastOr = d => (d <= TODAY ? d : `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,pledge_id,campaign,created_by,created_by_name)
           VALUES ('g_b72_pl1',$1,$2,4000,$3,'check','Check',$4,'Annual Fund ' || $5,'u_b72demo','Dana Reyes')`,
          [ORG, pledgeDonorA, pastOr(dateIn(YEAR, 2, 20)), plPartial, String(YEAR)]);
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,notes,campaign_id,status)
           VALUES ($1,$2,$3,5000,$4,'Scholarship pledge','camp_b72demo','open')`,
          [plOver, ORG, pledgeDonorB, dateIn(YEAR, 9, 30)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,pledge_id,created_by,created_by_name)
           VALUES ('g_b72_pl2',$1,$2,5750,$3,'check','Check',$4,'u_b72demo','Dana Reyes')`,
          [ORG, pledgeDonorB, pastOr(dateIn(YEAR, 5, 6)), plOver]);

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
             (id,org_id,donor_id,amount,interval,status,stripe_subscription_id,fund_id,created_at,first_failed_at)
           VALUES ('rs_b72demo',$1,$2,150,'month','past_due','sub_demo_b72','fund_b72demo_gen',NOW(),$3::date)`,
          // FIX-1 walk: the day it failed, two months back as the story says.
          // Without it Home's sentence called the failure recent (a NULL
          // first_failed_at counts as this week there) while the tile said 0.
          [ORG, recurDonor, orgTime.addDays(TODAY, -60)]).catch(async () => {
    await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,amount,status)
             VALUES ('rs_b72demo',$1,$2,150,'past_due')`, [ORG, recurDonor]).catch(() => {});
  });

  // ── FIX-3 C — the monthly givers' subscriptions, and the gala ──────────
  console.log(`[seed] ${monthly.length} monthly subscriptions, the gala's levels and guest list…`);
  const BRANDS = ["visa", "visa", "visa", "mastercard", "mastercard", "amex", "discover"];
  for (const [k, m] of monthly.entries()) {
    const d = Number(m.start.slice(8, 10));
    const next = dateIn(Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)), d) > TODAY
      ? dateIn(Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)), d)
      : dateIn(Number(TODAY.slice(5, 7)) === 12 ? Number(TODAY.slice(0, 4)) + 1 : Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)) % 12 + 1, d);
    await q(`INSERT INTO recurring_subscriptions
               (id,org_id,donor_id,amount,interval,status,stripe_subscription_id,stripe_customer_id,fund_id,created_at,updated_at,
                current_period_end,card_brand,card_last4,card_exp_month,card_exp_year,card_checked_at)
             VALUES ($1,$2,$3,$4,'month','active',$5,$6,'fund_b72demo_gen',$7::date,NOW(),$8::date,$9,$10,$11,$12,NOW())`,
            [m.subId, ORG, m.donorId, m.amount, `sub_demo_b72_${pad(k + 1)}`, `cus_demo_b72_${pad(k + 1)}`, m.start, next,
             BRANDS[k % BRANDS.length], String(1000 + ((k * 7919) % 9000)).slice(-4), 1 + (k * 5) % 12, YEAR + 1 + (k % 4)]);
  }
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date)
           VALUES ($1,$2,$3,'event','completed',$4,$5,$6)`,
          [gala.campaignId, ORG, gala.name, 100000, orgTime.addDays(gala.date, -75), gala.date]);
  const galaRevenue = gifts.filter(g => g.campaignId === gala.campaignId).reduce((t, g) => t + g.amount, 0);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,revenue,cost,created_by,created_by_name)
           VALUES ($1,$2,$3,'gala',$4,$4,$5,$6,220,'completed',$7,$8,'u_b72demo','Dana Reyes')`,
          [gala.id, ORG, gala.name, gala.date, GALA.venue,
           "Our annual gala: dinner, a student showcase, and a paddle raise for the scholarship fund.", galaRevenue, 41500]);
  for (const [k, l] of gala.levels.entries())
    await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv,recognition,position,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'u_b72demo','Dana Reyes')`,
            [l.id, ORG, gala.id, l.kind, l.name, l.price, l.fmv, l.recognition, k]);
  const donorById = new Map(donors.map(d => [d.id, d]));
  for (const [k, g] of gala.guests.entries()) {
    const d = donorById.get(g.donorId);
    await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,level_id,quantity,registration_gift_id,recognition,gift_amount,table_label)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [`att_b72_${pad(k + 1)}`, gala.id, ORG, g.donorId, d.name, d.email || "", g.status, g.level.id, g.qty, g.giftId,
             g.recognition ? `${d.name}, ${g.recognition}` : null, g.amount, `Table ${1 + Math.floor(k / 5)}`]);
  }

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

  // ── FIX-1 §11 — THE THREAD, IN A DEVELOPMENT OFFICE'S OWN WORDS ─────────
  // What Dana Reyes, the director, promised people and has not done yet: two
  // late, one due today, the rest coming up. Every line is the kind a
  // fundraiser leaves in her own file; none of them is a sentence a test or a
  // walk script writes. On donors who are NOT the eleven: a meaningful contact
  // inside thirty days would take one of the eleven off the drift list. No
  // pronouns: the donors are chosen by a query, so "her" could land on anyone.
  console.log("[seed] the Thread…");
  const threadDonors = (await q(
    `SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND kind IS NULL
        AND id <> ALL($2) AND total_giving > 0 AND stage = 'steward'
      ORDER BY total_giving DESC, id LIMIT 6`,
    [ORG, [...driftedIds, recurDonor, pledgeDonorA, pledgeDonorB]])).map(r => r.id);
  const THREAD = [
    // [touch, what was said, days ago, next step type, next step, due in days]
    ["meeting", "Toured the studio after the spring showcase. Asked what this year's scholarship students went on to do.",
     31, "send", "Send the scholarship outcomes letter", -23],
    ["call", "Said the family board meets in July and decides its giving then. Asked us to call the first week of the month.",
     12, "follow_up", "Call before the family board meets", -5],
    ["note", "A check for the studio fund came in Monday's mail, with a handwritten card.",
     2, "thank_you_note", "Write a thank-you for the studio fund gift", 0],
    ["ask", "Asked for $5,000 toward the summer intensive. Wants to talk it over at home first.",
     20, "check_in_ask", "Check in on the summer intensive ask", 3],
    ["meeting", "Lunch downtown. Wants to bring two friends to the fall open studio.",
     3, "send", "Send open studio invitations for the two friends", 6],
    ["email", "Sent photos from the spring showcase, including one of the scholarship student the family funds.",
     9, "follow_up_no_reply", "Follow up on the showcase photos", 8],
  ];
  for (const [k, did] of threadDonors.entries()) {
    const [touch, note, ago, stepType, step, due] = THREAD[k];
    const intId = `int_b72_th${k + 1}`;
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'u_b72demo','Dana Reyes')`,
            [intId, ORG, did, touch, note, orgTime.addDays(TODAY, -ago)]);
    await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,
                                  opening_interaction_id,owner_id,owner_name,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'u_b72demo','Dana Reyes','u_b72demo','Dana Reyes')`,
            [`th_b72_${k + 1}`, ORG, did, stepType, step, orgTime.addDays(TODAY, due), orgTime.addDays(TODAY, -ago), intId]);
  }

  // ── One armed journey, and five people at different points in it ───────
  //
  // THREAD-2a built the engine and THREAD-2b the screens; without this the
  // demo shows an empty builder and every donor profile says nothing about a
  // journey, which is the one thing a person opening the demo now wants to
  // see. So Harborlight arms "New donor, first year" and five of its
  // first-time givers are partway through it.
  //
  // THE STEPS ARE COPIED, NOT REFERENCED — exactly as the product copies them
  // when somebody enters a journey. Editing the template later must not
  // rewrite the history of people already in it, and a seed that shared rows
  // would hide that.
  //
  // WHY THE GIFT DATES MOVE. A first-gift journey starts ON the first gift,
  // so `applied_on` and the donor's only gift have to be the same day or the
  // demo contradicts itself on the profile. These five are single-gift
  // donors and the seed owns their rows, so the gift is moved to the entry
  // date and the rollup is re-run for just them.
  console.log("[seed] the journey…");
  // FIX-4 1a — THE STEPS COME FROM THE PRESET, not from a copy of it. This
  // was a second hard-coded list of the same seven steps, and the moment
  // Jonathan retimed the first-year journey it became a demo that showed the
  // OLD timing on a screen whose caption described the new one. There is one
  // catalogue; the demo reads it.
  const journeyMod = await import("../shared/journeyShape.js");
  const JOURNEY_PRESET = journeyMod.presetByKey("new_donor_first_year");
  const JOURNEY_STEPS = JOURNEY_PRESET.steps.map(s => ({ ...s }));
  const OFF = JOURNEY_STEPS.map(s => s.offsetDays);
  const JOURNEY_TPL = "ct_b72_newdonor";
  await q(`INSERT INTO cultivation_templates
             (id,org_id,name,steps,trigger_key,priority,preset_key,journey_enabled,created_by,created_by_name)
           VALUES ($1,$2,'New donor, first year',$3::jsonb,'first_gift',50,'new_donor_first_year',true,
                   'u_b72demo','Dana Reyes')`,
          [JOURNEY_TPL, ORG, JSON.stringify(JOURNEY_STEPS)]);

  // enteredAgo picks which step is open, because the due dates are the entry
  // date plus the offsets. One on step 1, one OVERDUE, one on step 3, one on
  // step 5, one finished — the five states somebody should see before they
  // trust this with a real donor.
  //
  //   [enteredAgo, openIdx | null = finished, skipIdx | null, what they said]
  //
  // FIX-4 1a — enteredAgo is COMPUTED from the preset's own offsets rather
  // than typed. It was five literals calibrated against the old timing, so
  // retiming the journey silently moved four of the five people onto
  // different steps: the one meant to be thirteen days overdue became on
  // time, and the one meant to have FINISHED still had two steps to go.
  // `[openIdx, dueInDays]` says what the demo is FOR — due tomorrow, two
  // weeks late, finished — and the arithmetic follows the catalogue.
  const entered = (openIdx, dueInDays) =>
    openIdx === null ? OFF[OFF.length - 1] + 20 : OFF[openIdx] - dueInDays;
  const JOURNEY_PEOPLE = [
    [entered(0,  1),    0, null, null],                                          // step 1, due tomorrow
    [entered(1, -13),   1, null, "Rang twice, left a message the second time."], // step 2, 13 days OVERDUE
    [entered(2,  2),    2, null, "Lovely call. She asked how the scholarship students are chosen."],
    [entered(4,  2),    4, 3,    "Talked at the spring showcase instead of a separate visit."],
    [entered(null, 0),  null, 5, "He said to skip the check-in and just make the ask."],
  ];
  const DONE_NOTES = [
    "Caught her at home. Genuinely surprised anyone called.",
    "Card posted with a photo from the showcase.",
    "Sent the spring report with the scholarship pages marked.",
    "Came by the studio on a Thursday afternoon.",
    "Invited to the fall open studio; said yes.",
    "Quick call, nothing asked for.",
    "Asked for $2,500 toward the summer intensive.",
  ];
  const SKIP_REASONS = [null, null, null, "Already done another way", null, "They asked us not to", null];

  // Single-gift donors — genuine first-time givers, so a FIRST-GIFT journey
  // is honest on their record — and never one already carrying an open
  // thread, because `threads_one_open` allows exactly one per person and the
  // journey's open step needs it.
  //
  // AND NEVER THE FILLER NAMES. 205 of the 1,120 are "Donor 1002 Ashgrove",
  // which is the bulk generator's convention and fine in a list of a
  // thousand; on the five records the demo exists to show off it reads like
  // a fixture somebody forgot to finish. Ordering by id alone picked five of
  // them, because the bulk block runs first. 253 named donors qualify.
  //
  // AND FIVE DIFFERENT NAMES. The name pool repeats across 1,120 donors, so
  // the first cut put "Osric Ravensmere" on two of the five — two people at
  // different points in the same journey, with the same name, on the screen
  // this exists to show. DISTINCT ON (name) picks one row per name.
  const journeyDonors = (await q(
    `SELECT * FROM (
       SELECT DISTINCT ON (name) id, name, assigned_to, assigned_to_name, gift_id FROM (
         SELECT d.id, d.name, d.assigned_to, d.assigned_to_name, MIN(g.id) AS gift_id
           FROM donors d JOIN gifts g ON g.donor_id = d.id AND g.org_id = d.org_id
          WHERE d.org_id = $1 AND d.deleted_at IS NULL AND d.kind IS NULL
            AND d.id <> ALL($2)
            AND d.name NOT LIKE 'Donor %'
            AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.donor_id = d.id AND t.closed_at IS NULL)
          GROUP BY d.id, d.name, d.assigned_to, d.assigned_to_name
         HAVING COUNT(g.*) = 1
       ) one_gift ORDER BY name, id
     ) distinct_names ORDER BY id LIMIT 5`,
    [ORG, [...driftedIds, recurDonor, pledgeDonorA, pledgeDonorB, ...threadDonors]]));
  if (journeyDonors.length < 5) {
    console.error(`\nREFUSED: the journey needs 5 single-gift donors and found ${journeyDonors.length}. `
      + `Seeding four out of five would be a demo that quietly tells a shorter story.\n`);
    process.exit(1);
  }

  for (const [k, d] of journeyDonors.entries()) {
    const [enteredAgo, openIdx, skipIdx, lastWord] = JOURNEY_PEOPLE[k];
    const entered = orgTime.addDays(TODAY, -enteredAgo);
    const planId = `cp_b72_${k + 1}`;
    const owner = d.assigned_to || "u_b72demo";
    const ownerName = d.assigned_to_name || "Dana Reyes";
    const finished = openIdx === null;

    // The gift IS the trigger, so it moves to the entry date.
    await q(`UPDATE gifts SET date=$1 WHERE id=$2 AND org_id=$3`, [entered, d.gift_id, ORG]);

    await q(`INSERT INTO cultivation_plans
               (id,org_id,donor_id,template_id,template_name,applied_on,status,owner_id,owner_name,
                created_by,created_by_name,trigger_key,priority)
             VALUES ($1,$2,$3,$4,'New donor, first year',$5,$6,$7,$8,
                     'system:journey','Steward (journey)','first_gift',50)`,
            [planId, ORG, d.id, JOURNEY_TPL, entered, finished ? "done" : "active", owner, ownerName]);

    for (const [i, st] of JOURNEY_STEPS.entries()) {
      const due = orgTime.addDays(entered, st.offsetDays);
      const skipped = skipIdx === i;
      const done = !skipped && (finished || i < openIdx);
      const open = !finished && i === openIdx;
      const status = skipped ? "skipped" : done ? "done" : open ? "open" : "pending";
      let threadId = null;

      // A DONE STEP LEFT A TRACE. The line goes on the timeline as a real
      // conversation, which is what makes Last contact true afterwards —
      // the same thing POST /plan-steps/:id/done writes.
      if (done) {
        const intId = `int_b72_jr${k + 1}_${i + 1}`;
        await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [intId, ORG, d.id,
                 st.type === "thank" ? "call" : st.type === "send" ? "email" : "note",
                 `${st.label}: ${DONE_NOTES[i]}`, due, owner, ownerName]);
      }

      // THE OPEN STEP CARRIES THE THREAD. That is what puts it on Home's
      // Thread as today's or an overdue next step, owner-scoped.
      if (open) {
        threadId = `th_b72_jr${k + 1}`;
        await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,
                                      opening_gift_id,owner_id,owner_name,created_by,created_by_name)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'system:journey','Steward (journey)')`,
                [threadId, ORG, d.id, st.type, st.label, due,
                 i === 0 ? entered : orgTime.addDays(entered, JOURNEY_STEPS[i - 1].offsetDays),
                 i === 0 ? d.gift_id : null, owner, ownerName]);
      }

      await q(`INSERT INTO cultivation_plan_steps
                 (id,org_id,plan_id,seq,step_type,label,due_date,status,thread_id,draft_kind,
                  owner_id,owner_name,closed_at,closed_by,closed_by_name,done_note,skip_reason)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
              [`cs_b72_${k + 1}_${i + 1}`, ORG, planId, i + 1, st.type, st.label, due, status,
               threadId, st.draft, owner, ownerName,
               (done || skipped) ? `${due} 12:00:00+00` : null,
               (done || skipped) ? owner : null, (done || skipped) ? ownerName : null,
               done ? DONE_NOTES[i] : null,
               skipped ? SKIP_REASONS[i] : null]);
    }

    // What the officer last said, so the record reads like somebody has been
    // working it rather than like a fixture.
    if (lastWord) {
      await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
               VALUES ($1,$2,$3,'note',$4,$5,$6,$7)`,
              [`int_b72_jrn${k + 1}`, ORG, d.id, lastWord,
               orgTime.addDays(TODAY, -Math.max(1, Math.round(enteredAgo / 6))), owner, ownerName]);
    }
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
             VALUES ($1,$2,$3,'note',$4,$5,'system:journey','Steward (journey)')`,
            [`int_b72_jrs${k + 1}`, ORG, d.id,
             `Journey started: New donor, first year (${JOURNEY_STEPS.length} steps).`, entered]);
  }

  // The five gift dates moved, so their rollups and stages are recomputed —
  // the main rollup above ran before this block and is stale for exactly
  // these five. A demo whose Last gift disagrees with its own journey start
  // is the kind of small lie nobody reports and everybody notices.
  const jIds = journeyDonors.map(d => d.id);
  await q(`
    UPDATE donors d SET
      total_giving = COALESCE(s.total,0), gift_count = COALESCE(s.n,0),
      last_gift_date = s.last_date, last_gift_amount = COALESCE(s.last_amt,0), first_gift_date = s.first_date
    FROM (SELECT g.donor_id, SUM(g.amount) total, COUNT(*) n, MAX(g.date) last_date, MIN(g.date) first_date,
                 (ARRAY_AGG(g.amount ORDER BY g.date DESC))[1] last_amt
            FROM gifts g WHERE g.org_id=$1 AND g.donor_id = ANY($2) GROUP BY g.donor_id) s
    WHERE d.id = s.donor_id AND d.org_id = $1`, [ORG, jIds]);
  await q(`
    UPDATE donors SET stage = CASE
      WHEN last_gift_date IS NOT NULL AND ($2::date - last_gift_date::date) > 365 THEN 'lapsed'
      WHEN last_gift_date IS NOT NULL AND ($2::date - last_gift_date::date) < 90 THEN 'steward'
      ELSE 'cultivate' END
    WHERE org_id=$1 AND id = ANY($3)`, [ORG, TODAY, jIds]);
  await q(`UPDATE fin_transactions ft SET date = g.date FROM gifts g
            WHERE ft.gift_id = g.id AND ft.org_id=$1 AND g.donor_id = ANY($2)`, [ORG, jIds])
    .catch(() => {});

  // ── FIN-1 · A REALISTIC FINANCE MONTH ─────────────────────────────────
  // Three funds with real balances, one restricted grant whose money is
  // visibly sitting in its own fund, and payouts from TWO sources with one
  // of them unmatched — the state a bookkeeper actually opens Finance to
  // resolve. Without this the Finance screens are technically correct and
  // answer nothing.
  console.log("[seed] the finance month…");
  const FIN_ACCT = "acct_b72demo";
  let ftn = 0;
  const ft = async (date, desc, who, amount, type, fund, opts = {}) => {
    ftn++;
    await q(`INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,source,grant_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [`ft_b72fin_${ftn}`, ORG, date, desc, who, amount, type, FIN_ACCT, fund, opts.source || "seed", opts.grantId || null]);
  };

  // THE RESTRICTED GRANT. An awarded grant whose money is in the boat fund,
  // with a report due inside the sixty-day window so "Needs you" has the one
  // item a restricted balance is supposed to raise.
  // The grant's own row. `grants.funder` is a TEXT name, not a foreign key
  // (the funders table came later and never became the grant's parent), and
  // the grant's title lives in `program` — which is why this insert is
  // written against the real columns rather than the ones a reader would
  // guess. The report is due inside the sixty-day window, so "Needs you" has
  // the one item a restricted balance is supposed to raise.
  const GRANT_ID = "gr_b72_boat";
  await q(`INSERT INTO grants (id,org_id,funder,program,amount,received,status,report_due,description)
           VALUES ($1,$2,'Meridian Foundation','Harbour Skills: second training boat',85000,55000,'awarded',$3,
                   'Restricted to the purchase and fit-out of a second training boat.')
           ON CONFLICT (id) DO NOTHING`,
    [GRANT_ID, ORG, dateIn2(TODAY, 41)]);
  await ft(dateIn2(TODAY, -74), "Meridian Foundation, first instalment", "Meridian Foundation", 55000, "income", "fund_b72demo_boat", { grantId: GRANT_ID });
  await ft(dateIn2(TODAY, -31), "Boat hull and trailer", "Kestrel Marine", 21400, "expense", "fund_b72demo_boat");
  await ft(dateIn2(TODAY, -12), "Outboard and safety kit", "Kestrel Marine", 6250, "expense", "fund_b72demo_boat");

  // The scholarship fund, restricted by named donors rather than by a grant,
  // so the Funds screen shows BOTH ways a restriction arrives.
  const schDonors = (await q(
    `SELECT id, name FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND total_giving > 5000
      ORDER BY total_giving DESC LIMIT 3`, [ORG]));
  for (const [i, d] of schDonors.entries()) {
    await ft(dateIn2(TODAY, -120 + i * 30), `Scholarship gift from ${d.name}`, d.name, [12000, 7500, 4000][i], "income", "fund_b72demo_sch");
  }
  await ft(dateIn2(TODAY, -45), "Autumn term scholarships", "Harborlight Youth Collective", 9200, "expense", "fund_b72demo_sch");

  // The month's operating expenses, so the Overview's bars and the fund's
  // in-and-out are not one-sided.
  for (const [day, desc, who, amt] of [
    [-24, "Rent, the Annexe", "Mill Street Properties", 3400],
    [-19, "Payroll", "Harborlight Youth Collective", 18600],
    [-14, "Insurance", "Kestrel Mutual", 1180],
    [-9,  "Boat fuel and moorings", "Pier 4 Marina", 640],
    [-4,  "Printing, autumn appeal", "Northgate Press", 910],
  ]) await ft(dateIn2(TODAY, day), desc, who, amt, "expense", "fund_b72demo_gen");

  const [finCheck] = await q(
    `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0)::float bal
       FROM fin_transactions WHERE org_id=$1 AND fund_id='fund_b72demo_boat'`, [ORG]);
  console.log(`[assert] the restricted boat fund holds $${Math.round(finCheck.bal).toLocaleString()} of its $85,000 grant`);
  if (!(finCheck.bal > 0)) {
    console.error("\nREFUSED: the restricted fund must hold money or the Finance screens answer nothing.");
    process.exit(1);
  }

  // ── VOL-1 · THE VOLUNTEER PROGRAMME ───────────────────────────────────
  // What a coordinator's week actually looks like, so the demo answers the
  // questions a coordinator asks rather than the ones a fundraiser does:
  // three opportunities, shifts in the past AND the future, one of them FULL
  // with somebody on the waiting list, a company group, hours from
  // check-outs, waivers (one lapsed, one about to), and SIX people who both
  // give and volunteer — the crossing that is the whole point.
  console.log("[seed] the volunteer programme…");
  const VOL_OPPS = [
    { id: "vo_b72_shore", name: "Saturday harbour clean-up", slug: "saturday-harbour-clean-up",
      description: "Two hours on the shoreline with gloves, bags and a flask of something hot.",
      location: "Pier 4, Harborlight", program: "Shoreline", waiver: true, check: false },
    { id: "vo_b72_tutor", name: "After-school tutoring", slug: "after-school-tutoring",
      description: "One hour a week with the same young person, term time.",
      location: "The Annexe, 14 Mill Street", program: "Youth programs", waiver: true, check: true },
    { id: "vo_b72_gala", name: "Gala night crew", slug: "gala-night-crew",
      description: "Setting up, welcoming guests and clearing away afterwards.",
      location: "Harborlight Hall", program: "Events", waiver: false, check: false },
  ];
  for (const o of VOL_OPPS) {
    await q(`INSERT INTO volunteer_opportunities (id,org_id,name,slug,description,location,program,is_public,requires_waiver,requires_background_check,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9,'u_b72demo','Dana Reyes')`,
      [o.id, ORG, o.name, o.slug, o.description, o.location, o.program, o.waiver, o.check]);
  }

  // Thirty volunteers. SIX of them are people who ALREADY GIVE — picked off
  // the real donor rows rather than invented, because the crossover is only
  // interesting when it is the same record.
  const givers = (await q(
    `SELECT id, name FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND total_giving > 0
      ORDER BY total_giving DESC OFFSET 12 LIMIT 6`, [ORG])).map(r => r.id);
  for (const id of givers) {
    await q(`UPDATE donors SET person_types = CASE
               WHEN person_types @> '["volunteer"]'::jsonb THEN person_types
               ELSE COALESCE(person_types,'["donor"]'::jsonb) || '["volunteer"]'::jsonb END
             WHERE id=$1 AND org_id=$2`, [id, ORG]);
  }
  const VOL_FIRST = ["Marisol","Dev","Aiko","Tomas","Nell","Rufus","Priya","Odin","Clara","Bertie",
                     "Ines","Kofi","Saoirse","Milo","Freya","Hassan","Juno","Emeka","Lotte","Arjun",
                     "Wren","Ottoline","Cassius","Maeve"];
  const VOL_LAST = ["Vance","Okonjo","Brightwater","Mendel","Ashcroft","Iyer","Fairweather","Quill",
                    "Rosewood","Delacroix","Northcote","Abara","Winterbourne","Sallow"];
  const volOnly = [];
  for (let i = 0; i < 24; i++) {
    const id = `d_b72_vol${i}`;
    const name = `${VOL_FIRST[i]} ${VOL_LAST[i % VOL_LAST.length]}`;
    await q(`INSERT INTO donors (id,org_id,name,email,phone,stage,status,tags,person_types,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'prospect','active','[]','["volunteer"]'::jsonb,'system:volunteer-signup','The volunteer, from the sign-up link')`,
      [id, ORG, name, `${VOL_FIRST[i].toLowerCase()}.${VOL_LAST[i % VOL_LAST.length].toLowerCase()}@example.org`,
       `555-01${String(10 + i).padStart(2, "0")}`]);
    volOnly.push(id);
  }
  const allVols = [...givers, ...volOnly];

  // A company day. One group, eight of the volunteers on it, every one of
  // them still their own record with their own hours.
  const GROUP = "vg_b72_meridian";
  await q(`INSERT INTO volunteer_groups (id,org_id,name,kind,created_by,created_by_name)
           VALUES ($1,$2,'Meridian Bank, community day','company','u_b72demo','Dana Reyes')`, [GROUP, ORG]);

  // Shifts: four in the past (so there are hours and a report), three ahead
  // (so there is a schedule), and the next Saturday is FULL with two people
  // waiting — the state a coordinator most needs to recognise on sight.
  const dAdd = (iso, n) => {
    const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n);
    return new Date(t).toISOString().slice(0, 10);
  };
  const VOL_SLOTS = [
    { id: "vsl_b72_p1", opp: "vo_b72_shore", date: dAdd(TODAY, -35), s: "09:00", e: "13:00", cap: 12 },
    { id: "vsl_b72_p2", opp: "vo_b72_shore", date: dAdd(TODAY, -21), s: "09:00", e: "13:00", cap: 12 },
    { id: "vsl_b72_p3", opp: "vo_b72_tutor", date: dAdd(TODAY, -14), s: "16:00", e: "17:00", cap: 6 },
    { id: "vsl_b72_p4", opp: "vo_b72_gala", date: dAdd(TODAY, -7),  s: "17:00", e: "23:00", cap: 20 },
    { id: "vsl_b72_f1", opp: "vo_b72_shore", date: dAdd(TODAY, 5),  s: "09:00", e: "13:00", cap: 8,
      notes: "Gloves and bags provided. Wear boots you do not mind ruining." },
    { id: "vsl_b72_f2", opp: "vo_b72_tutor", date: dAdd(TODAY, 9),  s: "16:00", e: "17:00", cap: 6 },
    { id: "vsl_b72_f3", opp: "vo_b72_gala", date: dAdd(TODAY, 30),  s: "17:00", e: "23:00", cap: 20 },
  ];
  for (const sl of VOL_SLOTS) {
    await q(`INSERT INTO volunteer_slots (id,org_id,opportunity_id,date,start_time,end_time,capacity,notes,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'u_b72demo','Dana Reyes')`,
      [sl.id, ORG, sl.opp, sl.date, sl.s, sl.e, sl.cap, sl.notes || null]);
  }

  // Who is on what. The FULL one takes exactly its capacity and then two
  // more, who are waitlisted in order.
  let vsu = 0;
  const putOn = async (slotId, personId, status, opts = {}) => {
    vsu++;
    await q(`INSERT INTO volunteer_signups (id,org_id,slot_id,person_id,group_id,status,position,source,checked_in_at,checked_out_at,hours_shift_id,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [`vsu_b72_${vsu}`, ORG, slotId, personId, opts.groupId || null, status, opts.position || null,
       opts.source || "public", opts.in || null, opts.out || null, opts.shiftId || null,
       "system:volunteer-public", "The volunteer, from the sign-up page"]);
  };

  // The past shifts produce HOURS, through the same table the total is
  // summed from — a checked-out slot and a hand-logged shift are one number.
  let vsh = 0;
  const logHours = async (personId, date, hours, role) => {
    vsh++;
    const id = `vs_b72_${vsh}`;
    await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,via,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'staff','u_b72demo','Dana Reyes')`,
      [id, ORG, personId, date, hours, role]);
    return id;
  };
  const past = [
    { slot: VOL_SLOTS[0], who: allVols.slice(0, 11), hours: 4, role: "Saturday harbour clean-up" },
    { slot: VOL_SLOTS[1], who: allVols.slice(4, 14), hours: 4, role: "Saturday harbour clean-up" },
    { slot: VOL_SLOTS[2], who: allVols.slice(0, 5),  hours: 1, role: "After-school tutoring" },
    { slot: VOL_SLOTS[3], who: allVols.slice(8, 22), hours: 6, role: "Gala night crew" },
  ];
  for (const p of past) {
    for (const person of p.who) {
      const shiftId = await logHours(person, p.slot.date, p.hours, p.role);
      await putOn(p.slot.id, person, "completed", {
        source: "public", shiftId,
        in: `${p.slot.date}T${p.slot.s}:00Z`, out: `${p.slot.date}T${p.slot.e}:00Z`,
        groupId: p.slot.id === "vsl_b72_p4" ? GROUP : null,
      });
    }
  }
  // Four of the tutors have been at it every week, so somebody is over 25
  // hours and somebody is over 50 — the milestones have something to find.
  for (const [i, person] of allVols.slice(0, 4).entries()) {
    for (let w = 1; w <= 12 + i * 8; w++) await logHours(person, dAdd(TODAY, -(7 * w)), 1, "After-school tutoring");
  }

  // The full one, and the two waiting.
  for (const [i, person] of allVols.slice(0, 8).entries()) await putOn("vsl_b72_f1", person, "confirmed", { source: i < 3 ? "public" : "staff" });
  await putOn("vsl_b72_f1", allVols[8], "waitlisted", { position: 1 });
  await putOn("vsl_b72_f1", allVols[9], "waitlisted", { position: 2 });
  for (const person of allVols.slice(2, 7)) await putOn("vsl_b72_f2", person, "confirmed");
  for (const person of allVols.slice(10, 20)) await putOn("vsl_b72_f3", person, "confirmed", { groupId: GROUP, source: "group" });

  // Waivers and background checks: mostly current, one LAPSED and one
  // expiring inside the thirty-day window, because the screen is only worth
  // looking at when it has something to say.
  let vc = 0;
  const cred = async (personId, kind, signedOn, expiresOn) => {
    vc++;
    await q(`INSERT INTO volunteer_credentials (id,org_id,person_id,kind,signed_on,expires_on,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'u_b72demo','Dana Reyes')`,
      [`vc_b72_${vc}`, ORG, personId, kind, signedOn, expiresOn]);
  };
  for (const [i, person] of allVols.slice(0, 14).entries()) {
    await cred(person, "waiver", dAdd(TODAY, -300 + i), dAdd(TODAY, 65 + i * 3));
  }
  for (const [i, person] of allVols.slice(0, 5).entries()) {
    await cred(person, "background_check", dAdd(TODAY, -700 + i * 10), dAdd(TODAY, 120 + i * 30));
  }
  await cred(allVols[15], "background_check", dAdd(TODAY, -740), dAdd(TODAY, -12));   // LAPSED twelve days ago
  await cred(allVols[16], "waiver", dAdd(TODAY, -350), dAdd(TODAY, 11));              // expires in eleven days

  const [volCount] = await q(
    `SELECT COUNT(*)::int c FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND person_types @> '["volunteer"]'::jsonb`, [ORG]);
  const [volHours] = await q(
    `SELECT COALESCE(SUM(hours),0)::float h FROM volunteer_shifts WHERE org_id=$1`, [ORG]);
  console.log(`[assert] volunteers ${volCount.c} · ${Math.round(volHours.h)} hours on file · ${givers.length} of them also give`);
  if (volCount.c < 30) {
    console.error(`\nREFUSED: the volunteer programme needs at least 30 volunteers and made ${volCount.c}.`);
    process.exit(1);
  }

  // ── Goal from reality: ~85% of the way there reads like a live campaign ──
  const [raisedThisYear] = await q(
    `SELECT COALESCE(SUM(amount),0)::float d FROM gifts WHERE org_id=$1 AND date >= $2 AND campaign_id IS NULL`,
    [ORG, dateIn(YEAR, 1, 1)]);
  const goal = Math.round((raisedThisYear.d / 0.85) / 5000) * 5000;
  await q(`UPDATE campaigns SET goal_amount=$2 WHERE id='camp_b72demo' AND org_id=$1`, [ORG, goal]);
  // (The gala's gifts keep the gala's campaign — FIX-3 C.)
  await q(`UPDATE gifts SET campaign_id='camp_b72demo', campaign='Annual Fund ' || $2
            WHERE org_id=$1 AND date >= $3 AND campaign_id IS NULL`, [ORG, String(YEAR), dateIn(YEAR, 1, 1)]);

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

  // ── FIX-3 C — three thank-yous waiting, for the week's newest one-time
  // online gifts from people (the queue a real office opens on a Monday).
  // Written by the same template the server's queue uses; she sends them.
  const draftMod = await import("../shared/draftNote.js");
  const recentOnline = await q(
    `SELECT g.id, g.donor_id, g.amount::float amount, d.name FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id=$1 AND g.stripe_payment_id IS NOT NULL AND g.recurring_subscription_id IS NULL
        AND g.quid_pro_quo_value IS NULL AND d.kind IS NULL AND g.date <= $2
      ORDER BY g.date DESC, g.id DESC LIMIT 3`, [ORG, TODAY]);
  for (const [k, g] of recentOnline.entries()) {
    const t = draftMod.thankYouDraft({ donorName: g.name, giftCents: Math.round(g.amount * 100), fundName: null,
                                       orgName: "Harborlight Youth Collective", voice: { ready: false } });
    await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body,voice) VALUES ($1,$2,$3,$4,$5,$6)`,
            [`ty_b72_${k + 1}`, ORG, g.donor_id, g.id, t.body, t.voice]);
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
  // FIX-3 C, finding 14 — the channel mix, the monthly programme, the gala.
  // Same rule as the Reports giving summary: online = a Stripe payment id.
  const yearAgo = orgTime.addDays(TODAY, -365);
  const [mix] = await q(
    `SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float total,
            COUNT(*) FILTER (WHERE stripe_payment_id IS NOT NULL)::int online_n,
            COALESCE(SUM(amount) FILTER (WHERE stripe_payment_id IS NOT NULL),0)::float online_total,
            COUNT(*) FILTER (WHERE date > $3)::int future
       FROM gifts WHERE org_id=$1 AND (date > $2 OR date > $3)`, [ORG, yearAgo, TODAY]);
  const onlineShare = mix.total ? mix.online_total / mix.total : 0;
  const onlineCountShare = mix.n ? mix.online_n / mix.n : 0;
  if (onlineShare < SHAPE.onlineShareMin || onlineShare > SHAPE.onlineShareMax)
    shapeFail.push(`online share of the year's dollars ${(onlineShare * 100).toFixed(1)}% outside [${SHAPE.onlineShareMin * 100}%, ${SHAPE.onlineShareMax * 100}%]`);
  if (onlineCountShare < SHAPE.onlineCountShareMin)
    shapeFail.push(`online share of the year's gifts ${(onlineCountShare * 100).toFixed(1)}% below ${SHAPE.onlineCountShareMin * 100}%`);
  if (mix.future) shapeFail.push(`${mix.future} gift(s) dated after ${TODAY}`);
  const [subs] = await q(
    `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE last >= $2)::int current
       FROM (SELECT rs.id, MAX(g.date) last FROM recurring_subscriptions rs
               LEFT JOIN gifts g ON g.org_id = rs.org_id AND g.recurring_subscription_id = rs.id
              WHERE rs.org_id=$1 AND rs.status='active' GROUP BY rs.id) x`, [ORG, orgTime.addDays(TODAY, -32)]);
  if (subs.n < SHAPE.monthlyGiversMin) shapeFail.push(`${subs.n} active monthly givers, fewer than ${SHAPE.monthlyGiversMin}`);
  if (subs.current !== subs.n) shapeFail.push(`${subs.n - subs.current} monthly giver(s) not charged in the past month`);
  const [gl] = await q(
    `SELECT (SELECT COUNT(*) FROM event_attendees a JOIN event_levels l ON l.id=a.level_id WHERE a.event_id=$2 AND l.kind='ticket')::int tickets,
            (SELECT COUNT(*) FROM gifts WHERE org_id=$1 AND date=$3 AND campaign_id=$4 AND quid_pro_quo_value IS NULL)::int paddle,
            (SELECT revenue FROM events WHERE id=$2)::float revenue,
            (SELECT COALESCE(SUM(amount),0) FROM gifts WHERE org_id=$1 AND campaign_id=$4)::float gifts`,
    [ORG, gala.id, gala.date, gala.campaignId]);
  if (gl.tickets < GALA.ticketBuyersMin || gl.paddle < GALA.paddleGiftsMin || Math.abs(gl.revenue - gl.gifts) > 0.005)
    shapeFail.push(`the gala: ${gl.tickets} ticket buyers (≥${GALA.ticketBuyersMin}), ${gl.paddle} paddle-raise gifts (≥${GALA.paddleGiftsMin}), revenue ${gl.revenue} vs its gifts ${gl.gifts}`);
  // FIX-3 C, finding 8 — the finished demo holds no real person.
  const stillReal = await findRealPeople(q, ORG, { seededUserEmails: SEEDED_USER_EMAILS });
  if (stillReal.length) {
    console.error("\nREFUSED: the seeded demo org holds a real person:");
    stillReal.forEach(r => console.error(`  ${r.table} ${r.id} ${r.name} <${r.email}> — ${r.reason}`));
    process.exit(1);
  }
  if (shapeFail.length) {
    console.error("\nSHAPE ASSERTION FAILED — the generated file does not tell the story:");
    shapeFail.forEach(e => console.error("  " + e));
    process.exit(1);
  }
  console.log(`[assert] drifting/high ${driftingHigh} (range ${SHAPE.driftingHighMin}–${SHAPE.driftingHighMax}) · top-decile share ${(decileShare * 100).toFixed(1)}% — shape holds`);
  console.log(`[assert] the year online: ${(onlineShare * 100).toFixed(1)}% of dollars, ${(onlineCountShare * 100).toFixed(1)}% of gifts · ${subs.n} monthly givers · ${gala.name} on ${gala.date}: ${gl.tickets} ticket buyers, ${gl.paddle} paddle gifts, $${Math.round(gl.revenue).toLocaleString()} · no real person`);

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
  // FIX-3 C — each gift says how it came, in the fields the real writers
  // use: an online gift is what the Stripe webhook writes (type cash, Card,
  // a payment id — the seed's are all pi_demo_…, never a real charge — and
  // the webhook's actor); an offline gift is the director's cheque, ACH,
  // stock or DAF entry.
  const COLS = ["id", "org_id", "donor_id", "amount", "date", "type", "campaign", "campaign_id", "payment_method",
                "stripe_payment_id", "recurring_subscription_id", "notes", "quid_pro_quo_value", "quid_pro_quo_desc",
                "created_by", "created_by_name"];
  for (let i = 0; i < gifts.length; i += B) {
    const batch = gifts.slice(i, i + B);
    const vals = [], params = [];
    batch.forEach((g, k) => {
      const o = k * COLS.length;
      vals.push(`(${COLS.map((_, c) => `$${o + c + 1}`).join(",")})`);
      const method = g.online ? ["cash", "Card"] : (g.method || ["check", "Check"]);
      params.push(g.id, ORG, g.donorId, g.amount, g.date, method[0], g.campaign || null, g.campaignId || null, method[1],
                  g.online ? `pi_demo_${g.id}` : null, g.sub || null,
                  g.notes || (g.online ? "Online gift via the giving page" : null),
                  g.qpq || null, g.qpqDesc || null,
                  g.online ? "system:stripe-webhook" : "u_b72demo", g.online ? "Stripe (online)" : "Dana Reyes");
    });
    await client.query(`INSERT INTO gifts (${COLS.join(",")}) VALUES ${vals.join(",")}`, params);
  }
}

// ── FIX-3 C, finding 8 — REMOVE EVERY REAL PERSON FROM THE DEMO ORG ────────
// The walk found "Jonathan Atkinson $1" in the demo's thank-you list on prod:
// a real Stripe charge through the demo org's give page. The rule for "real"
// is scripts/lib/demoRealPeople.js (shared with the read-only prod check).
// This removes exactly the rows it matches — the person, their gifts and
// every row that hangs off them in `orgId` — and PRINTS each one, so a prod
// run says out loud what it took away. Every DELETE is pinned to org_id.
// Exported so tests/fix3-c-demo-people.test.js drives it on a FIXTURE org.
async function removeRealPeople(q, orgId, { seededUserEmails = SEEDED_USER_EMAILS, log = console.log } = {}) {
  const found = await findRealPeople(q, orgId, { seededUserEmails });
  if (!found.length) { log(`[real-people] no real person in ${orgId}`); return []; }
  log(`[real-people] ${found.length} row(s) in ${orgId} are real people — removing them:`);
  for (const r of found) log(`[real-people]   ${r.table} ${r.id}  ${r.name || "(no name)"} <${r.email || "no email"}>  — ${r.reason}`);
  const ids = t => found.filter(r => r.table === t).map(r => r.id);
  const donorIds = ids("donors"), guestIds = ids("event_attendees"), userIds = ids("users");
  const giftIds = donorIds.length
    ? (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id = ANY($2)`, [orgId, donorIds])).map(r => r.id) : [];
  // Every org-scoped table that points at one of those people or gifts.
  const cols = await q(
    `SELECT c.table_name, array_agg(c.column_name::text) AS cols
       FROM information_schema.columns c JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = current_schema() AND c.column_name IN ('org_id','donor_id','person_id','gift_id')
      GROUP BY c.table_name`);
  let pending = [];
  for (const { table_name: t, cols: cs } of cols) {
    if (!cs.includes("org_id") || t === "donors") continue;
    if (cs.includes("donor_id") && donorIds.length) pending.push([t, "donor_id", donorIds]);
    if (cs.includes("person_id") && donorIds.length) pending.push([t, "person_id", donorIds]);
    if (cs.includes("gift_id") && giftIds.length && t !== "gifts") pending.push([t, "gift_id", giftIds]);
  }
  if (guestIds.length) pending.push(["event_attendees", "id", guestIds]);
  if (userIds.length) pending.push(["users", "id", userIds]);
  const removed = {};
  // Foreign keys decide the order; a table that refuses goes round again.
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const retry = [];
    for (const [t, col, list] of pending) {
      try {
        const n = (await q(`DELETE FROM "${t}" WHERE org_id=$1 AND "${col}" = ANY($2) RETURNING 1`, [orgId, list])).length;
        if (n) removed[t] = (removed[t] || 0) + n;
      } catch (e) { retry.push([t, col, list, e.message]); }
    }
    if (retry.length === pending.length) {
      throw new Error(`removeRealPeople: could not clear ${retry.map(r => `${r[0]}.${r[1]} (${r[3]})`).join("; ")}`);
    }
    pending = retry.map(r => r.slice(0, 3));
  }
  if (donorIds.length) {
    const n = (await q(`DELETE FROM donors WHERE org_id=$1 AND id = ANY($2) RETURNING 1`, [orgId, donorIds])).length;
    if (n) removed.donors = n;
  }
  log(`[real-people] removed: ${Object.entries(removed).map(([t, n]) => `${n} ${t}`).join(", ") || "nothing"}`);
  return found;
}

// IDEMPOTENT BY TEARDOWN — every org-scoped table, not a hand-kept list.
// FIX-3 C: the old list missed tables a live donation writes to, so a real
// charge left rows the teardown never looked at (and, when one of them held
// a foreign key, the org row survived and the re-seed crashed on its INSERT).
// Every DELETE is pinned to org_id = orgId; the org row goes last, and a
// teardown that cannot remove it refuses rather than seeding over it.
async function teardownOrg(q, orgId) {
  const tables = (await q(
    `SELECT DISTINCT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = current_schema() AND c.column_name = 'org_id' AND c.table_name <> 'orgs'
      ORDER BY 1`)).map(r => r.table_name);
  let pending = tables;
  for (let pass = 0; pass < 10 && pending.length; pass++) {
    const retry = [];
    for (const t of pending) { try { await q(`DELETE FROM "${t}" WHERE org_id=$1`, [orgId]); } catch { retry.push(t); } }
    if (retry.length === pending.length) break;
    pending = retry;
  }
  await q(`DELETE FROM orgs WHERE id=$1`, [orgId]).catch(() => {});
  const [left] = await q(`SELECT COUNT(*)::int AS n FROM orgs WHERE id=$1`, [orgId]);
  if (left.n) {
    console.error(`\nREFUSED: the teardown could not remove org ${orgId}; still refusing: ${pending.join(", ") || "(the orgs row itself)"}\n`);
    process.exit(1);
  }
}

module.exports = { DRIFTED, SHAPE, GALA, ORG, ADMIN_EMAIL, ADMIN_PASSWORD, SEEDED_USER_EMAILS, removeRealPeople };

// Only run when invoked directly — tests/demo-shape.test.js requires this file
// for DRIFTED/SHAPE and must not trigger a seed by importing it.
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
