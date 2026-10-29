// tests/voice2-everywhere.test.js · VOICE-2. TELL STEWARD EVERYWHERE, AND A WHOLE MEETING FILED.
//
// Donor data and money in one suite:
//   §1 the desktop detection: a browser with speech recognition listens
//      (Chrome, Edge, Safari), one without it (Firefox) types and says so;
//   §2 same-name memos: a memo naming two shared names files once both are
//      picked (the picks build up); with AI off the person she picks is the
//      one (it used to ask her to pick again forever); a memo from Margaret
//      Chen's own profile never asks which Margaret;
//   (§3 to §5, meeting mode, went with it in VOICE-3.)
//   §6 a check made out to someone else is caught, and "$250 17/xx" with
//      "Two hundred & fifty dollars + 17/100" reads $250.17 (the confirm
//      route's gate is driven in capture1-zero-day §12).
//
// It boots server.js IN-PROCESS (like voice1-tell-steward) because the model
// is a stand-in: ANTHROPIC_BASE_URL points at a local server.
//
// Planted defects that turned it red: the AI-off pick keeping both people
// (§2), the profile person not answering "which Margaret" (§2), and
// payeeMismatch returning null (§6). The detection (§1) lives in
// shared/voiceTalk.js since VOICE-3 took meeting mode out.
"use strict";

const http = require("http");
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
process.env.ANTHROPIC_API_KEY = "sk-ant-voice2-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

// Every request this process makes to the outside, so §3 can prove nothing went out.
const OUTBOUND = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => { OUTBOUND.push(String(url && url.url || url)); return realFetch(url, opts); };

const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_voice2", SLUG = "voice2-test", ADMIN = "voice2-admin@example.org", USER = "u_voice2";
const sys = "'system:test','test'";

// ── THE STAND-IN MODEL ─────────────────────────────────────────────────────
// Answers whichever tool it is asked for from a queue per tool.
const queued = { memo_actions: [] };
const asked = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    if (!req.url.startsWith("/v1/messages")) return send(404, {});
    let j = {}; try { j = JSON.parse(body); } catch { /* empty */ }
    const name = j.tools && j.tools[0] && j.tools[0].name;
    asked.push({ name, body });
    const input = (queued[name] && queued[name].shift()) || (name === "memo_actions" ? read({}) : {});
    send(200, { id: "msg_standin", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name, input }] });
  });
});
const read = o => ({ how: "", when: "", summary: "", people: [], follow_ups: [], interests: [], email: { subject: "", body: "" },
  money: [], contact: [], sensitive: [], ...o });

const TABLES = ["voice_memos", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "ai_log", "threads", "interactions", "tasks",
  "opportunities", "pledges", "fin_transactions", "gifts", "donors", "user_sessions", "users", "fin_funds", "ai_usage", "ai_fallbacks"];
async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
const count = async (sql, args = [ORG]) => (await q(sql, args))[0].n;

(async () => {
  console.log("voice2-everywhere (VOICE-2)");
  const M = await import("../shared/voiceTalk.js");
  const C = await import("../shared/chequeRead.js");

  // ── §1 the detection ──────────────────────────────────────────────────────
  console.log("\n§1 who listens on a computer");
  const desk = { matchMedia: () => ({ matches: false }) };
  const phone = { matchMedia: () => ({ matches: true }) };
  function SR() {}
  const chrome = M.listenMode({ ...desk, webkitSpeechRecognition: SR });
  const edge = M.listenMode({ ...desk, webkitSpeechRecognition: SR, SpeechRecognition: SR });
  const safari = M.listenMode({ ...desk, webkitSpeechRecognition: SR });
  const firefox = M.listenMode({ ...desk });
  ok("§1 Chrome, Edge and Safari on a computer listen", [chrome, edge, safari].every(x => x.mode === "speech" && !x.phone && x.line === null), { chrome, edge, safari });
  ok("§1 Firefox types, and says why in her words", firefox.mode === "text" && firefox.line === "Your browser can't listen. Type it, or use your computer's dictation.", firefox);
  ok("§1 a phone without it points at the keyboard's microphone", M.listenMode({ ...phone }).line === M.NO_LISTEN_PHONE_LINE, M.listenMode({ ...phone }));
  ok("§1 a refused microphone falls back to typing; a silence does not", M.errorStopsListening("not-allowed") && M.errorStopsListening("service-not-allowed") && !M.errorStopsListening("no-speech"), null);

  await new Promise(r => mock.listen(MOCK, r));
  require("../server.js");
  await require("./helpers").untilReady();   // FIX-57: the server says when boot is done
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled)
           VALUES ($1,'Voice Two Sailing',$2,1,'active','team','America/New_York',NOW(),false)`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, ADMIN, pw]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_v2_gen',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES
           ('d_v2_mchen',$1,'Margaret Chen','mchen@example.org','active','["donor"]'::jsonb,${sys}),
           ('d_v2_mlind',$1,'Margaret Lindqvist','mlind@example.org','active','["donor"]'::jsonb,${sys}),
           ('d_v2_jw',$1,'James Whitford','jw@example.org','active','["donor"]'::jsonb,${sys}),
           ('d_v2_jo',$1,'James Okafor','jo@example.org','active','["donor"]'::jsonb,${sys})`, [ORG]);
  const tok = await login(ADMIN);
  ok("fixture admin signed in", !!tok, tok);
  const today = civilToday();

  // ── §2 same names ─────────────────────────────────────────────────────────
  console.log("\n§2 two Margarets and two Jameses");
  const BOTH = "Coffee with Margaret and James, they loved the boathouse";
  const w1 = await api("POST", "/voice/memos", tok, { text: BOTH });
  const firstAsk = w1.body && w1.body.which;
  ok("§2 Steward asks which, nothing written", w1.status === 200 && !!firstAsk && firstAsk.people.length === 2, w1.body);
  const pick1 = firstAsk.people.find(p => /Chen|Whitford/.test(p.name)).id;
  const w2 = await api("POST", "/voice/memos", tok, { text: BOTH, picks: [pick1] });
  ok("§2 one pick: Steward asks about the OTHER name, not the same one again", w2.status === 200 && !!w2.body.which && w2.body.which.said !== firstAsk.said, w2.body);
  const pick2 = w2.body.which.people.find(p => /Chen|Whitford/.test(p.name)).id;
  queued.memo_actions.push(read({ how: "coffee", summary: "Coffee with Margaret and James. They loved the boathouse.", people: ["Margaret", "James"] }));
  const w3 = await api("POST", "/voice/memos", tok, { text: BOTH, picks: [pick1, pick2] });
  const ppl3 = (w3.body.memo && w3.body.memo.people || []).map(p => p.id).sort();
  ok("§2 both picks together: filed for exactly the two she picked", w3.status === 201 && JSON.stringify(ppl3) === JSON.stringify(["d_v2_jw", "d_v2_mchen"]), { s: w3.status, ppl3 });

  // A memo from Margaret Chen's profile that says "Margaret".
  queued.memo_actions.push(read({ how: "call", summary: "Called Margaret about the boathouse.", people: ["Margaret"] }));
  const w4 = await api("POST", "/voice/memos", tok, { text: "Called Margaret about the boathouse", donorId: "d_v2_mchen" });
  ok("§2 from her own profile Steward never asks which Margaret", w4.status === 201 && w4.body.memo && w4.body.memo.people.map(p => p.id).join() === "d_v2_mchen", { s: w4.status, b: w4.body.which || w4.body.memo && w4.body.memo.people });

  // A pick left over from an earlier memo (or one whose name dropped out of
  // the words) rides along with the one she just clicked: her click still
  // counts. It used to refuse every click: "That is not one of the records".
  queued.memo_actions.push(read({ how: "lunch", summary: "Lunch with Margaret about the boathouse.", people: ["Margaret"] }));
  const leftover = await api("POST", "/voice/memos", tok, { text: "Lunch with Margaret about the boathouse", picks: ["d_v2_jw", "d_v2_mlind"] });
  ok("§2 a stale pick never refuses her click: filed on the Margaret she picked", leftover.status === 201 && leftover.body.memo
    && leftover.body.memo.people.map(p => p.id).join() === "d_v2_mlind", { s: leftover.status, b: leftover.body });
  const ghost = await api("POST", "/voice/memos", tok, { text: "Lunch with Margaret about the boathouse", picks: ["d_nobody_else"] });
  ok("§2 a pick that matches nothing asks again, it does not refuse", ghost.status === 200 && !!ghost.body.which && ghost.body.which.people.length === 2, { s: ghost.status, b: ghost.body });

  // AI off, a memo naming two people: the one she picks is the one.
  await q(`UPDATE orgs SET ai_enabled=false WHERE id=$1`, [ORG]);
  const TWO = "Saw Margaret Chen and James Whitford at the regatta";
  const p1 = await api("POST", "/voice/memos", tok, { text: TWO });
  ok("§2 AI off, two people named: Steward asks her to pick one", p1.status === 200 && !!p1.body.pick, p1.body);
  const notesBefore = await count(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND type='note'`);
  const p2 = await api("POST", "/voice/memos", tok, { text: TWO, donorId: "d_v2_jw" });
  const noteOn = await q(`SELECT donor_id FROM interactions WHERE org_id=$1 AND type='note' ORDER BY created_at DESC LIMIT 1`, [ORG]);
  ok("§2 AI off: picking one files the note on that one (it used to ask again)", p2.status === 201 && !p2.body.pick
    && await count(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND type='note'`) === notesBefore + 1 && noteOn[0] && noteOn[0].donor_id === "d_v2_jw", { s: p2.status, b: p2.body.pick || null, noteOn });
  await q(`UPDATE orgs SET ai_enabled=true WHERE id=$1`, [ORG]);

  // ── §6 the check ──────────────────────────────────────────────────────────
  console.log("\n§6 the check");
  const hook = C.payeeMismatch("Captain Hook", ["Harborlight Youth Collective"]);
  ok("§6 a check made out to Captain Hook says so plainly", !!hook && hook.sentence === "This check is made out to Captain Hook, not Harborlight Youth Collective.", hook);
  ok("§6 the org's own name, written loosely, is no warning", C.payeeMismatch("The Harborlight Youth Collective, Inc.", ["Harborlight Youth Collective"]) === null
    && C.payeeMismatch("", ["Harborlight Youth Collective"]) === null, null);
  const plain = raw => { const n = Number(String(raw).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : null; };
  const words = C.writtenAmountToCents("Two hundred & fifty dollars + 17/100");
  const figs = C.chequeDigitsToCents("$250 17/xx", plain);
  ok("§6 \"$250 17/xx\" and \"Two hundred & fifty dollars + 17/100\" both read $250.17", words === 25017 && figs === 25017, { words, figs });
  ok("§6 figures and words that disagree still do not agree", C.writtenAmountToCents("Two hundred & forty dollars + 17/100") !== figs, null);

  mock.close();
  await reset();
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error("SUITE ERROR:", e); mock.close(); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
