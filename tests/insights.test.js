// tests/insights.test.js: INSIGHTS-1. WHO TO CALL, WHY, AND WHAT TO SAY, FROM
// THE REAL-SHAPED FILES. Guards donor data and money: the Review card moves a
// row out of every total (and Undo puts it back), the Link card writes
// relationships, and every card's words may carry only numbers its facts hold.
//
// Into one EMPTY fresh org: the gift file, then the dinner file, then the
// contacts file. asOf = 2026-10-27 throughout (GET ?asOf=, TEST_MODE only):
//   §1 the gift file's own numbers, by donor NAME, are the brief's: 182 donors;
//      113, 72, 31 in 2024-26; 25 of 2024's gave in 2025; 47 first-time in
//      2025, 3 gave in 2026; 66 gave in 2025 not 2026 ($127,781.77), 23 of them
//      $1,000+ ($121,860.04); 20 gave $99,834.70 in Dec 2025; top 10 give
//      69.13%; 129 gave once; pace $73,771.96 by Sep 30 2026 vs $132,495.60.
//   §2 the engine counts GIVING UNITS: the same numbers from the same rows,
//      with each name mapped to the record the import put its gifts on. Where
//      the import made one record of two names, that is listed, and the
//      engine's figure must equal the file's under that mapping, exactly.
//   §3 Major slipping names Cranville: $100,000 (2024), $100,000 (2025),
//      $25,577.60 (2026). Upgrade names Ashham: $1,000 (Jan 2025), $5,000
//      (Dec 2025) through The Ashham Family Foundation; ask $7,500.
//   §4 Review: rows that look like purchases are listed with a reason; nothing
//      moves until she decides; Not a gift makes the row a Finance revenue line
//      (out of every giving total, still money in) and the truth check agrees,
//      and can fail; Undo restores the gift exactly. Ashham is not Lapsing.
//      HOME-3: Partly a gift moves only the value received: the donor's
//      total, Reports and the Board drop by exactly it, Finance gains exactly
//      that revenue, the letter and the receipt state it, Undo restores all
//      of it; a raffle row says raffle tickets are never a gift and is never
//      offered Partly.
//   §5 after the dinner: Belley Wilah's undated $10,000 keeps her off
//      slipping, off Drift and off Home's "Gone quiet"; Marshaw's $20,000 pledge is in Collect pledges; Stock,
//      Retirement Dist, Investment Dist and Foundation are planned signals
//      and gift types on their pledges; 7 multi-year pledges show 2027, 2028.
//   §6 family: OAKVILLE, the Warburys (dinner) and the Bradbrooks are one
//      suggested network; nothing is linked until Link; then it is.
//   §7 every card's words hold only numbers in its facts; with Atlas off every
//      card has template words; outcomes take a card away and What worked
//      counts what followed.
//   §8 the first look for 2,000 donors and 10,000 gifts in under 3 seconds.
//   §9 HOME-3: the moves deck (tabs in rung order, one person one move with
//      "also" lines, ranked by dollars, the December card's 20 givers each
//      once, every move's numbers in its facts), Planned is for people, same-day
//      gifts read as one gift, a top-level sponsor gets no offer, downgrades
//      across any two years, Done/Not now/Doesn't fit advance and are recorded,
//      and the greeting's pace is the one number (the truth check can fail).
//      Red on main: there is no deck, OAKVILLE's upgrade says "$20,000", and
//      RINGBURY's ask says "renew at Platinum ($8,000), and offer Platinum".
//   §M (needs the memo-kept gift file Jonathan gives with the brief): the
//      reimbursement, auction-table and ticket rows in Review; "Stable Moments"
//      designated; FOXWOOD and Redwick in the Warbury network. When the
//      fixture in the repo is still the scrubbed one, these are counted as
//      WAITING, printed by name, and the suite fails: they are not passes.
//
// assertSurfacesAgree after every step, including Review confirm and Undo.
//
// HOW IT GOES RED ON MAIN: GET /insights is a 404 (§2-§8), a pledge has no
// gift type (§5), and Home's lead says "Call Belley Wilah" (gone quiet) though
// her $10,000 dinner gift has no date (§5).
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");
const { numbersOk } = require("../insights");

const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import", "real-shaped");
const AS_OF = "2026-10-27";
const PASSWORD = "loadtest1234";
const cents = v => Math.round(Number(v || 0) * 100);
const norm = s => String(s || "").toLowerCase().replace(/\band\b/g, "&").replace(/[^a-z0-9&]+/g, " ").trim();
const WAITING = [];
const waiting = (name, why) => { WAITING.push(name); console.log(`  WAITING ${name}: ${why}`); };

let R = null;
async function sheetsOf(file) {
  R = R || await import("../shared/sheetRead.js");
  return R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(FX, file)), { type: "buffer", cellDates: true }), XLSX);
}
async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
async function importFile(tok, file) {
  const body = { fileName: file, sheets: await sheetsOf(file) };
  const u = await api("POST", "/sheet-import/understand", tok, body);
  if (u.status !== 200 || !u.body.ready) return { ok: false, why: JSON.stringify(u.body).slice(0, 300) };
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  const t0 = performance.now();
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { ok: j.body.status === "done", importId: r.body.importId, why: j.body.status };
    if (performance.now() - t0 > 120000) return { ok: false, why: "timeout" };
    await new Promise(res => setTimeout(res, 150));
  }
}

// The brief's numbers, from the file's rows, keyed by `keyOf(name)`.
function fileStats(rows, keyOf) {
  const pos = rows.filter(r => r.c > 0);
  const by = new Map();
  for (const g of pos) { const k = keyOf(g.n); (by.get(k) || by.set(k, []).get(k)).push(g); }
  const yr = y => new Set(pos.filter(g => g.d.startsWith(y)).map(g => keyOf(g.n)));
  const [a, b, c] = ["2024", "2025", "2026"].map(yr);
  const first = k => by.get(k).map(g => g.d).sort()[0];
  const ft = [...by.keys()].filter(k => first(k).startsWith("2025"));
  const s25 = k => by.get(k).filter(g => g.d.startsWith("2025")).reduce((n, g) => n + g.c, 0);
  const lyb = [...b].filter(k => !c.has(k));
  const big = lyb.filter(k => s25(k) >= 100000);
  const dec = pos.filter(g => g.d.startsWith("2025-12"));
  const tot = [...by.values()].map(gs => gs.reduce((n, g) => n + g.c, 0)).sort((x, y) => y - x);
  const T = tot.reduce((n, x) => n + x, 0);
  const pace = (lo, hi) => pos.filter(g => g.d >= lo && g.d <= hi).reduce((n, g) => n + g.c, 0);
  return {
    givers: by.size, y2024: a.size, y2025: b.size, y2026: c.size, retained: [...a].filter(k => b.has(k)).length,
    firstTime: ft.length, firstTimeAgain: ft.filter(k => c.has(k)).length,
    lybunt: lyb.length, lybuntCents: lyb.reduce((n, k) => n + s25(k), 0), big: big.length, bigCents: big.reduce((n, k) => n + s25(k), 0),
    dec: new Set(dec.map(g => keyOf(g.n))).size, decCents: dec.reduce((n, g) => n + g.c, 0),
    top10: Math.round((tot.slice(0, 10).reduce((n, x) => n + x, 0) / T) * 10000) / 100,
    once: [...by.values()].filter(gs => gs.length === 1).length,
    paceThis: pace("2026-01-01", "2026-09-30"), paceLast: pace("2025-01-01", "2025-09-30"),
  };
}
const engineStats = s => ({
  givers: s.givers, y2024: s.byYear[2024], y2025: s.byYear[2025], y2026: s.byYear[2026], retained: s.retainedFromPrior,
  firstTime: s.firstTime.count, firstTimeAgain: s.firstTime.gaveAgain, lybunt: s.lybunt.count, lybuntCents: s.lybunt.cents,
  big: s.lybunt.big, bigCents: s.lybunt.bigCents, dec: s.december.count, decCents: s.december.cents, top10: s.top10Share, once: s.once,
  paceThis: s.pace.thisCents, paceLast: s.pace.lastCents,
});
const BRIEF = { givers: 182, y2024: 113, y2025: 72, y2026: 31, retained: 25, firstTime: 47, firstTimeAgain: 3, lybunt: 66, lybuntCents: 12778177,
  big: 23, bigCents: 12186004, dec: 20, decCents: 9983470, top10: 69.13, once: 129, paceThis: 7377196, paceLast: 13249560 };

async function main() {
  const ORG = "org_ins1test";
  const tok = await freshOrg(ORG, "Insights (test)");
  const truth = async step => {
    try { await assertSurfacesAgree(ORG, { token: tok, step }); ok(`truth check: ${step}`, true, ""); }
    catch (e) { ok(`truth check: ${step}`, false, e.message.slice(0, 600)); }
  };
  const get = async (p = "") => (await api("GET", `/insights?asOf=${AS_OF}${p}`, tok));
  const card = (r, kind) => (r.body.cards || []).find(c => c.kind === kind);
  const itemNamed = (c, name) => c && c.items.find(i => norm(i.name) === norm(name));

  // ── §1 the file, by name ────────────────────────────────────────────────
  const gSheets = await sheetsOf("jp-gift-history-287.xlsx");
  const fileRows = gSheets[0].grid.slice(1).filter(r => r[1]).map(r => ({ d: String(r[0]).slice(0, 10), n: String(r[1]).trim(), c: cents(r[2]), memo: String(r[3] || "") }));
  const byName = fileStats(fileRows, n => n);
  for (const [k, v] of Object.entries(BRIEF)) ok(`§1 the file by name: ${k} = ${v}`, byName[k] === v, byName[k]);
  const memoKept = fileRows.some(r => /Reimbursement|Stable Moments/i.test(r.memo));
  console.log(`  [insights] gift fixture: ${memoKept ? "memo-kept copy" : "scrubbed copy (memo words replaced)"}`);
  await truth("empty org");

  const g = await importFile(tok, "jp-gift-history-287.xlsx");
  ok("the gift file imports", g.ok, g.why);
  await truth("after the gift file");

  // ── §2 the engine, by giving unit ───────────────────────────────────────
  const r1 = await get();
  ok("§2 GET /insights answers", r1.status === 200 && Array.isArray(r1.body.cards), r1.status);
  if (r1.status !== 200) { summary(); await closeDb(); process.exit(1); }
  // each file name -> the unit the import put its gifts on (matched by date and amount)
  const landed = await q(`SELECT g.date::text AS d, ROUND(g.amount*100)::bigint AS c, COALESCE('h:'||d.household_id, 'p:'||d.id) AS u,
                                   d.name AS dn, h.name AS hn
                            FROM gifts g JOIN donors d ON d.id=g.donor_id LEFT JOIN households h ON h.id=d.household_id
                           WHERE g.org_id=$1 AND g.import_id=$2 ORDER BY g.id`, [ORG, g.importId]);
  const pool = new Map();
  for (const l of landed) { const k = `${l.d}|${l.c}`; (pool.get(k) || pool.set(k, []).get(k)).push(l); }
  // Two people can give the same amount on the same day: of the rows with that
  // date and amount, take the one whose record's name shares the most words
  // with the file's name (never the database's row order).
  const words = t => new Set(norm(t).split(" ").filter(w => w.length > 1));
  const overlap = (a, b) => { const B = words(b); return [...words(a)].filter(w => B.has(w)).length; };
  const votes = new Map();
  for (const fr of fileRows.filter(x => x.c > 0)) {
    const cands = pool.get(`${fr.d}|${fr.c}`) || [];
    let bi = -1, bs = -1;
    cands.forEach((l, i) => { const sc = Math.max(overlap(fr.n, l.dn), overlap(fr.n, l.hn || "")); if (sc > bs) { bs = sc; bi = i; } });
    const u = bi >= 0 ? cands.splice(bi, 1)[0].u : null;
    if (!u) continue;
    const v = votes.get(fr.n) || votes.set(fr.n, new Map()).get(fr.n);
    v.set(u, (v.get(u) || 0) + 1);
  }
  const unitOf = new Map([...votes].map(([n, v]) => [n, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
  const names = new Map();
  for (const [n, u] of unitOf) (names.get(u) || names.set(u, []).get(u)).push(n);
  const merged = [...names.values()].filter(ns => ns.length > 1);
  console.log(`  [insights] the import made one record of: ${merged.map(ns => ns.join(" + ")).join("; ") || "none"}`);
  const byUnit = fileStats(fileRows, n => unitOf.get(n) || "?" + n);
  const eng = engineStats(r1.body.stats);
  for (const k of Object.keys(BRIEF)) ok(`§2 the engine, by giving unit: ${k} = ${byUnit[k]} (by name ${byName[k]})`, eng[k] === byUnit[k], eng[k]);
  ok("§2 the coverage line says where the history ends", /Gift history ends Sep 30, 2026/.test(r1.body.coverage.sentence), r1.body.coverage.sentence);
  ok("§2 the major-gift line is shown, with its rule", r1.body.majorLine && r1.body.majorLine.cents === 500000 && /\$5,000/.test(r1.body.majorLine.rule), r1.body.majorLine);

  // ── §3 named cards ──────────────────────────────────────────────────────
  const ms = itemNamed(card(r1, "major_slipping"), "Ulis & Verin Cranville Family Foundation");
  ok("§3 Major slipping names Cranville: $100,000 (2024), $100,000 (2025), $25,577.60 (2026)",
     !!ms && ms.facts.some(f => f[1] === "$100,000 (2024), $100,000 (2025), $25,577.60 (2026)"), ms && ms.facts);
  ok("§3 …and suggests a range, never a single number", !!ms && ms.how.ask && Array.isArray(ms.how.ask.range) && ms.how.ask.cents === undefined, ms && ms.how.ask);
  const up = itemNamed(card(r1, "upgraded"), "Alin and Dalbrook Ashham");
  const f = Object.fromEntries((up && up.facts) || []);
  ok("§3 Upgrade names Ashham: $1,000 (January 2025), then $5,000 (December 2025) through The Ashham Family Foundation",
     !!up && f["earlier gift"] === "$1,000 (January 2025)" && f["recent gift"] === "$5,000 (December 2025)" && f.through === "The Ashham Family Foundation", up && up.facts);
  ok("§3 …ask $7,500, with its rule", !!up && up.how.ask.cents === 750000 && /1\.5 times/.test(up.how.ask.rule), up && up.how.ask);
  if (memoKept) ok("§M Ashham designated Stable Moments", !!up && f.designated === "Stable Moments", up && up.facts);
  else waiting("§M Ashham designated Stable Moments", "the scrubbed fixture has no program words");

  // ── §4 Review ───────────────────────────────────────────────────────────
  const rv = card(r1, "review");
  ok("§4 Review lists rows that may not be gifts, each with its reason", !!rv && rv.items.length > 0 && rv.items.every(i => i.reason && i.giftId), rv && rv.items.length);
  const want = [["Reimbursement on buying the Horse From Cardford Jenin", "Selin and Orlie Marshaw", 500000], ["Double Barrel Head End Table", "Orwen Northhurst"], ["Defender"], ["UK Basketball"]];
  for (const [memo, who, c] of want) {
    if (!memoKept) { waiting(`§M Review lists "${memo}"`, "the scrubbed fixture replaced that memo"); continue; }
    const it = rv && rv.items.find(i => i.memo.includes(memo));
    ok(`§M Review lists "${memo}"`, !!it && (!who || norm(it.name) === norm(who)) && (!c || it.cents === c), it);
  }
  if (rv && rv.items.length) {
    const it = rv.items.find(i => /Reimbursement/.test(i.memo)) || rv.items.slice().sort((a, b) => b.cents - a.cents)[0];
    const lifeOf = async () => Number((await q(`SELECT COALESCE(SUM(total_giving),0) AS s FROM donors WHERE org_id=$1 AND id = ANY($2)`, [ORG, it.ids]))[0].s);
    const giftRow = async () => (await q(`SELECT * FROM gifts WHERE id=$1`, [it.giftId]))[0];
    const before = await lifeOf(), row0 = await giftRow();
    ok("§4 nothing moved before she decides", before > 0 && !!row0, before);
    const as = /reimburse/i.test(it.reason) ? "reimbursement" : /ticket/i.test(it.reason) ? "ticket" : "purchase";
    const no = await api("POST", `/insights/review/${it.giftId}`, tok, { decision: "not_gift", as });
    ok(`§4 Not a gift: ${as}, with an Undo`, no.status === 200 && no.body.as === as && !!no.body.undo && !!no.body.finId, JSON.stringify(no.body).slice(0, 200));
    const [line] = await q(`SELECT t.amount, t.date, t.donor_id, t.type, t.source, t.description, a.code FROM fin_transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE t.id=$1`, [no.body.finId]);
    ok(`§4 …the money stays in Finance as revenue: one line, same amount, date and person, in ${as === "reimbursement" ? "Other" : "Special Events"} Revenue`,
       !!line && Math.round(Number(line.amount) * 100) === it.cents && line.date === row0.date && line.donor_id === row0.donor_id && line.type === "income"
       && line.source === "not_a_gift" && /not a gift/.test(line.description) && (line.code == null || line.code === (as === "reimbursement" ? "4060" : "4050")), line);
    ok("§4 …and it is out of every giving total: no longer a gift row", !(await giftRow()), "");
    ok(`§4 …Lifetime moved by exactly ${it.cents} cents`, Math.round((before - (await lifeOf())) * 100) === it.cents, [before, await lifeOf()]);
    ok("§4 …it leaves the Review card, and the profile says it was not a gift",
       !(card(await get(), "review") || { items: [] }).items.some(x => x.giftId === it.giftId)
       && ((await api("GET", `/insights/donor/${it.lead}?asOf=${AS_OF}`, tok)).body.notGifts || []).some(x => x.giftId === it.giftId && x.cents === it.cents), "");
    await truth("after Not a gift");
    // Planted: the Finance line goes missing. The truth check's money-in check must see it.
    if (Number(String(row0.date || "").slice(0, 4)) >= 2025) {
      await q(`UPDATE fin_transactions SET source='planted' WHERE id=$1`, [no.body.finId]);
      let caught = false;
      try { await assertSurfacesAgree(ORG, { token: tok, step: "planted" }); } catch (e) { caught = /money in/.test(e.message); }
      await q(`UPDATE fin_transactions SET source='not_a_gift' WHERE id=$1`, [no.body.finId]);
      ok("§4 the truth check can fail: a Not a gift line missing from Finance's money in is caught", caught, "");
    }
    const undo = await api("POST", `/insights/review/${it.giftId}/undo`, tok);
    const row2 = await giftRow();
    ok("§4 Undo puts the gift back exactly, and its Finance line goes", undo.status === 200 && !!row2 && JSON.stringify({ ...row2, updated_at: 0 }) === JSON.stringify({ ...row0, updated_at: 0 })
       && (await q(`SELECT 1 FROM fin_transactions WHERE id=$1`, [no.body.finId])).length === 0, undo.status);
    ok("§4 …Lifetime is restored to the cent", Math.round((await lifeOf()) * 100) === Math.round(before * 100), "");
    ok("§4 …and the row is back in Review, undecided", (card(await get(), "review") || { items: [] }).items.some(x => x.giftId === it.giftId), "");
    await truth("after Undo");
    const keep = await api("POST", `/insights/review/${it.giftId}`, tok, { decision: "keep" });
    ok("§4 Keep as gift: recorded, the row stays a gift and leaves the card", keep.status === 200 && !!(await giftRow())
       && !(card(await get(), "review") || { items: [] }).items.some(x => x.giftId === it.giftId), keep.status);
  }
  // ── §4 Partly a gift (HOME-3, Justin's Place 27 Oct) ──────────────────────
  // A sponsorship with two tickets, an auction item bought above its value:
  // mostly a gift. Only the value received leaves giving and becomes Finance
  // revenue; the receipt and the letter say what was received; Undo restores
  // it all. A raffle row is never offered Partly.
  {
    const rvP = card(await get(), "review") || { items: [] };
    const raffle = rvP.items.find(i => /raffle/i.test(i.memo));
    ok("§4 a raffle row's reason says raffle tickets are never a gift, not even in part, and Partly is not offered",
       !!raffle && /Raffle tickets are never a gift, not even in part/.test(raffle.reason) && raffle.partly === false, raffle && [raffle.reason, raffle.partly]);
    if (raffle) {
      const rr = await api("POST", `/insights/review/${raffle.giftId}`, tok, { decision: "partly", value: "1" });
      ok("§4 …and the route refuses Partly on it", rr.status === 400 && !!(await q(`SELECT 1 FROM gifts WHERE id=$1 AND amount=$2`, [raffle.giftId, raffle.cents / 100])).length, rr.status);
    }
    const boardOf = async () => {
      const b = (await api("GET", "/dashboards/board", tok)).body || {};
      return { fy: b.fiscalYear || {}, today: b.asOf, cents: cents(((b.metrics || []).find(m => m.key === "revenueThisYear") || {}).value) };
    };
    const b0 = await boardOf();
    const inFy = i => i.date && b0.fy.start && i.date >= b0.fy.start && i.date <= (b0.today || "9999");
    const pt = rvP.items.find(i => i.partly !== false && inFy(i) && i.cents > 10000) || rvP.items.find(i => i.partly !== false && /ticket/i.test(i.memo));
    ok("§4 a review row offers Partly a gift", !!pt && pt.partly === true, pt && pt.partly);
    if (pt) {
      const X = Math.min(25000, Math.floor(pt.cents / 2)), Y = pt.cents - X;
      const ORIGIN = "2024-01-01";
      const reportsOf = async () => cents(((await api("GET", `/reports/giving-summary?from=${ORIGIN}&to=${b0.today}`, tok)).body || {}).total);
      const finOf = async () => ((await api("GET", "/finance/overview", tok)).body.byMonth || []).reduce((n, m) => n + Number(m.cents || 0), 0);
      const lifeP = async () => Number((await q(`SELECT COALESCE(SUM(total_giving),0) AS s FROM donors WHERE org_id=$1 AND id = ANY($2)`, [ORG, pt.ids]))[0].s);
      const rowP = async () => (await q(`SELECT * FROM gifts WHERE id=$1`, [pt.giftId]))[0];
      const p0 = { life: await lifeP(), reports: await reportsOf(), board: b0.cents, fin: await finOf(), row: await rowP() };
      // the value received is required, more than nothing and less than the row
      const bad = await Promise.all([undefined, "0", String(pt.cents / 100), "abc"].map(v => api("POST", `/insights/review/${pt.giftId}`, tok, { decision: "partly", value: v })));
      ok("§4 Partly needs the value received: more than $0 and less than the row's amount", bad.every(r => r.status === 400) && JSON.stringify(await rowP()) === JSON.stringify(p0.row), bad.map(r => r.status));
      const partly = async () => api("POST", `/insights/review/${pt.giftId}`, tok, { decision: "partly", value: (X / 100).toFixed(2), as: "ticket" });
      const pr = await partly();
      ok("§4 Partly a gift: recorded, with an Undo", pr.status === 200 && pr.body.decision === "partly" && !!pr.body.finId && !!pr.body.undo, JSON.stringify(pr.body).slice(0, 300));
      const g1 = await rowP();
      ok(`§4 …the gift stays, at the rest (${Y} cents), and carries the value received`, !!g1 && cents(g1.amount) === Y && cents(g1.quid_pro_quo_value) === X && cents(g1.deductible_amount) === Y, g1 && [g1.amount, g1.quid_pro_quo_value, g1.deductible_amount]);
      ok(`§4 …the donor's giving total drops by exactly the value received (${X} cents)`, Math.round((p0.life - (await lifeP())) * 100) === X, [p0.life, await lifeP()]);
      ok("§4 …Reports' giving drops by exactly the value received", p0.reports - (await reportsOf()) === X, [p0.reports, await reportsOf()]);
      ok("§4 …the Board's giving this year drops by exactly the value received", p0.board - (await boardOf()).cents === (inFy(pt) ? X : 0), [p0.board, (await boardOf()).cents, inFy(pt)]);
      const [ln] = await q(`SELECT t.amount, t.date, t.donor_id, t.type, t.source, t.gift_id, t.description, t.created_by FROM fin_transactions t WHERE t.id=$1`, [pr.body.finId || ""]);
      ok("§4 …Finance gains exactly that revenue: one income line for the value received, same date and person",
         !!ln && cents(ln.amount) === X && ln.date === p0.row.date && ln.donor_id === p0.row.donor_id && ln.type === "income" && ln.source === "not_a_gift" && !ln.gift_id && !!ln.created_by, ln);
      ok("§4 …and Finance's money in is unchanged (the gift part plus the revenue)", (await finOf()) === p0.fin, [p0.fin, await finOf()]);
      ok("§4 …it leaves the Review card", !(card(await get(), "review") || { items: [] }).items.some(x => x.giftId === pt.giftId), "");
      await truth("after Partly a gift");
      if (inFy(pt) || Number(String(p0.row.date || "").slice(0, 4)) >= 2025) {
        await q(`UPDATE fin_transactions SET source='planted' WHERE id=$1`, [pr.body.finId]);
        let caught = false;
        try { await assertSurfacesAgree(ORG, { token: tok, step: "planted partly" }); } catch (e) { caught = /money in/.test(e.message); }
        await q(`UPDATE fin_transactions SET source='not_a_gift' WHERE id=$1`, [pr.body.finId]);
        ok("§4 the truth check can fail: a Partly line missing from Finance's money in is caught", caught, "");
      }
      // the thank-you letter states the value received (a read-only preview)
      await q(`UPDATE donors SET address='1 Paddock Lane', city='Lexington', state='KY', zip='40502' WHERE id=$1 AND org_id=$2 AND COALESCE(address,'')=''`, [g1.donor_id, ORG]);
      const money2 = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const disclosure = `You received goods or services valued at ${money2(X)}; the deductible amount is ${money2(Y)}.`;
      const lp = await api("POST", "/acknowledgments/letters/preview", tok, { giftIds: [pt.giftId] });
      ok("§4 …the acknowledgment letter states the value received and the deductible amount", lp.status === 200 && (lp.body.letters || []).some(l => l.text.includes(disclosure)), (lp.body.letters || [])[0] && lp.body.letters[0].text.slice(-300));
      const undo = await api("POST", `/insights/review/${pt.giftId}/undo`, tok);
      const g2 = await rowP();
      ok("§4 Undo restores the gift exactly (amount, value received, deductible part)", undo.status === 200 && JSON.stringify({ ...g2, updated_at: 0 }) === JSON.stringify({ ...p0.row, updated_at: 0 }), [undo.status, g2 && g2.amount]);
      ok("§4 …and its Finance line goes", (await q(`SELECT 1 FROM fin_transactions WHERE id=$1`, [pr.body.finId])).length === 0, "");
      ok("§4 …giving total, Reports, the Board and Finance are restored to the cent",
         Math.round((await lifeP()) * 100) === Math.round(p0.life * 100) && (await reportsOf()) === p0.reports && (await boardOf()).cents === p0.board && (await finOf()) === p0.fin, "");
      ok("§4 …and the row is back in Review, undecided", (card(await get(), "review") || { items: [] }).items.some(x => x.giftId === pt.giftId), "");
      await truth("after Partly a gift, Undo");
      // the receipt states it too; a receipt pins the gift part, so Undo then waits for a void
      await q(`UPDATE orgs SET receipts_enabled=true WHERE id=$1`, [ORG]);
      const pr2 = await partly();
      const rc = await api("POST", `/gifts/${pt.giftId}/receipt`, tok);
      const snap = rc.body && rc.body.snapshot ? (typeof rc.body.snapshot === "string" ? JSON.parse(rc.body.snapshot) : rc.body.snapshot) : {};
      ok("§4 …the tax receipt states the value received and the deductible amount, for the gift part",
         pr2.status === 200 && rc.status === 201 && cents(rc.body.amount) === Y && cents(rc.body.deductible_amount) === Y && String(snap.goodsServicesSentence || "").includes(disclosure), [rc.status, snap.goodsServicesSentence]);
      const u2 = await api("POST", `/insights/review/${pt.giftId}/undo`, tok);
      ok("§4 …with a receipt issued for the gift part, Undo is refused until the receipt is voided", u2.status === 409 && cents((await rowP()).amount) === Y, u2.status);
      if (rc.body && rc.body.id) await api("POST", `/receipts/${rc.body.id}/void`, tok, { reason: "test" });
      const u3 = await api("POST", `/insights/review/${pt.giftId}/undo`, tok);
      ok("§4 …and after the void, Undo puts the amount back", u3.status === 200 && cents((await rowP()).amount) === pt.cents && (await rowP()).quid_pro_quo_value == null, u3.status);
      await q(`UPDATE orgs SET receipts_enabled=false WHERE id=$1`, [ORG]);
      await truth("after the receipt, the void and Undo");
    }
  }

  // The Lapsing tag respects rhythm: a yearly giver whose usual time is ahead is not Lapsing.
  const [ash] = await q(`SELECT id FROM donors WHERE org_id=$1 AND name='Alin Ashham' AND deleted_at IS NULL`, [ORG]);
  const ashSt = ash && (await api("GET", `/donors/${ash.id}/status`, tok)).body;
  const ashU = ash && (await api("GET", `/insights/donor/${ash.id}?asOf=${AS_OF}`, tok)).body.unit;
  ok("§4 Ashham (a yearly giver, next gift expected Nov 2026) is not tagged Lapsing; the ladder says Moving up",
     !!ashSt && !JSON.stringify(ashSt).includes('"lapsing"') && !!ashU && ashU.status === "up", [JSON.stringify(ashSt).match(/"key":"[a-z_]+"/g), ashU && ashU.status]);

  // ── §5 the dinner file ──────────────────────────────────────────────────
  const d = await importFile(tok, "jp-dinner-gifts-106.xlsx");
  ok("the dinner file imports", d.ok, d.why);
  await truth("after the dinner file");
  const r2 = await get();
  const units2 = new Map();
  for (const c of r2.body.cards) for (const it of c.items) (units2.get(norm(it.name)) || units2.set(norm(it.name), []).get(norm(it.name))).push(c.kind);
  const [bw] = await q(`SELECT id FROM donors WHERE org_id=$1 AND name='Belley Wilah' AND deleted_at IS NULL`, [ORG]);
  const bwp = bw && (await api("GET", `/insights/donor/${bw.id}?asOf=${AS_OF}`, tok)).body;
  ok("§5 Belley Wilah has an undated $10,000 dinner gift", (await q(`SELECT 1 FROM gifts WHERE org_id=$1 AND donor_id=$2 AND date IS NULL AND amount=10000`, [ORG, bw && bw.id])).length === 1, "");
  ok("§5 …and is not slipping, nor in Major slipping", !!bwp && bwp.unit.status !== "slipping" && !(units2.get(norm("Belley Wilah")) || []).includes("major_slipping"), bwp && bwp.unit);
  const dr = await api("GET", "/drift", tok);
  const drNames = JSON.stringify(dr.body || {});
  const homeLead = await api("GET", "/home/lead", tok);
  ok("§5 …and Drift and Home's lead never call her gone quiet", dr.status === 200 && !drNames.includes("Belley Wilah") && !JSON.stringify(homeLead.body || {}).includes("Call Belley Wilah"),
     [dr.status, homeLead.status, (JSON.stringify(homeLead.body || {}).match(/Call [^"]+/) || [])[0]]);
  ok("§5 …her profile says to set the undated gift's date", !!bwp && /^Has an undated gift from .+; set its date\.$/.test(bwp.unit.undatedNote || ""), bwp && bwp.unit.undatedNote);
  const pl = card(r2, "pledges");
  const mar = pl && pl.items.find(i => /marshaw/i.test(i.name) && i.facts.some(x => x[0] === "pledged" && x[1] === "$20,000"));
  ok("§5 Selin and Orlie Marshaw: a $20,000 open pledge, in Collect pledges", !!mar, pl && pl.items.slice(0, 3).map(i => i.name));
  const marUnit = mar && (await api("GET", `/insights/donor/${mar.lead}?asOf=${AS_OF}`, tok)).body.unit;
  ok("§5 …and not slipping", !!marUnit && marUnit.status !== "slipping", marUnit && marUnit.status);
  const multi = (pl ? pl.items : []).filter(i => i.installments && i.installments.length === 3);
  ok("§5 7 multi-year pledges show their 2027 and 2028 installments", multi.length === 7 && multi.every(i => ["2027", "2028"].every(y => i.installments.some(x => x.year === y))), multi.length);
  const types = await q(`SELECT gift_type, COUNT(*)::int AS n FROM pledges WHERE org_id=$1 AND gift_type IS NOT NULL GROUP BY 1 ORDER BY 1`, [ORG]);
  const T = Object.fromEntries(types.map(t => [t.gift_type, t.n]));
  ok("§5 the dinner's methods are gift types on their pledges: Stock 2, Retirement 1, Investment 3, Foundation 1", T.stock === 2 && T.ira === 1 && T.investment === 3 && T.foundation === 1, T);
  const plan = card(r2, "planned");
  const planned = n => !!plan && plan.items.some(i => norm(i.name) === norm(n));
  ok("§5 planned signals include the dinner's Stock, Retirement Dist, Investment Dist and Foundation rows",
     ["Brookhurst Bradmere", "Oakford Bradridge", "Everbrook Sallow", "Rosyn Cardgate"].every(planned), plan && plan.items.map(i => i.name).slice(0, 20));

  // ── §6 family ───────────────────────────────────────────────────────────
  const fam = card(r2, "family");
  const net = fam && fam.items.find(i => i.members.some(m => /OAKVILLE/.test(m.name)));
  ok("§6 OAKVILLE Foundation and the dinner's Warburys are one suggested network", !!net && net.members.some(m => /Warbury/.test(m.name)), net && net.members.map(m => m.name));
  for (const n of ["FOXWOOD. Kelley", "KY Redwick Farm Everwell' Club"]) {
    if (memoKept) ok(`§M ${n} is in the Warbury network`, !!net && net.members.some(m => m.name === n), net && net.members.map(m => m.name));
    else waiting(`§M ${n} is in the Warbury network`, "its memo naming a Warbury was scrubbed");
  }
  const relCount = async () => (await q(`SELECT COUNT(*)::int AS n FROM donor_relationships WHERE org_id=$1`, [ORG]))[0].n;
  ok("§6 nothing is linked until she says so", (await relCount()) === 0, await relCount());
  if (net) {
    const lk = await api("POST", "/insights/link", tok, { networkKey: net.key, decision: "link", leadIds: net.members.map(m => m.lead) });
    ok("§6 Link writes the relationships", lk.status === 200 && (await relCount()) === net.members.length - 1, [lk.status, await relCount()]);
    const prof = (await api("GET", `/insights/donor/${net.members[0].lead}?asOf=${AS_OF}`, tok)).body;
    ok("§6 …and the profile shows their combined giving", !!prof.combined && prof.combined.cents === net.cents, prof.combined);
    ok("§6 …and the suggestion goes", !((card(await get(), "family") || { items: [] }).items.some(i => i.key === net.key)), "");
  }

  // ── the contacts file, and the words ───────────────────────────────────
  const c = await importFile(tok, "jp-contacts-656.xlsx");
  ok("the contacts file imports", c.ok, c.why);
  await truth("after the contacts file");
  const r3 = await get();
  // §7 every number in the words is in the facts
  const bad = [];
  for (const cd of r3.body.cards) {
    for (const w of [cd.words.what, cd.words.why, cd.words.how]) {
      const chk = numbersOk(w, cd.facts);
      if (!chk.ok) bad.push(`${cd.kind}: ${chk.bad.join(",")} in "${w}"`);
    }
    for (const it of cd.items) if (it.how && it.how.say) { const chk = numbersOk(it.how.say, cd.facts); if (!chk.ok) bad.push(`${cd.kind}/${it.name}: ${chk.bad.join(",")}`); }
  }
  ok("§7 every card's words hold only numbers its facts hold", bad.length === 0, bad.slice(0, 5));
  const planted = numbersOk("Ask $7,512 by Nov 3.", [["ask", "$7,500"]]);
  ok("§7 the number check can fail (a planted $7,512 is caught)", !planted.ok && planted.bad.includes("7512"), planted);
  {
  // ── §9 HOME-3: the moves deck, and the words fixed on 27 Oct ──────────
  const deck = r3.body.deck;
  ok("§9 the deck: Keep, Grow, Major and Planned, in rung order", !!deck && deck.tabs.map(t => t.key).join() === "keep,grow,major,planned", deck && deck.tabs.map(t => t.key));
  const moves = deck ? deck.tabs.flatMap(t => t.moves) : [];
  const moveUnit = m => m.itemKey.split(":").slice(0, 2).join(":");
  const dupes = moves.map(moveUnit).filter((u, i, a) => a.indexOf(u) !== i);
  ok("§9 one person, one move: nobody leads two cards", moves.length > 0 && dupes.length === 0, dupes.slice(0, 5));
  const multi = moves.filter(m => (m.also || []).length);
  ok("§9 …their other moves ride on that card as 'also' lines", multi.length > 0 && multi.every(m => m.also.every(a => a.kind !== m.kind || a.line)), multi.length);
  ok("§9 each tab counts its moves, ranked by dollars; Keep opens first", deck.tabs.every(t => t.moves.length === Math.min(t.count, 150) && t.moves.every((m, i) => i === 0 || t.moves[i - 1].cents >= m.cents)) && deck.open === "keep",
     deck.tabs.map(t => `${t.key} ${t.count}/${t.moves.length}`));
  const yeCard = card(r3, "year_end");
  const yePlaced = yeCard.items.filter(it => moves.some(m => (m.kind === "year_end" && m.itemKey === it.key) || (moveUnit(m) === it.key && (m.also || []).some(a => a.kind === "year_end"))));
  const yeLead = moves.filter(m => m.kind === "year_end");
  ok(`§9 the ${yeCard.items.length}-giver December card is ${yeCard.items.length} people, each once, ranked by dollars`,
     yeCard.items.length === 20 && yePlaced.length === 20 && yeLead.every((m, i) => i === 0 || yeLead[i - 1].cents >= m.cents), [yeCard.items.length, yePlaced.length]);
  const deckBad = [];
  for (const m of moves) for (const w of [m.what, m.why, m.say, m.ask && m.ask.words, ...(m.also || []).map(a => a.line)]) {
    if (!w) continue;
    const chk = numbersOk(w, m.facts);
    if (!chk.ok) deckBad.push(`${m.kind}/${m.name}: ${chk.bad.join(",")} in "${w}"`);
  }
  ok("§9 every move's words hold only numbers its facts hold", deckBad.length === 0, deckBad.slice(0, 5));
  const plannedTab = deck.tabs.find(t => t.key === "planned");
  const orgKinds = new Map((await q(`SELECT id, kind, name FROM donors WHERE org_id=$1`, [ORG])).map(r => [r.id, r]));
  const orgy = plannedTab.moves.filter(m => m.ids.some(id => /organi[sz]ation/.test((orgKinds.get(id) || {}).kind || "") || /\b(foundation|fund|inc|llc|company)\b/i.test((orgKinds.get(id) || {}).name || "")));
  ok("§9 Planned is for people: no foundation, company or fund, and it counts people, not dollars", orgy.length === 0 && plannedTab.cents === null && /\b(person|people)$/.test(plannedTab.atStake),
     { orgs: orgy.map(m => m.name), atStake: plannedTab.atStake });
  const oak = (r3.body.cards.find(x => x.kind === "upgraded") || { items: [] }).items.find(i => /OAKVILLE/i.test(i.name));
  ok("§9 same-day gifts are one gift in the words: OAKVILLE's $5,000 and $20,000 on Dec 16, 2025 read as $25,000", !!oak && /\$25,000/.test(oak.how.say) && !/\$20,000/.test(oak.how.say)
     && !moves.filter(m => /OAKVILLE/i.test(m.name)).some(m => /\$20,000/.test(m.what + m.say)), oak && oak.how.say);
  const oakUnit = oak && (await api("GET", `/insights/donor/${oak.lead}?asOf=${AS_OF}`, tok)).body.unit;
  ok("§9 …and a foundation never gets the Planned flag", !!oakUnit && oakUnit.planned === false, oakUnit && oakUnit.plannedWhy);
  const spCard = card(r3, "sponsors");
  const topLevel = spCard.items.filter(i => i.levels && /platinum/i.test(i.levels.last.level) && i.state === "not_renewed");
  ok("§9 a sponsor already at Platinum is asked to renew at Platinum, with no offer", topLevel.length > 0 && topLevel.every(i => /^Ask to renew at Platinum \(\$[\d,]+\)\.$/.test(i.how.ask.words) && !/offer/i.test(i.how.ask.words) && !/level this year/.test(i.how.say)),
     topLevel.map(i => i.how.ask.words));
  const lower = spCard.items.filter(i => i.down);
  ok("§9 downgrades across any two years: the sponsors who dropped a level are counted", lower.length >= 2 && new RegExp(`${lower.length} sponsors at a lower level`).test(spCard.words.what)
     && lower.every(i => i.levels.prev && i.levels.prev.year < i.levels.last.year), [spCard.words.what, lower.map(i => `${i.name}: ${i.levels.prev.level} ${i.levels.prev.year} to ${i.levels.last.level} ${i.levels.last.year}`)]);
  // Done, Not now and Doesn't fit each advance the deck and are recorded as outcomes
  const pick = k => deck.tabs.find(t => t.key === k).moves;
  const [m1, m2, m3] = [...pick("grow"), ...pick("major")].slice(0, 3);
  const deckAfter = async (at) => (await api("GET", `/insights?asOf=${at || AS_OF}`, tok)).body.deck.tabs.flatMap(t => t.moves).map(m => m.id);
  await api("POST", "/insights/outcome", tok, { kind: m1.kind, itemKeys: [m1.itemKey], donorIds: m1.ids, state: "done" });
  await api("POST", "/insights/outcome", tok, { kind: m2.kind, itemKeys: [m2.itemKey], donorIds: m2.ids, state: "snoozed", until: "2026-11-20" });
  await api("POST", "/insights/outcome", tok, { kind: m3.kind, itemKeys: [m3.itemKey], donorIds: m3.ids, state: "dismissed", reason: "test" });
  const after9 = await deckAfter();
  const rec = await q(`SELECT kind, item_key, state FROM insight_outcomes WHERE org_id=$1 AND item_key = ANY($2)`, [ORG, [m1.itemKey, m2.itemKey, m3.itemKey]]);
  ok("§9 Done, Not now and Doesn't fit take the move off the deck, each recorded as its outcome",
     ![m1, m2, m3].some(m => after9.includes(m.id)) && ["done", "snoozed", "dismissed"].every(st => rec.some(r => r.state === st)), rec);
  ok("§9 …and Not now brings it back on its date", (await deckAfter("2026-11-20")).includes(m2.id), m2.id);
  // the greeting's pace is the one number (numbers.vsLastYear), and the truth check fails if Home says another
  const lead9 = (await api("GET", "/home/lead", tok)).body;
  ok("§9 the greeting says pace in one sentence", !!lead9.pace && /^Giving this (fiscal )?year is (\$[\d,]+ (behind|ahead of)|on pace with) last year at this point\.$/.test(lead9.pace.line), lead9.pace && lead9.pace.line);
  let paceCaught = false;
  try {
    await assertSurfacesAgree(ORG, { token: tok, step: "planted pace", plant: ({ lead }) => { if (lead && lead.pace) lead.pace.line = lead.pace.line.replace(/\$([\d,]+)/, (x, n) => "$" + (Number(n.replace(/,/g, "")) + 2169).toLocaleString("en-US")); } });
  } catch (e) { paceCaught = /Home's greeting/.test(e.message); }
  ok("§9 the truth check can fail: Home saying a different pace from the Board is caught", paceCaught, "");
  }

  await q(`UPDATE orgs SET ai_enabled=false WHERE id=$1`, [ORG]).catch(() => {});
  const r4 = await get();
  ok("§7 with Atlas off every card has its template words", r4.body.cards.length >= 5 && r4.body.cards.every(x => x.wordsFrom === "template" && x.words.what && x.words.why), r4.body.cards.map(x => x.kind));
  const first = await get("&view=first");
  ok("§7 the first look: 5 to 7 cards, no Home-only card, the coverage line first", first.body.cards.length >= 5 && first.body.cards.length <= 7 && !first.body.cards.some(x => x.homeOnly) && !!first.body.coverage.sentence, first.body.cards.map(x => x.kind));
  const homeKinds = r4.body.cards.map(x => x.kind), lastPeople = Math.max(...r4.body.cards.map((x, i) => (x.rung ? i : -1)));
  ok("§7 Review leads the first look, and on Home it follows the cards about people",
     first.body.cards[0].kind === "review" && homeKinds.indexOf("review") > lastPeople, [first.body.cards[0].kind, homeKinds]);
  const ranks = first.body.cards.map(x => x.rung).filter(Boolean);
  const order = ["retain", "second", "upgrade", "major", "planned"];
  ok("§7 cards rank by rung (Retain, Second gift, Upgrade, Major, Planned)", ranks.every((x, i) => i === 0 || order.indexOf(x) >= order.indexOf(ranks[i - 1])), ranks);
  // outcomes
  const ye = card(r3, "year_end");
  const seen = await api("POST", "/insights/seen", tok, { asOf: AS_OF, items: ye.items.map(i => ({ kind: "year_end", itemKey: i.key, donorIds: i.ids })) });
  ok("§7 the page records what it showed (a POST; the GET wrote nothing)", seen.status === 200 && seen.body.recorded === ye.items.length, seen.body);
  const done = await api("POST", "/insights/outcome", tok, { kind: "year_end", itemKey: ye.items[0].key, donorIds: ye.items[0].ids, state: "done" });
  ok("§7 Done takes that giver off the card", done.status === 200 && !card(await get(), "year_end").items.some(i => i.key === ye.items[0].key), done.status);
  const sn = await api("POST", "/insights/outcome", tok, { kind: "year_end", itemKey: ye.items[1].key, donorIds: ye.items[1].ids, state: "snoozed", until: "2026-11-05" });
  ok("§7 Not now hides it until its date, then it is back", sn.status === 200 && !card(await get(), "year_end").items.some(i => i.key === ye.items[1].key)
     && (await api("GET", "/insights?asOf=2026-11-05", tok)).body.cards.find(x => x.kind === "year_end").items.some(i => i.key === ye.items[1].key), sn.status);
  const lead = ye.items[0];
  await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, created_by, created_by_name) VALUES ($1,$2,$3,250,'2026-11-01','system:test','test')`, ["g_ins_follow", ORG, lead.lead]);
  const wk = (await api("GET", "/insights/worked", tok)).body;
  const row = wk.rows.find(x => x.kind === "year_end");
  ok("§7 What worked: shown, done, and a gift within 60 days with its dollars", !!row && row.shown === ye.items.length && row.acted === 1 && row.followed >= 1 && row.cents >= 25000, row);
  await q(`DELETE FROM gifts WHERE id='g_ins_follow'`);

  // ── §8 speed: 2,000 donors and 10,000 gifts ────────────────────────────
  const BIG = "org_ins1speed";
  const tokB = await freshOrg(BIG, "Insights speed (test)");
  await q(`INSERT INTO donors (id, org_id, name, created_by, created_by_name) SELECT 'dsp_'||i, $1, 'Speed Person '||i, 'system:test', 'test' FROM generate_series(1,2000) i`, [BIG]);
  await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, notes, created_by, created_by_name)
           SELECT 'gsp_'||i, $1, 'dsp_'||(1 + (i % 2000)), 25 + (i % 40) * 25, (DATE '2024-01-01' + (i * 7919 % 1030))::text, CASE WHEN i % 97 = 0 THEN 'Tickets' ELSE 'Donation' END, 'system:test', 'test'
             FROM generate_series(1,10000) i`, [BIG]);
  const t0 = performance.now();
  const sp = await api("GET", `/insights?asOf=${AS_OF}&view=first`, tokB);
  const ms8 = Math.round(performance.now() - t0);
  ok(`§8 the first look for 2,000 donors and 10,000 gifts in under 3 seconds (${ms8} ms)`, sp.status === 200 && sp.body.cards.length > 0 && ms8 < 3000, ms8);
  // the speed org's rows were written straight in (no totals): it goes, so no other suite reads it
  const allT = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of allT) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [BIG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [BIG]).then(() => true).catch(() => false)) break;
  }

  if (WAITING.length) {
    ok(`§M ${WAITING.length} checks wait on the memo-kept gift file (NEEDS-JONATHAN): ${WAITING.join("; ")}`, false, "fixture");
  }
  summary();
  await closeDb();
}
main().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
