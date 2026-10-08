// tests/fix34/e-tasks.js · FIX-34 builder E: tasks that do the thing, and the
// morning email. Run by tests/fix34-thanks.test.js; runnable alone.
//
// §1 A THANK-YOU TASK DOES THE THANKING. Marking its draft sent (the route the
//    draft's Send and Mark sent both use, POST /tasks/:id/thank) marks THAT
//    gift thanked, drops the org's awaiting-thanks count by exactly one, and
//    closes the task. Undo puts all three back. Send goes to the local sink.
// §2 AN EMAIL TASK OPENS A DRAFT. Sending it (POST /tasks/:id/email) logs the
//    email on the timeline and leaves the task open; it finishes with a next
//    step (or "No next step") on that email, the way a call does.
// §3 THE MORNING EMAIL carries today's tasks AND today's meetings, for a real
//    org; its unsubscribe line survives GET and HEAD with zero writes and the
//    POST turns the morning email off. A demo org gets nothing at the sink.
//
// Donor data and email: a thank-you marked in one place and not another asks
// her to thank somebody twice; a morning email from a demo org mails a person
// about invented work.
//
// HOW IT WOULD GO RED: run against fix-34 at c4be904: /tasks/:id/thank and
// /tasks/:id/email do not exist (404, §1 and §2 red), and the morning email
// has no meetings section and no unsubscribe line (§3 red).
process.env.TZ = "America/New_York";
const http = require("http");
const bcrypt = require("bcryptjs");
const H = require("../helpers");
const { ok, login, api, q, SINK_PORT, BASE, civilToday } = H;

const ORG = "org_fix34e", DEMO = "org_fix34e_demo";
const TABLES = ["interactions", "milestone_drafts", "thank_you_drafts", "tasks", "threads", "calendar_events", "gifts", "digest_sends", "donors", "users"];
async function reset() {
  for (const o of [ORG, DEMO]) {
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
const awaiting = async () => (await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND amount > 0 AND acknowledgement_sent IS NOT TRUE`, [ORG]))[0].n;

async function run() {
  // The local Resend sink. When a runner already owns the port, read nothing
  // from it and say so rather than pass on an empty capture.
  const captured = [];
  const sink = http.createServer((req, res) => {
    let body = ""; req.on("data", c => (body += c));
    req.on("end", () => { try { captured.push({ path: req.url, body: body ? JSON.parse(body) : null }); } catch { /* not JSON */ }
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) })); });
  });
  const sinkUp = await new Promise(res => { sink.once("error", () => res(false)); sink.listen(SINK_PORT, () => res(true)); });
  ok("§0 the local mail sink is listening on SINK_PORT", sinkUp, SINK_PORT);
  try {
    await reset();
    const today = civilToday();
    const pw = bcrypt.hashSync("loadtest1234", 4);
    for (const [o, demo] of [[ORG, false], [DEMO, true]]) {
      await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,emails_enabled,onboarded_at,is_demo_org,receipt_address,legal_name)
               VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW(),true,NOW(),$4,'12 Wharf Street, Salem, MA 01970',$2)`,
        [o, demo ? "Fix34e Demo" : "Fix34e Real", demo ? "fix34e-demo" : "fix34e-real", demo]);
      const uid = demo ? "u_f34e_demo" : "u_f34e";
      await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`,
        [uid, o, demo ? "dana@fix34e-demo.local" : "dana@fix34e.local", pw]);
      await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,assigned_to,assigned_to_name,created_by,created_by_name)
               VALUES ($1,$2,'Christine Stewart',$3,'active','active','[]',$4,'Dana Reyes','system:test','test')`,
        [demo ? "d_f34e_demo" : "d_f34e", o, demo ? "christine@fix34e-demo.local" : "christine@fix34e.local", uid]);
      await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,created_by,created_by_name,kind)
               VALUES ($1,$2,'Ring the hall about chairs',$3,'medium','donor',0,NULL,$4,'Dana Reyes','system:test','test','todo')`,
        [demo ? "t_f34e_demo_today" : "t_f34e_today", o, today, uid]);
      await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,title,starts_at,ends_at,person_ids,provider,provider_event_id,created_by)
               VALUES ($1,$2,$3,'Coffee with Christine',(($4::date + time '14:00') AT TIME ZONE 'America/New_York'),(($4::date + time '15:00') AT TIME ZONE 'America/New_York'),$5,'steward',$1,'system:test')`,
        [demo ? "ce_f34e_demo" : "ce_f34e", o, uid, today, JSON.stringify([demo ? "d_f34e_demo" : "d_f34e"])]).catch(async e => {
        await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,title,starts_at,ends_at,person_ids,provider,provider_event_id,created_by)
                 VALUES ($1,$2,$3,'Coffee with Christine',(($4::date + time '14:00') AT TIME ZONE 'America/New_York'),(($4::date + time '15:00') AT TIME ZONE 'America/New_York'),ARRAY[$5],'steward',$1,'system:test')`,
          [demo ? "ce_f34e_demo" : "ce_f34e", o, uid, today, demo ? "d_f34e_demo" : "d_f34e"]);
      });
    }
    // Two gifts awaiting thanks; the task names the older one.
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES
             ('g_f34e_1',$1,'d_f34e',250,$2,'system:test','test'), ('g_f34e_2',$1,'d_f34e',40,$2,'system:test','test')`, [ORG, today]);
    await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,created_by,created_by_name,kind,source_gift_id)
             VALUES ('t_f34e_thank',$1,'Thank Christine Stewart for her gift',$2,'high','donor',0,'d_f34e','u_f34e','Dana Reyes','system:test','test','thank_you','g_f34e_1')`, [ORG, today]);
    await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,created_by,created_by_name,kind)
             VALUES ('t_f34e_email',$1,'Email Christine the impact report',$2,'medium','donor',0,'d_f34e','u_f34e','Dana Reyes','system:test','test','email')`, [ORG, today]);
    const T = await login("dana@fix34e.local", "loadtest1234");

    // ── §1 ───────────────────────────────────────────────────────────────
    const d0 = await api("GET", "/tasks/t_f34e_thank/thank", T);
    ok("§1 the thank-you draft is for THAT gift", d0.status === 200 && d0.body.gift && d0.body.gift.id === "g_f34e_1", d0.body);
    const before = await awaiting();
    const m = await api("POST", "/tasks/t_f34e_thank/thank", T, { mode: "mark" });
    ok("§1 mark sent answers 200", m.status === 200 && m.body.giftId === "g_f34e_1", m.status + " " + JSON.stringify(m.body).slice(0, 200));
    const [g1] = await q(`SELECT acknowledgement_sent FROM gifts WHERE id='g_f34e_1'`);
    const [g2] = await q(`SELECT acknowledgement_sent FROM gifts WHERE id='g_f34e_2'`);
    ok("§1 that gift is thanked, the other is not", g1.acknowledgement_sent === true && g2.acknowledgement_sent !== true, { g1, g2 });
    ok("§1 awaiting thanks dropped by exactly one", (await awaiting()) === before - 1, { before, after: await awaiting() });
    const [tk] = await q(`SELECT done FROM tasks WHERE id='t_f34e_thank'`);
    ok("§1 the task is closed", tk.done === 1, tk);
    const u = await api("POST", "/tasks/t_f34e_thank/thank/undo", T, { giftId: m.body.giftId, before: m.body.before, draftIds: m.body.draftIds });
    const [g1u] = await q(`SELECT acknowledgement_sent FROM gifts WHERE id='g_f34e_1'`);
    const [tku] = await q(`SELECT done FROM tasks WHERE id='t_f34e_thank'`);
    ok("§1 Undo restores all three", u.status === 200 && g1u.acknowledgement_sent !== true && tku.done === 0 && (await awaiting()) === before, { g1u, tku });
    captured.length = 0;
    const s = await api("POST", "/tasks/t_f34e_thank/thank", T, { mode: "send", subject: "Thank you, Christine", body: "Dear Christine,\n\nThank you.\n\nDana" });
    const mail = captured.find(c => c.path === "/emails" && JSON.stringify(c.body.to || "").includes("christine@fix34e.local"));
    ok("§1 Send reaches the local sink, to her, with the footer", s.status === 200 && !!mail && /Unsubscribe/.test(mail.body.html || ""), s.status + " " + JSON.stringify(s.body).slice(0, 200));
    ok("§1 Send also thanks the gift and closes the task", (await awaiting()) === before - 1 && (await q(`SELECT done FROM tasks WHERE id='t_f34e_thank'`))[0].done === 1);

    // ── §2 ───────────────────────────────────────────────────────────────
    const e = await api("POST", "/tasks/t_f34e_email/email", T, { subject: "The impact report", body: "Dear Christine,\n\nHere it is.\n\nDana" });
    ok("§2 sending from an Email task answers 200 with the email's line", e.status === 200 && !!e.body.interactionId, e.status + " " + JSON.stringify(e.body).slice(0, 200));
    const [line] = await q(`SELECT type, note FROM interactions WHERE id=$1 AND org_id=$2`, [e.body.interactionId || "", ORG]);
    ok("§2 the email is on the timeline", line && line.type === "email" && /impact report/.test(line.note), line);
    const [te] = await q(`SELECT done FROM tasks WHERE id='t_f34e_email'`);
    ok("§2 the task still needs a next step", te.done === 0, te);
    const fin = await api("POST", "/tasks/t_f34e_email/complete", T, { done: true, interactionId: e.body.interactionId,
      nextStep: { type: "follow_up", label: "Ask if she read it", due: civilToday() } });
    const [te2] = await q(`SELECT done FROM tasks WHERE id='t_f34e_email'`);
    const [th] = await q(`SELECT next_step_label FROM threads WHERE org_id=$1 AND donor_id='d_f34e' AND closed_at IS NULL`, [ORG]);
    ok("§2 the next step finishes it and opens the step", fin.status === 200 && te2.done === 1 && th && th.next_step_label === "Ask if she read it", { status: fin.status, th });

    // ── §3 ───────────────────────────────────────────────────────────────
    captured.length = 0;
    const r = await api("POST", "/nudges/run", T, { today, force: true });
    ok("§3 the morning run answers 200", r.status === 200, r.status);
    const brief = captured.find(c => c.path === "/emails" && JSON.stringify(c.body.to || "").includes("dana@fix34e.local"));
    const html = (brief && brief.body.html) || "";
    ok("§3 the morning email reached her at the sink", !!brief, captured.map(c => c.body && c.body.to));
    if (process.env.FIX34E_DUMP && html) require("fs").writeFileSync(process.env.FIX34E_DUMP, html);
    ok("§3 it carries today's task", /Ring the hall about chairs/.test(html), html.slice(0, 300));
    ok("§3 it carries today's meeting", /Your meetings today/.test(html) && /Coffee with Christine/.test(html));
    const link = (/href="[^"]*\/unsubscribe\?token=([^"&]+)"/.exec(html) || [])[1];
    ok("§3 it has an unsubscribe line", !!link);
    const pref = async () => (await q(`SELECT notify_daily_tasks, notify_thread_nudge FROM users WHERE id='u_f34e'`))[0];
    const auditN = async () => (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1`, [ORG]).catch(() => [{ n: -1 }]))[0].n;
    const a0 = await auditN();
    const gGet = await fetch(`${BASE}/unsubscribe?token=${link}`);
    const gHead = await fetch(`${BASE}/unsubscribe?token=${link}`, { method: "HEAD" });
    const p1 = await pref();
    ok("§3 GET and HEAD change nothing", gGet.status === 200 && gHead.status === 200 && p1.notify_daily_tasks !== false && p1.notify_thread_nudge !== false && (await auditN()) === a0, { p1 });
    const gPost = await fetch(`${BASE}/unsubscribe?token=${link}`, { method: "POST" });
    const p2 = await pref();
    ok("§3 POST turns the morning email off", gPost.status === 200 && p2.notify_daily_tasks === false && p2.notify_thread_nudge === false, p2);

    const D = await login("dana@fix34e-demo.local", "loadtest1234");
    captured.length = 0;
    await api("POST", "/nudges/run", D, { today, force: true });
    await new Promise(res => setTimeout(res, 400));
    ok("§3 a demo org sends nothing", !captured.some(c => JSON.stringify(c.body && c.body.to || "").includes("fix34e-demo")), captured.map(c => c.body && c.body.to));
  } finally {
    await reset().catch(() => {});
    await new Promise(res => sink.listening ? sink.close(() => res()) : res());
  }
}
module.exports = { run };
if (require.main === module) run().then(async()=>{await require("../helpers").closeDb();require("../helpers").summary();}).catch(async e=>{console.error(e);process.exit(1);});
