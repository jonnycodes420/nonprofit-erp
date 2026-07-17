// BUILD-05 load-test seeder — synthetic mid-size org for LOCAL benchmarking.
//
// NEVER run against production. Guard below refuses any DATABASE_URL that
// doesn't point at localhost.
//
// Seeds (deterministic, seeded PRNG — same data every run):
//   org_loadtest  "Riverbend Community Trust" — 25,000 donors, ~200,000 gifts
//                 (power-law: few majors, long tail), ~150,000 interactions,
//                 500 recurring subscriptions, 50 grants, 20 funds,
//                 20 campaigns, dates spread over 6 years.
//   org_smalltest "Willow Lane Shelter" — ~300 donors / ~2,000 gifts /
//                 ~1,500 interactions, to measure noisy-neighbor effects.
//   org_importtest — empty (impact plan), target for the 25k-row
//                 import-combined timing run.
//
// The at_risk/milestone sequences are pre-created PAUSED so the server's
// hourly autoEnroll doesn't churn in the background during latency runs —
// scripts/loadtest.js activates them explicitly for the job-timing phase.
//
// Usage: DATABASE_URL=postgresql://user@localhost:5544/steward_loadtest node scripts/seed-loadtest.js
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const DB_URL = process.env.DATABASE_URL || "";
if (!/localhost|127\.0\.0\.1/.test(DB_URL)) {
  console.error("Refusing to seed: DATABASE_URL must point at localhost (got: " + (DB_URL || "unset") + ")");
  process.exit(1);
}
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

// ── Deterministic PRNG (mulberry32) ─────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260716);
const pick = arr => arr[Math.floor(rand() * arr.length)];
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

let idCounter = 0;
const nextId = prefix => `${prefix}_lt${(idCounter++).toString(36).padStart(6, "0")}`;

const FIRST = ["James","Mary","Robert","Patricia","John","Jennifer","Michael","Linda","David","Elizabeth","William","Barbara","Richard","Susan","Joseph","Jessica","Thomas","Sarah","Charles","Karen","Maria","Nancy","Daniel","Lisa","Matthew","Betty","Anthony","Margaret","Mark","Sandra","Donald","Ashley","Steven","Kimberly","Paul","Emily","Andrew","Donna","Joshua","Michelle","Kenneth","Carol","Kevin","Amanda","Brian","Dorothy","George","Melissa","Timothy","Deborah"];
const LAST = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores","Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts"];
const EMPLOYERS = ["Microsoft","Google","Apple","Boeing","Starbucks","Home Depot","Bank of America","Johnson & Johnson","Intel","Costco", "Riverbend Medical", "Cascade Insurance", "", "", "", "", "", "", "", ""];
const CITIES = [["Portland","OR","97201"],["Seattle","WA","98101"],["Boise","ID","83702"],["Eugene","OR","97401"],["Tacoma","WA","98402"],["Spokane","WA","99201"],["Bend","OR","97701"],["Salem","OR","97301"]];
const STAGES = ["prospect","qualify","cultivate","solicit","steward","lapsed"];
const INTERACTION_TYPES = ["call","meeting","email","note","stewardship","email_open","email","call"];

const TODAY = new Date("2026-07-16T12:00:00Z");
const DAY = 86400000;
const dstr = d => new Date(d).toISOString().slice(0, 10);

// ── Bulk insert helper: one multi-row INSERT per chunk ──────────────────────
async function bulkInsert(table, columns, rows, chunkSize) {
  const chunk = chunkSize || Math.max(1, Math.floor(60000 / columns.length));
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const tuples = slice.map(row => {
      const ph = row.map(v => { params.push(v); return `$${params.length}`; });
      return `(${ph.join(",")})`;
    });
    await pool.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")}`, params);
  }
  console.log(`  ${table}: +${rows.length}`);
}

async function seedOrg({ orgId, orgName, slug, donorCount, giftTarget, interactionTarget, recurringCount, grantCount, fundCount, campaignCount, adminEmail, staffCount }) {
  console.log(`Seeding ${orgId} (${donorCount} donors, ~${giftTarget} gifts)...`);
  const hash = bcrypt.hashSync("loadtest1234", 10);

  await pool.query(
    `INSERT INTO orgs (id, name, mission, onboarding_complete, org_slug, plan, subscription_status, receipts_enabled, legal_name, ein, receipt_address, recurring_dunning_enabled)
     VALUES ($1,$2,$3,1,$4,'impact','active',true,$2,'47-1234567','100 Main St, Portland, OR 97201',true)
     ON CONFLICT (id) DO NOTHING`,
    [orgId, orgName, "Synthetic load-test org — safe to delete", slug]
  );

  const users = [];
  users.push([`u_${slug}_admin`, orgId, adminEmail, hash, "Loadtest Admin", "admin"]);
  for (let i = 1; i <= staffCount; i++) {
    users.push([`u_${slug}_mgo${i}`, orgId, `mgo${i}@${slug}.test`, hash, `MGO ${i}`, "staff"]);
  }
  await bulkInsert("users", ["id", "org_id", "email", "password_hash", "name", "role"], users);
  const userIds = users.map(u => u[0]);
  const userNames = users.map(u => u[4]);

  // Funds & campaigns
  const fundRows = [], campaignRows = [];
  for (let i = 0; i < fundCount; i++) fundRows.push([nextId("fund"), orgId, `Fund ${i + 1}`, i % 3 === 0]);
  for (let i = 0; i < campaignCount; i++) campaignRows.push([nextId("c"), orgId, `Campaign ${i + 1}`, "appeal", "sent"]);
  if (fundCount) await bulkInsert("fin_funds", ["id", "org_id", "name", "restricted"], fundRows);
  if (campaignCount) await bulkInsert("campaigns", ["id", "org_id", "name", "type", "status"], campaignRows);
  const fundIds = fundRows.map(r => r[0]);
  const campaignIds = campaignRows.map(r => r[0]);

  // Grants
  if (grantCount) {
    const grantRows = [];
    for (let i = 0; i < grantCount; i++) {
      const deadline = dstr(TODAY.getTime() + randInt(-200, 400) * DAY);
      grantRows.push([nextId("g"), orgId, `Foundation ${i + 1}`, `Program ${1 + (i % 5)}`, randInt(5, 250) * 1000, pick(["prospecting", "loi_sent", "submitted", "awarded", "declined"]), deadline]);
    }
    await bulkInsert("grants", ["id", "org_id", "funder", "program", "amount", "status", "deadline"], grantRows);
  }

  // ── Donors with power-law giving ──────────────────────────────────────────
  // tier: 1% major (10–60 gifts), 9% mid (5–20), 60% small (1–8), 30% one-time/none
  const donors = [];   // objects; SQL rows built after gifts computed
  for (let i = 0; i < donorCount; i++) {
    const r = rand();
    let tier, giftN;
    if (r < 0.01) { tier = "major"; giftN = randInt(10, 60); }
    else if (r < 0.10) { tier = "mid"; giftN = randInt(5, 20); }
    else if (r < 0.70) { tier = "small"; giftN = randInt(1, 8); }
    else { tier = "one"; giftN = rand() < 0.85 ? 1 : 0; }
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const hasEmail = rand() < 0.9;
    const [city, state, zip] = pick(CITIES);
    donors.push({
      id: nextId("d"), name,
      email: hasEmail ? `donor${i}@${slug}.test` : null,
      phone: rand() < 0.5 ? `503-555-${String(randInt(0, 9999)).padStart(4, "0")}` : null,
      tier, giftN,
      employer: rand() < 0.35 ? pick(EMPLOYERS) : "",
      city, state, zip,
      assigned: pick(userIds),
      gifts: [],
    });
  }

  // ── Gifts: dates spread over 6 years, amounts by tier ────────────────────
  const giftRows = [];
  const sixYearsMs = 6 * 365 * DAY;
  const totalPlanned = donors.reduce((s, d) => s + d.giftN, 0);
  const scale = giftTarget / Math.max(1, totalPlanned);
  for (const d of donors) {
    const n = Math.max(d.giftN > 0 ? 1 : 0, Math.round(d.giftN * scale));
    for (let k = 0; k < n; k++) {
      const when = TODAY.getTime() - Math.floor(rand() * sixYearsMs);
      let amount;
      if (d.tier === "major") amount = randInt(1000, 25000);
      else if (d.tier === "mid") amount = randInt(250, 2500);
      else amount = randInt(25, 500);
      const date = dstr(when);
      const online = rand() < 0.3;
      const recent = (TODAY.getTime() - when) < 60 * DAY;
      d.gifts.push({ date, amount });
      giftRows.push([
        nextId("gf"), orgId, d.id, amount, date, "cash",
        rand() < 0.5 ? pick(campaignIds) || null : null,
        rand() < 0.6 ? pick(fundIds) || null : null,
        online ? `pi_${nextId("x")}` : null,
        // most gifts acknowledged; ~40% of recent ones not yet (feeds queue buckets)
        recent ? rand() < 0.6 : true,
        false,
      ]);
    }
  }
  // ── Donor rows with aggregates derived from their real gifts ─────────────
  // (donors must insert before gifts — FK)
  const donorRows = donors.map(d => {
    d.gifts.sort((a, b) => a.date < b.date ? -1 : 1);
    const total = d.gifts.reduce((s, g) => s + g.amount, 0);
    const last = d.gifts[d.gifts.length - 1];
    const first = d.gifts[0];
    let stage;
    if (!d.gifts.length) stage = pick(["prospect", "prospect", "qualify"]);
    else {
      const daysSince = (TODAY.getTime() - new Date(last.date).getTime()) / DAY;
      if (daysSince > 365) stage = "lapsed";
      else if (daysSince < 90) stage = "steward";
      else stage = pick(["cultivate", "cultivate", "cultivate", "solicit", "qualify"]);
    }
    const status = total >= 20000 ? "major" : total >= 5000 ? "mid" : stage === "lapsed" ? "lapsed" : "new";
    const uIdx = userIds.indexOf(d.assigned);
    return [
      d.id, orgId, d.name, d.email, d.phone, status, stage,
      total, last ? last.amount : 0, last ? last.date : null,
      d.gifts.length, "[]", d.employer, d.city, d.state, d.zip,
      d.assigned, userNames[uIdx], first ? first.date : null, false,
    ];
  });
  await bulkInsert("donors", ["id", "org_id", "name", "email", "phone", "status", "stage", "total_giving", "last_gift_amount", "last_gift_date", "gift_count", "tags", "employer", "city", "state", "zip", "assigned_to", "assigned_to_name", "first_gift_date", "is_sample"], donorRows);
  await bulkInsert("gifts", ["id", "org_id", "donor_id", "amount", "date", "type", "campaign_id", "fund_id", "stripe_payment_id", "acknowledgement_sent", "is_sample"], giftRows);

  // ── Interactions: weighted toward bigger donors, 6-year spread ───────────
  const interactionRows = [];
  const weighted = donors.filter(d => d.gifts.length > 0);
  for (let i = 0; i < interactionTarget; i++) {
    // bias toward the front of the array is avoided by random pick; weight by tier
    let d = pick(weighted);
    if (d.tier === "one" && rand() < 0.6) d = pick(weighted);
    const type = pick(INTERACTION_TYPES);
    const when = TODAY.getTime() - Math.floor(rand() * sixYearsMs);
    interactionRows.push([
      nextId("i"), orgId, d.id, type,
      type === "email_open" ? "Opened campaign email" : `${type} with donor — routine touchpoint`,
      dstr(when), pick(userIds),
    ]);
  }
  await bulkInsert("interactions", ["id", "org_id", "donor_id", "type", "note", "date", "created_by"], interactionRows);

  // ── Recurring subscriptions: mostly active, a few at-risk (inert dunning) ─
  if (recurringCount) {
    const subRows = [];
    const subDonors = donors.filter(d => d.gifts.length > 1).slice(0, recurringCount);
    subDonors.forEach((d, i) => {
      const atRisk = i < Math.floor(recurringCount * 0.05);
      subRows.push([
        nextId("rs"), orgId, d.id, `sub_${nextId("x")}`, `cus_${nextId("x")}`,
        randInt(10, 500), "month",
        atRisk ? (i % 2 ? "past_due" : "recovering") : "active",
        atRisk ? randInt(1, 4) : 0,
        atRisk ? new Date(TODAY.getTime() - 20 * DAY).toISOString() : null,
        atRisk ? 4 : 0, null, // dunning exhausted → engine won't email
      ]);
    });
    await bulkInsert("recurring_subscriptions", ["id", "org_id", "donor_id", "stripe_subscription_id", "stripe_customer_id", "amount", "interval", "status", "failure_count", "first_failed_at", "dunning_step", "next_dunning_at"], subRows);
  }

  // ── Tasks (some overdue), pending drafts/reminders → realistic queue ─────
  const taskRows = [];
  const taskDonors = donors.filter(d => d.gifts.length).slice(0, 500);
  taskDonors.forEach((d, i) => {
    taskRows.push([nextId("t"), orgId, `Follow up with ${d.name}`, dstr(TODAY.getTime() + randInt(-30, 30) * DAY), "medium", "donor", i % 3 === 0 ? 0 : 1, d.id]);
  });
  if (taskRows.length) await bulkInsert("tasks", ["id", "org_id", "title", "due", "priority", "type", "done", "donor_id"], taskRows);

  const draftRows = [];
  for (let i = 0; i < Math.min(20, donors.length); i++) {
    const d = donors[i * 7 % donors.length];
    draftRows.push([nextId("md"), orgId, d.id, `threshold_1000`, `Celebrating your generosity, ${d.name.split(" ")[0]}`, "Draft body", "pending_review"]);
  }
  await bulkInsert("milestone_drafts", ["id", "org_id", "donor_id", "milestone_key", "subject", "body", "status"], draftRows);

  // ── Goal + impact metrics ─────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO fundraising_goals (id, org_id, period_start, period_end, goal_type, goal_amount, label)
     VALUES ($1,$2,$3,$4,'total_raised',500000,'Raise $500k this fiscal year')`,
    [nextId("goal"), orgId, "2026-07-01", "2027-06-30"]
  );
  await pool.query(
    `INSERT INTO impact_metrics (id, org_id, name, dollar_threshold, outcome_template, active)
     VALUES ($1,$2,'Meals served',25,'{amount} funds {n} meals',true)`,
    [nextId("im"), orgId]
  );

  // ── Pre-create at_risk + milestone sequences PAUSED (see header note) ─────
  for (const trig of ["at_risk", "milestone"]) {
    const seqId = nextId("seq");
    await pool.query(
      `INSERT INTO sequences (id, org_id, name, trigger, status) VALUES ($1,$2,$3,$4,'paused')`,
      [seqId, orgId, `Loadtest ${trig}`, trig]
    );
    await pool.query(
      `INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES ($1,$2,0,0,'(AI-drafted per donor)','')`,
      [nextId("ss"), seqId]
    );
  }

  console.log(`  done: ${orgId}`);
}

(async () => {
  const t0 = Date.now();
  // Idempotency: refuse to double-seed
  const existing = await pool.query("SELECT id FROM orgs WHERE id IN ('org_loadtest','org_smalltest','org_importtest')");
  if (existing.rows.length) {
    console.error("Load-test orgs already present — drop the DB and re-run for a clean seed.");
    process.exit(1);
  }

  await seedOrg({
    orgId: "org_loadtest", orgName: "Riverbend Community Trust", slug: "riverbend",
    donorCount: 25000, giftTarget: 200000, interactionTarget: 150000,
    recurringCount: 500, grantCount: 50, fundCount: 20, campaignCount: 20,
    adminEmail: "admin@riverbend.test", staffCount: 4,
  });

  await seedOrg({
    orgId: "org_smalltest", orgName: "Willow Lane Shelter", slug: "willow",
    donorCount: 300, giftTarget: 2000, interactionTarget: 1500,
    recurringCount: 20, grantCount: 5, fundCount: 3, campaignCount: 3,
    adminEmail: "admin@willow.test", staffCount: 1,
  });

  // Empty org for the import-combined timing run
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await pool.query(
    `INSERT INTO orgs (id, name, onboarding_complete, org_slug, plan, subscription_status)
     VALUES ('org_importtest','Import Timing Org',1,'importtest','impact','active')`);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ('u_importtest_admin','org_importtest','admin@importtest.test',$1,'Import Admin','admin')`, [hash]);

  await pool.query("ANALYZE");
  const counts = await pool.query(`
    SELECT (SELECT COUNT(*) FROM donors WHERE org_id='org_loadtest') AS donors,
           (SELECT COUNT(*) FROM gifts WHERE org_id='org_loadtest') AS gifts,
           (SELECT COUNT(*) FROM interactions WHERE org_id='org_loadtest') AS interactions`);
  console.log("org_loadtest totals:", counts.rows[0]);
  console.log(`Seed complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
