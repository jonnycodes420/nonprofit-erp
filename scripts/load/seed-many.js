// SCALE-1 · two hundred synthetic orgs on a LOCAL database, from a fixed seed.
//
//   20 large  · 25,000 donors · 150,000 gifts · Stripe, QuickBooks, Gmail and
//               a Givebutter giving source connected (the stand-ins answer them)
//   80 medium ·  5,000 donors ·  30,000 gifts
//  100 small  ·    800 donors ·   4,000 gifts
//
// Every value is a hash of (org, row, salt), never Math.random, so the same
// command builds the same database. Dates are relative to the day it runs, so
// LYBUNT, Drift and "this year" do real work. Rows are generated inside
// Postgres with generate_series: 5 million gifts in a few minutes.
//
// Refuses anything but a loopback database. Never run it against prod.
//
//   DATABASE_URL=postgresql://steward@localhost:5546/steward_scale1 \
//   STEWARD_CREDENTIAL_KEY=… node scripts/load/seed-many.js [--orgs 200] [--fresh]
//
// The server must have booted against the database once first (it builds the
// schema). Sign in as admin@<slug>.load / loadtest1234.
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const DB_URL = process.env.DATABASE_URL || "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL)) {
  console.error("Refusing to seed: DATABASE_URL must point at localhost (got: " + (DB_URL || "unset") + ")");
  process.exit(1);
}
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const ORG_LIMIT = Number(arg("--orgs", 200));
const FRESH = process.argv.includes("--fresh");
const pool = new Pool({ connectionString: DB_URL, ssl: false, max: 6 });

// The fixed plan. Index 0..19 large, 20..99 medium, 100..199 small.
const TIERS = [
  { tier: "large", count: 20, donors: 25000, gifts: 150000, interactions: 75000, tasks: 400, subs: 250, users: 4 },
  { tier: "medium", count: 80, donors: 5000, gifts: 30000, interactions: 12000, tasks: 120, subs: 40, users: 2 },
  { tier: "small", count: 100, donors: 800, gifts: 4000, interactions: 1500, tasks: 30, subs: 5, users: 1 },
];
function plan() {
  const out = []; let n = 0;
  for (const t of TIERS) for (let i = 0; i < t.count; i++, n++) {
    out.push({ ...t, n, id: `org_load${String(n).padStart(3, "0")}`, slug: `load${String(n).padStart(3, "0")}`,
      name: `${t.tier[0].toUpperCase() + t.tier.slice(1)} Load Org ${n}` });
  }
  return out.slice(0, ORG_LIMIT);
}

// r(i, salt): a float in [0,1) from the row number and a salt, in SQL.
const R = (i, salt) => `((hashint8((${i})::bigint * 7919 + ${salt}) & 2147483647)::float8 / 2147483648.0)`;
const WHO = "system:load/seed-many";

