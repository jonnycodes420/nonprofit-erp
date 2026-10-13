// POLISH-1 parts 5 and 6 — one fixture org, never the demo.
//
// Thirty people with three years of gifts, every one of them with cents, so
// a bare decimal anywhere on a main screen has something to print. Last
// month carries exactly the month-close problems the PREMIUM-1 walk saw:
// gifts with no payment method, gifts with no fund (none here has a fund),
// and checks with no number. One assigned owner on nobody, so the 3-year
// comparison's "Assigned to" column is empty on every row.
const bcrypt = require("bcryptjs");

const ORG = "org_polish1_p567";
const ADMIN = "admin@polish1-p567.test";

async function wipe(q) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) return;
  }
}

// The first and last civil day of last month, in the org's zone.
function lastMonth(today) {
  const [y, m] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mm = String(pm).padStart(2, "0");
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(last).padStart(2, "0")}`, mid: `${py}-${mm}-10` };
}

async function build(h) {
  const { q, api } = h;
  await wipe(q);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Polish One Money Fixture','polish1-p567',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_polish1_p567',$1,$2,$3,'Polish Admin','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 4)]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name)
           SELECT 'd_p567_' || i, $1, 'Polish Person ' || lpad(i::text, 2, '0'), 'p' || i || '@polish1-p567.test', 'steward', 'system:test', 'test'
             FROM generate_series(1, 30) i`, [ORG]);
  // Three years of gifts, every amount with cents, paid by card with a method.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,created_by,created_by_name)
           SELECT 'g_p567_' || i || '_' || k, $1, 'd_p567_' || i, 1234.56 + i * 10 + k * 0.25,
                  to_char(CURRENT_DATE - (k * 200 + i * 3 + 40), 'YYYY-MM-DD'), 'Card', 'system:test', 'test'
             FROM generate_series(1, 30) i, generate_series(0, 4) k`, [ORG]);
  const [{ today }] = await q(`SELECT to_char(NOW() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS today`);
  const lm = lastMonth(today);
  // Last month's problems, with the walk's own amounts.
  const add = (id, donor, amount, method, check) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,check_number,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'system:test','test')`, [id, ORG, donor, amount, lm.mid, method, check]);
  await add("g_p567_nomethod_1", "d_p567_1", 50.00, null, null);
  await add("g_p567_nomethod_2", "d_p567_2", 25.00, null, null);
  await add("g_p567_nomethod_3", "d_p567_3", 12.50, null, null);           // three with no method: $87.50
  await add("g_p567_check_1", "d_p567_4", 4647.00, "Check", null);
  await add("g_p567_check_2", "d_p567_5", 3000.00, "Check", "");         // two checks, no number: $7,647.00
  const tok = await h.login(ADMIN);
  return { ORG, ADMIN, tok, today, lastMonth: lm };
}

module.exports = { ORG, ADMIN, build, wipe };
