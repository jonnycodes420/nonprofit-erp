// FIX-49 Part 5 · the Workflows recipes still running become journeys, and stop.
const bcrypt = require("bcryptjs");
const { ok, api, q, login, civilToday } = require("../helpers");

const SEED = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_f49w_${SEED}`;

module.exports = async function run() {
  console.log("\n§W workflows become journeys");
  const email = `f49w-${SEED}@example.org`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,emails_enabled,staff_mail_enabled)
           VALUES ($1,'Fix 49 Workflows',$2,1,'active','team','America/New_York',NOW(),false,true,NULL)`, [ORG, `f49w-${SEED}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`,
    [`u_${ORG}`, ORG, email, bcrypt.hashSync("loadtest1234", 4)]);
  const tok = await login(email);
  const list = await api("GET", "/workflows", tok);
  ok("§W the recipes are there to turn on", Array.isArray(list.body) && list.body.length >= 7, list.status);
  // Five recipes running the way an org left them before AGENT-5.
  await q(`UPDATE workflows SET enabled=true WHERE org_id=$1 AND recipe_key IN ('failed_recurring_recovery','new_donor_welcome','major_gift_alert','lapsing_reengage','instant_gift_thanks')`, [ORG]);
  await q(`UPDATE workflows SET config='{"threshold":2500}'::jsonb WHERE org_id=$1 AND recipe_key='major_gift_alert'`, [ORG]);
  const sw = await api("POST", "/workflows/run-sweeps", tok, {});
  ok("§W the sweep runs", sw.status === 200, sw.body);

  const conv = await q(`SELECT recipe_key, outcome, journey_id FROM workflow_conversions WHERE org_id=$1`, [ORG]);
  const by = Object.fromEntries(conv.map(r => [r.recipe_key, r]));
  for (const k of ["failed_recurring_recovery", "new_donor_welcome", "major_gift_alert", "lapsing_reengage"])
    ok(`§W ${k} became a journey`, by[k] && by[k].outcome === "converted" && by[k].journey_id, by[k] || conv);
  ok("§W the team's gift alert is kept, and listed with its reason", by.instant_gift_thanks && by.instant_gift_thanks.outcome === "kept", by.instant_gift_thanks);
  const wfs = await q(`SELECT recipe_key, enabled FROM workflows WHERE org_id=$1 AND enabled=true`, [ORG]);
  ok("§W the converted recipes stopped (only the gift alert is still on)", wfs.length === 1 && wfs[0].recipe_key === "instant_gift_thanks", wfs);
  const js = await q(`SELECT trigger_key, trigger_amount_cents, journey_enabled, steps, created_by FROM cultivation_templates WHERE org_id=$1 AND archived_at IS NULL`, [ORG]);
  const jt = Object.fromEntries(js.map(j => [j.trigger_key, j]));
  ok("§W the journeys run on the same events", ["recurring_failed", "first_gift", "gift_over", "lapsed"].every(t => jt[t] && jt[t].journey_enabled === true), js.map(j => j.trigger_key));
  ok("§W the major-gift journey keeps the recipe's $2,500", jt.gift_over && Number(jt.gift_over.trigger_amount_cents) === 250000, jt.gift_over);
  ok("§W every journey is stamped with a system actor", js.every(j => String(j.created_by).startsWith("system:")), js.map(j => j.created_by));
  ok("§W no journey step sends: a step with words only drafts them",
    js.every(j => (j.steps || []).every(s => s.type !== "auto_send" && s.autoSend !== true)), js.map(j => j.steps));

  // A second pass changes nothing.
  await api("POST", "/workflows/run-sweeps", tok, {});
  const again = await q(`SELECT COUNT(*)::int AS n FROM cultivation_templates WHERE org_id=$1`, [ORG]);
  ok("§W converting twice makes no second journey", again[0].n === js.length, again[0].n);

  // The recipe no longer fires; the journey starts instead.
  const d = await api("POST", "/donors", tok, { name: "Rosa Lind", email: `rosa-${SEED}@example.org` });
  const donorId = d.body && (d.body.id || (d.body.donor && d.body.donor.id));
  const sim = await api("POST", "/workflows/simulate", tok, { trigger: "gift_received", donorId, amount: 50, isFirstGift: true, dedupKey: `f49w:${SEED}` });
  ok("§W the old first-gift recipe does not fire", sim.status === 200 && !(sim.body.ran || []).some(r => r.recipeKey === "new_donor_welcome"), sim.body);
  const g = await api("POST", `/donors/${donorId}/gifts`, tok, { amount: 50, date: civilToday(), method: "check" });
  ok("§W a first gift is recorded", g.status === 200 || g.status === 201, g.body);
  let plan = [];
  for (let i = 0; i < 20 && !plan.length; i++) {
    plan = await q(`SELECT p.template_id FROM cultivation_plans p WHERE p.org_id=$1 AND p.donor_id=$2`, [ORG, donorId]);
    if (!plan.length) await new Promise(r => setTimeout(r, 250));
  }
  ok("§W ...and starts the first-gift journey the recipe became", plan.some(p => p.template_id === by.new_donor_welcome.journey_id), plan);

  // Turning a convertible recipe on by its old route makes it a journey too.
  await q(`UPDATE workflows SET enabled=false WHERE org_id=$1 AND recipe_key='quiet_past_pattern'`, [ORG]);
  const [pd] = await q(`SELECT id FROM workflows WHERE org_id=$1 AND recipe_key='failed_recurring_recovery'`, [ORG]);
  const put = await api("PUT", `/workflows/${pd.id}`, tok, { enabled: true });
  const [after] = await q(`SELECT enabled FROM workflows WHERE id=$1`, [pd.id]);
  ok("§W turning a recipe on again leaves it off and points at its journey", put.status === 200 && after.enabled === false && put.body.journeyId, put.body);
};
