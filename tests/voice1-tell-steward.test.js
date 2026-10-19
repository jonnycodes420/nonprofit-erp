// tests/voice1-tell-steward.test.js · VOICE-1. TALK FOR 30 SECONDS, AND THE PAPERWORK IS DONE.
//
// Donor data, money and email in one suite. A memo goes through one model call
// (a stand-in here, answering with a fixed read) and Steward files it:
//   §1 "Lunch with Margaret, loved the barn tour, wants to give to the new
//      arena, circle back in March" logs one lunch on Margaret, puts a March
//      step on her Thread, notes Arena Fund interest, drafts an email, and
//      sends nothing;
//   §2 a memo with a dollar amount is a confirm card and records no money
//      until the yes; an amount the memo never said is no card at all;
//   §3 a health detail is a flagged suggestion and nothing about it is filed
//      until it is accepted, even when the model puts it in the summary;
//   §4 two Margarets: nothing is written (and no model is asked) until one is
//      picked;
//   §5 with AI off the memo is a note on the chosen person and nothing else;
//   §6 Undo removes everything the memo did.
//
// It boots server.js IN-PROCESS (like capture1-zero-day) because the model is
// a stand-in: ANTHROPIC_BASE_URL points at a local server.
//
// Planted defects that turned this red: the money card recorded as a gift on
// the memo (§2), the sensitive screen returning nothing (§3), the which-check
// removed (§4), the AI-off branch filing a whole conversation (§5), and Undo
// skipping the run's writes (§6).
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
process.env.ANTHROPIC_API_KEY = "sk-ant-voice1-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

// Every request this process makes to the outside, so §1 can prove nothing went out.
const OUTBOUND = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => { OUTBOUND.push(String(url && url.url || url)); return realFetch(url, opts); };

const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_voice1", SLUG = "voice1-test", ADMIN = "voice1-admin@example.org", USER = "u_voice1";
const sys = "'system:test','test'";

// ── THE STAND-IN MODEL ─────────────────────────────────────────────────────
const queued = [];
const sentToModel = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url.startsWith("/v1/messages")) {
      sentToModel.push(body);
      return send(200, { id: "msg_standin", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", id: "tu_1", name: "memo_actions", input: queued.shift() || read({}) }] });
    }
    send(404, {});
  });
});
const read = o => ({ how: "", when: "", summary: "", people: [], follow_ups: [], interests: [], email: { subject: "", body: "" },
  money: [], contact: [], sensitive: [], ...o });

const TABLES = ["voice_memos", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "ai_log", "threads", "interactions", "tasks",
  "opportunities", "pledges", "fin_transactions", "gifts", "donors", "user_sessions", "users", "fin_funds", "ai_usage", "ai_fallbacks"];
async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  // Whatever else a write touched (a gift's ledger rows, a score), so a red run leaves nothing for the next one.
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
const count = async (sql, args = [ORG]) => (await q(sql, args))[0].n;

