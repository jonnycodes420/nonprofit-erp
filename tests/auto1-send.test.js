// tests/auto1-send.test.js · AUTO-1. A JOURNEY EMAIL STEP THAT SENDS ITSELF.
//
// Donor mail in one suite, against the booted server and its mail sink:
//   §1 who may turn it on: not for words nobody here saved (a starter, or an
//      AI proposal nobody saved), not a super-admin, and only with the confirm;
//      the confirm says the words and about how many people in 7 days
//   §2 when: nothing on a weekend, nothing before 9 or after 11, and an
//      eligible person gets exactly one email inside the window
//   §3 who is skipped, each with a reason on their timeline: a client, an
//      unsubscribed person, someone touched this week, someone who gave two
//      days ago; an empty merge field is held with a task
//   §4 Skip, and Pause all, stop the send
//   §5 the daily cap holds, and the owner hears once
//   §6 a demo org sends nothing
//
// Against main it fails at §1: the switch route does not exist. Planted
// defects that turned it red: the words-saved check removed (§1), the window
// hour widened to 8 (§2), the gave-recently rule removed (§3), the pause read
// dropped from the tick (§4), the cap compared with <= (§5).
"use strict";

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");
const { civilDay } = require("./clock");

const ORG = "org_auto1", DEMO = "org_auto1demo";
const PW = "loadtest1234";
const sys = "'system:test','test'";

const captured = [];
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        let j = {}; try { j = JSON.parse(body); } catch { /* not json */ }
        captured.push({ url: req.url, to: [].concat(j.to || []).join(","), subject: j.subject || "" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "sink_" + captured.length }));
      });
    });
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}
const sentTo = addr => captured.filter(c => c.to.includes(addr)).length;

async function reset() {
  for (const o of [ORG, DEMO]) {
    const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name NOT IN ('orgs','fin_audit_log')`).catch(() => []);
    for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM email_suppressions WHERE email LIKE '%@auto1.example'`).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

// A civil day and an hour in New York, as an instant.
function nyInstant(day, hh, mm = 0) {
  for (const off of [4, 5]) {
    const d = new Date(`${day}T${String(hh + off).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(d));
    if (h === hh) return d.toISOString();
  }
  throw new Error("no NY instant for " + day);
}
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = day => new Date(day + "T12:00:00Z").getUTCDay();
function nextWeekdayAfter(day) { let d = addDays(day, 1); while ([0, 6].includes(weekday(d))) d = addDays(d, 1); return d; }

(async () => {
  console.log("auto1-send (AUTO-1)");
  const sink = await startSink();
  await reset();
  const pw = bcrypt.hashSync(PW, 4);
  for (const [o, demo] of [[ORG, false], [DEMO, true]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,timezone_confirmed_at,receipt_address,client_privacy,is_demo_org)
             VALUES ($1,$2,$3,1,NOW(),'active','team','America/New_York',NOW(),'12 Harbor Rd, Wilmington, NC 28401',true,$4)`, [o, demo ? "Auto One Demo" : "Auto One Rowing", o.replace(/_/g, "-"), demo]);
  }
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_a1_admin',$1,'a1-admin@auto1.example',$2,'Dana Reyes','admin')`, [ORG, pw]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_a1_member',$1,'a1-member@auto1.example',$2,'Priya Raman','member')`, [ORG, pw]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_a1_super',$1,'a1-support@auto1.example',$2,'Support','admin',true)`, [ORG, pw]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_a1_demo',$1,'a1-demo@auto1.example',$2,'Demo Admin','admin')`, [DEMO, pw]);
  const tok = await login("a1-admin@auto1.example"), tokMember = await login("a1-member@auto1.example");
  const tokSuper = await login("a1-support@auto1.example"), tokDemo = await login("a1-demo@auto1.example");
  ok("fixture: four people signed in", !!(tok && tokMember && tokSuper && tokDemo), "");

  const today = civilDay();
  const sendDay = nextWeekdayAfter(today);
  const PEOPLE = [
    ["d_a1_ok1", "Ada Okafor"], ["d_a1_ok2", "Ben Ruiz"], ["d_a1_client", "Cal Client"], ["d_a1_unsub", "Una Subscribe"],
    ["d_a1_touch", "Tia Touched"], ["d_a1_gave", "Gus Gave"], ["d_a1_skip", "Sky Skipped"], ["d_a1_nogift", "Nora Nogift"], ["d_a1_pause", "Pat Paused"],
  ];
  for (const [id, name] of PEOPLE) {
    const email = id.slice(5) + "@auto1.example";
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,is_client,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,$5,${sys})`,
      [id, ORG, name, email, id === "d_a1_client"]);
    // A gift a year ago for everyone (so {{last_gift_amount}} fills), except Nora.
    if (id !== "d_a1_nogift") await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,100,$4,'cash',${sys})`,
      ["g_" + id, ORG, id, addDays(today, -365)]);
  }
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_a1_recent',$1,'d_a1_gave',50,$2,'cash',${sys})`, [ORG, addDays(sendDay, -2)]);
  await q(`INSERT INTO email_suppressions (id,org_id,email,reason,source) VALUES ('sup_a1',$1,'unsub@auto1.example','unsubscribed','test')`, [ORG]);
  await q(`INSERT INTO journey_sends (id,org_id,template_id,plan_id,step_id,seq,donor_id,email_template_id,auto_step_id,send_on,status,sent_at,sent_day,created_by,created_by_name)
           VALUES ('js_a1_prior',$1,'ct_other','cp_other','cps_other',0,'d_a1_touch','et_other','ja_other',$2,'sent',NOW() - INTERVAL '2 days',$2,${sys})`, [ORG, addDays(today, -2)]);

  // The template, from a starter, and the journey with one email step.
  const mk = await api("POST", "/email-templates", tok, { starterKey: "first_gift_welcome" });
  const TID = mk.body && mk.body.template && mk.body.template.id;
  ok("fixture: a template from a starter", !!TID, mk.body);
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps,trigger_key,created_by,created_by_name) VALUES ('ct_a1',$1,'First year, in one email',$2::jsonb,'by_hand',${sys})`,
    [ORG, JSON.stringify([{ type: "send", label: "Send the welcome", offsetDays: 0, draft: `template:${TID}` }])]);

  // ── §1 who may turn it on ─────────────────────────────────────────────────
  console.log("\n§1 turning it on");
  const unsaved = await api("POST", "/journeys/ct_a1/steps/0/auto", tok, { on: true, confirm: true });
  ok("§1 starter words nobody here saved cannot send automatically", unsaved.status === 409 && /save its words yourself/.test(unsaved.body.sentence || ""), unsaved.body);
  await api("POST", `/email-templates/${TID}/draft-ai`, tok, { instructions: "warmer" });
  const afterAi = await api("POST", "/journeys/ct_a1/steps/0/auto", tok, { on: true, confirm: true });
  ok("§1 an AI proposal nobody saved does not count either", afterAi.status === 409, afterAi.body);
  const saved = await api("PUT", `/email-templates/${TID}`, tok, { subject: "Thank you for {{last_gift_amount}}, {{first_name}}", publish: true });
  ok("§1 her own Save stamps who wrote the words", saved.status === 200 && saved.body.template && (await q(`SELECT words_saved_by_name FROM email_templates WHERE id=$1`, [TID]))[0].words_saved_by_name === "Dana Reyes", saved.body);
  const bySuper = await api("POST", "/journeys/ct_a1/steps/0/auto", tokSuper, { on: true, confirm: true });
  ok("§1 a super-admin cannot turn it on", bySuper.status === 403 && bySuper.body.error === "turn_on_must_be_theirs", bySuper.body);
  const byMember = await api("POST", "/journeys/ct_a1/steps/0/auto", tokMember, { on: true, confirm: true });
  ok("§1 a member cannot either: owners and admins only", byMember.status === 403, byMember.status);
  const noConfirm = await api("POST", "/journeys/ct_a1/steps/0/auto", tok, { on: true });
  ok("§1 not without the confirm", noConfirm.status === 400 && noConfirm.body.error === "confirm_first", noConfirm.body);
  const state = await api("GET", "/journeys/ct_a1/auto", tok);
  const st0 = state.body.steps && state.body.steps[0];
  ok("§1 the confirm shows the step's words and about how many people in 7 days",
    !!st0 && /Thank you for/.test(st0.words.subject) && /^About \d+ (person|people) will get this in the next 7 days\.$/.test(st0.sentence), st0);
  const on = await api("POST", "/journeys/ct_a1/steps/0/auto", tok, { on: true, confirm: true });
  ok("§1 an admin turns it on", on.status === 200 && on.body.step.on === true, on.body);
  const aud = await q(`SELECT summary FROM fin_audit_log WHERE org_id=$1 AND summary LIKE 'Turned on automatic sending%' AND created_at > NOW() - INTERVAL '2 minutes'`, [ORG]);
  ok("§1 turning it on writes an audit row", aud.length >= 1, aud);

  // Everyone joins; each step opens and is scheduled for the next weekday.
  const ap = await api("POST", "/journeys/ct_a1/apply", tok, { donorIds: PEOPLE.map(p => p[0]) });
  const sched = await q(`SELECT donor_id, send_on, status FROM journey_sends WHERE org_id=$1 AND template_id='ct_a1'`, [ORG]);
  ok("§1 each person's step is scheduled for the next weekday morning, not today", ap.status < 300 && sched.length === PEOPLE.length
    && sched.every(s => s.status === "scheduled" && s.send_on === sendDay), { ap: ap.status, sched });
  const drafts = await q(`SELECT COUNT(*)::int AS n FROM milestone_drafts WHERE org_id=$1 AND source='journey'`, [ORG]);
  ok("§1 and no review draft is written beside it (it would be a second copy)", drafts[0].n === 0, drafts);

  // ── §2 when ───────────────────────────────────────────────────────────────
  console.log("\n§2 when it sends");
  let sat = sendDay; while (weekday(sat) !== 6) sat = addDays(sat, 1);
  const run = (now, extra = {}) => api("POST", "/journey-sends/run", tok, { now, ...extra });
  await run(nyInstant(sat, 10));
  ok("§2 nothing on a Saturday morning", captured.length === 0, captured);
  await run(nyInstant(sendDay, 8, 30));
  ok("§2 nothing at 8:30", captured.length === 0, captured);
  await run(nyInstant(sendDay, 11, 15));
  ok("§2 nothing at 11:15", captured.length === 0, captured);

  // ── §4 Skip and Pause all ─────────────────────────────────────────────────
  console.log("\n§4 Skip and Pause all");
  const tomorrow = await api("GET", "/journeys/ct_a1/sending-tomorrow", tok);
  ok("§4 Sending tomorrow lists everyone waiting", tomorrow.status === 200 && tomorrow.body.sends.length === PEOPLE.length, tomorrow.body);
  const skipRow = tomorrow.body.sends.find(s => s.donorId === "d_a1_skip");
  const sk = await api("POST", `/journey-sends/${skipRow.id}/skip`, tokMember);
  ok("§4 anybody here can Skip one", sk.status === 200, sk.body);
  const notice = await api("GET", "/journey-sends/notice", tok);
  ok("§4 the Thread line says how many go, and when", /^Steward will send \d+ emails? (tomorrow|on \w+day) at 9 AM\.$/.test(notice.body.notice && notice.body.notice.sentence || ""), notice.body);
  await api("POST", "/auto-send/pause", tok, { paused: true });
  const pausedRun = await run(nyInstant(sendDay, 9, 30));
  ok("§4 Pause all: nothing goes, inside the window", captured.length === 0 && pausedRun.body.sent === 0, pausedRun.body);
  // Pat's own send is skipped while paused, by hand, to prove the pause did not consume it.
  ok("§4 and nothing waiting was used up", (await q(`SELECT COUNT(*)::int AS n FROM journey_sends WHERE org_id=$1 AND status='scheduled'`, [ORG]))[0].n === PEOPLE.length - 1, "");
  await api("POST", "/auto-send/pause", tok, { paused: false });

  // ── §5 the cap, then §2 exactly once, then §3 the reasons ──────────────────
  console.log("\n§5 the daily cap");
  const capped = await run(nyInstant(sendDay, 9, 30), { cap: 1 });
  ok("§5 with a cap of one, exactly one email goes", captured.length === 1 && capped.body.sent === 1, { capped: capped.body, captured });
  const again = await run(nyInstant(sendDay, 9, 40), { cap: 1 });
  ok("§5 a second pass the same day sends nothing more", captured.length === 1 && again.body.sent === 0, again.body);
  const capTask = await q(`SELECT title FROM tasks WHERE org_id=$1 AND title LIKE 'Steward sent 1 journey emails today%'`, [ORG]);
  ok("§5 the owner gets one note about the cap", capTask.length === 1, capTask);

  console.log("\n§2 exactly once");
  await run(nyInstant(sendDay, 9, 50));
  await run(nyInstant(sendDay, 10, 0));
  ok("§2 each eligible person got exactly one email", sentTo("ok1@auto1.example") === 1 && sentTo("ok2@auto1.example") === 1 && sentTo("pause@auto1.example") === 1, captured.map(c => c.to));
  const line = await q(`SELECT note, metadata FROM interactions WHERE org_id=$1 AND donor_id='d_a1_ok1' AND type='email'`, [ORG]);
  ok("§2 the send is on their timeline, marked sent automatically, with who turned it on",
    line.length === 1 && /sent automatically, turned on by Dana Reyes/.test(line[0].note) && line[0].metadata.sent_automatically === true, line);
  // The log is append-only, so this run's rows are found by this run's sends.
  const auditSend = await q(`SELECT summary FROM fin_audit_log WHERE org_id=$1 AND entity_type='journey_send' AND entity_id IN (SELECT id FROM journey_sends WHERE org_id=$1 AND status='sent')`, [ORG]);
  ok("§2 and in the audit log, marked sent automatically", auditSend.length === 3 && auditSend.every(a => /^Sent automatically/.test(a.summary)), auditSend);
  const stepDone = await q(`SELECT s.status FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id=s.plan_id WHERE p.donor_id='d_a1_ok1' AND p.template_id='ct_a1'`);
  ok("§2 the step is done, as a logged email makes it", stepDone.length === 1 && stepDone[0].status === "done", stepDone);

  console.log("\n§3 who is skipped");
  const rows = new Map((await q(`SELECT donor_id, status, reason FROM journey_sends WHERE org_id=$1 AND template_id='ct_a1'`, [ORG])).map(r => [r.donor_id, r]));
  const want = { d_a1_client: "client", d_a1_unsub: "unsubscribed", d_a1_touch: "touched_this_week", d_a1_gave: "gave_recently", d_a1_skip: "skipped_by_person" };
  for (const [id, reason] of Object.entries(want)) {
    const r = rows.get(id);
    ok(`§3 ${id.slice(5)}: skipped, ${reason}`, !!r && r.status === "skipped" && r.reason === reason && sentTo(id.slice(5) + "@auto1.example") === 0, r);
  }
  const why = await q(`SELECT donor_id, note FROM interactions WHERE org_id=$1 AND note LIKE 'Journey email not sent automatically:%'`, [ORG]);
  ok("§3 each skip has its reason on the person's timeline", Object.keys(want).every(id => why.some(w => w.donor_id === id)), why.map(w => w.donor_id));
  const held = rows.get("d_a1_nogift");
  const heldTask = await q(`SELECT title FROM tasks WHERE org_id=$1 AND donor_id='d_a1_nogift' AND title LIKE 'Write to %'`, [ORG]);
  ok("§3 an empty merge field is held for that person, with a task, and not sent",
    held && held.status === "held" && /last_gift_amount/.test(held.reason) && heldTask.length === 1 && sentTo("nogift@auto1.example") === 0, { held, heldTask });

  // ── §6 a demo org ─────────────────────────────────────────────────────────
  console.log("\n§6 a demo org");
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES ('d_a1_demo',$1,'Dee Demo','demo@auto1.example','active','["donor"]'::jsonb,${sys})`, [DEMO]);
  await q(`INSERT INTO journey_sends (id,org_id,template_id,plan_id,step_id,seq,donor_id,email_template_id,auto_step_id,send_on,status,created_by,created_by_name)
           VALUES ('js_a1_demo',$1,'ct_demo','cp_demo','cps_demo',0,'d_a1_demo','et_demo','ja_demo',$2,'scheduled',${sys})`, [DEMO, sendDay]);
  const before = captured.length;
  const demoRun = await api("POST", "/journey-sends/run", tokDemo, { now: nyInstant(sendDay, 9, 30) });
  ok("§6 a demo org sends nothing, even inside the window", captured.length === before && demoRun.body.sent === 0
    && (await q(`SELECT status FROM journey_sends WHERE id='js_a1_demo'`))[0].status === "scheduled", demoRun.body);

  sink.close();
  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); try { await reset(); await closeDb(); } catch { /* */ } process.exit(1); });
