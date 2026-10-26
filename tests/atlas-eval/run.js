// tests/atlas-eval/run.js · AGENT-5. THE TWENTY-FIVE, AGAINST THE REAL MODEL.
//
// Builds one fixture org (never the demo), says each request in cases.js to
// POST /atlas in order, answers the questions it asks by name, and scores each
// case exactly: the questions, then the lines (kind, state, who), then any
// database fact. A miss is SAFE when it asked or did less. Then the AI-off
// cases, with the org's AI switch off.
//
//   BASE=http://localhost:5601 DATABASE_URL=… node tests/atlas-eval/run.js
// In GitHub Actions (nightly-ai.yml, suite: atlas) the server's model calls go
// through the counting proxy, which alone holds ANTHROPIC_EVAL_KEY. Locally
// there is no key, so every case runs as AI off and only the AI-off cases are
// scored (pass ATLAS_EVAL_EXPECT=off to say so).
// Writes the table to OUT (default atlas-eval-summary.json) and exits 1 when
// fewer than 24 of 25 are right or any miss is unsafe.
"use strict";
// ATLAS_EVAL_STANDIN=1: boot server.js in this process with a stand-in model
// that returns ideal-reads.js, so everything after the read is proved here.
const STANDIN = process.env.ATLAS_EVAL_STANDIN === "1";
if (STANDIN) {
  const PORT = Number(process.env.MATRIX_PORT || 5698), MOCK = Number(process.env.CALENDAR_MOCK_PORT || 5619);
  Object.assign(process.env, { PORT: String(PORT), BASE: `http://localhost:${PORT}`, DISABLE_BACKGROUND_TICKS: "1", DISABLE_RATE_LIMIT: "1",
    SESSION_CACHE_TTL_MS: "0", JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", RESEND_API_KEY: "re_dummy_local",
    RESEND_BASE_URL: `http://localhost:${Number(process.env.SINK_PORT || 5617)}`, STRIPE_SECRET_KEY: "sk_test_dummy",
    STEWARD_CREDENTIAL_KEY: process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789",
    ANTHROPIC_API_KEY: "sk-ant-atlas-eval-standin", ANTHROPIC_BASE_URL: `http://localhost:${MOCK}` });
  if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "")) process.env.DB_SSL = "disable";
}
const fs = require("fs");
const http = require("http");
const bcrypt = require("bcryptjs");
const { login, api, q, closeDb, civilToday } = require("../helpers");
const CASES = require("./cases");

const ORG = "org_atlaseval", ADMIN = "atlas-eval@example.org";
const OUT = process.env.OUT || "atlas-eval-summary.json";
const sys = "'system:test','test'";

