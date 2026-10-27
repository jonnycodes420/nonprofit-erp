// FIX-49 · Parts 1 and 2: Jonathan's money and goal decisions (25 Oct).
//   §1 a covered-fee gift counts its full amount in Lifetime and the campaign,
//      and its net in Finance (the bookkeeper file);
//   §2 a soft credit (a credit row and someone else's gift credited) never
//      changes Lifetime or a campaign total, and shows as the Soft credit figure;
//   §3 an awarded grant counts on a campaign's public bar unless switched off;
//   §4 an organization goal reads its own start and end on Home and Fundraising;
//   §5 a parent goal adds its own gifts and its children's, each gift once;
//   §6 the checker holds the org to every rule above.
// Runs against a booted server ($BASE). Called by tests/fix49-decisions.test.js.
const bcrypt = require("bcryptjs");
const { ok, api, q, login, civilToday, civilPlusDays } = require("../helpers");

const SEED = require("crypto").randomBytes(4).toString("hex");
const PREFIX = "org_f49a_";
const PW = bcrypt.hashSync("loadtest1234", 4);
const sys = "'system:test','test'";

async function wipe(like) {
  const tables = await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`);
  for (let pass = 0; pass < 3; pass++) for (const t of tables) await q(`DELETE FROM ${t.table_name} WHERE org_id LIKE $1`, [like]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id LIKE $1`, [like]).catch(() => {});
}

module.exports = async function run() {
  console.log(`\nfix49 money and goals · seed ${SEED}`);
  await wipe(`${PREFIX}%`);
  const today = civilToday();
  const org = `${PREFIX}${SEED}`, email = `f49a-${SEED}@example.org`, slug = `f49a-${SEED}`;
  // A January year, so a gift forty days ago is inside "this year" but outside the goal's own dates.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,stripe_account_id,stripe_connected,vocabulary_json,emails_enabled,staff_mail_enabled)
           VALUES ($1,'Fix49 money',$2,1,'active','team','America/New_York',NOW(),false,$3,true,'{"fiscal_year_start_month":1}',true,NULL)`, [org, slug, `acct_${org}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [`u_${org}`, org, email, PW]);
  const tok = await login(email);
  const person = async name => {
    const id = `d_${org}_${name.replace(/\W/g, "").toLowerCase()}`;
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,${sys})`, [id, org, name, `${id}@example.org`]);
    return id;
  };
  const camp = async (name, goal, parent = null) => {
    const id = `c_${org}_${name.replace(/\W/g, "").toLowerCase()}`;
    await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,start_date,end_date,parent_goal_id,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
      [id, org, name, goal, civilPlusDays(-90), civilPlusDays(90), parent]);
    return id;
  };
  const gift = async (donor, amount, date, campaignId, extra = {}) => {
    const r = await api("POST", `/donors/${donor}/gifts`, tok, { amount, date, campaignId, ...extra });
    if (r.status >= 300) console.log("  gift refused", r.status, r.body);
    return (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2 AND amount=$3 ORDER BY created_at DESC LIMIT 1`, [org, donor, amount]))[0]?.id;
  };
  const figs = async id => ((await api("GET", `/donors/${id}`, tok)).body || {}).figures || {};
  const goals = async () => (await api("GET", "/fundraising/overview", tok)).body || {};
  const goalOf = async id => ((await goals()).goals || []).find(g => g.id === id) || {};

  const rose = await person("Rose Alder"), tom = await person("Tom Birch");
  const spring = await camp("Spring appeal", 5000);

  // ── §1 cover the fee ────────────────────────────────────────────────────
  console.log("\n§1 a $103.20 gift with $3.20 of fee the donor covered");
  const g1 = await gift(rose, 103.2, civilPlusDays(-3), spring);
  await q(`UPDATE gifts SET cover_fee_amount=3.20, processor_fee_amount=3.20, processor_fee_source='stripe' WHERE id=$1 AND org_id=$2`, [g1, org]);
  await q(require("../../donorSummary").DONOR_SUMMARY_UPDATE(), [org]);
  let f = await figs(rose);
  ok("§1 Lifetime counts the full $103.20", f.lifetime && f.lifetime.value === 103.2, f.lifetime);
  ok("§1 the campaign counts the full $103.20", (await goalOf(spring)).raised === 103.2, (await goalOf(spring)).raised);
  const bk = (await api("GET", `/reports/bookkeeper?from=${civilPlusDays(-30)}&to=${today}`, tok)).body || {};
  const bkRow = (bk.rows || []).find(r => r.giftId === g1) || {};
  ok("§1 Finance's bookkeeper file has the gift at $103.20 with a net of $100.00", bkRow.cents === 10320 && bkRow.netCents === 10000, bkRow);

  // ── §2 soft and matching credits ────────────────────────────────────────
  console.log("\n§2 a matching credit row and a soft credit on Rose's gift");
  const tomBefore = await figs(tom);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign_id,created_by,created_by_name) VALUES ($1,$2,$3,500,$4,'matching gift credit',$5,${sys})`,
    [`g_${org}_match`, org, tom, civilPlusDays(-2), spring]);
  await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,role,created_by,created_by_name) VALUES ($1,$2,$3,$4,50,'recommender',${sys})`,
    [`sc_${org}_1`, org, g1, tom]);
  await q(require("../../donorSummary").DONOR_SUMMARY_UPDATE(), [org]);
  f = await figs(tom);
  ok("§2 Tom's Lifetime is unchanged by the credits", (f.lifetime && f.lifetime.value) === (tomBefore.lifetime && tomBefore.lifetime.value), [tomBefore.lifetime, f.lifetime]);
  ok("§2 ...and so is his stored total", (await q(`SELECT total_giving::text AS t FROM donors WHERE id=$1`, [tom]))[0].t === "0.00");
  ok("§2 the campaign is still $103.20", (await goalOf(spring)).raised === 103.2, (await goalOf(spring)).raised);
  ok("§2 Tom's Soft credit figure is $550 (the match and the credit on Rose's gift)", f.softCredit && f.softCredit.value === 550, f.softCredit);
  const scRows = (await api("GET", `/figures/donor-soft-credit/rows?donor=${tom}&pageSize=50`, tok)).body || {};
  ok("§2 ...and it opens the two gifts behind it", (scRows.rows || []).length === 2, scRows);

  // ── §3 grants on the public bar ─────────────────────────────────────────
  console.log("\n§3 a $1,000 grant awarded toward the campaign");
  await q(`INSERT INTO grants (id,org_id,funder,amount,status,campaign_id,awarded_at,created_by,created_by_name) VALUES ($1,$2,'Harbor Fund',1000,'awarded',$3,NOW(),${sys})`, [`gr_${org}`, org, spring]);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,status,campaign_id) VALUES ($1,$2,'spring','Spring appeal','active',$3)`, [`gp_${org}`, org, spring]);
  let lastBar = null;
  const bar = async () => { const r = await api("GET", `/org/${slug}/giving-page/spring/public`); lastBar = [r.status, r.body && r.body.givingPage]; return lastBar[1] && lastBar[1].campaignRaised; };
  ok("§3 the public bar counts the gifts and the grant ($1,103.20)", (await bar()) === 1103.2, lastBar);
  const put = await api("PUT", `/fundraising/campaigns/${spring}`, tok, { name: "Spring appeal", goalAmount: 5000, startDate: civilPlusDays(-90), endDate: civilPlusDays(90), grantsOffPublicBar: true });
  ok("§3 \"Leave grants off the public bar\" saves", put.status === 200, put.body);
  ok("§3 ...and the public bar is the gifts only ($103.20)", (await bar()) === 103.2, await bar());
  ok("§3 the admin card still counts the grant", (await goalOf(spring)).raised === 1103.2, (await goalOf(spring)).raised);

  // ── §4 a goal's period is its own dates ─────────────────────────────────
  console.log("\n§4 a $2,000 goal running 10 days ago to 20 days from now");
  await gift(rose, 40, civilPlusDays(-40), null);
  await q(`INSERT INTO fundraising_goals (id,org_id,period_start,period_end,goal_type,goal_amount,label) VALUES ($1,$2,$3,$4,'total_raised',2000,'Autumn goal')`,
    [`fg_${org}`, org, civilPlusDays(-10), civilPlusDays(20)]);
  const home = (await api("GET", "/goals/active", tok)).body || {};
  const fund = (await goals()).goal || {};
  ok("§4 Home counts the gifts inside the goal's own dates ($103.20)", home.currentAmount === 103.2, home.currentAmount);
  ok("§4 Fundraising counts the same gifts ($103.20)", fund.currentAmount === 103.2, fund.currentAmount);
  ok("§4 ...over the goal's own dates", fund.periodStart === civilPlusDays(-10) && fund.periodEnd === civilPlusDays(20), [fund.periodStart, fund.periodEnd]);

  // ── §5 parent goals ─────────────────────────────────────────────────────
  console.log("\n§5 a parent goal with $100 given to it and $200 to its child");
  const parent = await camp("Building fund", 10000);
  const child = await camp("Roof", 4000, parent);
  await gift(tom, 100, civilPlusDays(-1), parent);
  await gift(tom, 200, civilPlusDays(-1), child);
  const pg = await goalOf(parent);
  ok("§5 the parent counts its own $100 and the child's $200 ($300)", pg.rolledRaised === 300, pg.rolledRaised);
  const rr = (await api("GET", `/figures/goal-rollup-raised/rows?campaign=${parent}&pageSize=50`, tok)).body || {};
  ok("§5 its drawer opens those two gifts, each once", (rr.rows || []).length === 2 && Math.round((rr.rows || []).reduce((s, r) => s + Number(r.amount), 0)) === 300, rr.rows);
  ok("§5 the child is still $200", (await goalOf(child)).raised === 200, (await goalOf(child)).raised);

  // ── §6 the checker ──────────────────────────────────────────────────────
  console.log("\n§6 the numbers checker");
  const { checkOrg } = require("../../scripts/check-numbers");
  const res = await checkOrg(org, {});
  ok("§6 the checker finds no problem in this org", res.problems.length === 0, res.problems);
  await wipe(`${PREFIX}%`);
};
