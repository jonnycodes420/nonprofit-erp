// tests/voice4-does-it-all.test.js · VOICE-4. TELL STEWARD DOES IT ALL, AND THE SCREEN KEEPS UP.
//
// Donor data, money and email in one suite, on Jonathan's own memo from prod
// (21 Oct): "Lunch with Margaret went well, she gave $5000, log that, then
// send her the receipt", with a 10 AM coffee on her calendar today and Sep
// 19's "Coffee tomorrow. Bring Lily's class schedule." open on her Thread.
//   §1 the memo: the conversation is filed, the coffee is marked happened and
//      linked to it, its brief closes and the step waiting on it is done;
//      "Log the gift" is never a task and NO existing task or step is rewritten;
//      the gift waits for her yes and nothing is sent;
//   §2 Yes on the gift goes through the Add Gift route: Last gift $5,000, This
//      year $45,000, Lifetime $192,500, Average over 14 gifts, Largest still
//      $15,000; it waits for a thank-you; the receipt and thank-you wait as ONE
//      card; a receipt task shows "$5,000 gift", never the open ask;
//   §3 that card's Confirm sends both, to the donor only, and closes the task;
//   §4 "Put her in the Major donor journey" runs at once, and Undo takes it back;
//      a name that is not one is offered as the closest two, and nothing runs;
//      "do not email" and "change her ask" wait as cards;
//   §5 Do all of this: every card in one tap, and ONE Undo reverses them all;
//   §6 a gift with no campaign picked has none, and a pledge payment never
//      inherits a campaign that has not started (GivingTuesday);
//   §7 the screen re-reads: the profile, Thread, Tasks and Calendar listen for
//      what Tell Steward did, and the profile's status re-reads with it.
//
// Against main this fails at §1 (the step is rewritten to "Log the gift", the
// coffee is still upcoming), §2 (no thanks card, the task shows the ask), §4
// (no plan runs alone, no closest-two, no cards), §5 (no /all) and §6.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const PORT = Number(process.env.MATRIX_PORT || 5698);
const MOCK = Number(process.env.CALENDAR_MOCK_PORT || 5619);   // a shard's mocks share this port; suites in a shard run one at a time
const SINK = Number(process.env.SINK_PORT || 5617);
process.env.PORT = String(PORT);
process.env.BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = "re_dummy_local";
process.env.RESEND_BASE_URL = `http://localhost:${SINK}`;
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
process.env.ANTHROPIC_API_KEY = "sk-ant-voice4-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_voice4", SLUG = "voice4-test", ADMIN = "voice4-admin@example.org", USER = "u_voice4";
const DONOR_MAIL = "jonathan@stewardapp.dev";   // the only address a test may mail, and it only reaches the sink
const ROOT = path.join(__dirname, "..");
const sys = "'system:test','test'";

// ── THE MAIL SINK: every send lands here, never anywhere else ───────────────
const MAIL = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", d => { b += d; });
  req.on("end", () => { let j = {}; try { j = JSON.parse(b); } catch { /* empty */ } MAIL.push(j);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "re_sink_" + MAIL.length })); });
});
const mailTo = addr => MAIL.filter(m => [].concat(m.to || []).some(t => String(t).includes(addr)));

// ── THE STAND-IN MODEL ─────────────────────────────────────────────────────
const queued = { memo_actions: [], talk_intent: [] };
const memoRead = o => ({ how: "", when: "", summary: "", people: [], follow_ups: [], interests: [], email: { subject: "", body: "" },
  money: [], contact: [], sensitive: [], ...o });
// The Agent's plan: a journey she names goes on the person shown, else a task.
function planFor(user) {
  const said = (/Her instruction, verbatim: "([^"]*)"/.exec(user) || [])[1] || "";
  const people = [];
  for (const line of user.split("\n")) { const m = /^ {2}(d_[A-Za-z0-9_]+) \| ([^|]+) \|/.exec(line); if (m) people.push({ id: m[1], name: m[2].trim() }); }
  const journeys = [];
  const jsec = user.split("JOURNEYS (journeyId):")[1] || "";
  for (const line of jsec.split("\n").slice(1)) { const m = /^ {2}(\S+) \| (.+)$/.exec(line); if (!m) break; journeys.push({ id: m[1], name: m[2].trim() }); }
  const base = { subject: null, body: null, note: null, stage: null, tag: null, label: null, due: null, dueDays: 3, priority: "medium", grantId: "", purpose: "" };
  const jy = journeys.find(x => said.toLowerCase().includes(x.name.toLowerCase()));
  const steps = people.slice(0, 1).map(p => (jy
    ? { ...base, tool: /out of|take|stop/i.test(said) ? "stop_journey" : "start_journey", donorId: p.id, citesRows: [p.id], journeyId: jy.id }
    : { ...base, tool: "create_task", donorId: p.id, citesRows: [p.id], title: said.replace(/\.$/, "") }));
  return { steps, sends: 0, headline: said.replace(/\.$/, ""), cannot: "" };
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
    const input = name === "plan" ? planFor(user)
      : (queued[name] && queued[name].shift()) || (name === "memo_actions" ? memoRead({}) : name === "talk_intent" ? { happened: "", to_do: "", question: "" } : {});
    send(200, { id: "msg_standin", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name, input }] });
  });
});

async function reset() {
  const first = ["voice_memos", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "thank_you_drafts", "receipts", "milestone_drafts",
    "cultivation_plans", "group_members", "meeting_effects", "threads", "interactions", "tasks", "calendar_events", "opportunities", "pledges",
    "fin_transactions", "gifts", "campaigns", "cultivation_templates", "audiences", "donors", "user_sessions", "users", "fin_funds", "accounts"];
  for (const t of first) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  console.log("voice4-does-it-all (VOICE-4)");
  await new Promise(r => mock.listen(MOCK, r));
  await new Promise(r => sink.listen(SINK, r));
  require("../server.js");
  await new Promise(r => setTimeout(r, 3500));   // boot DDL settles
  await reset();
  const today = civilToday();
  const plus = d => { const t = new Date(today + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  const year = today.slice(0, 4);
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,legal_name,ein,onboarded_at)
           VALUES ($1,'Voice Four Harbor',$2,1,'active','team','America/New_York',NOW(),true,'Voice Four Harbor Inc','12-3456789',NOW())`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, ADMIN, pw]);
  const tok = await login(ADMIN);
  ok("fixture admin signed in", !!tok, tok);
  await api("POST", "/onboarding/complete", tok, {}).catch(() => {});
  // Margaret: thirteen gifts, $187,500, $40,000 of it this year, the last $15,000.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES
           ('d_v4_mc',$1,'Margaret Chen',$2,'active','["donor"]'::jsonb,${sys}),
           ('d_v4_tf',$1,'Tobias Fairweather','tobias@example.org','active','["donor"]'::jsonb,${sys})`, [ORG, DONOR_MAIL]);
  const past = [[`${Number(year) - 1}-03-01`, 20000], [`${Number(year) - 2}-03-01`, 15000], [`${Number(year) - 3}-03-01`, 15000], [`${Number(year) - 4}-03-01`, 15000],
    [`${Number(year) - 5}-03-01`, 15000], [`${Number(year) - 6}-03-01`, 15000], [`${Number(year) - 7}-03-01`, 15000], [`${Number(year) - 8}-03-01`, 15000],
    [`${Number(year) - 9}-03-01`, 12500], [`${Number(year) - 10}-03-01`, 10000],
    [`${year}-02-01`, 10000], [`${year}-05-01`, 15000], [`${year}-08-24`, 15000]];
  for (const [i, [d, a]] of past.entries())
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,acknowledgement_sent,created_by,created_by_name) VALUES ($1,$2,'d_v4_mc',$3,$4,'cash',true,${sys})`, [`g_v4_${i}`, ORG, a, d]);
  await q(`UPDATE donors SET total_giving=187500, gift_count=13, first_gift_date=$2, last_gift_amount=15000, last_gift_date=$3 WHERE id='d_v4_mc' AND org_id=$1`,
    [ORG, `${Number(year) - 10}-03-01`, `${year}-08-24`]);
  // Her 10 AM coffee today, Sep 19's step, an open $25,000 ask, a journey, a group, an upcoming campaign.
  const at = hm => `((('${today}')::date + '${hm}'::time)::timestamp AT TIME ZONE 'America/New_York')`;
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,created_by,created_by_name) VALUES
    ('ce_v4_coffee',$1,$2,'steward','ce_v4_coffee','Coffee at Magee''s on Main',${at("10:00")},${at("11:00")},'Magee''s',ARRAY['d_v4_mc'],$2,'Dana Reyes')`, [ORG, USER]);
  const st = await api("POST", "/donors/d_v4_mc/threads", tok, { label: "Coffee tomorrow. Bring Lily's class schedule.", due: today });
  ok("fixture: Sep 19's step is open on her Thread", st.status < 300, st.body);
  await q(`UPDATE threads SET opened_on=$2 WHERE org_id=$1 AND donor_id='d_v4_mc'`, [ORG, plus(-32)]);
  const other = await api("POST", "/tasks", tok, { title: "Send Margaret photos of the second training boat", due: today, donorId: "d_v4_mc" });
  ok("fixture: an unrelated task due today", other.status < 300, other.body);
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status) VALUES ('op_v4_ask',$1,'d_v4_mc','Youth Arts Access',25000,'open')`, [ORG]);
  await q(`INSERT INTO cultivation_templates (id,org_id,name,trigger_key,steps) VALUES ('ct_v4_major',$1,'Major donor','by_hand','[{"type":"thank","draft":null,"label":"Call them the same week","offsetDays":3}]'::jsonb),
           ('ct_v4_lapsed',$1,'Lapsed donor win-back','by_hand','[{"type":"thank","draft":null,"label":"Call them the same week","offsetDays":3}]'::jsonb)`, [ORG]);
  await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,start_date,end_date,created_by,created_by_name) VALUES ('camp_v4_gt',$1,'GivingTuesday',20000,$2,$3,${sys})`, [ORG, plus(27), plus(48)]);
  const before = { tasks: await q(`SELECT id, title, notes FROM tasks WHERE org_id=$1 ORDER BY id`, [ORG]), threads: await q(`SELECT id, next_step_label FROM threads WHERE org_id=$1`, [ORG]) };
  const bm0 = await api("GET", "/donors/d_v4_mc/before-meeting", tok);
  ok("fixture: the coffee is upcoming with its brief", bm0.body && bm0.body.meeting && bm0.body.meeting.id === "ce_v4_coffee", bm0.body);

  // ── §1 THE MEMO ──────────────────────────────────────────────────────────
  console.log("\n§1 the memo");
  queued.memo_actions.push(memoRead({ how: "lunch", summary: "Lunch with Margaret went well.", people: ["Margaret Chen"],
    follow_ups: [{ label: "Log the gift", when: "", quote: "log that" }, { label: "Send Margaret the receipt", when: "", quote: "send her the receipt" }], money: [{ kind: "gift", fund_words: "", quote: "she gave $5000" }] }));
  const t1 = await api("POST", "/voice/talk", tok, { text: "Lunch with Margaret Chen went well, she gave $5000, log that, then send her the receipt", source: "speech" });
  const memo = t1.body && t1.body.memo;
  ok("§1 the memo is filed on Margaret", t1.status === 201 && memo && memo.people[0].id === "d_v4_mc", t1.body);
  ok("§1 the receipt is readied with the gift, not made a task or a plan", !t1.body.plan
    && !(await q(`SELECT 1 FROM tasks WHERE org_id=$1 AND title ILIKE '%receipt%'`, [ORG])).length, { plan: t1.body.plan });
  const gift = (memo.waiting || []).find(c => c.kind === "money");
  ok("§1 the receipt and thank-you wait beside it, as one card", (memo.waiting || []).filter(c => c.kind === "thanks").length === 1, memo.waiting);
  ok("§1 the gift waits for her yes", !!gift && gift.state === "waiting" && gift.amount === "$5,000", memo.waiting);
  const after1 = { tasks: await q(`SELECT id, title, notes FROM tasks WHERE org_id=$1 ORDER BY id`, [ORG]), threads: await q(`SELECT id, next_step_label FROM threads WHERE org_id=$1`, [ORG]) };
  const rewritten = [...before.tasks.filter(b => { const a = after1.tasks.find(x => x.id === b.id); return !a || a.title !== b.title || a.notes !== b.notes; }),
    ...before.threads.filter(b => { const a = after1.threads.find(x => x.id === b.id); return !a || a.next_step_label !== b.next_step_label; })];
  ok("§1 no existing task or step was rewritten", rewritten.length === 0, { rewritten, after: after1 });
  ok("§1 \"Log the gift\" is never a task", !(await q(`SELECT 1 FROM tasks WHERE org_id=$1 AND title ILIKE 'log the gift%'`, [ORG])).length
    && !(await q(`SELECT 1 FROM threads WHERE org_id=$1 AND next_step_label ILIKE 'log the gift%'`, [ORG])).length, null);
  const [ev] = await q(`SELECT logged_at, interaction_id FROM calendar_events WHERE id='ce_v4_coffee'`);
  const [conv] = await q(`SELECT id, note, metadata FROM interactions WHERE org_id=$1 AND donor_id='d_v4_mc' AND type='meeting' ORDER BY created_at DESC LIMIT 1`, [ORG]);
  ok("§1 the 10 AM coffee is marked happened and linked to the conversation", !!(ev && ev.logged_at && conv && ev.interaction_id === conv.id), { ev, conv });
  ok("§1 his words are kept (\"Lunch\")", !!conv && /^Lunch/.test(conv.note), conv);
  const bm1 = await api("GET", "/donors/d_v4_mc/before-meeting", tok);
  ok("§1 the \"Before your meeting\" card closes", bm1.status === 200 && !bm1.body.meeting, bm1.body);
  const rel1 = await api("GET", "/donors/d_v4_mc/relationship", tok);
  ok("§1 and the profile's meeting card no longer shows it as coming up", rel1.status === 200 && !(rel1.body.nextMeeting && rel1.body.nextMeeting.id === "ce_v4_coffee"), rel1.body.nextMeeting);
  const [step] = await q(`SELECT closed_at FROM threads WHERE org_id=$1 AND next_step_label LIKE 'Coffee tomorrow%'`, [ORG]);
  ok("§1 the coffee's step (Bring Lily's class schedule) is done", !!(step && step.closed_at), step);
  const [boat] = await q(`SELECT done FROM tasks WHERE org_id=$1 AND title LIKE 'Send Margaret photos%'`, [ORG]);
  ok("§1 an unrelated task due today stays open", boat && Number(boat.done) === 0, boat);
  ok("§1 nothing was sent yet", MAIL.length === 0, MAIL.map(m => m.to));

  // ── §2 YES ON THE GIFT ───────────────────────────────────────────────────
  console.log("\n§2 Yes on the gift");
  const rt = await api("POST", "/tasks", tok, { title: "Send Margaret the receipt", due: today, donorId: "d_v4_mc" });
  const y = await api("POST", `/voice/memos/${memo.id}/cards/${gift.id}/yes`, tok, {});
  ok("§2 Yes records the gift", y.status === 200, y.body);
  const [g] = await q(`SELECT id, amount, campaign_id, acknowledgement_sent, idempotency_key FROM gifts WHERE org_id=$1 AND donor_id='d_v4_mc' AND amount=5000`, [ORG]);
  ok("§2 through the Add Gift route (its idempotency key, no campaign)", !!g && g.idempotency_key === `voice:${memo.id}:${gift.id}` && !g.campaign_id, g);
  const prof = await api("GET", "/donors/d_v4_mc", tok);
  const f = prof.body.figures || {};
  const val = x => (x && typeof x === "object" ? Number(x.value) : Number(x));
  ok("§2 Last gift is $5,000", val(f.lastGift || f.last_gift) === 5000, f.lastGift || f);
  ok("§2 This year is $45,000", val(f.thisYear || f.this_year) === 45000, f.thisYear || f);
  ok("§2 Lifetime is $192,500", val(f.lifetime) === 192500, f.lifetime);
  const status = await api("GET", "/donors/d_v4_mc/status", tok);
  const gl = status.body.glance || {};
  ok("§2 Average is over 14 gifts", gl.average && gl.average.count === 14 && Math.abs(gl.average.value - 192500 / 14) < 0.01, gl.average);
  ok("§2 Largest recomputes (the $20,000 gift, not the new $5,000)", gl.largest && gl.largest.value === 20000, gl.largest);
  ok("§2 it waits for a thank-you", g && g.acknowledgement_sent !== true, g);
  const m2 = (await api("GET", `/voice/memos/${memo.id}`, tok)).body.memo;
  const thanks = (m2.waiting || []).find(c => c.kind === "thanks");
  ok("§2 the receipt and thank-you wait as ONE card, showing the gift", !!thanks && thanks.state === "waiting" && /\$5,000 gift/.test(thanks.detail), m2.waiting);
  const th = await api("GET", "/threads?donorId=d_v4_mc&scope=all", tok);
  const rows = (th.body.list || th.body.threads || th.body.rows || []);
  const rRow = rows.find(r => r.id === (rt.body && rt.body.id));
  const why = rRow && rRow.rank ? [].concat(rRow.rank.why || []).join(" | ") : JSON.stringify(rRow && (rRow.why || rRow.rank));
  ok("§2 the receipt task shows the $5,000 gift, not the ask", !!rRow && /\$5,000 gift/.test(why) && !/ask open/.test(why), { why, rRow: rRow && rRow.signals });
  ok("§2 still nothing sent", MAIL.length === 0, MAIL.map(m => m.to));

  // ── §3 ONE CONFIRM SENDS BOTH ────────────────────────────────────────────
  console.log("\n§3 one Confirm");
  const c3 = await api("POST", `/voice/memos/${memo.id}/cards/${thanks.id}/yes`, tok, {});
  ok("§3 Confirm sends the receipt and the thank-you", c3.status === 200, c3.body);
  ok("§3 both went to the donor and nobody else", mailTo(DONOR_MAIL).length >= 2 && MAIL.every(m => [].concat(m.to || []).every(t => String(t).includes(DONOR_MAIL))), MAIL.map(m => [m.to, m.subject]));
  const [g3] = await q(`SELECT acknowledgement_sent FROM gifts WHERE id=$1`, [g.id]);
  const [t3] = await q(`SELECT done FROM tasks WHERE id=$1`, [rt.body.id]);
  ok("§3 the gift is thanked and the receipt task is done", g3.acknowledgement_sent === true && Number(t3.done) === 1, { g3, t3 });

  // ── §4 GROUPS, JOURNEYS, AND THE REST, BY VOICE ──────────────────────────
  console.log("\n§4 by voice");
  const mail0 = MAIL.length;
  const j1 = await api("POST", "/voice/talk", tok, { text: "Put her in the Major donor journey", donorId: "d_v4_mc", as: "do" });
  const [pl] = await q(`SELECT id, status FROM cultivation_plans WHERE org_id=$1 AND donor_id='d_v4_mc' AND template_id='ct_v4_major'`, [ORG]);
  ok("§4 \"Put her in the Major donor journey\" enrolls her at once", j1.body.plan && j1.body.plan.ranAlone === true && pl && pl.status === "active", { plan: j1.body.plan, pl });
  const u4 = await api("POST", `/voice/memos/${j1.body.memo.id}/undo`, tok, {});
  const [pl2] = await q(`SELECT status FROM cultivation_plans WHERE id=$1`, [pl && pl.id]);
  ok("§4 Undo takes her out again", u4.status === 200 && (!pl2 || pl2.status !== "active"), { u4: u4.body, pl2 });
  const writes = async () => (await q(`SELECT ((SELECT COUNT(*) FROM agent_runs WHERE org_id=$1)+(SELECT COUNT(*) FROM cultivation_plans WHERE org_id=$1))::int AS n`, [ORG]))[0].n;
  const w0 = await writes();
  const j2 = await api("POST", "/voice/talk", tok, { text: "Put her in the Major gifts journey", donorId: "d_v4_mc", as: "do" });
  const ch = j2.body.plan && j2.body.plan.choose;
  ok("§4 a name that is not one offers the closest two, and makes nothing", !!ch && ch.options.length === 2 && ch.options[0].name === "Major donor" && (await writes()) === w0, j2.body.plan);
  const j3 = await api("POST", "/voice/talk", tok, { text: "Take Tobias Fairweather out of the lapsed journey", as: "do" });
  ok("§4 \"the lapsed journey\" is the one journey that holds the word", j3.status < 300 && j3.body.plan && j3.body.plan.text && /Lapsed donor win-back/.test(j3.body.plan.text), j3.body.plan);
  const j4 = await api("POST", "/voice/talk", tok, { text: "Mark her as do not email", donorId: "d_v4_mc", as: "do" });
  const [dne] = await q(`SELECT do_not_email FROM donors WHERE id='d_v4_mc'`);
  ok("§4 \"do not email\" waits as a card", ((j4.body.memo && j4.body.memo.waiting) || []).some(c => c.kind === "flag" && c.state === "waiting") && dne.do_not_email !== true, j4.body);
  const j5 = await api("POST", "/voice/talk", tok, { text: "Change her ask to $30,000", donorId: "d_v4_mc", as: "do" });
  const [op5] = await q(`SELECT target_amount FROM opportunities WHERE id='op_v4_ask'`);
  ok("§4 \"change her ask\" waits as a card (money waits)", ((j5.body.memo && j5.body.memo.waiting) || []).some(c => c.kind === "ask" && c.state === "waiting") && Number(op5.target_amount) === 25000, j5.body);
  ok("§4 nothing was sent by any of it", MAIL.length === mail0, MAIL.slice(mail0).map(m => m.to));

  // ── §5 DO ALL OF THIS, AND ONE UNDO ──────────────────────────────────────
  console.log("\n§5 Do all of this");
  queued.memo_actions.push(memoRead({ how: "call", summary: "Called Margaret.", people: ["Margaret Chen"], money: [{ kind: "gift", fund_words: "", quote: "she gave $1000" }] }));
  const t5 = await api("POST", "/voice/talk", tok, { text: "Called Margaret Chen, she gave $1000", source: "typed" });
  const m5 = t5.body.memo;
  const extra = await api("POST", "/voice/talk", tok, { text: "Mark her as do not email", donorId: "d_v4_mc", as: "do" });
  ok("§5 fixture: a gift card and a flag card", !!m5 && !!extra.body.memo, { m5, extra: extra.body });
  const all5 = await api("POST", `/voice/memos/${m5.id}/all`, tok, {});
  const all = await api("POST", `/voice/memos/${extra.body.memo.id}/all`, tok, {});
  const [g5] = await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id='d_v4_mc' AND amount=1000`, [ORG]);
  const [d5] = await q(`SELECT do_not_email FROM donors WHERE id='d_v4_mc'`);
  ok("§5 one tap does every card", all.status === 200 && all5.status === 200 && !!g5 && d5.do_not_email === true, { all: all.body.failed, all5: all5.body.failed });
  ok("§5 the receipt card it readied was sent with it (one Confirm)", ((all5.body.memo && all5.body.memo.waiting) || []).some(c => c.kind === "thanks" && c.state === "saved"), all5.body.memo && all5.body.memo.waiting);
  const u5 = await api("POST", `/voice/memos/${m5.id}/undo`, tok, {});
  const u5b = await api("POST", `/voice/memos/${extra.body.memo.id}/undo`, tok, {});
  const [g5b] = await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id='d_v4_mc' AND amount=1000`, [ORG]);
  const [d5b] = await q(`SELECT do_not_email FROM donors WHERE id='d_v4_mc'`);
  ok("§5 Undo reverses the gift and the flag", u5.status === 200 && u5b.status === 200 && !g5b && d5b.do_not_email !== true, { u5: u5.body.sentence, g5b, d5b });
  ok("§5 Undo says what was sent stays sent", /not taken back/.test(u5.body.sentence || ""), u5.body.sentence);
  const u1 = await api("POST", `/voice/memos/${memo.id}/undo`, tok, {});
  const [evU] = await q(`SELECT logged_at FROM calendar_events WHERE id='ce_v4_coffee'`);
  ok("§5 the first memo's Undo takes back its gift and opens the coffee again", u1.status === 200
    && !(await q(`SELECT 1 FROM gifts WHERE id=$1`, [g.id])).length && !evU.logged_at, { u1: u1.body, evU });

  // ── §6 NO UPCOMING CAMPAIGN BY DEFAULT ───────────────────────────────────
  console.log("\n§6 campaigns");
  const pl6 = await api("POST", "/donors/d_v4_tf/pledges", tok, { amount: "1000", dueDate: plus(60), campaignId: "camp_v4_gt" });
  const plId = pl6.body.id || (pl6.body.pledge && pl6.body.pledge.id);
  const g61 = await api("POST", "/donors/d_v4_tf/gifts", tok, { amount: 250, date: today, type: "cash", pledgeId: plId, idempotencyKey: "v4-up-1" });
  const g62 = await api("POST", "/donors/d_v4_tf/gifts", tok, { amount: 10, date: today, type: "cash", idempotencyKey: "v4-up-2" });
  const g63 = await api("POST", "/donors/d_v4_tf/gifts", tok, { amount: 11, date: today, type: "cash", campaignId: "camp_v4_gt", idempotencyKey: "v4-up-3" });
  const row = async id => (await q("SELECT campaign_id FROM gifts WHERE id=$1", [id]))[0] || {};
  ok("§6 a pledge payment never inherits a campaign that has not started", !!g61.body.gift && !(await row(g61.body.gift.id)).campaign_id, g61.body);
  ok("§6 a gift with no campaign picked has none", !!g62.body.gift && !(await row(g62.body.gift.id)).campaign_id, g62.body);
  ok("§6 an upcoming campaign picked by hand is kept", !!g63.body.gift && (await row(g63.body.gift.id)).campaign_id === "camp_v4_gt", g63.body);

  // ── §7 THE SCREEN RE-READS ───────────────────────────────────────────────
  console.log("\n§7 the screen keeps up");
  const src = p => fs.readFileSync(path.join(ROOT, "client/src/components", p), "utf8");
  const listeners = ["DonorProfile.jsx", "Tasks.jsx", "Calendar.jsx", "Dashboard.jsx"]   // Home's Thread is in Dashboard.jsx
   .filter(p => fs.existsSync(path.join(ROOT, "client/src/components", p)) && /useStewardTold\(/.test(src(p)));
  ok("§7 the profile, Thread, Tasks and Calendar re-read when Tell Steward acts", listeners.length === 4, listeners);
  ok("§7 the sheet says so after every change, not only on close", (src("TellSteward.jsx").match(/told\(/g) || []).length >= 3, null);
  ok("§7 the profile's status re-reads with it", /useDonorStatus\(donor\.id,\s*figs,\s*`\$\{stepNonce\}:\$\{toldNonce\}`\)/.test(src("DonorProfile.jsx")), null);

  ok("§8 no email reached anyone but the one test address", MAIL.every(m => [].concat(m.to || []).every(t => String(t).includes(DONOR_MAIL))), MAIL.map(m => m.to));
  mock.close(); sink.close();
  await reset();
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error("SUITE ERROR:", e); mock.close(); sink.close(); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
