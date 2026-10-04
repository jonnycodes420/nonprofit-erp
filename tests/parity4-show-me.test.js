// tests/parity4-show-me.test.js · PARITY-4 Part 3. SHOW ME, IN PLAIN WORDS.
//
//     "Donors who gave last year but not this year", asked with AI off and
//     with AI on, returns EXACTLY the rows a hand-built filter returns on a
//     fixture; and a question that needs a filter Steward does not have is
//     refused and changes nothing (no row written but the question log).
//
// Donor data: a list that quietly drops a condition is a list of the wrong
// people (a deceased donor in an appeal, a current donor told they lapsed).
//
// The suite starts its OWN server process pointed at a stand-in for the
// Anthropic API (ANTHROPIC_BASE_URL, a dummy key), as why1-sentence-check
// does, so the AI-on leg never reaches Anthropic. Its own fixture org; it
// never logs in to the demo.
//   §1 AI off: the templates read the question; the rows are the hand-built
//      filter's, the count foots, the figure source opens the same rows, and
//      the filters read in words.
//   §2 AI on: the stand-in fills the form; same rows. The model was asked
//      with a tool whose fields are the donor list's filters and nothing else.
//   §3 AI on, the stand-in answers with a key no filter has ("zip"): refused.
//   §4 AI on, the stand-in names what it cannot express: refused.
//   §5 AI off, a question with no filter ("zip code starting 019"): refused,
//      nothing in the org changed, and the question log has it, unanswered.
//
// HOW IT WOULD GO RED: drop the notGave rule (current donors appear), drop
// notDeceased (the deceased donor appears), let checkSpec pass an unknown key
// (§3 answers), or make templateSpec drop a leftover word (§5 answers).
// Proven able to fail: see the build report (each planted, each red).

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_p4show";
const Y = new Date().getUTCFullYear();
const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const ids = rows => rows.map(r => r.id || r.donorId || r.donor_id).sort();

async function orgCounts() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public'
                             AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')`)).map(r => r.table_name);
  const out = {};
  for (const t of tables.sort()) out[t] = Number((await q(`SELECT COUNT(*)::int AS c FROM "${t}" WHERE org_id=$1`, [ORG]))[0].c);
  return out;
}

