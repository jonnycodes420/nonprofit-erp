// NUMBERS-3 · ONE HOME FOR EVERY GIVING NUMBER: shared/numbers/, by hand.
//
// Each module against rows worked out by hand below, never against the app's
// own SQL (ARCHITECTURE.md, Tests). Fast: no browser and no HTTP; the SQL
// fragments run against the scratch database on one fixture org.
//   §1 fiscalYear: the boundary, its label, "to date" cut at the org's today,
//      and the clock edges (midnight UTC is still yesterday in New York, the
//      last day of the year at 11 PM ET, the DST change), a January year
//   §2 money: credit rows are not money, a refund comes off and is not a gift
//   §3 lifetime: the imported total plus the gifts after it
//   §4 givingBetween: this fiscal year to date leaves out credits, the future,
//      the deleted
//   §5 lastGift: a refund and a credit row are never the last gift
//   §6 firstGift: imported history is giving; first-time in a year
//   §7 retained: gave in both years; a refund is not giving again
//   §8 deposited: a run or a deposited day makes a gift deposited, and it
//      always has a deposit name; one list of banked methods
//   §9 donorTotals: the portal's, the account page's and the merge fields'
//      numbers are these modules' (one core, many faces)
"use strict";
const { ok, summary, q, closeDb } = require("./helpers");
const N = require("../shared/numbers");

const SEED = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_nh_${SEED}`;
const TODAY = "2026-11-02";
const sys = "'system:test','test'";
// The app's `?` placeholders, through the suite's own connection.
const query = (sql, args = []) => { let i = 0; return q(sql.replace(/\?/g, () => `$${++i}`), args); };
const at = iso => new Date(iso);

(async () => {
  console.log(`numbers-home (NUMBERS-3) · seed ${SEED}`);

  // ── §1 fiscalYear (pure) ─────────────────────────────────────────────────
  const july = { timezone: "America/New_York", vocabulary_json: { fiscal_year_start_month: 7 } };
  const jan = { timezone: "America/New_York", vocabulary_json: { fiscal_year_start_month: 1 } };
  const oct = { timezone: "America/New_York", vocabulary_json: { fiscal_year_start_month: 10 } };
  let fy = N.fiscalYear.fiscalYear(july, 0, at("2026-11-02T17:00:00Z"));
  ok("§1 a July year on 2 Nov 2026 runs 1 Jul 2026 to 30 Jun 2027", fy.start === "2026-07-01" && fy.end === "2027-06-30", fy);
  ok("§1 its label is its dates", fy.label === "Jul 2026 to Jun 2027" && fy.chartLabel === "FY 2026–27", fy.label);
  const td = N.fiscalYear.fiscalYearToDate(july, 0, at("2026-11-02T17:00:00Z"));
  ok("§1 to date stops at the org's today", td.from === "2026-07-01" && td.to === "2026-11-02", td);
  const last = N.fiscalYear.fiscalYearToDate(july, -1, at("2026-11-02T17:00:00Z"));
  ok("§1 last year to date is the whole year", last.from === "2025-07-01" && last.to === "2026-06-30", last);
  // 1 Jul 2026 at 03:30 UTC is still 30 Jun in New York: last year's final day.
  fy = N.fiscalYear.fiscalYear(july, 0, at("2026-07-01T03:30:00Z"));
  ok("§1 midnight UTC on 1 Jul is still the old year in New York", fy.start === "2025-07-01", fy.start);
  fy = N.fiscalYear.fiscalYear(july, 0, at("2026-07-01T03:59:00Z"));   // 30 Jun, 11:59 PM EDT
  ok("§1 the last day of the year at 11 PM ET", fy.start === "2025-07-01" && N.fiscalYear.fiscalYearToDate(july, 0, at("2026-07-01T03:00:00Z")).to === "2026-06-30");
  ok("§1 one minute later (EDT) the new year starts", N.fiscalYear.fiscalYear(july, 0, at("2026-07-01T04:00:00Z")).start === "2026-07-01");
  // DST ends 1 Nov 2026 at 2 AM: 05:30 UTC is 00:30 EST on the 1st, a Sunday in November.
  ok("§1 across the DST change the day is the org's", N.fiscalYear.fiscalYearToDate(oct, 0, at("2026-11-01T04:30:00Z")).to === "2026-11-01"
    && N.fiscalYear.fiscalYearToDate(oct, 0, at("2026-11-01T03:30:00Z")).to === "2026-10-31");
  fy = N.fiscalYear.fiscalYear(jan, 0, at("2026-11-02T17:00:00Z"));
  ok("§1 a January year is the calendar year, named so", fy.start === "2026-01-01" && fy.end === "2026-12-31" && fy.label === "Jan to Dec 2026" && fy.chartLabel === "FY 2026", fy);
  ok("§1 an October year in November starts this October", N.fiscalYear.fiscalYear(oct, 0, at("2026-11-02T17:00:00Z")).start === "2026-10-01");
  ok("§1 the year a date falls in", N.fiscalYear.startYearOf("2026-06-30", 7) === 2025 && N.fiscalYear.startYearOf("2026-07-01", 7) === 2026);
  const FP = await import("../shared/fiscalPeriod.js");
  ok("§1 the short name is fiscalPeriod's", [1, 4, 7, 10].every(sm => N.fiscalYear.yearStarting(2026, sm).chartLabel === FP.fyLabelFromStart(2026, sm)));
  const p = N.fiscalYear.period(july, "fiscal", -1, at("2026-11-02T17:00:00Z"));
  ok("§1 period(): last fiscal year, with the label screens already print", p.start === "2025-07-01" && p.end === "2026-06-30" && p.periodLabel === "Jul 2025 – Jun 2026", p);
  ok("§1 period(): the calendar year", N.fiscalYear.period(july, "calendar", 0, at("2026-11-02T17:00:00Z")).start === "2026-01-01");

  // ── §2 money (pure) ──────────────────────────────────────────────────────
  const M = N.money;
  ok("§2 a soft credit row is not money, whatever its case", !M.isMoney({ type: "  Soft Credit " }) && !M.isMoney({ type: "matching gift credit" }));
  ok("§2 a refund is money but not a gift", M.isMoney({ amount: "-20.00" }) && !M.isGift({ amount: "-20.00" }));
  ok("§2 a sum: $50 + $1,000 soft credit - $20 refund = $30", M.sumCents([{ amount: "50" }, { amount: "1000", type: "Soft credit" }, { amount: "-20" }]) === 3000);

  // ── the fixture: hand-worked rows ───────────────────────────────────────
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,vocabulary_json)
           VALUES ($1,'Numbers home',$2,1,'active','team','America/New_York',$3)`, [ORG, `nh-${SEED}`, JSON.stringify({ fiscal_year_start_month: 7 })]);
  const person = async (key, extra = {}) => {
    const id = `d_${ORG}_${key}`;
    await q(`INSERT INTO donors (id,org_id,name,stage,person_types,imported_total,imported_through,imported_first_gift_date,imported_last_gift_date,imported_last_gift_amount,deleted_at,created_by,created_by_name)
             VALUES ($1,$2,$3,'active','["donor"]'::jsonb,$4,$5,$6,$7,$8,$9,${sys})`,
      [id, ORG, key, extra.impTotal ?? null, extra.impThrough ?? null, extra.impFirst ?? null, extra.impLast ?? null, extra.impLastAmt ?? null, extra.deleted ? "2026-10-01" : null]);
    return id;
  };
  let gn = 0;
  const gift = async (donor, date, amount, more = {}) => {
    const id = `g_${ORG}_${++gn}`;
    await q(`INSERT INTO gifts (id,org_id,donor_id,date,amount,type,payment_method,deposited_on,deposit_ref,import_id,created_at,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,${sys})`,
      [id, ORG, donor, date, amount, more.type ?? null, more.method ?? null, more.depositedOn ?? null, more.ref ?? null, more.importId ?? null, `2026-11-01T12:00:${String(gn).padStart(2, "0")}Z`]);
    return id;
  };
  // A: gave last year and this year; a refund and a $1,000 soft credit row after.
  const A = await person("a");
  await gift(A, "2025-08-01", 100); await gift(A, "2026-08-15", 50);
  await gift(A, "2026-09-01", -20); await gift(A, "2026-09-10", 1000, { type: "Soft credit" });
  // B: the old system says $500 through 31 Dec 2024, first gift 2019; a $40 gift
  // inside that period (already in the $500) and $30 this year.
  const B = await person("b", { impTotal: 500, impThrough: "2024-12-31", impFirst: "2019-03-01", impLast: "2024-12-31", impLastAmt: 200 });
  await gift(B, "2024-06-01", 40); await gift(B, "2026-10-01", 30);
  // C: deleted. Her $999 counts toward nothing.
  const C = await person("c", { deleted: true }); await gift(C, "2026-09-01", 999);
  // E: one gift dated in January: not money received yet.
  const E = await person("e"); await gift(E, "2027-01-10", 70);
  // F: gave last year; this year only a refund of it.
  const F = await person("f"); await gift(F, "2025-09-01", 10); await gift(F, "2026-08-01", -10);
  // D: the deposits. A check the bank has (deposited 21 Oct), cash on a deposit
  // run, a check on nothing, a card gift (not banked), and an undone run.
  const D = await person("d");
  const RUN = `imp_${SEED}`, UNDONE = `imp_${SEED}_x`;
  await q(`INSERT INTO imports (id,org_id,name,shape,actor_user_id,actor_user_name) VALUES ($1,$3,'Deposit','deposit','system:test','test'), ($2,$3,'Deposit','deposit','system:test','test')`, [RUN, UNDONE, ORG]);
  await q(`UPDATE imports SET reversed_at = '2026-10-30' WHERE id = $1`, [UNDONE]);
  const gChk = await gift(D, "2026-10-20", 10, { method: "Check", depositedOn: "2026-10-21" });
  const gCash = await gift(D, "2026-10-25", 15, { method: "cash", importId: RUN });
  const gOpen = await gift(D, "2026-10-28", 20, { method: "check" });
  const gCard = await gift(D, "2026-10-28", 25, { method: "card" });
  const gUndone = await gift(D, "2026-10-29", 5, { method: "ACH", importId: UNDONE });

  // ── §3 lifetime ──────────────────────────────────────────────────────────
  const lt = await N.lifetime.lifetimeCents(query, ORG, [A, B, E, F]);
  ok("§3 A: $100 + $50 - $20 = $130 (the soft credit row is not money)", lt.get(A) === 13000, lt.get(A));
  ok("§3 B: $500 imported + $30 after it = $530 (the $40 inside it is not added again)", lt.get(B) === 53000, lt.get(B));
  ok("§3 F: $10 - $10 = $0", lt.get(F) === 0, lt.get(F));

  // ── §4 givingBetween ─────────────────────────────────────────────────────
  const g = await N.givingBetween.givingBetween(query, ORG, { from: "2026-07-01", to: "2027-06-30", today: TODAY });
  // A 50 - 20, B 30, F -10, D 10 + 15 + 20 + 25 + 5 = 75; not C (deleted), E (January), the soft credit.
  ok("§4 this fiscal year to date: $125.00, cut at today", g.cents === 12500 && g.to === TODAY, g);
  ok("§4 its gifts: 7 above zero (refunds are not gifts)", g.gifts === 7, g.gifts);
  ok("§4 one person's span", (await N.givingBetween.givingBetween(query, ORG, { from: "2026-07-01", to: TODAY, today: TODAY, donorId: A })).cents === 3000);
  ok("§4 a span that has not started is nothing", (await N.givingBetween.givingBetween(query, ORG, { from: "2026-12-01", to: "2026-12-31", today: TODAY })).cents === 0);

  // ── §5 lastGift ──────────────────────────────────────────────────────────
  const lg = await N.lastGift.lastGifts(query, ORG, [A, B, F]);
  ok("§5 A's last gift is 15 Aug $50, not the refund or the credit row after it", lg.get(A) && lg.get(A).date === "2026-08-15" && lg.get(A).cents === 5000, lg.get(A));
  ok("§5 B's last gift is the $30 on file, after the imported one", lg.get(B) && lg.get(B).date === "2026-10-01" && lg.get(B).cents === 3000, lg.get(B));
  ok("§5 F's last gift is the $10 before the refund", lg.get(F) && lg.get(F).date === "2025-09-01", lg.get(F));
  ok("§5 the same rule over rows already read", N.lastGift.lastOf([{ date: "2026-08-15", amount: 50 }, { date: "2026-09-01", amount: -20 }, { date: "2026-09-10", amount: 1000, type: "soft credit" }]).date === "2026-08-15");
  const [lsql] = await query(`SELECT ${N.lastGift.LAST_DATE("d")} AS d FROM donors d WHERE d.id = ?`, [B]);
  ok("§5 LAST_DATE in SQL agrees", String(lsql.d).slice(0, 10) === "2026-10-01", lsql);

  // ── §6 firstGift ─────────────────────────────────────────────────────────
  const fg = await N.firstGift.firstDates(query, ORG, [A, B, D]);
  ok("§6 A's first gift is 1 Aug 2025", fg.get(A) === "2025-08-01", fg.get(A));
  ok("§6 B's first gift is the old system's, 1 Mar 2019", fg.get(B) === "2019-03-01", fg.get(B));
  const fy26 = { from: "2026-07-01", to: "2027-06-30" };
  ok("§6 first-time this fiscal year: D only of A, B, D", [A, B, D].filter(id => N.firstGift.isFirstTimeIn(fg.get(id), fy26)).join() === D);
  ok("§6 the same rule over rows", N.firstGift.firstOf([{ date: "2026-10-01", amount: 30 }], "2019-03-01") === "2019-03-01");

  // ── §7 retained ──────────────────────────────────────────────────────────
  const fy25 = { from: "2025-07-01", to: "2026-06-30" };
  const r = await N.retained.retention(query, ORG, fy26, fy25);
  ok("§7 last year's givers are A and F; A gave again, F only had a refund: 1 of 2", r.retained === 1 && r.prior === 2 && r.rate === 0.5, r);
  ok("§7 the same rule over rows", N.retained.retainedIds([
    { person: "a", date: "2025-08-01", amount: 100 }, { person: "a", date: "2026-08-15", amount: 50 },
    { person: "f", date: "2025-09-01", amount: 10 }, { person: "f", date: "2026-08-01", amount: -10 }], fy26, fy25).join() === "a");

  // ── §8 deposited ─────────────────────────────────────────────────────────
  const DP = N.deposited;
  const rows = await query(`SELECT g.id, ${DP.DEPOSITED("g")} AS dep, ${DP.BANKED("g")} AS banked, ${DP.DEPOSIT_NAME("g")} AS name
                              FROM gifts g WHERE g.org_id = ? AND g.donor_id = ?`, [ORG, D]);
  const by = Object.fromEntries(rows.map(x => [x.id, x]));
  ok("§8 a check with its deposited day is deposited, named by the day", by[gChk].dep && by[gChk].name === "deposited 2026-10-21", by[gChk]);
  ok("§8 cash on a deposit run is deposited, named by the run", by[gCash].dep && by[gCash].name === `deposit run ${RUN}`, by[gCash]);
  ok("§8 a check on nothing is not deposited and has no name", !by[gOpen].dep && by[gOpen].name === "", by[gOpen]);
  const lab = Object.fromEntries((await query(`SELECT g.id, ${DP.DEPOSIT_LABEL("g")} AS l FROM gifts g WHERE g.org_id = ? AND g.donor_id = ?`, [ORG, D])).map(x => [x.id, x.l]));
  ok("§8 the Deposit column names the run, and leaves a day-only deposit to its own column", lab[gCash] === "Deposit run: Deposit" && lab[gChk] === "" && lab[gOpen] === "", lab);
  ok("§8 an undone run holds nothing", !by[gUndone].dep && by[gUndone].banked, by[gUndone]);
  ok("§8 a card gift is not banked money; ACH, a check and cash are", !by[gCard].banked && by[gChk].banked && by[gCash].banked);
  const [nd] = await query(`SELECT COUNT(*)::int AS n FROM gifts g WHERE g.org_id = ? AND ${DP.BANKED("g")} AND ${DP.NOT_DEPOSITED("g")}`, [ORG]);
  ok("§8 NOT_DEPOSITED is the rest: the open check and the undone ACH", nd.n === 2, nd);
  await q(`UPDATE gifts SET deposit_ref = 'po_123' WHERE id = $1`, [gChk]);
  ok("§8 a named deposit keeps its name", (await query(`SELECT ${DP.DEPOSIT_NAME("g")} AS n FROM gifts g WHERE id = ?`, [gChk]))[0].n === "po_123");
  ok("§8 the same rules over a row", DP.isDeposited({ deposited_on: "2026-10-21" }) && !DP.isDeposited({ deposit_ref: "" }) && DP.depositName({ deposited_on: "2026-10-21" }) === "deposited 2026-10-21");

  // ── §9 donorTotals: one core, many faces ─────────────────────────────────
  const org = { id: ORG, timezone: "America/New_York", vocabulary_json: { fiscal_year_start_month: 7 } };
  const T = await N.donorTotals.donorTotals(query, org, [A, B], { byYear: true });
  ok("§9 A and B together: lifetime $130 + $530 = $660", T.lifetime === 660, T);
  ok("§9 their first gift is B's imported 2019 one; their last is B's 1 Oct", T.first === "2019-03-01" && T.last === "2026-10-01", T);
  ok("§9 gifts above zero on file: A 2, B 2", T.gifts === 4, T.gifts);
  ok("§9 by calendar year, money only: 2026 is $50 - $20 + $30 = $60", (T.byYear.find(y => y.year === "2026") || {}).total === 60, T.byYear);
  const byOrg = await N.donorTotals.totalsByOrg(query, [{ org_id: ORG, donor_id: A }, { org_id: ORG, donor_id: C }]);
  ok("§9 by org: a deleted person is in nothing", byOrg.get(ORG) && byOrg.get(ORG).lifetime === 130, byOrg.get(ORG));

  for (const t of ["gifts", "imports", "donors"]) await q(`DELETE FROM ${t} WHERE org_id = $1`, [ORG]);
  await q(`DELETE FROM orgs WHERE id = $1`, [ORG]);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
