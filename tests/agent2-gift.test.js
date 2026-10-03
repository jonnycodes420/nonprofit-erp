// AGENT-2 Test 2 · "just got a gift from the sunrise foundation, 5,000 dollars"
//
// On Creo it ended "Done · 1 of 3 steps" with no gift recorded. The money stays
// human: the Agent PREPARES the gift as one card, records nothing, and the
// person's one press records it through recordGift. After that press the gift
// exists exactly once, to the cent, and the step says Done because Steward
// read the gift back. A gift that could not be recorded is Failed, never Done.
//
// WHAT WOULD MAKE THIS FAIL (planted before it was trusted):
//   · agentRunPlan marks the confirm step Done on c.giftId alone (no read-back)
//     or keeps the old Not done → "the gift step is Failed" goes red;
//   · validatePlan lets a model-planned record_gift through → "nothing recorded
//     before the press" goes red the moment a plan records on its own.
//
//   BASE=http://localhost:5601 node tests/agent2-gift.test.js
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api, civilPlusDays } = require("./helpers");

const ORG = "org_agent2g";
const ADMIN = "director@agent2g.local";
const SUN = "d_agent2g_sunrise";

(async () => {
  console.log("agent2-gift");
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Agent Two Gifts','agent2g',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_agent2g',$1,$2,$3,'Dana Director','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_agent2g',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,created_by,created_by_name) VALUES ($1,$2,'Sunrise Foundation','grants@sunrise.test','organisation','steward','system:test','test')`, [SUN, ORG]);
  const tok = await login(ADMIN);
  const gifts = async () => q(`SELECT id, amount::text AS amount FROM gifts WHERE org_id=$1 AND donor_id=$2 ORDER BY created_at`, [ORG, SUN]);

  const p = await api("POST", "/agent/instructions", tok, { text: "just got a gift from the sunrise foundation, 5,000 dollars" });
  const card = p.body.plan && p.body.plan.steps.find(s => s.tool === "record_gift");
  ok("a prepared gift card: $5,000, the Sunrise Foundation, waiting for a person", p.status === 201 && card && card.state === "confirm" && card.amountCents === 500000 && card.donorId === SUN, p.body.plan);
  ok("…the button says what she is signing", /Record \$5,000/.test(p.body.plan.confirmLabel), p.body.plan.confirmLabel);
  ok("nothing is recorded before the press", (await gifts()).length === 0);
  const run = await api("POST", `/agent/instructions/${p.body.id}/confirm`, tok, {});
  const g = await gifts();
  ok("after the one press the gift exists once, to the cent", run.status === 200 && g.length === 1 && g[0].amount === "5000.00", g);
  ok("…and its step is Done because Steward read it back", (run.body.steps || []).find(s => s.tool === "record_gift").outcome === "done", run.body.steps);
  const again = await api("POST", `/agent/instructions/${p.body.id}/confirm`, tok, {});
  ok("a second press records nothing more", again.status === 409 && (await gifts()).length === 1);

  // A gift that cannot be recorded (the giver is gone by the press) is Failed.
  const p2 = await api("POST", "/agent/instructions", tok, { text: "just got a gift from the sunrise foundation, 250 dollars" });
  ok("a second card is prepared", p2.status === 201, p2.body);
  await q(`UPDATE donors SET deleted_at=NOW() WHERE id=$1`, [SUN]);
  const r2 = await api("POST", `/agent/instructions/${p2.body.id}/confirm`, tok, {});
  const st = (r2.body && r2.body.steps) || [];
  await q(`UPDATE donors SET deleted_at=NULL WHERE id=$1`, [SUN]);
  ok("the gift step whose gift is missing is Failed, never Done", st.find(s => s.tool === "record_gift").outcome === "failed", st);
  ok("…the follow-up that waits on it did not run", st.filter(s => s.tool !== "record_gift").every(s => s.outcome !== "done"), st);
  ok("…and no $250 gift exists", (await gifts()).length === 1);

  await closeDb();
  summary("agent2-gift");
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary("agent2-gift"); });
