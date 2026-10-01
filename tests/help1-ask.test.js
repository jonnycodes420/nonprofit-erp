// tests/help1-ask.test.js — HELP-1. THE ONE GUARD THIS BUILD EARNED.
//
//     ASK STEWARD IN HELP MODE SENDS NO DONOR DATA TO THE MODEL (THE PROMPT
//     HOLDS ONLY THE QUESTION AND HELP ARTICLE TEXT) AND CANNOT CALL ANY ACTION.
//
// The suite starts its OWN server process, pointed at a stand-in for the
// Anthropic API (ANTHROPIC_BASE_URL) with a dummy key, on ports the operating
// system picks, so nothing reaches Anthropic and no shard's ports are shared.
// It asks a question as an org full of named donors, captures the request the
// server sent, and checks it byte for byte against buildHelpPrompt(question,
// the articles search found), that it offers no tools, and that no donor's
// name or email, nor the org's name, appears anywhere in it.
//
// HOW IT WOULD GO RED: add the org's donors "for context"; pass the engine's
// tool table; build the prompt anywhere but buildHelpPrompt. Proven able to
// fail: appending the org name to the question turns §1 red.
//
// Standard scratch stack (tests/README.md); the database is the shard's own.

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_help1";
const ORG_NAME = "Lanternfish Arts Collective";
const DONORS = [["Persephone Wraithmoor", "persephone@help1.invalid"], ["Barnabas Quillfeather", "barnabas@help1.invalid"]];
const QUESTION = "How do I import my donors from a spreadsheet?";

const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

(async () => {
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM user_sessions WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,'help-one',1,'active','team')`, [ORG, ORG_NAME]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_help1',$1,'staff@help1.local',$2,'Help Staff','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  for (const [i, [n, e]] of DONORS.entries())
    await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active',500,'system:test','test')`, [`d_help1_${i}`, ORG, n, e]);

  // The stand-in for Anthropic: records the request, answers like the API.
  const captured = [];
  const mock = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      captured.push({ url: req.url, body: b });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_t", type: "message", role: "assistant", model: "x", stop_reason: "end_turn",
        content: [{ type: "text", text: "Open Donors, then Import & tools." }], usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise(r => mock.listen(0, r));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), ANTHROPIC_API_KEY: "sk-ant-test-dummy", ANTHROPIC_BASE_URL: `http://localhost:${mock.address().port}`,
           DISABLE_BACKGROUND_TICKS: "1", TEST_MODE: "1", JWT_SECRET: process.env.JWT_SECRET || "local-test-secret",
           RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local", SENTRY_DSN: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errs = ""; child.stderr.on("data", d => { errs += d; });
  const B = `http://localhost:${port}`;
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { await new Promise(r => setTimeout(r, 1000)); up = await fetch(B + "/health").then(r => r.ok).catch(() => false); }
  ok("the help server started", up, errs.slice(-300));

  try {
    const login = await (await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "staff@help1.local", password: "loadtest1234" }) })).json();
    const r = await fetch(B + "/help/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + login.token }, body: JSON.stringify({ question: QUESTION, screen: "donors" }) });
    const body = await r.json();
    ok("Ask Steward answered", r.status === 200 && body.covered === true && !!body.answer, JSON.stringify(body).slice(0, 200));
    ok("the model was asked exactly once", captured.length === 1, captured.length);
    const sent = captured[0] ? JSON.parse(captured[0].body) : {};

    // §1 — the prompt is the question and the article text, and nothing else.
    const HS = await import("../shared/helpSearch.js");
    const { HELP_ARTICLES } = await import("../shared/helpArticles.js");
    const PS = await import("../shared/agentPersonas.js");
    const want = HS.buildHelpPrompt(QUESTION, HS.searchArticles(HELP_ARTICLES, QUESTION, 3), PS.HELP.systemPrompt);
    ok("§1 the system prompt is the help persona's", sent.system === want.system, String(sent.system).slice(0, 120));
    ok("§1 the messages are exactly the question and the articles", JSON.stringify(sent.messages) === JSON.stringify(want.messages), JSON.stringify(sent.messages).slice(0, 200));
    const raw = captured[0]?.body || "";
    for (const [n, e] of DONORS) {
      ok(`§1 no donor name reaches the model (${n.split(" ")[1]})`, !raw.includes(n) && !raw.includes(n.split(" ")[1]), "");
      ok(`§1 no donor email reaches the model`, !raw.includes(e), "");
    }
    ok("§1 the organisation's name does not reach the model", !raw.includes(ORG_NAME) && !raw.includes("Lanternfish"), "");

    // §2 — no action can be called.
    ok("§2 no tools are offered to the model", !("tools" in sent) && !("tool_choice" in sent), Object.keys(sent).join(","));
    ok("§2 the help persona has no tools at all", Array.isArray(PS.HELP.tools) && PS.HELP.tools.length === 0, PS.HELP.tools);

    // §3 — only the question is kept, and it is kept.
    const [logged] = await q(`SELECT surface, question, topic FROM question_log WHERE question=$1 ORDER BY id DESC LIMIT 1`, [QUESTION]);
    ok("§3 the question is logged, text only", !!logged && logged.surface === "help" && !("answer" in logged), JSON.stringify(logged || {}));
  } finally {
    child.kill("SIGTERM");
    mock.close();
    await closeDb();
    summary();
  }
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
