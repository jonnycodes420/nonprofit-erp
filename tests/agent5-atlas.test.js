// tests/agent5-atlas.test.js · AGENT-5. ATLAS DOES THE WHOLE JOB, ASKS ONCE, AND LEAVES A NOTE.
//
// Donor data, money and email in one suite, on Jonathan's own request from
// prod (21 Oct), typed in Home's Ask box: "Undine went to the Harbor Run
// event. She gave $10,000. Let's start the major giving journey, then draft an
// email thanking her and requesting a meeting in the new year." There are two
// Undines.
//   §1 Atlas asks "Which Undine?" ONCE, with one click per person, and writes
//      nothing before the answer;
//   §2 the pick resumes EVERY step for her: attended at Harbor Run, the
//      $10,000 as a tap (no gift yet), in Major giving with Undo, a thank-you
//      draft asking to meet in January (not sent), a reminder in January;
//   §3 each shows a note on its own page (Events, Journeys, Communications,
//      Gifts) and an item in the bell, whose count is only what waits;
//   §4 Undo on the journey line takes her out of Major giving;
//   §5 the tap records the gift through the Add Gift route;
//   §6 the guardrails: a merge, a recurring change and "send it now" are
//      refused in one line each and the rest is done;
//   §7 the Agent page is gone: no rail entry, and its old address lands on
//      Home with Atlas open;
//   §8 nothing was sent to anyone.
//   §9 POLISH-3: a gift already recorded elsewhere (the Add Gift form) stops
//      the "tap to record" prompt everywhere: Home, the bell, its count, and
//      its tap records nothing a second time.
// Against main this fails at §1 (there is no /atlas) and §7 (the Agent page).
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const PORT = Number(process.env.MATRIX_PORT || 5698);
const MOCK = Number(process.env.CALENDAR_MOCK_PORT || 5619);
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
process.env.ANTHROPIC_API_KEY = "sk-ant-agent5-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_agent5", SLUG = "agent5-test", ADMIN = "agent5-admin@example.org", USER = "u_agent5";
const DONOR_MAIL = "jonathan@stewardapp.dev";   // the only address a test may mail, and it only reaches the sink
const ROOT = path.join(__dirname, "..");
const sys = "'system:test','test'";
const UNDINE = "Undine went to the Harbor Run event. She gave $10,000. Let's start the major giving journey, then draft an email thanking her and requesting a meeting in the new year.";

const MAIL = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", d => { b += d; });
  req.on("end", () => { let x = {}; try { x = JSON.parse(b); } catch { /* empty */ } MAIL.push(x);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "re_sink_" + MAIL.length })); });
});

// ── THE STAND-IN MODEL: her words, read into steps (no ids, no amounts it computed)
const step = o => ({ kind: "other", who: "", target: "", amount_words: "", when_words: "", how: "", words: "", ...o });
const READS = [
  [/^Undine went to the Harbor Run/, { steps: [
    step({ kind: "came_to_event", who: "Undine", target: "Harbor Run", words: "Undine went to the Harbor Run event" }),
    step({ kind: "gift", who: "Undine", amount_words: "$10,000", words: "She gave $10,000" }),
    step({ kind: "add_to_journey", who: "Undine", target: "major giving", words: "Let's start the major giving journey" }),
    step({ kind: "draft_email", who: "Undine", when_words: "in the new year", words: "draft an email thanking her and requesting a meeting in the new year",
      draft_subject: "Thank you, Undine", draft_body: "Dear Undine,\n\nThank you for your generous gift and for coming to the Harbor Run. Could we meet in January?\n\nWith gratitude," }),
  ] }],
  [/^Merge Undine/, { steps: [
    step({ kind: "merge", who: "Undine Fairweather", target: "Undine Ashgrove", words: "Merge Undine Fairweather and Undine Ashgrove" }),
    step({ kind: "recurring_change", who: "Undine Fairweather", words: "bump her monthly gift to $50" }),
    step({ kind: "send_now", who: "Undine Fairweather", words: "send her a thank-you now without showing me", draft_subject: "Thank you", draft_body: "Dear Undine,\n\nThank you.\n\nWith gratitude," }),
    step({ kind: "note", who: "Undine Fairweather", words: "Prefers phone calls" }),
  ] }],
  [/^Undine Ashgrove gave/, { steps: [step({ kind: "gift", who: "Undine Ashgrove", amount_words: "$2,500", words: "Undine Ashgrove gave $2,500" })] }],
];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const send = (code, x) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(x)); };
    if (!req.url.startsWith("/v1/messages")) return send(404, {});
    let x = {}; try { x = JSON.parse(body); } catch { /* empty */ }
    const name = x.tools && x.tools[0] && x.tools[0].name;
    const user = (x.messages || []).map(m => (typeof m.content === "string" ? m.content : (m.content || []).map(c => c.text || "").join("\n"))).join("\n");
    const said = (/What she said: (.*)$/m.exec(user) || [])[1] || "";
    const hit = READS.find(([re]) => re.test(said));
    const input = name === "atlas_read" ? (hit ? hit[1] : { steps: [] }) : {};
    send(200, { id: "msg_standin", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name, input }] });
  });
});

async function reset() {
  const first = ["atlas_actions", "voice_memos", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "thank_you_drafts", "receipts",
    "cultivation_plans", "merge_proposals", "event_attendees", "events", "threads", "interactions", "tasks", "gifts", "campaigns", "cultivation_templates",
    "audiences", "donors", "user_sessions", "users", "fin_funds", "accounts"];
  for (const t of first) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  console.log("agent5-atlas (AGENT-5)");
  await new Promise(r => mock.listen(MOCK, r));
  await new Promise(r => sink.listen(SINK, r));
  require("../server.js");
  await new Promise(r => setTimeout(r, 3500));   // boot DDL settles
  await reset();
  const today = civilToday();
  const plus = d => { const t = new Date(today + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,legal_name,ein,onboarded_at)
           VALUES ($1,'Agent Five Harbor',$2,1,'active','team','America/New_York',NOW(),true,'Agent Five Harbor Inc','12-3456789',NOW())`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, ADMIN, pw]);
  const tok = await login(ADMIN);
  ok("fixture admin signed in", !!tok, tok);
  await api("POST", "/onboarding/complete", tok, {}).catch(() => {});
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES
           ('d_a5_uf',$1,'Undine Fairweather',$2,'active','["donor"]'::jsonb,${sys}),
           ('d_a5_ua',$1,'Undine Ashgrove','undine.ashgrove@example.org','active','["donor"]'::jsonb,${sys})`, [ORG, DONOR_MAIL]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,location) VALUES ('ev_a5_run',$1,'Harbor Run','5k',$2,'North Shore Path')`, [ORG, plus(-2)]);
  await q(`INSERT INTO cultivation_templates (id,org_id,name,trigger_key,steps) VALUES
           ('ct_a5_major',$1,'Major giving','by_hand','[{"type":"thank","draft":null,"label":"Call them the same week","offsetDays":3}]'::jsonb),
           ('ct_a5_new',$1,'New donor, first year','by_hand','[{"type":"thank","draft":null,"label":"Call them","offsetDays":3}]'::jsonb)`, [ORG]);
  const count = async () => (await q(`SELECT ((SELECT COUNT(*) FROM event_attendees WHERE org_id=$1)+(SELECT COUNT(*) FROM cultivation_plans WHERE org_id=$1)
    +(SELECT COUNT(*) FROM agent_drafts WHERE org_id=$1)+(SELECT COUNT(*) FROM tasks WHERE org_id=$1)+(SELECT COUNT(*) FROM gifts WHERE org_id=$1))::int AS n`, [ORG]))[0].n;

  // ── §1 WHICH UNDINE, ONCE ────────────────────────────────────────────────
  console.log("\n§1 which Undine, once");
  const w0 = await count();
  const t1 = await api("POST", "/atlas", tok, { text: UNDINE, source: "typed" });
  const req1 = t1.body && t1.body.request;
  const qs = (req1 && req1.questions) || [];
  ok("§1 Atlas asks one question: which Undine", t1.status === 200 && qs.length === 1 && qs[0].kind === "person" && /Which Undine/.test(qs[0].sentence), t1.body);
  ok("§1 one click each: both Undines are offered", !!qs[0] && qs[0].options.map(o => o.id).sort().join(",") === "d_a5_ua,d_a5_uf", qs[0] && qs[0].options);
  ok("§1 nothing is written before the answer", (await count()) === w0, null);

  // ── §2 THE PICK RESUMES EVERY STEP ───────────────────────────────────────
  console.log("\n§2 the pick resumes every step");
  const t2 = await api("POST", `/atlas/${req1 && req1.id}/answer`, tok, { answers: { [qs[0] && qs[0].id]: "d_a5_uf" } });
  const lines = (t2.body.request && t2.body.request.lines) || [];
  const line = k => lines.find(l => l.kind === k);
  ok("§2 the answer runs", t2.status === 201 && t2.body.request.status === "done", t2.body);
  const [att] = await q(`SELECT status FROM event_attendees WHERE org_id=$1 AND event_id='ev_a5_run' AND donor_id='d_a5_uf'`, [ORG]);
  ok("§2 marked Undine Fairweather as attended at Harbor Run", !!att && att.status === "attended" && !!line("attended") && /Marked Undine Fairweather as attended at Harbor Run/.test(line("attended").line), { att, lines });
  ok("§2 the other Undine is untouched", !(await q(`SELECT 1 FROM event_attendees WHERE org_id=$1 AND donor_id='d_a5_ua'`, [ORG])).length, null);
  const giftLine = line("gift");
  ok("§2 the $10,000 is a tap, and no gift is recorded yet", !!giftLine && giftLine.waits && /\$10,000 gift from Undine Fairweather: tap to record/.test(giftLine.line)
    && !(await q(`SELECT 1 FROM gifts WHERE org_id=$1`, [ORG])).length, giftLine);
  const [plan] = await q(`SELECT id, status FROM cultivation_plans WHERE org_id=$1 AND donor_id='d_a5_uf' AND template_id='ct_a5_major'`, [ORG]);
  const jl = line("journey_added");
  ok("§2 enrolled in Major giving, with Undo", !!plan && plan.status === "active" && !!jl && jl.undoable && /Added Undine to Major giving/.test(jl.line), { plan, jl });
  const [dr] = await q(`SELECT id, status, body FROM agent_drafts WHERE org_id=$1 AND donor_id='d_a5_uf'`, [ORG]);
  const dl = line("draft");
  ok("§2 a thank-you draft asking to meet in January, not sent", !!dr && dr.status === "pending" && /January/.test(dr.body)
    && !!dl && /Drafted a thank-you to Undine asking to meet in January\. Review and send\./.test(dl.line), { dr, dl });
  const [task] = await q(`SELECT title, due FROM tasks WHERE org_id=$1 AND donor_id='d_a5_uf' AND title ILIKE 'book the meeting%'`, [ORG]);
  const rl = line("reminder");
  ok("§2 a reminder in January to book the meeting", !!task && /-01-0[5-7]$/.test(task.due) && !!rl && /^Reminder for Jan [5-7]: book the meeting\.$/.test(rl.line), { task, rl });
  ok("§2 the reply is a short checklist, each line a link", lines.length === 5 && lines.every(l => l.link), lines.map(l => [l.kind, l.line, l.link]));
  ok("§2 Atlas speaks briefly, in the first person", /^Done\. (One thing waits|\d things wait) for your tap\.$/.test(t2.body.request.spoke), t2.body.request.spoke);

  // ── §3 A NOTE ON EACH PAGE, AND THE BELL ─────────────────────────────────
  console.log("\n§3 notes and the bell");
  const note = async (place, id) => ((await api("GET", `/atlas/notes?place=${place}${id ? `&id=${id}` : ""}`, tok)).body.notes || []);
  const nEv = await note("event", "ev_a5_run"), nJy = await note("journey", "ct_a5_major"), nCm = await note("communications"), nGf = await note("gifts"), nPs = await note("person", "d_a5_uf");
  ok("§3 Events: Atlas marked her as attended", nEv.some(n => /attended/.test(n.line) && n.by === "Atlas"), nEv);
  ok("§3 Journeys: Atlas added her, with Undo", nJy.some(n => /Added Undine/.test(n.line) && n.undoable), nJy);
  ok("§3 Communications: the thank-you, to review and send", nCm.some(n => /Review and send/.test(n.line)), nCm);
  ok("§3 Gifts and To confirm: $10,000 waiting for her tap", nGf.some(n => /\$10,000/.test(n.line) && n.waits), nGf);
  ok("§3 the profile lists all of it", nPs.length >= 5, nPs.map(n => n.line));
  const seen = await api("POST", "/atlas/notes/seen", tok, { ids: nEv.map(n => n.id) });
  ok("§3 a note fades after it is seen (the waiting ones stay)", seen.status === 200 && (await note("event", "ev_a5_run")).length === 0 && (await note("gifts")).length >= 1, null);
  const bell = (await api("GET", "/atlas/activity", tok)).body;
  ok("§3 the bell lists everything, newest first", bell.items.length >= 5 && new Date(bell.items[0].at) >= new Date(bell.items[bell.items.length - 1].at), bell.items.map(i => i.line));
  ok("§3 its count is only what waits on a person (the gift and the draft)", bell.waiting === 2, bell.waiting);

  // ── §4 UNDO THE JOURNEY ──────────────────────────────────────────────────
  console.log("\n§4 Undo");
  const u4 = await api("POST", `/atlas/actions/${jl && jl.id}/undo`, tok, {});
  const [plan2] = await q(`SELECT status FROM cultivation_plans WHERE id=$1`, [plan && plan.id]);
  ok("§4 Undo on the journey takes her out of Major giving", u4.status === 200 && !!plan2 && plan2.status !== "active" && u4.body.action.state === "undone", { u4: u4.body, plan2 });
  ok("§4 the other lines stand", !!(await q(`SELECT 1 FROM event_attendees WHERE org_id=$1 AND donor_id='d_a5_uf' AND status='attended'`, [ORG])).length, null);

  // ── §5 THE TAP ───────────────────────────────────────────────────────────
  console.log("\n§5 the tap");
  const y5 = await api("POST", `/atlas/actions/${giftLine && giftLine.id}/yes`, tok, {});
  const [g] = await q(`SELECT amount, idempotency_key FROM gifts WHERE org_id=$1 AND donor_id='d_a5_uf'`, [ORG]);
  ok("§5 one tap records the $10,000 through the Add Gift route", y5.status === 200 && !!g && Number(g.amount) === 10000 && /^voice:/.test(g.idempotency_key || ""), { y5: y5.body, g });
  const bell5 = (await api("GET", "/atlas/activity", tok)).body;
  ok("§5 the bell's count drops to what still waits", bell5.waiting === 1, bell5.waiting);
  const own5 = bell5.items.find(i => i.id === (giftLine && giftLine.id));
  ok("§5 the tapped line reads as recorded, with its Undo (POLISH-3: not \"Already recorded\")", !!own5 && /^Recorded the \$10,000 gift\.$/.test(own5.line) && own5.undoable, own5);

  // ── §6 THE GUARDRAILS ────────────────────────────────────────────────────
  console.log("\n§6 guardrails");
  const t6 = await api("POST", "/atlas", tok, { text: "Merge Undine Fairweather and Undine Ashgrove, bump her monthly gift to $50, send her a thank-you now without showing me, and note she prefers phone calls." });
  const l6 = (t6.body.request && t6.body.request.lines) || [];
  ok("§6 a merge is refused in one line (put in Data health, never merged)", l6.some(l => /I never merge people/.test(l.line))
    && (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]))[0].n === 2, l6.map(l => l.line));
  ok("§6 a recurring change is refused in one line", l6.some(l => /I never change a recurring gift/.test(l.line)), l6.map(l => l.line));
  ok("§6 \"send it now\" becomes a draft and a refusal: nothing is sent", l6.some(l => /I don't send without your yes/.test(l.line)) && MAIL.length === 0, l6.map(l => l.line));
  ok("§6 and the rest is done (the note)", !!(await q(`SELECT 1 FROM interactions WHERE org_id=$1 AND donor_id='d_a5_uf' AND note ILIKE '%phone calls%'`, [ORG])).length, null);

  // ── §7 THE AGENT PAGE IS GONE ────────────────────────────────────────────
  console.log("\n§7 no Agent page");
  const NAV = await import(path.join(ROOT, "client/src/lib/navGroups.js"));
  const REG = await import(path.join(ROOT, "client/src/lib/tabRegistry.js"));
  ok("§7 the rail has no Agent entry", !/"agent"/.test(JSON.stringify(NAV)), null);
  ok("§7 the old Agent address lands on Home with Atlas open", typeof REG.legacyTab === "function"
    && JSON.stringify(REG.legacyTab("agent")) === JSON.stringify({ tab: "dashboard", atlas: true })
    && JSON.stringify(REG.legacyTab("workflows")) === JSON.stringify({ tab: "dashboard", atlas: true }), REG.legacyTab && REG.legacyTab("agent"));
  ok("§7 the Agent page's component is removed", !fs.existsSync(path.join(ROOT, "client/src/components/Agent.jsx")), null);

  // ── §9 DONE ELSEWHERE, GONE EVERYWHERE (POLISH-3) ────────────────────────
  console.log("\n§9 a gift recorded elsewhere settles its prompt");
  // An older gift of the same amount, written just now (as a re-seed or an import writes it), is not this gift.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_a5_old',$1,'d_a5_ua',2500,$2,'cash',${sys})`, [ORG, plus(-150)]);
  const t9 = await api("POST", "/atlas", tok, { text: "Undine Ashgrove gave $2,500." });
  const g9 = ((t9.body.request && t9.body.request.lines) || []).find(l => l.kind === "gift");
  const home9 = async () => ((await api("GET", "/atlas/notes?place=home", tok)).body.notes || []).filter(n => n.id === (g9 && g9.id));
  ok("§9 the $2,500 waits on Home first (an old $2,500 gift is not it)", !!g9 && g9.waits && (await home9()).length === 1, g9);
  const waitingBefore = (await api("GET", "/atlas/activity", tok)).body.waiting;
  const add9 = await api("POST", "/donors/d_a5_ua/gifts", tok, { amount: 2500, date: today, type: "cash", notes: "Recorded by hand" });
  ok("§9 the gift is recorded by hand, on the Add Gift form", add9.status < 300 && !!add9.body.gift, add9.body);
  ok("§9 Home no longer asks to record it", (await home9()).length === 0, await home9());
  const bell9 = (await api("GET", "/atlas/activity", tok)).body;
  const item9 = bell9.items.find(i => i.id === (g9 && g9.id));
  ok("§9 the bell shows it done, and its count drops", bell9.waiting === waitingBefore - 1 && !!item9 && !item9.waits && /Already recorded/.test(item9.line), { waiting: bell9.waiting, waitingBefore, item9 });
  const [row9] = await q(`SELECT state, waits FROM atlas_actions WHERE id=$1`, [g9 && g9.id]);
  ok("§9 the line is written down as done, not only hidden", !!row9 && row9.state === "done" && row9.waits === false, row9);
  const y9 = await api("POST", `/atlas/actions/${g9 && g9.id}/yes`, tok, {});
  const n9 = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND donor_id='d_a5_ua'`, [ORG]))[0].n;
  ok("§9 a late tap records nothing a second time", y9.status === 409 && n9 === 2, { status: y9.status, n9 });

  ok("§8 nothing was sent to anyone", MAIL.length === 0, MAIL.map(m => m.to));
  mock.close(); sink.close();
  await reset();
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error("SUITE ERROR:", e); mock.close(); sink.close(); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
