// FIX-2 B — the Reports fixture org, shared by tests/fix2-b-reports.test.js and
// scripts/fix2-b-capture-exports.js (the before/after export byte capture).
//
// org_fx2b is its own org: never the demo, never org_creo. Dates are derived
// from the server's own fiscal year so the fixture never ages. Amounts are
// chosen so a report shows BOTH shapes the brief names: a whole-dollar gift
// ($24,500, which must read "$24,500", not "$24,500.00") and one with cents
// ($140.50, which must keep them).
const bcrypt = require("bcryptjs");
const { q, login, api } = require("./helpers");

const ORG = "org_fx2b";
const EMAIL = "reports@fx2b.example.org";
const PW = "loadtest1234";

const CHILD_TABLES = ["saved_report_sends", "saved_reports", "memberships", "membership_levels", "recurring_subscriptions",
  "pledges", "opportunities", "gift_soft_credits", "fin_transactions", "interactions", "threads", "tasks", "gifts",
  "donors", "users", "budgets", "accounts", "fin_funds", "fin_audit_log"];

async function reset() {
  for (const t of CHILD_TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

// Returns { tok, y, people } where y is the current fiscal year's start year.
async function seed() {
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address,timezone,timezone_confirmed_at)
           VALUES ($1,'Reports Fixture Trust','org-fx2b',1,'team','active','1 Main St, Lexington, KY 40507','America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx2b',$1,$2,$3,'Rae Porter','admin')`,
    [ORG, EMAIL, bcrypt.hashSync(PW, 4)]);
  const tok = await login(EMAIL, PW);
  const fy = (await api("GET", "/reports/giving-summary?yearMode=fiscal", tok)).body;
  const y = Number(fy.from.slice(0, 4));            // this FY runs y-07-01 .. (y+1)-06-30
  const inThis = `${y}-08-15`, inLast = `${y - 1}-11-15`, inLast2 = `${y - 1}-12-02`, inEarlier = `${y - 2}-10-10`;
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_fx2b_gen',$1,'General Fund',false),('ff_fx2b_barn',$1,'Barn Fund',true)`, [ORG]);
  // [id, name, gifts: [date, amount, fund]]
  const people = [
    ["fx2b_ada", "Ada Whitlock", [[inLast, 24500, "ff_fx2b_gen"]]],                                 // LYBUNT, whole dollars
    ["fx2b_ben", "Ben Okafor", [[inLast, 140.5, "ff_fx2b_barn"], [inLast2, 60, "ff_fx2b_gen"]]],   // LYBUNT, cents
    ["fx2b_cy", "Cy Marsh", [[inThis, 1200, "ff_fx2b_gen"]]],                                       // first-time this year
    ["fx2b_di", "Di Laurent", [[inEarlier, 300, "ff_fx2b_barn"]]],                                  // SYBUNT only
    ["fx2b_ed", "Ed Brandt", [[inEarlier, 1000, "ff_fx2b_gen"], [inLast, 1400, "ff_fx2b_gen"]]],    // LYBUNT + SYBUNT
    ["fx2b_fay", "Fay Hollis", [[inLast, 500, "ff_fx2b_gen"], [inThis, 750.25, "ff_fx2b_barn"]]],   // gave both years
  ];
  for (const [id, name, gifts] of people) {
    const total = gifts.reduce((s, g) => s + g[1], 0);
    const dates = gifts.map(g => g[0]).sort();
    await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,gift_count,first_gift_date,last_gift_date,tags)
             VALUES ($1,$2,$3,$4,'cultivate',$5,$6,$7,$8,'[]')`,
      [id, ORG, name, `${id}@fx2b.example.org`, total, gifts.length, dates[0], dates[dates.length - 1]]);
    for (const [i, [date, amount, fund]] of gifts.entries())
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id) VALUES ($1,$2,$3,$4,$5,'cash',$6)`,
        [`g_${id}_${i}`, ORG, id, amount, date, fund]);
  }
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status) VALUES ('pl_fx2b_1',$1,'fx2b_fay',2000,$2,'open')`, [ORG, `${y + 1}-03-01`]);
  // One saved report, so "Your saved reports" has something in it.
  const saved = await api("POST", "/saved-reports", tok, { name: "Big givers", shared: true,
    definition: { entity: "people", columns: ["name", "lifetime", "last_gift_date"], filter: { op: "and", rules: [{ field: "lifetime", cmp: "gt", value: 1000 }] } } });
  return { tok, y, people, savedId: saved.body.id, from: fy.from, to: fy.to };
}

module.exports = { ORG, EMAIL, PW, seed, reset };
