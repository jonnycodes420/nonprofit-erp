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
//   §6  ATLAS-8: "Who should I call tomorrow?" draws its people and its total foots to
//       them; "List them" lists that answer's rows; Atlas's LYBUNT is Reports > LYBUNT;
//       a dollar figure beside the wrong name is refused; the question is kept.
//       Planted (ATLAS-8 report): answer `why` not saved → §6 rows red; LYBUNT to lapsed
//       (populations.js reading lifecycle=lapsed) → §6 LYBUNT red; misattributed()
//       returning [] → §6 wrong-name red.
//   §7  ATLAS-9: a brief on a person with an open ask, an unthanked gift and tomorrow's
//       meeting names all three before history; a phrase table of 23 phrasings (Jarvis's
//       own first) each reads as a registry population and answers with its count = the
//       registry's, its name and its sentence (both, each named, when ambiguous); a
//       lapsed call list holds only lapsed people, top by lifetime, and foots; top donors'
//       per-row figure = Reports > Top donors'; the reading-off line is the shared one.
//       Red on main (ATLAS-9 report).
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

  // ── §6 ATLAS-8: no total without its rows; one population per word; a figure is its person's ──
  const ask8 = async (text, followsId) => {
    const r = await fetch(BASE + "/atlas", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ text, followsId }) });
    return { status: r.status, req: ((await r.json().catch(() => ({}))).request) || {} };
  };
  const call = await ask8("Who should I call tomorrow?");
  const cl = (call.req.lines || []).find(l => l.answer && l.answer.type === "why") || null;
  ok("§6 a why answer draws its rows: each person, their reason and what is at stake", cl && cl.answer.people.length === 2 && cl.answer.people.every(p => p.name && p.reason && p.cents > 0), call.req.lines);
  const stated = cl ? cents((cl.line.match(/\$[\d,]+(?:\.\d{2})?(?= is at stake)/) || [])[0]) : null;
  const drawn = cl ? cl.answer.people.reduce((x, p) => x + p.cents, 0) : -1;
  ok("§6 the total it states foots to the rows drawn, to the cent ($10,000 ask + $300 a year of the card)", cl && stated === drawn && drawn === 1030000 && cl.answer.totalCents === drawn, { stated, drawn, line: cl && cl.line });
  const again = await ask8("List them", call.req.id);
  const al = (again.req.lines || [])[0] || {};
  ok("§6 \"List them\" right after lists that answer's own rows", al.answer && al.answer.type === "why" && cl && al.answer.people.map(p => p.donorId).join() === cl.answer.people.map(p => p.donorId).join(), again.req.lines);
  const more = await ask8("Tell me more", (await ask8("What is our EIN?")).req.id);
  ok("§6 \"Tell me more\" after an answer with no rows says plainly there is nothing more", /^There's nothing more behind my last answer/.test(((more.req.lines || [])[0] || {}).line || ""), more.req.lines);
  const ly = await ask8("How many LYBUNT donors do we have?");
  const rep = await api("GET", "/reports/lybunt", tok);
  const lyl = (ly.req.lines || [])[0] || {};
  const lyN = Number((/^([\d,]+) /.exec(lyl.line || "") || [])[1]?.replace(/,/g, ""));
  ok("§6 Atlas's LYBUNT is Reports > LYBUNT (bunt.js), never the people tagged Lapsed", rep.status === 200 && lyN === rep.body.rows.length && lyl.answer && lyl.answer.count === rep.body.rows.length, { atlas: lyl.line, report: rep.body && rep.body.rows && rep.body.rows.length });
  ok("§6 and the count ends with its one-line definition", (lyl.line || "").endsWith(require("../shared/populationWords.js").population("lybunt").sentence), lyl.line);
  const WRm = require("../server/atlas/whyRows");
  const pf = WRm.personFacts([{ donorId: "a", name: "Vespasia Ashenhurst", amount: "139037.00" }, { donorId: "b", name: "Verity Underhill", amount: "512.00" }]);
  ok("§6 a dollar figure beside the wrong name is refused (Vespasia's $139,037 said as Verity's)", WRm.misattributed("Verity Underhill has given $139,037 in all.", pf).length === 1);
  ok("§6 and beside its own person it stands", WRm.misattributed("Vespasia Ashenhurst has given $139,037; Verity Underhill $512.", pf).length === 0);
  const fx = WRm.whyAnswer({ who: [{ donorId: "a", name: "Vespasia Ashenhurst", cents: 1000000, reason: "x." }, { donorId: "b", name: "Verity Underhill", cents: 30000, reason: "y." }] });
  ok("§6 a stated total the drawn rows don't foot to is replaced by the rows' own sentence", !WRm.whyLine("Start with Vespasia. $53,837 is at stake across all five.", fx).footed && /\$10,300 is at stake across both\./.test(WRm.whyLine("Start with Vespasia. $53,837 is at stake across all five.", fx).sentence));
  const aq = rows(await q(`SELECT question FROM atlas_actions WHERE org_id=$1 AND request_id=$2`, [F.ORG, ly.req.id]));
  ok("§6 each Atlas line keeps the question it answered", aq.length > 0 && aq.every(r => r.question === "How many LYBUNT donors do we have?"), aq);

  // ── §7 ATLAS-9: the brief names what's open; any lapsed question gets the registry's count;
  //    a population's call list is that population; top donors carry the period's total ──
  const F9 = require("./lib/atlas9Fixture");
  await F9.seed(q, today);
  const tok9 = (await api("POST", "/auth/login", null, { email: F9.ADMIN, password: F9.PASSWORD })).body?.token;
  ok("§7 the ATLAS-9 fixture's director signs in", !!tok9);
  const ask9 = async text => {
    const r = await fetch(BASE + "/atlas", { method: "POST", headers: { authorization: `Bearer ${tok9}`, "content-type": "application/json" }, body: JSON.stringify({ text }) });
    return ((await r.json().catch(() => ({}))).request) || {};
  };
  const REG = require("../shared/numbers/populations");
  const W9 = require("../shared/populationWords.js");
  const PA9 = require("../server/atlas/populationAsk");
  const DB = require("../db");
  const regCount = async id => {
    if (id === "lybunt" || id === "sybunt") { const r = await api("GET", `/reports/${id}`, tok9); return r.body.rows.length; }   // the registry's builder for these is the report itself
    return REG.population(id).count({ query: DB.query, orgId: F9.ORG });
  };
  // The phrase table: Jarvis's words from both sweeps first (22 Nov: LYBUNT, lapsed; 23 Nov: the call list), then real phrasings.
  const TABLE = [
    ["How many LYBUNT donors do we have?", ["lybunt"]], ["How many lapsed donors do we have?", ["lapsed"]],
    ["how many lapsed donors", ["lapsed"]], ["Who's lapsed?", ["lapsed"]], ["Who's lapsed this year?", ["lapsed", "lybunt"]],
    ["How many people have lapsed?", ["lapsed"]], ["How many people stopped giving?", ["lapsed"]], ["How many donors stopped giving?", ["lapsed"]],
    ["Lapsed this year", ["lapsed", "lybunt"]], ["LYBUNT", ["lybunt"]], ["Who are my LYBUNT donors?", ["lybunt"]],
    ["Who gave last year but not this year?", ["lybunt"]], ["How many donors gave last year but haven't given yet this year?", ["lybunt"]],
    ["Show me our lapsed donors", ["lapsed"]], ["Lapsed donors", ["lapsed"]], ["Count of lapsed supporters right now", ["lapsed"]],
    ["How many people no longer give?", ["lapsed"]], ["Who has not given in over a year?", ["lapsed"]], ["Which donors are lapsing?", ["lapsing"]],
    ["How many SYBUNT donors?", ["sybunt"]], ["How many donors have stopped giving this year?", ["lapsed", "lybunt"]],
    ["Who are the lapsed donors?", ["lapsed"]], ["What's our lapsed count?", ["lapsed"]],
  ];
  const STAYS = ["lapsed donors in Lexington", "How much did lapsed donors give?", "How many lapsed donors came back?", "Who should I call tomorrow?", "Who stopped their monthly gift?"];
  const readBad = TABLE.filter(([t, ids]) => { const r = PA9.readPopulation(t); return !r || r.call || r.ids.join() !== ids.join(); }).map(([t]) => t)
    .concat(STAYS.filter(t => PA9.readPopulation(t) && !PA9.readPopulation(t).call));
  ok(`§7 each of ${TABLE.length} phrasings reads as its registry population (and narrower questions stay with Ask)`, TABLE.length >= 20 && !readBad.length, readBad);
  const counts = {};
  for (const id of ["lapsed", "lapsing", "lybunt", "sybunt"]) counts[id] = await regCount(id);
  ok("§7 the fixture has lapsed and LYBUNT people to count", counts.lapsed === 4 && counts.lybunt > 0, counts);
  const e2eBad = [];
  for (const [text, ids] of TABLE) {
    const lines = ((await ask9(text)).lines || []).filter(l => l.kind === "answer");
    if (lines.length !== ids.length) { e2eBad.push(`${text}: ${lines.length} answers for ${ids.join("+")}`); continue; }
    ids.forEach((id, i) => {
      const l = lines[i], n = counts[id], P = W9.population(id);
      const said = n === 0 ? new RegExp(`Nobody is ${P.name}`).test(l.line) : (l.answer && l.answer.count === n && new RegExp(`(^|[:.] )${n.toLocaleString("en-US")} (people are|person is) ${P.name.replace(/[+]/g, "\\+")}`).test(l.line));
      if (!said || !String(l.line).includes(P.sentence)) e2eBad.push(`${text} [${id}=${n}]: ${l.line}`);
      if (ids.length > 1 && i === 0 && !/^That can mean two different lists/.test(l.line)) e2eBad.push(`${text}: both not said`);
    });
  }
  ok("§7 each phrasing answers with the registry's count, the population's name and its sentence; an ambiguous one answers both, each named", !e2eBad.length, e2eBad);

  // The call list (item 3): only that population's askable people, top by lifetime; the total foots to the rows.
  const GRP = require("../groups");
  const lapsedIds = async () => { const df = await GRP.buildDonorFilter(F9.ORG, REG.population("lapsed").rules); return new Set((await DB.query(`SELECT id FROM donors WHERE ${df.whereSql}`, df.params)).map(r => r.id)); };
  const lap = await lapsedIds();
  for (const text of ["Who should I call to win back lapsed donors?", "Which lapsed donors should I call?"]) {
    const cl9 = ((await ask9(text)).lines || []).find(l => l.answer && l.answer.type === "why") || {};
    const ppl = (cl9.answer && cl9.answer.people) || [];
    const drawn9 = ppl.reduce((x, p) => x + p.cents, 0);
    ok(`§7 "${text}" lists only lapsed people, askable, top by lifetime (never the morning list's Odile)`,
      ppl.map(p => p.donorId).join() === F9.LAPSED_ASKABLE.join() && ppl.every(p => lap.has(p.donorId)) && cl9.answer.stakeWord === "lifetime", { line: cl9.line, ppl });
    ok(`§7 "${text}": the total foots to the rows ($52,250) and the sentence says it`, drawn9 === 5225000 && cl9.answer.totalCents === drawn9 && String(cl9.line).includes("$52,250"), cl9.line);
  }
  const plain9 = ((await ask9("Who should I call tomorrow?")).lines || []).find(l => l.answer && l.answer.type === "why");
  ok("§7 without a population, who to call is still the morning list (tomorrow's coffee with Odile, who is not lapsed)", !!plain9 && !plain9.answer.stakeWord && plain9.answer.people.some(p => p.donorId === "d_atl9_odile") && !plain9.answer.people.some(p => lap.has(p.donorId)), plain9 && plain9.line);

  // The brief (item 1): what's open leads, each line opening its row.
  const br9 = ((await ask9("Brief me on Odile Marchetti")).lines || []).find(l => l.answer && l.answer.type === "person");
  const facts9 = (br9 && br9.answer.facts) || [];
  const at = k => facts9.findIndex(f => f.kind === k);
  ok("§7 the brief names the open $25,000 ask for Youth Arts Access with its stage", facts9.some(f => f.kind === "open_ask" && /^Open ask: \$25,000 for Youth Arts Access, stage Asked/.test(f.line)), facts9);
  ok("§7 the brief names the gift not yet thanked ($1,500), by the profile's rule", facts9.some(f => f.kind === "unthanked" && f.id === "g_atl9_2" && /\$1,500/.test(f.line)), facts9);
  ok("§7 the brief names tomorrow's coffee with its date", facts9.some(f => f.kind === "coming_up" && /^Meeting tomorrow, [A-Z][a-z]{2} \d{1,2}, \d{4}: Coffee with Odile/.test(f.line)), facts9);
  ok("§7 what's open comes before history, and every line opens her record", at("open_ask") === 0 && at("coming_up") < at("giving") && at("unthanked") < at("conversation") && facts9.every(f => f.link && f.link.donorId === "d_atl9_odile"), facts9.map(f => f.kind));

  // Top donors (item 4): each row's figure is Reports > Top donors' for the period, labelled.
  const top9 = ((await ask9("Who are our top donors this year?")).lines || []).find(l => l.answer && l.answer.type === "list");
  const rep9 = await api("GET", "/reports/top-donors", tok9);
  const usd9 = n => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });
  const want9 = new Map((rep9.body.rows || []).map(r => [r.id, `${usd9(r.total)} this year`]));
  const topBad = ((top9 && top9.answer.people) || []).filter(p => want9.get(p.donorId) !== p.amount).map(p => `${p.name}: ${p.amount} vs ${want9.get(p.donorId)}`);
  ok("§7 each top donor's figure is Reports > Top donors' for the year, labelled (Hugo: $30,080 this year, never his $80 last gift)",
    !!top9 && top9.answer.people.length === want9.size && !topBad.length && top9.answer.people[0].amount === "$30,080 this year", topBad.length ? topBad : top9 && top9.answer.people);
  // Item 5: the line the dialog says is the one shared line Settings and the Home Thread draw.
  const off9 = await ask9("How many lapsed donors do we have?");
  ok("§7 reading off: the dialog's line is shared/atlasReading.js's, the one Settings > Atlas and the Home Thread draw", off9.readingOff === (await import("../shared/atlasReading.js")).READING_OFF);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
