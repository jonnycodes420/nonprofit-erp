// FIX-34 · builder A · ONE MEETING, ONE ROW, AND A CALL ENDS IN A DECISION.
//
// Donor data: a booked meeting drew twice on the Calendar (the meeting and
// the next step pointing at it), put three rows for one donor on Home's
// Thread, and Mark done on the Calendar closed a call step with no "How did
// it go?" and no "What's next?".
//   §1 one booked meeting is ONE item on the Calendar for its day, and that
//      item carries the next step (thread + task) so its card can act on it.
//   §2 one booked meeting gives ONE Thread row for that donor, carrying the
//      other two steps as moreSteps; the Thread's count is donors, not steps.
//   §3 a bare tick of a call next step (the Calendar's Mark done) is refused
//      with needs_outcome; logged with a next step, the same tick finishes it.
//   §4 the same for the meeting step itself.
// What would make it fail: drop foldMeetingSteps (calendar.js) → §1 red; drop
// the per-donor grouping in composeThreads → §2 red; restore `!t.link_kind`
// on the needs_outcome guard in /tasks/:id/complete → §3/§4 red.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, login, api, q } = require("../helpers");

const ORG = "org_fix34a_one";
const TABLES = ["meeting_effects", "calendar_events", "interactions", "tasks", "threads", "donors", "users"];

async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (let i = 0; i < 25; i++) {
    const err = await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => null, e => e);
    if (!err) break;
    const t = err.table || (/on table "(\w+)"/.exec(err.message || "") || [])[1];
    if (!t || t === "orgs") throw err;
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]);
  }
}
const nyDay = ms => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

async function run() {
  await reset();
  try {
    const pw = bcrypt.hashSync("loadtest1234", 4);
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
             VALUES ($1,'Fix34 A fixture','fix34a-one',1,'active','team','America/New_York',NOW())`, [ORG]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [`u_${ORG}`, ORG, `dana@${ORG}.local`, pw]);
    const T = await login(`dana@${ORG}.local`, "loadtest1234");
    for (const [id, name] of [["d_f34a_chris", "Christopher Fixture"], ["d_f34a_ada", "Ada Fixture"], ["d_f34a_bo", "Bo Fixture"]])
      await q(`INSERT INTO donors (id,org_id,name,stage,status,tags,assigned_to,assigned_to_name,created_by,created_by_name)
               VALUES ($1,$2,$3,'active','active','[]',$4,'Dana Reyes','system:test','test')`, [id, ORG, name, `u_${ORG}`]);

    // A Wednesday at least a week out, 18:00 UTC (2pm in New York): the prep
    // lands on the Tuesday, the meeting and "How did it go?" on the Wednesday.
    let start = new Date(Date.now() + 7 * 864e5);
    while (start.getUTCDay() !== 3) start = new Date(start.getTime() + 864e5);
    start.setUTCHours(18, 0, 0, 0);
    const day = nyDay(start.getTime());
    const evId = "cev_fix34a_1";
    await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,booked_in_steward,created_by,created_by_name)
             VALUES ($1,$2,$3,'steward',$1,'Visit with Christopher',$4,$5,ARRAY['d_f34a_chris'],true,$3,'Dana Reyes')`,
      [evId, ORG, `u_${ORG}`, start.toISOString(), new Date(start.getTime() + 3600e3).toISOString()]);
    const { applyMeeting } = require("../../meetingEffects");
    const ap = await applyMeeting(evId, { actorId: `u_${ORG}`, actorName: "Dana Reyes" });
    ok("FIX-34 A · the meeting was applied (next step, prep, how did it go)", ap.applied === 1, ap);
    const [th] = await q(`SELECT id FROM threads WHERE org_id=$1 AND donor_id='d_f34a_chris' AND closed_at IS NULL`, [ORG]);

    // §1 THE CALENDAR: ONE MEETING, ONCE.
    const cal = await api("GET", `/calendar/items?from=${day}&to=${day}&types=meeting,step`, T);
    const items = (cal.body && cal.body.items) || [];
    const hits = items.filter(i => (i.ref && (i.ref.calendarEventId === evId || i.ref.threadId === (th && th.id))));
    ok("FIX-34 A §1 one booked meeting is ONE item on the Calendar for its day", cal.status === 200 && hits.length === 1 && hits[0].type === "meeting",
      items.map(i => `${i.id} ${i.title}`));
    ok("FIX-34 A §1 the meeting carries its next step (thread and task) for the card's actions",
      !!hits[0] && !!hits[0].step && hits[0].step.threadId === (th && th.id) && !!hits[0].step.taskId, hits[0]);
    ok("FIX-34 A §1 the how-did-it-go task stays on the day", items.some(i => i.type === "step" && /^How did it go with Christopher\?$/.test(i.title)), items.map(i => i.title));

    // §2 THE THREAD (HOME): ONE ROW PER DONOR, WITH THE MORE-COUNT.
    await api("POST", "/donors/d_f34a_ada/threads", T, { label: "Send the spring report", due: nyDay(Date.now() + 3 * 864e5) });
    const thr = await api("GET", "/threads?scope=all", T);
    const rows = ((thr.body && thr.body.list) || []).filter(r => r.donorId === "d_f34a_chris");
    ok("FIX-34 A §2 one booked meeting gives ONE Thread row for the donor", thr.status === 200 && rows.length === 1, (thr.body.list || []).map(r => `${r.donorName}: ${r.nextStep.label}`));
    ok("FIX-34 A §2 the row is the soonest step and carries the other two (2 more)",
      !!rows[0] && Array.isArray(rows[0].moreSteps) && rows[0].moreSteps.length === 2 && rows[0].moreSteps.every(m => String(m.due) >= String(rows[0].nextStep.due)), rows[0]);
    ok("FIX-34 A §2 the Thread counts donors, not steps", thr.body.stat && thr.body.stat.open === 2, thr.body.stat);
    const tasks = await api("GET", "/tasks?scope=all", T);
    ok("FIX-34 A §2 Tasks still lists every step (prep and how did it go)",
      tasks.status === 200 && tasks.body.filter(t => t.donor_id === "d_f34a_chris" && /^(Prep for Christopher|How did it go with Christopher)/.test(t.title)).length === 2, tasks.body.map(t => t.title));

    // §3 A CALL STEP TICKED FROM THE CALENDAR NEEDS AN OUTCOME.
    const plan = await api("POST", "/donors/d_f34a_bo/threads", T, { label: "Call about the spring visit", due: nyDay(Date.now() + 2 * 864e5) });
    const [st] = await q(`SELECT id FROM tasks WHERE org_id=$1 AND thread_id=$2 AND link_kind='next_step'`, [ORG, plan.body && plan.body.thread && plan.body.thread.id]);
    const bare = await api("POST", `/tasks/${st && st.id}/complete`, T, { done: true });
    ok("FIX-34 A §3 a bare tick of a call step is refused: say how it went and what's next", bare.status === 422 && bare.body.error === "needs_outcome", [bare.status, bare.body]);
    const conv = await api("POST", "/donors/d_f34a_bo/conversations", T, { touch: "call_reached", line: "She will come in May.", nextStep: { skipped: true } });
    const fin = await api("POST", `/tasks/${st && st.id}/complete`, T, { done: true, interactionId: conv.body && conv.body.interactionId });
    const [thBo] = await q(`SELECT closed_at, closing_interaction_id FROM threads WHERE id=$1`, [plan.body.thread.id]);
    ok("FIX-34 A §3 with No next step, the same tick finishes it and the step closes on her line",
      conv.status === 201 || conv.status === 200 ? fin.status === 200 && Number(fin.body.done) === 1 && !!thBo.closed_at && thBo.closing_interaction_id === conv.body.interactionId : false, [conv.status, fin.status, thBo]);

    // §4 THE MEETING STEP ITSELF.
    const [mt] = await q(`SELECT id FROM tasks WHERE org_id=$1 AND thread_id=$2 AND link_kind='next_step'`, [ORG, th && th.id]);
    const bareM = await api("POST", `/tasks/${mt && mt.id}/complete`, T, { done: true });
    ok("FIX-34 A §4 a bare tick of the meeting step is refused the same way", bareM.status === 422 && bareM.body.error === "needs_outcome" && bareM.body.kind === "meeting", [bareM.status, bareM.body]);
  } finally {
    await reset();
  }
}

module.exports = { run };
if (require.main === module) run().then(async()=>{await require("../helpers").closeDb();require("../helpers").summary();}).catch(async e=>{console.error(e);process.exit(1);});
