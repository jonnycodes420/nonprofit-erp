// tests/why1-sentence-check.test.js — WHY-1 test 2. AI WRITES THE SENTENCE, NEVER THE FACTS.
//
//     With AI off, and with AI on but a model that invents a number the facts
//     do not hold, the answer shows the TEMPLATE sentence and never the
//     invented number.
//
// The suite starts its OWN server process, pointed at a stand-in for the
// Anthropic API (ANTHROPIC_BASE_URL) with a dummy key, on ports the operating
// system picks (help1-ask's pattern), so nothing reaches Anthropic.
//   §1 the stand-in answers with "$99,999" in the sentence: template shown.
//   §2 the stand-in answers with only numbers Steward computed: the model's
//      sentence is shown. This is the leg that proves §1 is a check and not a
//      switch that always says no.
//   §3 the org turns AI off: template shown, and the model is not asked.
//
// HOW IT WOULD GO RED: show the model's sentence without sentencePasses, or
// let a number word or a dollar amount past it. Proven able to fail:
// returning `true` from sentencePasses turned §1 red with the invented
// number on screen.
//
// Standard scratch stack (tests/README.md); the database is the shard's own.

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_why1b";
const Y = new Date().getUTCFullYear() - 1;
const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

(async () => {
  for (const t of ["gifts", "campaigns", "donors", "user_sessions", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Why Two Fixture','why-one-b',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_why1b',$1,'staff@why1b.local',$2,'Why Staff','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,compare_campaign_id) VALUES
             ('camp_why1b_last',$1,'Harvest Appeal ${Y - 1}','appeal','completed',5000,'${Y - 1}-09-01','${Y - 1}-10-31',NULL),
             ('camp_why1b_now',$1,'Harvest Appeal ${Y}','appeal','completed',5000,'${Y}-09-01','${Y}-10-31','camp_why1b_last')`, [ORG]);
  for (const k of ["a", "b", "c"])
    await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ($1,$2,$3,'active','system:test','test')`, [`d_why1b_${k}`, ORG, `Fixture ${k}`]);
  const g = (i, d, amt, date, c) => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,campaign_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,'system:test','test')`,
    [`g_why1b_${i}`, ORG, `d_why1b_${d}`, amt, date, c]);
  await g(1, "a", 1000, `${Y - 1}-09-10`, "camp_why1b_last");
  await g(2, "b", 500, `${Y - 1}-09-12`, "camp_why1b_last");
  await g(3, "b", 300, `${Y}-09-12`, "camp_why1b_now");
  await g(4, "c", 200, `${Y}-09-14`, "camp_why1b_now");
  // This year 500, last year 1,500: $1,000 under, mostly because one donor has not given yet.
  const INVENTED = "Harvest Appeal came in $99,999 under last year because 42 donors moved away.";
  const HONEST = `Harvest Appeal ${Y} came in $1,000 under Harvest Appeal ${Y - 1}, mostly because one of last year's donors hasn't given yet.`;

  let reply = INVENTED;
  const captured = [];
  const mock = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      captured.push(b);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_t", type: "message", role: "assistant", model: "x", stop_reason: "end_turn",
        content: [{ type: "text", text: reply }], usage: { input_tokens: 1, output_tokens: 1 } }));
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
  ok("the why server started", up, errs.slice(-300));

  try {
    const login = await (await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "staff@why1b.local", password: "loadtest1234" }) })).json();
    const ask = async () => (await fetch(B + "/why/ask", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + login.token },
      body: JSON.stringify({ key: "appeal", campaign: "camp_why1b_now" }) })).json();

    // §1 an invented number: the template, never the number.
    const a1 = await ask();
    ok("§1 the model was asked", captured.length === 1, captured.length);
    ok("§1 the template sentence is shown", a1.sentenceSource === "template" && a1.sentence === a1.template, JSON.stringify(a1).slice(0, 300));
    ok("§1 the invented number never reaches the answer", !JSON.stringify(a1).includes("99,999") && !JSON.stringify(a1).includes("42 donors"), a1.sentence);
    ok("§1 the template says the true variance", /\$1,000 under/.test(a1.sentence || ""), a1.sentence);

    // §2 only Steward's numbers: the model's sentence stands.
    reply = HONEST;
    const a2 = await ask();
    ok("§2 a sentence made only of computed numbers is shown as written", a2.sentenceSource === "ai" && a2.sentence === HONEST, JSON.stringify(a2).slice(0, 300));

    // §3 AI off: the template, and nobody asks the model.
    reply = INVENTED;
    await q(`UPDATE orgs SET ai_enabled=false WHERE id=$1`, [ORG]);
    const before = captured.length;
    const a3 = await ask();
    ok("§3 with AI off the template sentence is shown", a3.sentenceSource === "template" && a3.sentence === a3.template && a3.aiOff === true, JSON.stringify(a3).slice(0, 300));
    ok("§3 with AI off the model is not asked", captured.length === before, `${captured.length} vs ${before}`);
    ok("§3 the same reasons with AI on and off", JSON.stringify(a3.reasons) === JSON.stringify(a1.reasons), "");
  } finally {
    child.kill();
    mock.close();
    summary();
    await closeDb();
  }
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });
