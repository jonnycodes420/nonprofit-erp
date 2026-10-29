// tests/voice3-talk.test.js · VOICE-3. TALK TO STEWARD, AND MEETING MODE TAKEN OUT.
//
// Donor data in one suite:
//   §1 meeting mode is gone: its routes answer 404, its table is dropped (and
//      every transcript with it), its component and its shared file are gone,
//      and no screen calls them;
//   §2 "Before your meeting": a meeting with the person today or tomorrow
//      carries the brief from their own record (the route the profile, the
//      calendar and Home read); a meeting in three days does not; the
//      calendar's meeting carries the id the card matches on;
//   §3 a question: "Who should I call tomorrow?" is answered by Ask, the same
//      five names Ask gives, and nothing is written;
//   §4 something to do: "Remind me to call Tobias Friday" is the Agent's plan
//      (VOICE-4: a reminder is low stakes and runs at once, with Undo),
//      waiting for Confirm, and NOTHING is written before it; Confirm runs it;
//   §5 a mixed memo: the conversation is filed and the reminder is planned on
//      the same person ("send her" becomes Margaret), not run;
//   §6 unsure: the words alone do not say and the model cannot tell, so the
//      screen asks "log this, or have Steward do it?", and "Log it" files it;
//   §7 nothing was sent to anyone.
//
// It boots server.js IN-PROCESS because the model is a stand-in:
// ANTHROPIC_BASE_URL points at a local server.
//
// Against main this fails at §1 (the meeting routes answer, the table is
// there) and at §2 onward (/donors/:id/before-meeting and /voice/talk do not
// exist). Planted defects that turned it red: splitTalk sending "remind me"
// to the memo path (§4: a thread was written before Confirm), namePronouns
// returning the words unchanged (§5: the plan named nobody), the before-
// meeting window reaching three days (§2), and modelSplit trusting words the
// model made up (§6).
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const PORT = Number(process.env.MATRIX_PORT || 5699);
const MOCK = Number(process.env.CALENDAR_MOCK_PORT || 5618);
process.env.PORT = String(PORT);
process.env.BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_dummy_local";
process.env.RESEND_BASE_URL = process.env.RESEND_BASE_URL || "http://localhost:5602";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
process.env.ANTHROPIC_API_KEY = "sk-ant-voice3-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

// Every request this process makes to the outside, so §7 can prove nothing went out.
const OUTBOUND = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => { OUTBOUND.push(String(url && url.url || url)); return realFetch(url, opts); };

const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_voice3", SLUG = "voice3-test", ADMIN = "voice3-admin@example.org", USER = "u_voice3";
const ROOT = path.join(__dirname, "..");
const sys = "'system:test','test'";

// ── THE STAND-IN MODEL ─────────────────────────────────────────────────────
const queued = { memo_actions: [], talk_intent: [] };
const asked = [];
const memoRead = o => ({ how: "", when: "", summary: "", people: [], follow_ups: [], interests: [], email: { subject: "", body: "" },
  money: [], contact: [], sensitive: [], ...o });
// The Agent's plan: one task per person it was shown, titled from her words.
function planFor(user) {
  const said = (/Her instruction, verbatim: "([^"]*)"/.exec(user) || [])[1] || "";
  const people = [];
  for (const line of user.split("\n")) { const m = /^ {2}(d_[A-Za-z0-9_]+) \| ([^|]+) \|/.exec(line); if (m) people.push({ id: m[1], name: m[2].trim() }); }
  const base = { subject: null, body: null, note: null, stage: null, tag: null, label: null, due: null, dueDays: 3, priority: "medium", grantId: "", purpose: "" };
  return { steps: people.slice(0, 1).map(p => ({ ...base, tool: "create_task", donorId: p.id, citesRows: [p.id], title: said.replace(/^Remind me to /i, "").replace(/\.$/, "") })),
    sends: 0, headline: said.replace(/\.$/, ""), cannot: "" };
}
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    if (!req.url.startsWith("/v1/messages")) return send(404, {});
    let j = {}; try { j = JSON.parse(body); } catch { /* empty */ }
    const name = j.tools && j.tools[0] && j.tools[0].name;
    const user = (j.messages || []).map(m => (typeof m.content === "string" ? m.content : (m.content || []).map(c => c.text || "").join("\n"))).join("\n");
    asked.push({ name, user });
    const input = name === "plan" ? planFor(user)
      : (queued[name] && queued[name].shift()) || (name === "memo_actions" ? memoRead({}) : name === "talk_intent" ? { happened: "", to_do: "", question: "" } : {});
    send(200, { id: "msg_standin", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name, input }] });
  });
});

const TABLES = ["voice_memos", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "ai_log", "threads", "interactions", "tasks",
  "calendar_events", "opportunities", "pledges", "fin_transactions", "gifts", "donors", "user_sessions", "users", "fin_funds", "ai_usage", "ai_fallbacks"];
async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
const n = async sql => (await q(sql, [ORG]))[0].n;
// Every row a to-do could write, in one count.
const writes = async () => n(`SELECT ((SELECT COUNT(*) FROM tasks WHERE org_id=$1) + (SELECT COUNT(*) FROM threads WHERE org_id=$1)
  + (SELECT COUNT(*) FROM interactions WHERE org_id=$1) + (SELECT COUNT(*) FROM agent_writes WHERE org_id=$1)
  + (SELECT COUNT(*) FROM agent_runs WHERE org_id=$1) + (SELECT COUNT(*) FROM agent_drafts WHERE org_id=$1))::int AS n`);

(async () => {
  console.log("voice3-talk (VOICE-3)");
  const T = await import("../shared/voiceTalk.js");

  await new Promise(r => mock.listen(MOCK, r));
  require("../server.js");
  await require("./helpers").untilReady();   // FIX-57: the server says when boot is done
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled)
           VALUES ($1,'Voice Three Rowing',$2,1,'active','team','America/New_York',NOW(),false)`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, ADMIN, pw]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,total_giving,first_gift_date,last_gift_amount,last_gift_date,created_by,created_by_name) VALUES
           ('d_v3_mchen',$1,'Margaret Chen','mchen@example.org','active','["donor"]'::jsonb,2500,'2021-03-01',500,$2,${sys}),
           ('d_v3_tobias',$1,'Tobias Fairweather','tobias@example.org','active','["donor"]'::jsonb,0,NULL,NULL,NULL,${sys}),
           ('d_v3_ansel',$1,'Ansel Pendlebury','ansel@example.org','active','["donor"]'::jsonb,0,NULL,NULL,NULL,${sys}),
           ('d_v3_rosa',$1,'Rosa Ibarra','rosa@example.org','active','["donor"]'::jsonb,0,NULL,NULL,NULL,${sys})`, [ORG, civilToday()]);
  const tok = await login(ADMIN);
  ok("fixture admin signed in", !!tok, tok);
  const today = civilToday();
  const plus = d => { const t = new Date(today + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

  // ── §1 meeting mode is gone ──────────────────────────────────────────────
  console.log("\n§1 meeting mode is gone");
  const r1 = [await api("GET", "/voice/meetings/open", tok), await api("POST", "/voice/meetings", tok, { consent: true }),
    await api("GET", "/voice/meetings/brief", tok), await api("POST", "/voice/meetings/vmt_x/ask", tok, { question: "What did she say?" })];
  ok("§1 every meeting route answers 404", r1.every(r => r.status === 404), r1.map(r => r.status));
  const tbl = await q(`SELECT to_regclass('public.voice_meetings') AS t`);
  ok("§1 the voice_meetings table, and every transcript in it, is gone", tbl[0].t === null, tbl);
  ok("§1 MeetingMode.jsx and shared/voiceMeeting.js are deleted",
    !fs.existsSync(path.join(ROOT, "client/src/components/MeetingMode.jsx")) && !fs.existsSync(path.join(ROOT, "shared/voiceMeeting.js")), null);
  const callers = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") walk(p); }
    else if (/\.(jsx?|mjs)$/.test(e.name) && /voice\/meetings|voiceMeeting|MeetingMode|Listen to this meeting/.test(fs.readFileSync(p, "utf8"))) callers.push(path.relative(ROOT, p)); } };
  for (const d of ["client/src", "routes", "shared"]) walk(path.join(ROOT, d));
  ok("§1 no screen, route or shared file mentions meeting mode", callers.length === 0, callers);

  // ── §2 before your meeting ───────────────────────────────────────────────
  console.log("\n§2 Before your meeting");
  const at = (day, hm) => `(($1::date + $2::time)::timestamp AT TIME ZONE 'America/New_York')`.replace("$1", `'${day}'`).replace("$2", `'${hm}'`);
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,created_by,created_by_name) VALUES
    ('ce_v3_tom',$1,$2,'steward','ce_v3_tom','Lunch',${at(plus(1), "12:00")},${at(plus(1), "13:00")},'The Boathouse',ARRAY['d_v3_mchen'],$2,'Dana Reyes'),
    ('ce_v3_now',$1,$2,'steward','ce_v3_now','Coffee',NOW() - interval '5 minutes',NOW() + interval '55 minutes',NULL,ARRAY['d_v3_ansel'],$2,'Dana Reyes'),
    ('ce_v3_far',$1,$2,'steward','ce_v3_far','Tour',${at(plus(3), "10:00")},${at(plus(3), "11:00")},NULL,ARRAY['d_v3_tobias'],$2,'Dana Reyes')`, [ORG, USER]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_v3_m1',$1,'d_v3_mchen',500,$2,'cash',${sys})`, [ORG, today]);
  const bm = await api("GET", "/donors/d_v3_mchen/before-meeting", tok);
  ok("§2 a lunch tomorrow carries the brief", bm.status === 200 && bm.body.meeting && bm.body.meeting.id === "ce_v3_tom" && bm.body.meeting.day === "tomorrow"
    && bm.body.brief && bm.body.brief.giving && /\$2,500/.test(bm.body.brief.giving.text), bm.body);
  ok("§2 the gift not yet thanked is one of its facts", !!(bm.body.brief && bm.body.brief.unthanked), bm.body.brief);
  const ba = await api("GET", "/donors/d_v3_ansel/before-meeting", tok);
  ok("§2 a coffee going on now, today, shows too", ba.status === 200 && ba.body.meeting && ba.body.meeting.day === "today", ba.body);
  const bt = await api("GET", "/donors/d_v3_tobias/before-meeting", tok);
  ok("§2 a tour in three days does not", bt.status === 200 && bt.body.meeting === null, bt.body);
  const cal = await api("GET", `/calendar/items?from=${today}&to=${plus(2)}`, tok);
  const calItem = (cal.body.items || []).find(i => i.type === "meeting" && i.ref && i.ref.calendarEventId === "ce_v3_tom");
  ok("§2 the calendar's lunch carries the id the card matches on", !!calItem && calItem.donorId === "d_v3_mchen", (cal.body.items || []).map(i => [i.type, i.ref && i.ref.calendarEventId]));
  const prof = fs.readFileSync(path.join(ROOT, "client/src/components/DonorProfile.jsx"), "utf8");
  const calJsx = fs.readFileSync(path.join(ROOT, "client/src/components/Calendar.jsx"), "utf8");
  ok("§2 the profile and the calendar both draw the one card", /useBeforeMeeting\(donor\?\.id(, toldNonce)?\)/.test(prof) && /<BeforeYourMeeting data=\{briefHere\}/.test(calJsx), null);

  // ── §3 a question ────────────────────────────────────────────────────────
  console.log("\n§3 Who should I call tomorrow?");
  // Six people who gave in this month last year and nothing since.
  const ly = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}-05`;
  for (let i = 1; i <= 6; i++) {
    await q(`INSERT INTO donors (id,org_id,name,stage,person_types,created_by,created_by_name) VALUES ($2,$1,$3,'active','["donor"]'::jsonb,${sys})`, [ORG, `d_v3_s${i}`, `Season Giver ${i}`]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($2,$1,$3,$4,$5,'cash',${sys})`, [ORG, `g_v3_s${i}`, `d_v3_s${i}`, 100 * i, ly]);
  }
  const w0 = await writes();
  const direct = await api("POST", "/ask", tok, { text: "Who should I call tomorrow?" });
  const talkQ = await api("POST", "/voice/talk", tok, { text: "Who should I call tomorrow", source: "speech" });
  const names = a => JSON.stringify(a || {}).match(/Season Giver \d|Margaret Chen|Ansel Pendlebury/g) || [];
  const askNames = [...new Set(names(direct.body))], talkNames = [...new Set(names(talkQ.body.answer))];
  ok("§3 it is a question, answered by Ask", talkQ.status === 200 && talkQ.body.talk.kind === "ask" && !!talkQ.body.answer && !talkQ.body.memo && !talkQ.body.plan, talkQ.body.talk);
  ok("§3 the same five names Ask gives", talkNames.length === 5 && JSON.stringify(talkNames) === JSON.stringify(askNames), { talkNames, askNames });
  ok("§3 a question writes nothing", await writes() === w0, null);

  // ── §4 something to do ───────────────────────────────────────────────────
  console.log("\n§4 Remind me to call Tobias Friday");
  const d1 = await api("POST", "/voice/talk", tok, { text: "Remind me to call Tobias Friday", source: "speech" });
  const plan = d1.body.plan || {};
  ok("§4 it is something to do, planned by the Agent", d1.status === 201 && d1.body.talk.kind === "do" && plan.status === 201 && !!plan.id
    && plan.plan && plan.plan.steps.length === 1 && plan.plan.steps[0].donorId === "d_v3_tobias", { talk: d1.body.talk, plan });
  // VOICE-4: a reminder is low stakes, so it runs at once and is listed with
  // the one Undo (it waited for Confirm in VOICE-3). Money and personal details
  // still wait (voice4-does-it-all).
  const tasks = await q(`SELECT id, donor_id, title FROM tasks WHERE org_id=$1 AND donor_id='d_v3_tobias' AND link_kind IS NULL AND voided_at IS NULL`, [ORG]);
  ok("§4 a reminder runs at once: the task is on Tobias, listed with Undo", plan.ranAlone === true && !!d1.body.memo && tasks.length === 1 && /call Tobias/i.test(tasks[0].title), { ranAlone: plan.ranAlone, tasks });
  const und = await api("POST", `/voice/memos/${d1.body.memo.id}/undo`, tok, {});
  const left = await q(`SELECT 1 FROM tasks WHERE org_id=$1 AND donor_id='d_v3_tobias' AND link_kind IS NULL AND done=0 AND voided_at IS NULL`, [ORG]);
  ok("§4 and Undo takes it back", und.status === 200 && left.length === 0, { und: und.body, left });

  // ── §5 a mixed memo ──────────────────────────────────────────────────────
  console.log("\n§5 Coffee with Margaret went great, remind me to send her the boat photos Friday");
  queued.memo_actions.push(memoRead({ how: "coffee", summary: "Coffee with Margaret went great.", people: ["Margaret"] }));
  const mx = await api("POST", "/voice/talk", tok, { text: "Coffee with Margaret went great, remind me to send her the boat photos Friday", source: "speech" });
  const conv = await q(`SELECT donor_id, note FROM interactions WHERE org_id=$1 AND donor_id='d_v3_mchen' AND type IN ('meeting','call','note') ORDER BY created_at DESC LIMIT 1`, [ORG]);
  ok("§5 the conversation is filed on Margaret", mx.status === 201 && mx.body.talk.kind === "mixed" && mx.body.memo && mx.body.memo.people[0].id === "d_v3_mchen"
    && conv.length === 1 && /Coffee with Margaret went great/.test(conv[0].note) && !/boat photos/.test(conv[0].note), { talk: mx.body.talk, conv });
  const mp = mx.body.plan || {};
  ok("§5 the reminder is planned on her (\"send her\" became Margaret Chen)", mp.status === 201 && /send Margaret Chen the boat photos/i.test(mp.text)
    && mp.plan && mp.plan.steps.length === 1 && mp.plan.steps[0].donorId === "d_v3_mchen", mp);
  ok("§5 the reminder ran as part of the same memo (one Undo for both)", mp.ranAlone === true && mp.memoId === mx.body.memo.id
    && await n(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND donor_id='d_v3_mchen'`) > 0, { ranAlone: mp.ranAlone, memoId: mp.memoId });

  // ── §6 unsure ────────────────────────────────────────────────────────────
  console.log("\n§6 log this, or have Steward do it?");
  ok("§6 the words alone do not say", T.splitTalk("Margaret boat photos Friday").kind === null, T.splitTalk("Margaret boat photos Friday"));
  queued.talk_intent.push({ happened: "", to_do: "", question: "" });
  const w6 = await writes();
  const un = await api("POST", "/voice/talk", tok, { text: "Margaret boat photos Friday" });
  ok("§6 the model cannot tell either, so Steward asks", un.status === 200 && un.body.talk.kind === "unsure" && un.body.talk.sentence === "Did you mean to log this, or have Steward do it?", un.body);
  ok("§6 asking writes nothing", await writes() === w6, null);
  queued.talk_intent.push({ happened: "", to_do: "Book the regatta marquee for Margaret", question: "" });
  const made = await api("POST", "/voice/talk", tok, { text: "Margaret boat photos Friday" });
  ok("§6 words the model made up are not trusted: still asks", made.status === 200 && made.body.talk.kind === "unsure", made.body.talk);
  queued.memo_actions.push(memoRead({ how: "", summary: "Margaret boat photos Friday.", people: ["Margaret"] }));
  const asLog = await api("POST", "/voice/talk", tok, { text: "Margaret boat photos Friday", as: "log" });
  ok("§6 \"Log it\" files it as what happened", asLog.status === 201 && asLog.body.talk.kind === "log" && asLog.body.memo && !asLog.body.plan, asLog.body.talk);
  ok("§6 the model was asked to sort it only when the words did not say", asked.filter(a => a.name === "talk_intent").length === 2, asked.map(a => a.name));

  // ── §7 nothing sent ──────────────────────────────────────────────────────
  console.log("\n§7 nothing sent");
  const out = OUTBOUND.filter(u => !u.startsWith(`http://localhost:${MOCK}`) && !u.startsWith(`http://127.0.0.1:${PORT}`) && !u.startsWith(`http://localhost:${PORT}`));
  ok("§7 no email, no message, nothing to anyone: only the stand-in model and Steward itself were called", out.length === 0, out);
  ok("§7 no draft went out", await n(`SELECT COUNT(*)::int AS n FROM agent_drafts WHERE org_id=$1 AND status='sent'`) === 0, null);

  mock.close();
  await reset();
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error("SUITE ERROR:", e); mock.close(); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
