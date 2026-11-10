// tests/truth5-amounts.test.js — TRUTH-5. AMOUNTS MEAN WHAT THEIR LABEL SAYS.
//
// The QA fleet (7–9 Nov) read a lifetime printed as a December amount on a
// period question, a person who gives through a trust folded into the trust's
// LYBUNT row, a trust's linked people listed with their whole lifetimes, the
// Directory's gift count above the profile's, a $0 row with no label, two
// populations called "Lapsed", no period on Fundraising Overview, and a pledge
// from before installments with no schedule. This suite builds one org shaped
// like that (tests/lib/truth5Fixture.js) and asks, through the API and on the
// built client:
//   §1 the December question: each row is the December amount (Sterling
//      $2,144, never his $8,929), the rows add to no more than December's
//      whole, Lifetime is labeled, and "How Steward read this" says the basis;
//      Atlas's own list reads the same amounts
//   §2 LYBUNT: Louisa (gives through the trust) on her own row at her own
//      $2,659, the trust at its own $4,682, said beside each other as "also
//      connected"; the Ashford household once; the header counts the rows
//   §3 the trust's Through list is soft credit ("$4,682 given through …, by
//      3 people"), never the linked people's lifetimes
//   §4 the Directory's gift count is the profile's (giftCount.js)
//   §5 the $0 row's label; a gift given at an event moves Reports' count
//   §6 LYBUNT, Lapsed and Lost each name one population, defined on hover
//   §7 Fundraising Overview's This FY / Last FY / custom, footing to Reports
//   §8 Lavinia's pledge: "1 installment, $1,200, paid $600", both payments on it
//   §9 the browser: the same, on the screens
//
// HOW IT GOES RED (planted, see the PR): shared/numbers/periodAmounts.js
// reading each person's Lifetime for the window (Atlas reads lifetime) turns §1
// red: Sterling reads $8,929 and the rows add to more than December.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { buildTruth5Org } = require("./lib/truth5Fixture");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");
const cents = v => Math.round(Number(v || 0) * 100);

(async () => {
  console.log("truth5-amounts (TRUTH-5)");
  const f = await buildTruth5Org();
  const tok = f.token;
  const dec = f.ids.december;

  // ── §1 a period question gets period amounts ─────────────────────────────
  const plan = { entity: "people", where: [], measure: { fn: "count", field: null }, list: true,
    related: [{ entity: "gifts", where: [{ field: "date", op: "between", value: [dec.from, dec.to] }] },
              { entity: "gifts", where: [{ field: "date", op: "gte", value: `${Number(dec.from.slice(0, 4)) + 1}-01-01` }], none: true }] };
  const a = (await api("POST", "/ask", tok, { text: "Who gave last December but not this year?", qplan: plan })).body || {};
  const people = a.people || [];
  const ster = people.find(p => p.donorId === f.ids.sterling) || {};
  const wholeDec = (await api("GET", `/reports/giving-summary?from=${dec.from}&to=${dec.to}`, tok)).body || {};
  const rowsSum = people.reduce((n, p) => n + (p.cents || 0), 0);
  ok("§1 the December list is Sterling and Wynne (Ida gave this year)", people.length === 2 && !!ster.donorId && !people.some(p => p.donorId === f.ids.ida), people.map(p => p.name));
  ok("§1 Sterling's amount is his December, $2,144, never his lifetime $8,929", ster.cents === 214400 && ster.amountWords === `in Dec ${dec.from.slice(0, 4)}`, ster);
  ok("§1 …and his Lifetime is beside it, labeled as such ($8,929)", ster.lifetimeCents === 892900, ster);
  ok("§1 the rows add to no more than December's whole", a.periodWhole && rowsSum <= a.periodWhole.cents && a.periodWhole.cents === cents(wholeDec.total),
    { rowsSum, whole: a.periodWhole, reports: wholeDec.total });
  ok("§1 \"How Steward read this\" is made from the query that ran and names the basis", /each amount is what they gave in Dec \d{4}/.test(a.planWords || "") && /Lifetime is labeled Lifetime/.test(a.planWords || ""), a.planWords);
  // Atlas's own list: the same rule, from the same answer.
  const AN = require("../server/atlas/answers");
  const { query } = require("../db");
  const list = await AN.listAnswer({ ask: a, query, orgId: f.org, asHer: async () => ({ status: 404 }), req: {}, today: f.today });
  const al = ((list && list.people) || []).find(p => p.donorId === f.ids.sterling) || {};
  ok("§1 Atlas's list says $2,144 in December and Lifetime $8,929, labeled", al.amount === `$2,144 in Dec ${dec.from.slice(0, 4)}` && al.lifetime === "Lifetime $8,929", al);

  // ── §2 LYBUNT: a giving unit is a household; gives through is not ────────
  const ly = (await api("GET", "/reports/lybunt", tok)).body || {};
  const units = ly.units || [];
  const trustRow = units.find(u => u.id === f.ids.trust) || {};
  const louisaRow = units.find(u => u.id === f.ids.louisa) || {};
  ok("§2 Louisa has her own row at her own $2,659", louisaRow.priorYearTotal === 2659 && !louisaRow.members, louisaRow);
  ok("§2 the trust's row is the trust's own $4,682, with no one folded in", trustRow.priorYearTotal === 4682 && !trustRow.members, trustRow);
  ok("§2 …and says Louisa is also connected, with her own amount", (trustRow.connected || []).some(c => c.id === f.ids.louisa && c.how === "gives through" && c.priorYearTotal === 2659), trustRow.connected);
  const ash = units.filter(u => u.id === f.ids.couple || u.id === f.ids.prudence || (u.members || []).some(m => m.id === f.ids.prudence));
  ok("§2 the Ashford household is one row, Prudence once", ash.length === 1 && (ash[0].members || []).length === 2 && ash[0].priorYearTotal === 1305, ash);
  ok("§2 no one is on two rows, and every person is on one", (() => { const seen = units.flatMap(u => (u.members || [{ id: u.id }]).map(m => m.id)); return new Set(seen).size === seen.length && seen.length === (ly.rows || []).length; })(), units.map(u => u.name));

  // ── §3 the Through list is soft credit ───────────────────────────────────
  const rel = (await api("GET", `/donors/${f.ids.trust}/relationships`, tok)).body || {};
  ok("§3 the trust says $4,682 given through it, by 3 people", rel.through && rel.through.cents === 468200 && rel.through.people === 3 && /^\$4,682 given through this organization, by 3 people$/.test(rel.through.sentence), rel.through);
  const lou = (rel.relationships || []).find(r => r.relatedDonorId === f.ids.louisa) || {};
  const ans = (rel.relationships || []).find(r => r.relatedDonorId === f.ids.ansel) || {};
  ok("§3 each linked person reads what went through the trust, not their lifetime", lou.throughCents === 200000 && ans.throughCents === 168200, { lou, ans });

  // ── §4 one gift count per person ─────────────────────────────────────────
  const dir = ((await api("GET", "/donors?search=Atkinson", tok)).body || {}).donors || [];
  const prof = (await api("GET", `/donors/${f.ids.atkinson}`, tok)).body || {};
  const counted = (prof.gifts || []).filter(g => Number(g.amount) > 0).length;
  ok("§4 the Directory's count is the profile's and the Giving tab's rows (5, never the import's stated 6)",
    dir[0] && Number(dir[0].gift_count) === 5 && Number(prof.gift_count) === 5 && counted === 5, { dir: dir[0] && dir[0].gift_count, prof: prof.gift_count, counted });
  const top = (await api("GET", "/reports/top-donors?scope=lifetime", tok)).body || {};
  const atkTop = (top.rows || []).find(r => r.id === f.ids.atkinson);
  ok("§4 Top donors says the same count", !atkTop || Number(atkTop.giftCount) === 5, atkTop);

  // ── §5 a $0 row says what it is; an event gift moves Reports ────────────
  const GW = await import("../shared/giftWords.js");
  ok("§5 the $0 label says it is not counted and not a last gift", GW.ZERO_GIFT_LABEL === "$0, not counted, not a last gift", GW.ZERO_GIFT_LABEL);
  const before = (await api("GET", `/reports/giving-summary?from=${f.today}&to=${f.today}`, tok)).body || {};
  const pa = await api("PATCH", `/events/${f.ids.event}/attendees/${f.ids.attendee}`, tok, { status: "attended", giftAmount: 41 });
  const after = (await api("GET", `/reports/giving-summary?from=${f.today}&to=${f.today}`, tok)).body || {};
  ok("§5 a $41 gift at the event moves Reports' count for the day by one", pa.status === 200 && after.giftCount === (before.giftCount || 0) + 1 && cents(after.total) === cents(before.total) + 4100,
    { status: pa.status, before: [before.giftCount, before.total], after: [after.giftCount, after.total] });

  // ── §6 one word, one population ──────────────────────────────────────────
  const LW = require("../shared/numbers/lapseWords").LAPSE_WORDS;
  const LR = require("../lapseRule").WORDS;
  ok("§6 Lapsed and Lost are the lapse rule's two windows, word for word", LW.lapsed.definition === LR.lapsedRecent && LW.lost.definition === LR.lost, LW);
  ok("§6 LYBUNT names gave last fiscal year, not this one", /last fiscal year/.test(LW.lybunt.definition) && LW.lybunt.word === "LYBUNT", LW.lybunt);

  // ── §7 Fundraising Overview's period ─────────────────────────────────────
  const last = (await api("GET", "/fundraising/overview?period=last_fy", tok)).body || {};
  const lastRep = (await api("GET", `/reports/giving-summary?from=${last.period && last.period.start}&to=${last.period && last.period.end}`, tok)).body || {};
  ok("§7 Last FY on Overview is Reports' total and count for the same days", last.periodKey === "last_fy" && cents(last.period.raised) === cents(lastRep.total) && last.period.giftCount === lastRep.giftCount && last.period.raised > 0,
    { overview: last.period && [last.period.raised, last.period.giftCount], reports: [lastRep.total, lastRep.giftCount] });
  const cust = (await api("GET", `/fundraising/overview?period=custom&from=${dec.from}&to=${dec.to}`, tok)).body || {};
  ok("§7 custom days foot to Reports too", cust.periodKey === "custom" && cents(cust.period.raised) === cents(wholeDec.total) && cust.period.giftCount === wholeDec.giftCount, cust.period);
  const bad = await api("GET", `/fundraising/overview?period=custom&from=${dec.to}&to=${dec.from}`, tok);
  ok("§7 a custom period backwards is refused, in words", bad.status === 400 && /from/.test((bad.body || {}).error || ""), bad.body);

  // ── §8 a pledge from before installments ─────────────────────────────────
  const pls = (await api("GET", `/donors/${f.ids.lavinia}/pledges`, tok)).body || [];
  const sch = (pls[0] || {}).schedule || {};
  ok("§8 Lavinia's pledge says \"1 installment, $1,200, paid $600\"", sch.words === "1 installment, $1,200, paid $600" && sch.legacy === true, sch);
  ok("§8 …and both $300 payments are on that installment, oldest first", (sch.installments || []).length === 1 && sch.installments[0].payments.length === 2 && sch.installments[0].payments.every(p => p.amount === 300)
    && sch.installments[0].payments[0].date < sch.installments[0].payments[1].date, sch.installments);

  // ── §9 the browser ───────────────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(x => x.endsWith(".js"));
    if (!js.some(x => fs.readFileSync(path.join(DIST, "assets", x), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const lg = await api("POST", "/auth/login", null, { email: f.owner, password: f.password });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
    page.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/Download the React DevTools/.test(m.text())) errors.push(m.text()); });
    page.on("response", x => { if (x.status() >= 500 && !NOISE.test(x.url())) errors.push(x.status() + " " + x.url()); });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const shot = n => process.env.TRUTH5_SHOTS ? page.screenshot({ path: path.join(process.env.TRUTH5_SHOTS, n + ".png") }) : null;

    await page.goto(`${APP}/app/reports?report=lybunt`, { waitUntil: "networkidle", timeout: 60000 });
    const head = ((await page.locator('[data-testid="bunt-header-count"]').first().textContent({ timeout: 20000 }).catch(() => "")) || "").trim();
    const word = await page.locator('[data-testid="bunt-word"]').first().getAttribute("title").catch(() => "");
    const rowsOnScreen = await page.locator("table tbody tr").filter({ hasText: "@" }).count().catch(() => 0);
    const conn = (await page.locator('[data-testid="bunt-connected"]').allInnerTexts().catch(() => [])).join(" | ");
    ok("§9 LYBUNT's header counts the rows on screen", new RegExp(`^${units.length} `).test(head) && rowsOnScreen === units.length, { head, rowsOnScreen, units: units.length });
    ok("§9 …LYBUNT is defined on hover", /Last Year But Unfortunately Not This year/.test(word || ""), word);
    ok("§9 …and the trust's row says Louisa is also connected, on her own row", /Also connected: Louisa Eastbrook \(gives through; their own \$2,659, on their own row\)/.test(conn), conn);
    await shot("lybunt");

    await page.goto(`${APP}/donors/${f.ids.trust}`, { waitUntil: "networkidle", timeout: 60000 });
    const sum = (await page.locator('[data-testid="dp-rail-through-summary"]').first().textContent({ timeout: 20000 }).catch(() => "")) || "";
    const thr = (await page.locator('[data-testid="dp-rail-through"]').allInnerTexts().catch(() => [])).join(" | ");
    ok("§9 the trust's rail: \"$4,682 given through this organization, by 3 people\"", /\$4,682 given through this organization, by 3 people/.test(sum), sum);
    ok("§9 …and each linked person reads what went through it, no lifetime ($42,659 is Louisa's)", /\$2,000 given through here/.test(thr) && !/42,659/.test(thr), thr);
    await shot("trust");

    await page.goto(`${APP}/donors/${f.ids.lavinia}`, { waitUntil: "networkidle", timeout: 60000 });
    const sw = (await page.locator('[data-testid="dp-pledge-schedule"]').first().innerText({ timeout: 20000 }).catch(() => "")) || "";
    ok("§9 Lavinia's sidebar shows the schedule with both payments on it", /1 installment, \$1,200, paid \$600/.test(sw) && /\$300 on .*, \$300 on /.test(sw), sw);
    await shot("lavinia");

    await page.goto(`${APP}/app/fundraising`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-testid="fr-period-last"]').click({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const raisedLast = await page.getByText(/^Raised · /).first().textContent({ timeout: 15000 }).catch(() => "");
    const lyb = await page.locator('[data-testid="fr-lybunt"]').first().getAttribute("title").catch(() => "");
    ok("§9 Fundraising's Last FY shows last fiscal year", /Raised · FY 20\d\d–\d\d/.test(raisedLast || "") && /period=|frPeriod=last_fy/.test(page.url()), { raisedLast, url: page.url() });
    ok("§9 …and its tile says LYBUNT, defined on hover", /Last Year But Unfortunately Not This year/.test(lyb || ""), lyb);
    await shot("fundraising");

    await page.goto(`${APP}/donors?view=reengage`, { waitUntil: "networkidle", timeout: 60000 });
    const lapsedTitle = await page.locator('[data-testid="reengage-win-recent"]').first().getAttribute("title").catch(() => "");
    ok("§9 Re-engage's Lapsed is 12 to 24 months, defined on hover", lapsedTitle === LW.lapsed.definition, lapsedTitle);
    ok("§9 no console error or 5xx on the walk", errors.length === 0, errors.slice(0, 4));
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