(async () => {
  console.log("voice1-tell-steward (VOICE-1)");
  await new Promise(r => mock.listen(MOCK, r));
  require("../server.js");
  await new Promise(r => setTimeout(r, 3500));   // boot DDL settles
  await reset();

  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled)
           VALUES ($1,'Voice One Stables',$2,1,'active','team','America/New_York',NOW(),false)`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, ADMIN, pw]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_v1_gen',$1,'General Operating',false),('f_v1_arena',$1,'Arena Fund',true)`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES
           ('d_v1_marg',$1,'Margaret Hale','margaret@example.org','active','["donor"]'::jsonb,${sys}),
           ('d_v1_james',$1,'James Whitford','james@example.org','active','["donor"]'::jsonb,${sys})`, [ORG]);
  const tok = await login(ADMIN);
  ok("fixture admin signed in", !!tok, tok);
  const today = civilToday();
  const [ty, tm] = today.split("-").map(Number);
  const march = `${tm >= 3 ? ty + 1 : ty}-03-01`;

  // ── §1 the lunch ──────────────────────────────────────────────────────────
  console.log("\n§1 the lunch memo");
  const LUNCH = "Lunch with Margaret, loved the barn tour, wants to give to the new arena, circle back in March";
  queued.push(read({ how: "lunch", summary: "Lunch with Margaret. She loved the barn tour and wants to give to the new arena.", people: ["Margaret"],
    follow_ups: [{ label: "Circle back with Margaret about the arena", when: "in March", quote: "circle back in March" }],
    interests: [{ words: "the new arena", quote: "wants to give to the new arena" }],
    email: { subject: "Thank you for lunch", body: "Dear Margaret, thank you for lunch and for coming out to see the barn. I will be in touch in March about the arena." } }));
  const out0 = OUTBOUND.length;
  const m1 = await api("POST", "/voice/memos", tok, { text: LUNCH, source: "speech" });
  ok("§1 the memo is filed", m1.status === 201 && !!m1.body.memo, m1.status === 201 ? m1.body.memo && m1.body.memo.status : m1.body);
  const memo1 = m1.body.memo || {};
  const lunches = await q(`SELECT id, type, date, note, metadata FROM interactions WHERE org_id=$1 AND donor_id='d_v1_marg' AND type='meeting'`, [ORG]);
  ok("§1 one lunch on Margaret, dated today, with the memo it came from", lunches.length === 1 && String(lunches[0].date).slice(0, 10) === today
    && /^Lunch with Margaret/.test(lunches[0].note) && !/^Lunch\. Lunch/.test(lunches[0].note) && lunches[0].metadata && lunches[0].metadata.memoId === memo1.id && lunches[0].metadata.how === "lunch", lunches);
  const [thr] = await q(`SELECT next_step_label, due_date FROM threads WHERE org_id=$1 AND donor_id='d_v1_marg' AND closed_at IS NULL`, [ORG]);
  ok("§1 a step on her Thread for early March, counted from her words", !!thr && String(thr.due_date).slice(0, 10) === march && /Circle back/.test(thr.next_step_label), { thr, march });
  const [tg] = await q(`SELECT tags FROM donors WHERE id='d_v1_marg'`);
  ok("§1 the new arena is the Arena Fund, noted as her interest", JSON.stringify(tg.tags).includes("Interest: Arena Fund"), tg.tags);
  const drafts1 = await q(`SELECT id, status, subject FROM agent_drafts WHERE org_id=$1 AND donor_id='d_v1_marg'`, [ORG]);
  ok("§1 one email drafted, waiting, and on the yes side of the screen", drafts1.length === 1 && drafts1[0].status === "pending"
    && (memo1.waiting || []).some(c => c.kind === "draft" && c.draftId === drafts1[0].id && c.state === "waiting"), { drafts1, waiting: memo1.waiting });
  const [run1] = await q(`SELECT sent FROM agent_runs WHERE org_id=$1`, [ORG]);
  const outside = OUTBOUND.slice(out0).filter(u => !u.startsWith(process.env.BASE) && !u.startsWith("http://127.0.0.1") && !u.startsWith(process.env.ANTHROPIC_BASE_URL));
  ok("§1 nothing was sent: the run sent 0 and no request left the process", !!run1 && run1.sent === 0 && outside.length === 0, { run1, outside });
  // (Logging a conversation also asks for the wealth score's two sentences, as any logged touch does; that is not the memo.)
  const memoReads = () => sentToModel.filter(b => b.includes('"memo_actions"'));
  ok("§1 one memo read, and it carried the memo", memoReads().length === 1 && memoReads()[0].includes("barn tour"), sentToModel.map(b => b.slice(0, 120)));
  const [vm1] = await q(`SELECT text, source, ai FROM voice_memos WHERE id=$1`, [memo1.id]);
  ok("§1 the memo itself is kept as said, with no audio", !!vm1 && vm1.text === LUNCH && vm1.source === "speech" && vm1.ai === "on", vm1);
  ok("§1 the done list says what was done", (memo1.done || []).length >= 3 && memo1.done.every(d => d.outcome === "done"), memo1.done);
  const [ins1] = await q(`SELECT persona FROM agent_instructions WHERE org_id=$1`, [ORG]);
  ok("§1 planned with the Notes persona", !!ins1 && ins1.persona === "notes", ins1);

  // ── §2 an amount is a card ────────────────────────────────────────────────
  console.log("\n§2 money waits for a yes");
  const COFFEE = "Coffee with James Whitford. He is thinking about $5,000 for the Arena Fund next year.";
  queued.push(read({ how: "coffee", summary: "Coffee with James.", people: ["James Whitford"],
    money: [{ kind: "interest", fund_words: "Arena Fund", quote: "thinking about $5,000 for the Arena Fund" },
            { kind: "gift", fund_words: "", quote: "He gave $900 last week" }] }));   // hostile: never said
  const m2 = await api("POST", "/voice/memos", tok, { text: COFFEE });
  const memo2 = m2.body.memo || {};
  const cards2 = (memo2.waiting || []).filter(c => c.kind === "money");
  ok("§2 one card: Log interest in a $5,000 gift to the Arena Fund", m2.status === 201 && cards2.length === 1 && cards2[0].cents === 500000
    && /\$5,000 gift to the Arena Fund/.test(cards2[0].title), cards2);
  const money0 = await count(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1) + (SELECT COUNT(*) FROM pledges WHERE org_id=$1) + (SELECT COUNT(*) FROM opportunities WHERE org_id=$1) AS n`);
  ok("§2 no money is written before the yes (no gift, pledge or proposal)", Number(money0) === 0, money0);
  const yes = await api("POST", `/voice/memos/${memo2.id}/cards/${cards2[0] && cards2[0].id}/yes`, tok, {});
  const prop = await q(`SELECT id FROM opportunities WHERE org_id=$1 AND donor_id='d_v1_james'`, [ORG]).catch(() => []);
  const note = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id='d_v1_james' AND type='note' AND note LIKE 'Interest in a $5,000%'`, [ORG]);
  ok("§2 her yes logs the interest, and records no gift", yes.status === 200 && (prop.length === 1 || note.length === 1)
    && Number(await count(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`)) === 0, { s: yes.status, b: yes.body && yes.body.error, prop, note });
  const again = await api("POST", `/voice/memos/${memo2.id}/cards/${cards2[0] && cards2[0].id}/yes`, tok, {});
  ok("§2 a second yes does nothing", again.status === 409, again.status);

  // ── §3 a health detail ────────────────────────────────────────────────────
  console.log("\n§3 a personal detail is never filed silently");
  const VISIT = "Visit with James Whitford. His wife is recovering from surgery. He wants to hear about the scholarship program.";
  queued.push(read({ how: "visit", people: ["James Whitford"],
    summary: "Visit with James. His wife is recovering from surgery. He wants to hear about the scholarship program.",   // hostile: the model filed it
    follow_ups: [{ label: "Send James the scholarship update", when: "next week", quote: "He wants to hear about the scholarship program" }],
    email: { subject: "Good to see you", body: "Dear James, I hope your wife is recovering from surgery well. More on the scholarship soon." } }));
  const m3 = await api("POST", "/voice/memos", tok, { text: VISIT });
  const memo3 = m3.body.memo || {};
  const flag = (memo3.waiting || []).find(c => c.kind === "sensitive");
  ok("§3 the detail is a flagged suggestion, worded neutrally", m3.status === 201 && !!flag && flag.state === "waiting" && !/surgery|wife/i.test(flag.neutral) && flag.category === "health", memo3.waiting);
  const leak = await count(`SELECT (SELECT COUNT(*) FROM interactions WHERE org_id=$1 AND (note ILIKE '%surgery%' OR metadata::text ILIKE '%surgery%'))
    + (SELECT COUNT(*) FROM agent_drafts WHERE org_id=$1 AND body ILIKE '%surgery%') + (SELECT COUNT(*) FROM threads WHERE org_id=$1 AND next_step_label ILIKE '%surgery%')
    + (SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND title ILIKE '%surgery%') + (SELECT COUNT(*) FROM voice_memos WHERE org_id=$1 AND text ILIKE '%surgery%') AS n`);
  ok("§3 nothing about it is filed: not the conversation, the draft, the Thread or the memo as kept", Number(leak) === 0, leak);
  const [visit] = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id='d_v1_james' AND type='meeting' AND note LIKE 'Visit%'`, [ORG]);
  ok("§3 the rest of the visit is still logged", !!visit && /scholarship/.test(visit.note), visit);
  const keep = await api("POST", `/voice/memos/${memo3.id}/cards/${flag && flag.id}/yes`, tok, {});
  const saved = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id='d_v1_james' AND type='note' AND note=$2`, [ORG, flag && flag.neutral]);
  ok("§3 saved, it is the neutral words on the record, and still never the detail", keep.status === 200 && saved.length === 1
    && Number(await count(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND note ILIKE '%surgery%'`)) === 0
    && !JSON.stringify(keep.body).includes("surgery"), { s: keep.status, saved });

  // ── §4 two Margarets ──────────────────────────────────────────────────────
  console.log("\n§4 two Margarets");
  await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ('d_v1_marg2',$1,'Margaret Ostrander','active',${sys})`, [ORG]);
  const before4 = await count(`SELECT (SELECT COUNT(*) FROM interactions WHERE org_id=$1) + (SELECT COUNT(*) FROM voice_memos WHERE org_id=$1)
    + (SELECT COUNT(*) FROM agent_instructions WHERE org_id=$1) + (SELECT COUNT(*) FROM threads WHERE org_id=$1) AS n`);
  const calls4 = memoReads().length;
  const CALL = "Call with Margaret, she wants the spring newsletter.";
  const w = await api("POST", "/voice/memos", tok, { text: CALL });
  const after4 = await count(`SELECT (SELECT COUNT(*) FROM interactions WHERE org_id=$1) + (SELECT COUNT(*) FROM voice_memos WHERE org_id=$1)
    + (SELECT COUNT(*) FROM agent_instructions WHERE org_id=$1) + (SELECT COUNT(*) FROM threads WHERE org_id=$1) AS n`);
  ok("§4 Steward asks which Margaret, with each one's last gift and last contact", w.status === 200 && !!w.body.which && w.body.which.people.length === 2
    && w.body.which.people.every(p => /last contact|no contact logged/.test(p.detail)), w.body);
  ok("§4 nothing was written and no model was asked", Number(before4) === Number(after4) && memoReads().length === calls4, { before4, after4 });
  queued.push(read({ how: "call", summary: "Call with Margaret about the spring newsletter.", people: ["Margaret"] }));
  const picked = await api("POST", "/voice/memos", tok, { text: CALL, picks: ["d_v1_marg2"] });
  const calls = await q(`SELECT donor_id FROM interactions WHERE org_id=$1 AND type='call'`, [ORG]);
  ok("§4 once she picks, it lands on the one she picked", picked.status === 201 && calls.length === 1 && calls[0].donor_id === "d_v1_marg2", { s: picked.status, calls });

  // ── §5 AI off ─────────────────────────────────────────────────────────────
  console.log("\n§5 AI off");
  await q(`UPDATE orgs SET ai_enabled=false WHERE id=$1`, [ORG]);
  const calls5 = sentToModel.length;   // AI off: no call of any kind
  const OFF = "Ran into someone at the feed store, they asked about volunteering at the spring show.";
  const pick = await api("POST", "/voice/memos", tok, { text: OFF });
  ok("§5 with nobody named, Steward asks who, and files nothing", pick.status === 200 && !!pick.body.pick
    && Number(await count(`SELECT COUNT(*)::int AS n FROM voice_memos WHERE org_id=$1 AND ai='off'`)) === 0, pick.body);
  const snap = async () => ({ i: await count(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND type<>'note'`),
    t: await count(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1`), d: await count(`SELECT COUNT(*)::int AS n FROM agent_drafts WHERE org_id=$1`),
    k: await count(`SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1`), tags: JSON.stringify((await q(`SELECT tags FROM donors WHERE id='d_v1_james'`))[0].tags) });
  const s5 = await snap();
  const off = await api("POST", "/voice/memos", tok, { text: OFF, donorId: "d_v1_james" });
  const offNote = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id='d_v1_james' AND type='note' AND note=$2`, [ORG, OFF]);
  ok("§5 the memo is a note on the person she chose", off.status === 201 && offNote.length === 1 && off.body.memo.ai === "off", { s: off.status, offNote });
  ok("§5 and nothing else happened: no conversation, step, task, tag or draft, and no model call",
    JSON.stringify(await snap()) === JSON.stringify(s5) && sentToModel.length === calls5, { before: s5, after: await snap(), calls: sentToModel.length - calls5 });
  await q(`UPDATE orgs SET ai_enabled=true WHERE id=$1`, [ORG]);

  // ── §6 Undo ───────────────────────────────────────────────────────────────
  console.log("\n§6 Undo");
  const w1 = await q(`SELECT w.entity_table, w.entity_id FROM agent_writes w JOIN voice_memos v ON v.run_ids ? w.run_id WHERE v.id=$1`, [memo1.id]);
  const u = await api("POST", `/voice/memos/${memo1.id}/undo`, tok, {});
  const leftI = await count(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND metadata->>'memoId'=$2`, [ORG, memo1.id]);
  const [thr6] = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1 AND donor_id='d_v1_marg' AND closed_at IS NULL`, [ORG]);
  const [tg6] = await q(`SELECT tags FROM donors WHERE id='d_v1_marg'`);
  const dr6 = await count(`SELECT COUNT(*)::int AS n FROM agent_drafts WHERE org_id=$1 AND donor_id='d_v1_marg'`);
  const tl6 = await count(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id='d_v1_marg'`);
  ok("§6 Undo answers with every write taken back", u.status === 200 && u.body.undone === w1.length && w1.length >= 5 && u.body.failed.length === 0, { s: u.status, b: u.body && { undone: u.body.undone, failed: u.body.failed }, writes: w1.length });
  ok("§6 the lunch, the Thread step, the interest, the draft and its timeline line are all gone", Number(leftI) === 0 && thr6.n === 0
    && !JSON.stringify(tg6.tags).includes("Interest") && Number(dr6) === 0 && Number(tl6) === 0, { leftI, thr6, tags: tg6.tags, dr6, tl6 });
  const u2 = await api("POST", `/voice/memos/${memo1.id}/undo`, tok, {});
  ok("§6 a second Undo does nothing", u2.status === 409, u2.status);

  await reset();
  mock.close();
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error("SUITE ERROR:", e); mock.close(); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
