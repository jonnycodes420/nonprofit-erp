// tests/ask3-sentence-check.test.js — ASK-3 test 2. NEVER A BROKEN OR INTERNAL SENTENCE.
//
//     A model that stops mid-word, talks about "facts" or "rows", or states a
//     number Steward didn't compute is replaced by the template sentence, and
//     nothing outside Steward's computed values shows.
//
// The suite starts its OWN server process pointed at a stand-in for the
// Anthropic API (help1-ask / why1-sentence-check pattern); nothing reaches
// Anthropic. The question is the person answer from test 1's thread
// ("what can I do to get Flavia to give more"), AI on for the fixture org.
//   §1 the sentence Jonathan saw, cut off mid-sentence: template.
//   §2 every number real, but it talks about "the facts" and "rows": template.
//   §3 a number Steward never computed ($7,777): template.
//   §4 a complete, plain sentence of computed numbers: the model's sentence is
//      shown. This is the leg that proves §1 to §3 are a check, not a switch.
//
// HOW IT WOULD GO RED: show the model's sentence on the number check alone
// (§1 and §2 pass numbers), or drop the end-of-sentence test. Proven able to
// fail: removing sentenceIsPlain from writeSentence turned §1 and §2 red.
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { ok, summary, q, closeDb } = require("./helpers");
const fixture = require("./fixtures/ask3-fixture");

const ORG = "org_ask3sentence";
const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

(async () => {
  const F = await fixture(q, ORG, { ai: true });
  let reply = "";
  const mock = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
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
  ok("the ask server started", up, errs.slice(-300));

  try {
    const login = await (await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: F.email, password: "loadtest1234" }) })).json();
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
    const post = async (u, b) => (await fetch(B + u, { method: "POST", headers: H, body: JSON.stringify(b) })).json();
    reply = "The appeal is down.";
    const appeal = await post("/why/ask", { key: "appeal", campaign: F.now });
    const context = { people: (appeal.who || []).map(w => ({ id: w.donorId, name: w.name })), lastPerson: null, campaign: F.now };
    const askWith = async text => { reply = text; return post("/ask", { text: "what can I do to get Flavia to give more", context }); };
    const template = `Flavia Testwater gave $1,000 to ${F.campaignLast} and nothing yet to ${F.campaignNow}.`;
    const isTemplate = a => a.sentenceSource === "template" && String(a.sentence).startsWith(template) && a.sentence === a.template;

    const a1 = await askWith("These facts do not mention Flavia, so they cannot guide an ask for her; they only cover 266 donors overall, with 22 flagged as having strong room to give and");
    ok("§1 a sentence cut off mid-way shows the template", isTemplate(a1) && !/facts|266|22/.test(a1.sentence), { src: a1.sentenceSource, s: a1.sentence });

    const a1b = await askWith(`Flavia Testwater gave $1,000 to ${F.campaignLast} and nothing yet to ${F.campaignNow}, and the best next ask for her is`);
    ok("§1 a cut-off sentence whose numbers are all real still shows the template", isTemplate(a1b), { src: a1b.sentenceSource, s: a1b.sentence });

    const a2 = await askWith(`According to the facts, Flavia Testwater gave $1,000 to ${F.campaignLast} and the rows show nothing yet to ${F.campaignNow}.`);
    ok("§2 a sentence about \"facts\" and \"rows\" shows the template", isTemplate(a2) && !/facts|rows/i.test(a2.sentence), { src: a2.sentenceSource, s: a2.sentence });

    const a3 = await askWith("Flavia Testwater could give $7,777 to the next appeal.");
    ok("§3 a number Steward never computed shows the template", isTemplate(a3) && !/7,777/.test(a3.sentence), { src: a3.sentenceSource, s: a3.sentence });

    const good = `Flavia Testwater gave $1,000 to ${F.campaignLast} and has not given to ${F.campaignNow} yet.`;
    const a4 = await askWith(good);
    ok("§4 a complete, plain sentence of computed numbers is shown", a4.sentenceSource === "ai" && a4.sentence === good, { src: a4.sentenceSource, s: a4.sentence });

    // Nothing the model wrote reaches the reasons, the people or the step.
    const blob = JSON.stringify([a1, a2, a3].map(a => ({ r: a.reasons, w: a.who, s: a.step, c: a.cantSee })));
    ok("§1-3 no model words anywhere else in the answer", !/facts|7,777|266/.test(blob));
  } finally {
    child.kill("SIGTERM"); mock.close();
    await closeDb();
  }
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