(async () => {
  for (const t of ["audiences", "gifts", "donors", "user_sessions", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Show Me Fixture','show-me-p4',1,'active','team','UTC')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_p4show',$1,'staff@p4show.local',$2,'Show Staff','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  // a: gave last year, nothing this year        -> IN
  // b: gave last year and this year             -> out
  // c: gave this year only                      -> out
  // d: gave the year before last only           -> out
  // e: gave last year, deceased                 -> out
  // f: gave last year; a refund this year       -> IN (a refund is not a gift)
  // g: gave last year, deleted                  -> out
  const P = [["a", false, null], ["b", false, null], ["c", false, null], ["d", false, null], ["e", true, null], ["f", false, null], ["g", false, "NOW()"]];
  for (const [k, dead, del] of P)
    await q(`INSERT INTO donors (id,org_id,name,stage,deceased,deleted_at,created_by,created_by_name) VALUES ($1,$2,$3,'active',$4,${del || "NULL"},'system:test','test')`,
      [`d_p4show_${k}`, ORG, `Show Fixture ${k}`, dead]);
  const g = (i, d, amt, date) => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test')`,
    [`g_p4show_${i}`, ORG, `d_p4show_${d}`, amt, date]);
  await g(1, "a", 100, `${Y - 1}-03-10`);
  await g(2, "b", 200, `${Y - 1}-04-10`); await g(3, "b", 50, `${Y}-01-05`);
  await g(4, "c", 300, `${Y}-01-02`);
  await g(5, "d", 400, `${Y - 2}-06-01`);
  await g(6, "e", 500, `${Y - 1}-06-01`);
  await g(7, "f", 600, `${Y - 1}-07-01`); await g(8, "f", -600, `${Y}-01-03`);
  await g(9, "g", 700, `${Y - 1}-08-01`);

  // THE HAND-BUILT FILTER: written here, not by the code under test.
  const hand = await q(`SELECT d.id FROM donors d WHERE d.org_id=$1 AND d.deleted_at IS NULL AND d.deceased IS NOT TRUE
      AND EXISTS (SELECT 1 FROM gifts x WHERE x.org_id=d.org_id AND x.donor_id=d.id AND x.amount > 0 AND LEFT(x.date,10) BETWEEN $2 AND $3)
      AND NOT EXISTS (SELECT 1 FROM gifts x WHERE x.org_id=d.org_id AND x.donor_id=d.id AND x.amount > 0 AND LEFT(x.date,10) BETWEEN $4 AND $5)`,
    [ORG, `${Y - 1}-01-01`, `${Y - 1}-12-31`, `${Y}-01-01`, `${Y}-12-31`]);
  ok("the hand-built filter finds a and f, and only them", JSON.stringify(ids(hand)) === JSON.stringify(["d_p4show_a", "d_p4show_f"]), JSON.stringify(ids(hand)));

  // The stand-in model. `reply` is the tool input it hands back.
  const RIGHT = { gaveFrom: `${Y - 1}-01-01`, gaveTo: `${Y - 1}-12-31`, notGaveFrom: `${Y}-01-01`, notGaveTo: `${Y}-12-31`, notDeceased: "1" };
  let reply = RIGHT;
  const captured = [];
  const mock = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      captured.push(b);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_t", type: "message", role: "assistant", model: "x", stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "filter_spec", input: reply }], usage: { input_tokens: 1, output_tokens: 1 } }));
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
  ok("the show-me server started", up, errs.slice(-300));

  try {
    const login = await (await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "staff@p4show.local", password: "loadtest1234" }) })).json();
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
    const ask = async text => (await fetch(B + "/why/ask", { method: "POST", headers: H, body: JSON.stringify({ text }) })).json();
    const QUESTION = "donors who gave last year but not this year";

    const answeredCount = async () => Number((await q(`SELECT COUNT(*)::int AS c FROM question_log WHERE surface='why' AND question=$1 AND answered IS TRUE AND topic='show me'`, [QUESTION]))[0].c);
    const logged0 = await answeredCount();
    // §1 AI off.
    await q(`UPDATE orgs SET ai_enabled=false WHERE id=$1`, [ORG]);
    let before = captured.length;
    const a1 = await ask(QUESTION);
    ok("§1 AI off: answered as a list", a1.answered === true && a1.kind === "list" && a1.specSource === "template", JSON.stringify(a1).slice(0, 300));
    ok("§1 AI off: the model was not asked", captured.length === before, `${captured.length} vs ${before}`);
    ok("§1 AI off: exactly the hand-built rows", JSON.stringify(ids(a1.rows || [])) === JSON.stringify(ids(hand)), JSON.stringify(ids(a1.rows || [])));
    ok("§1 the count is the rows", a1.count === hand.length, String(a1.count));
    ok("§1 the filters in words", (a1.words || []).join(" · ") === `Gave in ${Y - 1} · nothing in ${Y} · not deceased`, (a1.words || []).join(" · "));
    const p = new URLSearchParams(a1.countSource ? a1.countSource.params : {});
    const fig = await (await fetch(`${B}/figures/${a1.countSource && a1.countSource.key}/rows?${p}`, { headers: H })).json();
    ok("§1 the count opens the same rows", JSON.stringify(ids(fig.rows || [])) === JSON.stringify(ids(hand)) && fig.totalRows === hand.length, JSON.stringify(fig).slice(0, 300));
    const csv = await (await fetch(`${B}/donors/export/csv?${new URLSearchParams(a1.rules || {})}`, { headers: H })).text();
    ok("§1 the export on the same rule holds the same people", ["Show Fixture a", "Show Fixture f"].every(n => csv.includes(n)) && !["Show Fixture b", "Show Fixture e", "Show Fixture g"].some(n => csv.includes(n)), csv.slice(0, 200));

    // §2 AI on: the stand-in fills the form.
    await q(`UPDATE orgs SET ai_enabled=true WHERE id=$1`, [ORG]);
    before = captured.length;
    const a2 = await ask(QUESTION);
    ok("§2 AI on: the model was asked once", captured.length === before + 1, `${captured.length} vs ${before}`);
    const sent = JSON.parse(captured[captured.length - 1] || "{}");
    const tool = (sent.tools || [])[0] || {};
    const fields = Object.keys((tool.input_schema || {}).properties || {}).filter(k => k !== "unsupported");
    const GR = require("../groups");
    ok("§2 the model's form holds only donor list filters", fields.length > 0 && fields.every(k => GR.RULE_KEYS.includes(k)) && tool.input_schema.additionalProperties === false, fields.join(","));
    ok("§2 AI on: answered from the model's spec", a2.answered === true && a2.specSource === "ai", JSON.stringify(a2).slice(0, 300));
    ok("§2 AI on: exactly the hand-built rows", JSON.stringify(ids(a2.rows || [])) === JSON.stringify(ids(hand)) && a2.count === hand.length, JSON.stringify(ids(a2.rows || [])));

    ok("§2 both answers are in the question log as answered", (await answeredCount()) === logged0 + 2, `${await answeredCount()} vs ${logged0}`);

    // §3 a key no filter has.
    reply = { ...RIGHT, zip: "019" };
    const a3 = await ask(QUESTION);
    ok("§3 a filter Steward does not have is refused", a3.answered === false && a3.refused === true && /can't filter by that yet/.test(a3.sentence) && !a3.rows, JSON.stringify(a3).slice(0, 300));

    // §4 the model names what it cannot express.
    reply = { ...RIGHT, unsupported: "zip code starting 019" };
    const a4 = await ask(QUESTION + " with a zip code starting 019");
    ok("§4 a part the filters cannot express is refused", a4.answered === false && a4.refused === true && !a4.rows, JSON.stringify(a4).slice(0, 300));

    // §5 AI off, an unsupported question: refused, and nothing changed.
    await q(`UPDATE orgs SET ai_enabled=false WHERE id=$1`, [ORG]);
    const REFUSE_Q = `show me donors with a zip code starting 019 p4show ${Date.now()}`;
    const c0 = await orgCounts();
    const a5 = await ask(REFUSE_Q);
    // The one audit write records the request itself (every POST is logged);
    // it is the request's record, not a change to anything in the org.
    const c1 = await orgCounts();
    const changed = Object.keys(c1).filter(t => t !== "fin_audit_log" && c1[t] !== c0[t]);
    ok("§5 refused with the plain words", a5.answered === false && a5.refused === true && /^Steward can't filter by that yet/.test(a5.sentence || ""), JSON.stringify(a5).slice(0, 300));
    ok("§5 no list came back", !a5.rows && a5.count === undefined, JSON.stringify(a5).slice(0, 200));
    ok("§5 nothing in the org changed", changed.length === 0, changed.map(t => `${t} ${c0[t]}->${c1[t]}`).join(", "));
    const logged = await q(`SELECT topic, answered FROM question_log WHERE surface='why' AND question=$1`, [REFUSE_Q]);
    ok("§5 the question log has it, unanswered", logged.length === 1 && logged[0].answered === false && logged[0].topic === "show me", JSON.stringify(logged));
  } finally {
    child.kill();
    mock.close();
    summary();
    await closeDb();
  }
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });
