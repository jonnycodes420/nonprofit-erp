// tests/fix31-one-record.test.js · FIX-31's one test. ONE RECORD, THREE VIEWS.
//
//     A grant deadline and a next step are each one record, shown in Tasks,
//     on the Thread and on the Calendar, never three copies that drift.
//     §1 an open deadline is on the Calendar once and is ONE task (plus one
//        heads-up), and a re-save never makes a second;
//     §2 marking it done keeps it on the Calendar, struck through, and closes
//        the task; ticking the task marks the deadline done; Undo restores both;
//     §3 moving the deadline moves the task, moving the task moves the
//        deadline; taking it off removes the task, and putting it back returns it;
//     §4 a next step planned on a profile is in Tasks, on the Thread and on the
//        Calendar; ticking it from the Calendar (FIX-34: through how it went
//        and what's next, a bare tick is refused) closes it everywhere and Undo
//        reopens it; moving it moves it everywhere;
//     §5 the backfill run twice makes one task per record, never two;
//     §6 one volunteer added makes "On the roster" 1 on Volunteers and in Ask,
//        before any shift;
//     §7 another organisation can neither see nor tick the task.
//
// Donor data: a funder deadline that is on the Calendar but not in anyone's
// Tasks (Jonathan's Meridian report, 7 Oct) is a missed grant report, and a
// next step closed in one view and open in another is a donor called twice.
//
// HOW IT WOULD GO RED (proven before it was trusted, see the PR):
//   · on main (no trigger, no linked tasks) → §1 "one task" and everything after;
//   · the milestone trigger without its done mirror → §2 "the task closed";
//   · linkedTaskChange returning null (ticks write only the task) → §2/§4
//     "ticking the task marks the deadline done" / "the thread closed";
//   · backfill without its NOT EXISTS + unique index → §5 "never two".

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_fix31one", ORG2 = "org_fix31two";
const TABLES = ["interactions", "tasks", "grant_milestones", "grants", "threads", "volunteer_profiles", "volunteers", "donors", "users"];

// Adding a volunteer writes rows in tables this list cannot know ahead of
// time, so the org delete names whatever still points at it and clears that.
async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    for (let i = 0; i < 25; i++) {
      const err = await q(`DELETE FROM orgs WHERE id=$1`, [o]).then(() => null, e => e);
      if (!err) break;
      const t = err.table || (/on table "(\w+)"/.exec(err.message || "") || [])[1];
      if (!t || t === "orgs") throw err;
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]);
    }
  }
}
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const linked = (where, args) => q(`SELECT * FROM tasks WHERE ${where} ORDER BY link_kind`, args);

(async () => {
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  for (const [o, slug] of [[ORG, "fix31-one"], [ORG2, "fix31-two"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
             VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW())`, [o, `One record ${slug}`, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [`u_${o}`, o, `dana@${o}.local`, pw]);
  }
  const T = await login(`dana@${ORG}.local`, "loadtest1234");
  const T2 = await login(`dana@${ORG2}.local`, "loadtest1234");
  await q(`INSERT INTO donors (id,org_id,name,kind,person_types,stage,status,tags,created_by,created_by_name)
           VALUES ('d_f31_fdn',$1,'Meridian Fixture Foundation','organisation','["other"]'::jsonb,'prospect','active','[]','system:test','test')`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,stage,status,tags,created_by,created_by_name)
           VALUES ('d_f31_p',$1,'Fixture Person','active','active','[]','system:test','test')`, [ORG]);
  await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,amount,officer_id,officer,created_by,created_by_name)
           VALUES ('gr_f31',$1,'Meridian Fixture Foundation','d_f31_fdn','Second boat','submitted',50000,$2,'Dana Reyes','system:test','test')`, [ORG, `u_${ORG}`]);

  // ── §1 AN OPEN DEADLINE: ON THE CALENDAR ONCE, ONE TASK ─────────────────
  // Forty days out, so no lead time has arrived and the heads-up (14 days
  // ahead by default) is still ahead.
  const due = day(40);
  const add = await api("POST", "/grants/gr_f31/milestones", T, { kind: "proposal_due", dueDate: due });
  ok("§1 the deadline was added through its own route", add.status === 201, add.body);
  const msId = add.body && add.body.id;
  let tasks = await linked("milestone_id=$1", [msId]);
  const dl = tasks.find(t => t.link_kind === "deadline"), hu = tasks.find(t => t.link_kind === "deadline_start");
  ok("§1 the deadline is ONE task, titled [Funder]: [kind] due, owned by the officer, on its day, linking to the grant",
    tasks.filter(t => t.link_kind === "deadline").length === 1 && dl.title === "Meridian Fixture Foundation: Proposal due"
      && dl.assigned_to === `u_${ORG}` && dl.due === due && dl.grant_id === "gr_f31" && Number(dl.done) === 0, tasks);
  ok("§1 and one heads-up task, 14 days ahead", !!hu && hu.title === "Start proposal for Meridian Fixture Foundation" && hu.due === day(26), hu);
  const mine = await api("GET", "/tasks?scope=mine", T);
  const list = await api("GET", "/grants/gr_f31/checklist", T);
  ok("§1 the grant's checklist does not list the deadline a second time (its heads-up is checklist work)",
    list.status === 200 && !list.body.items.some(i => i.id === dl.id) && list.body.items.some(i => i.id === hu.id), list.body);
  ok("§1 both show in Tasks", mine.status === 200 && mine.body.some(t => t.id === dl.id) && mine.body.some(t => t.id === hu.id), mine.body && mine.body.length);
  const cal = async (from, to) => (await api("GET", `/calendar/items?from=${from}&to=${to}&types=deadline,step`, T)).body.items || [];
  let items = await cal(day(20), day(45));
  ok("§1 the deadline is on the Calendar once (its task is not drawn a second time)",
    items.filter(i => i.type === "deadline" && i.ref.milestoneId === msId).length === 1 && !items.some(i => i.ref && i.ref.taskId === dl.id), items.map(i => i.id));
  await api("PUT", `/grants/milestones/${msId}`, T, { dueDate: due, notes: "re-saved" });
  await api("PUT", `/grants/milestones/${msId}`, T, { dueDate: due, notes: "re-saved again" });
  tasks = await linked("milestone_id=$1", [msId]);
  ok("§1 re-saving twice never makes a second task or heads-up", tasks.length === 2, tasks.map(t => t.link_kind));

  // ── §2 DONE HIDES NOTHING; THE TASK AND THE DEADLINE TICK TOGETHER ───────
  await api("POST", `/grants/milestones/${msId}/done`, T, {});
  items = await cal(day(20), day(45));
  const doneItem = items.find(i => i.ref && i.ref.milestoneId === msId);
  ok("§2 a done deadline stays on the Calendar, marked done", !!doneItem && doneItem.done === true && /Done by Dana Reyes/.test(doneItem.detail), doneItem);
  [tasks] = [await linked("milestone_id=$1 AND link_kind='deadline'", [msId])];
  ok("§2 marking the deadline done closed the task", Number(tasks[0].done) === 1, tasks[0]);
  await api("POST", `/grants/milestones/${msId}/reopen`, T, {});
  ok("§2 Undo on the deadline reopened the task", Number((await linked("id=$1", [dl.id]))[0].done) === 0);
  const tick = await api("POST", `/tasks/${dl.id}/complete`, T, { done: true });
  const [ms1] = await q(`SELECT state, completed_by_name FROM grant_milestones WHERE id=$1`, [msId]);
  ok("§2 ticking the task marks the deadline done, in her name", tick.status === 200 && Number(tick.body.done) === 1 && ms1.state === "done" && ms1.completed_by_name === "Dana Reyes", [tick.status, tick.body, ms1]);
  const undo = await api("POST", `/tasks/${dl.id}/complete`, T, { done: false });
  const [ms2] = await q(`SELECT state FROM grant_milestones WHERE id=$1`, [msId]);
  ok("§2 Undo on the task restores both", undo.status === 200 && Number(undo.body.done) === 0 && ms2.state !== "done", [undo.body && undo.body.done, ms2]);

  // ── §3 MOVE, REMOVE, PUT BACK ────────────────────────────────────────────
  await api("PUT", `/grants/milestones/${msId}`, T, { dueDate: day(42) });
  tasks = await linked("milestone_id=$1", [msId]);
  ok("§3 moving the deadline moved its task and its heads-up", tasks.find(t => t.link_kind === "deadline").due === day(42) && tasks.find(t => t.link_kind === "deadline_start").due === day(28), tasks.map(t => [t.link_kind, t.due]));
  const mv = await api("PATCH", `/tasks/${dl.id}/due`, T, { due: day(43) });
  const [ms3] = await q(`SELECT due_date FROM grant_milestones WHERE id=$1`, [msId]);
  ok("§3 moving the task moved the deadline", mv.status === 200 && ms3.due_date === day(43) && mv.body.due === day(43), [mv.status, mv.body, ms3]);
  const del = await api("DELETE", `/tasks/${dl.id}`, T);
  ok("§3 the deadline's task is not deleted on its own", del.status === 409 && /deadline/i.test(del.body.sentence || ""), del.body);
  await api("POST", `/grants/milestones/${msId}/remove`, T, {});
  ok("§3 taking the deadline off removed its tasks", (await linked("milestone_id=$1", [msId])).length === 0);
  await api("POST", `/grants/milestones/${msId}/reopen`, T, {});
  ok("§3 putting it back brought its task back", (await linked("milestone_id=$1 AND link_kind='deadline'", [msId])).length === 1);

  // ── §4 A NEXT STEP: TASKS, THREAD, CALENDAR ARE ONE RECORD ───────────────
  const plan = await api("POST", "/donors/d_f31_p/threads", T, { label: "Call about the spring visit", due: day(5) });
  ok("§4 a next step planned from the profile", plan.status === 201, plan.body);
  const thId = plan.body.thread && plan.body.thread.id;
  let [st] = await linked("thread_id=$1", [thId]);
  const all = await api("GET", "/tasks?scope=all", T);
  ok("§4 it is a task in Tasks, linking to the person, owned and dated", !!st && all.body.some(t => t.id === st.id && t.donor_id === "d_f31_p" && t.due === day(5)), st);
  const thr = await api("GET", "/threads?scope=all", T);
  ok("§4 it is on the Thread", JSON.stringify(thr.body).includes(thId), thr.status);
  items = await cal(day(0), day(10));
  const stepItem = items.find(i => i.type === "step" && i.ref.threadId === thId);
  ok("§4 it is on the Calendar once, carrying its task", !!stepItem && stepItem.ref.taskId === st.id && items.filter(i => i.ref && (i.ref.threadId === thId || i.ref.taskId === st.id)).length === 1, items.map(i => i.id));
  // The Calendar card's Mark done is the task's own complete route. FIX-34
  // changed this ON PURPOSE: a call step is finished the way Tasks finishes
  // it, so a bare tick is refused and the sheet's "How did it go?" and
  // "What's next?" (POST /donors/:id/conversations) come first.
  const bareTick = await api("POST", `/tasks/${st.id}/complete`, T, { done: true });
  ok("§4 a bare tick from the Calendar is refused: say how the call went and what's next (FIX-34)", bareTick.status === 422 && bareTick.body.error === "needs_outcome", [bareTick.status, bareTick.body]);
  const conv = await api("POST", "/donors/d_f31_p/conversations", T, { touch: "call_reached", line: "She can visit in April.", nextStep: { skipped: true } });
  await api("POST", `/tasks/${st.id}/complete`, T, { done: true, interactionId: conv.body.interactionId });
  const [th1] = await q(`SELECT closed_at, close_kind, closing_interaction_id FROM threads WHERE id=$1`, [thId]);
  [st] = await linked("thread_id=$1", [thId]);
  const thr2 = await api("GET", "/threads?scope=all", T);
  ok("§4 done from the Calendar: the thread closed on her line, the task is done, the Thread no longer holds it",
    !!th1.closed_at && th1.close_kind === "outcome" && th1.closing_interaction_id === conv.body.interactionId && Number(st.done) === 1 && !JSON.stringify(thr2.body).includes(thId), [th1, st.done]);
  await api("POST", `/tasks/${st.id}/complete`, T, { done: false });
  const [th2] = await q(`SELECT closed_at FROM threads WHERE id=$1`, [thId]);
  const [kept] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE id=$1`, [th1.closing_interaction_id]);
  [st] = await linked("thread_id=$1", [thId]);
  ok("§4 Undo reopened the thread and the task; what she wrote about the call stays on the timeline", !th2.closed_at && Number(st.done) === 0 && kept.n === 1, [th2, st.done, kept]);
  await api("PUT", `/threads/${thId}`, T, { due: day(7) });
  ok("§4 moving the step (a Calendar drag) moved the task", (await linked("thread_id=$1", [thId]))[0].due === day(7));
  await api("PATCH", `/tasks/${st.id}/due`, T, { due: day(8) });
  const [th3] = await q(`SELECT due_date FROM threads WHERE id=$1`, [thId]);
  ok("§4 moving the task moved the step", th3.due_date === day(8), th3);

  // ── §5 THE BACKFILL, TWICE ───────────────────────────────────────────────
  // As before FIX-31: the records exist, their tasks do not.
  await q(`DELETE FROM tasks WHERE org_id=$1 AND (thread_id IS NOT NULL OR milestone_id IS NOT NULL)`, [ORG]);
  const { backfillLinkedTasks } = require("../db");
  const first = await backfillLinkedTasks();
  const second = await backfillLinkedTasks();
  const [n] = await q(`SELECT COUNT(*) FILTER (WHERE thread_id=$2)::int AS step, COUNT(*) FILTER (WHERE milestone_id=$3 AND link_kind='deadline')::int AS dl
                         FROM tasks WHERE org_id=$1`, [ORG, thId, msId]);
  ok("§5 the backfill made the next step's task and the deadline's task", first.made >= 2 && n.step === 1 && n.dl === 1, [first, n]);
  ok("§5 run twice it makes one task, never two", second.made === 0, second);

  // ── §6 A JUST-ADDED VOLUNTEER IS NEVER ZERO ──────────────────────────────
  const vol = await api("POST", "/volunteer-hub/people", T, { name: "Jonathan Fixture" });
  const counts = await api("GET", "/volunteer-hub/counts", T);
  ok("§6 one volunteer, no shift: On the roster reads 1", vol.status === 201 && counts.body.roster && counts.body.roster.value === 1 && counts.body.roster.served.value === 0, [vol.status, counts.body]);
  const ask = await api("POST", "/ask", T, { text: "how many volunteers" });
  ok("§6 Ask says the same 1", ask.status === 200 && /1 volunteer on the roster/.test(JSON.stringify(ask.body)), ask.body);

  // ── §7 TENANT WALL ───────────────────────────────────────────────────────
  const foreign = await api("POST", `/tasks/${st.id}/complete`, T2, { done: true });
  const foreignMove = await api("PATCH", `/tasks/${st.id}/due`, T2, { due: day(9) });
  const other = await api("GET", "/tasks?scope=all", T2);
  ok("§7 another organisation can neither tick, move nor see it", foreign.status === 404 && foreignMove.status === 404 && !other.body.some(t => t.id === st.id), [foreign.status, foreignMove.status]);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary(); });