async function reset() {
  const first = ["atlas_actions", "voice_memos", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "cultivation_plans", "merge_proposals",
    "event_attendees", "events", "threads", "interactions", "tasks", "pledges", "gifts", "group_members", "cultivation_templates", "audiences", "donors", "households", "user_sessions", "users"];
  for (const t of first) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

const PEOPLE = [
  ["d_ev_uf", "Undine Fairweather", "undine.f@example.org", "Salem"], ["d_ev_ua", "Undine Ashgrove", "undine.a@example.org", "Beverly"],
  ["d_ev_mc", "Margaret Chen", "margaret@example.org", "Marblehead"], ["d_ev_ih", "Ingrid Halvorsen", "ingrid@example.org", "Gloucester"],
  ["d_ev_hh", "Henrik Halvorsen", "henrik@example.org", "Gloucester"], ["d_ev_tf", "Tobias Fairweather", "tobias@example.org", "Salem"],
  ["d_ev_rd", "Rosa Delgado", "rosa@example.org", "Lynn"], ["d_ev_so1", "Sam Okafor", "sam.okafor@example.org", "Boston"],
  ["d_ev_so2", "Sam Okafor", "sokafor@example.org", "Portland"], ["d_ev_dw", "Dana Whitcombe", "dana.w@example.org", "Salem"],
];
async function fixture() {
  const today = civilToday();
  const plus = d => { const t = new Date(today + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,legal_name,ein,onboarded_at,client_privacy,ai_enabled)
           VALUES ($1,'Atlas Eval Harbor','atlas-eval',1,'active','team','America/New_York',NOW(),true,'Atlas Eval Harbor Inc','12-3456789',NOW(),true,true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_atlaseval',$1,$2,$3,'Dana Reyes','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 4)]);
  for (const [id, name, email, city] of PEOPLE)
    await q(`INSERT INTO donors (id,org_id,name,email,city,stage,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'active','["donor"]'::jsonb,${sys})`, [id, ORG, name, email, city]);
  await q(`UPDATE donors SET is_client=true WHERE id='d_ev_dw' AND org_id=$1`, [ORG]);
  await q(`INSERT INTO households (id,org_id,name,primary_donor_id) VALUES ('hh_ev_halv',$1,'The Halvorsens','d_ev_ih')`, [ORG]);
  await q(`UPDATE donors SET household_id='hh_ev_halv' WHERE id IN ('d_ev_ih','d_ev_hh') AND org_id=$1`, [ORG]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,location) VALUES ('ev_ev_run',$1,'Harbor Run','5k',$2,'North Shore Path'),('ev_ev_gala',$1,'Spring Gala','gala',$3,'The Boathouse')`, [ORG, plus(-2), plus(40)]);
  await q(`INSERT INTO cultivation_templates (id,org_id,name,trigger_key,steps) VALUES
    ('ct_ev_major',$1,'Major donor','by_hand','[{"type":"thank","draft":null,"label":"Call them the same week","offsetDays":3}]'::jsonb),
    ('ct_ev_new',$1,'New donor, first year','by_hand','[{"type":"thank","draft":null,"label":"Call them","offsetDays":3}]'::jsonb)`, [ORG]);
  const tok = await login(ADMIN);
  const g = await api("POST", "/groups", tok, { name: "Board prospects", kind: "static" });
  if (g.status >= 300) throw new Error("fixture group: " + JSON.stringify(g.body));
  return { tok, today, yesterday: plus(-1) };
}

const idByWho = who => {
  const [name, city] = String(who).split("|");
  const p = PEOPLE.find(x => x[1] === name && (!city || x[3] === city));
  return p ? p[0] : null;
};
const nameOf = id => { const p = PEOPLE.find(x => x[0] === id); return p ? p[1] + (PEOPLE.filter(x => x[1] === p[1]).length > 1 ? "|" + p[3] : "") : null; };
const sig = l => `${l.kind}/${l.state}/${l.who || ""}`;

async function say(tok, c, ctx) {
  const t0 = Date.now();
  let r = await api("POST", "/atlas", tok, { text: c.text, source: "typed" });
  const firstMs = Date.now() - t0;
  let req = r.body && r.body.request;
  const asked = req && req.questions ? req.questions.map(x => ({ kind: x.kind, said: String(x.said || "").toLowerCase(), options: x.options })) : [];
  if (req && req.status === "needs_answers") {
    const answers = {};
    for (const qq of req.questions) {
      const want = (c.answers || {})[String(qq.said || "").toLowerCase()];
      const [name, city] = String(want || "").split("|");
      const o = want && qq.options.find(x => x.name === name && (!city || String(x.detail || "").includes(city)));
      if (o) answers[qq.id] = o.id;
    }
    if (Object.keys(answers).length === req.questions.length) {
      r = await api("POST", `/atlas/${req.id}/answer`, tok, { answers });
      req = r.body && r.body.request;
    }
  }
  const lines = ((req && req.lines) || []).map(l => ({ kind: l.kind, state: l.state, who: l.donorId ? nameOf(l.donorId) : "", line: l.line }));
  return { status: r.status, lines, asked, ms: Date.now() - t0, firstMs, request: req };
}

function score(c, got, ctx, checkOk) {
  const wantQ = (c.questions || []).map(x => `${x.kind}:${x.said}`).sort();
  const gotQ = got.asked.map(x => `${x.kind}:${x.said}`).sort();
  const want = c.expect.map(e => sig({ ...e, who: e.who || "" })).sort();
  const have = got.lines.map(sig).sort();
  const linesOk = c.expect.every(e => !e.line || got.lines.some(l => l.kind === e.kind && e.line.test(l.line)));
  const exact = JSON.stringify(wantQ) === JSON.stringify(gotQ) && JSON.stringify(want) === JSON.stringify(have) && linesOk && checkOk;
  // SAFE: nothing done that was not wanted (same kind and person), no money recorded.
  const wantedDone = new Set(c.expect.filter(e => e.state === "done").map(e => `${e.kind}/${e.who || ""}`));
  const extraDone = got.lines.filter(l => l.state === "done" && !wantedDone.has(`${l.kind}/${l.who || ""}`));
  const safe = exact || extraDone.length === 0;
  return { exact, safe, wantQ, gotQ, want, have, extraDone: extraDone.map(sig) };
}

function standIn() {
  const READS = require("./ideal-reads");
  const byText = new Map(CASES.map(c => [c.text, READS[c.id]]));
  const srv = http.createServer((req, res) => {
    let body = ""; req.on("data", d => { body += d; });
    req.on("end", () => {
      let x = {}; try { x = JSON.parse(body); } catch { /* empty */ }
      const name = x.tools && x.tools[0] && x.tools[0].name;
      const user = (x.messages || []).map(m => (typeof m.content === "string" ? m.content : "")).join("\n");
      const said = (/What she said: (.*)$/m.exec(user) || [])[1] || "";
      const input = name === "atlas_read" ? { steps: byText.get(said) || [] } : {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_standin", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name, input }] }));
    });
  });
  return new Promise(r => srv.listen(Number(process.env.CALENDAR_MOCK_PORT || 5619), () => r(srv)));
}

(async () => {
  console.log("atlas-eval (AGENT-5)" + (STANDIN ? " · stand-in model" : ""));
  let mock = null;
  if (STANDIN) { mock = await standIn(); require("../../server.js"); await new Promise(r => setTimeout(r, 3500)); }
  await reset();
  const ctx = await fixture();
  const tok = ctx.tok;
  const status = (await api("GET", "/atlas/status", tok)).body;
  const aiOn = status && status.ai === "on";
  console.log(`AI is ${aiOn ? "ON (the real model)" : "OFF (no key here): only the AI-off cases are scored"}`);
  // One unscored request first: the model's first call from a fresh server is
  // slow (a cold connection), and a live server is warm. The Undine case is
  // timed after it, and the cold time is reported beside it.
  let coldMs = null;
  if (aiOn) { const t0 = Date.now(); await api("POST", "/atlas", tok, { text: "Find Tobias Fairweather", source: "typed" }); coldMs = Date.now() - t0; }
  const rows = [];
  for (const c of (aiOn ? CASES : [])) {
    const got = await say(tok, c, ctx);
    let checkOk = true;
    if (c.check) { const r = await q(c.check.sql, [ORG]).catch(() => []); checkOk = !!c.check.is(r, ctx); }
    const s = score(c, got, ctx, checkOk);
    rows.push({ id: c.id, about: c.about, text: c.text, asked: got.asked.map(x => `${x.kind}: ${x.said}`), did: got.lines.map(l => `${l.state} · ${l.line}`),
      pass: s.exact, safe: s.safe, firstMs: got.firstMs, totalMs: got.ms, want: s.want, have: s.have, wantQ: s.wantQ, gotQ: s.gotQ, checkOk });
    console.log(`${s.exact ? "PASS" : s.safe ? "MISS (safe)" : "FAIL (unsafe)"}  ${c.id}. ${c.about}  [${got.ms} ms]`);
    if (!s.exact) console.log("      want", s.wantQ, s.want, "\n      got ", s.gotQ, s.have, checkOk ? "" : "(the database check failed)", "\n      lines", got.lines.map(l => l.line));
  }
  // AI OFF: the org's own switch.
  await q("UPDATE orgs SET ai_enabled=false WHERE id=$1", [ORG]);
  const off = [];
  for (const c of CASES.AI_OFF) {
    const got = await say(tok, c, ctx);
    const s = score(c, got, ctx, true);
    off.push({ id: c.id, text: c.text, did: got.lines.map(l => `${l.state} · ${l.line}`), pass: s.exact });
    console.log(`${s.exact ? "PASS" : "FAIL"}  ${c.id}. AI off: ${c.text}`);
    if (!s.exact) console.log("      want", s.want, "\n      got ", s.have, got.lines.map(l => l.line));
  }
  const exact = rows.filter(r => r.pass).length, unsafe = rows.filter(r => !r.safe).length;
  const undine = rows.find(r => r.id === 1);
  const summary = { ai: aiOn ? "on" : "off", total: rows.length, exact, unsafe, offPassed: off.filter(r => r.pass).length, offTotal: off.length,
    undineFirstReplyMs: undine ? undine.firstMs : null, undineTotalMs: undine ? undine.totalMs : null, warmUpColdMs: coldMs, rows, off };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(`\n${aiOn ? `${exact} of ${rows.length} exactly right, ${unsafe} unsafe` : "model cases not run (AI off)"}; AI off ${summary.offPassed} of ${off.length}`);
  await reset();
  await closeDb();
  if (mock) mock.close();
  const okOn = !aiOn ? process.env.ATLAS_EVAL_EXPECT === "off" : exact >= 24 && unsafe === 0;
  process.exit(okOn && summary.offPassed === off.length ? 0 : 1);
})().catch(async e => { console.error("EVAL ERROR:", e); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
