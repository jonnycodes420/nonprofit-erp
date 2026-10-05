// tests/ask2-refuse.test.js · ASK-2 Test 2. THE MODEL CANNOT PUT A NUMBER ON SCREEN.
//
//     A stand-in model answers with a plan naming a metric the catalog does
//     not have, a filter that does not exist, a breakdown by donor age,
//     another organisation's fund, its own "unsupported", and plans that
//     carry numbers in their own words. Every bad plan is refused in one
//     sentence (no figures); every number the model wrote is stripped; and
//     nothing outside Steward's computed values ever shows. Nothing in the
//     org changes but the question log.
//
// Donor data and security: a model's guess shown as a figure is a false
// number about real people; another org's fund in a plan is a tenant leak.
//
// HOW IT WOULD GO RED (proven before it was trusted, see the build report):
//   · let validatePlan pass an unknown filter key → §1 case 02 answers;
//   · stop stripping digits from `restatement` → §2 shows 99,999;
//   · drop the fund-belongs-to-org check → §1 case 06 answers.

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_ask2ref", ORG2 = "org_ask2ref2";
const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

const OK_PLAN = { kind: "metric", metric: "raised", period: { kind: "all_time" } };
const CASES = {
  "01": { kind: "metric", metric: "donor_age_mix" },
  "02": { ...OK_PLAN, filters: { zip: "01945" } },
  "03": { ...OK_PLAN, groupBy: "donor_age" },
  "04": { ...OK_PLAN, restatement: "You raised $99,999, 77% more than the 3,141 donors expected" },
  "05": { ...OK_PLAN, unsupported: "how the weather changed giving" },
  "06": { ...OK_PLAN, filters: { fund: "ff_a2r_theirs" } },
  "07": { ...OK_PLAN, sentence: "You raised $5,000,000 from 8,888 people.", value: 5000000, figures: { value: { value: 5000000 } } },
  "08": { ...OK_PLAN, filters: { rules: { zipcode: "01945" } } },
  "09": { kind: "metric", metric: "raised", period: { kind: "decade" } },
};

(async () => {
  const wipe = async () => {
    for (const o of [ORG, ORG2]) {
      for (const t of ["question_log", "gifts", "fin_funds", "donors", "user_sessions", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
      await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
    }
  };
  await wipe();
  for (const [o, slug] of [[ORG, "ask2-ref"], [ORG2, "ask2-ref2"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,ai_enabled) VALUES ($1,$2,$3,1,'active','team','UTC',true)`, [o, `Refuse ${slug}`, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ask2ref',$1,'staff@ask2ref.local',$2,'Ref Staff','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_a2r_ours',$1,'Our Fund',false),('ff_a2r_theirs',$2,'Their Fund',false)`, [ORG, ORG2]);
  await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ('d_a2r_a',$1,'Refuse Fixture A','active','system:test','test'),('d_a2r_x',$2,'Other Org Person','active','system:test','test')`, [ORG, ORG2]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,fund_id,created_by,created_by_name) VALUES ('g_a2r_1',$1,'d_a2r_a',123.45,'2025-05-05','ff_a2r_ours','system:test','test'),
           ('g_a2r_x',$2,'d_a2r_x',4321,'2025-05-05','ff_a2r_theirs','system:test','test')`, [ORG, ORG2]);

  const mock = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      const m = /Case (\d\d)/.exec(b);
      const input = m && CASES[m[1]] ? CASES[m[1]] : OK_PLAN;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_t", type: "message", role: "assistant", model: "x", stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "ask_plan", input }], usage: { input_tokens: 1, output_tokens: 1 } }));
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
    const login = await (await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "staff@ask2ref.local", password: "loadtest1234" }) })).json();
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
    const ask = async n => { const r = await fetch(B + "/ask", { method: "POST", headers: H, body: JSON.stringify({ text: `Case ${n} for the board, please` }) }); return { raw: await r.text(), status: r.status }; };
    const counts = async () => (await q(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int + (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int + (SELECT COUNT(*) FROM ask_pins WHERE org_id=$1)::int AS n`, [ORG]))[0].n;
    const before = await counts();

    console.log("\n— §1 · a plan outside the catalog is refused, never guessed —");
    for (const [n, what] of [["01", "an unknown metric"], ["02", "a made-up filter"], ["03", "a breakdown by donor age"], ["05", "the model's own unsupported"],
                             ["06", "another organisation's fund"], ["08", "a made-up people rule"], ["09", "a made-up period"]]) {
      const { raw, status } = await ask(n);
      const a = JSON.parse(raw);
      ok(`§1 case ${n}, ${what}: refused in one sentence, no figures`,
        status === 200 && a.answered === false && a.refused === true && /^Steward can't answer/.test(a.sentence || "") && !a.figures && !/\$\d/.test(raw), raw.slice(0, 220));
    }
    const a3 = JSON.parse((await ask("03")).raw);
    ok("§1 …and the refusal names what it can't do", /donor age/.test(a3.sentence), a3.sentence);
    const a6 = JSON.parse((await ask("06")).raw);
    ok("§1 …another org's fund is refused as a fund Steward does not have", /a fund Steward does not have/.test(a6.sentence), a6.sentence);

    console.log("\n— §2 · a number in the model's own words never shows —");
    const r4 = await ask("04");
    const a4 = JSON.parse(r4.raw);
    ok("§2 case 04 answers from Steward's own numbers ($123.45)", a4.answered === true && a4.figures.value.value === 123.45 && /\$123\.45/.test(a4.sentence), a4.sentence);
    ok("§2 …the model's 99,999, 77% and 3,141 are nowhere in the answer", !/99,?999|77%|3,?141/.test(r4.raw), (a4.restatement || "") + " | " + r4.raw.slice(0, 120));
    ok("§2 …and its restatement keeps its words without the numbers", typeof a4.restatement === "string" && /You raised/.test(a4.restatement) && !/\d/.test(a4.restatement), a4.restatement);
    const r7 = await ask("07");
    ok("§2 case 07, a sentence and a value the model made up: ignored, Steward's figure stands", JSON.parse(r7.raw).figures.value.value === 123.45 && !/5,?000,?000|8,?888/.test(r7.raw), r7.raw.slice(0, 200));

    console.log("\n— §3 · tenant and writes —");
    const plan = JSON.stringify({ kind: "metric", metric: "raised", period: { kind: "all_time" }, filters: { fund: "ff_a2r_theirs" } });
    const rows = await (await fetch(`${B}/figures/ask/rows?${new URLSearchParams({ plan, cell: "cur" })}`, { headers: H })).json();
    ok("§3 the figure source refuses a plan naming another org's fund: no rows, no value", (rows.rows || []).length === 0 && !rows.value, JSON.stringify(rows).slice(0, 200));
    const all = await (await fetch(`${B}/figures/ask/rows?${new URLSearchParams({ plan: JSON.stringify(OK_PLAN), cell: "cur" })}`, { headers: H })).json();
    ok("§3 …and our own plan opens only our own gift", (all.rows || []).length === 1 && all.rows[0].name === "Refuse Fixture A", JSON.stringify(all.rows));
    ok("§3 asking changed nothing in the org but the question log", (await counts()) === before);
    const logged = await q(`SELECT COUNT(*)::int n FROM question_log WHERE org_id=$1 AND surface='why' AND answered IS FALSE`, [ORG]);
    ok("§3 …and every refusal is in the question log, with the org", logged[0].n >= 7, logged[0]);
  } finally {
    child.kill();
    mock.close();
    await wipe();
    summary();
    await closeDb();
  }
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });
