// tests/speed3-atlas.test.js · SPEED-3. ATLAS ANSWERS FAST AND SAYS WHAT IT'S DOING.
//
// Donor data and email (a draft to a donor). Muse's walks: an Atlas answer or
// draft took about 20 s with no sign of what was happening. Every model call
// here is a stand-in at a realistic latency, the same rule for every call:
//   700 ms to the first token, then 15 ms a token (about 67 tokens a second,
//   Sonnet-class), a token being four characters of the tool's JSON.
// A one-step read is about 1.5 s, a thank-you draft about 4.5 s. Streamed
// calls get the same clock, delivered in pieces.
//   §1 a draft: first words on screen under 3 s, the full draft under 10 s,
//      and a step line ("Writing the draft…") while it works;
//   §2 a person answer and a list answer: first words under 3 s;
//   §3 two people's emails in one request are written at the same time, not
//      one after the other (the planted defect: in series, this goes red);
//   §4 a draft past 15 s says "Still working: <step>", and at the 20 s budget
//      the answer is what it has (the budget is shortened for the suite);
//   §5 nothing was sent to anyone.
// Planted (SPEED-3 report): the drafts awaited one after another → §3 red.
"use strict";

const http = require("http");

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
process.env.ANTHROPIC_API_KEY = "sk-ant-speed3-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");
const bcrypt = require("bcryptjs");

const ORG = "org_speed3a", ADMIN = "speed3a-admin@example.org", USER = "u_speed3a";
const sys = "'system:test','test'";
const MAIL = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", d => { b += d; });
  req.on("end", () => { MAIL.push(b); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "re_sink_" + MAIL.length })); });
});

// ── THE STAND-IN MODEL ─────────────────────────────────────────────────────
const TTFT = 700, PER_TOKEN = 15;
let SLOW_DRAFT_MS = 0;   // §4 makes a draft hang
const CALLS = [];        // { tool, start, end } since the request's t0
let T0 = 0;
const step = o => ({ kind: "other", who: "", target: "", amount_words: "", when_words: "", how: "", words: "", ...o });
const READS = [
  [/^Thank Marlowe/, [step({ kind: "draft_email", who: "Marlowe", words: "Thank Marlowe for her gift" })]],
  [/^Thank Marlowe and Odette/, null],
  [/^Write to Marlowe and Odette/, [step({ kind: "draft_email", who: "Marlowe", words: "thank her for coming to the showcase" }),
    step({ kind: "draft_email", who: "Odette", words: "thank her for coming to the showcase" })]],
  [/^Tell me about Marlowe/, [step({ kind: "about", who: "Marlowe", words: "Tell me about Marlowe" })]],
  [/^Who gave last December/, [step({ kind: "question", target: "Who gave last December but not this year?", words: "Who gave last December but not this year?" })]],
  [/^Write Wren/, [step({ kind: "draft_email", who: "Wren", words: "Write Wren a hello" })]],
];
const DEC_PLAN = y => ({ answerable: true, unsupported: null, entity: "people", where: [], measure: { fn: "count" }, list: true,
  related: [{ entity: "gifts", where: [{ field: "date", op: "between", value: [`${y - 1}-12-01`, `${y - 1}-12-31`] }] },
            { entity: "gifts", where: [{ field: "date", op: "gte", value: `${y}-01-01` }], none: true }] });
const DRAFT = n => ({ subject: `Thank you, ${n}`, body: `Dear ${n},\n\nThank you so much for your gift to Kestrel Point Arts. Because of you, twelve more young artists will spend this winter in the studio, learning to paint the murals that now brighten our neighborhood. We could not do this without friends like you, and we are so grateful you are one of them.\n\nWith gratitude,\nRowan` });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", async () => {
    const start = Math.round(performance.now()) - T0;
    let x = {}; try { x = JSON.parse(body); } catch { /* empty */ }
    const name = x.tools && x.tools[0] && x.tools[0].name;
    const user = (x.messages || []).map(m => (typeof m.content === "string" ? m.content : (m.content || []).map(c => c.text || "").join("\n"))).join("\n");
    let input = null;
    if (name === "atlas_read") {
      const said = (/What she said: (.*)$/m.exec(user) || [])[1] || "";
      const hit = READS.find(([re, v]) => v && re.test(said));
      input = { steps: hit ? hit[1] : [] };
    } else if (name === "query_plan" && /December/.test(user)) input = DEC_PLAN(Number(civilToday().slice(0, 4)));
    else if (name === "atlas_draft") input = DRAFT((/Odette/.test(user) ? "Odette" : /Wren/.test(user) ? "Wren" : "Marlowe"));
    const json = input ? JSON.stringify(input) : "";
    const ms = TTFT + PER_TOKEN * Math.ceil(json.length / 4) + (name === "atlas_draft" ? SLOW_DRAFT_MS : 0);
    const done = () => CALLS.push({ tool: name, start, end: Math.round(performance.now()) - T0, inChars: body.length });
    if (!input) { await sleep(TTFT); done(); res.writeHead(500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "no stand-in for " + name } })); }
    if (!x.stream) {
      await sleep(ms);
      if (res.destroyed) return;
      done();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id: "msg_standin", type: "message", role: "assistant", model: x.model, stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name, input }] }));
    }
    // Streamed: the same clock, in pieces of eight tokens.
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const ev = (type, data) => { if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`); };
    await sleep(TTFT + (name === "atlas_draft" ? SLOW_DRAFT_MS : 0));
    ev("message_start", { message: { id: "msg_standin", type: "message", role: "assistant", model: x.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: "tu_1", name, input: {} } });
    for (let i = 0; i < json.length; i += 32) {
      ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 32) } });
      await sleep(PER_TOKEN * 8);
    }
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: Math.ceil(json.length / 4) } });
    ev("message_stop", {});
    done();
    res.end();
  });
});

async function seed() {
  for (const t of ["fin_audit_log", "atlas_actions", "voice_memos", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "interactions", "tasks", "gifts", "donors", "user_sessions", "users"]) {
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  }
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  const y = Number(civilToday().slice(0, 4));
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,legal_name,ein,onboarded_at)
           VALUES ($1,'Kestrel Point Arts',$2,1,'active','team','America/New_York',NOW(),true,'Kestrel Point Arts Inc','12-3456781',NOW())`, [ORG, "speed3a-test"]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Rowan Pike','admin')`, [USER, ORG, ADMIN, bcrypt.hashSync("loadtest1234", 4)]);
  for (const [id, name, email, about] of [["d_s3_marlowe", "Marlowe Quince", "marlowe.q@example.org", "Loves youth arts."], ["d_s3_odette", "Odette Varga", "odette.v@example.org", null],
    ["d_s3_sterling", "Sterling Nakamura", "sterling.n@example.org", null], ["d_s3_wren", "Wren Achterberg", "wren.a@example.org", null]]) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,about_them,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,$5,${sys})`, [id, ORG, name, email, about]);
  }
  for (const [id, did, amt, date] of [["g_s3_1", "d_s3_sterling", 900, `${y - 1}-12-12`], ["g_s3_2", "d_s3_odette", 400, `${y - 1}-12-18`], ["g_s3_3", "d_s3_marlowe", 150, `${y - 1}-12-20`]]) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'cash',${sys})`, [id, ORG, did, amt, date]);
  }
  await q(`UPDATE donors d SET total_giving = s.t, gift_count = s.n, first_gift_date = s.f, last_gift_date = s.l, last_gift_amount = s.t
           FROM (SELECT donor_id, SUM(amount) t, COUNT(*)::int n, MIN(date) f, MAX(date) l FROM gifts WHERE org_id=$1 GROUP BY donor_id) s
          WHERE d.id = s.donor_id AND d.org_id=$1`, [ORG]);
}

// One request, watched the way the dialog watches it: the status poll every
// 100 ms, noting when each line first showed and when words first did.
async function timed(tok, text, label) {
  const key = "speed3-" + Math.random().toString(36).slice(2, 12);
  CALLS.length = 0;
  T0 = Math.round(performance.now());
  const seen = [];
  let firstWords = null, firstLine = null;
  let on = true;
  const watch = (async () => {
    while (on) {
      const p = await api("GET", `/atlas/progress/${key}`, tok).catch(() => null);
      const g = p && p.body && p.body.progress;
      const t = Math.round(performance.now()) - T0;
      if (g && g.line && !seen.some(s => s.line === g.line)) { seen.push({ line: g.line, at: t }); if (firstLine == null) firstLine = t; }
      if (g && g.words && firstWords == null) firstWords = { at: t, words: g.words };
      await sleep(100);
    }
  })();
  const r = await api("POST", "/atlas", tok, { text, progressKey: key });
  const total = Math.round(performance.now()) - T0;
  on = false; await watch;
  const lines = (r.body && r.body.request && r.body.request.lines) || [];
  // The finished answer is words on screen too, when it comes first.
  if (!firstWords && lines.some(x => x.line)) firstWords = { at: total, words: lines.map(x => x.line).join(" ") };
  const timings = r.body && r.body.request && r.body.request.timings;
  console.log(`    ${label}: total ${total} ms · first status line ${firstLine} ms · first words ${firstWords ? firstWords.at : "—"} ms`);
  for (const c of CALLS) console.log(`      model ${c.tool}: ${c.start}–${c.end} ms (${c.inChars} chars in)`);
  for (const s of seen) console.log(`      line at ${s.at} ms: ${s.line}`);
  if (timings && timings.laps) console.log("      server laps (ms): " + timings.laps.map(l => `${l.step} ${l.ms}`).join(" · "));
  return { r, total, firstLine, firstWords, seen, lines, calls: CALLS.slice() };
}

(async () => {
  console.log("speed3-atlas (SPEED-3)");
  await new Promise(r => mock.listen(MOCK, r));
  await new Promise(r => sink.listen(SINK, r));
  require("../server.js");
  await require("./helpers").untilReady();
  await seed();
  const tok = await login(ADMIN);
  ok("fixture admin signed in", !!tok, tok);
  await api("POST", "/onboarding/complete", tok, {}).catch(() => {});
  // Warm the process once (module loads), as a person's second ask would be.
  await api("POST", "/atlas", tok, { text: "Tell me about Marlowe" });

  // ── §1 A DRAFT ────────────────────────────────────────────────────────────
  console.log("\n§1 a draft");
  const d = await timed(tok, "Thank Marlowe for her gift", "draft");
  const dl = d.lines.find(l => l.kind === "draft") || {};
  ok("§1 the draft was written, for her review", dl.state === "waiting" && /^Drafted a thank-you to Marlowe\. Review and send\.$/.test(dl.line || ""), d.lines);
  ok("§1 first words on screen under 3 s", d.firstWords && d.firstWords.at < 3000 && /Dear Marlowe/.test(d.firstWords.words), d.firstWords);
  ok("§1 a step line while it works: \"Writing the draft…\"", d.seen.some(s => /^Writing the draft to Marlowe…$/.test(s.line)), d.seen);
  ok("§1 the full draft under 10 s", d.total < 10000, d.total);

  // ── §2 ANSWERS ────────────────────────────────────────────────────────────
  console.log("\n§2 a person answer and a list answer");
  const a = await timed(tok, "Tell me about Marlowe", "person answer");
  ok("§2 the person answer's first words under 3 s", a.firstWords && a.firstWords.at < 3000, a.firstWords);
  ok("§2 a step line names what it reads", a.seen.some(s => /^Reading Marlowe's record…$/.test(s.line)), a.seen);
  const l = await timed(tok, "Who gave last December but not this year?", "list answer");
  // The list's words wait on Ask's query plan, a second model call after the read (SPEED-3 report).
  ok("§2 the list's step line says what it is looking up, under 3 s", l.seen.some(x => x.at < 3000 && /^Looking up: who gave last December but not this year…$/.test(x.line)), l.seen);
  ok("§2 the list answer is complete under 10 s", l.total < 10000, l.total);
  ok("§2 the list is the same list", ((l.lines[0] || {}).answer || {}).people && l.lines[0].answer.people.length === 3, l.lines);

  // ── §3 TWO EMAILS AT ONCE ─────────────────────────────────────────────────
  console.log("\n§3 two drafts in one request");
  const two = await timed(tok, "Write to Marlowe and Odette to thank them for coming to the showcase", "two drafts");
  const dr = two.calls.filter(c => c.tool === "atlas_draft");
  const overlap = dr.length === 2 && dr[1].start < dr[0].end && dr[0].start < dr[1].end;
  ok("§3 both drafts written", two.lines.filter(x => x.kind === "draft" && x.state === "waiting").length === 2, two.lines);
  ok("§3 the two emails are written at the same time, not one after the other", overlap, dr);
  ok("§3 two drafts still under 10 s", two.total < 10000, two.total);

  // ── §4 PAST 15 S ──────────────────────────────────────────────────────────
  console.log("\n§4 a draft that hangs");
  process.env.ATLAS_ANSWER_MS = "4000";   // 20 s in production; 4 s here
  SLOW_DRAFT_MS = 9000;
  const s = await timed(tok, "Write Wren a hello", "hung draft");
  SLOW_DRAFT_MS = 0; delete process.env.ATLAS_ANSWER_MS;
  const sl = s.lines.find(x => x.kind === "draft") || {};
  ok("§4 at the budget the answer is what it has: the template draft, for her review", s.total < 8000 && sl.state === "waiting", { total: s.total, lines: s.lines });
  const fs = require("fs"), path = require("path");
  const ts = fs.readFileSync(path.join(__dirname, "../client/src/components/TellSteward.jsx"), "utf8");
  ok("§4 the dialog says \"Still working: <step>\" past 15 s and shows the words so far", /const SLOW_MS = 15000;/.test(ts) && /Still working: \$\{l\}/.test(ts) && /data-testid="atlas-words"/.test(ts), null);

  // ── §5 NOTHING SENT ───────────────────────────────────────────────────────
  ok("§5 nothing was sent to anyone", MAIL.length === 0, MAIL.length);

  summary();
  await closeDb();
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });
