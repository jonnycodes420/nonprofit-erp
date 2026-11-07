// tests/sends1.test.js · SENDS-1. OFF MEANS NOTHING GOES OUT, ATLAS ASKS
// BEFORE IT SAVES, AND EVERY ACTION HAPPENS EXACTLY ONCE.
//
//   §1 Off: with the org's email off (the master), a full worker day (the
//      journey auto-send tick, the tracked-sequence tick and the older
//      sequence pass) over active journeys and sequences sends NOTHING (the
//      mail sink counts), each due step becomes a draft instead, no enrollment
//      is closed as "unsubscribed", and the status says Off. A sequence with an
//      empty step can't be turned on, and says why.
//   §2 Atlas: a call, a follow-up and a draft are a proposal; nothing is written
//      until Save; ten Saves at once write each item once; the draft is signed
//      and makes no task unless "remind me" is ticked.
//   §3 once: "Skip the next step" closes nothing (the follow-up it was opened
//      on included); one thank-you task per gift with ten writers at once; one
//      "Reassigned" record per owner change; Done on a move settles the
//      person's folded Drifting sign too.
//   §4 journeys: batch Undo leaves none of its step tasks; a birthday journey's
//      preview counts from the day the sweep would start it.
//   §5 never-giver: every starter rendered for someone with no gift, in every
//      renderer (send, preview, the editor's preview, the text part, the
//      subject), says neither "given before" nor "again".
//
// HOW IT WOULD GO RED (all seen red on main, see docs/history/SENDS-1.md):
// main sends nothing with Off but closes the enrollments as "unsubscribed" and
// writes no draft (§1), writes Atlas's call and reminder at once (§2), closes
// the follow-up a skip was opened on (§3), and leaves "given before" in the
// editor's preview (§5). Planted: mailPolicy.orgMailDecision reading Donor mail
// as on, so a journey step sends while Off, turns §1's zero-send red.
//
// Its own fixture org (org_sends1), made-up people, never the demo org.
"use strict";

const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT, mailTypesOn, waitFor } = require("./helpers");
const { civilDay } = require("./clock");

const ORG = "org_sends1";
const PW = "loadtest1234";
const sys = "'system:test','test'";
const ROOT = path.join(__dirname, "..");

const captured = [];
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        let j = {}; try { j = JSON.parse(body); } catch { /* not json */ }
        captured.push({ to: [].concat(j.to || []).join(","), subject: j.subject || "" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "sink_" + captured.length }));
      });
    });
    srv.once("error", () => resolve(null));
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}

async function reset() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
}

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
const ten = fn => Promise.all(Array.from({ length: 10 }, () => fn()));

(async () => {
  console.log("sends1 (SENDS-1)");
  const sink = await startSink();
  await reset();
  const pw = bcrypt.hashSync(PW, 4);
  // Donor mail (the master) is OFF. Everything under it is on.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,timezone_confirmed_at,receipt_address,emails_enabled,staff_mail_enabled)
           VALUES ($1,'Sends One Choir','sends-one-t',1,NOW(),'active','team','America/New_York',NOW(),'9 Linden Row, Portsmouth, NH 03801',false,NULL)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,sign_name,sign_title) VALUES ('u_s1_admin',$1,'s1-admin@sends1.example',$2,'Marisol Venn','admin','Marisol Venn','Executive Director')`, [ORG, pw]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_s1_other',$1,'s1-other@sends1.example',$2,'Teodor Lisk','admin')`, [ORG, pw]);
  const tok = await login("s1-admin@sends1.example");
  ok("fixture: signed in", !!tok, "");
  await mailTypesOn(ORG);
  const today = civilDay();
  const sendDay = nextWeekdayAfter(today);
  const PEOPLE = [["d_s1_a", "Wren Ashby"], ["d_s1_b", "Odile Farrow"], ["d_s1_c", "Piet Calder"], ["d_s1_d", "Juna Mercer"]];
  for (const [id, name] of PEOPLE) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name,auto_email) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,${sys},true)`,
      [id, ORG, name, id.slice(5) + "@sends1.example"]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,100,$4,'cash',${sys})`, ["g_" + id, ORG, id, addDays(today, -365)]);
  }

  // ── §1 OFF MEANS NOTHING GOES OUT ─────────────────────────────────────────
  console.log("\n§1 Off");
  const mk = await api("POST", "/email-templates", tok, { starterKey: "first_gift_welcome" });
  const TID = mk.body && mk.body.template && mk.body.template.id;
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps,trigger_key,created_by,created_by_name) VALUES ('ct_s1',$1,'Welcome, in one email',$2::jsonb,'by_hand',${sys})`,
    [ORG, JSON.stringify([{ type: "send", label: "Send the welcome", offsetDays: 0, draft: `template:${TID}` }])]);
  await api("PUT", `/email-templates/${TID}`, tok, { subject: "Welcome, {{first_name}}", publish: true });   // her own Save (AUTO-1)
  const autoOn = await api("POST", "/journeys/ct_s1/steps/0/auto", tok, { on: true, confirm: true });
  const ap = await api("POST", "/journeys/ct_s1/apply", tok, { donorIds: ["d_s1_a", "d_s1_b"] });
  const sched = await q(`SELECT id FROM journey_sends WHERE org_id=$1 AND status='scheduled'`, [ORG]);
  ok("fixture: a journey's email step set to send itself, scheduled for two people", autoOn.status === 200 && ap.status < 300 && sched.length === 2, { autoOn: autoOn.body, ap: ap.body, sched });
  // A tracked sequence (the builder's) and an older one, both Active, each with a step due now.
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status,tracks,created_by,created_by_name,turned_on_by,turned_on_by_name,turned_on_at)
           VALUES ('seq_s1_t',$1,'Spring welcome','first_gift','active','[{"key":"everyone","label":"Everyone","rule":"everyone_else"}]'::jsonb,${sys},'u_s1_admin','Marisol Venn',NOW())`, [ORG]);
  await q(`INSERT INTO sequence_steps (id,sequence_id,step_order,delay_days,subject,body,track_key) VALUES ('ss_s1_t1','seq_s1_t',1,0,'Welcome, {{first_name}}','Thank you for joining us, {{first_name}}.','everyone')`);
  await q(`INSERT INTO sequence_enrollments (id,sequence_id,org_id,donor_id,current_step,status,next_send_at,track_key,enrolled_at) VALUES ('se_s1_t','seq_s1_t',$1,'d_s1_c',0,'active',NOW() - INTERVAL '1 hour','everyone',NOW() - INTERVAL '1 day')`, [ORG]);
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status,created_by,created_by_name) VALUES ('seq_s1_l',$1,'Older welcome','manual','active',${sys})`, [ORG]);
  await q(`INSERT INTO sequence_steps (id,sequence_id,step_order,delay_days,subject,body) VALUES ('ss_s1_l1','seq_s1_l',1,0,'Hello from us','A note from all of us.')`);
  await q(`INSERT INTO sequence_enrollments (id,sequence_id,org_id,donor_id,current_step,status,next_send_at) VALUES ('se_s1_l','seq_s1_l',$1,'d_s1_d',0,'active',NOW() - INTERVAL '1 hour')`, [ORG]);

  // A full worker day: every tick that sends a journey or sequence step, at 9:30 on a weekday where the org is.
  const at = nyInstant(sendDay, 9, 30);
  const r1 = await api("POST", "/journey-sends/run", tok, { now: at });
  const r2 = await api("POST", "/sequences/tracked/run", tok, { now: at });
  const r3 = await api("POST", "/sequences/process", tok, {});
  await new Promise(r => setTimeout(r, 800));
  ok("§1 a worker day with Off: every tick ran", r1.status === 200 && r2.status === 200 && r3.status === 200, [r1.body, r2.body, r3.body]);
  ok("§1 and zero emails went out (the sink counted none)", captured.length === 0, captured);
  const js = await q(`SELECT status, reason FROM journey_sends WHERE org_id=$1 ORDER BY id`, [ORG]);
  ok("§1 each journey send is set aside with its reason (email is off), not left waiting", js.length === 2 && js.every(x => x.status === "skipped" && x.reason === "email_off"), js);
  const jd = await q(`SELECT donor_id FROM milestone_drafts WHERE org_id=$1 AND source='journey' ORDER BY donor_id`, [ORG]);
  ok("§1 and becomes a draft she sends herself, one per person", jd.map(x => x.donor_id).join(",") === "d_s1_a,d_s1_b", jd);
  const sd = await q(`SELECT donor_id, subject FROM milestone_drafts WHERE org_id=$1 AND source='sequence' ORDER BY donor_id`, [ORG]);
  ok("§1 each due sequence step (the builder's and the older one) becomes a draft too", sd.length === 2 && sd[0].donor_id === "d_s1_c" && /^Welcome/.test(sd[0].subject) && sd[1].donor_id === "d_s1_d", sd);
  const en = await q(`SELECT id, status FROM sequence_enrollments WHERE org_id=$1 ORDER BY id`, [ORG]);
  ok("§1 no enrollment is closed as unsubscribed: the person did nothing", en.every(e => e.status !== "unsubscribed" && e.status !== "stopped"), en);
  await api("POST", "/sequences/tracked/run", tok, { now: at });
  const sd2 = await q(`SELECT COUNT(*)::int AS n FROM milestone_drafts WHERE org_id=$1 AND source='sequence'`, [ORG]);
  ok("§1 a second tick writes no second draft", sd2[0].n === 2, sd2);
  const st = await api("GET", "/mail-types/status", tok);
  ok("§1 the top-bar status and Home say Off, with the chosen types named", st.body.state === "off" && st.body.chip === "Automatic email: Off" && /email is off for your organization/.test(st.body.home), st.body);

  // A sequence with an empty step or no trigger can't be Active.
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status,created_by,created_by_name) VALUES ('seq_s1_e',$1,'Empty one','manual','paused',${sys})`, [ORG]);
  await q(`INSERT INTO sequence_steps (id,sequence_id,step_order,delay_days,subject,body) VALUES ('ss_s1_e1','seq_s1_e',1,0,'Step one','')`);
  const pe = await api("PATCH", "/sequences/seq_s1_e/status", tok, { status: "active" });
  ok("§1 turning on a sequence whose step 1 is empty is refused, and says why", pe.status === 409 && /step 1 has no words/.test(pe.body.error || ""), pe.body);
  const ce = await api("POST", "/sequences", tok, { name: "Blank from the start", trigger: "manual", steps: [{ delayDays: 0, subject: "Hi", body: "  " }] });
  ok("§1 a new sequence with an empty step is saved Paused, with the reason", ce.status === 201 && ce.body.status === "paused" && /no words/.test(ce.body.notActive || ""), ce.body);
  await q(`INSERT INTO sequence_steps (id,sequence_id,step_order,delay_days,subject,body,track_key) VALUES ('ss_s1_te','seq_s1_t',2,3,'Second','','everyone')`);
  await q(`UPDATE sequences SET status='paused' WHERE id='seq_s1_t'`);
  const te = await api("POST", "/sequences/tracked/seq_s1_t/turn-on", tok, {});
  ok("§1 the builder's Turn on refuses an empty step too", te.status === 409 && /step 2 has no words/.test(te.body.message || ""), te.body);

  // ── §2 ATLAS ASKS BEFORE IT SAVES ─────────────────────────────────────────
  console.log("\n§2 Atlas proposes, she saves");
  const before = async () => (await q(`SELECT
      (SELECT COUNT(*)::int FROM interactions WHERE org_id=$1 AND donor_id='d_s1_a' AND type <> 'activity' AND created_by <> 'system:journey') AS ints,
      (SELECT COUNT(*)::int FROM tasks WHERE org_id=$1 AND voided_at IS NULL AND done=0 AND created_by NOT LIKE 'system:journey%' AND created_by <> 'system:test') AS tasks,
      (SELECT COUNT(*)::int FROM agent_drafts WHERE org_id=$1 AND donor_id='d_s1_a') AS drafts`, [ORG]))[0];
  await q(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside' WHERE org_id=$1 AND donor_id='d_s1_a'`, [ORG]);
  const w0 = await before();
  const t2 = await api("POST", "/atlas", tok, { donorId: "d_s1_a", text: "Had a call with Wren Ashby. Remind me to call her in January. Draft an email to Wren Ashby thanking her." });
  const rq = t2.body && t2.body.request;
  const items = (rq && rq.proposal && rq.proposal.items) || [];
  ok("§2 Atlas answers with one proposal listing the call, the follow-up and the draft", t2.status < 300 && !!rq && items.some(i => i.kind === "call") && items.some(i => i.kind === "follow_up") && items.some(i => i.kind === "draft"),
    { status: t2.status, items, lines: rq && rq.lines });
  const w1 = await before();
  ok("§2 nothing is written before Save", w1.ints === w0.ints && w1.tasks === w0.tasks && w1.drafts === w0.drafts, { w0, w1 });
  const draftItem = items.find(i => i.kind === "draft") || {};
  ok("§2 the draft carries her signature block", /Marisol Venn\nExecutive Director/.test(draftItem.body || ""), draftItem.body);
  const saves = await ten(() => api("POST", `/atlas/${rq && rq.id}/save`, tok, { proposalId: rq && rq.proposal && rq.proposal.id }));
  ok("§2 ten Saves at once: one writes, the rest say already saved", saves.filter(s => s.status === 201).length === 1 && saves.filter(s => s.status === 200 && s.body.already).length === 9, saves.map(s => s.status));
  const w2 = await before();
  ok("§2 Save writes each item once: one call, one follow-up, one draft", w2.ints === w0.ints + 1 && w2.tasks === w0.tasks + 1 && w2.drafts === w0.drafts + 1, { w0, w2, lines: ((saves.find(x => x.status === 201) || {}).body || {}).request && saves.find(x => x.status === 201).body.request.lines.map(l => l.line) });
  const dTask = await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND donor_id='d_s1_a' AND voided_at IS NULL AND done=0 AND title ~* 'draft|review'`, [ORG]);
  ok("§2 the draft made no task beside it (no \"remind me\" ticked)", dTask[0].n === 0, dTask);

  // ── §3 EVERY ACTION HAPPENS ONCE ──────────────────────────────────────────
  console.log("\n§3 once");
  const th = "thr_s1_skip";
  await q(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside' WHERE org_id=$1 AND donor_id='d_s1_b' AND closed_at IS NULL`, [ORG]);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,created_by,created_by_name) VALUES ($1,$2,'d_s1_b','call','Call about the spring visit',$3,$4,${sys})`,
    [th, ORG, addDays(today, 3), today]);
  for (const body of [{ touch: "call_reached", line: "We talked about the visit.", threadId: th, nextStep: { skipped: true } },
                      { touch: "note_only", line: "Prefers mornings.", nextStep: { skipped: true } }]) {
    await api("POST", "/donors/d_s1_b/conversations", tok, body);
  }
  const [thr] = await q(`SELECT closed_at FROM threads WHERE id=$1`, [th]);
  const [tk] = await q(`SELECT done FROM tasks WHERE thread_id=$1`, [th]);
  ok("§3 \"Skip the next step\" closes nothing, on the follow-up it was opened on or any other", thr && thr.closed_at == null && tk && Number(tk.done) === 0, { thr, tk });

  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
  const TY = require(path.join(ROOT, "server/shared/thankYouOnce.js"));
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_s1_new',$1,'d_s1_c',250,$2,'card',${sys})`, [ORG, today]);
  await q(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside' WHERE org_id=$1 AND donor_id='d_s1_c' AND closed_at IS NULL`, [ORG]);
  await ten(() => TY.thankYouTaskOnce({ orgId: ORG, donorId: "d_s1_c", giftId: "g_s1_new", title: "Send personal thank-you to Piet Calder for $250 online gift", actor: { id: "system:test", name: "test" } }));
  const tyc = await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND thanks_gift_id='g_s1_new' AND voided_at IS NULL`, [ORG]);
  ok("§3 one thank-you task per gift, with ten writers at once", tyc[0].n === 1, tyc);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,created_by,created_by_name) VALUES ('thr_s1_say',$1,'d_s1_c','thank','Say thank you',$2,$2,'system:journey','Steward (journey)')`, [ORG, today]);
  await TY.settleThankYous(ORG, "d_s1_c", "g_s1_new");
  const tyAll = await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND donor_id='d_s1_c' AND done=0 AND voided_at IS NULL AND title ~* 'thank'`, [ORG]);
  ok("§3 when the journey's \"Say thank you\" step opens, the gift has one thank-you, not two", tyAll[0].n === 1, tyAll);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_s1_two',$1,'d_s1_c',40,$2,'card',${sys})`, [ORG, today]);
  await TY.thankYouTaskOnce({ orgId: ORG, donorId: "d_s1_c", giftId: "g_s1_two", title: "Send personal thank-you", actor: { id: "system:test", name: "test" } });
  const tyTwo = await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND thanks_gift_id='g_s1_two'`, [ORG]);
  ok("§3 with a thank-you step already open, a webhook writes no second thank-you", tyTwo[0].n === 0, tyTwo);

  await ten(() => api("PATCH", "/donors/d_s1_d/assign", tok, { assignedTo: "u_s1_other" }));
  const ra = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id='d_s1_d' AND note ILIKE 'Reassigned%'`, [ORG]);
  ok("§3 one owner change (sent ten times at once) writes one Reassigned record", ra[0].n === 1, ra);
  const prof = require("fs").readFileSync(path.join(ROOT, "client/src/components/profile/useProfileActions.jsx"), "utf8");
  ok("§3 the profile writes no second Reassigned record of its own", !/Reassigned from/.test(prof), null);

  const done = await api("POST", "/insights/outcome", tok, { kind: "lapsing", itemKeys: ["lapsing:d_s1_d"], donorIds: ["d_s1_d"], lead: "d_s1_d", state: "done" });
  const oc = await q(`SELECT kind, item_key FROM insight_outcomes WHERE org_id=$1 AND state='done' ORDER BY kind`, [ORG]);
  ok("§3 Done on a move settles the move and the person's folded Drifting sign, so they do not rise again", done.status === 200
    && oc.some(o => o.kind === "lapsing") && oc.some(o => o.kind === "drift" && o.item_key === "d_s1_d"), oc);

  // ── §4 JOURNEYS ───────────────────────────────────────────────────────────
  console.log("\n§4 journeys");
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps,trigger_key,created_by,created_by_name) VALUES ('ct_s1_b',$1,'Spring calls',$2::jsonb,'by_hand',${sys})`,
    [ORG, JSON.stringify([{ type: "thank", label: "Call about spring", offsetDays: 1 }, { type: "follow_up", label: "Follow up", offsetDays: 20 }])]);
  for (const id of ["d_s1_a", "d_s1_b", "d_s1_c", "d_s1_d"]) await q(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside' WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, id]);
  const taskCount = async () => (await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND done=0 AND voided_at IS NULL AND donor_id IN ('d_s1_a','d_s1_b')`, [ORG]))[0].n;
  const tasks0 = await taskCount();
  const bt = await api("POST", "/journeys/ct_s1_b/batch", tok, { donorIds: ["d_s1_a", "d_s1_b"] });
  const bid = bt.body && (bt.body.batchId || (bt.body.batch && bt.body.batch.id));
  await waitFor(async () => { const b = await api("GET", `/journeys/batches`, tok); const x = ((b.body && b.body.batches) || []).find(y => y.id === bid); return x && x.status !== "running" ? x : null; }, { timeout: 15000 });
  const tasks1 = await taskCount();
  const un = await api("POST", `/journeys/batches/${bid}/undo`, tok, {});
  const tasks2 = await taskCount();
  ok("§4 the batch made step tasks, and its Undo leaves none of them", !!bid && tasks1 > tasks0 && un.status < 300 && tasks2 === tasks0, { bid, tasks0, tasks1, tasks2, un: un.body, bt: bt.body });

  const B = await import(path.join(ROOT, "shared/birthday.js"));
  const bday = addDays(today, 40);
  await q(`UPDATE donors SET birth_month=$2, birth_day=$3, created_at=NOW() - INTERVAL '3 years' WHERE id='d_s1_a' AND org_id=$1`, [ORG, Number(bday.slice(5, 7)), Number(bday.slice(8, 10))]);
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps,trigger_key,trigger_filters,created_by,created_by_name) VALUES ('ct_s1_bd',$1,'Birthday card',$2::jsonb,'birthday','{"daysBefore":7}'::jsonb,${sys})`,
    [ORG, JSON.stringify([{ type: "thank", label: "Mail a birthday card", offsetDays: 0 }])]);
  const pv = await api("GET", "/journeys/ct_s1_bd/preview", tok);
  const want = B.birthdayJourneyStart(Number(bday.slice(5, 7)), Number(bday.slice(8, 10)), today, 7);
  ok("§4 a birthday journey's preview starts on the day the run would (7 days before her birthday), not her join date or a gift",
    pv.status === 200 && pv.body.from === want && want === addDays(bday, -7) && (pv.body.steps || [])[0] && pv.body.steps[0].dueDate === want, { from: pv.body.from, want, steps: pv.body.steps, donor: pv.body.donor });

  // ── §5 NEVER-GIVER: NO "GIVEN BEFORE", NO "AGAIN" ─────────────────────────
  console.log("\n§5 every template, for someone who never gave");
  const EB = await import(path.join(ROOT, "shared/emailBlocks.js"));
  const LIB = await import(path.join(ROOT, "shared/emailTemplateLibrary.js"));
  const ET = await import(path.join(ROOT, "shared/emailTemplates.js"));
  const GS = await import(path.join(ROOT, "shared/giftSentence.js"));
  const never = { first_name: "Nell", donor_name: "Nell Quist", org_name: "Sends One Choir", last_gift_amount: "", gift_amount: "", lifetime_total: "", total_giving: "", give_link: "https://example.org/give" };
  const bad = [];
  const scan = (where, s) => { const t = String(s || "").replace(/data-st-keep="[^"]*"/g, ""); if (/given before/i.test(t) || /\bagain\b/i.test(t)) bad.push(`${where}: ${(t.match(/[^.>]*(given before|\bagain\b)[^.<]*/i) || [""])[0].trim()}`); };
  for (const st0 of LIB.EMAIL_STARTERS) {
    for (const [mode, editable] of [["preview", false], ["preview", true]]) {
      let r; try { r = EB.renderEmail({ blocks: st0.blocks, subject: st0.subject, fields: never, mode, editable }); } catch (e) { r = { html: "", text: "" }; }
      scan(`${st0.key} ${editable ? "editor preview" : mode}`, r.html); scan(`${st0.key} text`, r.text);
    }
    scan(`${st0.key} subject`, EB.renderSubject(st0.subject, never));
  }
  for (const tpl of ET.emailTemplates({ orgName: "Sends One Choir" })) {
    scan(`${tpl.key} (campaign preview)`, ET.renderMergeFields(tpl.body, { first_name: "Nell", org_name: "Sends One Choir", gift_amount: "", total_giving: "" }));
    scan(`${tpl.key} (send, draft)`, GS.withoutMissingGift(tpl.body, { hasGift: false, hasTotal: false }));
    scan(`${tpl.key} (sequence step)`, GS.withoutGivenBefore(tpl.body, { hasGift: false, orgName: "Sends One Choir" }));
    const asBlocks = [{ type: "richtext", blocks: [{ type: "p", text: tpl.body.replace(/<[^>]+>/g, "\n") }] }];
    const er = EB.renderEmail({ blocks: asBlocks, fields: never, mode: "preview", editable: true });
    scan(`${tpl.key} (editor preview)`, er.html);
  }
  ok("§5 no template says \"given before\" or \"again\" to someone who never gave, in any renderer", bad.length === 0, bad);

  ok("§1 nothing was sent to anyone, start to finish", captured.length === 0, captured);
  if (sink) sink.close();
  await reset();
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error("SUITE ERROR:", e); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
