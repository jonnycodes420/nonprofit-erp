// tests/fix12-ai-switch.test.js — FIX-12 Part 3. THE ONE GUARD THIS PART EARNED.
//
//     WITH AN ORG'S AI SWITCH OFF, NO ROUTE REACHES ANTHROPIC OR OPENAI.
//
// Two halves, because either alone can be fooled:
//   §1  STATIC. The Anthropic SDK and the OpenAI transcription URL appear
//       nowhere in the server's code but aiClient.js, which asks the switch
//       before every call. A new route cannot reach a model around the gate.
//   §2  LIVE. The suite starts its OWN server with both providers pointed at
//       one stand-in (ANTHROPIC_BASE_URL, OPENAI_BASE_URL) that counts every
//       request, turns the org's AI off, calls every AI route, and asserts the
//       stand-in heard nothing. Then it turns AI back on and asks once more,
//       which MUST reach the stand-in: proof the stand-in is wired, so the zero
//       above is a real zero and not a stub nobody was ever going to call.
//
// HOW IT WOULD GO RED: a `new Anthropic()` or a fetch to api.openai.com in a
// route (§1); a call site that skips the gate (§2). Proven able to fail:
// removing `await requireAi(orgId)` from anthropicFor's create turns §2 red on
// the score, board report and voice-memo extraction routes.
//
// Standard scratch stack (tests/README.md); the database is the shard's own.

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const ORG = "org_fix12ai";
const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

function serverFiles() {
  const out = [];
  const walk = d => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", "client", "tests", "scripts", "audit", "docs", ".git", "legal"].includes(f.name)) continue;
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(c|m)?js$/.test(f.name)) out.push(p);
    }
  };
  walk(ROOT);
  return out;
}

(async () => {
  // §1 — the only door.
  const leaks = [];
  for (const f of serverFiles()) {
    if (path.basename(f) === "aiClient.js") continue;
    const src = fs.readFileSync(f, "utf8").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
    if (/new\s+Anthropic\s*\(|@anthropic-ai\/sdk|api\.anthropic\.com|api\.openai\.com/.test(src)) leaks.push(path.relative(ROOT, f));
  }
  ok("no server file but aiClient.js reaches a model directly", leaks.length === 0, leaks.join(", "));

  // §2 — the live zero.
  for (const t of ["gifts", "donors", "grants", "user_sessions", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,ai_enabled) VALUES ($1,'Fix Twelve AI Org','fix-twelve-ai',1,'active','team',false)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fix12ai',$1,'staff@fix12ai.local',$2,'AI Switch Staff','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name) VALUES ('d_fix12ai',$1,'Ottoline Brackwater','ottoline@fix12.invalid','active',500,'system:test','test')`, [ORG]);
  await q(`INSERT INTO grants (id,org_id,funder,amount,status) VALUES ('g_fix12ai',$1,'Tidewater Fund',5000,'active')`, [ORG]).catch(() => {});

  const heard = [];
  const mock = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      heard.push(req.url);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(req.url.includes("audio")
        ? JSON.stringify({ text: "Ottoline mentioned her garden." })
        : JSON.stringify({ id: "msg_t", type: "message", role: "assistant", model: "x", stop_reason: "end_turn",
            content: [{ type: "text", text: "{\"mapping\":{}}" }], usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise(r => mock.listen(0, r));
  const stand = `http://localhost:${mock.address().port}`;
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ANTHROPIC_API_KEY: "sk-ant-test-dummy", ANTHROPIC_BASE_URL: stand,
           OPENAI_API_KEY: "sk-openai-test-dummy", OPENAI_BASE_URL: stand,
           DISABLE_BACKGROUND_TICKS: "1", TEST_MODE: "1", JWT_SECRET: process.env.JWT_SECRET || "local-test-secret",
           RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local", SENTRY_DSN: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errs = ""; child.stderr.on("data", d => { errs += d; });
  const B = `http://localhost:${port}`;
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { await new Promise(r => setTimeout(r, 1000)); up = await fetch(B + "/health").then(r => r.ok).catch(() => false); }
  ok("the AI-switch server started", up, errs.slice(-300));

  try {
    const login = await (await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "staff@fix12ai.local", password: "loadtest1234" }) })).json();
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
    const post = (p, body) => fetch(B + p, { method: "POST", headers: H, body: JSON.stringify(body || {}) })
      .then(async r => ({ status: r.status, body: await r.text() }));
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const CALLS = [
      ["/ai/stream", { userMessage: "Draft a thank-you." }],
      ["/ai/column-map", { headers: ["Name", "Email"], sample: { Name: "A", Email: "a@b.c" } }],
      ["/help/ask", { question: "How do I import my donors from a spreadsheet?", screen: "donors" }],
      ["/agent/instructions", { text: "Draft a thank-you to Ottoline Brackwater." }],
      ["/deposits/read-cheques", { cheques: [{ imageBase64: tinyPng, mimeType: "image/png" }] }],
      ["/donors/d_fix12ai/brief", {}],
      ["/donors/d_fix12ai/score", {}],
      ["/grants/g_fix12ai/report-outline", {}],
      ["/reports/board", { quarter: 1, year: 2026 }],
      ["/voice-memos/transcribe", { donorId: "d_fix12ai", audioBase64: Buffer.from("not really audio").toString("base64"), mimeType: "audio/webm" }],
    ];
    const statuses = [];
    for (const [p, body] of CALLS) {
      const r = await post(p, body);
      statuses.push(`${p} ${r.status}`);
      ok(`AI off: ${p} answers without a 500`, r.status < 500 || r.status === 503, `${r.status} ${r.body.slice(0, 160)}`);
    }
    await new Promise(r => setTimeout(r, 500));   // the score's background recalcs settle
    ok("AI off: the stand-in for Anthropic and OpenAI heard NOTHING across every AI route", heard.length === 0,
      `${heard.length} request(s): ${heard.join(", ")} | ${statuses.join("; ")}`);

    const help = JSON.parse((await post("/help/ask", { question: "How do I import my donors from a spreadsheet?", screen: "donors" })).body);
    ok("AI off: Ask Steward says AI is off and shows the articles instead", /AI is turned off for your organization/.test(help.sentence || "") && (help.articles || []).length > 0, JSON.stringify(help).slice(0, 200));
    const vm = await post("/voice-memos/transcribe", { donorId: "d_fix12ai", audioBase64: "AAAA", mimeType: "audio/webm" });
    ok("AI off: the voice memo says AI is turned off for your organization", vm.status === 403 && /AI is turned off for your organization/.test(vm.body), vm.body.slice(0, 160));

    // The positive control: the stand-in is reachable, so the zero above is real.
    await q(`UPDATE orgs SET ai_enabled=true WHERE id=$1`, [ORG]);
    await post("/help/ask", { question: "How do I import my donors from a spreadsheet?", screen: "donors" });
    await post("/voice-memos/transcribe", { donorId: "d_fix12ai", audioBase64: "AAAA", mimeType: "audio/webm" });
    ok("AI on: the same calls DO reach the stand-in (Anthropic and OpenAI)", heard.some(u => u.includes("messages")) && heard.some(u => u.includes("audio")), heard.join(", "));
  } finally {
    child.kill();
    mock.close();
    for (const t of ["gifts", "donors", "grants", "user_sessions", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
    await closeDb();
  }
  summary("fix12-ai-switch");
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });
