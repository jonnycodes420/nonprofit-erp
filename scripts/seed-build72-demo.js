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
//            allowlisted scratch name, and on any org id that is not ours.
//
// Usage:  node scripts/seed-build72-demo.js
//         (DATABASE_URL + BASE default to the scratch stack)

const guard = require("./lib/prodGuard");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const orgTime = require("../orgTime");

const BASE = guard.writerBase("http://localhost:5601");
const DB = process.env.DATABASE_URL || "postgres://steward@localhost:5544/steward_loadtest";

const ORG = "org_b72demo";
const ADMIN_EMAIL = "director@harborlight.demo";
const ADMIN_PASSWORD = "demo-harbor-2026";
const TZ = process.env.DEMO_TZ || "America/New_York";

// ── Layer 3: an explicit allowlist of database names this may write to. Any
// production or Kingdom Builders name fails closed, not open.
const ALLOWED_DB = /^(steward_loadtest|steward_demo|steward_freshcheck|steward_build\w+)$/;
const FORBIDDEN_DB = /^(postgres|kb_|kingdom)/i;

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

async function main() {
  // ── Layer 0/3 — identity BEFORE anything is written ─────────────────────
  const health = guard.assertServerIdentity(BASE);          // refuses a non-steward product
  console.log(`[identity] ${BASE} → product=${health.product} database=${health.database}`);

  const client = new Client({ connectionString: DB, ssl: /localhost|127\.0\.0\.1/.test(DB) ? false : { rejectUnauthorized: false } });
  await client.connect();
  const [{ current_database: dbName }] = (await client.query("SELECT current_database()")).rows;

  const refuse = msg => { console.error(`\nREFUSED: ${msg}\n`); process.exit(1); };
  if (dbName !== health.database)
    refuse(`the server at ${BASE} reports database "${health.database}" but this connection is to "${dbName}". One of them is not what you think.`);
  if (FORBIDDEN_DB.test(dbName))
    refuse(`"${dbName}" is a production or Kingdom Builders database name. This seed writes DEMO FICTION and must never touch it.`);
  if (!ALLOWED_DB.test(dbName))
    refuse(`"${dbName}" is not an allowlisted scratch database (${ALLOWED_DB}). Failing closed.`);
  console.log(`[identity] database "${dbName}" is an allowlisted scratch target\n`);

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
  const DRIFTED = [
    ["Marguerite Ashgrove", 2500], ["Halvard Bellwether", 2000], ["Ondine Cinderhalt", 2400],
    ["Casper Dunmoor", 1800],      ["Wilhelmina Elmsworth", 3000], ["Tobias Fairweather", 2000],
    ["Rosalind Glasswick", 2200],  ["Emmett Hollowell", 1900],   ["Philippa Ironvale", 2600],
    ["Gideon Jessamine", 2000],    ["Cordelia Kettleby", 2800],
  ];
  const driftedIds = [];
  DRIFTED.forEach(([name, amt], i) => {
    const email = name.toLowerCase().replace(/ /g, ".") + "@example.demo";
    const id = addDonor(name, email, { status: "mid", stage: "cultivate",
                                      officer: i % 3 === 0 ? "u_b72demo_off" : "u_b72demo" });
    driftedIds.push(id);
    // The eleven belong to the director — they are the pitch, and they must be
    // in the portfolio of whoever is signed in during the demo.
    // Four consecutive years of giving, then silence.
    for (let y = YEAR - 4; y <= YEAR - 1; y++) {
      addGift(id, amt + (i % 3) * 100, dateIn(y, 11, 8 + (i % 14)), { campaign: "Annual Fund " + y });
      if (i % 2 === 0) addGift(id, Math.round(amt / 2), dateIn(y, 5, 12 + (i % 10)));
    }
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

  // 190 major/mid donors carrying the bulk of revenue.
  for (let i = 0; i < 190; i++) {
    const [name, email] = mkName();
    const tier = i < 25 ? "major" : "mid";
    const base = tier === "major" ? between(10000, 45000) : between(1200, 6000);
    const id = addDonor(name, email, { status: tier, stage: i % 5 === 0 ? "steward" : "cultivate",
                                       officer: i % 4 === 0 ? "u_b72demo_off" : (i % 3 === 0 ? "u_b72demo" : null) });
    for (let y = YEAR - 3; y <= YEAR; y++) {
      if (y === YEAR && i % 9 === 0) continue;          // a few quiet this year too
      addGift(id, base + between(-200, 400), dateIn(y, between(1, 12), between(1, 28)),
              { campaign: y === YEAR ? "Annual Fund " + YEAR : "Annual Fund " + y });
    }
  }
  // ~810 small donors — the tail. Present, but not the story.
  for (let i = 0; i < 810; i++) {
    const [name, email] = mkName();
    const id = addDonor(name, email, { status: "new", stage: i % 7 === 0 ? "qualify" : "prospect",
                                      pin: i % 7 === 0 });
    // Tuned so the top ~200 carry ~90% of revenue, not ~96%. A file that is
    // TOO top-heavy reads as fake to a fundraiser just as a flat one does.
    const n = between(1, 4);
    for (let k = 0; k < n; k++)
      addGift(id, between(40, 620), dateIn(between(YEAR - 3, YEAR), between(1, 12), between(1, 28)));
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
  // is visible on screen rather than theoretical.
  const centsDonor = addDonor("Araminta Wexford", "araminta.wexford@example.demo",
                              { status: "mid", stage: "cultivate" });
  addGift(centsDonor, 1234.56, dateIn(YEAR, 4, 2), { cents: true });

  await writeAll(client, donors, gifts);

  // ── Pledges: one PARTIALLY paid, one OVERPAID with a recorded surplus ────
  console.log("[seed] pledges (partial + overpaid surplus)…");
  const plPartial = "pl_b72_part", plOver = "pl_b72_over";
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,notes,campaign_id,status)
           VALUES ($1,$2,$3,10000,$4,'Capital pledge — three-year commitment','camp_b72demo','open')`,
          [plPartial, ORG, driftedIds[0], dateIn(YEAR, 12, 31)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,pledge_id,campaign)
           VALUES ('g_b72_pl1',$1,$2,4000,$3,'check',$4,'Annual Fund ' || $5)`,
          [ORG, driftedIds[0], dateIn(YEAR, 2, 20), plPartial, String(YEAR)]);
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,notes,campaign_id,status)
           VALUES ($1,$2,$3,5000,$4,'Scholarship pledge','camp_b72demo','open')`,
          [plOver, ORG, driftedIds[1], dateIn(YEAR, 9, 30)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,pledge_id)
           VALUES ('g_b72_pl2',$1,$2,5750,$3,'check',$4)`,
          [ORG, driftedIds[1], dateIn(YEAR, 5, 6), plOver]);

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
  const recurDonor = driftedIds[2];
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
             orgTime.addDays(TODAY, -(20 + i * 9))]);
  }

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

main().catch(e => { console.error(e); process.exit(1); });
