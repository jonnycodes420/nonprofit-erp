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
//
// FIX-5 — THE POOL IS 64 × 72 NOW, AND NOBODY IS CALLED "DONOR 1002".
// It was 30 × 30 = 900 pairs for a file of about 1,150 people, so the draw ran
// out and fell back to minting "Donor 1002 Ashgrove": 205 of them, sitting in
// the donor list of the screen the product is sold on. 4,608 pairs for 1,150
// people is a draw that lands, and the registry below is what makes the
// guarantee rather than the arithmetic.
const FIRST = ["Marguerite","Halvard","Ondine","Casper","Wilhelmina","Tobias","Rosalind","Emmett","Philippa","Gideon","Cordelia","Ansel","Beatrix","Rufus","Isolde","Barnaby","Clementine","Alaric","Perpetua","Silas","Verity","Osric","Henrietta","Leopold","Araminta","Fenwick","Drusilla","Cuthbert","Marisol","Thaddeus",
               "Anneliese","Bartholomew","Celestine","Dorotea","Ezekiel","Flavia","Gervase","Hyacinth","Ignatius","Jocasta","Kenelm","Lavinia","Mordecai","Nerissa","Octavian","Persis","Quenby","Rowena","Septimus","Theodora","Ulric","Vespasia","Winifred","Xanthe","Yseult","Zephyrine","Amabel","Bertrand","Constance","Desmond","Eulalia","Fitzhugh","Griselda","Horatio"];
const LAST  = ["Ashgrove","Bellwether","Cinderhalt","Dunmoor","Elmsworth","Fairweather","Glasswick","Hollowell","Ironvale","Jessamine","Kettleby","Lindquist","Marchbanks","Netherfield","Oakhampton","Pemberton","Quillfeather","Ravensmere","Stonebridge","Thornbury","Underhill","Vanterpool","Wexford","Yarrowdale","Ziegler","Applewhite","Braithwaite","Carrowmore","Dellacroix","Everhart",
               "Ashenhurst","Barrowcliffe","Cranmoor","Darrowby","Eastleigh","Fennimore","Grimsdale","Harrowgate","Inglewood","Jarrowfield","Kirkbride","Larkmead","Mossbank","Norrington","Ollerenshaw","Pendlebury","Quarrendon","Rushmere","Saltonstall","Thistlewood","Ulverston","Vellacott","Wharfedale","Yelverton","Zennor","Abberline","Blackmoor","Cobbleworth","Duffield","Edgerton","Frostwick","Gillingwater","Haverbrook","Inkpen","Jewkes","Kelsingham","Lammermoor","Merripen","Nettlefold","Ockendon","Pentreath","Ravelstoke"];

// ── FIX-5 · ONE NAME REGISTRY FOR THE WHOLE DEMO ─────────────────────────
// Every person the seed writes goes through here, so no two of them share a
// full name anywhere in Harborlight — donors, organisations, volunteers, staff
// and gala guests alike. It used to be enforced on the derived EMAIL and only
// inside the tail generator, which meant the hand-written names, the eleven,
// the volunteers (their own separate pool, "Rufus Fairweather" in both) and
// the staff could all collide with the generated file and nothing noticed.
//
// The key is case-folded and whitespace-collapsed, because "two people with
// the same name" is a thing a person judges by eye, not by byte.
const takenNames = new Set();
// Names the generator has MINTED but nobody has been given yet. Without this,
// a generated name is reserved by `mkName` and then rejected by `addDonor` a
// line later as a collision with itself — which is how the first run of this
// registry failed, on "Fenwick Ravensmere".
const mintedNames = new Set();
const nameKey = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
// true if the name was free and is now this person's. Callers that must not
// collide throw on false; mkName just draws again.
const takeName = name => {
  const k = nameKey(name);
  if (!k) return false;
  if (mintedNames.has(k)) { mintedNames.delete(k); return true; }   // claiming what mkName minted
  if (takenNames.has(k)) return false;
  takenNames.add(k);
  return true;
};
// What mkName does: reserve the name against the whole file AND remember that
// it is still on its way to a person.
const mintName = name => {
  const k = nameKey(name);
  if (!k || takenNames.has(k)) return false;
  takenNames.add(k); mintedNames.add(k);
  return true;
};
const emailFor = name => name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") + "@example.demo";

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
  // INT-BUILD-1 — Margaret Chen is now the inbox-and-calendar story (coffee
  // tomorrow, a $15,000 August gift), which cannot also be silent for 14
  // months. The canonical drift example keeps her numbers under a new name.
  ["Eleanor Whitcombe", 2000, "seasonal"],      // THE canonical example
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
  await teardownOrg(q, ORG);

  // ── The organization ────────────────────────────────────────────────────
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,mission,emails_enabled,is_demo_org)
           VALUES ($1,'Harborlight Youth Collective','harborlight',1,'active','team',$2,
                   'After-school arts and mentoring for young people on the north shore.',
                   false,true)`, [ORG, TZ]);   // INCIDENT 2026-09-22: a seeded org sends nothing
  // FIX-5 — the two staff names are claimed FIRST, before a generated donor
  // can be handed either of them. The director's own name turning up again
  // halfway down her donor list is the worst version of this bug.
  takeName("Dana Reyes"); takeName("Priya Raman");
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b72demo',$1,$2,$3,'Dana Reyes','admin')`,
          [ORG, ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b72demo_off',$1,'officer@harborlight.demo',$2,'Priya Raman','member')`,
          [ORG, bcrypt.hashSync(ADMIN_PASSWORD, 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b72demo',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b72demo_gen',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b72demo_sch',$1,'Scholarship Fund',true)`, [ORG]);
  // INT-BUILD-1 — the two funds Margaret Chen's story names.
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b72demo_yaa',$1,'Youth Arts Access',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b72demo_gala',$1,'Gala Reserve',false)`, [ORG]);
  // FIN-1 — a THIRD fund, and it is restricted and actually holds money. The
  // demo had two funds and a restricted balance of zero, so the one screen
  // that exists to answer "how much of this is not ours to spend" answered
  // nothing, and a treasurer opening it learned less than from the bank.
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted,description)
           VALUES ('fund_b72demo_boat',$1,'Harbor Skills Boat',true,'The Meridian Foundation grant for the second training boat.')`, [ORG]);
  // Goal is set AFTER the gifts exist, from what was actually raised (below) —
  // a demo whose first screen reads "666% · $1,018,277 over" looks broken, not
  // successful. Created here with a placeholder; corrected once totals are in.
  // PARITY-1 Part C — the Annual Fund is the org's ANNUAL goal (goal_category),
  // which is what Home's goal bar under "Calls to make" draws.
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,goal_category)
           VALUES ('camp_b72demo',$1,'Annual Fund ' || $2,'appeal','active',1,$3,$4,'annual')`,
          [ORG, String(YEAR), dateIn(YEAR, 1, 1), dateIn(YEAR, 12, 31)]);

  const donors = [], gifts = [];
  let gid = 0, did = 0;
  const pinnedStage = [];   // donors whose stage is DELIBERATE, never re-inferred
  const addDonor = (name, email, o = {}) => {
    // FIX-5 — the registry is checked HERE, so every literal name in this file
    // is covered without anybody remembering to. `sharesNameWith` is the one
    // door out of it and there is exactly one user of it: the merge fixture,
    // which is ONE person holding TWO records on purpose.
    if (!takeName(name) && !o.sharesNameWith)
      throw new Error(`[seed] two people would be called "${name}". Every demo person has their own name.`);
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

  // ── INT-BUILD-1 Part 7 · MARGARET CHEN, AS THE MOCKUP TELLS HER ─────────
  // $187,500 over eleven years, $40,000 of it this year, $15,000 of that on
  // the gift ~58 days back (Aug 4 on the day the mockup was drawn), which has
  // not been thanked by hand. Every date is relative to the seed day, so
  // "tomorrow" stays tomorrow. Her meetings, emails and ask are written after
  // the inbox, below.
  const margaretId = addDonor("Margaret Chen", "margaret.chen@example.demo",
                              { status: "major", stage: "steward", officer: "u_b72demo", pin: true });
  const MARGARET_AUG = orgTime.addDays(TODAY, -58);
  const margaretAugGift = addGift(margaretId, 15000, MARGARET_AUG, { method: ["ach", "ACH"], fundId: "fund_b72demo_gala", notes: "Gala Reserve" });
  addGift(margaretId, 15000, orgTime.addDays(TODAY, -230), { method: ["ach", "ACH"] });
  addGift(margaretId, 10000, orgTime.addDays(TODAY, -150), { method: ["ach", "ACH"] });
  for (let y = 1; y <= 10; y++) addGift(margaretId, 14750, orgTime.addDays(TODAY, -(365 * y + 58)), { method: ["check", "Check"] });

  // ── FIX-5 · THE NAMED PEOPLE ARE CLAIMED BEFORE THE TAIL IS DRAWN ───────
  // Every person below this point who is written by hand has a job — the
  // lapsed major, the household, the two-record merge fixture, the pledges,
  // the failed card, the sponsors — and the tail generator draws from the same
  // two pools their names came from. Claimed here, in file order, so a
  // generated donor can never be handed one of them and leave the demo with
  // two Henrietta Stonebridges. Adding a hand-written person means adding them
  // to this list; the registry in addDonor throws if you forget.
  for (const n of [
    "Verity Underhill", "Osric Ravensmere", "Henrietta Stonebridge", "Leopold Stonebridge",
    "Araminta Wexford", "Isolde Fennimore", "Barnaby Thistlewood", "Ondine Cinderhalt",
    "Tidewater Community Foundation", "Grace Chapel", "Saltbox Printing",
    "Halyard & Pike Architects", "Brinewood Hardware",
  ]) mintName(n);

  // ── The rest of the file: ~1,000 donors on the FEP shape — roughly 200
  // carrying about 90% of revenue.
  console.log("[seed] the long tail on the FEP distribution…");
  // FIX-5 — draws against the ONE registry, and there is no filler-name
  // fallback any more. If the random draw keeps landing on taken pairs the
  // pairs are WALKED in order, which cannot fail while one is free; a pool
  // genuinely exhausted throws, because "add more names" is a thing to fix in
  // this file rather than to paper over on the demo screen.
  const mkName = () => {
    for (let i = 0; i < 400; i++) {
      const n = `${pick(FIRST)} ${pick(LAST)}`;
      if (mintName(n)) return [n, emailFor(n)];
    }
    for (const f of FIRST) for (const l of LAST) {
      const n = `${f} ${l}`;
      if (mintName(n)) return [n, emailFor(n)];
    }
    throw new Error(`[seed] the name pool is exhausted at ${takenNames.size} people. Add first or last names to FIRST/LAST.`);
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
  // FIX-5 — the one repeated name in Harborlight, and it is not two people.
  // `sharesNameWith` says so out loud: this is the SECOND RECORD of the person
  // above, which is the whole point of the merge fixture. Making these two
  // names different would delete the demo's only duplicate-record story.
  const twoAddrB = addDonor("Osric Ravensmere", "o.ravensmere@example.demo",
                            { status: "mid", stage: "cultivate", city: "Salem", state: "MA",
                              sharesNameWith: twoAddr });
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
  // ── ENGAGE-1 · THE SPRING APPEAL, THIS YEAR AND LAST ────────────────────
  // WHY-1 — "Why did the spring appeal come in under last year?" is the demo's
  // first question, so the gap is made of real reasons, each one a set of
  // people the answer can open:
  //   ELEVEN of last spring's donors have not given yet (the call list),
  //   TWO more gave late last May, and this spring's letter went out TWELVE
  //     days later (13 March, not 1 March) with the same end date, so the
  //     window they gave in last time has not been open this year (timing),
  //   FOUR gave less, seven gave more, six gave the same,
  //   THREE people gave their very first gift to Harborlight through it.
  // Drawn from donors who ARE giving this year, so none of the eleven drifted
  // donors (the thesis: nothing this year) is quietly made to give.
  const SPRING = { last: "camp_b72demo_spring_prev", now: "camp_b72demo_spring" };
  const springEight = [];   // the eleven not back yet: their touches are written after writeAll
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date)
           VALUES ($1,$2,$3,'appeal','completed',40000,$4,$5), ($6,$2,$7,'appeal','completed',45000,$8,$9)`,
    [SPRING.last, ORG, `Spring Appeal ${YEAR - 1}`, dateIn(YEAR - 1, 3, 1), dateIn(YEAR - 1, 5, 31),
     SPRING.now, `Spring Appeal ${YEAR}`, dateIn(YEAR, 3, 13), dateIn(YEAR, 5, 31)]);
  {
    const givingNow = new Set(gifts.filter(g => String(g.date).startsWith(String(YEAR))).map(g => g.donorId));
    const drifted = new Set(driftedIds);
    const pool = donors.filter(d => d.status === "mid" && givingNow.has(d.id) && !drifted.has(d.id)).slice(0, 30);
    const LAPSED = [2500, 2000, 1500, 1200, 1000, 1000, 800, 750, 600, 500, 400];   // eleven, nothing yet
    const LATE = [600, 350];                                                       // gave after 19 May last year
    const LESS = [[1500, 1000], [1200, 800], [1000, 600], [900, 500]];              // four who gave less
    const REST = [800, 750, 700, 650, 600, 600, 500, 500, 500, 400, 400, 350, 300]; // seven more, six the same
    pool.forEach((d, i) => {
      if (i < 11) {
        addGift(d.id, LAPSED[i], dateIn(YEAR - 1, 3, 20 + (i % 9)), { campaign: `Spring Appeal ${YEAR - 1}`, campaignId: SPRING.last });
        springEight.push(d.id); return;
      }
      if (i < 13) {
        addGift(d.id, LATE[i - 11], dateIn(YEAR - 1, 5, 22 + (i - 11) * 4), { campaign: `Spring Appeal ${YEAR - 1}`, campaignId: SPRING.last });
        return;
      }
      if (i < 17) {
        const [was, now] = LESS[i - 13];
        addGift(d.id, was, dateIn(YEAR - 1, 4, 2 + i), { campaign: `Spring Appeal ${YEAR - 1}`, campaignId: SPRING.last });
        addGift(d.id, now, dateIn(YEAR, 4, 2 + i), { campaign: `Spring Appeal ${YEAR}`, campaignId: SPRING.now });
        return;
      }
      const k = i - 17, was = REST[k] || 250;
      const now = k < 7 ? Math.round(was * 1.5 / 50) * 50 : was;
      addGift(d.id, was, dateIn(YEAR - 1, 4, 1 + (k % 27)), { campaign: `Spring Appeal ${YEAR - 1}`, campaignId: SPRING.last });
      addGift(d.id, now, dateIn(YEAR, 4, 1 + (k % 27)), { campaign: `Spring Appeal ${YEAR}`, campaignId: SPRING.now });
    });
    [["Imogen Fairweather", 500], ["Ruth Okonkwo-Hale", 250], ["Calvin Ashdown", 150]].forEach(([name, amt], i) => {
      const id = addDonor(name, name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.demo", { status: "new", stage: "prospect" });
      addGift(id, amt, dateIn(YEAR, 4, 10 + i * 3), { campaign: `Spring Appeal ${YEAR}`, campaignId: SPRING.now });
    });
  }

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

  // FIX-22 · a working office has an owner on most of its file. Only one
  // person in seven had one, so "Who could give more?" could name nobody who
  // knows them best for most of its list (why.js reads who logged their
  // conversations, else their owner). Everyone with a gift on file and no
  // owner yet gets one, by their place in the list: two in three are the
  // director's, one in three the officer's. No random draw, so the seed stays
  // deterministic; giftless prospects stay unassigned, the pile a new
  // officer would be handed.
  {
    const gave = new Set(gifts.map(g => g.donorId));
    let k = 0;
    for (const d of donors) if (!d.officer && gave.has(d.id)) d.officer = k++ % 3 === 2 ? "u_b72demo_off" : "u_b72demo";
  }
  await writeAll(client, donors, gifts);
  // ENGAGE-1 — five of the eleven not back from the spring appeal have been in
  // touch lately, six have not, so "Who to call" ranks on something real:
  // what they gave last time, and how close they are now.
  const SPRING_TOUCH = [["meeting", "Coffee near the boatyard. Asked how the spring cohort did.", 12],
                        ["call", "Returned my call about the summer programme.", 30],
                        ["meeting", "Toured the workshop with their daughter.", 55],
                        ["call", "Left a message; they called back the next day.", 140],
                        ["call", "Short call, thanked them for last spring.", 260]];
  for (const [k, [touch, note, ago]] of SPRING_TOUCH.entries()) {
    if (!springEight[k]) break;
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'u_b72demo','Dana Reyes')`,
            [`int_b72_spring_${k}`, ORG, springEight[k], touch, note, orgTime.addDays(TODAY, -ago)]);
  }
  // FIX-14 Part 3 — the Stonebridges ARE a household (the comment above
  // always said so; the row was never written), so the profile draws a
  // household name and the smoke walk can check it is a real link.
  await q(`INSERT INTO households (id,org_id,name,primary_donor_id,created_by,created_by_name)
           VALUES ('hh_b72_stonebridge',$1,'The Stonebridges',$2,'system:seed-demo','The demo seed')`, [ORG, hh1]);
  await q(`UPDATE donors SET household_id='hh_b72_stonebridge' WHERE org_id=$1 AND id IN ($2,$3)`, [ORG, hh1, hh2]);
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
  await seedCardUpdates(q, monthly);
  await seedGiftStarts(q);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date)
           VALUES ($1,$2,$3,'event','completed',$4,$5,$6)`,
          [gala.campaignId, ORG, gala.name, 100000, orgTime.addDays(gala.date, -75), gala.date]);
  const galaRevenue = gifts.filter(g => g.campaignId === gala.campaignId).reduce((t, g) => t + g.amount, 0);
  // EVENTS-1 — the gala carries a GOAL and the campaign it raises into, so the
  // card and the report have something to measure against.
  await q(`INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,revenue,cost,goal_amount,campaign_id,created_by,created_by_name)
           VALUES ($1,$2,$3,'gala',$4,$4,$5,$6,220,'completed',$7,$8,$9,$10,'u_b72demo','Dana Reyes')`,
          [gala.id, ORG, gala.name, gala.date, GALA.venue,
           "Our annual gala: dinner, a student showcase, and a paddle raise for the scholarship fund.",
           galaRevenue, 41500, 100000, gala.campaignId]);
  await q(`UPDATE events SET public_slug='harbor-lights-gala' WHERE id=$1 AND org_id=$2`, [gala.id, ORG]);
  // FIX-11 Part 5 — THE DEMO RECEIVES NO MAIL. Its people are fictional and
  // strangers look at its screens, so a real email BCC'd to its logging
  // address has nowhere honest to go. The env flag is the deployment's gate;
  // this is the org's, and the demo is the one org that is always out.
  await q(`UPDATE orgs SET inbound_email_enabled = FALSE WHERE id = $1`, [ORG]);
  // Every gala gift is STAMPED with the event, so "raised" is a sum over an id
  // and the rows behind the number open. Without it the figure fell back to
  // matching a campaign NAME, and the drill-through returned nothing.
  await q(`UPDATE gifts SET event_id=$1 WHERE org_id=$2 AND campaign_id=$3`, [gala.id, ORG, gala.campaignId]);
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
             g.recognition ? `${d.name}, ${g.recognition}` : null, g.amount, `Table ${1 + (k % 12)}`]);
  }
  // ── EVENTS-1 · THE NIGHT ITSELF ────────────────────────────────────────
  // TWELVE tables, round-robin so every one of them is populated (they used to
  // fill five at a time, so the first tables were full and the last were
  // empty, which is not a seating chart anybody would print). A handful are
  // left WITHOUT a seat on purpose: the people missing from the chart are the
  // ones the chart exists to show.
  //
  // FIX-11 Part 2 — THE TWELVE TABLES ARE ROWS NOW, ten seats each, which is a
  // hundred and twenty places. Before Part 2 a table existed only because
  // somebody was sitting at it, so this demo had twelve tables and a real
  // customer's new gala had none and no way to make one.
  for (let n = 1; n <= 12; n++) {
    await q(`INSERT INTO event_tables (id,org_id,event_id,label,seats,sort,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,10,$5,'u_b72demo','Dana Reyes')
             ON CONFLICT (event_id,label) DO UPDATE SET seats=EXCLUDED.seats, sort=EXCLUDED.sort`,
            [`etb_b72_${pad(n)}`, ORG, gala.id, `Table ${n}`, n]);
  }
  await q(`UPDATE event_attendees a SET table_id = t.id
             FROM event_tables t
            WHERE t.event_id = a.event_id AND t.label = a.table_label
              AND a.org_id=$1 AND a.event_id=$2`, [ORG, gala.id]);
  // ONE PARTY OF FOUR with nowhere to sit, rather than four unrelated people.
  // A party is the case the seating screen has to get right: four people on
  // one ticket sit together or not at all, and "Seat everyone" must refuse
  // rather than split them. Four unrelated singles would have hidden that.
  const strays = await q(`SELECT id FROM event_attendees WHERE org_id=$1 AND event_id=$2 ORDER BY id DESC LIMIT 4`,
                         [ORG, gala.id]);
  if (strays.length === 4) {
    const host = strays[0].id;
    await q(`UPDATE event_attendees SET table_label=NULL, table_id=NULL WHERE id = ANY($1)`,
            [strays.map(r => r.id)]);
    await q(`UPDATE event_attendees SET guest_of=$1 WHERE id = ANY($2)`,
            [host, strays.slice(1).map(r => r.id)]);
  }
  // Dietary notes on a few, because that is the column a caterer rings about.
  const DIETS = ["Vegetarian", "Gluten free", "No shellfish", "Vegan", "Nut allergy"];
  const dietRows = await q(`SELECT id FROM event_attendees WHERE org_id=$1 AND event_id=$2 ORDER BY id LIMIT 14`, [ORG, gala.id]);
  for (const [i, r] of dietRows.entries())
    await q(`UPDATE event_attendees SET dietary=$1 WHERE id=$2`, [DIETS[i % DIETS.length], r.id]);
  // Everybody marked as having come was checked in at the door, a few minutes
  // either side of the hour the doors opened.
  await q(`UPDATE event_attendees SET checked_in_at = ($1::date + TIME '18:30') + (random() * INTERVAL '70 minutes')
            WHERE org_id=$2 AND event_id=$3 AND status='attended'`, [gala.date, ORG, gala.id]);

  // ── THE 5K THAT HAS NOT HAPPENED YET ───────────────────────────────────
  // An event with a goal, two ticket levels and nobody registered: the state
  // every event is in on the day it is created, and the one the Events home
  // has to look right in.
  const run5k = { id: "ev_b72_5k", date: orgTime.addDays(TODAY, 68) };
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date)
           VALUES ($1,$2,$3,'event','active',$4,$5,$6)`,
          ["camp_b72_5k", ORG, `Harbor Run ${run5k.date.slice(0, 4)}`, 25000, TODAY, run5k.date]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,revenue,cost,goal_amount,campaign_id,created_by,created_by_name)
           VALUES ($1,$2,$3,'other',$4,$4,$5,$6,400,'upcoming',0,3200,$7,$8,'u_b72demo','Dana Reyes')`,
          [run5k.id, ORG, `Harbor Run ${run5k.date.slice(0, 4)}`, run5k.date, "North Shore Path, Harborlight",
           "A five kilometre run and walk along the shore. Families welcome, and every runner raises for the scholarship fund.",
           25000, "camp_b72_5k"]);
  // EVENTS-2 — Harborlight is a US organisation, so it is "harbor" everywhere
  // and the money is dollars. The old slug is kept as `previous_slug` so every
  // /e/harbour-run link already printed, posted or shared still opens.
  await q(`UPDATE events SET public_slug='harbor-run', previous_slug='harbour-run' WHERE id=$1 AND org_id=$2`, [run5k.id, ORG]);
  // EVENTS-2 — the 5K is OPEN: two ticket types with a member price, a
  // capacity on the family entry so it can sell out, and a sponsorship.
  const RUN_LEVELS = [
    ["evl_b72_run_adult", "ticket", "Adult entry", 35, 12, 28, null, null],
    ["evl_b72_run_family", "ticket", "Family entry, up to four", 90, 30, 72, null, 40],
    ["evl_b72_run_sponsor", "sponsor", "Mile sponsor", 1000, 0, null, "Mile sponsor", null],
  ];
  for (const [k, [id, kind, name, price, fmv, memberPrice, recognition, capacity]] of RUN_LEVELS.entries())
    await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv,member_price,recognition,capacity,position,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'u_b72demo','Dana Reyes')`,
            [id, ORG, run5k.id, kind, name, price, fmv, memberPrice, recognition, capacity, k]);

  // A few people have already entered, so the page is not a page nobody has
  // used. They are written the way a staff registration is written — the demo
  // never touches a card — and one person is on the waiting list for the
  // family entry, which is the state a coordinator has to recognise on sight.
  const runEntrants = await q(
    `SELECT id, name, email FROM donors WHERE org_id=$1 AND deleted_at IS NULL
       AND email IS NOT NULL AND email <> '' ORDER BY total_giving DESC OFFSET 40 LIMIT 5`, [ORG]);
  for (const [i, p] of runEntrants.entries()) {
    const lvl = i % 2 ? "evl_b72_run_family" : "evl_b72_run_adult";
    await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,level_id,quantity,source,notes)
             VALUES ($1,$2,$3,$4,$5,$6,'registered',$7,1,'public','Entered through the event page.')
             ON CONFLICT (event_id, donor_id) DO NOTHING`,
      [`att_b72_run${i}`, run5k.id, ORG, p.id, p.name, p.email, lvl]);
  }
  const [waiter] = await q(
    `SELECT id, name, email FROM donors WHERE org_id=$1 AND deleted_at IS NULL
       AND email IS NOT NULL AND email <> '' ORDER BY total_giving DESC OFFSET 60 LIMIT 1`, [ORG]);
  if (waiter) {
    await q(`INSERT INTO event_waitlist (id,org_id,event_id,level_id,name,email,qty,position,created_by,created_by_name)
             VALUES ($1,$2,$3,'evl_b72_run_family',$4,$5,1,1,'system:event-waitlist','The waiting list, from the event page')`,
      ["ewl_b72_run1", ORG, run5k.id, waiter.name, waiter.email]);
  }
  console.log(`[assert] the 5K is open: ${RUN_LEVELS.length} levels (members pay $28 and $72), ${runEntrants.length} entered, ${waiter ? "1 waiting" : "nobody waiting"} · /e/harbor-run, with /e/harbour-run redirecting`);

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
  // FIX-5 — the one line under the name comes from the preset too, for the same
  // reason the steps do: the demo reads the catalogue, it does not carry a copy.
  await q(`INSERT INTO cultivation_templates
             (id,org_id,name,description,steps,trigger_key,priority,preset_key,journey_enabled,created_by,created_by_name)
           VALUES ($1,$2,'New donor, first year',$4,$3::jsonb,'first_gift',50,'new_donor_first_year',true,
                   'u_b72demo','Dana Reyes')`,
          [JOURNEY_TPL, ORG, JSON.stringify(JOURNEY_STEPS), JOURNEY_PRESET.blurb]);

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
           VALUES ($1,$2,'Meridian Foundation','Harbor Skills: second training boat',85000,55000,'awarded',$3,
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
    { id: "vo_b72_shore", name: "Saturday harbor clean-up", slug: "saturday-harbor-clean-up",
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
      ORDER BY total_giving DESC OFFSET 12 LIMIT 12`, [ORG])).map(r => r.id);   // PARITY-3: twelve who give
  for (const id of givers) {
    await q(`UPDATE donors SET person_types = CASE
               WHEN person_types @> '["volunteer"]'::jsonb THEN person_types
               ELSE COALESCE(person_types,'["donor"]'::jsonb) || '["volunteer"]'::jsonb END
             WHERE id=$1 AND org_id=$2`, [id, ORG]);
  }
  // FIX-5 — TWENTY-FOUR SURNAMES FOR TWENTY-FOUR VOLUNTEERS, paired one to one.
  // The surnames used to cycle (`i % 14`), which was safe only by luck: the
  // volunteer pool overlaps the donor pool on both sides ("Marisol", "Rufus",
  // "Fairweather"), and nothing here checked the names the rest of the file had
  // already used. Each name now goes through the same registry as everybody
  // else, and a clash throws instead of shipping two people with one name.
  const VOL_FIRST = ["Marisol","Dev","Aiko","Tomas","Nell","Rufus","Priya","Odin","Clara","Bertie",
                     "Ines","Kofi","Saoirse","Milo","Freya","Hassan","Juno","Emeka","Lotte","Arjun",
                     "Wren","Ottoline","Cassius","Maeve","Tamsin","Ezra","Lucian","Philippa"];
  const VOL_LAST = ["Vance","Okonjo","Brightwater","Mendel","Ashcroft","Iyer","Fairweather","Quill",
                    "Rosewood","Delacroix","Northcote","Abara","Winterbourne","Sallow",
                    "Tremaine","Oyelaran","Halliwell","Strand","Beaumaris","Ng","Castellan",
                    "Fitzgibbon","Larkspur","Orsini","Hollowell","Penhaligon","Marchbank","Ravensworth"];
  const volOnly = [];
  for (let i = 0; i < 28; i++) {   // PARITY-3: twenty-eight who have never given
    const id = `d_b72_vol${i}`;
    const name = `${VOL_FIRST[i]} ${VOL_LAST[i]}`;
    if (!takeName(name))
      throw new Error(`[seed] the volunteer "${name}" has the same name as somebody already in the file.`);
    await q(`INSERT INTO donors (id,org_id,name,email,phone,stage,status,tags,person_types,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'prospect','active','[]','["volunteer"]'::jsonb,'system:volunteer-signup','The volunteer, from the sign-up link')`,
      [id, ORG, name, `${VOL_FIRST[i].toLowerCase()}.${VOL_LAST[i].toLowerCase()}@example.org`,
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
    // PARITY-3: the three future one-offs moved off the weekly shifts' hours
    // (an afternoon clean-up, evening tutoring, an 18:00 gala), so the seeded
    // month has exactly the one conflict it means to, whatever day it runs.
    { id: "vsl_b72_f1", opp: "vo_b72_shore", date: dAdd(TODAY, 5),  s: "14:00", e: "18:00", cap: 8,
      notes: "Gloves and bags provided. Wear boots you do not mind ruining." },
    { id: "vsl_b72_f2", opp: "vo_b72_tutor", date: dAdd(TODAY, 9),  s: "18:00", e: "19:00", cap: 6 },
    { id: "vsl_b72_f3", opp: "vo_b72_gala", date: dAdd(TODAY, 30),  s: "18:00", e: "23:00", cap: 20 },
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
  // PARITY-3 — each one knows its opportunity and shift, so the profile's
  // hours log reads "Saturday harbor clean-up", filters by opportunity, and
  // a few carry the kind of note a coordinator actually writes.
  const OPP_OF_ROLE = { "Saturday harbor clean-up": "vo_b72_shore", "After-school tutoring": "vo_b72_tutor", "Gala night crew": "vo_b72_gala" };
  const HOUR_NOTES = ["Stayed late to sort the recycling", "Brought two friends along", "Led the north beach team", "Covered for a tutor who was ill"];
  const logHours = async (personId, date, hours, role, slotId = null, start = null, end = null) => {
    vsh++;
    const id = `vs_b72_${vsh}`;
    await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,via,created_by,created_by_name,opportunity_id,slot_id,start_time,end_time,note)
             VALUES ($1,$2,$3,$4,$5,$6,'staff','u_b72demo','Dana Reyes',$7,$8,$9,$10,$11)`,
      [id, ORG, personId, date, hours, role, OPP_OF_ROLE[role] || null, slotId, start, end, vsh % 9 === 0 ? HOUR_NOTES[(vsh / 9) % HOUR_NOTES.length] : null]);
    return id;
  };
  const past = [
    { slot: VOL_SLOTS[0], who: allVols.slice(0, 11), hours: 4, role: "Saturday harbor clean-up" },
    { slot: VOL_SLOTS[1], who: allVols.slice(4, 14), hours: 4, role: "Saturday harbor clean-up" },
    { slot: VOL_SLOTS[2], who: allVols.slice(0, 5),  hours: 1, role: "After-school tutoring" },
    { slot: VOL_SLOTS[3], who: allVols.slice(8, 22), hours: 6, role: "Gala night crew" },
  ];
  for (const p of past) {
    for (const person of p.who) {
      const shiftId = await logHours(person, p.slot.date, p.hours, p.role, p.slot.id, p.slot.s, p.slot.e);
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

  // PARITY-3 Part 1 — skills, certifications and tags, and notes kept apart:
  // internal ones for staff, and one the volunteer sees on their own page.
  {
    const QUALS = [["skill", "Spanish"], ["skill", "Maths tutoring"], ["certification", "First aid", dAdd(TODAY, 200)],
                   ["certification", "Food handling", dAdd(TODAY, -20)], ["tag", "Saturday regular"], ["tag", "Team lead"]];
    let nq = 0;
    for (const [i, person] of allVols.slice(0, 12).entries()) {
      for (const [k, name, exp] of [QUALS[i % QUALS.length], QUALS[(i + 3) % QUALS.length]]) {
        nq++;
        await q(`INSERT INTO volunteer_qualifications (id,org_id,person_id,kind,name,expires_on,created_by,created_by_name)
                 VALUES ($1,$2,$3,$4,$5,$6,'u_b72demo','Dana Reyes') ON CONFLICT DO NOTHING`, [`vq_b72_${nq}`, ORG, person, k, name, exp || null]);
      }
    }
    const NOTES = [
      [allVols[0], "availability", "Saturdays only until the spring; works shifts in the week.", "internal"],
      [allVols[0], "note", "Thank you for leading the north beach team. Gloves are in the blue crate now.", "volunteer"],
      [allVols[2], "training", "Did the tutoring induction on the 12th. Ready for one-to-one.", "internal"],
      [allVols[5], "note", "Prefers a text the day before rather than an email.", "internal"],
    ];
    for (const [i, [person, kind, body, vis]] of NOTES.entries()) {
      await q(`INSERT INTO volunteer_notes (id,org_id,person_id,kind,body,note_date,visibility,created_by,created_by_name)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'u_b72demo','Dana Reyes')`, [`vn_b72_p3_${i}`, ORG, person, kind, body, dAdd(TODAY, -10 - i), vis]);
    }
  }

  // ── PARITY-3 Part 4 · A MONTH OF SHIFTS, WITH ROLES ───────────────────
  // The two opportunities a coordinator runs every week, for the next four
  // weeks: the Saturday clean-up (Litter pickers 6, Team lead 1, on brand
  // emerald) and Tuesday tutoring (Tutors 4, brass). Some are short, the
  // first Saturday has a waiting list for team lead, one is a draft, and one
  // volunteer is on two shifts that overlap: the conflict the screen counts.
  {
    // This week's Saturday (today, when today is one), so the conflict and the
    // short food drive count in "this week" on most days the demo is opened.
    const SAT0 = (() => { let d = TODAY; for (let i = 0; i < 7; i++) { const w = new Date(Date.UTC(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10))).getUTCDay(); if (w === 6) break; d = dAdd(d, 1); } return d; })();
    const TUE0 = dAdd(SAT0, 3);
    let rr = 0;
    const mkSlot = async (id, opp, date, s, e, { name = null, color = null, venue = null, place = null, published = true, roles = [] } = {}) => {
      await q(`INSERT INTO volunteer_slots (id,org_id,opportunity_id,date,start_time,end_time,capacity,notes,name,color,venue,location_detail,published,created_by,created_by_name)
               VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8,$9,$10,$11,'u_b72demo','Dana Reyes')`,
        [id, ORG, opp, date, s, e, name, color, venue, place, published]);
      const out = {};
      for (const [i, r] of roles.entries()) {
        rr++;
        const rid = `vsr_b72_${rr}`;
        await q(`INSERT INTO volunteer_slot_roles (id,org_id,slot_id,name,needed,sort,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,'u_b72demo','Dana Reyes')`,
          [rid, ORG, id, r.name, r.needed, i]);
        out[r.name] = rid;
      }
      return out;
    };
    const onRole = async (slotId, roleId, personId, status = "confirmed", position = null) => {
      vsu++;
      await q(`INSERT INTO volunteer_signups (id,org_id,slot_id,person_id,status,position,source,role_id,created_by,created_by_name)
               VALUES ($1,$2,$3,$4,$5,$6,'public',$7,'system:volunteer-public','The volunteer, from the sign-up page')`,
        [`vsu_b72_${vsu}`, ORG, slotId, personId, status, position, roleId]);
    };
    // How full each week is: the first Saturday is full with a queue, the
    // second is two pickers short, the third has no team lead, the fourth is
    // a draft not yet published.
    const SAT_FILL = [{ pick: 6, lead: 1, queue: 2 }, { pick: 4, lead: 1 }, { pick: 6, lead: 0 }, { pick: 0, lead: 0, draft: true }];
    const TUE_FILL = [4, 3, 4, 2];
    for (let w = 0; w < 4; w++) {
      const sid = `vsl_b72_sat${w}`;
      const sat = await mkSlot(sid, "vo_b72_shore", dAdd(SAT0, 7 * w), "09:00", "12:00", {
        name: "Saturday clean-up", color: "#0d5c3a", venue: "Pier 4, Harborlight", place: "Meet at the boathouse steps",
        published: !SAT_FILL[w].draft, roles: [{ name: "Litter pickers", needed: 6 }, { name: "Team lead", needed: 1 }] });
      const pool = allVols.slice(2 + w * 3).concat(allVols.slice(0, 2 + w * 3));
      for (let i = 0; i < SAT_FILL[w].pick; i++) await onRole(sid, sat["Litter pickers"], pool[i]);
      if (SAT_FILL[w].lead) await onRole(sid, sat["Team lead"], pool[SAT_FILL[w].pick]);
      for (let i = 0; i < (SAT_FILL[w].queue || 0); i++) await onRole(sid, sat["Team lead"], pool[SAT_FILL[w].pick + 1 + i], "waitlisted", i + 1);
      const tid = `vsl_b72_tue${w}`;
      const tue = await mkSlot(tid, "vo_b72_tutor", dAdd(TUE0, 7 * w), "16:00", "17:30", {
        name: "Tuesday tutoring", color: "#c9a84c", venue: "The Annexe, 14 Mill Street", place: "Room 2",
        roles: [{ name: "Tutors", needed: 4 }] });
      const tpool = allVols.slice(20).concat(allVols.slice(0, 20));
      for (let i = 0; i < TUE_FILL[w]; i++) await onRole(tid, tue["Tutors"], tpool[i]);
    }
    // THE CONFLICT: a Saturday food-drive sort, 11 to 2, overlapping the
    // first clean-up, with one of that morning's litter pickers also on it.
    const sat0Picker = allVols.slice(2)[0];
    const fd = await mkSlot("vsl_b72_fooddrive", "vo_b72_shore", SAT0, "11:00", "14:00", {
      name: "Food drive sort", color: "#0f1a12", venue: "Harborlight Hall", place: "Loading dock",
      roles: [{ name: "Sorters", needed: 3 }] });
    await onRole("vsl_b72_fooddrive", fd["Sorters"], sat0Picker);
    await onRole("vsl_b72_fooddrive", fd["Sorters"], allVols[30]);
    console.log(`[seed] a month of shifts: 4 Saturdays, 4 Tuesdays and a food drive; one conflict (${sat0Picker}), a waiting list for team lead, a draft`);
  }

  // ── PARITY-3 Part 2 · THE RECRUITMENT PAGE AND SIX APPLICATIONS ────────
  // The public volunteer page, written the way a coordinator would, with two
  // photographs from the landing set (the potter's hands and the museum
  // students, both cleared in client/public/ASSETS.md) and a video; four
  // questions, one of them a waiver upload; and six people waiting for a
  // decision, one of whom already gives (approving them must not make a
  // second record). Plus the default Volunteers group, by rule.
  {
    const crypto = require("crypto"), fs = require("fs"), path = require("path");
    const photo = async name => {
      const buf = fs.readFileSync(path.join(__dirname, "..", "client", "public", "photos", name));
      const id = "pa_" + crypto.createHash("sha256").update(ORG + "|volpage|" + name).digest("hex").slice(0, 24);
      await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,storage,data,is_public) VALUES ($1,$2,'volpage','image/webp',$3,'db',$4,TRUE)
               ON CONFLICT (id) DO UPDATE SET is_public = TRUE`, [id, ORG, buf.length, buf.toString("base64")]);
      return `/portal-assets/${id}`;
    };
    const hands = await photo("potter-2x.webp"), students = await photo("museum-2x.webp");
    const body = `<h2>Why volunteer with us</h2><p>Harborlight runs on people who give a Saturday morning or a Tuesday afternoon. Our young people notice who turns up, and they remember.</p>`
      + `<img src="${students}" alt="Students on a museum trip">`
      + `<h2>What you could do</h2><ul><li><strong>Shoreline clean-ups</strong>, three hours on Pier 4 with gloves and a flask.</li>`
      + `<li><strong>After-school tutoring</strong>, an hour a week with the same young person.</li><li><strong>Gala night crew</strong>, once a year, and the best party in town.</li></ul>`
      + `<img src="${hands}" alt="Hands shaping a clay pot">`
      + `<h3>Hear it from a volunteer</h3><iframe src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ"></iframe>`
      + `<p>No experience needed. We train everyone, and tutoring volunteers have a background check, which we arrange and pay for.</p>`;
    const QS = [
      { id: "why", label: "What draws you to Harborlight?", type: "text", required: true, options: [] },
      { id: "before", label: "Have you volunteered with young people before?", type: "yesno", required: true, options: [] },
      { id: "interest", label: "Which would you most like to do?", type: "choice", required: false, options: ["Shoreline clean-ups", "After-school tutoring", "Gala night crew"] },
      { id: "waiver", label: "Your signed waiver, if you have it", type: "file", required: false, options: [] },
    ];
    await q(`INSERT INTO volunteer_recruitment (org_id,title,body_html,questions,published,updated_by,updated_by_name)
             VALUES ($1,'Volunteer at Harborlight',$2,$3::jsonb,TRUE,'u_b72demo','Dana Reyes')`, [ORG, body, JSON.stringify(QS)]);
    const [giver] = await q(`SELECT id, name, email FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND total_giving > 0 AND email IS NOT NULL AND email <> ''
                               AND NOT (person_types @> '["volunteer"]'::jsonb) ORDER BY total_giving DESC OFFSET 40 LIMIT 1`, [ORG]);
    const APPS = [
      ["Rosalind Ashbury", "Saturdays", "Shoreline clean-ups", true, "I walk my dog on Pier 4 every morning and I am tired of the litter."],
      ["Theo Marchetti", "Weekday afternoons", "After-school tutoring", true, "I teach maths part time and would like to give an hour a week."],
      ["Imogen Calloway", "Weekday evenings", "Gala night crew", false, "My daughter came to your summer camp and loved it."],
      ["Benedict Okafor", "Saturdays", "Shoreline clean-ups", false, "Our company gives us two volunteering days a year."],
      ["Wilhelmina Strand", "Weekday afternoons", "After-school tutoring", true, "Retired teacher. Happy to help with reading."],
    ];
    let na = 0;
    const app = async (name, email, avail, interest, before, why, daysAgo) => {
      na++;
      const answers = [
        { questionId: "why", question: QS[0].label, type: "text", answer: why, answerText: why },
        { questionId: "before", question: QS[1].label, type: "yesno", answer: before, answerText: before ? "Yes" : "No" },
        { questionId: "interest", question: QS[2].label, type: "choice", answer: interest, answerText: interest },
        { questionId: "waiver", question: QS[3].label, type: "file", answer: null, answerText: "" },
      ];
      await q(`INSERT INTO volunteer_applications (id,org_id,name,email,phone,answers,availability,submitted_at,created_by,created_by_name)
               VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,NOW() - ($8 || ' days')::interval,'system:volunteer-apply','The volunteer, from the application form')`,
        [`vap_b72_${na}`, ORG, name, email, `555-02${String(10 + na)}`, JSON.stringify(answers), JSON.stringify([avail]), String(daysAgo)]);
    };
    for (const [i, [name, avail, interest, before, why]] of APPS.entries()) {
      if (!takeName(name)) throw new Error(`[seed] the applicant "${name}" has the same name as somebody already in the file.`);
      const [first, last] = name.toLowerCase().split(" ");
      await app(name, `${first}.${last}@example.org`, avail, interest, before, why, i + 1);
    }
    if (giver) await app(giver.name, giver.email, "Sundays", "Gala night crew", false, "I have given for years and would like to help on the night too.", 2);
    await q(`INSERT INTO audiences (id, org_id, name, description, segment, kind, rules, created_by, created_by_name)
             VALUES ('grp_b72_volunteers',$1,'Volunteers','Everyone with a logged volunteer hour or an approved application. Kept by Steward.','{"mode":"group"}'::jsonb,'dynamic','{"volunteer":"1"}'::jsonb,'u_b72demo','Dana Reyes')
             ON CONFLICT DO NOTHING`, [ORG]);
    console.log(`[seed] recruitment page with two photos and a video; ${na} pending applications (${giver ? giver.name + " already gives" : "none already on file"}); the Volunteers group`);
  }

  const [volCount] = await q(
    `SELECT COUNT(*)::int c FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND person_types @> '["volunteer"]'::jsonb`, [ORG]);
  const [volHours] = await q(
    `SELECT COALESCE(SUM(hours),0)::float h FROM volunteer_shifts WHERE org_id=$1`, [ORG]);
  console.log(`[assert] volunteers ${volCount.c} · ${Math.round(volHours.h)} hours on file · ${givers.length} of them also give`);
  if (volCount.c < 40) {
    console.error(`\nREFUSED: the volunteer programme needs at least 40 volunteers and made ${volCount.c}.`);
    process.exit(1);
  }

  // ── BUILD-103 · THE 5K AS A PEER-TO-PEER CAMPAIGN ──────────────────────
  // A giving page with the switch on, two teams, five fundraisers and a dozen
  // gifts through their own pages — including one the donor gave anonymously
  // to the fundraiser, which is the default and therefore the common case.
  //
  // Every gift here carries BOTH the fundraiser and the parent page, which is
  // what makes rollup free: the page's own SUM already includes every one of
  // them, and the fundraiser's is the identical pattern one level down.
  const P2P_PAGE = "gp_b72_run";
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,goal_amount,story,status,campaign_id,p2p_enabled)
           VALUES ($1,$2,'harbor-run','Harbor Run',25000,$3,'active','camp_b72_5k',true)`,
    [P2P_PAGE, ORG,
     "Five kilometres along the shore, and every runner raising for the scholarship fund. Start your own page and ask the people who would want to know."]);

  const P2P_TEAMS = [
    ["pt_b72_meridian", "Meridian Bank", "meridian-bank", 6000],
    ["pt_b72_harbour", "The Shore Striders", "the-shore-striders", 4000],
  ];
  for (const [id, name, slug, goal] of P2P_TEAMS)
    await q(`INSERT INTO p2p_teams (id,org_id,giving_page_id,name,slug,goal_amount,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'system:p2p-signup','The fundraiser, from the sign-up page')`,
      [id, ORG, P2P_PAGE, name, slug, goal]);

  // ── FIX-7 Part 1 · THE STORY IS NEVER DRAWN INTO THE 5K ──────────────────
  // A peer-to-peer page hands out two things: a soft credit to the fundraiser
  // and a REAL gift, dated this week, to whoever gave through it. The second
  // one is what matters here. This block used to choose its people with
  // `ORDER BY created_at LIMIT 12` — and every donor in this file is written
  // in a single statement, so created_at is identical on all of them and
  // Postgres returned whatever heap order it felt like. On this machine that
  // was a scattered dozen. On production on 28 Sep it was FIVE OF THE ELEVEN,
  // each of whom got a gift dated a few days ago and stopped drifting; the
  // shape assertion refused the seed, which is exactly what it is for.
  //
  // Two rules now, and an assertion under them:
  //   1. nobody the story names — the eleven, the lapsed major, the two
  //      household members, the merge fixture, the cents donor, the pledges,
  //      the recurring donor, the organisations, the Thread's six;
  //   2. only somebody who has given inside the last sixty days ANYWAY, and
  //      is on no subscription and no open pledge, so one more recent gift
  //      cannot change a single thing a cadence surface says about them.
  // ORDER BY id, so the same people are drawn on every machine, every run.
  const storyIds = [...new Set([...driftedIds, lapsedMajor, twoAddr, twoAddrB, hh1, hh2, centsDonor,
                                pledgeDonorA, pledgeDonorB, recurDonor,
                                ...orgDonors.map(([id]) => id), ...threadDonors].filter(Boolean))];
  const NO_STORY_SQL = `
    SELECT d.id, d.name, d.email FROM donors d
     WHERE d.org_id=$1 AND d.deleted_at IS NULL AND d.kind IS NULL
       AND d.id <> ALL($2::text[])
       AND d.total_giving > 0 AND d.email IS NOT NULL AND d.email <> ''
       AND d.last_gift_date::date >= $3::date - INTERVAL '60 days'
       AND NOT EXISTS (SELECT 1 FROM recurring_subscriptions rs WHERE rs.org_id=d.org_id AND rs.donor_id=d.id)
       AND NOT EXISTS (SELECT 1 FROM pledges p WHERE p.org_id=d.org_id AND p.donor_id=d.id)
     ORDER BY d.id`;
  const noStory = await q(NO_STORY_SQL, [ORG, storyIds, TODAY]);

  // Five fundraisers. THREE are people who already exist in the CRM, matched
  // by exact email, so their soft credits land on the record the office
  // already knows; TWO are strangers, who become people typed VOLUNTEER —
  // never donors, because they have not given a penny.
  const p2pPeople = noStory.slice(0, 3);
  const P2P_STRANGERS = [
    ["Rosalind Quillfeather", "rosalind.quillfeather@example.org"],
    ["Emeka Beaumaris", "emeka.beaumaris@example.org"],
  ];
  const fundraisers = [];
  const tokenHash = t => require("crypto").createHash("sha256").update(t).digest("hex");
  const mkFundraiser = async (i, name, email, personId, teamId, goal) => {
    const id = `pf_b72_${i}`;
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    await q(`INSERT INTO peer_fundraisers (id,org_id,giving_page_id,name,email,slug,personal_goal_amount,story,image_url,status,edit_token,edit_token_hash,team_id,person_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'','active',NULL,$9,$10,$11)`,
      [id, ORG, P2P_PAGE, name, email, slug, goal,
       "I have watched what this programme does for the kids on this shore. Five kilometres is the least I can do.",
       tokenHash(`demo-p2p-${i}-${Date.now()}`), teamId, personId]);
    fundraisers.push({ id, name, email, personId, teamId });
    return id;
  };
  for (const [i, p] of p2pPeople.entries())
    await mkFundraiser(i, p.name, p.email, p.id, P2P_TEAMS[i % 2][0], [1500, 1000, 750][i]);
  for (const [j, [name, email]] of P2P_STRANGERS.entries()) {
    const personId = `d_b72_p2p${j}`;
    await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'prospect','active','[]','["volunteer"]'::jsonb,'system:p2p-signup','The fundraiser, from the sign-up page')`,
      [personId, ORG, name, email]);
    await mkFundraiser(3 + j, name, email, personId, j === 0 ? P2P_TEAMS[0][0] : null, [500, 300][j]);
  }

  // A dozen gifts through their pages, from people who already give. One is
  // anonymous to the fundraiser (the default), the rest chose to be seen.
  const fundraiserPersonIds = new Set(fundraisers.map(f => f.personId).filter(Boolean));
  const p2pDonors = noStory.filter(d => !fundraiserPersonIds.has(d.id)).slice(0, 12);
  const P2P_AMOUNTS = [250, 100, 50, 500, 75, 100, 25, 150, 200, 50, 100, 300];
  let p2pRaised = 0, p2pSoft = 0;
  for (const [i, dn] of p2pDonors.entries()) {
    // The LAST fundraiser deliberately receives nothing: "who has not raised
    // anything yet" is the list an org actually does something about, and a
    // demo where everybody has raised something never shows it.
    const f = fundraisers[i % (fundraisers.length - 1)];
    const amount = P2P_AMOUNTS[i];
    const giftId = `g_b72_p2p${i}`;
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,giving_page_id,peer_fundraiser_id,campaign_id,show_name_to_fundraiser,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'cash','Card',$6,$7,'camp_b72_5k',$8,'system:stripe','Stripe (online gift)')`,
      [giftId, ORG, dn.id, amount, dAdd(TODAY, -(i + 2)), P2P_PAGE, f.id, i !== 3]);
    p2pRaised += amount;
    // The soft credit: the fundraiser brought it in. Hard credit stays on the
    // donor, and nothing that totals money reads this table unless asked.
    if (f.personId && f.personId !== dn.id) {
      await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,pct,role,created_by,created_by_name)
               VALUES ($1,$2,$3,$4,$5,100,'peer_fundraiser','system:stripe','Their own fundraiser page')
               ON CONFLICT (gift_id, donor_id) DO NOTHING`,
        [`gsc_b72_p2p${i}`, ORG, giftId, f.personId, amount]);
      p2pSoft += amount;
    }
  }
  // FIX-7 Part 1 — the rule, asserted rather than trusted to the query above.
  // Refuse the seed here rather than let the shape assertion 200 lines below
  // explain it as "one of the eleven is NOT drifting", which is a true
  // sentence about the wrong file.
  const p2pTouched = [...p2pDonors.map(d => d.id), ...fundraisers.map(f => f.personId)].filter(Boolean);
  const storySet = new Set(storyIds);
  const trespass = p2pTouched.filter(id => storySet.has(id));
  if (trespass.length) {
    console.error(`\nREFUSED: the 5K drew ${trespass.length} of the story's own people (${trespass.join(", ")}).`);
    console.error("  A peer-to-peer gift is dated this week. Nobody the demo's story depends on may receive one.");
    process.exit(1);
  }
  if (p2pDonors.length < 12 || p2pPeople.length < 3) {
    console.error(`\nREFUSED: only ${p2pDonors.length} givers and ${p2pPeople.length} fundraisers with no giving story were available (need 12 and 3).`);
    process.exit(1);
  }
  console.log(`[assert] peer-to-peer: ${P2P_TEAMS.length} teams, ${fundraisers.length} fundraisers (2 of them new people typed volunteer), $${p2pRaised.toLocaleString()} raised through their pages, $${p2pSoft.toLocaleString()} of it soft-credited, one gift anonymous to its fundraiser · none of the ${storyIds.length} story people was drawn into it`);
  await require("./seed/parity2-p2p.js")({ q, ORG, TODAY, dAdd, storyIds, candidates: noStory.filter(d => !p2pTouched.includes(d.id)) });   // PARITY-2 Part 2: the Spring Paddle

  // ── MEMBERS-2 · THE MEMBER SIDE ────────────────────────────────────────
  // Three levels an org this size would really sell, and four people whose
  // "Your page" each shows a DIFFERENT set of sections — which is the whole
  // point of the page, and the only way to see that the empty ones really do
  // not render.
  const MEMBERSHIP_LEVELS = [
    ["mbl_b72_friend", "Friend", 50, 0, 0,
      ["The newsletter, four times a year", "Your name in the annual report"]],
    ["mbl_b72_family", "Family", 120, 25, 1,
      ["Everything a Friend has", "Four guest passes to the harbor center", "Early notice of every event"]],
    ["mbl_b72_circle", "Harbor Circle", 500, 60, 2,
      ["Everything a Family has", "Two seats at the annual dinner", "A morning on the water with the programme staff"]],
  ];
  for (const [id, name, price, fmv, pos, benefits] of MEMBERSHIP_LEVELS)
    await q(`INSERT INTO membership_levels (id,org_id,name,price,fmv,term,scope,benefits,position,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'12_months',$6,$7::jsonb,$8,'u_b72demo','Dana Reyes')`,
      [id, ORG, name, price, fmv, name === "Family" ? "household" : "individual", JSON.stringify(benefits), pos]);

  // Four people, chosen off rows that already exist rather than invented, so
  // each one is the SAME record the rest of the demo already knows.
  const [memberA] = await q(
    `SELECT id, name FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND total_giving > 0
       AND email IS NOT NULL AND email <> '' AND id <> ALL($2::text[])
     ORDER BY total_giving DESC OFFSET 3 LIMIT 1`, [ORG, givers]);
  const [memberB] = await q(
    `SELECT id, name FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND total_giving > 0
       AND email IS NOT NULL AND email <> '' AND id <> ALL($2::text[]) AND id <> $3
     ORDER BY total_giving DESC OFFSET 24 LIMIT 1`, [ORG, givers, memberA.id]);
  const [monthlyMember] = await q(
    `SELECT d.id, d.name FROM donors d JOIN recurring_subscriptions r ON r.donor_id=d.id AND r.org_id=d.org_id
      WHERE d.org_id=$1 AND d.deleted_at IS NULL AND r.status='active' AND d.email IS NOT NULL AND d.email <> ''
      ORDER BY r.amount DESC LIMIT 1`, [ORG]);
  const volMemberId = givers[0];
  const [volMember] = await q(`SELECT id, name FROM donors WHERE id=$1`, [volMemberId]);

  const putMember = async (personId, levelId, startsOn, expiresOn, status, source) =>
    q(`INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status,payment_method,source,created_by,created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'check',$9,'u_b72demo','Dana Reyes')`,
      [`mb_b72_${personId.slice(-6)}_${status}`, ORG, personId, levelId, startsOn, startsOn, expiresOn, status, source]);

  // A. A Family membership that renews next month — the one the renewal
  //    thread is about, and the one the member's own page has to state in a
  //    sentence rather than a row of fields.
  await putMember(memberA.id, "mbl_b72_family", dAdd(TODAY, -330), dAdd(TODAY, 35), "active", "staff");
  // B. Lapsed: it ran out five months ago and they hold none now.
  await putMember(memberB.id, "mbl_b72_family", dAdd(TODAY, -515), dAdd(TODAY, -150), "lapsed", "staff");
  await q(`UPDATE memberships SET status_changed_on=$2 WHERE org_id=$1 AND donor_id=$3`,
          [ORG, dAdd(TODAY, -120), memberB.id]);
  // C. A volunteer who is also a member: the crossover the page exists for.
  await putMember(volMemberId, "mbl_b72_friend", dAdd(TODAY, -200), dAdd(TODAY, 165), "active", "staff");
  // D. The monthly donor has no membership at all, on purpose: their page is
  //    ONE section, and that is how you see that four empty ones do not draw.

  // One of them has opened their page already, so the Members screen has both
  // answers to show: sent-and-opened, and sent-and-not.
  await q(`UPDATE donors SET your_page_sent_at = NOW() - INTERVAL '6 days',
                             your_page_opened_at = NOW() - INTERVAL '6 days' WHERE id=$1 AND org_id=$2`,
          [memberA.id, ORG]);
  await q(`UPDATE donors SET your_page_sent_at = NOW() - INTERVAL '2 days' WHERE id=$1 AND org_id=$2`,
          [memberB.id, ORG]);
  const [mbCount] = await q(`SELECT COUNT(*)::int c FROM memberships WHERE org_id=$1`, [ORG]);
  console.log(`[assert] memberships ${mbCount.c} on ${MEMBERSHIP_LEVELS.length} levels · ${memberA.name} renews in 35 days · ${memberB.name} lapsed · ${volMember.name} volunteers and is a member · ${monthlyMember ? monthlyMember.name + " gives monthly" : "no monthly giver found"}`);
  await require("./seed/parity2-memberships").seedParity2Memberships({ q, ORG }); // PARITY-2 Part 1

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
  // FIX-6 follow-up 8 — the demo's three drafts have to read like three
  // different people, because they are. Each gift carries its own history
  // (how many came before it, how long since the last, what it came to), and
  // the template chooses its sentence from those facts. Nothing is invented:
  // the numbers below are read back out of the file that was just written.
  // THREE DIFFERENT STORIES, because a real Monday queue is three different
  // people: somebody new, somebody who gives regularly, and somebody who had
  // gone quiet and came back. Taking "the three most recent online gifts"
  // gave three FIRST-TIME givers, so the drafts were identical for a true
  // reason and the demo still looked like a mail merge.
  const queueShape = `
    SELECT g.id, g.donor_id, g.amount::float amount, g.date, g.campaign, d.name,
           (SELECT COUNT(*)::int FROM gifts x
             WHERE x.org_id=g.org_id AND x.donor_id=g.donor_id AND x.id <> g.id AND x.amount > 0) AS before,
           (SELECT MAX(x.date) FROM gifts x
             WHERE x.org_id=g.org_id AND x.donor_id=g.donor_id AND x.id <> g.id AND x.date < g.date) AS last_date
      FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
     WHERE g.org_id=$1 AND g.stripe_payment_id IS NOT NULL AND g.recurring_subscription_id IS NULL
       AND g.quid_pro_quo_value IS NULL AND d.kind IS NULL AND g.date <= $2`;
  const pick1 = async (having, order) => (await q(
    `${queueShape} AND ${having} ORDER BY ${order} LIMIT 1`, [ORG, TODAY]))[0] || null;
  const recentOnline = [];
  const takeIf = r => { if (r && !recentOnline.some(x => x.id === r.id)) recentOnline.push(r); };
  // somebody new
  takeIf(await pick1(`(SELECT COUNT(*) FROM gifts x WHERE x.org_id=g.org_id AND x.donor_id=g.donor_id AND x.id <> g.id AND x.amount > 0) = 0`, "g.date DESC, g.id DESC"));
  // somebody who gives regularly
  // A REGULAR giver, and one who has NOT been away: the template puts a long
  // gap above loyalty (a year of silence is the more notable fact), so a
  // regular giver who also happens to be a returner reads as a returner and
  // the queue shows the same sentence twice.
  takeIf(await pick1(
    `(SELECT COUNT(*) FROM gifts x WHERE x.org_id=g.org_id AND x.donor_id=g.donor_id AND x.id <> g.id AND x.amount > 0) >= 5
     AND (SELECT MAX(x.date::date) FROM gifts x WHERE x.org_id=g.org_id AND x.donor_id=g.donor_id AND x.id <> g.id AND x.date < g.date)
         >= (g.date::date - INTERVAL '12 months')`, "g.date DESC, g.id DESC"));
  // somebody who had gone quiet, and came back
  takeIf(await pick1(`(SELECT MAX(x.date::date) FROM gifts x WHERE x.org_id=g.org_id AND x.donor_id=g.donor_id AND x.id <> g.id AND x.date < g.date) < (g.date::date - INTERVAL '12 months')`, "g.date DESC, g.id DESC"));
  // and whatever else is newest, if any of the three shapes was not on file
  for (const r of await q(`${queueShape} ORDER BY g.date DESC, g.id DESC LIMIT 6`, [ORG, TODAY])) {
    if (recentOnline.length >= 3) break;
    takeIf(r);
  }
  for (const [k, g] of recentOnline.entries()) {
    const months = g.last_date
      ? Math.max(0, Math.round((new Date(g.date) - new Date(g.last_date)) / (1000 * 60 * 60 * 24 * 30.44)))
      : null;
    const t = draftMod.thankYouDraft({ donorName: g.name, giftCents: Math.round(g.amount * 100), fundName: null,
                                       orgName: "Harborlight Youth Collective", voice: { ready: false },
                                       giftCountBefore: Number(g.before), isFirstGift: Number(g.before) === 0,
                                       isRecurring: false, monthsSinceLastGift: months,
                                       campaignName: g.campaign || null });
    await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body,voice) VALUES ($1,$2,$3,$4,$5,$6)`,
            [`ty_b72_${k + 1}`, ORG, g.donor_id, g.id, t.body, t.voice]);
  }

  // ── INT-1 · THE CONNECTIONS, IN EVERY STATE THE SCREEN CAN SHOW ────────
  // A demo where every connection is green proves only that green renders.
  // Harborlight shows Stripe healthy, PayPal healthy, Givebutter QUIET (the
  // state that costs an organisation real money and the one nothing used to
  // say), and the statement imports it already has. No credentials are
  // written: `credentials_sealed` stays NULL, so nothing here can call a
  // provider, and a check pressed during a demo fails honestly rather than
  // reaching somebody's real PayPal.
  //
  // The gifts are REAL gifts already in this file, re-pointed at a source, so
  // every figure on the card foots to rows a person can open. Nothing new is
  // created and no total moves.
  const DEMO_SOURCES = [
    ["gsrc_b72_stripe", "stripe", "Stripe", 0, 40],      // healthy: gifts up to yesterday
    ["gsrc_b72_paypal", "paypal", "PayPal", 0, 26],      // healthy
    ["gsrc_b72_gb", "givebutter", "Givebutter", 64, 30], // quiet: nothing for 64 days
  ];
  for (const [id, provider, label, quietDays, count] of DEMO_SOURCES) {
    await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status,last_synced_at,last_tried_at,
                                         backfilled_at,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'active',NOW(),NOW(),NOW(),'system:seed-demo','The demonstration file')`,
      [id, ORG, provider, label]);
    // Its gifts: real online rows from this file, newest first, shifted back by
    // the quiet gap so the card's own rhythm reads the way the state needs.
    // Every source takes an INTERLEAVED slice of the online gifts rather than
    // the newest ones, so the first source through this loop does not eat every
    // recent row and leave the second looking quiet by accident. The quiet one
    // is quiet because its window ENDS 64 days ago, which is a property of the
    // fixture and not of the order this loop happens to run in.
    const rows = await q(
      `SELECT id FROM (
         SELECT id, row_number() OVER (ORDER BY date DESC, id) AS rn
           FROM gifts WHERE org_id=$1 AND stripe_payment_id IS NOT NULL AND giving_source_id IS NULL
            AND date <= $2) x
        WHERE rn % 3 = $4 ORDER BY rn LIMIT $3`,
      [ORG, dAdd(TODAY, -quietDays), count, DEMO_SOURCES.findIndex(d => d[0] === id)]);
    if (rows.length)
      await q(`UPDATE gifts SET giving_source_id=$1 WHERE id = ANY($2::text[])`, [id, rows.map(r => r.id)]);
  }
  {
    const st = await q(
      `SELECT s.provider, COUNT(g.id)::int AS n, MAX(g.date)::text AS last
         FROM giving_sources s LEFT JOIN gifts g ON g.giving_source_id = s.id
        WHERE s.org_id=$1 GROUP BY s.provider ORDER BY s.provider`, [ORG]);
    console.log(`[assert] connections: ${st.map(r => `${r.provider} ${r.n} gifts, last ${r.last || "never"}`).join(" · ")}`);
  }

  // ── INT-POS · THE REGISTER, ON GALA NIGHT AND AT THE 5K ────────────────
  // Square connected and healthy, with the sales an org this size really
  // takes: raffle tickets, an auction win and the bar at the gala; shirts and
  // a donate button at the 5K. Three buyers who have never given — the list
  // this build exists for — and one attendee who came on a rhythm and stopped.
  // One item ("Harbor tote") is deliberately LEFT UNMAPPED, so the mapping
  // screen has something to do and the unmapped counter is not zero.
  //
  // None of it touches the eleven drifted donors: the buyers are their own
  // people, and no gift here lands on anybody the story depends on.
  console.log("[seed] the register…");
  const POS_SRC = "gsrc_b72_square";
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status,last_synced_at,last_tried_at,
                                       backfilled_at,created_by,created_by_name)
           VALUES ($1,$2,'square','Square','active',NOW(),NOW(),NOW(),'system:seed-demo','The demonstration file')`,
    [POS_SRC, ORG]);
  const POS_MAP = [
    ["Raffle ticket", "event", gala.id],
    ["Auction win", "event", gala.id],
    ["Bar", "event", gala.id],
    ["Harbor Run shirt", "event", run5k.id],
    ["Donate $25", "donation", null],
    ["Cafe", "other", null],
    // "Harbor tote" is left out on purpose.
  ];
  for (const [name, cls, evId] of POS_MAP)
    await q(`INSERT INTO pos_item_mappings (id,org_id,source_id,item_key,item_name,item_class,event_id,created_by,created_by_name)
             VALUES ($1,$2,NULL,$3,$4,$5,$6,'system:seed-demo','The demonstration file')`,
      [`pim_b72_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, ORG,
       name.toLowerCase().replace(/\s+/g, " "), name, cls, evId]);

  // Three people who buy and never give, and one who came every month and
  // stopped. Their own records, typed guest: they have not given a penny.
  const POS_PEOPLE = [
    ["d_b72_pos1", "Ottoline Braithwaite", "ottoline.braithwaite@example.demo"],
    ["d_b72_pos2", "Caspian Threlfall", "caspian.threlfall@example.demo"],
    ["d_b72_pos3", "Marisol Quintrell", "marisol.quintrell@example.demo"],
    ["d_b72_pos4", "Ambrose Wyndecott", "ambrose.wyndecott@example.demo"],
  ];
  for (const [id, name, email] of POS_PEOPLE)
    await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'prospect','active','[]','["guest"]'::jsonb,'system:seed-demo','The demonstration file')`,
      [id, ORG, name, email]);

  // ── INT-3 · THE EMAIL TOOL SHE ALREADY PAYS FOR ───────────────────────
  // Harborlight sends its newsletter from Mailchimp and is not going to stop,
  // which is the whole premise: Steward reads what happened and never sends.
  // Constant Contact is left NOT CONNECTED so the screen shows both states.
  //
  // NO CREDENTIALS. `credentials_sealed` stays NULL, exactly as the giving
  // sources above, so nothing here can reach a real Mailchimp account and the
  // assertion at the end of this file (which refuses a demo holding any
  // provider credentials) keeps covering it.
  //
  // None of it touches the eleven drifted donors: the people with campaign
  // activity below are chosen from outside that story, and the one gift shown
  // beside a campaign is a gift this file already wrote.
  // ── INT-4 · DANA'S OWN INBOX ──────────────────────────────────────────
  // One staff member connected, five conversations logged, and one Thread
  // closed because she wrote to the person it asked her to write to. NO
  // TOKENS: `credentials_sealed` stays NULL exactly as every other connection
  // in this file, so nothing here can reach a real mailbox and the assertion
  // at the end covers it.
  //
  // The five people are chosen from outside the eleven drifted donors, whose
  // silence is the demo's argument: logging a warm exchange with one of them
  // would undercut the thing the screen is trying to show.
  console.log("[seed] the inbox…");
  const { conversationNote: mbNote } = await import("../shared/mailboxLog.js");
  await q(`INSERT INTO mailbox_connections
             (id,org_id,user_id,provider,address,status,last_synced_at,last_tried_at,last_logged_count,
              calendar_granted,calendar_synced_at,created_by,created_by_name)
           VALUES ('mbx_b72_dana',$1,'u_b72demo','google','dana@harborlight.demo','active',
                   NOW(), NOW(), 5, true, NOW(), 'system:seed-demo','The demonstration file')`, [ORG]);

  const MB_CONVOS = [
    ["d_b72_pos1", 12, "outbound", "The autumn tour",            "Thought you might like to see the new workshop before the open evening."],
    ["d_b72_pos1",  9, "inbound",  "Re: The autumn tour",        "Yes please, Thursday suits me. Will there be parking?"],
    ["d_b72_pos3", 21, "outbound", "Your gift and what it built","A short note about where this year's scholarship money went."],
    ["d_b72_pos2", 34, "inbound",  "A question about the gala",  "Could I bring a colleague to the table I booked?"],
    ["d_b72_pos3",  4, "inbound",  "Re: Your gift and what it built", "This is lovely to read. Thank you for taking the time."],
  ];
  for (const [donorId, daysAgo, direction, subject, body] of MB_CONVOS) {
    const [d] = await q(`SELECT id FROM donors WHERE id=$1 AND org_id=$2`, [donorId, ORG]);
    if (!d) continue;
    const note = mbNote({ direction, subject, attachmentCount: 0 }, { staffName: "Dana Reyes" });
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_at,created_by,logged_by_name,metadata)
             VALUES ($1,$2,$3,'email',$4,(NOW() - ($5 || ' days')::interval)::date::text,
                     NOW() - ($5 || ' days')::interval,'system:mailbox/google/u_b72demo','Dana Reyes',$6::jsonb)`,
      [`int_b72_mbx_${donorId.slice(-4)}_${daysAgo}`, ORG, donorId, `${note}\n\n${body}`, String(daysAgo),
       JSON.stringify({ message_id: `demo_${donorId}_${daysAgo}`, provider: "google", direction,
                        subject, attachments: 0, logged_by: "u_b72demo" })]);
  }

  // ONE THREAD CLOSED BY AN EMAIL. It closes as an OUTCOME and names the
  // conversation that closed it, which is what `threads_close_honest` requires
  // and what makes the closure checkable rather than asserted.
  {
    const [closer] = await q(
      `SELECT id, donor_id, date FROM interactions
        WHERE org_id=$1 AND created_by='system:mailbox/google/u_b72demo' AND donor_id='d_b72_pos1'
        ORDER BY date DESC LIMIT 1`, [ORG]);
    if (closer) {
      await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,
                                    owner_id,owner_name,created_by,created_by_name,
                                    closed_at,close_kind,closing_interaction_id)
               VALUES ($1,$2,$3,'follow_up','Call or write to Ottoline',
                       (NOW() - interval '14 days')::date::text,(NOW() - interval '18 days')::date::text,
                       'u_b72demo','Dana Reyes','system:seed-demo','The demonstration file',
                       NOW() - interval '12 days','outcome',$4)`,
        [`th_b72_mbx`, ORG, closer.donor_id, closer.id]).catch(() => {});
    }
  }

  // ── INT-BUILD-1 Part 7 · MARGARET'S MEETINGS, EMAILS AND ASK ───────────
  // From Dana's calendar and inbox, with no tokens (mbx_b72_dana above holds
  // none). Coffee tomorrow at ten, the lunch twenty days back with its note
  // and next step, the scholarship thread, the open ask for Youth Arts Access.
  console.log("[seed] Margaret Chen's meetings and emails…");
  {
    const at = (offsetDays, hhmm) => orgTime.localToInstant(`${orgTime.addDays(TODAY, offsetDays)}T${hhmm}`, TZ).toISOString();
    const cal = (id, offset, start, mins, title, location, extra = {}) => {
      const s0 = at(offset, start);
      return q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,
                                             note,next_step,logged_at,logged_by,interaction_id,created_by,created_by_name)
                VALUES ($1,$2,'u_b72demo','google',$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'system:calendar/google/u_b72demo','Calendar sync')`,
        [id, ORG, title, s0, new Date(Date.parse(s0) + mins * 60000).toISOString(), location, [margaretId],
         extra.note || null, extra.next || null, extra.note ? s0 : null, extra.note ? "u_b72demo" : null, extra.interactionId || null]);
    };
    await cal("cal_b72_mc_coffee", 1, "10:00", 60, "Coffee at Magee's on Main", "Magee's on Main");
    await cal("cal_b72_mc_openhouse", 17, "17:30", 90, "Studio open house", "Harborlight studio");
    // Earlier meetings this past year, for the rhythm strip.
    const PAST = [[-52, "Tea at the studio", "Harborlight studio"], [-112, "Coffee at Magee's", "Magee's on Main"],
                  [-172, "Gala walkthrough", "The Boathouse"], [-233, "Lunch at Windy Corner", "Windy Corner"],
                  [-300, "Coffee at Magee's", "Magee's on Main"]];
    for (const [i, [off, title, place]] of PAST.entries()) await cal(`cal_b72_mc_past${i + 1}`, off, "12:30", 60, title, place);
    // Today and yesterday, so Home always has a brief and a "how did it go":
    // a call this afternoon, and a coffee yesterday with nothing written yet.
    for (const [id, donorId, off, hhmm, title] of [
      ["cal_b72_today_call", "d_b72_pos1", 0, "14:00", "Call"],
      ["cal_b72_yday_coffee", "d_b72_pos3", -1, "16:00", "Coffee"]]) {
      const [p] = await q(`SELECT id, name FROM donors WHERE id=$1 AND org_id=$2`, [donorId, ORG]);
      if (!p) continue;
      const s0 = at(off, hhmm);
      await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,created_by,created_by_name)
               VALUES ($1,$2,'u_b72demo','google',$1,$3,$4,$5,$6,$7,'system:calendar/google/u_b72demo','Calendar sync')`,
        [id, ORG, `${title} with ${p.name}`, s0, new Date(Date.parse(s0) + 45 * 60000).toISOString(),
         title === "Coffee" ? "Magee's on Main" : null, [p.id]]);
    }
    // The lunch, logged afterwards: a meeting interaction, and the event points at it.
    const lunchDate = orgTime.addDays(TODAY, -20);
    const lunchNote = "Loved the gala photos. Lily starts studio classes in January. Not ready to talk about the $25K until after the fall.";
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_at,created_by,logged_by_name,metadata)
             VALUES ('int_b72_mc_lunch',$1,$2,'meeting',$3,$4,NOW() - interval '20 days','u_b72demo','Dana Reyes',$5::jsonb)`,
      [ORG, margaretId, `Lunch at Windy Corner\n\n${lunchNote}`, lunchDate,
       JSON.stringify({ calendar_event_id: "cal_b72_mc_lunch", provider: "google", location: "Windy Corner", minutes: 70, next_step: "Send the scholarship report" })]);
    await cal("cal_b72_mc_lunch", -20, "12:30", 70, "Lunch at Windy Corner", "Windy Corner",
              { note: lunchNote, next: "Send the scholarship report", interactionId: "int_b72_mc_lunch" });

    // The open ask, raised in June-ish (~110 days back).
    await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status,officer_id,officer_name,created_at,proposal_stage,fund_id,notes)
             VALUES ('opp_b72_mc_yaa',$1,$2,'Youth Arts Access',25000,'open','u_b72demo','Dana Reyes',NOW() - interval '110 days','asked','fund_b72demo_yaa',
                     'She said "after the fall."')`, [ORG, margaretId]);

    // The scholarship thread (four messages, the last yesterday, one attachment)
    // and the rest of the year's mail with her, so the year's count is real.
    const { conversationNote: mn } = await import("../shared/mailboxLog.js");
    const mail = async (key, daysAgo, direction, subject, body, attachments = 0) => {
      const note = mn({ direction, subject, attachmentCount: attachments }, { staffName: "Dana Reyes" });
      await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_at,created_by,logged_by_name,metadata)
               VALUES ($1,$2,$3,'email',$4,(NOW() - ($5 || ' days')::interval)::date::text, NOW() - ($5 || ' days')::interval,
                       'system:mailbox/google/u_b72demo','Dana Reyes',$6::jsonb)`,
        [`int_b72_mc_${key}`, ORG, margaretId, `${note}\n\n${body}`, String(daysAgo),
         JSON.stringify({ message_id: `demo_mc_${key}`, provider: "google", direction, subject, attachments, logged_by: "u_b72demo" })]);
    };
    await mail("sch1", 8, "outbound", "Studio scholarship report", "Here is this term's scholarship report. Twelve students, and the pottery wheel finally works.", 1);
    await mail("sch2", 6, "inbound", "Re: Studio scholarship report", "Thank you, Dana. Reading it tonight.");
    await mail("sch3", 3, "outbound", "Re: Studio scholarship report", "Lily is welcome to come and see the wheel any afternoon.");
    await mail("sch4", 1, "inbound", "Re: Studio scholarship report", "The scholarship report made my week. Lily keeps asking about the pottery wheel. See you Thursday.");
    const YEAR_MAIL = [
      [30, "inbound", "Lunch next week?", "Windy Corner suits me. Shall we say half past twelve?"],
      [31, "outbound", "Lunch next week?", "Would you like to have lunch before the fall term starts?"],
      [57, "inbound", "Re: Thank you for August", "It was a pleasure. The gala photos are lovely."],
      [58, "outbound", "Thank you for August", "Your gift arrived today. Thank you, from all of us."],
      [80, "inbound", "Re: Gala seating", "Table four is perfect. Thank you for arranging it."],
      [82, "outbound", "Gala seating", "Would you like to sit with the scholarship families this year?"],
      [100, "inbound", "Re: Youth Arts Access", "Let me think about it until the fall."],
      [110, "outbound", "Youth Arts Access", "I wanted to share the plan for Youth Arts Access, and ask whether you would consider $25,000."],
      [140, "inbound", "Re: Spring showcase", "Lily loved it. She talked about nothing else all week."],
      [142, "outbound", "Spring showcase", "We would love to see you and Lily at the spring showcase."],
      [150, "inbound", "Your May gift", "I have asked the bank to send it this week."],
      [175, "inbound", "Re: Coffee in April?", "Yes, Magee's at ten."],
      [176, "outbound", "Coffee in April?", "Could I buy you a coffee in April?"],
      [205, "inbound", "Re: Winter newsletter", "What a year the students have had."],
      [229, "inbound", "Re: Thank you", "You are very welcome."],
      [230, "outbound", "Thank you", "Thank you for your gift. It funds the winter term."],
      [240, "inbound", "Re: Gala walkthrough", "I would be glad to help with the walkthrough."],
      [260, "inbound", "New year", "Happy new year to everyone at the studio."],
      [261, "outbound", "Re: New year", "And to you, Margaret."],
      [265, "inbound", "Re: Holiday card", "The card from the students is on my mantelpiece."],
    ];
    let n = 0;
    for (const [daysAgo, dir, subj, body] of YEAR_MAIL) {
      if (orgTime.addDays(TODAY, -daysAgo) < TODAY.slice(0, 4) + "-01-01") continue;
      await mail(`y${++n}`, daysAgo, dir, subj, body);
    }

    // Her next step, open: the one thread, due tomorrow.
    // One open thread per person: an earlier section may already have opened
    // hers, so that one is rewritten rather than a second refused.
    const MC_STEP = "Coffee tomorrow. Bring Lily's class schedule.";
    const moved = await q(`UPDATE threads SET next_step_type='follow_up', next_step_label=$3, due_date=$4, owner_id='u_b72demo', owner_name='Dana Reyes'
                            WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL RETURNING id`, [ORG, margaretId, MC_STEP, orgTime.addDays(TODAY, 1)]);
    if (!moved.length)
      await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,created_by,created_by_name)
               VALUES ('th_b72_mc',$1,$2,'follow_up',$3,$4,$5,'u_b72demo','Dana Reyes','system:seed-demo','The demonstration file')`,
        [ORG, margaretId, MC_STEP, orgTime.addDays(TODAY, 1), orgTime.addDays(TODAY, -3)]);
    // The August gift has had its receipt, and no thank-you by hand.
    await q(`UPDATE gifts SET acknowledgement_sent=false, acknowledgement_sent_at=NULL, acknowledged_via=NULL WHERE id=$1 AND org_id=$2`,
      [margaretAugGift, ORG]);
    console.log(`[assert] Margaret Chen: coffee ${orgTime.addDays(TODAY, 1)} 10:00, ${n + 4} emails this year, the August gift unthanked`);
  }

  console.log("[seed] the email tool…");
  // The SAME sentence builder the sync uses, so the demo's timeline lines and
  // a real org's are written by one function rather than two that drift.
  const { activitySentence: emActivitySentence } = await import("../shared/emailMarketing.js");
  const EM_CONN = "emc_b72_mailchimp";
  await q(`INSERT INTO email_marketing_connections
             (id,org_id,provider,status,server_prefix,account_name,audience_id,audience_name,
              mapping,last_synced_at,last_tried_at,last_pushed_count,created_by,created_by_name)
           VALUES ($1,$2,'mailchimp','active','us14','Harborlight Youth Collective',
                   'aud_harborlight','Harborlight Newsletter',
                   $3::jsonb, NOW(), NOW(), 412, 'system:seed-demo','The demonstration file')`,
    [EM_CONN, ORG, JSON.stringify({
      audienceId: "aud_harborlight", audienceName: "Harborlight Newsletter",
      groups: { "builtin:donors": "Steward donors", "builtin:volunteers": "Volunteers" },
    })]);

  // Three campaigns she actually sent, oldest first, with the counts Mailchimp
  // would report. The open and click numbers are the ones the rows below foot
  // to, so every figure on the Communications screen opens its people.
  const EM_CAMPAIGNS = [
    ["emcamp_b72_spring", "Spring Appeal",      "A harbour worth keeping",      96, 412, 188, 47],
    ["emcamp_b72_summer", "Summer Programme",   "What your gift built in June", 61, 408, 151, 22],
    ["emcamp_b72_autumn", "Autumn Newsletter",  "Eleven families, one autumn",  17, 415, 174, 31],
  ];
  for (const [id, name, subject, daysAgo, sends, opens, clicks] of EM_CAMPAIGNS) {
    await q(`INSERT INTO email_marketing_campaigns
               (id,org_id,provider,provider_campaign_id,name,subject,sent_at,sends,opens,clicks)
             VALUES ($1,$2,'mailchimp',$3,$4,$5,NOW() - ($6 || ' days')::interval,$7,$8,$9)`,
      [id, ORG, id.replace("emcamp_b72_", "mc_"), name, subject, String(daysAgo), sends, opens, clicks]);
  }

  // Who did what, on their own records. Four people, chosen from outside the
  // drifted eleven, and one of them gave eleven days after clicking the spring
  // appeal: that gift is shown BESIDE the campaign and never credited to it.
  const EM_ACTIVITY = [
    // [donorKey, campaignId, opened, clicked, label]
    ["d_b72_pos1", "emcamp_b72_spring", true,  true,  "the give link"],
    ["d_b72_pos2", "emcamp_b72_spring", true,  false, null],
    ["d_b72_pos3", "emcamp_b72_autumn", true,  true,  "the programme page"],
    ["d_b72_pos1", "emcamp_b72_autumn", true,  false, null],
  ];
  for (const [donorId, campaignId, opened, clicked, label] of EM_ACTIVITY) {
    const [exists] = await q(`SELECT id FROM donors WHERE id=$1 AND org_id=$2`, [donorId, ORG]);
    if (!exists) continue;
    const camp = EM_CAMPAIGNS.find(c => c[0] === campaignId);
    await q(`INSERT INTO email_marketing_activity
               (id,org_id,campaign_id,donor_id,email,opened,clicked,clicked_label,occurred_at)
             SELECT $1,$2,$3,$4,d.email,$5,$6,$7, NOW() - ($8 || ' days')::interval
               FROM donors d WHERE d.id=$4`,
      [`emact_b72_${campaignId.slice(-6)}_${donorId.slice(-4)}`, ORG, campaignId, donorId,
       opened, clicked, label, String(camp[3])]);
    // ONE LINE ON THE TIMELINE, in the same words the sync writes.
    const note = emActivitySentence({ campaignName: camp[1], opened, clicked, clickedLabel: label });
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by)
             VALUES ($1,$2,$3,'email',$4,(NOW() - ($5 || ' days')::interval)::date::text,'system:email-marketing/mailchimp')`,
      [`int_b72_em_${campaignId.slice(-6)}_${donorId.slice(-4)}`, ORG, donorId, note, String(camp[3])]);
  }

  // ONE GIFT AFTER A CLICK, which is the line the Communications screen exists
  // to show and the one it must never call attribution.
  //
  // The person is found BY QUERY, not by a hardcoded id: somebody who really
  // gave inside the thirty days after the spring appeal, who can be emailed,
  // and who is NOT one of the eleven whose drift is the demo's whole argument
  // (their gift dates are the fixture and an extra story on top would muddy
  // it). If nobody qualifies the block simply does not run, because a demo is
  // allowed to be missing a flourish and is not allowed to invent a gift.
  {
    const springDays = EM_CAMPAIGNS[0][3];                       // 96 days ago
    const drifted = DRIFTED.map(([n]) => n);
    const [giver] = await q(
      `SELECT d.id, d.email, d.name
         FROM donors d JOIN gifts g ON g.donor_id = d.id
        WHERE d.org_id = $1
          AND g.date::date BETWEEN (CURRENT_DATE - $2::int + 1) AND (CURRENT_DATE - $2::int + 28)
          AND d.email IS NOT NULL
          AND COALESCE(d.do_not_email, false) = false
          AND COALESCE(d.deceased, false) = false
          AND COALESCE(d.is_sample, false) = false
          AND d.name <> ALL($3::text[])
        ORDER BY g.amount DESC
        LIMIT 1`, [ORG, springDays, drifted]);
    if (giver) {
      await q(`INSERT INTO email_marketing_activity
                 (id,org_id,campaign_id,donor_id,email,opened,clicked,clicked_label,occurred_at)
               VALUES ($1,$2,'emcamp_b72_spring',$3,$4,true,true,'the give link',
                       NOW() - ($5 || ' days')::interval)`,
        ["emact_b72_spring_giver", ORG, giver.id, giver.email, String(springDays)]);
      await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by)
               VALUES ($1,$2,$3,'email',$4,(NOW() - ($5 || ' days')::interval)::date::text,
                       'system:email-marketing/mailchimp')`,
        ["int_b72_em_spring_giver", ORG, giver.id,
         emActivitySentence({ campaignName: "Spring Appeal", opened: true, clicked: true,
                              clickedLabel: "the give link" }), String(springDays)]);
    }
  }

  // TWO UNSUBSCRIBES, AND THEY READ AS OPTED OUT EVERYWHERE. Written through
  // the same two places BUILD-94 writes: `email_suppressions` plus the
  // record's own flag, so the next audience sync cannot push them and a
  // campaign cannot mail them. Not a third flag.
  const EM_UNSUBS = ["d_b72_pos2", "d_b72_pos3"];
  for (const donorId of EM_UNSUBS) {
    const [d] = await q(`SELECT id, email FROM donors WHERE id=$1 AND org_id=$2`, [donorId, ORG]);
    if (!d || !d.email) continue;
    await q(`INSERT INTO email_suppressions (id,org_id,email,reason,source)
             VALUES ($1,$2,$3,'unsubscribed','campaign')`,
      [`sup_b72_${donorId.slice(-4)}`, ORG, d.email.toLowerCase()]);
    await q(`UPDATE donors SET do_not_email=true WHERE id=$1`, [donorId]);
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by)
             VALUES ($1,$2,$3,'email','Unsubscribed in Mailchimp.',
                     (NOW() - interval '9 days')::date::text,'system:email-marketing/mailchimp')`,
      [`int_b72_unsub_${donorId.slice(-4)}`, ORG, donorId]);
  }


  // The sales. Written straight, not through ingestPosSale: the seed is not a
  // second ingest path, it is a fixture of what ingest PRODUCES, and it writes
  // no gift at all — every line here is event or shop money, which is exactly
  // the point being demonstrated.
  const posSales = [];
  const galaDay = gala.date;
  posSales.push(["sq_b72_gala_1", galaDay, "d_b72_pos1", "Ottoline Braithwaite", gala.id, "Harbor Center",
    [["Raffle ticket", 5000], ["Bar", 2400]]]);
  posSales.push(["sq_b72_gala_2", galaDay, "d_b72_pos2", "Caspian Threlfall", gala.id, "Harbor Center",
    [["Auction win", 42000], ["Bar", 1800]]]);
  posSales.push(["sq_b72_gala_3", galaDay, "d_b72_pos3", "Marisol Quintrell", gala.id, "Harbor Center",
    [["Raffle ticket", 2500], ["Harbor tote", 3200]]]);
  // The 5K: shirts and the donate button, on the day of the run.
  // The first three only: the fourth person is the attendance-drift fixture and
  // a shirt bought this week would make them the opposite of drifting.
  for (let i = 0; i < 3; i++)
    posSales.push([`sq_b72_5k_${i}`, dAdd(TODAY, -2 - i), POS_PEOPLE[i][0], POS_PEOPLE[i][1],
      run5k.id, "North Shore Path", [["Harbor Run shirt", 3000]]]);
  // The one who came every month and stopped: five cafe visits, then silence.
  for (let m = 9; m >= 5; m--)
    posSales.push([`sq_b72_cafe_${m}`, dAdd(TODAY, -m * 30), "d_b72_pos4", "Ambrose Wyndecott",
      null, "Harbor Center", [["Cafe", 650]]]);

  const posMapByKey = new Map(POS_MAP.map(([n, c, e]) => [n.toLowerCase().replace(/\s+/g, " "), { c, e }]));
  let posTotal = 0, posEventCents = 0, posOtherCents = 0, posUnmapped = 0;
  for (const [ext, on, personId, buyerName, eventId, place, lines] of posSales) {
    let ev = 0, other = 0, unmapped = 0;
    const shaped = lines.map(([name, cents]) => {
      const m = posMapByKey.get(name.toLowerCase().replace(/\s+/g, " "));
      const cls = m ? m.c : "other";
      if (!m) unmapped++;
      if (cls === "event") ev += cents; else other += cents;
      return { name, amountCents: cents, class: cls, eventId: m && m.e ? m.e : null, mapped: !!m };
    });
    posTotal += ev + other; posEventCents += ev; posOtherCents += other; posUnmapped += unmapped;
    await q(`INSERT INTO pos_sales (id,org_id,source_id,external_id,occurred_on,person_id,match_by,
                                    buyer_name,location_name,event_id,total_cents,gift_cents,event_cents,
                                    other_cents,unmapped_lines,lines,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'email',$7,$8,$9,$10,0,$11,$12,$13,$14,'system:seed-demo','The demonstration file')`,
      [`pos_b72_${ext}`, ORG, POS_SRC, ext, on, personId, buyerName, place, eventId,
       ev + other, ev, other, unmapped, JSON.stringify(shaped)]);
  }
  console.log(`[assert] the register: ${posSales.length} sales, $${(posTotal / 100).toLocaleString()} taken, none of it a gift · ${posUnmapped} unmapped line · 4 buyers who have never given, one of them drifting on attendance`);

  // ── INT-2 · THE BOOKKEEPER'S END ───────────────────────────────────────
  // QuickBooks connected with its mapping finished, so the demo shows the
  // screen an organisation actually reaches: every fund pointing somewhere,
  // the fee account set, and the bank account each source settles to. Xero is
  // deliberately NOT connected, so the "not connected" state is on the screen
  // beside the connected one.
  //
  // No credentials are written and INTUIT_API_BASE is unset in the demo, so a
  // Send pressed during a demo builds the deposit, refuses to send it, and
  // says why — which is the honest behaviour and the one worth showing.
  {
    const demoFunds = await q(`SELECT id, name FROM fin_funds WHERE org_id=$1 ORDER BY name`, [ORG]);
    const fundMap = {}, classMap = {};
    for (const [k, f] of demoFunds.entries()) {
      fundMap[f.id] = k === 0 ? "acct_4010_contributions" : `acct_40${20 + k}_${f.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      if (/boat|scholarship|restricted/i.test(f.name)) classMap[f.id] = `class_${f.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    }
    const mapping = {
      funds: fundMap, classes: classMap,
      revenueAccounts: { raffle: "acct_4200_event_income", auction: "acct_4200_event_income",
                         bar: "acct_4200_event_income", other: "acct_4300_other_income" },
      feeAccountId: "acct_6110_processing_fees",
      depositAccounts: { stripe: "acct_1010_operating", paypal: "acct_1020_paypal",
                         givebutter: "acct_1010_operating", square: "acct_1010_operating" },
    };
    await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,donor_names,
                                                  created_by,created_by_name)
             VALUES ('bkc_b72_qbo',$1,'quickbooks','active','demo-realm',$2::jsonb,false,
                     'system:seed-demo','The demonstration file')`,
      [ORG, JSON.stringify(mapping)]);
    console.log(`[assert] the books: QuickBooks connected, ${Object.keys(fundMap).length} funds mapped, fees and ${Object.keys(mapping.depositAccounts).length} bank accounts set · Xero not connected · donor names off`);
    // INT-OAUTH — THE DEMO IS CONNECTED AND HOLDS NOTHING. Every connection in
    // this file is a row with no sealed credentials, so the screens read the
    // way a connected organisation's do while the demo can reach no provider
    // and no provider can be charged, read or written on its behalf. This is
    // asserted rather than assumed, because a real token reaching the demo org
    // would be a real organisation's books behind a public login.
    const [held] = await q(
      `SELECT COUNT(*)::int n FROM (
         SELECT credentials_sealed FROM giving_sources WHERE org_id=$1
         UNION ALL
         SELECT credentials_sealed FROM bookkeeping_connections WHERE org_id=$1
         UNION ALL
         -- INT-3: the email tool is a connection like any other, and a real
         -- Mailchimp token on the demo org would be a real organisation's
         -- mailing list behind a public login.
         SELECT credentials_sealed FROM email_marketing_connections WHERE org_id=$1
         UNION ALL
         -- INT-4: a staff mailbox is the most sensitive connection in the
         -- product, and a real token on the demo org would be a real person's
         -- inbox behind a public login.
         SELECT credentials_sealed FROM mailbox_connections WHERE org_id=$1) x
        WHERE credentials_sealed IS NOT NULL`, [ORG]);
    if (Number(held.n) !== 0) {
      throw new Error(`REFUSED: the demo org holds ${held.n} set of provider credentials. `
        + `The demonstration file is connected on screen and holds nothing.`);
    }
    console.log("[assert] the demo holds no provider credentials: 0 sealed rows across every connection");
  }
  await require("./seed/parity2-qbo").seedParity2Qbo(q, ORG, { today: TODAY });   // PARITY-2 Part 5

  // ── GIVE-2 · THE DONATION FORM THAT RAISES MORE ────────────────────────
  // Four things a prospect should be able to see working, on real rows:
  //   · A FORM with smart amounts on, so the ladder is drawn from Harborlight's
  //     own gifts rather than Steward's $25/$50/$100/$250 guess.
  //   · COVER-THE-FEE actually taken, on a handful of this year's online gifts,
  //     with the processor's own fee beside it so "charged / received" has two
  //     different numbers on it.
  //   · A RECOVERED monthly gift: a card that failed, a card-update email, and
  //     the money that came back.
  //   · TWO MATCHING EMPLOYERS, with their own form links.
  console.log("[seed] the donation form, covered fees, a recovered card and two matching employers…");
  {
    // A FORM ON THE EXISTING 5K PAGE. No second page: the form is a config on
    // the giving page, which is the whole BUILD-102 premise.
    await q(`UPDATE giving_pages SET form_config = $2::jsonb WHERE id = $1 AND org_id = $3`,
      [P2P_PAGE, JSON.stringify({
        amountsCents: [2500, 5000, 10000, 25000],
        smartAmounts: true,
        allowOther: true,
        offerMonthly: true,
        defaultFrequency: "once",
        designation: { mode: "none", fundId: null, fundIds: [] },
        showTribute: false,
        showEmployerMatch: true,
        questions: [],
        thankYou: { message: "", redirectUrl: "" },
        headline: "Every runner, every mile, every scholarship.",
      }), ORG]);
    // The org's own suggestion when it asks a one-time donor to go monthly.
    await q(`UPDATE orgs SET form_upsell_monthly_cents = 2500 WHERE id = $1`, [ORG]);

    // COVER-THE-FEE, ON REAL GIFTS. The five most recent online gifts of this
    // year get the donor-covered portion and the processor's own fee, computed
    // with the SAME module the product computes them with — a seed that does
    // its own arithmetic is a seed that can disagree with the screen.
    const RATES = await import("../shared/processingRates.js");
    const cardRate = RATES.DEFAULT_RATES.card;
    const online = await q(
      `SELECT id, amount FROM gifts
        WHERE org_id = $1 AND payment_method = 'Card' AND amount >= 25
          AND date >= $2 AND cover_fee_amount = 0
        ORDER BY date DESC LIMIT 5`, [ORG, `${TODAY.slice(0, 4)}-01-01`]);
    for (const g of online) {
      // The donor intended `amount`; they were charged the gross-up; the
      // processor took its cut of the charge. All three on the one row, and
      // `shared/giftFooting.js` is what foots them.
      const intendedCents = Math.round(Number(g.amount) * 100);
      const chargedCents = RATES.grossUpCents(intendedCents, cardRate);
      const feeCents = RATES.feeOnChargeCents(chargedCents, cardRate);
      await q(
        `UPDATE gifts SET amount = $2, cover_fee_amount = $3,
                          processor_fee_amount = $4, processor_fee_source = 'stripe_balance_transaction'
          WHERE id = $1 AND org_id = $5`,
        [g.id, chargedCents / 100, (chargedCents - intendedCents) / 100, feeCents / 100, ORG]);
    }
    // The donor rollups move with them, because the charge IS the gift.
    await q(
      `UPDATE donors d SET total_giving = s.total, last_gift_amount = CASE
                WHEN COALESCE(NULLIF(d.last_gift_date,''),'0001-01-01')::date = s.last_date THEN s.last_amount
                ELSE d.last_gift_amount END
         FROM (SELECT donor_id, SUM(amount) AS total, MAX(date)::date AS last_date,
                      (array_agg(amount ORDER BY date DESC))[1] AS last_amount
                 FROM gifts WHERE org_id = $1 GROUP BY donor_id) s
        WHERE d.id = s.donor_id AND d.org_id = $1`, [ORG]).catch(() => {});

    // A RECOVERED MONTHLY GIFT. One of the monthly givers' cards failed six
    // weeks ago, the card-update email went out, they updated it, and the gift
    // came back. Three `payment_recovery_events` rows, because that is what the
    // engine writes and what the Fundraising panel reads.
    const [recovered] = await q(
      `SELECT id, donor_id, stripe_subscription_id, amount FROM recurring_subscriptions
        WHERE org_id = $1 AND status = 'active' AND stripe_subscription_id IS NOT NULL
        ORDER BY amount DESC LIMIT 1`, [ORG]);
    if (recovered) {
      const failedOn = orgTime.addDays(TODAY, -42);
      const cameBackOn = orgTime.addDays(TODAY, -39);
      await q(
        `UPDATE recurring_subscriptions
            SET status = 'recovered', failure_count = 1,
                first_failed_at = $2::date, last_failed_at = $2::date, recovered_at = $3::date
          WHERE id = $1 AND org_id = $4`, [recovered.id, failedOn, cameBackOn, ORG]);
      const ev = (type, on) => q(
        `INSERT INTO payment_recovery_events (id,org_id,donor_id,subscription_id,type,detail,created_at)
         VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6::date)`,
        [`pre_g2_${type}`, ORG, recovered.donor_id, recovered.stripe_subscription_id, type, on]);
      await ev("payment_failed", failedOn);
      await ev("dunning_sent", failedOn);
      await ev("payment_recovered", cameBackOn);
      // The money the recovery collected: every renewal on that subscription
      // from the day it came back. Stamped so the panel's dollars figure has
      // gifts to open rather than a count with nothing behind it.
      // COALESCE, not `IS NULL`: the monthly givers' renewals already carry
      // their subscription id from the block above, and the first cut's
      // `recurring_subscription_id IS NULL` guard therefore matched nothing —
      // the panel showed a recovery with no gifts behind its money figure,
      // which is precisely the shape of number this build exists to retire.
      await q(
        `UPDATE gifts SET recurring_subscription_id = COALESCE(recurring_subscription_id, $1),
                          processor_fee_amount = round((amount * $4)::numeric + $5, 2),
                          processor_fee_source = 'stripe_balance_transaction'
          WHERE org_id = $2 AND donor_id = $3 AND date >= $6`,
        [recovered.id, ORG, recovered.donor_id, cardRate.pct, cardRate.flatCents / 100, cameBackOn]);
    }

    // TWO MATCHING EMPLOYERS, with the companies' own form links. Typed by
    // staff — there is no vendor behind this and no lookup service, which is
    // exactly what the card in Settings says.
    const EMPLOYERS = [
      ["me_b72_meridian", "Meridian Bank", "https://meridianbank.example.com/community/matching-gifts", "1:1", 2500, 1000000,
       "Their form needs the gift date and the receipt, both of which are on the donor's record."],
      ["me_b72_harborgen", "Harbor General Hospital", "https://harborgeneral.example.org/foundation/match", "2:1", 5000, 500000,
       "Two to one for staff of five years or more, one to one below that."],
    ];
    for (const [id, name, url, ratio, minC, maxC, note] of EMPLOYERS)
      await q(`INSERT INTO matching_employers (id,org_id,name,form_url,ratio,min_cents,max_cents,note,created_by,created_by_name)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'u_b72demo','Dana Reyes')
               ON CONFLICT (org_id, lower(name)) DO NOTHING`,
        [id, ORG, name, url, ratio, minC, maxC, note]);

    // ── THE SEED'S OWN ASSERTION ────────────────────────────────────────────
    // Every covered gift must foot: charged = intended + covered, and
    // charged = received + fee. A seed that writes money that does not add up
    // is a demonstration of a bug.
    const F = await import("../shared/giftFooting.js");
    const covered = await q(
      `SELECT id, amount, cover_fee_amount, processor_fee_amount, processor_fee_source
         FROM gifts WHERE org_id = $1 AND cover_fee_amount > 0`, [ORG]);
    for (const g of covered) {
      const f = F.giftFooting({
        grossCents: Math.round(Number(g.amount) * 100),
        feeCents: Math.round(Number(g.processor_fee_amount) * 100),
        coveredCents: Math.round(Number(g.cover_fee_amount) * 100),
        feeSource: g.processor_fee_source,
      });
      if (!F.footsToTheCent(f)) {
        throw new Error(`REFUSED: gift ${g.id} does not foot — ${JSON.stringify(f)}`);
      }
    }
    console.log(`[assert] ${covered.length} covered-fee gifts foot to the cent (charged = intended + covered = received + fee)`);

    // AND THE RECOVERY HAS MONEY BEHIND IT. A recovered card with no gifts
    // dated after it is a figure with nothing to open, which the first cut of
    // this seed produced and nothing would have caught.
    if (recovered) {
      const [back] = await q(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS total FROM gifts
          WHERE org_id = $1 AND recurring_subscription_id = $2
            AND date >= (SELECT to_char(recovered_at,'YYYY-MM-DD') FROM recurring_subscriptions WHERE id = $2)`,
        [ORG, recovered.id]);
      if (!back || back.n < 1) {
        throw new Error("REFUSED: the recovered monthly gift has no gifts dated after it came back, so the Fundraising panel's money figure would open nothing.");
      }
      console.log(`[assert] the recovered card collected ${back.n} gift${back.n === 1 ? "" : "s"} since, $${back.total.toLocaleString("en-US")}`);
    }
  }

  // ── CAMPAIGN-2 · A CAMPAIGN PAGE AND A PLAN ────────────────────────────
  // Two things a prospect should be able to see working:
  //   · A YEAR-END CAMPAIGN with a public page partway to its goal, built from
  //     the same template the button builds, with its countdown, its matching
  //     challenge and a recent-gifts list that names only the people who chose
  //     to be named.
  //   · A GIVINGTUESDAY PLAN for this year: the campaign, its page and seven
  //     dated reminders on somebody's list. Nothing sent, nothing scheduled.
  console.log("[seed] the year-end campaign page and the GivingTuesday plan…");
  {
    const CP = await import("../shared/campaignPage.js");
    for (const key of ["yearend", "givingtuesday"]) {
      const plan = CP.planFor(key, { today: TODAY, orgName: "Harborlight Youth Collective" });
      if (!plan) continue;
      const campaignId = `camp_b72_${key}`;
      const pageId = `gp_b72_${key}`;
      // The year-end campaign carries a goal it is partway to; GivingTuesday is
      // the one that has not happened yet, which is the honest state for a plan.
      const goal = key === "yearend" ? 60000 : 20000;
      await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,donor_facing_name,goal_progress_public,match_cents,match_sponsor,match_started_at)
               VALUES ($1,$2,$3,'appeal',$4,$5,$6::date,$7::date,$3,TRUE,$8,$9,$10)
               ON CONFLICT (id) DO NOTHING`,
        [campaignId, ORG, plan.campaign.name, key === "yearend" ? "active" : "draft", goal,
         plan.campaign.startDate, plan.campaign.endDate,
         // The match is on the year-end campaign only, and it is partly claimed,
         // so the page shows a number that has moved.
         key === "yearend" ? 2500000 : null,   // $25,000, partly claimed, so the bar has moved
         key === "yearend" ? "Meridian Bank" : null,
         // The match began when somebody promised it, which on a demonstration
         // file has to be in the PAST or the page shows a challenge nothing has
         // been claimed against — a number that cannot move is a number nobody
         // believes. (The first cut used the campaign's own start date, which is
         // in November, so the page read "$10,000 still unclaimed" beside
         // thirty-four gifts.)
         key === "yearend" ? orgTime.addDays(TODAY, -45) : null]);

      const widgets = [
        { type: "hero", heading: plan.page.headline, sub: "", image: null, size: "standard" },
        { type: "richtext", blocks: plan.page.story.split("\n\n").filter(Boolean).map(t => ({ type: "p", text: t })) },
        { type: "countdown", heading: "" },
        { type: "matchchallenge" },
        { type: "recentgifts", count: 8, showAmounts: false, heading: "Recent gifts" },
      ];
      await q(`INSERT INTO giving_pages
                 (id,org_id,slug,title,goal_amount,story,status,campaign_id,is_campaign_page,form_position,
                  published,published_at,draft,draft_updated_at,created_by,created_by_name,form_config)
               VALUES ($1,$2,$3,$4,$5,$6,'active',$7,TRUE,'top',$8::jsonb,NOW(),$8::jsonb,NOW(),'u_b72demo','Dana Reyes',$9::jsonb)
               ON CONFLICT (id) DO NOTHING`,
        [pageId, ORG, plan.page.slug, plan.page.title, goal, plan.page.story, campaignId,
         JSON.stringify(widgets), JSON.stringify(plan.formConfig)]);

      for (const [i, s] of plan.steps.entries()) {
        // The steps already behind us on the year-end plan are done, because a
        // plan on which nothing has been ticked is a plan nobody is running.
        const done = key === "yearend" && s.due < TODAY ? 1 : 0;
        await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,campaign_id,created_by,created_by_name)
                 VALUES ($1,$2,$3,$4,'medium',$5,$6,$7,'u_b72demo','Dana Reyes')
                 ON CONFLICT (id) DO NOTHING`,
          [`t_b72_${key}_${i}`, ORG, s.title, s.due, s.type || "donor", done, campaignId]);
      }
    }

    // THE YEAR-END PAGE IS PARTWAY THERE. Real gifts, moved onto the campaign
    // from this autumn's online giving — the thermometer is a live SUM over gift
    // rows (never a counter), so moving the gifts IS moving the bar.
    // Taken from the ANNUAL FUND's recent online gifts, which is where a
    // year-end appeal's money would actually have come from, and never from
    // the 5K or the gala: those two are the file's own stories and a campaign
    // that quietly lost its gifts to another is a demonstration of a bug.
    // Every gift here already belongs to a campaign — there are no unattributed
    // ones in this window, which the first cut of this block assumed and which
    // its own assertion caught on the first run.
    const autumn = await q(
      `SELECT id, donor_id FROM gifts
        WHERE org_id = $1 AND campaign_id = 'camp_b72demo' AND amount BETWEEN 50 AND 2500
          AND date >= $2 AND date <= $3
        ORDER BY date DESC LIMIT 34`,
      [ORG, orgTime.addDays(TODAY, -45), TODAY]);
    for (const [i, g] of autumn.entries()) {
      await q(`UPDATE gifts SET campaign_id = $1,
                 -- EVERY THIRD DONOR CHOSE TO BE NAMED, and the rest are
                 -- Anonymous. The default is off, so a seed that named
                 -- everybody would be demonstrating a bug.
                 show_name_publicly = $3
               WHERE id = $2 AND org_id = $4`,
        [`camp_b72_yearend`, g.id, i % 3 === 0, ORG]);
    }

    // ── THE SEED'S OWN ASSERTION ──────────────────────────────────────────
    // The goal bar is a live SUM over the campaign's own gift rows. If the
    // figure and the rows ever disagree, the demonstration is of a defect.
    const [bar] = await q(
      `SELECT COALESCE(SUM(g.amount - COALESCE(g.cover_fee_amount,0)),0)::float AS raised,
              COUNT(*)::int AS n
         FROM gifts g JOIN campaigns c ON c.id=$2 AND c.org_id=g.org_id
        WHERE g.org_id=$1 AND (g.campaign_id=c.id OR g.campaign=c.name)`,
      [ORG, "camp_b72_yearend"]);
    if (!bar || bar.n < 10) {
      throw new Error(`REFUSED: the year-end campaign page has ${bar ? bar.n : 0} gifts behind its goal bar; a thermometer on an empty campaign demonstrates nothing.`);
    }
    const [named] = await q(
      `SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND campaign_id=$2 AND show_name_publicly IS TRUE`,
      [ORG, "camp_b72_yearend"]);
    console.log(`[assert] the year-end page: $${Math.round(bar.raised).toLocaleString("en-US")} over ${bar.n} gifts, ${named.n} of whom chose to be named`);
  }

  // ── AGENTS-1 · ONE PLAN PER PERSONA, SO THE DEMO SHOWS ALL SIX ─────────
  // Six planned instructions, one from each of the six agents, each about
  // people who are really in this file. They sit in Plans as PLANNED: nothing
  // confirmed, nothing run, nothing drafted, nothing sent — which is what the
  // product does before somebody presses confirm, and the only honest thing to
  // seed. The badge on each row is what this build added.
  const personasMod = await import("../shared/agentPersonas.js");
  const agentSeedPeople = await q(
    `SELECT id, name FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND kind IS NULL AND total_giving > 0
      ORDER BY id LIMIT 6`, [ORG]);
  const AGENT_ASKS = {
    data: "Find the records with no email address and tag them so I can work through them.",
    researcher: "Write me a brief on this donor before Thursday's meeting.",
    writer: "Draft a thank-you for everybody who gave this week.",
    analyst: "How much did we raise from monthly givers this year?",
    recurring: "Who has gone quiet past their own pattern this month?",
    onboarding: "Draft the welcome for everybody who gave for the first time this month.",
  };
  for (const [k, persona] of personasMod.PERSONAS.entries()) {
    const person = agentSeedPeople[k % Math.max(1, agentSeedPeople.length)];
    if (!person) break;
    const plan = {
      steps: [{ tool: "find_people", label: `Read ${person.name}'s record`, citesRows: [person.id], donorId: person.id },
              { tool: "count", label: "Count what that found", citesRows: [person.id] }],
      sends: 0, expectedCount: 1,
      reads: `${person.name}'s record`,
      confirmLabel: "Run it",
    };
    await q(`INSERT INTO agent_instructions (id,org_id,text,kind,status,send_authorization,persona,plan,last_count,created_by,created_by_name)
             VALUES ($1,$2,$3,'task','planned','draft',$4,$5,1,'u_b72demo','Maren Ashgrove')`,
      [`ai_b72_${persona.id}`, ORG, AGENT_ASKS[persona.id], persona.id, JSON.stringify(plan)]);
  }
  console.log(`[assert] the agent: ${personasMod.PERSONAS.length} plans waiting, one from each of the six, none of them run`);

  // ── REPORTS-3 · ONE SAVED DASHBOARD AND A QUARTERLY BOARD PACK ─────────
  // The dashboard Dana would actually keep: the three numbers a board asks
  // first, the month-by-month line, and the LYBUNT list under them. Shared
  // with the team, because a dashboard only one person can open is not the
  // thing this build is for.
  //
  // Every tile is a declaration — a figure source name, a chart key, a report
  // id — so the demo cannot hold a tile the product does not know how to draw.
  const dashTiles = [
    { kind: "figure", source: "gifts", params: {} },
    { kind: "figure", source: "givers", params: {} },
    { kind: "figure", source: "retention", params: {} },
    { kind: "chart", chart: "givingByMonth" },
    { kind: "list", report: "std:lybunt", limit: 10 },
  ];
  await q(`INSERT INTO saved_dashboards (id,org_id,name,tiles,filters,shared,owner_id,owner_name,created_by,created_by_name)
           VALUES ('dash_b72board',$1,'The board''s four questions',$2,'{}'::jsonb,true,'u_b72demo','Dana Reyes','u_b72demo','Dana Reyes')`,
    [ORG, JSON.stringify(dashTiles)]);

  // The schedule: quarterly, on the fifth, and OFF. The demo must never mail
  // anybody, so `enabled` stays false and the recipient list stays empty —
  // which is also exactly the state a real org is in before it decides to
  // turn this on, so the demo shows the honest starting point rather than a
  // configuration nobody chose.
  await q(`INSERT INTO board_pack_schedules (id,org_id,dashboard_id,frequency,day_of_month,enabled,created_by,created_by_name)
           VALUES ('bps_b72demo',$1,'dash_b72board','quarterly',5,false,'u_b72demo','Dana Reyes')`, [ORG]);
  const [dashCheck] = await q(
    `SELECT (SELECT COUNT(*)::int FROM saved_dashboards WHERE org_id=$1) AS dashboards,
            (SELECT COUNT(*)::int FROM board_pack_schedules WHERE org_id=$1 AND enabled = true) AS live_schedules,
            (SELECT COALESCE(jsonb_array_length(board_pack_emails), 0) FROM orgs WHERE id=$1) AS recipients`, [ORG]);
  if (dashCheck.live_schedules !== 0 || dashCheck.recipients !== 0) {
    console.error("\nREFUSED: the demo's board pack would send real email. It must stay off with no recipients.\n");
    process.exit(1);
  }
  console.log(`[assert] the board pack: ${dashCheck.dashboards} saved dashboard, a quarterly schedule that is OFF, nobody to send it to`);

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
  // ── FIX-5 · NOBODY IN HARBORLIGHT SHARES A NAME ────────────────────────
  // Asserted against the DATABASE, not against the registry that built it: a
  // registry checking itself proves only that the registry is consistent. The
  // one allowed repeat is the merge fixture — ONE person with TWO records —
  // and it is named here rather than counted, so a second duplicate appearing
  // by accident cannot hide inside an allowance of "one".
  const dupNames = await q(
    `SELECT lower(btrim(regexp_replace(name,'\\s+',' ','g'))) AS k,
            COUNT(*)::int n, array_agg(id ORDER BY id) AS ids, MIN(name) AS shown
       FROM donors WHERE org_id=$1 AND deleted_at IS NULL
      GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 1`, [ORG]);
  const MERGE_FIXTURE = "osric ravensmere";   // the deliberate two-record person
  for (const d of dupNames) {
    if (d.k === MERGE_FIXTURE && d.n === 2) continue;
    shapeFail.push(`${d.n} people are called "${d.shown}" (${d.ids.join(", ")}) — every demo person has their own name`);
  }
  const [fillerNames] = await q(
    `SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND name ~ '^Donor [0-9]+ '`, [ORG]);
  if (fillerNames.n) shapeFail.push(`${fillerNames.n} donor(s) still carry a filler name like "Donor 1002 Ashgrove"`);

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
  console.log(`[assert] ${takenNames.size} distinct names across every person in the file · the only repeated one is the merge fixture's two records`);
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
  // FIX-11 Part 3 — EVERY GIFT HAS A FUND, A DEPOSIT AND, IF IT WAS A CARD,
  // A FEE. The bulk writer assigns all three, but three other inserts do not
  // go through it (two pledge payments and the peer-to-peer gifts), so this is
  // the sweep that catches them. It runs LAST, after every gift exists — an
  // earlier version sat before the peer-to-peer block and left twelve gifts
  // with no fund, which is exactly the "(no fund)" line in the bookkeeper's
  // file that this part is about.
  //
  // Stock and in-kind are excluded on purpose: they are revenue and they never
  // reached a bank account, so a deposit reference on one would be a lie.
  await q(`UPDATE gifts
              SET fund_id = COALESCE(fund_id, (SELECT id FROM fin_funds WHERE org_id=$1 AND NOT restricted ORDER BY name LIMIT 1)),
                  deposited_on = COALESCE(deposited_on, CASE WHEN payment_method = 'Card' THEN (date::date + 2)::text ELSE date END),
                  deposit_ref  = COALESCE(deposit_ref, CASE WHEN payment_method = 'Card'
                                   THEN 'po_demo_' || replace((date::date + 2)::text, '-', '')
                                   ELSE 'sheet:' || date END),
                  processor_fee_amount = CASE WHEN payment_method = 'Card' AND COALESCE(processor_fee_amount,0) = 0
                                   THEN ROUND(amount * 0.022 + 0.30, 2) ELSE COALESCE(processor_fee_amount,0) END
            WHERE org_id = $1
              AND LOWER(COALESCE(type,'')) NOT IN ('stock','in kind','in-kind','in_kind','securities')`, [ORG]);

  // ── COMMS-2 · THE BRAND KIT, AND THREE TEMPLATES IN HARBORLIGHT'S WORDS ──
  // Emerald and brass, Dana's signature, the boatyard address and the tax
  // sentence; the first-gift letter, the monthly thank-you and the year-end
  // cover reviewed (rewritten by Dana), the other seven still in Steward's
  // starting words and saying so.
  await q(`UPDATE orgs SET brand_primary='#0d5c3a', brand_secondary='#c9a84c',
             receipt_signature_name=COALESCE(receipt_signature_name,'Dana Reyes'),
             receipt_signature_title=COALESCE(receipt_signature_title,'Executive Director'),
             brand_signature_extra='Harborlight Youth Collective · (978) 555-0142',
             receipt_address=COALESCE(receipt_address,'12 Wharf Street, Salem, MA 01970'),
             receipts_enabled=true, legal_name=COALESCE(legal_name,'Harborlight Youth Collective, Inc.'), ein=COALESCE(ein,'00-0000000'),
             tax_language='Harborlight Youth Collective is a 501(c)(3) public charity. No goods or services were provided in exchange for your gift unless this receipt says so. Please keep this for your tax records.'
           WHERE id=$1`, [ORG]);
  for (const [kind, subject, body] of [
    ["thanks_first", "Welcome aboard, {{first_name}}",
     "Dear {{first_name}},\n\nThank you for your first gift to Harborlight, {{gift_amount}} on {{gift_date}}. This autumn it helps put twelve young people in the boatyard workshop every Thursday.\n\nI will write in the spring to tell you how they got on.\n\nWith thanks,\n{{signature}}"],
    ["thanks_monthly", "Thank you for every month",
     "Dear {{first_name}},\n\nYour {{monthly_amount}} a month is the gift we plan the year around. It is why the workshop doors open every week, not just when an appeal goes well.\n\nThank you,\n{{signature}}"],
    ["year_end", "Your {{year}} with Harborlight",
     "Dear {{first_name}},\n\nThank you for everything you gave this year. Your statement is attached: {{year_total}} in {{year}}.\n\n{{tax_language}}\n\nWith gratitude,\n{{signature}}"],
  ]) {
    await q(`INSERT INTO message_templates (id,org_id,kind,subject,body,reviewed_at,reviewed_by_name,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,NOW(),'Dana Reyes','u_b72demo','Dana Reyes')`, [`mt_b72_${kind}`, ORG, kind, subject, body]);
  }

  // ── SURVEY-1 · TWO SURVEYS, ANSWERED ────────────────────────────────────
  // "Why do you give?" to donors (named, twenty answers) and "How was
  // volunteering this season?" to volunteers (named, ten). Each answer is on
  // that person's timeline, as a real one would be, and counts as a touch.
  {
    const DS = "sv_b72demo_why", VS = "sv_b72demo_vol";
    const why = [{ id: "s1", title: "", questions: [
      { id: "why", type: "many", label: "Why do you give to Harborlight?", required: true,
        options: ["I believe in the young people", "Someone I know is in the programme", "The arts matter to me", "I was asked by someone I trust", "It is close to home"] },
      { id: "likely", type: "scale", label: "How likely are you to give again next year?", required: true },
      { id: "hear", type: "one", label: "How would you like to hear from us?", required: false, options: ["Email", "Post", "A call now and then", "Only at year end"] },
      { id: "visit", type: "yesno", label: "Would you like to visit a session?", required: false },
      { id: "words", type: "long", label: "Anything you would like us to know?", required: false },
    ] }];
    const vol = [{ id: "s1", title: "", questions: [
      { id: "enjoy", type: "scale", label: "How much did you enjoy volunteering this season?", required: true },
      { id: "again", type: "yesno", label: "Would you volunteer again next season?", required: true },
      { id: "role", type: "one", label: "Which role suited you best?", required: false, options: ["Workshop helper", "Mentor", "Events", "Driving"] },
      { id: "better", type: "short", label: "One thing we could do better", required: false },
    ] }];
    await q(`INSERT INTO surveys (id,org_id,slug,title,intro,thank_you,mode,audience,sections,created_by,created_by_name)
             VALUES ($1,$2,'why-do-you-give','Why do you give?','Five questions, about two minutes. It helps us thank you properly.','Thank you. Dana reads every one of these.','named','donors',$3::jsonb,'u_b72demo','Dana Reyes'),
                    ($4,$2,'volunteer-season','How was volunteering this season?','Four questions. Be honest; it makes next season better.','Thank you for your time, this season and now.','named','volunteers',$5::jsonb,'u_b72demo','Dana Reyes')`,
      [DS, ORG, JSON.stringify(why), VS, JSON.stringify(vol)]);
    const WHY = ["I believe in the young people", "Someone I know is in the programme", "The arts matter to me", "I was asked by someone I trust", "It is close to home"];
    const HEAR = ["Email", "Post", "A call now and then", "Only at year end"];
    const WORDS = ["Keep sending the photos from the showcase.", "", "My niece went through the programme in 2019. It changed her.", "", "Please call rather than email.", ""];
    const givers = donors.filter(d => (d.status === "mid" || d.status === "major") && !driftedIds.includes(d.id)).slice(40, 60);
    for (const [i, d] of givers.entries()) {
      const answers = { why: [WHY[i % 5], ...(i % 3 === 0 ? [WHY[(i + 2) % 5]] : [])], likely: [10, 9, 8, 10, 7, 9, 6, 10, 8, 9][i % 10],
        hear: HEAR[i % 4], visit: i % 3 === 1 ? "yes" : "no", ...(WORDS[i % 6] ? { words: WORDS[i % 6] } : {}) };
      const at = orgTime.addDays(TODAY, -(3 + i * 2));
      await q(`INSERT INTO survey_responses (id,org_id,survey_id,anonymous,donor_id,answers,submitted_at,created_by,created_by_name)
               VALUES ($1,$2,$3,false,$4,$5::jsonb,($6::date + time '15:00'),'system:survey','A survey answer')`,
        [`svr_b72_why_${i}`, ORG, DS, d.id, JSON.stringify(answers), at]);
      await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,metadata,created_by,logged_by_name)
               VALUES ($1,$2,$3,'survey','Answered the survey "Why do you give?"',$4,$5,'system:survey','Survey')`,
        [`int_b72_svw_${i}`, ORG, d.id, at, JSON.stringify({ survey_id: DS, response_id: `svr_b72_why_${i}` })]);
    }
    const vols = (await q(`SELECT DISTINCT person_id FROM volunteer_shifts WHERE org_id=$1 ORDER BY person_id LIMIT 10`, [ORG])).map(r => r.person_id);
    const BETTER = ["More notice before a shift changes.", "", "A proper tea break.", "", "Parking at the boatyard."];
    for (const [i, pid] of vols.entries()) {
      const answers = { enjoy: [9, 10, 8, 7, 10, 9, 6, 8, 10, 9][i], again: i === 6 ? "no" : "yes",
        role: ["Workshop helper", "Mentor", "Events", "Driving"][i % 4], ...(BETTER[i % 5] ? { better: BETTER[i % 5] } : {}) };
      const at = orgTime.addDays(TODAY, -(2 + i * 3));
      await q(`INSERT INTO survey_responses (id,org_id,survey_id,anonymous,donor_id,answers,submitted_at,created_by,created_by_name)
               VALUES ($1,$2,$3,false,$4,$5::jsonb,($6::date + time '11:00'),'system:survey','A survey answer')`,
        [`svr_b72_vol_${i}`, ORG, VS, pid, JSON.stringify(answers), at]);
      await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,metadata,created_by,logged_by_name)
               VALUES ($1,$2,$3,'survey','Answered the survey "How was volunteering this season?"',$4,$5,'system:survey','Survey')`,
        [`int_b72_svv_${i}`, ORG, pid, at, JSON.stringify({ survey_id: VS, response_id: `svr_b72_vol_${i}` })]);
    }
    await q(`UPDATE orgs SET volunteer_survey_id=$1 WHERE id=$2`, [VS, ORG]);
    console.log(`[seed] surveys: ${givers.length} donor answers, ${vols.length} volunteer answers`);
  }

  // ── PARITY-1 Part F · ONE VIDEO THANK-YOU, WAITING TO BE SENT ──────────
  // Dana recorded a short thank-you for Margaret's August gift. The video is
  // a three-second placeholder (scripts/fixtures/video-thanks-demo.webm),
  // stored the way the asset store's Postgres fallback stores it, and the
  // email with its link is a DRAFT in Communications. Never emailed: the org
  // sends nothing (emails_enabled=false) and nobody has pressed send.
  {
    const crypto = require("crypto");
    const buf = require("fs").readFileSync(require("path").join(__dirname, "fixtures", "video-thanks-demo.webm"));
    const sha = b => crypto.createHash("sha256").update(b).digest("hex");
    // assetStore.assetIdFor, the same formula, so the id is what a live upload would mint.
    const assetId = "pa_" + sha(ORG + "|video_thanks|video/webm|").slice(0, 8) + sha(buf).slice(0, 16);
    await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,storage,data) VALUES ($1,$2,'video_thanks','video/webm',$3,'db',$4)
             ON CONFLICT (id) DO UPDATE SET deleted_at = NULL`, [assetId, ORG, buf.length, buf.toString("base64")]);
    const token = crypto.randomBytes(32).toString("base64url");
    const link = `${require("../publicUrl").publicAppUrl()}/v/${token}`;
    await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
             VALUES ('md_b72demo_video',$1,$2,'video:vt_b72demo_1','A thank-you from Harborlight Youth Collective',$3,'pending_review','video_thanks','u_b72demo','Dana Reyes')`,
      [ORG, margaretId, `Dear Margaret,\n\nI recorded a short video to say thank you. You can watch it here:\n\n${link}\n\nWith gratitude,\nDana Reyes\nHarborlight Youth Collective`]);
    await q(`INSERT INTO video_thanks (id,org_id,donor_id,asset_id,mime,bytes,duration_seconds,token,draft_id,created_by,created_by_name,created_at)
             VALUES ('vt_b72demo_1',$1,$2,$3,'video/webm',$4,3,$5,'md_b72demo_video','u_b72demo','Dana Reyes',NOW() - INTERVAL '1 hour')`,
      [ORG, margaretId, assetId, buf.length, token]);
    console.log("[seed] video thank-you: one draft for Margaret Chen, not sent");
  }

  // ── WHY-1 · TOMORROW MORNING, AND THE JOURNEYS A RAIL CAN SUGGEST ──────
  // "Who should I call tomorrow?" is the demo's second question and it should
  // come back with five strong names for five different reasons. Four are
  // already in the file (the October major donors, Tidewater's unthanked
  // $7,500, a drifting donor, Ondine's failed card); the fifth is an open ask
  // past its expected date, raised here for a donor of Dana's who is not
  // already on her Thread. Written late, after every thread, so the "not
  // already on the Thread" test is true of the finished file.
  console.log("[seed] tomorrow morning: an ask past its date, and three journeys to suggest…");
  {
    const [who] = await q(`SELECT d.id FROM donors d WHERE d.org_id = $1 AND d.assigned_to = 'u_b72demo' AND d.deleted_at IS NULL
        AND d.total_giving BETWEEN 4000 AND 20000 AND COALESCE(d.kind,'') NOT IN ('organisation','anonymous')
        AND NOT (d.id = ANY($2))
        AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.org_id = d.org_id AND t.donor_id = d.id AND t.closed_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.org_id = d.org_id AND o.donor_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM recurring_subscriptions r WHERE r.org_id = d.org_id AND r.donor_id = d.id)
      ORDER BY d.total_giving DESC, d.id LIMIT 1`, [ORG, driftedIds]);
    if (who) await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status,officer_id,officer_name,created_at,proposal_stage,expected_close,notes,created_by,created_by_name)
        VALUES ('opp_b72_sail',$1,$2,'Summer sailing scholarships',10000,'open','u_b72demo','Dana Reyes',NOW() - interval '48 days','asked',$3::date,
                'Said they would decide by the end of September.','u_b72demo','Dana Reyes')`, [ORG, who.id, orgTime.addDays(TODAY, -6)]);
    // The journeys a donor's rail can suggest beyond the first year: lapsed,
    // monthly and major. From the catalogue, like the first-year one. NOT
    // armed (journey_enabled false): starting one is a person's choice on the
    // rail, and no rule should start one while somebody is giving the demo.
    for (const [id, key] of [["ct_b72_welcome", "welcome_back"], ["ct_b72_monthly", "monthly_giver"], ["ct_b72_major", "major_donor"]]) {
      const P = journeyMod.presetByKey(key);
      await q(`INSERT INTO cultivation_templates
                 (id,org_id,name,description,steps,trigger_key,priority,preset_key,journey_enabled,created_by,created_by_name,trigger_amount_cents)
               VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,false,'u_b72demo','Dana Reyes',$9)`,
        [id, ORG, P.name, P.blurb, JSON.stringify(P.steps), P.trigger || "by_hand", P.priority || 50, key, key === "major_donor" ? 500000 : null]);
    }
  }

  // PARITY-1 Part D — GROUPS AND TWO RUNNING JOURNEYS. Three groups: one by
  // rule (Mid-level donors, worked out live from the gifts) and two kept by
  // hand with a handful of people each. The first-year journey above is the
  // "first ever gift" one and is already Running; the second watches the gala
  // hosts group, so adding somebody to it starts their welcome. Written once
  // per seed: the teardown clears both tables with the org.
  console.log("[seed] groups, and a journey for joining one…");
  {
    await q(`INSERT INTO audiences (id,org_id,name,description,segment,kind,rules,created_by,created_by_name)
             VALUES ('grp_b72_mid',$1,'Mid-level donors','Everyone giving $1,000 to $9,999 over the last 12 months.','{"mode":"group"}'::jsonb,'dynamic','{"level":"mid"}'::jsonb,'u_b72demo','Dana Reyes'),
                    ('grp_b72_hosts',$1,'Gala table hosts','The people who fill a table at the Harbor Lights Gala.','{"mode":"group"}'::jsonb,'static',NULL,'u_b72demo','Dana Reyes'),
                    ('grp_b72_board',$1,'Board prospects','People Dana thinks could join the board in the next two years.','{"mode":"group"}'::jsonb,'static',NULL,'u_b72demo','Dana Reyes')`, [ORG]);
    const hosts = await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND COALESCE(kind,'') NOT IN ('organisation','anonymous')
                             AND total_giving >= 2500 ORDER BY total_giving DESC, id OFFSET 6 LIMIT 6`, [ORG]);
    const board = await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND COALESCE(kind,'') NOT IN ('organisation','anonymous')
                             AND stage = 'cultivate' AND total_giving >= 1000 ORDER BY total_giving DESC, id LIMIT 4`, [ORG]);
    for (const [gid, people] of [["grp_b72_hosts", hosts], ["grp_b72_board", board]]) {
      for (const d of people) {
        await q(`INSERT INTO group_members (org_id,group_id,donor_id,added_by,added_by_name) VALUES ($1,$2,$3,'u_b72demo','Dana Reyes')
                 ON CONFLICT (group_id, donor_id) DO NOTHING`, [ORG, gid, d.id]);
      }
    }
    const steps = [
      { type: "thank", label: "Call to thank them for hosting", offsetDays: 2, draft: null },
      { type: "send", label: "Send the table host pack", offsetDays: 7, draft: null },
      { type: "follow_up", label: "Check in the week before the gala", offsetDays: 30, draft: null },
    ];
    await q(`INSERT INTO cultivation_templates
               (id,org_id,name,description,steps,trigger_key,priority,journey_enabled,ever_enabled,trigger_filters,created_by,created_by_name)
             VALUES ('ct_b72_hosts',$1,'Welcome, table hosts','When somebody joins the gala table hosts, thank them and get them ready.',$2::jsonb,
                     'joined_group',40,true,true,'{"groupId":"grp_b72_hosts"}'::jsonb,'u_b72demo','Dana Reyes')`, [ORG, JSON.stringify(steps)]);
    await q(`UPDATE cultivation_templates SET ever_enabled = true WHERE org_id=$1 AND journey_enabled = true`, [ORG]);
    console.log(`[seed] groups: Mid-level donors (by rule), Gala table hosts (${hosts.length}), Board prospects (${board.length}); two journeys running`);
  }

  await require("./seed/parity2-events").seedParity2Events(q, ORG);   // PARITY-2 Part 3: the event pages
  await require("./seed/parity2-auction").seedParity2Auction(q, { ORG });   // PARITY-2 Part 4
  await require("./seed/clean1-mess").seedClean1Mess(q, ORG, { TODAY });   // CLEAN-1 Part 6: Data health has something to show
  await require("./seed/prospect1-prospects").seedProspect1(q, ORG, { TODAY });   // PROSPECT-1 Part 7: believable prospects
  await require("./seed/parity4-dinner").seedParity4Dinner(q, ORG, { TODAY });   // PARITY-4 Part 4: tonight's supper, half seated, five in

  // ENGAGE-1 — every person's two scores, computed LAST, from everything the
  // seed just wrote, by the same function the server runs nightly. It takes
  // `?` placeholders; this adapter numbers them for this client.
  {
    const E = require("../engagement");
    const qq = (sql, args = []) => { let n = 0; return q(sql.replace(/\?/g, () => `$${++n}`), args); };
    const scored = await E.recomputeOrgScores(qq, ORG, TODAY);
    console.log(`[seed] engagement and generosity scored for ${scored} people`);
  }
  // FIX-22 · BIRTHDAYS. Stored and now shown (the profile's At a glance line,
  // and "Birthdays this week" on Home), so the demo carries some: about one
  // person in eight, spread through the year by their place in the list, and
  // three in the coming week (the biggest giver among them) so Home has the
  // item on the day it is seeded. No randomness: the same file every run.
  {
    const rows = await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND COALESCE(deceased,false)=false
                          ORDER BY total_giving DESC, id`, [ORG]);
    const soon = [1, 3, 5].map(n => orgTime.addDays(TODAY, n));
    let n = 0;
    for (let i = 0; i < rows.length; i++) {
      let m, d;
      if (i < 3) { m = Number(soon[i].slice(5, 7)); d = Number(soon[i].slice(8, 10)); }
      else if (i % 8 === 0) { m = 1 + ((i * 7) % 12); d = 1 + ((i * 11) % 28); }
      else continue;
      await q(`UPDATE donors SET birth_month=$1, birth_day=$2 WHERE id=$3 AND org_id=$4`, [m, d, rows[i].id, ORG]);
      n++;
    }
    console.log(`[seed] birthdays on file for ${n} people, three of them this week`);
  }
  await require("./seed/prospect1-prospects").checkProspect1(q, ORG);   // PROSPECT-1: the words are the ones promised
  await require("./seed/prospect1-prospects").checkKnowsBest(q, ORG);   // FIX-22: a name under who knows them best

  // PARITY-3 6b — ANALYZE what the seed just wrote. Without it Postgres plans
  // from no statistics, guesses one row per table, and the Mid group page took
  // 31.8 seconds on a fresh seed (0.13 after). The same list the server runs
  // after every import (middleware/analyzeAfterImport.js).
  {
    const { TABLES } = require("../middleware/analyzeAfterImport");
    for (const t of TABLES) {
      try { await q(`ANALYZE ${t}`); } catch (e) { console.warn(`[seed] ANALYZE ${t}: ${e.message}`); }
    }
    console.log(`[seed] analysed ${TABLES.length} tables so the first filter is planned from real counts`);
  }

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

// FIX-25 · EVERYONE HAS A MAILING ADDRESS. The bulk insert wrote a city for
// one person in twelve and a street for nobody, so "Prepare an address update
// file" found 34 mailable people out of 1,217 and the change-of-address demo
// had nothing to send. Each person on the North Shore gets a street and a ZIP,
// written the standard US way (so Addresses to tidy is unchanged), and each
// one is a different street number, so no two people share an address and the
// duplicate finder sees no new pairs. No rnd() here: drawing from the stream
// would move every later random choice in the seed.
const NORTH_SHORE = [["Salem", "01970"], ["Beverly", "01915"], ["Marblehead", "01945"], ["Danvers", "01923"],
  ["Peabody", "01960"], ["Swampscott", "01907"], ["Gloucester", "01930"], ["Manchester", "01944"]];
const NORTH_SHORE_ZIP = Object.fromEntries(NORTH_SHORE);
const STREETS = ["Essex St", "Lafayette St", "Derby St", "Federal St", "Bridge St", "Chestnut St", "Broad St", "Highland Ave",
  "Summer St", "Pleasant St", "Elm St", "Maple Ave", "Cabot St", "Hale St", "Atlantic Ave", "Ocean Ave", "Pickering St",
  "Boston St", "North St", "Winter St", "Front St", "Water St", "Union St"];
function mailingAddress(d, i) {
  if (d.city && (d.state !== "MA" || !NORTH_SHORE_ZIP[d.city])) return { address: null, zip: null, city: d.city, state: d.state };
  const [city, zip] = d.city ? [d.city, NORTH_SHORE_ZIP[d.city]] : NORTH_SHORE[i % NORTH_SHORE.length];
  return { address: `${3 + 2 * Math.floor(i / STREETS.length)} ${STREETS[i % STREETS.length]}`, zip, city, state: "MA" };
}

// PARITY-4 Part 1 · CARDS THE BANK UPDATED. Five of the monthly givers had a
// card replaced at the network this year, written as the webhook writes it: a
// card_auto_updated recovery event and the line on their timeline. Every fifth
// subscription, spaced through the year, no rnd() so the stream is unchanged.
async function seedCardUpdates(q, monthly) {
  const yearStart = `${TODAY.slice(0, 4)}-01-01`;
  let n = 0;
  for (const [k, m] of monthly.entries()) {
    if (k % 5 !== 2 || n >= 5) continue;
    let on = orgTime.addDays(TODAY, -(12 + n * 37));
    if (on < yearStart) on = yearStart;
    const last4 = String(2000 + ((k * 6007) % 8000)).slice(-4);
    const exp = `${String(1 + (k * 7) % 12).padStart(2, "0")}/${String(Number(TODAY.slice(2, 4)) + 3 + (k % 2))}`;
    await q(`INSERT INTO payment_recovery_events (id, org_id, donor_id, subscription_id, type, stripe_event_id, detail, created_at)
             VALUES ($1,$2,$3,$4,'card_auto_updated',$5,$6::jsonb,$7::date + time '10:00')`,
            [`pre_b72_au${n + 1}`, ORG, m.donorId, `sub_demo_b72_${pad(k + 1)}`, `evt_demo_b72_au${n + 1}`, JSON.stringify({ last4, exp }), on]);
    await q(`UPDATE recurring_subscriptions SET card_last4=$1, card_exp_month=$2, card_exp_year=$3 WHERE id=$4 AND org_id=$5`,
            [last4, Number(exp.slice(0, 2)), 2000 + Number(exp.slice(3)), m.subId, ORG]);
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES ($1,$2,$3,'note',$4,$5,'system:stripe-webhook','Stripe (online)')`,
            [`int_b72_au${n + 1}`, ORG, m.donorId, `Card updated by the bank, ends ${last4}, exp ${exp}. Their monthly gift carries on with no action needed.`, on]);
    n++;
  }
  console.log(`[seed] ${n} cards updated by the bank this year`);
}

// PARITY-4 Part 2 · GIFTS STARTED AND NOT FINISHED. Four people who chose an
// amount on Harborlight's own form, gave an email and stopped (three this
// month, so the month's total has something to open), and one donor who
// started and then gave, so "Finished later" shows a row linked to the gift.
async function seedGiftStarts(q) {
  const [org] = await q(`SELECT org_slug FROM orgs WHERE id=$1`, [ORG]);
  const [page] = await q(`SELECT id, slug, title FROM giving_pages WHERE org_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [ORG]);
  const form = page ? { id: page.id, name: page.title, path: `/give/${org.org_slug}/${page.slug}` } : { id: null, name: "Giving page", path: `/give/${org.org_slug}` };
  const day = TODAY.slice(8, 10) === "01" ? 0 : 1;
  const STARTS = [
    ["gs_b72_1", "Imani", "Okafor", "imani.okafor@example.demo", 100, "once", 0, "4 hours", true],
    ["gs_b72_2", "Theo", "Lindqvist", "theo.lindqvist@example.demo", 25, "monthly", day, "1 day", false],
    ["gs_b72_3", "Rosalind", "Achebe", "rosalind.achebe@example.demo", 250, "once", day, "2 hours", true],
    ["gs_b72_4", "Marcus", "Bellweather", "marcus.bellweather@example.demo", 50, "once", 12, "3 hours", true],
  ];
  for (const [id, first, last, email, amount, freq, daysAgo, hrs, expired] of STARTS) {
    await q(`INSERT INTO gift_starts (id, org_id, giving_page_id, form_name, form_path, amount, frequency, email, first_name, last_name, started_at, expired_at, created_by, created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW() - ($11 || ' days')::interval - ($12)::interval, CASE WHEN $13 THEN NOW() - ($11 || ' days')::interval ELSE NULL END,
                     'system:give-form','Giving form')`,
            [id, ORG, form.id, form.name, form.path, amount, freq, email, first, last, String(daysAgo), hrs, expired]);
  }
  const [gave] = await q(`SELECT d.id, d.name, d.email, MAX(g.date) AS last FROM donors d JOIN gifts g ON g.donor_id=d.id AND g.org_id=d.org_id
                           WHERE d.org_id=$1 AND d.email IS NOT NULL AND d.email <> '' AND d.deleted_at IS NULL
                           GROUP BY d.id, d.name, d.email HAVING MAX(g.date) BETWEEN $2 AND $3 ORDER BY MAX(g.date) DESC, d.id LIMIT 1`,
                         [ORG, orgTime.addDays(TODAY, -20), TODAY]);
  if (gave) {
    const [first, ...rest] = gave.name.split(" ");
    await q(`INSERT INTO gift_starts (id, org_id, giving_page_id, form_name, form_path, amount, frequency, email, first_name, last_name, started_at, created_by, created_by_name)
             VALUES ('gs_b72_5',$1,$2,$3,$4,100,'once',$5,$6,$7, ($8::date - 1) + time '19:00', 'system:give-form','Giving form')`,
            [ORG, form.id, form.name, form.path, gave.email, first, rest.join(" "), gave.last]);
  }
  console.log(`[seed] ${STARTS.length} gifts started and not finished, ${gave ? 1 : 0} finished later`);
}

async function writeAll(client, donors, gifts) {
  console.log(`[seed] writing ${donors.length} donors, ${gifts.length} gifts…`);
  const B = 500;
  for (let i = 0; i < donors.length; i += B) {
    const batch = donors.slice(i, i + B);
    const vals = [], params = [];
    batch.forEach((d, k) => {
      const o = k * 12;
      const m = mailingAddress(d, i + k);
      vals.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10},$${o+11},$${o+12})`);
      params.push(d.id, ORG, d.name, d.email, d.status || "new", d.stage || "prospect",
                  m.city || null, m.state || null, d.officer || null,
                  d.officer ? (d.officer === "u_b72demo_off" ? "Priya Raman" : "Dana Reyes") : null,
                  m.address, m.zip);
    });
    await client.query(
      `INSERT INTO donors (id,org_id,name,email,status,stage,city,state,assigned_to,assigned_to_name,address,zip)
       VALUES ${vals.join(",")}`, params);
  }
  // FIX-3 C — each gift says how it came, in the fields the real writers
  // use: an online gift is what the Stripe webhook writes (type cash, Card,
  // a payment id — the seed's are all pi_demo_…, never a real charge — and
  // the webhook's actor); an offline gift is the director's cheque, ACH,
  // stock or DAF entry.
  // FIX-11 Part 3 — FOUR THINGS EVERY GIFT NOW CARRIES, because the August
  // export was correct and unusable without them:
  //
  //   · A FUND. Every gift in this seed had `fund_id` NULL — all 3,942 of
  //     them — because the seed writes gifts in bulk and bypasses recordGift,
  //     which is the one place that assigns the unrestricted fund. So the
  //     bookkeeper's "TOTALS BY FUND" had exactly one line, called "(no
  //     fund)", and it footed, which is how it went unnoticed.
  //   · A PROCESSING FEE on card money. Twenty-six card gifts in August and
  //     no fee line anywhere, so the file's total could never equal what
  //     reached the bank. Stripe's published rate, 2.2% + 30c.
  //   · A CHEQUE NUMBER on the cheques. Not all of them: a real file has gaps,
  //     and a seed where every cheque has a number would hide the screen's
  //     "a cheque with no number" flag.
  //   · THE DEPOSIT it arrived in. A cheque or cash gift arrives on a deposit
  //     sheet, dated the day it was banked; card money arrives in a payout two
  //     days later. Without these the deposits file has nothing to group by.
  const COLS = ["id", "org_id", "donor_id", "amount", "date", "type", "campaign", "campaign_id", "payment_method",
                "stripe_payment_id", "recurring_subscription_id", "notes", "quid_pro_quo_value", "quid_pro_quo_desc",
                "fund_id", "processor_fee_amount", "check_number", "deposited_on", "deposit_ref",
                "created_by", "created_by_name"];
  // The funds this org keeps, read once. Restricted money follows its campaign
  // where the seed named one; everything else is unrestricted, which is what
  // recordGift would have decided.
  const fundRows = await client.query(
    `SELECT id, name, restricted FROM fin_funds WHERE org_id = $1 ORDER BY restricted, name`, [ORG]);
  const unrestricted = (fundRows.rows.find(f => !f.restricted) || fundRows.rows[0] || {}).id || null;
  const fundByWord = w => {
    const hit = fundRows.rows.find(f => w && String(f.name).toLowerCase().includes(w));
    return hit ? hit.id : null;
  };
  const scholarship = fundByWord("scholar");
  const addDays = (d, n) => {
    const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  // Stripe's published card rate. One place, so the fee and the net cannot
  // drift apart.
  const CARD_FEE = (amount) => Math.round((Number(amount) * 0.022 + 0.30) * 100) / 100;
  let chequeNo = 1041;
  for (let i = 0; i < gifts.length; i += B) {
    const batch = gifts.slice(i, i + B);
    const vals = [], params = [];
    batch.forEach((g, k) => {
      const o = k * COLS.length;
      vals.push(`(${COLS.map((_, c) => `$${o + c + 1}`).join(",")})`);
      const method = g.online ? ["cash", "Card"] : (g.method || ["check", "Check"]);
      const isCard = method[1] === "Card";
      const isCheque = method[1] === "Check";
      const notes = g.notes || (g.online ? "Online gift via the giving page" : null);
      // A scholarship gift goes to the scholarship fund where there is one;
      // the paddle raise says so in its own note.
      const fundId = g.fundId || ((scholarship && /scholarship/i.test(String(notes || "") + String(g.campaign || "")))
        ? scholarship : unrestricted);
      // Two in three cheques carry a number, which is roughly what a real
      // deposit slip looks like.
      const cheque = isCheque && (k % 3 !== 2) ? String(chequeNo++) : null;
      // Card money settles into a payout two days later, one payout per day.
      // Cheques and cash are banked the day they were recorded.
      const depositedOn = isCard ? addDays(g.date, 2) : g.date;
      const depositRef = isCard ? `po_demo_${depositedOn.replace(/-/g, "")}` : `sheet:${g.date}`;
      params.push(g.id, ORG, g.donorId, g.amount, g.date, method[0], g.campaign || null, g.campaignId || null, method[1],
                  g.online ? `pi_demo_${g.id}` : null, g.sub || null,
                  cheque ? [notes, `Check ${cheque}`].filter(Boolean).join(" · ") : notes,
                  g.qpq || null, g.qpqDesc || null,
                  fundId, isCard ? CARD_FEE(g.amount) : 0, cheque, depositedOn, depositRef,
                  g.online ? "system:stripe-webhook" : "u_b72demo", g.online ? "Stripe (online)" : "Dana Reyes");
    });
    await client.query(`INSERT INTO gifts (${COLS.join(",")}) VALUES ${vals.join(",")}`, params);
  }
  // Stock and in-kind gifts are revenue and never reached a bank, so they
  // carry NO deposit at all. The deposits file lists them separately and the
  // assertion checks they are not inside one.
  await client.query(
    `UPDATE gifts SET deposited_on = NULL, deposit_ref = NULL, processor_fee_amount = 0
      WHERE org_id = $1 AND LOWER(COALESCE(type,'')) IN ('stock','in kind','in-kind','in_kind','securities')`,
    [ORG]);
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
//
// FIX-23: the tables and their foreign keys come from pg_catalog, not
// information_schema (which hides any table the connecting role holds no
// privilege on, while the foreign-key check on the org row still sees it).
// The deletes run children first, by the foreign-key graph, so the order is
// right by construction rather than by retrying. A refusal now names the
// table and constraint that still points at the org.
async function teardownPlan(q) {
  const tables = (await q(
    `SELECT c.relname AS t FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
      WHERE n.nspname = current_schema() AND c.relkind IN ('r','p') AND NOT c.relispartition AND c.relname <> 'orgs'
      ORDER BY 1`)).map(r => r.t);
  const scoped = new Set(tables);
  // Every foreign key in the schema: which table points at which, and what a
  // delete of the parent does to the child (a = no action, r = restrict,
  // c = cascade, n = set null, d = set default).
  const fks = await q(
    `SELECT k.conname, cc.relname AS child, pc.relname AS parent, k.confdeltype AS on_delete,
            (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a
              WHERE a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey)) AS cols
       FROM pg_constraint k
       JOIN pg_class cc ON cc.oid = k.conrelid JOIN pg_namespace cn ON cn.oid = cc.relnamespace
       JOIN pg_class pc ON pc.oid = k.confrelid
      WHERE k.contype = 'f' AND cn.nspname = current_schema()
      ORDER BY 1`);
  // A row that can block a demo row's delete but has no org_id to pin it by:
  // a blocking key (no action / restrict) from a table outside the org scope
  // into orgs or into an org-scoped table. The teardown cannot reach it.
  const uncovered = fks.filter(f => (f.parent === "orgs" || scoped.has(f.parent))
    && f.child !== "orgs" && !scoped.has(f.child) && (f.on_delete === "a" || f.on_delete === "r"));
  // Children before parents: a table goes once no other undeleted scoped
  // table holds a blocking key into it. A cycle (two tables pointing at each
  // other) is left for the retry passes, in name order.
  const blocks = new Map(tables.map(t => [t, new Set()]));   // parent → children that must go first
  for (const f of fks)
    if (scoped.has(f.child) && scoped.has(f.parent) && f.child !== f.parent && (f.on_delete === "a" || f.on_delete === "r"))
      blocks.get(f.parent).add(f.child);
  const order = [], done = new Set();
  let left = [...tables];
  while (left.length) {
    const ready = left.filter(t => [...blocks.get(t)].every(c => done.has(c)));
    if (!ready.length) { order.push(...left); break; }
    for (const t of ready) { order.push(t); done.add(t); }
    left = left.filter(t => !done.has(t));
  }
  return { tables, order, fks, uncovered };
}

// One transaction, the org row locked first: while the teardown runs, the
// live server cannot write a new row that points at the org (an insert's key
// check needs a share lock the FOR UPDATE holds off), so nothing lands
// between the last table's DELETE and the org's. Each DELETE sits in its own
// savepoint so a failure is retried, not fatal. A teardown that cannot finish
// rolls back whole: the old demo stays as it was, and the refusal says why.
async function teardownOrg(q, orgId, { exit = true } = {}) {
  const { order, fks, uncovered } = await teardownPlan(q);
  const step = async (sql, params) => {
    await q(`SAVEPOINT td`);
    try { const rows = await q(sql, params); await q(`RELEASE SAVEPOINT td`); return { rows }; }
    catch (error) { await q(`ROLLBACK TO SAVEPOINT td`); await q(`RELEASE SAVEPOINT td`); return { error }; }
  };
  await q(`BEGIN`);
  let msg;
  try {
    await q(`SET LOCAL lock_timeout = '30s'`);   // a held lock is reported, not waited on forever
    await q(`SELECT id FROM orgs WHERE id=$1 FOR UPDATE`, [orgId]);
    let pending = order;
    const lastError = {};
    for (let pass = 0; pass < 10 && pending.length; pass++) {
      const retry = [];
      for (const t of pending) {
        const { error } = await step(`DELETE FROM "${t}" WHERE org_id=$1`, [orgId]);
        if (error) { retry.push(t); lastError[t] = error; }
      }
      if (retry.length === pending.length) break;
      pending = retry;
    }
    const { error: orgError } = await step(`DELETE FROM orgs WHERE id=$1`, [orgId]);
    const [left] = await q(`SELECT COUNT(*)::int AS n FROM orgs WHERE id=$1`, [orgId]);
    if (!left.n) { await q(`COMMIT`); return { ok: true }; }
    // Say exactly what still points at the org: every key into orgs that a
    // remaining row holds, with its count, then the error Postgres gave.
    const lines = [];
    for (const f of fks.filter(f => f.parent === "orgs" && !f.cols.includes(","))) {
      const { rows, error } = await step(`SELECT COUNT(*)::int AS n FROM "${f.child}" WHERE "${f.cols}" = $1`, [orgId]);
      if (error) { lines.push(`  ${f.child}.${f.cols} — could not be read (${error.message}), constraint ${f.conname}`); continue; }
      const n = rows[0].n;
      if (n) lines.push(`  ${f.child}.${f.cols} — ${n} row(s), constraint ${f.conname}`);
    }
    for (const t of pending) {
      const e = lastError[t] || {};
      lines.push(`  DELETE FROM ${t} failed: ${e.message || "?"}${e.constraint ? ` (constraint ${e.constraint}${e.table ? ` on ${e.table}` : ""})` : ""}`);
    }
    for (const f of uncovered) lines.push(`  ${f.child}.${f.cols} → ${f.parent} has no org_id to pin by (constraint ${f.conname})`);
    msg = `the teardown could not remove org ${orgId}, and rolled back (nothing was deleted).\n`
      + (orgError ? `  DELETE FROM orgs: ${orgError.message}${orgError.detail ? ` — ${orgError.detail}` : ""}`
          + `${orgError.constraint ? ` [table ${orgError.table || "?"}, constraint ${orgError.constraint}]` : ""}\n` : "")
      + (lines.length ? lines.join("\n") : "  (no remaining row points at it; the org row itself refused)");
  } catch (e) {
    msg = `the teardown of org ${orgId} failed and rolled back (nothing was deleted): ${e.message}`;
  }
  await q(`ROLLBACK`).catch(() => {});
  if (!exit) return { ok: false, message: msg };
  console.error(`\nREFUSED: ${msg}\n`);
  process.exit(1);
}

module.exports = { DRIFTED, SHAPE, GALA, ORG, ADMIN_EMAIL, ADMIN_PASSWORD, SEEDED_USER_EMAILS, removeRealPeople, teardownPlan, teardownOrg };

// Only run when invoked directly — tests/demo-shape.test.js requires this file
// for DRIFTED/SHAPE and must not trigger a seed by importing it.
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
