// tests/tasks2-thread.test.js · TASKS-2's one test. ONE TASK, EVERY PLACE.
//
// §1 logging a conversation with a next step makes ONE task, and it is on the
//    Thread, in Tasks Today, on the person's profile, on the Calendar, and in
//    the count Home reads, all agreeing (the director saw "1 Follow-ups,
//    0 Due today" with the thing due today on the same card).
// §2 completing a call task with a person is refused until the call is logged
//    with a next step or an explicit "No next step".
// §3 quick add reads "Call Bill Harmon Friday 2pm about the gala".
// §4 a weekly task makes the next one when done, once; reopening takes it back.
// §5 the fixes this build carries: a date-only day read as a day (the grant
//    card's "Report due" a day early), the sample-data line only while nothing
//    real was imported, and the First thing sentence with one subject.
// §6 the view rule in SQL and in shared/taskShape.js agree, row by row.
//
// Donor data: a task that is on one screen and not another is a promise to a
// donor that one of the screens has quietly dropped.
//
// HOW IT WOULD GO RED: count Home's "Due today" from anything but the Tasks
// rule (§1 counts disagree); let a bare tick finish a call (§2 gets 200); read
// "Octavian" as a month (§3 misses the person, proven red during the build);
// spawn the repeat on every tick (§4 two next tasks); parse "2026-11-15" with
// new Date() in New York (§5 says November 14). Proven able to fail: run
// against main (cd1a734), where /tasks/counts and the parse route do not exist
// and Grants.jsx reads new Date(grant.reportDue): §1, §3 and §5 went red.
process.env.TZ = "America/New_York";
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_tasks2";
const TABLES = ["interactions", "tasks", "threads", "calendar_events", "donors", "users"];
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
const orgDay = (n = 0) => { const d = new Date(Date.now() + n * 864e5); return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); };

(async () => {
  await reset();
  const ts = await import("../shared/taskShape.js");
  const ft = await import("../shared/firstThing.js");
  const td = await import("../client/src/lib/taskDue.js");
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Tasks two','tasks-two',1,'active','team','America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_t2',$1,'dana@tasks2.local',$2,'Dana Reyes','admin')`, [ORG, pw]);
  const T = await login("dana@tasks2.local", "loadtest1234");
  for (const [id, name] of [["d_t2_cs", "Christine Stewart"], ["d_t2_bh", "Bill Harmon"], ["d_t2_oc", "Octavian Cobbleworth"], ["d_t2_rc", "Rufus Cobbleworth"]])
    await q(`INSERT INTO donors (id,org_id,name,stage,status,tags,assigned_to,assigned_to_name,created_by,created_by_name)
             VALUES ($1,$2,$3,'active','active','[]','u_t2','Dana Reyes','system:test','test')`, [id, ORG, name]);
  const today = orgDay(0);

  // ── §1 ONE TASK, EVERY PLACE, ONE COUNT ─────────────────────────────────
  const conv = await api("POST", "/donors/d_t2_cs/conversations", T, { touch: "meeting", line: "She asked for the impact report.",
    nextStep: { type: "send", label: "Send the impact report", due: today } });
  ok("§1 the conversation is logged with its next step", conv.status === 201 && conv.body.thread, conv.body);
  const thId = conv.body.thread && conv.body.thread.id;
  const tasks = await q(`SELECT * FROM tasks WHERE org_id=$1 AND donor_id='d_t2_cs'`, [ORG]);
  ok("§1 it made exactly one task", tasks.length === 1 && tasks[0].thread_id === thId && tasks[0].link_kind === "next_step", tasks);
  const taskId = tasks[0] && tasks[0].id;
  const thr = await api("GET", "/threads?scope=mine", T);
  const onThread = (thr.body.list || []).find(t => t.id === thId);
  ok("§1 on the Thread, with its last line, step, day and owner", !!onThread && onThread.lastTouch.line === "She asked for the impact report."
    && onThread.nextStep.label === "Send the impact report" && onThread.nextStep.due === today && onThread.owner && onThread.owner.name === "Dana Reyes", onThread);
  const todayList = await api("GET", "/tasks?view=today&scope=mine", T);
  ok("§1 in Tasks Today, about Christine", todayList.status === 200 && todayList.body.some(t => t.id === taskId && t.about && t.about.name === "Christine Stewart"), todayList.body);
  const prof = await api("GET", "/donors/d_t2_cs/tasks", T);
  ok("§1 on her profile", prof.status === 200 && prof.body.some(t => t.id === taskId && !t.done), prof.body);
  const cal = await api("GET", `/calendar/items?from=${today}&to=${today}&types=step`, T);
  ok("§1 on the Calendar once, carrying the task", (cal.body.items || []).filter(i => i.ref && i.ref.threadId === thId && i.ref.taskId === taskId).length === 1, cal.body);
  const counts = await api("GET", "/tasks/counts?scope=mine", T);
  const band = (thr.body.bands || []).find(b => b.key === "today");
  ok("§1 Home's Due today, Tasks Today and the Thread's today all say 1",
    counts.body.today === 1 && todayList.body.length === 1 && band && band.count === 1 && thr.body.stat.open === 1, { counts: counts.body, band, stat: thr.body.stat });

  // ── §2 A CALL IS DONE WHEN IT IS LOGGED, WITH WHAT IS NEXT ───────────────
  const call = await api("POST", "/tasks", T, { title: "Call about the gala", kind: "call", donorId: "d_t2_bh", due: orgDay(2) });
  ok("§2 a call task about Bill", call.status === 201 && call.body.kind === "call" && call.body.about.name === "Bill Harmon", call.body);
  const bare = await api("POST", `/tasks/${call.body.id}/complete`, T, { done: true });
  ok("§2 a bare tick is refused, saying what to do", bare.status === 422 && bare.body.error === "needs_outcome", bare.body);
  const silent = await api("POST", "/donors/d_t2_bh/conversations", T, { touch: "call_reached", line: "He will bring two tables." });
  ok("§2 a call logged with no decision about what's next is refused", silent.status === 400, silent.body);
  const foreign = await api("POST", `/tasks/${call.body.id}/complete`, T, { done: true, interactionId: conv.body.interactionId });
  ok("§2 another person's conversation never finishes it", foreign.status === 422, foreign.body);
  const logged = await api("POST", "/donors/d_t2_bh/conversations", T, { touch: "call_reached", line: "He will bring two tables.", nextStep: { skipped: true } });
  const fin = await api("POST", `/tasks/${call.body.id}/complete`, T, { done: true, interactionId: logged.body.interactionId });
  ok("§2 with \"No next step\" recorded, the call is done", fin.status === 200 && Number(fin.body.done) === 1 && fin.body.view === "done", fin.body);

  // ── §3 QUICK ADD ─────────────────────────────────────────────────────────
  const p = await api("POST", "/tasks/parse", T, { text: "Call Bill Harmon Friday 2pm about the gala" });
  const fri = orgDay(((5 - new Date(today + "T12:00:00Z").getUTCDay()) + 7) % 7);
  ok("§3 \"Call Bill Harmon Friday 2pm about the gala\" is a call for Bill, Friday 2:00 PM, \"Call about the gala\"",
    p.status === 200 && p.body.title === "Call about the gala" && p.body.kind === "call" && p.body.person && p.body.person.id === "d_t2_bh"
      && p.body.due === fri && p.body.time === "14:00", p.body);
  const p2 = await api("POST", "/tasks/parse", T, { text: "Call Octavian Cobbleworth tomorrow" });
  ok("§3 a name that starts like a month is still a name", p2.body.person && p2.body.person.id === "d_t2_oc" && p2.body.due === orgDay(1), p2.body);
  ok("§3 parsing saved nothing", (await q(`SELECT COUNT(*)::int n FROM tasks WHERE org_id=$1 AND title LIKE 'Call about the gala%' AND done=0`, [ORG]))[0].n === 0);

  // ── §4 A WEEKLY TASK MAKES THE NEXT ONE ──────────────────────────────────
  const wk = await api("POST", "/tasks", T, { title: "Board report draft", due: today, recur: { every: "week" } });
  const d1 = await api("POST", `/tasks/${wk.body.id}/complete`, T, { done: true });
  ok("§4 done, the next one is a week on", d1.status === 200 && d1.body.next && d1.body.next.due === orgDay(7) && d1.body.next.title === "Board report draft", d1.body);
  await api("POST", `/tasks/${wk.body.id}/complete`, T, { done: false });
  await api("POST", `/tasks/${wk.body.id}/complete`, T, { done: true });
  const kids = await q(`SELECT * FROM tasks WHERE org_id=$1 AND recur_parent_id=$2`, [ORG, wk.body.id]);
  ok("§4 reopening took the next one back, and finishing again made exactly one", kids.length === 1 && kids[0].done === 0, kids.map(k => [k.id, k.due, k.done]));
  ok("§4 the first Monday of next month", ts.nextDue({ every: "month", nth: 1, weekday: 1 }, "2026-10-05", "2026-10-07") === "2026-11-02");

  // ── §5 THE FIXES ─────────────────────────────────────────────────────────
  ok("§5 a date-only report day is that day in New York", td.fmtDayLong("2026-11-15") === "November 15, 2026", td.fmtDayLong("2026-11-15"));
  const grants = fs.readFileSync(path.join(__dirname, "../client/src/components/Grants.jsx"), "utf8");
  const shared = fs.readFileSync(path.join(__dirname, "../client/src/components/shared.jsx"), "utf8");
  ok("§5 no grant card parses a date-only field as UTC midnight", !/new Date\((grant|g)\.(reportDue|deadline)\)/.test(grants));
  ok("§5 daysUntil counts a date-only day on the calendar", /export const daysUntil = d => \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(String\(d\|\|""\)\) \? daysToDue\(d\)/.test(shared));
  await q(`INSERT INTO donors (id,org_id,name,stage,status,tags,is_sample,created_by,created_by_name)
           VALUES ('d_t2_sample',$1,'Sample Person','active','active','[]',true,'system:test','test')`, [ORG]);
  const ss = await api("GET", "/org/sample-data-status", T);
  ok("§5 sample data beside real donors: Home knows the file has arrived", ss.body.hasSampleData === true && ss.body.realDonorCount === 4, ss.body);
  const s = ft.firstThingSentences(onThread, today);
  ok("§5 First thing: one subject per sentence", s.happened === "Christine asked for the impact report." && s.next === "Send it today.", s);

  // ── §6 THE VIEW RULE, IN SQL AND IN JS, AGREE ────────────────────────────
  for (const [n, due] of [["a", orgDay(-3)], ["b", orgDay(0)], ["c", orgDay(7)], ["d", orgDay(8)], ["e", ""]])
    await api("POST", "/tasks", T, { title: `View check ${n}`, due });
  const all = await api("GET", "/tasks?scope=all", T);
  const bad = all.body.filter(t => t.view !== ts.viewOf(t, today));
  ok("§6 every row's view is the same in SQL and in shared/taskShape.js", all.body.length >= 8 && bad.length === 0, bad.map(t => [t.title, t.due, t.view]));
  const c2 = (await api("GET", "/tasks/counts?scope=all", T)).body;
  const tally = {}; for (const t of all.body) if (t.view !== "done") tally[t.view] = (tally[t.view] || 0) + 1;
  ok("§6 the counts are the list, counted", ["today", "upcoming", "overdue", "later", "nodate"].every(k => (tally[k] || 0) === c2[k]), { tally, c2 });

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
