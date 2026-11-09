// tests/atlas5-dates-and-waits.test.js · ATLAS-5. ATLAS READS DATES RIGHT, STARTS EMPTY, AND GETS OUT OF THE WAY.
//
// Donor data (notes, reminders) on a made-up org, Lantern Cove Rowing
// (tests/atlas5/fixture.js), in New York time. The model is a stand-in below,
// written to read the way the fleet's walks saw (lead-2026-11-08).
//   §1 the date table: every weekday it is said on × every phrase ("this",
//      "next", "on", "in N days", "end of month"), at 9:30 PM New York, when
//      UTC is already the next day (W-1108-Atlas-20);
//   §2 "Remind me next Tuesday" through POST /atlas: the coming Tuesday, the
//      label without the date words, the weekday on the saved line;
//   §3 the textbox starts empty and Send waits for her words (browser leg);
//   §4 every waiting item can be dismissed: a proposal discarded writes
//      nothing and Save refuses it after; an unanswered "Which Walter?" waits
//      in the bell and can be dismissed; the bell closes with Escape, its ×
//      and a click outside, focus back on the bell (browser leg) (W-1108-Atlas-08X, 08);
//   §5 one answer per person, each note once by id (W-1108-Atlas-02X);
//   §6 the whole message is the note; only "and also" splits it (W-1108-Atlas-03X);
//   §7 what Steward can't know is said plainly (W-1107-Atlas-07);
//   §8 speed: a known shape is answered without the model, and the read goes
//      to the smaller model (W-1107-Atlas-23);
//   §9 nothing was sent.
// Planted (ATLAS-5 report): todayIn reading UTC instead of the org's zone
// turns §1 red.
"use strict";

const http = require("http");
const path = require("path");

const PORT = Number(process.env.MATRIX_PORT || 5698);
const MOCK = Number(process.env.CALENDAR_MOCK_PORT || 5619);
const SINK = Number(process.env.SINK_PORT || 5617);
process.env.PORT = String(PORT);
process.env.BASE_SHARD = process.env.BASE || "";   // the shard's own server, for the browser leg
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
process.env.ANTHROPIC_API_KEY = "sk-ant-atlas5-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");
const F = require("./atlas5/fixture");
const ROOT = path.join(__dirname, "..");

const MAIL = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", d => { b += d; });
  req.on("end", () => { MAIL.push(b); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "re_sink_" + MAIL.length })); });
});

// ── THE STAND-IN MODEL: the reads the fleet's walks saw ─────────────────────
const step = o => ({ kind: "other", who: "", target: "", amount_words: "", when_words: "", how: "", words: "", ...o });
const READS = [
  [/^Remind me next Tuesday/, [step({ kind: "reminder", who: "Sterling", when_words: "next Tuesday", words: "Remind me next Tuesday to call Sterling" })]],
  // 03X: a trailing label read as a second request, and the note cut to the model's words.
  [/^Sterling prefers morning calls\. QA A5/, [step({ kind: "note", who: "Sterling", words: "Sterling prefers morning calls" }), step({ kind: "other", words: "QA A5" })]],
  [/^Sterling prefers rowing at dawn and also/, [step({ kind: "note", who: "Sterling", words: "Sterling prefers rowing at dawn" }),
    step({ kind: "reminder", who: "Walter Osei", when_words: "tomorrow", words: "remind me to call Walter Osei tomorrow" })]],
  // 02X: the same person asked about twice in one read.
  [/^Juniper: what do we know/, [step({ kind: "about", who: "Juniper", words: "what do we know" }), step({ kind: "about", who: "Juniper Hale", words: "and her notes" })]],
];
const CALLS = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    let x = {}; try { x = JSON.parse(body); } catch { /* empty */ }
    const name = x.tools && x.tools[0] && x.tools[0].name;
    const user = (x.messages || []).map(m => (typeof m.content === "string" ? m.content : (m.content || []).map(c => c.text || "").join("\n"))).join("\n");
    CALLS.push({ tool: name, model: x.model });
    let input = null;
    if (name === "atlas_read") {
      const said = (/What she said: (.*)$/m.exec(user) || [])[1] || "";
      const hit = READS.find(([re]) => re.test(said));
      input = { steps: hit ? hit[1] : [] };
    }
    res.writeHead(input ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(input ? { id: "msg_standin", type: "message", role: "assistant", model: x.model, stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name, input }] }
      : { type: "error", error: { type: "api_error", message: "no stand-in for " + name } }));
  });
});

