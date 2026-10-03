// AGENT-2 Test 1 · "ada just became a volunteer and wants to do 15 hours a week"
//
// On Creo on 3 Oct this sentence ended as a note, a "volunteer" tag, a
// "confirm which Ada" task and a draft, marked Done, with nobody on the
// Volunteers page. Now, with ONE Ada, it makes an active volunteer with 15
// hours a week (FIX-24's makeVolunteer, through the screen's own route), every
// step is Done (the welcome is a draft waiting for her, which is its done),
// the write is in the audit log with the Agent as actor and her words as the
// reason, and undo puts it all back. With TWO Adas it asks which, with each
// one's email and last gift, and changes nothing.
//
// WHAT WOULD MAKE THIS FAIL (planted before it was trusted):
//   · agentShape.volunteerSteps back to mark_volunteer + note_volunteer
//     → "a volunteer record with 15 hours a week" goes red;
//   · make_volunteer's read-back skipped (Done without looking) while the
//     route refuses → "no step is Failed or Not done" stays green but
//     "on the Volunteers page" goes red;
//   · agentCall's header not verified in middleware/auditTrail.js
//     → "the audit row names the Agent" goes red.
//
//   BASE=http://localhost:5601 node tests/agent2-volunteer.test.js
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api, civilPlusDays } = require("./helpers");

const ORG = "org_agent2v";
const ADMIN = "director@agent2v.local";
const ADA = "d_agent2v_ada", ADA2 = "d_agent2v_ada2";

async function reset() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Agent Two Volunteers','agent2v',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_agent2v',$1,$2,$3,'Dana Director','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,total_giving,gift_count,last_gift_date,last_gift_amount,created_by,created_by_name)
           VALUES ($1,$2,'Ada Petrossian','ada@agent2v.local','steward','["donor"]'::jsonb,100000,1,$3,100000,'system:test','test')`, [ADA, ORG, civilPlusDays(-30)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ('g_agent2v_ada',$1,$2,100000,$3,'system:test','test')`, [ORG, ADA, civilPlusDays(-30)]);
}

(async () => {
  console.log("agent2-volunteer");
  await reset();
  const tok = await login(ADMIN);
  const SAID = "ada just became a volunteer and wants to do 15 hours a week";

  // ── ONE ADA: it happens ───────────────────────────────────────────────
  const p = await api("POST", "/agent/instructions", tok, { text: SAID });
  ok("one Ada: a plan, not a question", p.status === 201 && p.body.plan && !p.body.which, p.body);
  const steps = (p.body.plan && p.body.plan.steps) || [];
  const mv = steps.find(s => s.tool === "make_volunteer");
  ok("the plan makes her a volunteer at 15 hours a week (not a tag and a note)",
    mv && mv.donorId === ADA && Number(mv.hoursPerWeek) === 15 && !steps.some(s => ["mark_volunteer", "note_volunteer", "add_tag", "log_note", "create_task"].includes(s.tool)), steps.map(s => s.tool));
  ok("the headline is one short sentence", p.body.plan && p.body.plan.summary.length <= 100 && (p.body.plan.summary.match(/\./g) || []).length === 1, p.body.plan && p.body.plan.summary);
  ok("nothing changed before she said yes", !(await q(`SELECT 1 FROM volunteer_applications WHERE org_id=$1`, [ORG])).length);
  const run = await api("POST", `/agent/instructions/${p.body.id}/confirm`, tok, {});
  const out = (run.body && run.body.steps) || [];
  ok("no step is Failed or Not done; the volunteer step is Done", run.status === 200 && out.length === steps.length
    && out.every(s => s.outcome === "done" || (s.tool === "draft_note" && s.outcome === "waiting"))
    && out.find(s => s.tool === "make_volunteer").outcome === "done", out);
  const [rec] = await q(`SELECT hours_per_week, status, via FROM volunteer_applications WHERE org_id=$1 AND person_id=$2`, [ORG, ADA]);
  ok("a volunteer record with 15 hours a week, on her own record, made by the Agent", rec && rec.status === "approved" && Number(rec.hours_per_week) === 15 && rec.via === "agent", rec);
  const [pt] = await q(`SELECT person_types FROM donors WHERE id=$1`, [ADA]);
  ok("she is a donor and a volunteer, one record", JSON.stringify(pt.person_types).includes("volunteer") && JSON.stringify(pt.person_types).includes("donor"), pt.person_types);
  ok("still exactly one Ada", (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`, [ORG]))[0].n === 1);
  const vg = await api("POST", "/volunteer-hub/volunteers-group", tok, {});
  const grp = await api("GET", `/figures/group-members/rows?group=${vg.body.id}&pageSize=50`, tok);
  ok("she is on the Volunteers page (the Volunteers group's own rows)", (grp.body.rows || []).some(r => r.donor_id === ADA || r.id === ADA), grp.body.rows);
  const [al] = await q(`SELECT actor_kind, user_id, user_name, summary FROM fin_audit_log WHERE org_id=$1 AND request_path LIKE $2 ORDER BY created_at DESC LIMIT 1`, [ORG, `/donors/${ADA}/make-volunteer%`]);
  ok("the audit row names the Agent as actor and her words as the reason", al && al.actor_kind === "agent" && al.user_id === "agent:approved_by:u_agent2v" && al.summary.includes(SAID), al);

  // Undo, from the writes ledger: the record goes and the roles come back.
  const writes = await q(`SELECT id FROM agent_writes WHERE org_id=$1 AND tool='make_volunteer' ORDER BY created_at DESC`, [ORG]);
  for (const w of writes) { const u = await api("POST", `/agent/writes/${w.id}/undo`, tok, {}); ok(`undo ${w.id} is accepted`, u.status === 200, u.body); }
  const [pt2] = await q(`SELECT person_types FROM donors WHERE id=$1`, [ADA]);
  ok("undo takes the volunteer record and the role back off", !(await q(`SELECT 1 FROM volunteer_applications WHERE org_id=$1`, [ORG])).length && !JSON.stringify(pt2.person_types).includes("volunteer"), pt2.person_types);

  // ── TWO ADAS: it asks, and changes nothing ────────────────────────────
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ($1,$2,'Ada Brennan','ada.b@agent2v.local','prospect','system:test','test')`, [ADA2, ORG]);
  const before = (await q(`SELECT COUNT(*)::int n FROM agent_instructions WHERE org_id=$1`, [ORG]))[0].n;
  const w = await api("POST", "/agent/instructions", tok, { text: SAID });
  const people = (w.body.which && w.body.which.people) || [];
  ok("two Adas: it asks which, with both as choices", w.status === 200 && people.length === 2 && people.some(x => x.id === ADA) && people.some(x => x.id === ADA2), w.body);
  ok("…each with their email and last gift to tell them apart", people.every(x => /@/.test(x.detail) && /(last gift|no gift on file)/.test(x.detail)), people);
  ok("…and changes nothing: no plan kept, no volunteer record",
    (await q(`SELECT COUNT(*)::int n FROM agent_instructions WHERE org_id=$1`, [ORG]))[0].n === before && !(await q(`SELECT 1 FROM volunteer_applications WHERE org_id=$1`, [ORG])).length);

  await closeDb();
  summary("agent2-volunteer");
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary("agent2-volunteer"); });
