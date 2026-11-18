// tests/edit2.test.js · EDIT-2 (a customer, Nov 18). The build's one new suite: it guards donor
// data (touches written to many people at once, their one Undo, and which person's next step
// Steward names).
//
// §1 A profile's tasks in date order. The one order (shared/nextStep.js sortTasks): open by due
//    day soonest first, undated last, then done newest first. Coming up and the timeline (the
//    Tasks tab and the Timeline view) read it.
// §2 A person's next step. Tasks made May-first, due December-first. On Nov 18, December is the
//    next step whether May is May 2026 (overdue) or May 2027 (later). End to end: Top 100, Major
//    gifts' portfolio, the profile's "Next:" line and Home's Thread name the same step.
// §3 One touch, logged to many people. Only the people picked, in this org; nothing sent and no
//    task unless asked; one Undo for the whole batch; one line in the activity log; the
//    "Touch titled · hasn't had" filter, which a deleted touch does not count toward; the warning
//    count; the 2,000 cap.
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back):
//   · Coming up / the timeline in created order (sortTasks returns its input) → §1 red.
//   · next step = earliest open date (pickNextStep without the "today or later" pass) → §2 red
//     for May 2026; next step = the Thread's step only (portfolio's old read) → §2 portfolio red.
//   · the batch's pickable() without its org_id → §3 "another org" red; skipping the
//     ids filter → §3 "outside the selection" red.
//   · the batch calling sendDonorEmail → §3 "sends nothing" red.
//   · undo deleting one touch per call (LIMIT 1) → §3 "one Undo" red.
//   · the filter reading deleted_records too → §3 "a deleted touch doesn't count" red.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, civilToday, civilPlusDays, waitFor } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "loadtest1234";
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

async function newOrg(tag, run) {
  const r = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Edit Two ${tag} Larkspur ${run}`, userName: "Ottoline Prewitt", email: `owner-${tag}-${run}@edit2.local`, password: PASSWORD, provisioned: true, demoData: false }) });
  const b = await r.json();
  if (r.status !== 201 || !b.token) throw new Error(`register-org ${tag}: ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  await q(`UPDATE orgs SET onboarding_complete=1, onboarded_at=NOW() WHERE id=$1`, [b.org.id]);
  await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [b.org.id]);
  return { tok: b.token, org: b.org.id, userId: b.user && b.user.id };
}

(async () => {
  console.log("edit2 (EDIT-2)");
  // Read without stopping the suite, so a run on main's code still reports §2 and §3 end to end.
  const NS = await import(path.join(ROOT, "shared/nextStep.js")).catch(() => ({ sortTasks: x => x, pickNextStep: () => null }));

  // ── §1 the task order ────────────────────────────────────────────────────
  {
    // Made in this order; due in another.
    const made = [
      { id: "a", title: "May", due: "2027-05-04", done: 0 },
      { id: "b", title: "December", due: "2026-12-09", done: 0 },
      { id: "c", title: "No day", due: "", done: 0 },
      { id: "d", title: "Done in October", due: "2026-10-01", done: 1, completed_at: "2026-10-02T15:00:00Z" },
      { id: "e", title: "Done in November", due: "2026-09-01", done: 1, completed_at: "2026-11-10T15:00:00Z" },
      { id: "f", title: "Overdue", due: "2026-06-01", done: 0 },
    ];
    const order = NS.sortTasks(made).map(t => t.title);
    ok("§1 open by due day soonest first, undated last, then done newest first",
      JSON.stringify(order) === JSON.stringify(["Overdue", "December", "May", "No day", "Done in November", "Done in October"]), order);
    const cu = read("client/src/components/profile/profileShared.jsx");
    const tl = read("client/src/components/MeetingPanels.jsx");
    ok("§1 Coming up orders its open tasks by the one order (sortTasks)",
      /const open=sortTasks\(/.test(cu) && /from "\.\.\/\.\.\/\.\.\/\.\.\/shared\/nextStep\.js"/.test(cu));
    ok("§1 the timeline (Tasks tab and Timeline) leads with open tasks in the one order (compareTasks)",
      /items\.filter\(openTask\)\.sort\(\(a, b\) => compareTasks\(a\.task, b\.task\)\)/.test(tl));
  }

  // ── §2 the next step ─────────────────────────────────────────────────────
  {
    const nov18 = "2026-11-18";
    const dec = { id: "dec", due: "2026-12-09" };
    const p1 = NS.pickNextStep([{ id: "may26", due: "2026-05-12" }, dec], nov18);
    ok("§2 Nov 18: December is the next step over an overdue May 2026 task", p1 && p1.id === "dec" && p1.overdue === false, p1);
    const p2 = NS.pickNextStep([{ id: "may27", due: "2027-05-12" }, dec], nov18);
    ok("§2 Nov 18: December is the next step over a May 2027 task", p2 && p2.id === "dec", p2);
    const p3 = NS.pickNextStep([{ id: "may26", due: "2026-05-12" }, { id: "jun26", due: "2026-06-12" }], nov18);
    ok("§2 with nothing ahead, the most overdue, labelled overdue", p3 && p3.id === "may26" && p3.overdue === true, p3);
    const p4 = NS.pickNextStep([{ id: "today", due: nov18 }, dec], nov18);
    ok("§2 a step due today is the next step (today or later)", p4 && p4.id === "today" && !p4.overdue, p4);

    // End to end, on the run's own clock: "May" is six months back (or forward), "December" two weeks on.
    const run = require("crypto").randomBytes(4).toString("hex");
    const A = await newOrg("next", run);
    for (const [label, mayDue] of [["overdue May", civilPlusDays(-190)], ["later May", civilPlusDays(170)]]) {
      const pr = await api("POST", "/donors", A.tok, { name: `Philippa Quennell ${label} ${run}`, email: `pq-${label.replace(/\s/g, "")}-${run}@edit2.invalid` });
      const id = pr.body && pr.body.id;
      const decDue = civilPlusDays(14);
      const may = await api("POST", "/tasks", A.tok, { title: `Coffee in May (${label})`, due: mayDue, donorId: id });
      const dc = await api("POST", "/tasks", A.tok, { title: `Year-end visit in December (${label})`, due: decDue, donorId: id });
      ok(`§2 (${label}) fixture: two tasks, made May-first`, may.status < 300 && dc.status < 300, [may.status, dc.status]);
      await q(`UPDATE donors SET assigned_to=$1 WHERE id=$2 AND org_id=$3`, [A.userId, id, A.org]);
      const add = await api("POST", "/top100/members", A.tok, { donorIds: [id] });
      const t100 = await api("GET", "/top100", A.tok);
      const row = ((t100.body && t100.body.rows) || []).find(r => r.donorId === id);
      ok(`§2 (${label}) Top 100: the next step is the December task`, add.status < 300 && row && row.next && /December/.test(row.next.label) && row.next.due === decDue,
        [add.status, row && row.next]);
      const pf = await api("GET", `/portfolio/${A.userId}`, A.tok);
      const pp = ((pf.body && pf.body.people) || []).find(p => p.donorId === id);
      ok(`§2 (${label}) Major gifts' portfolio: the next step is the December task`, pp && pp.nextStep && /December/.test(pp.nextStep.label) && !pp.nextStep.overdue,
        [pf.status, pp && pp.nextStep]);
      const st = await api("GET", `/donors/${id}/status`, A.tok);
      const nx = st.body && st.body.next;
      ok(`§2 (${label}) the profile's "Next:" line names the December task`, nx && /December/.test(nx.step), nx);
      const th = await api("GET", `/threads?donorId=${encodeURIComponent(id)}`, A.tok);
      const first = ((th.body && th.body.list) || [])[0];
      ok(`§2 (${label}) the profile rail leads with the December task`, first && /December/.test(first.nextStep.label), first && first.nextStep);
      const home = await api("GET", "/threads?scope=all", A.tok);
      const hr = ((home.body && home.body.list) || []).find(r => r.donorId === id);
      ok(`§2 (${label}) Home's Thread shows the person once, as the December task`, hr && /December/.test(hr.nextStep.label), hr && hr.nextStep);
      if (label === "overdue May")
        ok("§2 Home still counts them as having a step overdue", home.body && home.body.stat && home.body.stat.overdue >= 1, home.body && home.body.stat);
      // Only the overdue one left: it is the next step, said as overdue.
      await q(`UPDATE tasks SET done=1, completed_at=NOW() WHERE org_id=$1 AND donor_id=$2 AND title LIKE 'Year-end visit%'`, [A.org, id]);
      if (label === "overdue May") {
        const pf2 = await api("GET", `/portfolio/${A.userId}`, A.tok);
        const pp2 = ((pf2.body && pf2.body.people) || []).find(p => p.donorId === id);
        ok("§2 with only the May task open, the portfolio names it, as overdue", pp2 && pp2.nextStep && /May/.test(pp2.nextStep.label) && pp2.nextStep.overdue === true, pp2 && pp2.nextStep);
      }
    }
  }

  // ── §3 one touch, many people ───────────────────────────────────────────
  {
    const run = require("crypto").randomBytes(4).toString("hex");
    const A = await newOrg("batch", run);
    const B = await newOrg("other", run);
    const mk = async (o, name) => {
      const r = await api("POST", "/donors", o.tok, { name: `${name} ${run}`, email: `${name.split(" ")[0].toLowerCase()}-${run}@edit2.invalid` });
      if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status}`);
      return r.body.id;
    };
    const picked = [];
    for (const n of ["Wilhelmina Ashgrove", "Bartholomew Fenwick", "Clementine Rushby", "Desmond Quayle", "Eudora Vantreight"]) picked.push(await mk(A, n));
    const left = await mk(A, "Fitzgerald Notpicked");
    const theirs = await mk(B, "Gwendolyn Elsewhere");
    const TITLE = "Invited to Spring awareness night";
    const touchesOf = async id => q(`SELECT id, note, touch_batch_id, metadata FROM interactions WHERE donor_id=$1`, [id]);
    const mailBefore = (await q(`SELECT COUNT(*)::int AS n FROM email_log WHERE org_id=$1`, [A.org]))[0].n;
    const tasksBefore = (await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1`, [A.org]))[0].n;

    const one = await api("POST", "/touch-batches", A.tok, { ids: [...picked, theirs], touchKind: "event_invite", title: TITLE, date: civilToday() });
    ok("§3 a batch logs to the people picked in this org", one.status === 200 && one.body.people === 5 && one.body.missing === 1, [one.status, one.body]);
    const each = await Promise.all(picked.map(touchesOf));
    ok("§3 one touch on each picked person's timeline, titled, of the batch",
      each.every(rs => rs.length === 1 && rs[0].touch_batch_id === one.body.batchId && rs[0].note === TITLE && rs[0].metadata.touch_title === TITLE), each.map(r => r.length));
    ok("§3 nothing is written to a person outside the selection", (await touchesOf(left)).length === 0);
    ok("§3 nothing is written to a person in another org, even when their id is sent", (await touchesOf(theirs)).length === 0);
    const intType = await q(`SELECT DISTINCT type FROM interactions WHERE touch_batch_id=$1`, [one.body.batchId]);
    ok("§3 each is an Event invite touch, like a single Log a touch", intType.length === 1 && intType[0].type === "event_invite", intType);

    await new Promise(r => setTimeout(r, 1500));   // anything that would send has had its chance
    const mailAfter = (await q(`SELECT COUNT(*)::int AS n FROM email_log WHERE org_id=$1`, [A.org]))[0].n;
    const mailJobs = await q(`SELECT name FROM job_queue WHERE org_id=$1 AND (name ~* 'mail|email|send')`, [A.org]);
    ok("§3 a logged touch sends nothing (no mail logged, none queued)", mailAfter === mailBefore && mailJobs.length === 0, { mailBefore, mailAfter, mailJobs });
    const tasksAfter = (await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1`, [A.org]))[0].n;
    ok("§3 and makes no task when the follow-up box isn't ticked", tasksAfter === tasksBefore, { tasksBefore, tasksAfter });
    const src = read("server/donors/touchBatch.js");
    ok("§3 the batch module reaches no mail code", !/require\([^)]*(mail|resend|sendDonorEmail|donorMail)/i.test(src) && !/sendDonorEmail|sendEmail\(/.test(src));

    const audit = await waitFor(async () => {
      const r = await q(`SELECT summary, record_count FROM fin_audit_log WHERE org_id=$1 AND entity_id=$2`, [A.org, one.body.batchId]);
      return r.length ? r : null;
    }, { timeout: 8000 }).catch(() => null);
    ok("§3 the batch is ONE line in the activity log, naming how many", Array.isArray(audit) && audit.length === 1 && audit[0].record_count === 5 && /to 5 people/.test(audit[0].summary), audit);

    // Who's already had it: the warning and the filter.
    const pv = await api("POST", "/touch-batches/preview", A.tok, { ids: [...picked, left], title: "  invited to spring AWARENESS night " });
    ok("§3 the warning counts who already has a touch with this title (case and spaces aside)", pv.status === 200 && pv.body.already === 5 && pv.body.people === 6
      && /5 of these 6 already have a touch titled/.test(pv.body.sentence), pv.body);
    const hasnt = { join: "and", conditions: [{ field: "touch_titled", op: "had_not", value: TITLE }] };
    const ids1 = await api("GET", `/donors/ids?where=${encodeURIComponent(JSON.stringify(hasnt))}`, A.tok);
    const got1 = new Set((ids1.body && ids1.body.ids) || []);
    ok("§3 Touch titled · hasn't had: the one not picked, none of the five", ids1.status === 200 && got1.has(left) && picked.every(id => !got1.has(id)), [ids1.status, [...got1]]);
    const del = await api("DELETE", `/interactions/${(await touchesOf(picked[0]))[0].id}`, A.tok);
    const ids2 = await api("GET", `/donors/ids?where=${encodeURIComponent(JSON.stringify(hasnt))}`, A.tok);
    ok("§3 a deleted touch doesn't count: after deleting hers, she hasn't had it", del.status === 200 && ((ids2.body && ids2.body.ids) || []).includes(picked[0]), [del.status, ids2.body]);
    const had = { join: "and", conditions: [{ field: "touch_titled", op: "had", value: TITLE }] };
    const ids3 = await api("GET", `/donors/ids?where=${encodeURIComponent(JSON.stringify(had))}`, A.tok);
    ok("§3 Touch titled · has had: the four left", ((ids3.body && ids3.body.ids) || []).length === 4, ids3.body);

    // Skip those who have it; a follow-up only when asked.
    const two = await api("POST", "/touch-batches", A.tok, { ids: [...picked, left], touchKind: "email", title: TITLE, skipHad: true, followUp: { due: civilPlusDays(7) } });
    ok("§3 skipping who already had it logs only the rest (2: the one not picked, the one deleted)", two.status === 200 && two.body.people === 2 && two.body.skipped === 4, two.body);
    const fu = await q(`SELECT donor_id, created_by, created_by_name FROM tasks WHERE org_id=$1 AND touch_batch_id=$2 AND voided_at IS NULL`, [A.org, two.body.batchId]);
    ok("§3 ticking the follow-up makes one task per person written, stamped with who", fu.length === 2 && fu.every(t => t.created_by === A.userId && t.created_by_name), fu);

    // One Undo for the whole batch.
    const un = await api("POST", `/touch-batches/${one.body.batchId}/undo`, A.tok, {});
    const leftOfOne = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE touch_batch_id=$1`, [one.body.batchId]);
    ok("§3 one Undo takes the whole batch back", un.status === 200 && un.body.undone === 4 && leftOfOne[0].n === 0, [un.status, un.body, leftOfOne]);
    const again = await api("POST", `/touch-batches/${one.body.batchId}/undo`, A.tok, {});
    ok("§3 a second Undo says it was already undone, and changes nothing", again.status === 409, again.status);
    const unTwo = await api("POST", `/touch-batches/${two.body.batchId}/undo`, A.tok, {});
    const fuAfter = await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE touch_batch_id=$1 AND voided_at IS NULL`, [two.body.batchId]);
    ok("§3 undoing a batch with follow-ups voids its tasks too", unTwo.status === 200 && fuAfter[0].n === 0, fuAfter);
    const cross = await api("POST", `/touch-batches/${two.body.batchId}/undo`, B.tok, {});
    ok("§3 another org can't undo this org's batch", cross.status === 404, cross.status);

    // The cap.
    const many = Array.from({ length: 2001 }, (_, i) => `d_none_${i}`);
    const big = await api("POST", "/touch-batches", A.tok, { ids: many, touchKind: "email", title: TITLE });
    ok("§3 a batch is at most 2,000 people", big.status === 400 && big.body.error === "too_many", [big.status, big.body]);
    const none = await api("POST", "/touch-batches", A.tok, { ids: picked, touchKind: "email", title: "  " });
    ok("§3 a batch needs a title", none.status === 400 && none.body.error === "title_required", none.body);
    const future = await api("POST", "/touch-batches", A.tok, { ids: picked, touchKind: "email", title: TITLE, date: civilPlusDays(3) });
    ok("§3 a touch is something already done: no future day", future.status === 400 && future.body.error === "future_touch", future.body);
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
