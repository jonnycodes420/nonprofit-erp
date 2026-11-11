// tests/atlas6-grounded.test.js · ATLAS-6. ATLAS NEVER STATES A FACT IT DIDN'T READ.
//
// What Atlas says about a donor's giving reaches a director as fact, and the
// fleet (10 Nov) heard a lifetime given for a quarter, and a real $2,500 gift
// placed in the wrong month. This guards those donor figures.
//
//   §1  THE PERIOD GRID: phrasings of a period (a range in words and in
//       numbers, a month, a quarter, a fiscal year, a year, "last year", "this
//       fiscal year") × three donors: Atlas's amount equals the sum of that
//       donor's gifts in the window, worked out here by hand from the rows
//       (an independent key), and never the lifetime. "How much has X given"
//       with no period still answers Lifetime.
//   §2  every gift Atlas names in a period answer is a row it fetched: the
//       answer keeps the row ids, and each "$X on <date>" in the line is that row.
//   §3  THE GROUNDING CHECK: a reply naming a real amount in a month it was not
//       given is refused; the true one passes; an invented amount is refused.
//       End to end: a server of its own whose model is a stand-in that plants
//       "a $2,500 gift in March 2026" (the gift was May 31, 2026): Atlas says
//       the template's May, never March, and the fallback is recorded as "dates".
//   §4  "Who is the executive director?" names the director from the settings.
//   §5  a compound can't-know question: two plain answers, the question never echoed.
//
// HOW IT GOES RED (planted, seen red before green, ATLAS-6 report):
//   * remove the post-check (why.js accepts a sentence whatever its dates):
//     §3's end-to-end check hears "March 2026".
//   * give giving_total the lifetime again for a period: §1 fails on every row.
//   Against main: §1 answers $40,709 (lifetime) for a quarter, §4 "I couldn't
//   find the executive director", §5 the echo.
//
// Standard scratch stack (tests/README.md), TEST_MODE. The stand-in model is
// in this process, on loopback; nothing leaves the machine. Sends nothing.
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { BASE, ok, summary, q, closeDb, api } = require("./helpers");
const { civilDay } = require("./clock");
const F = require("./lib/atlas6Fixture");

const rows = r => (r && r.rows) || r || [];
const cents = s => { const m = /\$([\d,]+(?:\.\d{2})?)/.exec(String(s || "")); return m ? Math.round(Number(m[1].replace(/,/g, "")) * 100) : null; };
const ask = async (tok, text, base = BASE) => {
  const r = await fetch(base + "/atlas", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const b = await r.json().catch(() => ({}));
  return { status: r.status, lines: ((b.request && b.request.lines) || []).map(l => String(l.line || "")), id: b.request && b.request.id };
};
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log("ATLAS-6: Atlas never states a fact it didn't read\n");
  await F.seed(q);
  const login = await api("POST", "/auth/login", null, { email: F.ADMIN, password: F.PASSWORD });
  const tok = login.body && login.body.token;
  ok("the director's colleague signs in", !!tok);
  const today = civilDay();
  const D = await import("../shared/atlasDates.js");
  const GRm = require("../server/atlas/grounded");

  // ── §1 the period grid ──────────────────────────────────────────────────
  const PHRASES = ["between Jan 1 and Mar 31, 2026", "between 1/1/2026 and 3/31/2026", "in Q1 2026", "in March 2026", "in 2025",
    "in FY 2026", "last year", "this fiscal year", "from Dec 1, 2025 to Jan 31, 2026"];
  const bad = [];
  for (const p of Object.values(F.PEOPLE)) {
    for (const ph of PHRASES) {
      const w = GRm.resolvePeriod(D.periodOf(ph, today), { vocabulary_json: JSON.stringify({ fiscal_year_start_month: 7 }) }, today);
      const to = w.to > today ? today : w.to;
      const want = p.gifts.filter(([d]) => d >= w.from && d <= to).reduce((s, [, a]) => s + Math.round(a * 100), 0);
      const r = await ask(tok, `How much did ${p.name} give ${ph}?`);
      const line = r.lines[0] || "";
      const got = /gave nothing/.test(line) ? 0 : cents(line);
      if (got !== want || !/Lifetime: \$/.test(line)) bad.push(`${p.name} "${ph}": said ${got} want ${want} — ${line}`);
    }
  }
  ok(`§1 ${Object.keys(F.PEOPLE).length} donors × ${PHRASES.length} period phrasings: every amount is that period's (by hand from the rows), with Lifetime labeled`, bad.length === 0, bad.slice(0, 4));
  const life = await ask(tok, "How much has Warren Pelley given?");
  ok("§1 with no period, it is Lifetime: $40,709 across 4 gifts", /\$40,709 across 4 gifts/.test(life.lines[0] || ""), life.lines);

  // ── §2 a named gift is a fetched row ────────────────────────────────────
  const q1 = await ask(tok, "How much did Warren Pelley give between Jan 1 and Mar 31, 2026?");
  ok("§2 the fleet's question: $4,361 between Jan 1 and Mar 31, 2026, never the $40,709 lifetime as the answer",
    /^Warren Pelley gave \$4,361 between Jan 1 and Mar 31, 2026, 1 gift: \$4,361 on Feb 14, 2026\. Lifetime: \$40,709\.$/.test(q1.lines[0] || ""), q1.lines);
  // The answer is kept on the request (voice_memos.read.answers), beside the line it belongs to.
  const [memo] = rows(await q(`SELECT read FROM voice_memos WHERE org_id=$1 AND id=$2`, [F.ORG, q1.id]));
  const readJ = memo ? (typeof memo.read === "string" ? JSON.parse(memo.read) : memo.read) : {};
  const ans = Object.values((readJ && readJ.answers) || {}).find(x => x && x.type === "giving") || null;
  const giftRow = ans && ans.rows && ans.rows[0];
  const [real] = giftRow ? rows(await q(`SELECT id, LEFT(date,10) AS date, ROUND(amount*100)::bigint AS cents FROM gifts WHERE id=$1 AND org_id=$2`, [giftRow.id, F.ORG])) : [];
  ok("§2 the answer keeps the gift row's id, and the row is the $4,361 of Feb 14, 2026", !!real && real.date === "2026-02-14" && Number(real.cents) === 436100 && giftRow.cents === 436100, { ans, real });

  // ── §3 the grounding check ──────────────────────────────────────────────
  const GR = require("../server/atlas/grounded");
  const facts = GR.factsOf({ lastGift: { cents: 250000, date: "2026-05-31" }, lifetime: 60000 });
  ok("§3 a real $2,500 in a month it was not given is refused", !GR.groundedIn("Rosalind Kemp made a $2,500 gift in March 2026.", facts).ok);
  ok("§3 the true one passes (May 31, 2026; May 2026)", GR.groundedIn("Rosalind Kemp last gave $2,500 on May 31, 2026.", facts).ok && GR.groundedIn("She gave $2,500 in May 2026.", facts).ok);
  ok("§3 an amount no row carries is refused", !GR.groundedIn("She gave $9,999 in May 2026.", facts).ok);
  const r3 = GR.groundedReply("Rosalind Kemp made a $2,500 gift in March 2026.", facts, "Rosalind Kemp last gave $2,500 in May 2026.");
  ok("§3 a refused reply is replaced by the template sentence", !r3.grounded && r3.sentence === "Rosalind Kemp last gave $2,500 in May 2026.", r3);

  // End to end: a server whose model plants the wrong month.
  const PLANT = "Rosalind Kemp made a $2,500 gift in March 2026 and has not given since.";
  const model = http.createServer((req, res) => {
    let b = ""; req.on("data", c => { b += c; }); req.on("end", () => {
      let body = {}; try { body = JSON.parse(b); } catch { /* not JSON */ }
      if (Array.isArray(body.tools) && body.tools.length) { res.writeHead(500, { "content-type": "application/json" }); return res.end('{"type":"error","error":{"type":"api_error","message":"stand-in"}}'); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_a6", type: "message", role: "assistant", model: "stand-in", stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: PLANT }], usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  const mport = await freePort(); await new Promise(r => model.listen(mport, "127.0.0.1", r));
  const port = await freePort(), B2 = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(port), TEST_MODE: "1", STEWARD_PROCESS: "web", DISABLE_BACKGROUND_TICKS: "1",
      ANTHROPIC_API_KEY: "sk-ant-standin", ANTHROPIC_BASE_URL: `http://127.0.0.1:${mport}`, OPENAI_API_KEY: "",
      JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: "http://localhost:9", DB_SSL: process.env.DB_SSL || "disable" } });
  let err = ""; child.stderr.on("data", d => { err = (err + d).slice(-1500); });
  try {
    let up = false;
    for (let i = 0; i < 360 && !up; i++) { up = (await fetch(`${B2}/ready`).catch(() => null))?.status === 200; if (!up) await sleep(500); }
    ok("§3 the stand-in's server is up", up, err.slice(-300));
    await q(`DELETE FROM ai_fallbacks WHERE org_id=$1`, [F.ORG]).catch(() => {});
    const r = await ask(tok, "Why did Rosalind Kemp stop giving?", B2);
    const said = r.lines.join(" ");
    ok("§3 end to end: the model's March is never said; the template's May 2026 is", r.status < 300 && !/March/.test(said) && /\$2,500 in May 2026/.test(said), r.lines);
    const [fb] = rows(await q(`SELECT reason FROM ai_fallbacks WHERE org_id=$1 AND surface='ask.sentence' ORDER BY created_at DESC LIMIT 1`, [F.ORG]).catch(() => []));
    ok("§3 and the refusal is recorded as a date the facts don't carry", fb && fb.reason === "dates", fb);
  } finally { child.kill(); model.close(); }

  // ── §4 the executive director ───────────────────────────────────────────
  const ed = await ask(tok, "Who is the executive director?");
  ok("§4 \"Who is the executive director?\" names Hal Brennan from the settings", /^Hal Brennan is Cedar Hollow Arts' executive director \(from My profile, Tax Receipts and the Brand kit\)\.$/.test(ed.lines[0] || ""), ed.lines);
  const ein = await ask(tok, "What is our EIN?");
  ok("§4 and the EIN is read from Tax receipts", /47-1234567/.test(ein.lines[0] || ""), ein.lines);

  // ── §5 a compound can't-know question ───────────────────────────────────
  const c = await ask(tok, "What's Rosalind Kemp's favorite color, and how much will she give next year?");
  ok("§5 two plain answers: what isn't kept, and what is known instead of a forecast",
    c.lines.length === 2 && c.lines[0] === "I don't have Rosalind Kemp's favorite color." && /^I can't predict next year's giving, but Rosalind /.test(c.lines[1] || ""), c.lines);
  ok("§5 the question is never echoed back", !c.lines.some(l => /how much will she give/i.test(l)), c.lines);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
