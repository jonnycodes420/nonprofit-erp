// tests/ledger2-money-figures.test.js: LEDGER-2. THE FISCAL YEAR NEVER FLIPS,
// SPLITS ADD UP, GOALS RECONCILE, AWARDS BOOK, LINKS COUNT. Guards money and
// donor data. Into one fresh org (July fiscal year, New York), the real-shaped
// gift file (tests/fixtures/import/real-shaped/, every name made up), then:
//   §1 one fiscal year: at 11:30 PM Eastern on 30 June 2027 (UTC is already
//      1 July) the server's year, the shared fiscal year, the chip labels and
//      the board's year are all FY 2026–27; Reports names its years only from
//      the server (reportYearsFrom is null until it answers; no browser clock
//      in Reports.jsx); the giving summary sends both years, and they are the
//      years Fundraising and the dashboard name.
//   §2 the split: three people with gifts on General Operating, Gala Reserve
//      (unrestricted), a restricted fund and no fund: Restricted +
//      Unrestricted = Lifetime to the cent, percents add to 100, Gala
//      Reserve is listed, the no-fund money is Unrestricted.
//   §3 goal pace equals its stated arithmetic; an officer's portfolio is the
//      sum of their donors' Lifetime, and a stale stored total does not move it.
//   §4 an award books as an ordinary pledge does: nothing on the ledger. A
//      $15,000 award, then a $10,000 payment recorded on it (GIFTS-1's Record
//      a payment received): Finance income grows by $10,000, never $25,000;
//      the grant shows $5,000 remaining; moving it Reporting → Awarded on the
//      edit books nothing either.
//   §5 a person marked Lapsed with no move (as an import writes it), linked
//      "gives through" a business that gives today, is not Lapsed on the tag,
//      Re-engage or Home; "Donor since" is the first gift's year.
// HOW IT GOES RED ON MAIN: no calendarYear / reportYearsFrom and a browser
// clock in Reports (§1); General Operating and Gala Reserve gifts in neither
// bucket (§2); no paceMath, and the portfolio reads the stored total (§3); the
// edit's move into Awarded stamps the full award as income (§4); the person stays
// Lapsed, and "Donor since" reads the stored first gift date (§5).
// PLANTED: fiscalYear.fiscalYear reading the UTC date (§1 red); the split
// dropping no-fund gifts (§2 red). Standard scratch stack (tests/README.md).
// Tests set their own clock (tests/clock.js). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import", "real-shaped");
const ORG = "org_ldg2money";
const PASSWORD = "loadtest1234";
const C = v => Math.round(Number(v || 0) * 100);
const TODAY = civilDay(undefined, "America/New_York");
const NY = { timezone: "America/New_York", vocabulary_json: '{"fiscal_year_start_month":7}' };

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
async function person(name, extra = {}) {
  const id = "d_ldg2_" + Math.random().toString(16).slice(2, 12);
  await q(`INSERT INTO donors (id,org_id,name,kind,stage,assigned_to,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,'system:test','Test')`,
    [id, ORG, name, extra.kind || "individual", extra.stage || null, extra.assignedTo || null]);
  return id;
}
const gift = (tok, id, amount, date, fundId) => api("POST", `/donors/${id}/gifts`, tok, { amount, date, type: "cash", payment_method: "check", ...(fundId ? { fund_id: fundId } : {}) });

async function main() {
  const tok = await freshOrg(ORG, "Ledger money figures (test)");
  ok("the gift file goes in", (await importGiftFile(tok)) === "done");

  // ── §1 one fiscal year ──────────────────────────────────────────────────
  {
    const FY = require("../shared/numbers/fiscalYear");
    const orgTime = require("../orgTime");
    const FP = await import("../shared/fiscalPeriod.js");
    const at = new Date("2027-07-01T03:30:00Z");   // 11:30 PM Eastern, 30 June 2027
    const fy = FY.fiscalYear(NY, 0, at), endYear = orgTime.orgReportYear(NY, "fiscal", at);
    const years = FP.reportYearsFrom && FP.reportYearsFrom({ fiscalYear: endYear, calendarYear: orgTime.orgReportYear(NY, "calendar", at) });
    const chip = years ? FP.periodChipLabel("thisFY", { fy: years.fy, cy: years.cy, fiscalStartMonth: 7 }) : null;
    const board = FY.period(NY, "fiscal", 0, at).periodLabel;
    ok("§1 at 11:30 PM Eastern on the last day of the year, every FY is FY 2026–27 (the shared year, the report year, the chip, the board)",
       fy.chartLabel === "FY 2026–27" && endYear === 2027 && chip === "This FY · 2026–27" && board === "Jul 2026 – Jun 2027",
       JSON.stringify({ fy: fy.chartLabel, endYear, chip, board }));
    const JAN = { timezone: "America/New_York", vocabulary_json: '{"fiscal_year_start_month":1}' };
    const janYear = orgTime.orgReportYear(JAN, "fiscal", at);
    ok("§1 a calendar-year org: the chip names the year its money is in (FY 2027 at 11:30 PM Eastern on 30 June 2027)",
       FP.periodChipLabel("thisFY", { fy: janYear, cy: 2027, fiscalStartMonth: 1 }) === "This FY · 2027" && FY.fiscalYear(JAN, 0, at).chartLabel === "FY 2027",
       JSON.stringify({ janYear, chip: FP.periodChipLabel("thisFY", { fy: janYear, cy: 2027, fiscalStartMonth: 1 }) }));
    ok("§1 Reports names no year until the server has: reportYearsFrom is null without both years",
       !!FP.reportYearsFrom && FP.reportYearsFrom({}) === null && FP.reportYearsFrom({ fiscalYear: 2027 }) === null);
    const src = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "Reports.jsx"), "utf8");
    ok("§1 Reports never reads the browser's year (no getFullYear, no serverFy || fallback)", !/getFullYear\s*\(/.test(src) && !/serverFy\s*\|\|/.test(src));
    const gs = (await api("GET", "/reports/giving-summary?yearMode=fiscal", tok)).body || {};
    const now = new Date(require("./clock").testNow());
    const fr = (await api("GET", "/fundraising/overview", tok)).body || {};
    const want = FY.fiscalYear(NY, 0, now);
    ok("§1 the giving summary sends this fiscal and calendar year, on the org's calendar, the year Fundraising names",
       gs.fiscalYear === want.startYear + 1 && gs.calendarYear === Number(TODAY.slice(0, 4))
       && JSON.stringify(fr).includes(FP.fyLabelFromStart(want.startYear, 7)),
       JSON.stringify({ fiscalYear: gs.fiscalYear, calendarYear: gs.calendarYear, want: want.chartLabel, fr: JSON.stringify(fr).match(/FY 20\d\d[^"]{0,4}/g) }));
  }

  // ── §2 the split adds up ────────────────────────────────────────────────
  const [general] = await q(`SELECT id FROM fin_funds WHERE org_id=$1 AND name='General Operating'`, [ORG]);
  const gala = "ff_ldg2gala", scholar = "ff_ldg2schol";
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'Gala Reserve',false),($3,$2,'Scholarship Fund (test)',true)`, [gala, ORG, scholar]);
  const people = await q(`SELECT id, name FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY total_giving DESC, id LIMIT 3`, [ORG]);
  for (const [i, p] of people.entries()) {
    await gift(tok, p.id, 1733 + i, dayOffset(-10), general && general.id);
    await gift(tok, p.id, 5000, dayOffset(-9), gala);
    await gift(tok, p.id, 3000, dayOffset(-8), scholar);
    const nf = await gift(tok, p.id, 250, dayOffset(-7));
    // A gift with no fund, as the bulk writers leave it (the gift form fills General Operating).
    await q(`UPDATE gifts SET fund_id=NULL WHERE org_id=$1 AND id=$2`, [ORG, nf.body.gift.id]);
  }
  for (const p of people) {
    const fa = (await api("GET", `/donors/${p.id}/fund-affinity`, tok)).body || {};
    const life = Number(((await api("GET", `/donors/${p.id}`, tok)).body.figures || {}).lifetime?.cents);
    const pct = (fa.affinity || []).reduce((s, f) => s + Number(f.pct || 0), 0);
    ok(`§2 ${p.name}: Restricted + Unrestricted = Lifetime to the cent, percents add to 100, Gala Reserve is listed, General Operating is unrestricted`,
       C(fa.restrictedTotal) + C(fa.unrestrictedTotal) === life && C(fa.totalGiving) === life
       && Number(fa.restrictedPct) + Number(fa.unrestrictedPct) === 100 && pct === 100
       && (fa.affinity || []).some(f => f.fundName === "Gala Reserve" && C(f.total) === 500000 && !f.restricted)
       && C(fa.restrictedTotal) === 300000 && (fa.affinity || []).some(f => !f.fundId && C(f.total) >= 25000 && !f.restricted),
       JSON.stringify({ r: fa.restrictedTotal, u: fa.unrestrictedTotal, life, rp: fa.restrictedPct, up: fa.unrestrictedPct, pct, funds: (fa.affinity || []).map(f => [f.fundName, f.total]) }));
  }

  const tk = await assertSurfacesAgree(ORG, { soft: true, label: "§2 after the fund gifts", people: people.map(p => p.id), skip: ["atlas", "ask"] });
  ok("§2 the truth check agrees: each person's split is their Lifetime, and every surface names the key's fiscal year", tk.ok, tk.diffs.slice(0, 8).join("\n        "));

  // ── §3 goal pace and portfolios reconcile ───────────────────────────────
  {
    const P = await import("../shared/pace.js");
    const m = P.paceMath && P.paceMath({ raised: 225151, start: "2026-07-01", end: "2027-06-30", today: "2026-11-05" });
    ok("§3 goal pace is its own arithmetic: $225,151 by day 128 of 365 is on pace for 225,151 × 365 ÷ 128",
       !!m && m.day === 128 && m.days === 365 && m.projected === Math.round(225151 * 365 / 128)
       && m.sentence === `$225,151 raised by day 128 of 365, on pace for $${Math.round(225151 * 365 / 128).toLocaleString("en-US")}`,
       JSON.stringify(m));
    const p = P.paceOf({ raised: 225151, goal: 866000, start: "2026-07-01", end: "2027-06-30", today: "2026-11-05" });
    ok("§3 the pace badge carries the same arithmetic", !!(p && p.math) && p.math.projected === m.projected);
    const uid = "u_" + ORG;
    await q(`UPDATE donors SET assigned_to=$1, stage='cultivate' WHERE org_id=$2 AND id = ANY($3::text[])`, [uid, ORG, people.map(x => x.id)]);
    const lifeSum = async () => { let s = 0; for (const x of people) s += Number((await api("GET", `/donors/${x.id}`, tok)).body.figures.lifetime.cents); return s; };
    const officer = async () => C(((((await api("GET", "/portfolio/officers", tok)).body || {}).officers) || []).find(o => o.id === uid)?.portfolio_giving);
    const sum0 = await lifeSum(), o0 = await officer();
    await q(`UPDATE donors SET total_giving = total_giving + 1.60 WHERE org_id=$1 AND id=$2`, [ORG, people[0].id]);   // a stored total that drifted
    const o1 = await officer();
    await q(`UPDATE donors SET total_giving = total_giving - 1.60 WHERE org_id=$1 AND id=$2`, [ORG, people[0].id]);
    ok("§3 an officer's portfolio is the sum of their donors' Lifetime, and a stale stored total does not move it", o0 === sum0 && o1 === sum0, JSON.stringify({ sum0, o0, o1 }));
  }

  // ── §4 an award books as a pledge does: the payments are the income ─────
  {
    const funder = await person("Juniper Ridge Foundation (test)", { kind: "organization" });
    const cg = await api("POST", "/grants", tok, { funder: "Juniper Ridge Foundation (test)", program: "Reading Year (test)", amount: 15000, status: "applied" });
    const gid = (cg.body && (cg.body.id || (cg.body.grant && cg.body.grant.id)));
    await q(`UPDATE grants SET funder_donor_id=$1 WHERE id=$2 AND org_id=$3`, [funder, gid, ORG]);
    const income = async () => C(((await api("GET", "/finance/summary?yearMode=fiscal", tok)).body || {}).ytdRevenue);
    const grantRows = async () => (await q(`SELECT amount FROM fin_transactions WHERE org_id=$1 AND grant_id=$2`, [ORG, gid])).length;
    const i0 = await income();
    const aw = await api("PUT", `/grants/${gid}/award`, tok, { amountAwarded: "15000.00" });
    const i1 = await income();
    ok("§4 recording a $15,000 award writes nothing to the ledger, as a pledge writes nothing", aw.status === 200 && i1 === i0 && (await grantRows()) === 0,
       JSON.stringify({ status: aw.status, i0, i1, rows: await grantRows() }));
    const plan = (await api("GET", `/grants/${gid}/award-plan`, tok)).body || {};
    const pay = await api("POST", `/donors/${funder}/gifts`, tok, { amount: "10000.00", date: TODAY, payment_method: "ACH / bank transfer", pledgeId: plan.pledge && plan.pledge.id });
    // The edit's move back into Awarded is the other door the old stamp used.
    const base = { funder: "Juniper Ridge Foundation (test)", program: "Reading Year (test)", amount: 15000 };
    const toRep = await api("PUT", `/grants/${gid}`, tok, { ...base, status: "reporting" });
    const toAw = await api("PUT", `/grants/${gid}`, tok, { ...base, status: "awarded" });
    const i2 = await income();
    const g = (await api("GET", `/grants/${gid}`, tok)).body || {};
    const plan2 = (await api("GET", `/grants/${gid}/award-plan`, tok)).body || {};
    ok("§4 a $10,000 payment on it: Finance income grows by $10,000 (never $25,000), and Reporting → Awarded books nothing",
       pay.status < 300 && toRep.status === 200 && toAw.status === 200 && i2 - i0 === 1000000 && (await grantRows()) === 0,
       JSON.stringify({ pay: pay.status, toRep: toRep.status, toAw: toAw.status, grew: i2 - i0, rows: await grantRows() }));
    ok("§4 the grant shows $5,000 remaining of $15,000, with $10,000 received",
       C(g.remaining) === 500000 && C(g.received) === 1000000 && plan2.outstandingCents === 500000 && plan2.receivedCents === 1000000,
       JSON.stringify({ remaining: g.remaining, received: g.received, outstanding: plan2.outstandingCents, rec: plan2.receivedCents }));
  }

  // ── §5 "gives through" keeps both off Lapsed; Donor since ───────────────
  {
    const uid = "u_" + ORG;
    const lapsedP = await person("Rowan Ellery (test)", { stage: "lapsed", assignedTo: uid });
    const biz = await person("Ellery Hardware (test)", { kind: "organization" });
    await gift(tok, lapsedP, 400, dayOffset(-900));
    await q(`UPDATE donors SET stage='lapsed' WHERE org_id=$1 AND id=$2`, [ORG, lapsedP]);   // as an import writes it: no move
    const rel = await api("POST", `/donors/${lapsedP}/relationships`, tok, { relatedDonorId: biz, relationshipType: "owner" });
    ok("§5 the person is linked: gives through the business", rel.status === 200 || rel.status === 201, rel.status);
    await gift(tok, biz, 1000, TODAY);
    await new Promise(s => setTimeout(s, 1500));   // the after-change step runs soon after the write
    const st = (await api("GET", `/donors/${lapsedP}/status`, tok)).body || {};
    const counts = (await api("GET", "/donors/counts", tok)).body || {};
    const listed = await q(`SELECT stage FROM donors WHERE org_id=$1 AND id=$2`, [ORG, lapsedP]);
    const stats = (await api("GET", "/dashboard/my-stats", tok)).body || {};
    const lapsedHome = (await api("GET", "/dashboard/my-stats/lapsed/breakdown", tok)).body || {};
    const row = ((((await api("GET", `/donors?search=${encodeURIComponent("Rowan Ellery")}`, tok)).body || {}).donors) || []).find(x => x.id === lapsedP) || {};
    const tags = (st.tags || []).map(t => t.key);
    ok("§5 a lapsed person who gives through a business that gave today is not Lapsed: the tag, the stage Home reads, Re-engage",
       tags.length > 0 && !tags.includes("lapsed") && listed[0].stage !== "lapsed"
       && !JSON.stringify(lapsedHome).includes(lapsedP) && row.id === lapsedP && !row.reengage,
       JSON.stringify({ tags, stage: listed[0].stage, lapsedCount: stats.lapsedCount, home: JSON.stringify(lapsedHome).slice(0, 120), reengage: row.reengage, found: !!row.id, all: counts.reengage }));

    const since = await person("Marisol Tandy (test)");
    await gift(tok, since, 75, "2022-11-14");
    await gift(tok, since, 90, dayOffset(-3));
    await q(`UPDATE donors SET first_gift_date=$1 WHERE org_id=$2 AND id=$3`, [TODAY, ORG, since]);   // a stored date some write left behind
    const pr = (await api("GET", `/people/${since}`, tok)).body || {};
    ok("§5 Donor since is the year of the first gift on record (2022), not a stored later date", String(pr.first_gift_date || "").slice(0, 4) === "2022", JSON.stringify(pr.first_gift_date));
  }

  await closeDb();
  summary();
}
main().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