async function seedOrg(o, hash) {
  const t0 = Date.now();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL synchronous_commit = off");
    // The FIX-21 trap: rows this transaction just wrote have no statistics, so
    // the planner thinks the org is one row and a nested loop goes quadratic.
    await c.query("SET LOCAL enable_nestloop = off");
    const big = o.tier === "large";
    await c.query(
      `INSERT INTO orgs (id, name, mission, onboarding_complete, org_slug, plan, subscription_status, receipts_enabled,
         legal_name, ein, receipt_address, recurring_dunning_enabled, emails_enabled, is_demo_org, timezone, ai_enabled,
         stripe_account_id, stripe_connected, stripe_connected_at, qbo_sync_enabled, qbo_auto_sync, onboarded_at, org_kind)
       VALUES ($1,$2,'SCALE-1 synthetic load org',1,$3,'team','active',true,$2,'47-0000000','100 Main St, Mobile, AL 36602',
         true,false,false,$4,true,$5,$6,$7,$6,$6,NOW(),'customer')`,
      [o.id, o.name, o.slug, ["America/Chicago", "America/New_York", "America/Denver"][o.n % 3],
       big ? `acct_load${o.n}` : null, big, big ? new Date().toISOString() : null]);
    const users = [[`u_${o.slug}_admin`, `admin@${o.slug}.load`, "Load Admin", "admin"]];
    for (let i = 1; i < o.users; i++) users.push([`u_${o.slug}_s${i}`, `staff${i}@${o.slug}.load`, `Staff ${i}`, "staff"]);
    for (const [id, email, name, role] of users) {
      await c.query(`INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, o.id, email, hash, name, role]);
    }
    const userIds = users.map(u => u[0]);
    // Funds, campaigns, the ledger account recordGift stamps against.
    await c.query(`INSERT INTO fin_funds (id, org_id, name, restricted)
                   SELECT $1 || '_f' || g, $1, 'Fund ' || g, g % 3 = 0 FROM generate_series(1, 6) g`, [o.id]);
    await c.query(`INSERT INTO campaigns (id, org_id, name, type, status)
                   SELECT $1 || '_c' || g, $1, 'Appeal ' || g, 'appeal', 'sent' FROM generate_series(1, 8) g`, [o.id]);
    await c.query(`INSERT INTO accounts (id, org_id, code, name, type, subtype)
                   VALUES ($1 || '_a4010', $1, '4010', 'Contributions', 'revenue', 'contribution')`, [o.id]);
    // Donors. Names from two short lists, emails unique per org.
    await c.query(`
      INSERT INTO donors (id, org_id, name, email, phone, status, stage, tags, city, state, zip, assigned_to,
                          created_at, is_sample, created_by, created_by_name, person_types)
      SELECT $1 || '_d' || i, $1,
             (ARRAY['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth','Maria','Daniel','Grace','Ellis'])[1 + floor(${R("i", 11)} * 14)::int]
             || ' ' || (ARRAY['Smith','Johnson','Guillory','Broussard','Nguyen','Garcia','Miller','Davis','Landry','Thibodeaux','Martin','Lee','Walker','Hebert'])[1 + floor(${R("i", 12)} * 14)::int],
             CASE WHEN ${R("i", 13)} < 0.9 THEN 'd' || i || '@' || $2 || '.example' END,
             CASE WHEN ${R("i", 14)} < 0.5 THEN '251-555-' || lpad((i % 10000)::text, 4, '0') END,
             'new', 'cultivate', '[]',
             (ARRAY['Mobile','Daphne','Fairhope','Biloxi','Gulfport','Pensacola'])[1 + floor(${R("i", 15)} * 6)::int], 'AL', '36602',
             ($3::text[])[1 + (i % ${userIds.length})],
             NOW() - (floor(${R("i", 16)} * 2000) || ' days')::interval, false, '${WHO}', 'SCALE-1 seed', '["donor"]'
        FROM generate_series(1, $4::int) i`, [o.id, o.slug, userIds, o.donors]);
    // Gifts: donor skewed toward low indexes (a few heavy givers, a long
    // tail), amounts by a power curve, dates over six years.
    await c.query(`
      INSERT INTO gifts (id, org_id, donor_id, amount, date, type, campaign_id, fund_id, acknowledgement_sent,
                         is_sample, payment_method, created_by, created_by_name)
      SELECT $1 || '_g' || k, $1,
             $1 || '_d' || (1 + floor(power(${R("k", 21)}, 2.2) * $2::int))::int,
             round((25 + power(${R("k", 22)}, 6) * 5000)::numeric, 2),
             (CURRENT_DATE - floor(${R("k", 23)} * 2190)::int)::text,
             'cash',
             CASE WHEN ${R("k", 24)} < 0.5 THEN $1 || '_c' || (1 + (k % 8)) END,
             $1 || '_f' || (1 + (k % 6)),
             ${R("k", 25)} < 0.95, false,
             (ARRAY['check','card','card','ach','cash'])[1 + (k % 5)],
             '${WHO}', 'SCALE-1 seed'
        FROM generate_series(1, $3::int) k`, [o.id, o.donors, o.gifts]);
    // The donor's own figures come from its gifts, the way recalc would.
    await c.query(`
      UPDATE donors d SET total_giving = s.total, gift_count = s.n, last_gift_date = s.last, first_gift_date = s.first,
             last_gift_amount = s.last_amt,
             status = CASE WHEN s.total >= 20000 THEN 'major' WHEN s.total >= 5000 THEN 'mid'
                           WHEN s.last::date < CURRENT_DATE - 365 THEN 'lapsed' ELSE 'active' END,
             stage = CASE WHEN s.last::date < CURRENT_DATE - 365 THEN 'lapsed' WHEN s.last::date > CURRENT_DATE - 90 THEN 'steward' ELSE 'cultivate' END
        FROM (SELECT donor_id, SUM(amount) total, COUNT(*) n, MAX(date) last, MIN(date) first,
                     (ARRAY_AGG(amount ORDER BY date DESC))[1] last_amt
                FROM gifts WHERE org_id = $1 GROUP BY donor_id) s
       WHERE d.id = s.donor_id AND d.org_id = $1`, [o.id]);
    await c.query(`
      INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name)
      SELECT $1 || '_i' || k, $1, $1 || '_d' || (1 + floor(power(${R("k", 31)}, 1.6) * $2::int))::int,
             (ARRAY['call','meeting','email','note','email'])[1 + (k % 5)], 'Routine touch',
             (CURRENT_DATE - floor(${R("k", 32)} * 1500)::int)::text, $4, 'Load Admin'
        FROM generate_series(1, $3::int) k`, [o.id, o.donors, o.interactions, userIds[0]]);
    await c.query(`
      INSERT INTO tasks (id, org_id, title, due, priority, type, done, donor_id, created_by, created_by_name)
      SELECT $1 || '_t' || k, $1, 'Follow up', (CURRENT_DATE + ((k % 60) - 30))::text, 'medium', 'donor',
             CASE WHEN k % 3 = 0 THEN 1 ELSE 0 END, $1 || '_d' || k, '${WHO}', 'SCALE-1 seed'
        FROM generate_series(1, $2::int) k`, [o.id, o.tasks]);
    await c.query(`
      INSERT INTO recurring_subscriptions (id, org_id, donor_id, stripe_subscription_id, stripe_customer_id, amount,
                                           interval, status, failure_count, dunning_step)
      SELECT $1 || '_rs' || k, $1, $1 || '_d' || k, 'sub_' || $1 || '_' || k, 'cus_' || $1 || '_' || k,
             25 + (k % 10) * 10, 'month', 'active', 0, 0
        FROM generate_series(1, $2::int) k`, [o.id, o.subs]);
    if (big) await connect(c, o, userIds[0]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
  return Date.now() - t0;
}

// The four connections a large org has, each pointed at the stand-in by the
// *_API_BASE env the server boots with. Credentials are sealed the real way.
async function connect(c, o, adminId) {
  const { sealBag } = await import("../../shared/secretBox.js");
  const far = new Date(Date.now() + 365 * 86400000).toISOString();
  await c.query(`
    INSERT INTO mailbox_connections (id, org_id, user_id, provider, address, status, credentials_sealed,
       token_expires_at, calendar_granted, created_by, created_by_name)
    VALUES ($1,$2,$3,'google',$4,'active',$5,$6,true,'${WHO}','SCALE-1 seed')`,
    [`mbx_${o.slug}`, o.id, adminId, `admin@${o.slug}.load`,
     sealBag({ accessToken: `ya29.load-${o.slug}`, refreshToken: `1//load-${o.slug}` }, { aad: o.id }), far]);
  await c.query(`
    INSERT INTO bookkeeping_connections (id, org_id, vendor, status, realm_id, credentials_sealed, token_expires_at,
       mapping, created_by, created_by_name)
    VALUES ($1,$2,'quickbooks','active',$3,$4,$5,$6,'${WHO}','SCALE-1 seed')`,
    [`bk_${o.slug}`, o.id, `realm${o.n}`,
     sealBag({ accessToken: `qbo-${o.slug}`, refreshToken: `qbo-r-${o.slug}` }, { aad: o.id }), far,
     JSON.stringify({ qbo: { read: { auto: "true", firstSavedAt: new Date().toISOString() } } })]);
  await c.query(`
    INSERT INTO giving_sources (id, org_id, provider, display_name, status, credentials_sealed, created_by, created_by_name)
    VALUES ($1,$2,'givebutter','Givebutter','active',$3,'${WHO}','SCALE-1 seed')`,
    [`gs_${o.slug}`, o.id, sealBag({ apiKey: `gb-load-${o.slug}` }, { aad: o.id })]);
}

// HARDEN-2: tests/perf-app.spec.js seeds its one org with this same seedOrg.
module.exports = { seedOrg, pool };
if (require.main === module) (async () => {
  const t0 = Date.now();
  const orgs = plan();
  const have = (await pool.query(`SELECT id FROM orgs WHERE id LIKE 'org_load%'`)).rows.map(r => r.id);
  if (have.length && !FRESH) {
    console.error(`${have.length} load orgs already present. Pass --fresh to drop and rebuild them.`);
    process.exit(1);
  }
  if (have.length) {
    console.log(`Dropping ${have.length} load orgs...`);
    // Child tables first; the audit trigger guards only app connections.
    const tabs = (await pool.query(`SELECT table_name FROM information_schema.columns
       WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).rows.map(r => r.table_name);
    await pool.query("SET session_replication_role = replica");
    for (const t of tabs) await pool.query(`DELETE FROM ${t} WHERE org_id LIKE 'org_load%'`);
    await pool.query(`DELETE FROM orgs WHERE id LIKE 'org_load%'`);
    await pool.query("SET session_replication_role = origin");
  }
  const hash = bcrypt.hashSync("loadtest1234", 8);
  // Four at a time: the large orgs dominate, so they go first.
  const queue = orgs.slice();
  let done = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const o = queue.shift();
      const ms = await seedOrg(o, hash);
      done++;
      if (o.tier === "large" || done % 20 === 0) console.log(`  ${o.id} (${o.tier}) ${(ms / 1000).toFixed(1)}s · ${done}/${orgs.length}`);
    }
  }));
  console.log("ANALYZE...");
  await pool.query("ANALYZE");
  const [n] = (await pool.query(`SELECT (SELECT COUNT(*) FROM orgs WHERE id LIKE 'org_load%') orgs,
      (SELECT COUNT(*) FROM donors WHERE org_id LIKE 'org_load%') donors,
      (SELECT COUNT(*) FROM gifts WHERE org_id LIKE 'org_load%') gifts,
      (SELECT COUNT(*) FROM interactions WHERE org_id LIKE 'org_load%') interactions`)).rows;
  console.log("load totals:", n, `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
