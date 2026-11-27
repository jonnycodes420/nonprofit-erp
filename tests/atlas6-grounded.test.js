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
//   §8  ATLAS-11: "How is the Annual Fund doing?" answers with Home's own goal figure (to the cent,
//       its pace and days left), asks "Did you mean …" when two match, lists the closest names when
//       none do, and Tell me more after it lists the gifts behind it, footing to the cent; four
//       phrasings of a lifetime give one figure; "LYBUNT dollars" says count, households and dollars
//       with the registry's sentence; a closed and reopened Atlas shows the prior turns, and Start
//       over empties it; the AI-off refusal no longer repeats the header's line.
//       Red on 87433bc (run against main: ATLAS-11 report).
//   §9  ATLAS-12: five phrasings each of lapsed, LYBUNT and SYBUNT give Reports' (the registry's) count, with
//       its sentence, and "calendar" reads Reports in calendar years; a surname matching two people asks
//       "Two people match: A ($X) and B ($Y). Which one?" and sums only on Both; "how much is left", "how
//       far are we from the goal" and "are we on pace" answer Home's goal line, and "and the <campaign>?"
//       stays on campaigns; a call she reports is a proposed call (her words) and a follow-up on the day
//       she named, nothing written before Save; "what's his favorite color" says Steward doesn't know it
//       beside the half it can answer; stopped monthly lists Home's Drifting monthly givers and a
//       canceled plan; a brief opens with plain sentences, says "No conversation logged yet.", and finds
//       a name with a comma in it. Red on c2e96c9 (ATLAS-12 report).
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
    c.lines.length === 2 && c.lines[0] === "Steward doesn't know Rosalind Kemp's favorite color." && /^I can't predict next year's giving, but Rosalind /.test(c.lines[1] || ""), c.lines);
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
      const said = n === 0 ? String(l.line).includes(`Nobody is ${P.name}`) : (l.answer && l.answer.count === n && new RegExp(`(^|[:.] )${n.toLocaleString("en-US")} (people are|person is) ${P.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(l.line));
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

  // ── ATLAS-10 items 1 and 2: the brief always comes, in template sentences with reading off, however it
  //    is asked; it says when they became a donor; Atlas's next step is the profile's; Tell me more shows more.
  //    Red on main: "Can you brief me on…" read as "other" (the reading-off refusal), and no next_move line.
  const ask10 = async (text, followsId) => {
    const r = await fetch(BASE + "/atlas", { method: "POST", headers: { authorization: `Bearer ${tok9}`, "content-type": "application/json" }, body: JSON.stringify({ text, ...(followsId ? { followsId } : {}) }) });
    return ((await r.json().catch(() => ({}))).request) || {};
  };
  const r10 = await ask10("Can you brief me on Odile Marchetti?");
  const br10 = (r10.lines || []).find(l => l.answer && l.answer.type === "person");
  const f10 = (br10 && br10.answer.facts) || [];
  const [fd10] = await q(`SELECT MIN(LEFT(date, 10)) AS d FROM gifts WHERE org_id = $1 AND donor_id = 'd_atl9_odile' AND amount > 0`, [F9.ORG || (await q(`SELECT org_id FROM donors WHERE id='d_atl9_odile'`))[0].org_id]);
  const since10 = new Date(fd10.d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  ok("§7 ATLAS-10 \"Can you brief me on Odile Marchetti?\" is a brief, with reading off: never the refusal", !!br10 && r10.ai !== "on" && !(r10.lines || []).some(l => /I can log a conversation|can still log a conversation/.test(l.line || "")), (r10.lines || []).map(l => l.line));
  // main-fix: the $1,500 gift is dated 58 days before the fixture's today (atlas9Fixture), so its date is read from there, never typed.
  const d1500 = F9.addDays(today, -58), MON10 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const w1500 = `${MON10[Number(d1500.slice(5, 7)) - 1]} ${Number(d1500.slice(8, 10))}, ${d1500.slice(0, 4)}`;
  ok(`§7 ATLAS-10 its facts: the open $25,000 ask, the $1,500 gift not yet thanked on ${w1500}, tomorrow's coffee, and donor since her first gift`,
    f10.some(f => f.kind === "open_ask" && /\$25,000 for Youth Arts Access/.test(f.line)) && f10.some(f => f.kind === "unthanked" && f.line.includes(`$1,500 on ${w1500}`))
    && f10.some(f => f.kind === "coming_up" && /Coffee with Odile/.test(f.line)) && f10.some(f => f.kind === "giving" && f.line.includes(`Donor since ${since10}.`)), f10.map(f => f.line));
  const ins10 = (await api("GET", "/insights/donor/d_atl9_odile", tok9)).body || {};
  const want10 = ins10.move ? `Next move:` : ins10.after && ins10.after.thank ? `Next: thank Odile for the ${ins10.after.amount} gift on ${ins10.after.day}.` : null;
  const nm10 = f10.find(f => f.kind === "next_move");
  ok("§7 ATLAS-10 Atlas's next step is the profile's Next move (the same function), never \"no next step planned\" beside it",
    !!want10 && !!nm10 && (ins10.move ? nm10.line.startsWith(want10) && nm10.line.includes(ins10.move.title) : nm10.line === want10) && !f10.some(f => /no next step planned/.test(f.line)), { profile: ins10.move ? ins10.move.title : ins10.after, atlas: nm10 });
  const more10 = await ask10("Tell me more", r10.id);
  // Odile's brief held nothing back (one conversation, one unthanked gift), so Tell me more says so, about her.
  const ml10 = (more10.lines || []).map(l => l.line).join(" ");
  ok("§7 ATLAS-10 Tell me more after a brief answers about her (never \"my last answer had no rows\")", /^Here.s more on Odile Marchetti/.test(ml10) && !/had no rows/.test(ml10), more10.lines && more10.lines.map(l => l.line));
  // A brief that held lines back (four unthanked gifts, three shown) shows them all on Tell me more.
  // Every line the same words (Rufus Tallgrass on staging: $25 gifts on the same days): four $210 gifts on one day,
  // her $1,500 thanked, so the brief shows three identical lines and holds one back. Red on 99ccbfd (a set of lines).
  await q(`UPDATE gifts SET thanked_at = NOW() WHERE id = 'g_atl9_2'`);
  for (const k of [3, 4, 5, 6]) await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, created_by, created_by_name) VALUES ($1, 'org_atl9', 'd_atl9_odile', 210, '2026-10-01', 'system:test', 'atlas10 fixture') ON CONFLICT DO NOTHING`, [`g_atl10_${k}`]);
  const r10b = await ask10("Brief me on Odile Marchetti");
  const more10b = await ask10("Tell me more", r10b.id);
  const pm10 = (more10b.lines || []).find(l => l.answer && l.answer.type === "person");
  const un10 = (pm10 && pm10.answer.facts || []).filter(f => f.kind === "unthanked");
  // ATLAS-11 item 3: Tell me more draws only what the brief didn't say: the one gift it held back, never "And N more", and contact and gift history.
  ok("§7 ATLAS-10 Tell me more shows what the brief held back: the gift not yet shown, no \"And N more\"", !!pm10 && /^Here's more on Odile Marchetti/.test(pm10.line) && un10.length === 1 && !(pm10.answer.facts || []).some(f => /^And \d+ more gifts not yet thanked/.test(f.line)), un10.map(f => f.line));
  ok("§7 ATLAS-11 Tell me more adds what the brief never says: how to reach them and their gift history", !!pm10 && (pm10.answer.facts || []).some(f => f.kind === "contact" && /d_atl9_odile@atl9\.test/.test(f.line)) && (pm10.answer.facts || []).filter(f => f.kind === "gift").length >= 4, pm10 && pm10.answer.facts.map(f => f.line));
  ok("§7 ATLAS-11 Settings > Atlas still opens with the reading-off line; the dialog's refusal doesn't repeat it", (await import("../shared/atlas.js")).AI_OFF_LINE.startsWith((await import("../shared/atlasReading.js")).READING_OFF) && typeof (await import("../shared/atlas.js")).AI_OFF_REFUSAL === "string" && !(await import("../shared/atlas.js")).AI_OFF_REFUSAL.includes((await import("../shared/atlasReading.js")).READING_OFF));

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

  // ── §8 ATLAS-11: Atlas never denies what Home shows; one lifetime in any phrasing; the conversation is kept ──
  const y11 = Number(today.slice(0, 4));
  await q(`DELETE FROM campaigns WHERE org_id = $1 AND id LIKE 'camp_atl11_%'`, [F9.ORG]);
  await q(`INSERT INTO campaigns (id, org_id, name, type, status, goal_amount, goal_category, start_date, end_date, created_by, created_by_name)
           VALUES ('camp_atl11_af', $1, $2, 'appeal', 'active', 50000, 'annual', $3, $4, 'system:test', 'atlas11 fixture')`, [F9.ORG, `Annual Fund ${y11}`, `${y11}-01-01`, `${y11}-12-31`]);
  await q(`UPDATE gifts SET campaign_id = 'camp_atl11_af' WHERE org_id = $1 AND donor_id IN ('d_atl9_hugo', 'd_atl9_wren')`, [F9.ORG]);
  const home11 = (await api("GET", "/home/annual-goal", tok9)).body.goal;
  const af11 = await ask10("How is the Annual Fund doing?");
  const afl = (af11.lines || [])[0] || {};
  const homeCents = Math.round(Number(home11 && home11.value) * 100);
  ok("§8 \"How is the Annual Fund doing?\" answers with Home's goal figure, to the cent, with its pace and days left (Jarvis: \"said no Annual Fund exists\")",
    !!home11 && cents(afl.line) === homeCents && homeCents > 0 && afl.line.includes(home11.paceSentence) && afl.line.includes(home11.endsWords) && !/no fund, appeal or event/i.test(afl.line), { atlas: afl.line, home: home11 });
  const more11 = await ask10("Tell me more", af11.id);
  const ml11 = (more11.lines || []).find(l => l.answer && l.answer.type === "why") || {};
  ok("§8 Tell me more after it lists the gifts behind it, by giver, footing to the cent", ml11.answer && ml11.answer.totalCents === homeCents && ml11.answer.people.map(p => p.donorId).join() === "d_atl9_hugo,d_atl9_wren", more11.lines);
  await q(`INSERT INTO campaigns (id, org_id, name, type, status, goal_amount, goal_category, start_date, end_date, created_by, created_by_name)
           VALUES ('camp_atl11_af0', $1, $2, 'appeal', 'completed', 40000, 'annual', $3, $4, 'system:test', 'atlas11 fixture')`, [F9.ORG, `Annual Fund ${y11 - 1}`, `${y11 - 1}-01-01`, `${y11 - 1}-12-31`]);
  const two11 = ((await ask10("How's the Anual Fund going?")).lines || [])[0] || {};
  ok("§8 two that match (and one letter off) ask \"Did you mean …\", each a button", two11.line === `Did you mean Annual Fund ${y11} or Annual Fund ${y11 - 1}?` && two11.answer && two11.answer.type === "choices" && two11.answer.options.length === 2, two11);
  const none11 = ((await ask10("How is the capital campaign doing?")).lines || [])[0] || {};
  ok("§8 nothing that matches lists the closest names, never \"doesn't exist\"", /closest names I have are .*Annual Fund/.test(none11.line || "") && !/no fund, appeal or event called/i.test(none11.line || ""), none11.line);
  // Item 2: four phrasings, one lifetime, the profile's rule; the key is the gift rows, added here.
  const [hugo11] = await q(`SELECT ROUND(SUM(amount) * 100)::bigint AS c FROM gifts WHERE org_id = $1 AND donor_id = 'd_atl9_hugo' AND amount > 0`, [F9.ORG]);
  const life11 = [];
  for (const text of ["How much has Hugo Strand given?", "Hugo Strand's total", "lifetime for Hugo Strand", "Brief me on Hugo Strand"]) {
    const r = await ask10(text);
    const l = (r.lines || [])[0] || {};
    const giving = l.answer && l.answer.type === "person" ? (l.answer.facts.find(f => f.kind === "giving") || {}).line : l.line;
    life11.push([text, cents(giving)]);
  }
  ok("§8 four phrasings of Hugo's lifetime give one figure, the sum of his gifts (Jarvis: \"only 'Brief me on X' works\")", life11.every(([, c]) => c === Number(hugo11.c)), { want: Number(hugo11.c), got: life11 });
  const lyb11 = ((await ask10("LYBUNT dollars")).lines || [])[0] || {};
  const lyr11 = (await api("GET", "/reports/lybunt", tok9)).body;
  const money11 = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  ok("§8 \"LYBUNT dollars\" answers count, households and dollars, each Reports > LYBUNT's, with the registry's sentence",
    (lyb11.line || "").startsWith(`${lyr11.rows.length} ${lyr11.rows.length === 1 ? "person is" : "people are"} LYBUNT, in ${lyr11.units.length} household`) && (lyb11.line || "").includes(`gave ${money11(lyr11.figures.atStake.cents)} last fiscal year`) && (lyb11.line || "").endsWith(W9.population("lybunt").sentence), { line: lyb11.line, rows: lyr11.rows.length, units: lyr11.units.length, atStake: lyr11.figures.atStake });
  // Item 4: the conversation, kept server-side; reopening reads it back; Start over empties it.
  const c1 = await ask10("How much has Hugo Strand given?");
  const c2 = await ask10("Tell me more", c1.id);
  const conv = (await api("GET", "/atlas/conversation", tok9)).body;
  ok("§8 a closed and reopened Atlas shows the prior turns, in order", (conv.requests || []).slice(-2).map(r => r.id).join() === `${c1.id},${c2.id}` && ((conv.requests || []).slice(-1)[0] || { lines: [] }).lines.length > 0, (conv.requests || []).map(r => r.text));
  await api("POST", "/atlas/conversation/start-over", tok9, {});
  const after11 = (await api("GET", "/atlas/conversation", tok9)).body;
  const c3 = await ask10("How much has Wren Okafor given?");
  const fresh11 = (await api("GET", "/atlas/conversation", tok9)).body;
  ok("§8 Start over empties it, and the next ask starts a new one", Array.isArray(after11.requests) && after11.requests.length === 0 && (fresh11.requests || []).map(r => r.id).join() === c3.id, { after: after11.requests, fresh: (fresh11.requests || []).map(r => r.text) });

  // ── §9 ATLAS-12: the same question gets the same number; a name that matches two asks; Home's goal; a call
  //    note proposed, not refused; what Steward can't know, said; stopped monthly as Home sees it; a brief as a brief.
  const said12 = r => (r.lines || []).map(l => l.line);
  const regOf = async id => (id === "lybunt" || id === "sybunt") ? (await api("GET", `/reports/${id}`, tok9)).body.rows.length : REG.population(id).count({ query: DB.query, orgId: F9.ORG });
  const FIVE = {
    lapsed: ["How many lapsed donors do we have?", "Who has lapsed?", "How many donors stopped giving?", "Lapsed donor count", "Show me our lapsed donors"],
    lybunt: ["How many LYBUNT donors do we have?", "How many people gave last year but not this year?", "How many donors haven't given since last year?",
      "Last year's donors who haven't given yet this year", "What's our LYBUNT count?"],
    sybunt: ["How many SYBUNT donors?", "How many donors gave in some year but not this year?", "How many donors gave before but not this year?",
      "Past donors who haven't given this year", "SYBUNT count"],
  };
  const five12 = [];
  for (const [id, texts] of Object.entries(FIVE)) {
    const want = await regOf(id), name = W9.population(id).name, sentence = W9.population(id).sentence;
    for (const t of texts) {
      const l = ((await ask10(t)).lines || [])[0] || {};
      const n = /^Nobody is /.test(l.line || "") ? 0 : Number((/^([\d,]+) (?:people are|person is) /.exec(l.line || "") || [])[1]?.replace(/,/g, ""));
      if (n !== want || !(l.line || "").includes(name) || !(l.line || "").includes(sentence)) five12.push({ t, want, line: l.line });
    }
  }
  ok("§9 five phrasings each of lapsed, LYBUNT and SYBUNT give Reports' number with its definition (Jarvis: \"lapsed 200 vs 343\")", !five12.length, five12);
  const cal12 = ((await ask10("How many donors gave last calendar year but not this year?")).lines || [])[0] || {};
  const calRep = (await api("GET", "/reports/lybunt?yearMode=calendar", tok9)).body;
  ok("§9 \"calendar\" reads Reports > LYBUNT in calendar years, and says so", (cal12.line || "").startsWith(calRep.rows.length ? `${calRep.rows.length} ${calRep.rows.length === 1 ? "person is" : "people are"} LYBUNT` : "Nobody is LYBUNT") && /Counted in calendar years, as you asked/.test(cal12.line || ""), cal12.line);
  // Item 2: two people named Lindqvist; a surname alone asks, with each lifetime; Both sums.
  await q(`DELETE FROM gifts WHERE org_id = $1 AND donor_id LIKE 'd_atl12_%'`, [F9.ORG]);
  await q(`DELETE FROM donors WHERE org_id = $1 AND id LIKE 'd_atl12_%'`, [F9.ORG]);
  for (const [id, name, amt] of [["d_atl12_ada", "Ada Lindqvist", 150], ["d_atl12_gwen", "Gwen Lindqvist", 100]]) {
    await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ($1, $2, $3, $4, 'system:test', 'atlas12 fixture')`, [id, F9.ORG, name, `${id}@atl12.test`]);
    await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, type, created_by, created_by_name) VALUES ($1, $2, $3, $4, $5, 'one-time', 'system:test', 'atlas12 fixture')`, [`g_${id}`, F9.ORG, id, amt, F9.addDays(today, -20)]);
  }
  const lq = await ask10("How much did Lindqvist give?");
  const q12 = (lq.questions || [])[0] || {};
  ok("§9 \"How much did Lindqvist give?\" asks: \"Two people match: Ada Lindqvist ($150) and Gwen Lindqvist ($100). Which one?\", with Both (Jarvis: \"silently merges two Atkinsons\")",
    q12.sentence === "Two people match: Ada Lindqvist ($150) and Gwen Lindqvist ($100). Which one?" && (q12.options || []).map(o => o.name).join("|") === "Ada Lindqvist|Gwen Lindqvist|Both" && !(lq.lines || []).length, { q: q12, lines: said12(lq) });
  const one12 = (await api("POST", `/atlas/${lq.id}/answer`, tok9, { answers: { [q12.id]: "d_atl12_ada" } })).body?.request || {};
  const lq2 = await ask10("How much did Lindqvist give?");
  const both12 = (await api("POST", `/atlas/${lq2.id}/answer`, tok9, { answers: { [((lq2.questions || [])[0] || {}).id]: "__all" } })).body?.request || {};
  ok("§9 one pressed is that one person; Both adds them together, each named", /^Ada Lindqvist has given \$150 /.test(said12(one12)[0] || "") && /^Ada Lindqvist and Gwen Lindqvist have given \$250 together/.test(said12(both12)[0] || ""), { one: said12(one12), both: said12(both12) });
  // Item 3: Home's goal (the §8 Annual Fund is Home's goal bar).
  const homeG = (await api("GET", "/home/annual-goal", tok9)).body.goal;
  const goalBad = [];
  for (const t of ["How much is left on the goal?", "How far are we from the goal?", "Are we on pace?"]) {
    const l = ((await ask10(t)).lines || [])[0] || {};
    if (cents(l.line) !== Math.round(Number(homeG.value) * 100) || !(l.line || "").includes(homeG.label) || !(l.line || "").includes(homeG.paceSentence) || !/ left\./.test(l.line || "")) goalBad.push({ t, line: l.line });
  }
  ok("§9 \"how much is left\", \"how far are we from the goal\", \"are we on pace\" answer Home's goal line: raised, goal, left, pace (Jarvis: \"cannot answer\")", !goalBad.length, goalBad);
  const g12 = await ask10("How much is left on the goal?");
  const fu12 = ((await ask10(`and the Annual Fund ${y11 - 1}?`, g12.id)).lines || [])[0] || {};
  ok("§9 a follow-up naming a campaign (\"and the Annual Fund <last year>?\") stays on campaigns", (fu12.line || "").startsWith(`Annual Fund ${y11 - 1}`) && !/can't read that one/.test(fu12.line || ""), fu12.line);
  // Item 4: the call note.
  const cn12 = await ask10("I called Hugo Strand today. He said he will give $5,000 in January. Remind me Jan 5");
  const items12 = (cn12.proposal && cn12.proposal.items) || [];
  const jan5 = `${Number(today.slice(0, 4)) + (today.slice(5) > "01-05" ? 1 : 0)}-01-05`;
  const [w12] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id = $1 AND donor_id = 'd_atl9_hugo' AND note LIKE '%will give $5,000%'`, [F9.ORG]);
  ok("§9 \"I called Hugo… he said he will give $5,000 in January. Remind me Jan 5\" proposes a call with her words and a Jan 5 follow-up, writes nothing yet, never \"I can't predict\" (Jarvis)",
    items12.some(i => i.kind === "call" && i.donorId === "d_atl9_hugo" && /will give \$5,000 in January/.test(i.note || "") && (i.note.match(/I called Hugo Strand/g) || []).length === 1 && !/Remind me/.test(i.note)) && items12.some(i => i.kind === "follow_up" && i.donorId === "d_atl9_hugo" && i.due === jan5)
    && !items12.some(i => /gift|pledge/.test(i.kind)) && !said12(cn12).some(l => /can't predict/.test(l)) && w12.n === 0, { items: items12, lines: said12(cn12) });
  ok("§9 a forecast she asks for is still refused as one", /^I can't predict next year's giving/.test(said12(await ask10("How much will Hugo Strand give next year?"))[0] || ""));
  // Item 5: what Steward can't know, beside what it can.
  const fc12 = said12(await ask10("How much will Hugo Strand give next year and what's his favorite color?"));
  ok("§9 \"…and what's his favorite color?\" answers both halves: Steward doesn't know his favorite color", fc12.length === 2 && /^I can't predict next year's giving, but Hugo /.test(fc12[0]) && fc12[1] === "Steward doesn't know Hugo Strand's favorite color.", fc12);
  // Stopped monthly: a monthly giver gone quiet (Home's Drifting) and a canceled plan.
  await q(`DELETE FROM recurring_subscriptions WHERE org_id = $1 AND id LIKE 'rs_atl12_%'`, [F9.ORG]);
  for (const [id, name] of [["d_atl12_mo", "Marguerite Fallowmere"], ["d_atl12_cx", "Ansel Brookhart"]])
    await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ($1, $2, $3, $4, 'system:test', 'atlas12 fixture')`, [id, F9.ORG, name, `${id}@atl12.test`]);
  // Through the gift route (recordGift and the after-change step), so Drift reads her as it would on Home.
  for (let k = 3; k <= 12; k++) await api("POST", "/donors/d_atl12_mo/gifts", tok9, { amount: 40, date: F9.addDays(today, -30 * k), type: "one-time" });
  await q(`INSERT INTO recurring_subscriptions (id, org_id, donor_id, stripe_subscription_id, amount, interval, status, canceled_at) VALUES ('rs_atl12_cx', $1, 'd_atl12_cx', 'sub_atl12_cx', 25, 'month', 'canceled', NOW() - INTERVAL '20 days')`, [F9.ORG]);
  const drift12 = ((await api("GET", "/drift?all=1&includeMedium=1", tok9)).body.list || []).map(r => r.donorId);
  const sm12 = ((await ask10("Which monthly donors stopped giving?")).lines || [])[0] || {};
  const smIds = ((sm12.answer && (sm12.answer.ids || (sm12.answer.people || []).map(p => p.donorId))) || []);
  ok("§9 stopped monthly lists Home's Drifting monthly giver and the canceled plan, with the definition (Jarvis: \"found only 1 canceled gift\")",
    drift12.includes("d_atl12_mo") && smIds.includes("d_atl12_mo") && smIds.includes("d_atl12_cx") && /Stopped monthly: /.test(sm12.line || ""), { drift: drift12, line: sm12.line, ids: smIds });
  // Item 6: a brief reads as a brief.
  await q(`INSERT INTO donors (id, org_id, name, email, kind, created_by, created_by_name) VALUES ('d_atl12_inc', $1, 'Larkspur Supply Co., Inc.', 'larkspur@atl12.test', 'organisation', 'system:test', 'atlas12 fixture')`, [F9.ORG]);
  const b12 = ((await ask10("Brief me on Ada Lindqvist")).lines || [])[0] || {};
  ok("§9 a brief opens with plain sentences (who, giving shape, last contact, next) and says \"No conversation logged yet.\"",
    /^Ada Lindqvist is a donor since .+, and has given \$150 across 1 gift, most recently \$150 on .+\. No conversation logged yet\. (?:Next: |There is no next step planned for Ada\.)/.test(b12.line || "") && b12.answer && b12.answer.type === "person", b12.line);
  const inc12 = ((await ask10("Brief me on Larkspur Supply Co., Inc.")).lines || [])[0] || {};
  const prep12 = ((await ask10("Prep me for my call with Ada Lindqvist")).lines || [])[0] || {};
  // Staging re-check (4f21e2b): a name with a code-like suffix ("Marguerite Fallowmere A12") still said "couldn't find".
  await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ('d_atl12_suf', $1, 'Marguerite Fallowmere A12', 'suf@atl12.test', 'system:test', 'atlas12 fixture')`, [F9.ORG]);
  const suf12 = ((await ask10("Brief on Marguerite Fallowmere A12")).lines || [])[0] || {};
  ok("§9 a brief never says it can't find someone on file: a comma in the name, \"Prep me for my call with …\"",
    /^Larkspur Supply Co\., Inc\. is an organization on file/.test(inc12.line || "") && /^Ada Lindqvist is a donor/.test(prep12.line || "") && /^Marguerite Fallowmere A12 is on file/.test(suf12.line || ""), { inc: inc12.line, prep: prep12.line, suf: suf12.line });

  // ── §10 POLISH-15: never a word or a definition twice; the Top 100 off says so; journey due dates ──
  // Red on main (POLISH-15 report): the two-part count said "Donors: each person with at least one gift…"
  // on both lines; a query count said "People: people."; "Who is on my Top 100?" was "I couldn't find
  // on my Top in Steward"; "When is the next journey step due?" was "Steward can't answer … yet".
  // Planted: tidyLine returning its line unchanged turns the two-part and writer checks red.
  const NR = require("../server/atlas/noRepeat");
  ok("§10 the writer check finds a doubled word and a definition said twice, and leaves a name alone",
    NR.repeatsIn(["5 people on file. People: people. Counted today."]).length === 1
    && NR.repeatsIn(["1 person gave. Donors: each person with at least one gift in the period, counted once.", "4 people gave. Donors: each person with at least one gift in the period, counted once."]).length === 1
    && NR.repeatsIn(["Walla Walla Fund gave $10."]).length === 0);
  ok("§10 tidyLine says it once: \"People: people\" → \"People\", a repeated sentence dropped",
    NR.tidyLine("5 people on file. People: people. Counted today.") === "5 people on file. People. Counted today."
    && NR.tidyLine("Nothing was changed. Nothing was changed.") === "Nothing was changed.");
  const two10 = said12(await ask10("How many people gave this year and how many gave last year?"));
  ok("§10 a two-part count says its definition once in the answer, and repeats no word (Jarvis: \"repeated definitions\")",
    two10.length === 2 && NR.repeatsIn(two10).length === 0 && two10.filter(l => /each person with at least one gift/.test(l)).length === 1, two10);
  const qp10 = await api("POST", "/ask", tok9, { text: "How many people do we have?", qplan: { entity: "people", where: [], measure: { fn: "count_people", field: null } } });
  const def10 = require("../server/atlas/populations").countDefinition(qp10.body);
  ok("§10 a query count's definition never says its label twice (Jarvis: \"People, people\")",
    qp10.status === 200 && !!def10 && NR.repeatsIn([`${qp10.body.sentence} ${def10}`]).length === 0, { s: qp10.body && qp10.body.sentence, def10 });
  await q(`UPDATE orgs SET top100_enabled = false WHERE id = $1`, [F9.ORG]);
  const t100 = [];
  for (const t of ["Who is on my Top 100?", "Who on my Top 100 hasn't been touched in 60 days?", "Make a plan of care for #4"]) t100.push(...said12(await ask10(t)));
  ok("§10 with the Top 100 off, a Top 100 question says it is off and where to turn it on (Settings, under Major gifts)",
    t100.length === 3 && t100.every(l => l === require("../server/majorGifts/top100Switch").OFF_LINE), t100);
  await q(`DELETE FROM cultivation_plan_steps WHERE org_id = $1 AND id LIKE 'cps_p15%'`, [F9.ORG]);
  await q(`DELETE FROM cultivation_plans WHERE org_id = $1 AND id LIKE 'cp_p15%'`, [F9.ORG]);
  await q(`INSERT INTO cultivation_plans (id,org_id,donor_id,template_name,applied_on,created_by,created_by_name) VALUES ('cp_p15',$1,'d_atl12_mo','Welcome series',$2,'system:test','polish15 fixture')`, [F9.ORG, today]);
  await q(`INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date) VALUES ('cps_p15_1',$1,'cp_p15',1,'call','Welcome call',$2),('cps_p15_2',$1,'cp_p15',2,'email','Impact note',$3)`,
    [F9.ORG, F9.addDays(today, 3), F9.addDays(today, 12)]);
  const calAsk = async (from, to) => (await api("POST", "/ask", tok9, { text: "When is the next journey step due?", scope: { from, to } })).body || {};
  const jIn = await calAsk(today, F9.addDays(today, 6)), jBefore = await calAsk(F9.addDays(today, -10), F9.addDays(today, -4));
  const dw = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  ok("§10 the Calendar's Ask answers a journey due date from the steps the Calendar draws (Jarvis: \"No answer\")",
    jIn.answered === true && !jIn.refused && jIn.sentence.includes(`Welcome call for Marguerite Fallowmere on ${dw(F9.addDays(today, 3))}`) && !/Impact note/.test(jIn.sentence), jIn.sentence);
  ok("§10 dates on screen with no step say so, and name the next one after them",
    jBefore.answered === true && /^No journey step is due from /.test(jBefore.sentence) && jBefore.sentence.includes(`The next one is the Welcome call for Marguerite Fallowmere`), jBefore.sentence);
  await q(`DELETE FROM cultivation_plan_steps WHERE org_id = $1 AND id LIKE 'cps_p15%'`, [F9.ORG]);
  await q(`DELETE FROM cultivation_plans WHERE org_id = $1 AND id LIKE 'cp_p15%'`, [F9.ORG]);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