// ── §1 THE DATE TABLE, worked out here from first principles ───────────────
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const civilAdd = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dowOf = d => new Date(d + "T12:00:00Z").getUTCDay();
function expected(phrase, today) {
  let m = /^(this|next|on) (\w+)$/.exec(phrase);
  if (m) {
    const ahead = (DAYS.indexOf(m[2]) - dowOf(today) + 7) % 7;
    if (m[1] === "this" && ahead === 0) return today;
    return civilAdd(today, ahead || 7);
  }
  m = /^in (\d+) days$/.exec(phrase);
  if (m) return civilAdd(today, Number(m[1]));
  if (phrase === "end of month") { const [y, mo] = today.split("-").map(Number); return civilAdd(mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`, -1); }
  return null;
}

(async () => {
  console.log("atlas5-dates-and-waits (ATLAS-5)");
  const A = await import(path.join(ROOT, "shared/atlas.js"));
  const AD = await import(path.join(ROOT, "shared/atlasDates.js"));

  console.log("\n§1 the date table, in the org's day");
  // 9:30 PM in New York, Sunday Nov 8 to Saturday Nov 14, 2026 (EST, UTC-5): UTC is already the next day.
  const misses = [];
  let cells = 0;
  for (let i = 0; i < 7; i++) {
    const nyDay = civilAdd("2026-11-08", i);
    const instant = new Date(`${civilAdd(nyDay, 1)}T02:30:00Z`);
    const today = AD.todayIn("America/New_York", instant);
    if (today !== nyDay) misses.push({ instant: instant.toISOString(), today, want: nyDay });
    const phrases = [...DAYS.flatMap(d => [`this ${d}`, `next ${d}`, `on ${d}`]), "in 1 days", "in 3 days", "in 10 days", "end of month"];
    for (const p of phrases) {
      cells++;
      const got = (A.whenFromWords(p.replace("in 1 days", "in 1 day"), today) || {}).date;
      const want = expected(p, nyDay);
      if (got !== want) misses.push({ said: p, on: DAYS[dowOf(nyDay)], got, want });
    }
  }
  ok(`§1 every phrase on every weekday lands on the right day (${cells} cells)`, misses.length === 0, misses.slice(0, 8));
  const sunNight = AD.todayIn("America/New_York", new Date("2026-11-09T02:51:00Z"));
  ok("§1 the fleet's case: \"next Tuesday\" said Sunday Nov 8 at 9:51 PM is Tue, Nov 10",
    AD.dayWithWeekday(A.whenFromWords("next Tuesday", sunNight).date, sunNight) === "Tue, Nov 10", sunNight);
  ok("§1 and said on Saturday Nov 7 it is the same Tuesday", A.whenFromWords("next Tuesday", AD.todayIn("America/New_York", new Date("2026-11-08T02:00:00Z"))).date === "2026-11-10");
  ok("§1 \"we sat down\" names no day", A.whenFromWords("we sat down for coffee", "2026-11-08") === null);

  await new Promise(r => mock.listen(MOCK, r));
  await new Promise(r => sink.listen(SINK, r));
  require("../server.js");
  await require("./helpers").untilReady();
  await F.reset(q);
  await F.seed(q, civilToday(), { ai: true });
  const tok = await login(F.ADMIN);
  ok("fixture admin signed in", !!tok, tok);
  await api("POST", "/onboarding/complete", tok, {}).catch(() => {});
  const say = text => api("POST", "/atlas", tok, { text, source: "typed" }).then(r => (r.body && r.body.request) || {});
  const nyToday = AD.todayIn("America/New_York");

  console.log("\n§2 \"Remind me next Tuesday\" through Atlas");
  let rq = await say("Remind me next Tuesday to call Sterling");
  const fu = ((rq.proposal || {}).items || []).find(i => i.kind === "follow_up") || {};
  ok("§2 the follow-up is due the coming Tuesday in the org's day", fu.due === expected("next tuesday", nyToday), { fu, nyToday });
  ok("§2 its label keeps her words without the date words", fu.title === "Call Sterling", fu);
  let sv = await api("POST", `/atlas/${rq.id}/save`, tok, { proposalId: rq.proposal && rq.proposal.id });
  const rem = ((sv.body.request || {}).lines || []).find(l => l.kind === "reminder") || {};
  ok("§2 the saved line says the weekday and the date", new RegExp(`^Reminder for ${AD.dayWithWeekday(fu.due, nyToday)}: `).test(rem.line || ""), rem.line);

  console.log("\n§4 every waiting item can be let go");
  rq = await say("Remind me next Tuesday to call Sterling");
  const tasksBefore = (await q("SELECT COUNT(*)::int n FROM tasks WHERE org_id=$1", [F.ORG]))[0].n;
  const disc = await api("POST", `/atlas/${rq.id}/discard`, tok, {});
  const pline = ((disc.body.request || {}).lines || []).find(l => l.kind === "proposal") || {};
  ok("§4 a discarded proposal stops waiting", disc.status === 200 && pline.state === "discarded" && pline.waits === false, { status: disc.status, pline });
  const late = await api("POST", `/atlas/${rq.id}/save`, tok, { proposalId: rq.proposal.id });
  const tasksAfter = (await q("SELECT COUNT(*)::int n FROM tasks WHERE org_id=$1", [F.ORG]))[0].n;
  ok("§4 Save refuses it after, and nothing was written", late.status === 409 && tasksAfter === tasksBefore, { status: late.status, tasksBefore, tasksAfter });
  rq = await say("Remind me next Tuesday to call Sterling");
  const pid = ((rq.lines || []).find(l => l.kind === "proposal") || {}).id;
  const dm = await api("POST", `/atlas/actions/${pid}/dismiss`, tok, {});
  ok("§4 Dismiss on the bell's proposal line discards it", dm.status === 200 && dm.body.action && dm.body.action.state === "discarded", dm.body);
  const walter = await say("Tell me about Walter");
  let bell = (await api("GET", "/atlas/activity", tok)).body;
  const qItem = (bell.items || []).find(i => i.kind === "question" && i.requestId === walter.id);
  ok("§4 an unanswered \"Which Walter?\" waits in the bell, and is counted", walter.status === "needs_answers" && !!qItem && qItem.waits === true && bell.waiting >= 1, { status: walter.status, qItem, waiting: bell.waiting });
  const before = bell.waiting;
  const dq = await api("POST", `/atlas/${walter.id}/dismiss-question`, tok, {});
  bell = (await api("GET", "/atlas/activity", tok)).body;
  ok("§4 dismissed, it leaves the bell and the count drops", dq.status === 200 && !(bell.items || []).some(i => i.requestId === walter.id && i.kind === "question") && bell.waiting === before - 1, { dq: dq.status, waiting: bell.waiting, before });
  ok("§4 nothing is waiting once each was let go", bell.waiting === 0, bell.items.filter(i => i.waits));

  console.log("\n§5 one answer per person, each note once");
  rq = await say("Juniper: what do we know, and her notes");
  const answers = (rq.lines || []).filter(l => l.answer && l.answer.type === "person");
  const facts = answers.flatMap(l => l.answer.facts.filter(f => f.kind === "conversation" && f.id));
  ok("§5 the read asked twice; Atlas answers once", answers.length === 1, (rq.lines || []).map(l => l.line));
  ok("§5 the lunch note is listed once, by its id", facts.filter(f => f.id === "i_a5_1").length === 1, facts);

  console.log("\n§6 the whole message is the note");
  rq = await say("Sterling prefers morning calls. QA A5");
  const note = ((rq.proposal || {}).items || []).find(i => i.kind === "note") || {};
  ok("§6 the trailing label stays in the note", note.note === "Sterling prefers morning calls. QA A5", note);
  ok("§6 and is not a second request", !(rq.lines || []).some(l => l.kind === "cant" || /can't do that part/i.test(l.line)), (rq.lines || []).map(l => l.line));
  rq = await say("Sterling prefers rowing at dawn and also remind me to call Walter Osei tomorrow");
  const items = (rq.proposal || {}).items || [];
  const n2 = items.find(i => i.kind === "note") || {};
  ok("§6 \"and also\" splits it: the note ends there, and the reminder is its own",
    n2.note === "Sterling prefers rowing at dawn" && items.some(i => i.kind === "follow_up" && i.due === civilAdd(nyToday, 1)), items);

  console.log("\n§7 what Steward can't know, plainly");
  rq = await say("What is Sterling's favorite color?");
  const cl = ((rq.lines || [])[0] || {}).line || "";
  ok("§7 one plain sentence, with what she can do about it", cl === "I don't have Sterling's favorite color. I can add it as a note if you tell me.", cl);
  ok("§7 no quoted fragment", !/["“”]/.test(cl), cl);

  console.log("\n§8 speed");
  CALLS.length = 0;
  rq = await say("Tell me about Juniper");
  ok("§8 a person's summary is answered with no model call", CALLS.length === 0 && (rq.lines || []).some(l => l.answer && l.answer.type === "person"), CALLS);
  CALLS.length = 0;
  await say("Remind me next Tuesday to call Sterling");
  const read = CALLS.find(c => c.tool === "atlas_read") || {};
  ok("§8 the read goes to the smaller model", /haiku/.test(read.model || ""), CALLS);

  // §3 and the bell: a browser leg against the shard's server and this shard's dist.
  await require("./atlas5/browser").leg({ ok, F, base: process.env.BASE_SHARD, q, api, tok });

  console.log("\n§9 nothing was sent");
  ok("§9 the mail sink is empty", MAIL.length === 0, MAIL.length);

  await F.reset(q);
  await closeDb();
  mock.close(); sink.close();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error(e); await F.reset(q).catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
