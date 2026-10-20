// tests/support1-answers.test.js · SUPPORT-1. THE ONE GUARD THIS BUILD EARNED.
//
//     THE SUPPORT AGENT ANSWERS ONLY FROM STEWARD'S SOURCES AND THE ASKER'S
//     OWN ORG, NEVER ANOTHER ORG'S, NEVER A VISITOR'S WAY INTO ORG DATA, HANDS
//     MONEY AND CANCELLING TO A PERSON, AND HAS NO WAY TO WRITE ANYTHING.
//
// The suite starts its OWN server, pointed at a stand-in for the Anthropic
// API (it answers with the first source it was given, cited [1]) and its own
// Resend sink, on ports the operating system picks. Three orgs: two with a
// PayPal connection whose last check failed with words only that org has, and
// one with AI turned off.
//
// HOW IT WOULD GO RED: read giving_sources without the org (§2 sees the other
// org's words); let /support/site/chat read the bearer token (§5); give the
// model a tool, or add a write route to routes/support.js (§6); drop the
// hand-off rule for cancelling (§4); let the AI-off path return nothing (§7).
// Proven able to fail: on main every route here is a 404, and planting
// `org_id=?` -> `org_id<>?` in orgFacts turns §2 red.
//
// Standard scratch stack (tests/README.md); the database is the shard's own.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const A = "org_sup1a", B = "org_sup1b", C = "org_sup1c";
const ERR_A = "PayPal said the sign-in for Willowbrook has expired. Reconnect PayPal with a fresh key.";
const ERR_B = "PayPal refused the Kestrel Harbor credentials on its last check.";
const DONOR_A = "Ottoline Brackenridge";
const ORGS = [[A, "Willowbrook Food Pantry"], [B, "Kestrel Harbor Rescue"], [C, "Quiet Pines Choir"]];

const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const ROOT = path.join(__dirname, "..");

async function clean() {
  for (const [o] of ORGS) {
    await q(`DELETE FROM support_tickets WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM giving_sources WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM imports WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM donors WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM user_sessions WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM ai_usage WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await q(`DELETE FROM question_log WHERE question LIKE '%[sup1]%'`).catch(() => {});
}

(async () => {
  await clean();
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [id, name] of ORGS)
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,ai_enabled) VALUES ($1,$2,$3,1,'active','team',$4)`,
      [id, name, id.replace("_", "-"), id !== C]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_sup1a',$1,'staff@sup1a.local',$2,'Ada Staff','admin'),
                                                                    ('u_sup1v',$1,'coord@sup1a.local',$2,'Vic Coordinator','volunteer_coordinator'),
                                                                    ('u_sup1b',$3,'staff@sup1b.local',$2,'Bea Staff','admin'),
                                                                    ('u_sup1c',$4,'staff@sup1c.local',$2,'Cy Staff','admin')`, [A, hash, B, C]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name) VALUES ('d_sup1a',$1,$2,'ottoline@sup1.invalid','active',900,'system:test','test')`, [A, DONOR_A]);
  // Both PayPal connections failed their last check, each with its own words.
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status,last_synced_at,last_error,last_error_at,created_by,created_by_name)
           VALUES ('gs_sup1a',$1,'paypal','PayPal','error',NOW() - INTERVAL '3 days',$2,NOW(),'system:test','test'),
                  ('gs_sup1b',$3,'paypal','PayPal','error',NOW() - INTERVAL '9 days',$4,NOW(),'system:test','test')`, [A, ERR_A, B, ERR_B]);

  // The stand-in for Anthropic: records each request, answers with source [1].
  const captured = [];
  const mock = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      captured.push(b);
      let text = "NOT_COVERED";
      try {
        const last = JSON.parse(b).messages.slice(-1)[0].content;
        const m = String(last).match(/\[1\] [^\n]*\n([^\n]+)/);
        if (m) text = m[1] + " [1]";
      } catch { /* answer NOT_COVERED */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_t", type: "message", role: "assistant", model: "x", stop_reason: "end_turn",
        content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  // The Resend sink: every email the server sends.
  const mail = [];
  const sink = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => { try { mail.push(JSON.parse(b)); } catch { mail.push({ raw: b }); } res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "em_" + mail.length })); });
  });
  await new Promise(r => mock.listen(0, r));
  await new Promise(r => sink.listen(0, r));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ANTHROPIC_API_KEY: "sk-ant-test-dummy", ANTHROPIC_BASE_URL: `http://localhost:${mock.address().port}`,
           RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: `http://localhost:${sink.address().port}`, SUPPORT_HANDOFF_EMAIL: "",
           DISABLE_BACKGROUND_TICKS: "1", TEST_MODE: "1", JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", SENTRY_DSN: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errs = ""; child.stderr.on("data", d => { errs += d; });
  const BASE = `http://localhost:${port}`;
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { await new Promise(r => setTimeout(r, 1000)); up = await fetch(BASE + "/health").then(r => r.ok).catch(() => false); }
  ok("the support server started", up, errs.slice(-300));

  const login = async email => (await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "loadtest1234" }) })).json()).token;
  const post = async (p, body, token) => {
    const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const ask = (text, token, screen, history = []) => post("/support/chat", { messages: [...history, { role: "user", text }], screen }, token);
  const show = r => JSON.stringify(r.body).slice(0, 400);

  try {
    const ta = await login("staff@sup1a.local"), tb = await login("staff@sup1b.local"), tc = await login("staff@sup1c.local"), tv = await login("coord@sup1a.local");
    ok("four people signed in", !!(ta && tb && tc && tv), "");

    // §1 — a how-to question cites the right article and ends on its screen.
    let n0 = captured.length;
    const howto = await ask("How do I add a task? [sup1]", ta, "dashboard");
    ok("§1 the how-to question is answered", howto.status === 200 && howto.body.covered === true && !!howto.body.text, show(howto));
    ok("§1 it cites the Tasks help article", (howto.body.citations || []).some(c => c.link === "/help/tasks"), show(howto));
    ok("§1 it ends with a button to the Tasks screen", howto.body.screen && howto.body.screen.route === "/app/tasks", show(howto));
    ok("§1 the model wrote it, through the AI switch", captured.length === n0 + 1 && howto.body.mode === "model", howto.body.mode);

    // §2 — a broken connection: this org's own status, never the other org's.
    n0 = captured.length;
    const pa = await ask("Why aren't my PayPal gifts showing? [sup1]", ta, "donors");
    const pb = await ask("Why aren't my PayPal gifts showing? [sup1]", tb, "donors");
    const sentA = captured.slice(n0).join("\n");
    const factsA = (pa.body.facts || []).join(" ");
    ok("§2 org A hears its own PayPal status", pa.status === 200 && /PayPal last synced 3 days ago and its last check failed/.test(factsA) && factsA.includes(ERR_A), show(pa));
    ok("§2 the model was given the same facts", sentA.includes(ERR_A), "");
    ok("§2 org B hears its own, not org A's", (pb.body.facts || []).join(" ").includes(ERR_B) && !JSON.stringify(pb.body).includes(ERR_A), show(pb));
    ok("§2 org A's answer ends on Settings, Connections", pa.body.screen && pa.body.screen.route === "/app/settings?section=connections", show(pa));
    const reqA = captured[n0] || "", reqB = captured[n0 + 1] || "";
    ok("§2 org A's prompt holds none of org B's words", !reqA.includes(ERR_B) && !reqA.includes("Kestrel"), "");
    ok("§2 org B's prompt holds its own and none of org A's", reqB.includes(ERR_B) && !reqB.includes(ERR_A) && !reqB.includes("Willowbrook"), "");
    ok("§2 no donor name or email reaches the model", !captured.join("").includes(DONOR_A) && !captured.join("").includes("ottoline@"), "");
    const pv = await ask("Why aren't my PayPal gifts showing? [sup1]", tv, "volunteers");
    ok("§2 a volunteer coordinator gets no giving facts", pv.status === 200 && !(captured.slice(-1)[0] || "").includes(ERR_A) && !JSON.stringify(pv.body).includes(ERR_A), show(pv));

    // §3 — something Steward does not do is said plainly, and Jonathan offered.
    const dbx = await ask("Can I connect Donorbox? [sup1]", ta, "settings");
    ok("§3 Donorbox: says it is not built, from the connections truth", /not built/i.test(dbx.body.text || "") && (dbx.body.citations || []).some(c => c.link === "/connections"), show(dbx));
    ok("§3 Donorbox: offers Jonathan", dbx.body.offerJonathan === true, show(dbx));
    const pay = await ask("Does Steward run payroll for our staff? [sup1]", ta, "finance");
    ok("§3 a feature with no source: says it does not know, no guess", pay.body.covered === false && /rather not guess/.test(pay.body.text || "") && !(pay.body.citations || []).length, show(pay));
    ok("§3 and offers Jonathan", pay.body.offerJonathan === true && pay.body.handoff === "not_covered", show(pay));

    // §4 — cancelling and billing go to Jonathan, with the whole conversation.
    n0 = captured.length;
    const history = [{ role: "user", text: "How do I add a task? [sup1]" }, { role: "assistant", text: howto.body.text }];
    const cancel = await ask("I want to cancel my account [sup1]", ta, "settings:account", history);
    ok("§4 cancel hands off to Jonathan", cancel.body.handoff === "cancel" && cancel.body.offerJonathan === true, show(cancel));
    const bill = await ask("Why was I billed twice this month? [sup1]", ta, "settings:account");
    ok("§4 billing hands off to Jonathan", bill.body.handoff === "billing" && bill.body.offerJonathan === true, show(bill));
    ok("§4 neither was answered by the model", captured.length === n0, captured.length - n0);
    const convo = [...history, { role: "user", text: "I want to cancel my account [sup1]" }, { role: "assistant", text: cancel.body.text }];
    const before = mail.length;
    const hand = await post("/support/handoff", { messages: convo, screen: "settings:account", reason: "cancel" }, ta);
    ok("§4 the hand-off is sent", hand.status === 201 && hand.body.emailed === true, show(hand));
    ok("§4 it tells the person a human will reply, and is not Jonathan", /He is a person, not this assistant/.test(hand.body.sentence || ""), hand.body.sentence);
    const m = mail.slice(before).find(x => [].concat(x.to || []).includes("jonathan@stewardapp.dev"));
    ok("§4 the email goes to jonathan@stewardapp.dev", !!m, JSON.stringify(mail.slice(before)).slice(0, 200));
    const body = (m && m.text) || "";
    ok("§4 it carries the whole conversation", convo.every(t => body.includes(t.text.trim().slice(0, 60))), body.slice(0, 300));
    ok("§4 it names the org, the screen and the person", body.includes("Willowbrook Food Pantry") && body.includes("settings:account") && body.includes("staff@sup1a.local"), body.slice(0, 300));
    const [tk] = await q(`SELECT COUNT(*)::int AS n FROM support_tickets WHERE org_id=$1 AND screen='settings:account'`, [A]);
    ok("§4 and it lands in the super-admin ticket list", tk.n === 1, tk);

    // §5 — a visitor on the website gets no org data, even holding a token.
    n0 = captured.length;
    const site = await post("/support/site/chat", { messages: [{ role: "user", text: "Why aren't my PayPal gifts showing? [sup1]" }] }, ta);
    const siteRaw = JSON.stringify(site.body);
    ok("§5 the visitor is answered", site.status === 200 && !!site.body.text, show(site));
    ok("§5 with no org facts", !siteRaw.includes(ERR_A) && !siteRaw.includes("last synced") && !siteRaw.includes("Willowbrook"), show(site));
    ok("§5 and no screen inside the app", site.body.screen === null, show(site));
    ok("§5 the website never calls the model", captured.length === n0, captured.length - n0);
    const visit = await post("/support/site/handoff", { messages: [{ role: "user", text: "Can I see a demo? [sup1]" }], email: "visitor@sup1.invalid" });
    ok("§5 a visitor can still reach Jonathan", visit.status === 201 && mail.some(x => (x.text || "").includes("Can I see a demo? [sup1]")), show(visit));

    // §6 — the agent has no write tool at all.
    const E = require("../support/engine");
    ok("§6 the support agent's tool list is empty", Array.isArray(E.SUPPORT_TOOLS) && E.SUPPORT_TOOLS.length === 0 && Object.isFrozen(E.SUPPORT_TOOLS), E.SUPPORT_TOOLS);
    const sentKeys = captured.map(b => Object.keys(JSON.parse(b)));
    ok("§6 no request to the model offered tools", sentKeys.length > 0 && sentKeys.every(k => !k.includes("tools") && !k.includes("tool_choice")), sentKeys);
    const src = fs.readFileSync(path.join(ROOT, "routes/support.js"), "utf8");
    const writes = [...src.matchAll(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/g)].map(x => x[1]);
    ok("§6 the module writes only the question log and hand-off tickets", writes.length > 0 && writes.every(t => ["question_log", "support_tickets", "support_ticket_messages"].includes(t)), writes);
    const paths = [...src.matchAll(/\bapp\.(get|post|put|patch|delete|use|all)\(\s*"([^"]+)"/g)].map(x => x[1].toUpperCase() + " " + x[2]).sort();
    ok("§6 the routes are exactly the five it was built with", JSON.stringify(paths) === JSON.stringify(["GET /admin/support/unanswered", "POST /support/chat", "POST /support/handoff", "POST /support/site/chat", "POST /support/site/handoff"]), paths);

    // §7 — with AI off, search over the help articles still answers.
    n0 = captured.length;
    const off = await ask("How do I add a task? [sup1]", tc, "tasks");
    ok("§7 AI off still answers", off.status === 200 && off.body.covered === true && off.body.mode === "ai_off", show(off));
    ok("§7 from the Tasks article, in its own words, with its button", (off.body.citations || []).some(c => c.link === "/help/tasks") && /(Add|Save task|plain words)/.test(off.body.text || "") && off.body.screen && off.body.screen.route === "/app/tasks", show(off));
    ok("§7 and the model was not asked", captured.length === n0, captured.length - n0);

    // The learning loop: questions and the sources that answered, never an answer.
    const logged = await q(`SELECT surface, answered, sources, org_id FROM question_log WHERE question LIKE '%[sup1]%' ORDER BY id`);
    ok("§8 every question is logged", logged.length >= 9, logged.length);
    ok("§8 an answered one keeps its source ids", logged.some(r => r.answered && /help:tasks/.test(r.sources || "")), logged.slice(0, 2));
    ok("§8 the website's questions are logged with no org", logged.filter(r => r.surface === "site").every(r => r.org_id === null), "");
    ok("§8 the unanswered payroll question is in the list to write next", logged.some(r => r.answered === false && r.surface === "support"), "");

    // The committed index is what the sources build today.
    let fresh = true;
    try { execFileSync(process.execPath, ["support/buildIndex.mjs", "--check"], { cwd: ROOT, stdio: "pipe" }); } catch { fresh = false; }
    ok("§9 support/index.json and shared/helpDocs.js are built from the current sources", fresh, "run node support/buildIndex.mjs");
  } finally {
    child.kill("SIGTERM");
    mock.close(); sink.close();
    await clean().catch(() => {});
    await closeDb();
    summary();
  }
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
