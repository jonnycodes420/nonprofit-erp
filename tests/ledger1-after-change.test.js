// tests/ledger1-after-change.test.js: LEDGER-1. AFTER ANY CHANGE, EVERY MONEY
// FIGURE AGREES WITH THE GIFTS. Guards money and donor data. TRUTH-1 proved
// the numbers agree on a freshly loaded org; a walk on 4 Nov found they stop
// agreeing once somebody changes something. Into one fresh org, the
// real-shaped gift file (tests/fixtures/import/real-shaped/, every name made
// up), a July fiscal year, then each change the walk made, and after each one
// the truth check with its LEDGER-1 after-change pass (ctx.people: every
// figure of every person the change touched, against the key's own rows).
//   §1 a $100 gift, then deleted: lifetime, this fiscal year (header and
//      rail), Fundraising's year and all-time and their counts, the fund and
//      the thank-you queue each go up by $100 and come back to the cent; its
//      thank-you is gone. Edited $100 → $150: every figure moves by $50 and
//      the thank-you, its row and its text, says $150.
//   §2 a two-check deposit ($100 + $50, two people): two gifts, each its own
//      row, person and amount; the year +$150, the count +2. Tell Steward's
//      read keeps two equal amounts as two, a sentence with two amounts as
//      two, each with its giver.
//   §3 SYBUNT: a person whose last gifts were in an earlier fiscal year
//      (FY start − 14 and − 19 months) is listed with what they gave in that
//      fiscal year, never $0; every row is the key's last-fiscal-year sum;
//      LYBUNT's rows are last year's.
//   §4 a $1,200 pledge, one $1,200 installment past due, a $300 payment:
//      $900 still to come, due this year and overdue, on the totals, the row
//      and the profile. Home's annual goal is Fundraising's: an umbrella goal
//      whose gift sits on its child goal raises it on both.
//   §5 a soft credit on the gift form moves nobody's Lifetime but the giver's
//      own money; the giver's gift says "Soft credit to …"; the credited
//      person's soft-credit line has it. Tell Steward never offers one as a gift.
// HOW IT GOES RED ON MAIN: the edited gift's thank-you text says $100 (§1); the
// SYBUNT person is listed at $0 (§3); Due and Overdue say $1,200 beside a
// $900 row (§4); Home's annual goal raised $0 (§4); Tell Steward drops the
// second $100 and the $50, and records the soft credit as a gift (§2, §5).
// PLANTED: skip the ledger stamp's delete in DELETE /gifts/:id and §1 goes red
// ("the fund ledger holds $100.00 for gift …, which no longer exists"); make
// givingBetween.yearsBefore step calendar years and §3 goes red ($18,394, not
// $18,894). Standard scratch stack (tests/README.md). Tests set their own
// clock (tests/clock.js). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");
const { orgRows } = require("./keys/fromDb");
const { fiscalYear, isCreditType } = require("./keys/truthKey");

const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import", "real-shaped");
const ORG = "org_ldg1after";
const PASSWORD = "loadtest1234";
const C = v => Math.round(Number(v || 0) * 100);
const TODAY = civilDay(undefined, "America/New_York");

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,vocabulary_json)
           VALUES ($1,$2,$3,1,'active','team','America/New_York','{"fiscal_year_start_month":7}')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
async function importGiftFile(tok) {
  const R = await import("../shared/sheetRead.js");
  const sheets = R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(FX, "jp-gift-history-287.xlsx")), { type: "buffer", cellDates: true }), XLSX);
  const body = { fileName: "jp-gift-history-287.xlsx", sheets };
  await api("POST", "/sheet-import/understand", tok, body);
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  for (let i = 0; i < 600; i++) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return j.body.status;
    await new Promise(s => setTimeout(s, 200));
  }
  return "timeout";
}
// The truth check, with the after-change pass for the people a change touched.
async function agree(step, people) {
  const r = await assertSurfacesAgree(ORG, { soft: true, label: step, people, skip: ["atlas", "ask"] });
  ok(`${step}: every surface agrees, and every figure of the ${people.length === 1 ? "person" : `${people.length} people`} it touched`, r.ok, r.diffs.slice(0, 8).join("\n        "));
}
// Every figure §1 moves, for one person, in cents.
async function figures(tok, donorId) {
  const [rec, rel, rail, fr, fin, ty] = await Promise.all([
    api("GET", `/donors/${donorId}`, tok), api("GET", `/donors/${donorId}/relationship`, tok), api("GET", `/donors/${donorId}/rail`, tok),
    api("GET", "/fundraising/overview", tok), api("GET", "/finance/funds-detail", tok), api("GET", "/thank-yous", tok)]);
  const fund = ((fin.body && fin.body.funds) || []).find(f => f.name === "General Operating") || {};
  const mine = ((ty.body && ty.body.drafts) || []).filter(d => d.donorId === donorId);
  return {
    lifetime: Number(rec.body.figures.lifetime.cents), header: Number(rec.body.figures.thisYear.cents), rail: C(rel.body.thisYear && rel.body.thisYear.given && rel.body.thisYear.given.value),
    year: C(fr.body.period.raised), yearCount: fr.body.period.giftCount, allTime: C(fr.body.allTime.raised), allCount: fr.body.allTime.giftCount,
    fund: Number(fund.balanceCents || 0), thanks: mine.length, railThanks: ((rail.body && rail.body.thankYous) || []).length,
  };
}
const moved = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, b[k] - a[k]]));

async function main() {
  const tok = await freshOrg(ORG, "Ledger after-change (test)");
  ok("the gift file goes in", (await importGiftFile(tok)) === "done");
  const [general] = await q(`SELECT id FROM fin_funds WHERE org_id=$1 AND name='General Operating'`, [ORG]);
  const people = await q(`SELECT id, name FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY total_giving DESC, id LIMIT 8`, [ORG]);
  const [P, Q1, Q2, S3, P4, P5] = people;

  // ── §1 delete, then edit ────────────────────────────────────────────────
  const f0 = await figures(tok, P.id);
  const add = await api("POST", `/donors/${P.id}/gifts`, tok, { amount: 100, date: TODAY, type: "cash", payment_method: "check", fund_id: general.id });
  ok("§1 a $100 gift is recorded", add.status === 201, add.status);
  const G = add.body.gift.id;
  const f1 = await figures(tok, P.id);
  const up = moved(f0, f1);
  ok("§1 the $100 moves every figure by $100 and each count by one", up.lifetime === 10000 && up.header === 10000 && up.rail === 10000 && up.year === 10000
     && up.allTime === 10000 && up.fund === 10000 && up.yearCount === 1 && up.allCount === 1 && up.thanks === 1 && up.railThanks === 1, JSON.stringify(up));
  await agree("§1 after the $100 gift", [P.id]);
  const del = await api("DELETE", `/gifts/${G}`, tok);
  ok("§1 the gift is deleted", del.status === 200, del.status);
  const f2 = await figures(tok, P.id);
  ok("§1 deleting it puts every figure back to the cent, its thank-you gone from the queue and the rail", JSON.stringify(f2) === JSON.stringify(f0), JSON.stringify(moved(f0, f2)));
  await agree("§1 after the delete", [P.id]);

  const add2 = await api("POST", `/donors/${P.id}/gifts`, tok, { amount: 100, date: TODAY, type: "cash", payment_method: "check", fund_id: general.id });
  const G2 = add2.body.gift.id;
  const f3 = await figures(tok, P.id);
  const ed = await api("PUT", `/gifts/${G2}`, tok, { amount: 150 });
  ok("§1 the gift is edited to $150", ed.status === 200 && C(ed.body.amount) === 15000, ed.status);
  const f4 = await figures(tok, P.id);
  const by = moved(f3, f4);
  ok("§1 the edit moves every figure by $50, no count", by.lifetime === 5000 && by.header === 5000 && by.rail === 5000 && by.year === 5000 && by.allTime === 5000
     && by.fund === 5000 && by.yearCount === 0 && by.allCount === 0 && by.thanks === 0, JSON.stringify(by));
  const draft = (((await api("GET", "/thank-yous", tok)).body.drafts) || []).find(d => d.giftId === G2) || {};
  const railTy = (((await api("GET", `/donors/${P.id}/rail`, tok)).body.thankYous) || []).find(t => t.giftId === G2) || {};
  ok("§1 the thank-you says $150: its row, the rail and its text", C(draft.amount) === 15000 && C(railTy.amount) === 15000 && /\$150\b/.test(draft.body || "") && !/\$100\b/.test(draft.body || ""),
     JSON.stringify({ amount: draft.amount, rail: railTy.amount, body: String(draft.body || "").slice(0, 160) }));
  await agree("§1 after the edit", [P.id]);

  // ── §2 a deposit of two checks ──────────────────────────────────────────
  const d0 = (await api("GET", "/fundraising/overview", tok)).body.period;
  const paste = `${Q1.name}\t100.00\t1042\n${Q2.name}\t50.00\t1043`;
  const resolutions = { 1: { fundId: general.id }, 2: { fundId: general.id } };
  const dep = await api("POST", "/deposits/commit", tok, { paste, depositDate: TODAY, slipTotal: 150, resolutions, lines: [] });
  ok("§2 the two-check deposit is recorded", dep.status === 201 && dep.body.gifts === 2, dep.status + " " + JSON.stringify(dep.body).slice(0, 200));
  const rows = await q(`SELECT donor_id, ROUND(amount*100)::int AS c FROM gifts WHERE org_id=$1 AND import_id=$2 ORDER BY c DESC`, [ORG, dep.body.id]);
  ok("§2 two gifts, each its own row, person and amount", rows.length === 2 && rows[0].donor_id === Q1.id && rows[0].c === 10000 && rows[1].donor_id === Q2.id && rows[1].c === 5000, JSON.stringify(rows));
  const d1 = (await api("GET", "/fundraising/overview", tok)).body.period;
  ok("§2 the year moves by $150 and its count by 2", C(d1.raised) - C(d0.raised) === 15000 && d1.giftCount - d0.giftCount === 2, `${d0.raised}→${d1.raised}, ${d0.giftCount}→${d1.giftCount}`);
  await agree("§2 after the deposit", [Q1.id, Q2.id]);

  // Tell Steward's read: two equal checks are two gifts, two amounts in one
  // sentence are two, each with the giver she named; a soft credit is no gift.
  const V = await import("../shared/voiceMemo.js");
  const memo = "Deposited three checks today: a $100 check from Ada Pellow and a $100 check from Ben Orrin, and Ben's second check of $50. Soft credit $200 to Cleo Varn for bringing them in.";
  const read = V.normalizeMemo({ money: [
    { kind: "gift", quote: "a $100 check from Ada Pellow", amount: "$100", from: "Ada Pellow" },
    { kind: "gift", quote: "a $100 check from Ben Orrin", amount: "$100", from: "Ben Orrin" },
    { kind: "gift", quote: "a $100 check from Ben Orrin, and Ben's second check of $50", amount: "$50", from: "Ben Orrin" },
    { kind: "gift", quote: "Soft credit $200 to Cleo Varn", amount: "$200", credit_to: "Cleo Varn" },
  ] }, memo, { today: TODAY });
  const mm = read.money.map(m => `${m.from}:${m.cents}`);
  ok("§2 Tell Steward keeps both $100 checks and the $50, each with its giver", JSON.stringify(mm) === JSON.stringify(["Ada Pellow:10000", "Ben Orrin:10000", "Ben Orrin:5000"]), JSON.stringify(mm));
  ok("§5 Tell Steward never offers a soft credit as a gift: it is a follow-up for the gift form", !read.money.some(m => m.cents === 20000)
     && read.followUps.some(f => /soft credit to Cleo Varn on the gift form/.test(f.label)), JSON.stringify(read.followUps));

  // ── §3 SYBUNT and LYBUNT ────────────────────────────────────────────────
  const fy = fiscalYear(TODAY, 7);
  const back = months => { const [y, m] = fy.from.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 - months, 10)); return t.toISOString().slice(0, 10); };
  const mk = await api("POST", "/donors", tok, { name: "Wrenna Testfield", email: "wrenna.testfield@example.org" });
  const S = (mk.body && (mk.body.id || (mk.body.donor && mk.body.donor.id)));
  ok("§3 a person who gave in an earlier fiscal year", !!S, mk.status);
  await api("POST", `/donors/${S}/gifts`, tok, { amount: 18394, date: back(14), type: "cash" });
  await api("POST", `/donors/${S}/gifts`, tok, { amount: 500, date: back(19), type: "cash" });
  const sy = await api("GET", "/reports/sybunt", tok);
  const row = ((sy.body && sy.body.rows) || []).find(r => r.id === S);
  // The key, by hand: the fiscal year of the last money gift before this one, and its sum.
  const kr = await orgRows(q, ORG);
  const live = new Set(kr.rows.people.filter(p => !p.deleted && !p.sample).map(p => p.id));
  const hard = kr.rows.gifts.filter(g => !isCreditType(g.type) && live.has(g.person) && g.date);
  const lastFySum = id => {
    const before = hard.filter(g => g.person === id && g.cents > 0 && String(g.date).slice(0, 10) < fy.from).map(g => String(g.date).slice(0, 10)).sort();
    if (!before.length) return null;
    const y = fiscalYear(before[before.length - 1], 7);
    return hard.filter(g => g.person === id && String(g.date).slice(0, 10) >= y.from && String(g.date).slice(0, 10) <= y.to).reduce((a, g) => a + g.cents, 0);
  };
  ok("§3 SYBUNT lists them with what they gave in their last fiscal year ($18,894), never $0", row && C(row.priorYearTotal) === 1889400, JSON.stringify(row || null));
  const syRows = (sy.body && sy.body.rows) || [];
  const offRows = syRows.filter(r => C(r.priorYearTotal) !== lastFySum(r.id));
  ok(`§3 every one of SYBUNT's ${syRows.length} rows is the key's last-fiscal-year sum`, syRows.length > 0 && offRows.length === 0,
     offRows.slice(0, 4).map(r => `${r.name}: ${r.priorYearTotal} vs ${lastFySum(r.id) / 100}`).join("; "));
  ok("§3 nobody on SYBUNT is listed at $0", syRows.every(r => C(r.priorYearTotal) !== 0), syRows.filter(r => C(r.priorYearTotal) === 0).map(r => r.name).slice(0, 5).join(", "));
  const lastFy = fiscalYear(TODAY, 7, -1);
  const ly = (((await api("GET", "/reports/lybunt", tok)).body || {}).rows) || [];
  const lyOff = ly.filter(r => C(r.priorYearTotal) !== hard.filter(g => g.person === r.id && String(g.date).slice(0, 10) >= lastFy.from && String(g.date).slice(0, 10) <= lastFy.to).reduce((a, g) => a + g.cents, 0));
  ok(`§3 LYBUNT's ${ly.length} rows are each last fiscal year's giving`, lyOff.length === 0, lyOff.slice(0, 3).map(r => r.name).join(", "));

  // ── §4 a pledge part-paid, and the goal ─────────────────────────────────
  const pl = await api("POST", `/donors/${P4.id}/pledges`, tok, { amount: 1200, dueDate: dayOffset(-20) });
  const PL = (pl.body && (pl.body.id || (pl.body.pledge && pl.body.pledge.id)));
  ok("§4 a $1,200 pledge", !!PL, pl.status + " " + JSON.stringify(pl.body).slice(0, 160));
  const [hasInst] = await q(`SELECT COUNT(*)::int AS n FROM pledge_installments WHERE org_id=$1 AND pledge_id=$2`, [ORG, PL]);
  if (!hasInst.n) await q(`INSERT INTO pledge_installments (id, org_id, pledge_id, seq, due_date, amount) VALUES ($1,$2,$3,1,$4,1200)`, ["pi_ldg1_" + PL.slice(-8), ORG, PL, dayOffset(-20)]);
  const pay = await api("POST", `/donors/${P4.id}/gifts`, tok, { amount: 300, date: TODAY, type: "cash", pledgeId: PL });
  ok("§4 a $300 payment on it", pay.status === 201, pay.status);
  const fp = (await api("GET", "/fundraising/pledges", tok)).body || {};
  const prow = (fp.pledges || []).find(p => p.id === PL) || {};
  const prof = ((await api("GET", `/donors/${P4.id}/pledges`, tok)).body || []).find(p => p.id === PL) || {};
  const nine = [fp.open, fp.dueThisYear, fp.overdue, prow.balance, prow.dueThisYear, prow.overdue, prof.balance, prof.dueThisYear];
  ok("§4 $900 everywhere: still to come, due this year and overdue, on the totals, the row and the profile", nine.every(v => C(v) === 90000), JSON.stringify(nine));
  ok("§4 the installment says $900 left on it, overdue", (prow.installments || []).length === 1 && C(prow.installments[0].left) === 90000 && prow.installments[0].overdue === true, JSON.stringify(prow.installments));

  const umb = "c_ldg1_annual", kid = "c_ldg1_kid";
  await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,start_date,end_date,parent_goal_id,status,goal_category) VALUES ($1,$2,'Annual Fund (test)',180000,$3,$4,NULL,'active','annual')`, [umb, ORG, dayOffset(-60), dayOffset(200)]);
  await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,start_date,end_date,parent_goal_id,status) VALUES ($1,$2,'Scholarships (test)',15000,$3,$4,$5,'active')`, [kid, ORG, dayOffset(-60), dayOffset(200), umb]);
  await api("POST", `/donors/${P5.id}/gifts`, tok, { amount: 500, date: TODAY, type: "cash", campaignId: kid });
  const home = ((await api("GET", "/home/annual-goal", tok)).body || {}).goal || {};
  const port = (await api("GET", "/fundraising/goals", tok)).body || {};
  const umbRow = (port.goals || []).find(c => c.id === umb) || {};
  const homeGoal = (home.also || []).find(a => a.key === "goal") || {};
  ok("§4 Home's annual goal is Fundraising's: the same goal, raised and target", home.id === umb && C(home.value) === 50000 && C(umbRow.rolledRaised) === 50000 && C(homeGoal.value) === 18000000,
     JSON.stringify({ home: [home.id, home.value, homeGoal.value], fr: [umbRow.id, umbRow.rolledRaised, umbRow.goalAmount] }));
  await agree("§4 after the pledge payment and the goal gift", [P4.id, P5.id]);

  // ── §5 soft credit on the gift form ─────────────────────────────────────
  const [giver, credited] = [S3, people[6]];
  const g0 = (await api("GET", `/donors/${giver.id}`, tok)).body, c0 = (await api("GET", `/donors/${credited.id}`, tok)).body;
  const sc = await api("POST", `/donors/${giver.id}/gifts`, tok, { amount: 200, date: TODAY, type: "cash", softCredits: [{ donorId: credited.id, role: "recommender" }] });
  ok("§5 a $200 gift with a soft credit is recorded", sc.status === 201, sc.status + " " + JSON.stringify(sc.body).slice(0, 160));
  const g1 = (await api("GET", `/donors/${giver.id}`, tok)).body, c1 = (await api("GET", `/donors/${credited.id}`, tok)).body;
  ok("§5 the giver's Lifetime moves by their own $200; the credited person's Lifetime and year do not move",
     Number(g1.figures.lifetime.cents) - Number(g0.figures.lifetime.cents) === 20000 && Number(c1.figures.lifetime.cents) === Number(c0.figures.lifetime.cents)
     && Number(c1.figures.thisYear.cents) === Number(c0.figures.thisYear.cents), JSON.stringify([g0.figures.lifetime.cents, g1.figures.lifetime.cents, c0.figures.lifetime.cents, c1.figures.lifetime.cents]));
  const row5 = (g1.gifts || []).find(x => x.id === sc.body.gift.id) || {};
  ok("§5 the giver's gift says who it is soft-credited to", (row5.soft_credit_to || []).some(x => x.donorId === credited.id), JSON.stringify(row5.soft_credit_to));
  const csc = (await api("GET", `/donors/${credited.id}/soft-credit`, tok)).body || {};
  ok("§5 the credited person's soft-credit line has it, on its own", (csc.giftSoftCredits || []).some(x => (x.giftId || x.gift_id) === sc.body.gift.id), JSON.stringify(csc.giftSoftCredits || csc).slice(0, 200));
  await agree("§5 after the soft credit", [giver.id, credited.id]);

  await closeDb();
  summary();
}
main().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
