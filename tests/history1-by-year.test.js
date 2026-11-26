// tests/history1-by-year.test.js: HISTORY-1. GIVING BY FISCAL YEAR, A
// PERSON'S AND THE ORG'S. Guards money and donor data: the years are Lifetime
// cut by year, and Reports' years are the Giving summary's.
//   §1 a person's By year (GET /donors/:id/by-year): the years, plus the
//      undated gift, plus "Before Steward" (the import's stated total, one row,
//      never spread) add up to Lifetime to the cent; a gift the import already
//      covers is in no year; the years are the TRUTH-1 key's.
//   §2 soft credit is its own line per year and in no year's total.
//   §3 the org's Year over year: each fiscal year's total, gifts and donors
//      are the Giving summary's for that year; new + retained + reactivated =
//      donors, each against the key; retention is retained over the year
//      before's donors.
//   §4 the year still running is "so far" and its same point last year runs
//      from last year's first day to the same day of last fiscal year.
//   §5 every figure on both views opens rows that foot to it.
//   §6 POLISH-12: the chart's year labels never overlap (11 years at 1024
//      wide; 3, 11 and 20 at three widths); "$24,000 to $50" is "99.8%"; a name
//      ending in "Inc." takes one period; Top 100 is off until the org turns
//      it on, and Major Gifts opens on Pipeline without it.
// HOW IT GOES RED ON MAIN: /donors/:id/by-year and /reports/year-over-year do
// not exist (404), so every section fails.
// PLANTED: add each year's soft credit to its total in shared/numbers/byYear.js
// donorByYear and §1 (the rows no longer foot to Lifetime) and §2 go red.
// Standard scratch stack (tests/README.md). Tests set their own clock
// (tests/clock.js). Every name is made up. Sends nothing.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { civilDay } = require("./clock");
const { computeKey, fiscalYear, addDays } = require("./keys/truthKey");

const ORG = "org_hist1years";
const PASSWORD = "loadtest1234";
const C = v => Math.round(Number(v || 0) * 100);
const TODAY = civilDay(undefined, "America/New_York");
const ACTOR = "system:tests/history1";

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,vocabulary_json)
           VALUES ($1,$2,$3,1,'active','team','America/New_York','{"fiscal_year_start_month":7}')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Tamsin Reed','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}

(async () => {
  console.log("\nHISTORY-1 · by year, a person's and the org's");
  const tok = await freshOrg(ORG, "Larkspur Tide Collective");
  const FY0 = fiscalYear(TODAY, 7), FY1 = fiscalYear(TODAY, 7, -1), FY2 = fiscalYear(TODAY, 7, -2), FY3 = fiscalYear(TODAY, 7, -3);
  const inFy = (fy, n) => addDays(fy.from, n);
  // FY0 has run at least a day; a fixture gift in it is dated on its first day or today.
  const cur = d => (d <= TODAY ? d : TODAY);

  // ── people (made up) ──
  const P = { wren: "d_h1wren", ash: "d_h1ash", bram: "d_h1bram", cole: "d_h1cole", dina: "d_h1dina", ezra: "d_h1ezra" };
  const names = { wren: "Wren Halloway", ash: "Ash Pellow", bram: "Bram Oakes", cole: "Cole Varden", dina: "Dina Marsh", ezra: "Ezra Quill" };
  for (const [k, id] of Object.entries(P)) {
    await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,'HISTORY-1 test')`,
      [id, ORG, names[k], `${k}@example.test`, ACTOR]);
  }
  // Wren's old system stated $37,206 to the day before FY3 began.
  const through = addDays(FY3.from, -1);
  await q(`UPDATE donors SET imported_total=37206, imported_through=$2, imported_source='Old Ledger', imported_import_id='imp_h1old' WHERE id=$1`, [P.wren, through]);

  const gifts = [];
  let n = 0;
  const gift = async (who, amount, date, extra = {}) => {
    const id = `g_h1_${++n}`;
    await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, type, import_id, created_by, created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'HISTORY-1 test')`, [id, ORG, who, amount, date, extra.type || "one-time", extra.importId || null, ACTOR]);
    gifts.push({ id, person: Object.keys(P).find(k => P[k] === who), amount, date, type: extra.type || "one-time" });
    return id;
  };
  // Wren: a gift the import already covers (in its total, in no year)
  await gift(P.wren, 900, addDays(through, -30), { importId: "imp_h1old" });
  await gift(P.wren, 1200, inFy(FY2, 40));
  await gift(P.wren, 2500, inFy(FY1, 10));
  await gift(P.wren, 300, inFy(FY1, 200));
  await gift(P.wren, -100, inFy(FY1, 220));            // a refund comes off FY1
  await gift(P.wren, 650, cur(inFy(FY0, 0)));
  await gift(P.wren, 75, null);                         // undated, not from the import: in Lifetime, in no year
  await gift(P.wren, 400, inFy(FY1, 30), { type: "Soft Credit" });   // recognition, never money
  // The org's other givers
  await gift(P.ash, 100, inFy(FY2, 5)); await gift(P.ash, 150, inFy(FY1, 5)); await gift(P.ash, 175, cur(inFy(FY0, 0)));   // retained in FY0
  await gift(P.bram, 500, inFy(FY2, 60)); await gift(P.bram, 250, cur(inFy(FY0, 0)));                                     // reactivated in FY0
  await gift(P.cole, 80, TODAY);                                                                                           // new in FY0
  const dinaGift = await gift(P.dina, 1000, inFy(FY1, 90));                                                                // FY1 only
  await gift(P.ezra, 0, inFy(FY1, 15));                                                                                    // a $0 row makes nobody a donor
  // Dina's gift soft-credits Wren
  await q(`INSERT INTO gift_soft_credits (id, org_id, gift_id, donor_id, amount, created_by, created_by_name) VALUES ('sc_h1_1',$1,$2,$3,250,$4,'HISTORY-1 test')`,
    [ORG, dinaGift, P.wren, ACTOR]).catch(async () => {
    await q(`INSERT INTO gift_soft_credits (id, org_id, gift_id, donor_id, amount) VALUES ('sc_h1_1',$1,$2,$3,250)`, [ORG, dinaGift, P.wren]);
  });
  // Keep the stored summaries current, as a write through the app would.
  await api("POST", "/donors/recalc-summaries", tok).catch(() => {});

  // ── §1 a person's years foot to Lifetime ──
  const by = await api("GET", `/donors/${P.wren}/by-year`, tok);
  ok("§1 By year answers (200)", by.status === 200, by.status);
  const W = by.body || {};
  const yrs = W.years || [];
  const profile = await api("GET", `/donors/${P.wren}`, tok);
  const lifeShown = profile.body && profile.body.figures && profile.body.figures.lifetime ? C(profile.body.figures.lifetime.value) : null;
  const rowsSum = yrs.reduce((s, y) => s + y.cents, 0) + (W.other || []).reduce((s, o) => s + o.cents, 0) + (W.before ? W.before.cents : 0);
  // Lifetime by hand: $37,206 + 1,200 + 2,500 + 300 − 100 + 650 + 75
  const LIFE = 3720600 + 120000 + 250000 + 30000 - 10000 + 65000 + 7500;
  ok("§1 the rows (years + undated + Before Steward) add up to Lifetime, to the cent", rowsSum === LIFE && W.lifetimeCents === LIFE, { rowsSum, LIFE, lifetime: W.lifetimeCents });
  ok("§1 ...and to the profile's own Lifetime figure", lifeShown === null || lifeShown === LIFE, { lifeShown, LIFE });
  ok("§1 Before Steward is its own row: $37,206, stated in the import", W.before && W.before.cents === 3720600 && /^Before Steward: \$37,206 \(stated in your import\)$/.test(W.before.sentence), W.before);
  const yOf = fy => yrs.find(y => y.from === fy.from);
  ok("§1 FY-2 is $1,200; FY-1 is $2,700 (the refund off, the soft credit row out); this year so far $650",
    yOf(FY2) && yOf(FY2).cents === 120000 && yOf(FY1) && yOf(FY1).cents === 270000 && yOf(FY0) && yOf(FY0).cents === 65000 && yOf(FY0).current, yrs.map(y => [y.label, y.cents]));
  ok("§1 the covered gift ($900) is in no year: FY-3 and earlier hold nothing", !yrs.some(y => y.from <= FY3.from && y.cents !== 0), yrs.map(y => [y.label, y.cents]));
  ok("§1 the undated $75 is its own row", (W.other || []).some(o => o.key === "undated" && o.cents === 7500), W.other);
  ok("§1 newest first, one row per fiscal year, labelled with its months", yrs.length >= 3 && yrs[0].from === FY0.from && yrs.every((y, i) => !i || y.from < yrs[i - 1].from) && /^Jul \d{4} to Jun \d{4}$/.test(yrs[0].label), yrs.map(y => y.label));
  // TRUTH-3: a refund is not a gift, so it is not counted (shared/numbers/giftCount.js): 2 gifts, the refund off the total.
  ok("§1 FY-1's gift count, largest gift and change", yOf(FY1).giftCount === 2 && yOf(FY1).largestCents === 250000 && yOf(FY1).change === "up $1,500 (125%)", yOf(FY1));
  ok("§1 the first year after the import says so", yOf(FY2).change === "first year after the import", yOf(FY2).change);

  // TRUTH-1's key: each person's years add up to their Lifetime (hard money, no import)
  const K = computeKey({ people: Object.keys(P).map(id => ({ id })), gifts: gifts.map(g => ({ ...g, date: g.date || undefined })) }, { today: TODAY, fiscalStartMonth: 7 });
  const keyFoots = Object.keys(P).every(id => {
    const ys = K.byYearById[id] || {};
    return Object.values(ys).reduce((s, c) => s + c, 0) === K.lifetimeById[id];
  });
  ok("§1 the key: every person's year totals add up to their lifetime", keyFoots && K.yearsFootLifetime === true, K.byYearById);
  const ashBy = (await api("GET", `/donors/${P.ash}/by-year`, tok)).body || { years: [] };
  const ashKey = K.byYearById.ash;
  ok("§1 a person with no import: the app's years are the key's years", ashBy.years.filter(y => y.cents).every(y => ashKey[`FY${y.from.slice(0, 4)}`] === y.cents)
    && Object.values(ashKey).reduce((s, c) => s + c, 0) === ashBy.lifetimeCents, { app: ashBy.years.map(y => [y.from, y.cents]), key: ashKey });

  // ── §2 soft credit: its own line, never in a total ──
  // FY-1 soft: Dina's gift credited $250 + Wren's own Soft Credit row $400.
  ok("§2 FY-1's soft credit is its own line: $650 (a credited gift and a credit row)", yOf(FY1).softCents === 65000, yOf(FY1).softCents);
  ok("§2 ...and not in FY-1's total ($2,700)", yOf(FY1).cents === 270000, yOf(FY1).cents);

  // ── §3 the org's years are the Giving summary's ──
  const yo = await api("GET", `/reports/year-over-year`, tok);
  ok("§3 Year over year answers (200)", yo.status === 200, yo.status);
  const O = (yo.body && yo.body.years) || [];
  let agree = true; const seen = [];
  for (const y of O) {
    const fy = [FY0, FY1, FY2, FY3].find(f => f.from === y.from) || { from: y.from, to: y.to };
    const gs = (await api("GET", `/reports/giving-summary?yearMode=fiscal&from=${fy.from}&to=${fy.to}`, tok)).body || {};
    const same = C(gs.total) === y.cents && gs.giftCount === y.giftCount && gs.uniqueDonors === y.donors && gs.newDonors === y.newDonors;
    seen.push({ y: y.label, cents: y.cents, gs: C(gs.total), gifts: [y.giftCount, gs.giftCount], donors: [y.donors, gs.uniqueDonors], new: [y.newDonors, gs.newDonors] });
    if (!same) agree = false;
  }
  ok("§3 each fiscal year's total, gifts, donors and new donors are the Giving summary's", agree && O.length >= 3, seen);
  ok("§3 retained + new + reactivated = donors, every year", O.every(y => y.retained + y.newDonors + y.reactivated === y.donors), O.map(y => [y.label, y.donors, y.newDonors, y.retained, y.reactivated]));
  const o0 = O.find(y => y.from === FY0.from), o1 = O.find(y => y.from === FY1.from);
  const kLabel = `FY${FY0.from.slice(0, 4)}`;
  ok("§3 this year: 4 donors; new is the key's first-time (Cole), retained the key's (Ash, Wren), reactivated Bram",
    o0 && o0.donors === 4 && o0.newDonors === (K.firstTime[kLabel] || []).length && o0.retained === (K.retained[kLabel] || []).length && o0.reactivated === 1,
    { o0, first: K.firstTime[kLabel], retained: K.retained[kLabel] });
  ok("§3 last year's donors leave Ezra's $0 row out (Wren, Ash, Dina)", o1 && o1.donors === 3, o1 && o1.donors);
  ok("§3 retention is retained over the year before's donors (2 of 3)", o0 && Math.abs(o0.retentionRate - 2 / 3) < 1e-9, o0 && o0.retentionRate);

  // ── §4 so far, against the same day of last fiscal year ──
  const sp = yo.body && yo.body.samePoint;
  const daysIn = Math.round((Date.parse(TODAY) - Date.parse(FY0.from)) / 86400000);
  const want = { from: FY1.from, to: addDays(FY1.from, daysIn) };
  ok("§4 the year still running is so far, to today", o0 && o0.current && o0.to === TODAY, o0 && [o0.current, o0.to]);
  ok("§4 same point last year: last year's first day to the same day of last fiscal year", sp && sp.from === want.from && sp.to === want.to, { sp, want });
  const spKey = K.between(want.from, want.to);
  ok("§4 the same point's money is the key's for that stretch", sp && sp.cents === spKey.cents, { sp: sp && sp.cents, key: spKey.cents });

  // ── §5 every figure opens rows that foot to it ──
  const foot = async (label, f, want) => {
    const qs = Object.entries(f.params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const r = await api("GET", `/figures/${f.key}/rows?${qs}&pageSize=200`, tok);
    const b = r.body || {};
    // FLOWS-11: a gift's refunds ride under it; the rows not counted as gifts come once, apart.
    const rowsCents = (b.rows || []).reduce((s, x) => s + C(x.amount) + (x.refunds || []).reduce((m, y) => m + C(y.amount), 0), 0)
      + ((b.notCounted && b.notCounted.rows) || []).reduce((s, x) => s + C(x.amount), 0);
    const count = b.totalRows;
    const okv = r.status === 200 && (b.measure === "count" ? count === want : b.cents === want && rowsCents === want);
    return okv ? null : { label, key: f.key, status: r.status, measure: b.measure, value: b.value, cents: b.cents, rowsCents, count, want };
  };
  const bad = [];
  for (const y of yrs) {
    for (const [k, w] of [["total", y.cents], ["giftCount", y.giftCount], ["largest", y.largestCents], ["softCredit", y.softCents]]) {
      if (!w && k !== "total") continue;
      const m = await foot(`${y.label} ${k}`, y.sources[k], w); if (m) bad.push(m);
    }
  }
  for (const o of W.other || []) { const m = await foot(o.label, o.source, o.cents); if (m) bad.push(m); }
  for (const y of O) {
    for (const [k, w] of [["total", y.cents], ["giftCount", y.giftCount], ["largest", y.largestCents], ["donors", y.donors], ["newDonors", y.newDonors], ["retained", y.retained], ["reactivated", y.reactivated]]) {
      if (k === "largest" && !w) continue;
      const m = await foot(`org ${y.label} ${k}`, y.sources[k], w); if (m) bad.push(m);
    }
  }
  if (sp) for (const [k, w] of [["total", sp.cents], ["giftCount", sp.giftCount], ["donors", sp.donors]]) { const m = await foot(`same point ${k}`, sp.sources[k], w); if (m) bad.push(m); }
  // retention: its parts are the retained people over the year before's donors
  const rr = await api("GET", `/figures/yoy-retention/rows?${Object.entries(o0.sources.retentionRate.params).map(([k, v]) => `${k}=${v}`).join("&")}&pageSize=200`, tok);
  const parts = (rr.body && rr.body.parts) || [];
  const num = parts.find(p => p.role === "numerator"), den = parts.find(p => p.role === "denominator");
  ok("§5 retention opens its two lists: retained (2) over last year's donors (3)", rr.status === 200 && num && den && num.value === 2 && den.value === 3, { status: rr.status, parts: parts.map(p => [p.role, p.value]) });
  ok("§5 every figure on By year and Year over year opens rows that foot to it", bad.length === 0, bad);

  // ── §6 POLISH-12: the chart's years, the change sentence, a name's period, the Top 100 switch ──
  // RED ON MAIN: shared/yearAxis.js and shared/endOnName.js do not exist; "$24,000 to $50" says
  // "(100%)"; /org/menu has no top100 and Major Gifts opens on Top 100.
  const path = require("path"), ROOT = path.join(__dirname, "..");
  const esm = rel => import(path.join(ROOT, rel));
  const AX = await esm("shared/yearAxis.js");
  const eleven = [...Array(11)].map((_, i) => ({ chartLabel: `FY ${2016 + i}–${String(2017 + i).slice(2)}`, current: i === 10 }));
  // The chart is 640 wide with 580 for bars; its labels draw at 11px at least (ByYear.jsx YearBars).
  const drawn = (years, chartPx) => {
    const slot = 580 / years.length, fs = Math.min(22, Math.max(10, 11 / (chartPx / 640)));
    const fit = AX.fitYearLabels(years, slot, t => AX.estimateWidth(t, fs));
    const boxes = fit.labels.map((t, i) => { const w = AX.estimateWidth(t, fs), c = i * slot + slot / 2; return t ? { left: c - w / 2, right: c + w / 2, width: w } : null; });
    return { fit, boxes, fullBoxes: years.map((y, i) => { const w = AX.estimateWidth(y.chartLabel, fs), c = i * slot + slot / 2; return { left: c - w / 2, right: c + w / 2, width: w }; }) };
  };
  // the profile's main column draws the chart about 880, 600 and 340 wide at 1440, 1024 and 390
  const at1024 = drawn(eleven, 600);
  ok("§6 the guard can fail: every full label under 11 bars at 1024 wide overlaps (main's chart)", AX.labelsOverlap(at1024.fullBoxes));
  ok("§6 11 fiscal years at 1024 wide: no two labels overlap", !AX.labelsOverlap(at1024.boxes), at1024.fit);
  const bad6 = [];
  for (const n of [3, 11, 20]) for (const px of [880, 600, 340]) {
    const yrs6 = [...Array(n)].map((_, i) => ({ chartLabel: `FY ${2006 + i}–${String(2007 + i).slice(2)}`, current: i === n - 1 })).slice(-12);
    const d6 = drawn(yrs6, px);
    const kept = [0, yrs6.length - 1].every(i => d6.fit.labels[i]);
    if (AX.labelsOverlap(d6.boxes) || !kept) bad6.push({ n, px, mode: d6.fit.mode, labels: d6.fit.labels });
  }
  ok("§6 3, 11 and 20 years at three widths: none overlap, and the first and last year are always named", bad6.length === 0, bad6);
  ok("§6 the short label: FY 2016–17 is FY17, a calendar fiscal year FY 2016 is 2016", AX.shortYearLabel("FY 2016–17") === "FY17" && AX.shortYearLabel("FY 2016") === "2016");

  const fen = "d_p12fenwick";
  await q(`INSERT INTO donors (id, org_id, name, kind, created_by, created_by_name) VALUES ($1,$2,'Fenwick Holdings, Inc.','organization',$3,'POLISH-12 test')`, [fen, ORG, ACTOR]);
  for (const [date, amount] of [[inFy(FY3, 20), 24000], [inFy(FY2, 20), 50]])
    await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, type, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,'one-time',$6,'POLISH-12 test')`,
      [`g_p12_${date}`, ORG, fen, amount, date, ACTOR]);
  const fy6 = await api("GET", `/donors/${fen}/by-year`, tok);
  const row2 = ((fy6.body && fy6.body.years) || []).find(y => y.from === FY2.from);
  ok("§6 $24,000 to $50 says down $23,950 (99.8%), never (100%)", row2 && row2.change === "down $23,950 (99.8%)", row2 && row2.change);
  const BY = require("../shared/numbers/byYear");
  ok("§6 a change under 1% says (less than 1%)", BY.changeWords(100000, 100050, { gifts: 1 }) === "down $0.50 (less than 1%)", BY.changeWords(100000, 100050, { gifts: 1 }));

  const EN = await esm("shared/endOnName.js");
  ok("§6 a name ending in Inc. gets one period, any other name gets one", `Nothing is open for ${EN.endOnName("Fenwick Holdings, Inc.")}` === "Nothing is open for Fenwick Holdings, Inc."
    && `Nothing is open for ${EN.endOnName("Wren")}` === "Nothing is open for Wren.");

  const MG = await esm("client/src/lib/majorGiftsTab.js");
  const opens = views => MG.mgViewIn(MG.mgView(undefined), MG.mgShownViews(views));
  const off = await api("GET", "/org/menu", tok);
  ok("§6 Top 100 off by default: no Top 100 tab, and Major Gifts opens on Pipeline",
    off.status === 200 && off.body.top100 === false && !off.body.mgViews.includes("top100") && opens(off.body.mgViews) === "pipeline", off.body);
  // POLISH-13 item 6: a direct load renders before the org's list arrives (all four shown, Top 100 on
  // screen); when the list lands without Top 100, the page moves to Pipeline (main: Portfolios, the first tab).
  const firstPaint = MG.mgViewIn(MG.mgView(undefined), MG.mgShownViews(undefined));
  ok("§6b a direct load with Top 100 off lands on Pipeline once the org's tabs arrive",
    firstPaint === "top100" && MG.mgViewIn(firstPaint, MG.mgShownViews(off.body.mgViews)) === "pipeline"
      && /setViewRaw\(mgViewIn\(view, shown\)\)/.test(require("fs").readFileSync(require("path").join(__dirname, "../client/src/components/MajorGiftsPage.jsx"), "utf8")));
  const on = await api("PUT", "/org/menu", tok, { top100: true });
  ok("§6 turned on: the Top 100 tab is back, first", on.status === 200 && on.body.top100 === true && on.body.mgViews[0] === "top100" && opens(on.body.mgViews) === "top100", on.body);
  const [orow] = await q(`SELECT top100_enabled FROM orgs WHERE id=$1`, [ORG]);
  ok("§6 …as the org's setting", orow && orow.top100_enabled === true, orow);
  const off2 = await api("PUT", "/org/menu", tok, { top100: false });
  ok("§6 turned off again: Pipeline, nothing else changed", off2.status === 200 && off2.body.top100 === false && opens(off2.body.mgViews) === "pipeline" && off2.body.mgViews.length === 3, off2.body);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran", false, String(e && e.stack || e)); try { await closeDb(); } catch {} summary(); });
