// NUMBERS-2 · IMPORTED TOTALS ARE NEVER ERASED, AND ONE DEFINITION EACH.
//
// Real orgs are about to import years of history. Before this build any
// recompute (a gift edited, deleted or refunded, a merge) set a person's total
// to the sum of their gift rows, so a donor imported with a $50,000 total and
// no gifts behind it showed $0 the first time anything touched them.
//   §1 an imported $50,000 with no gifts keeps $50,000 after every recompute,
//      a $500 gift makes $50,500, and the profile says where it came from;
//   §2 gifts dated inside the imported period are not counted twice;
//   §3 average gift and retention are one figure on every screen that shows them;
//   §4 a July year and an October year put the right gifts in "this year" on
//      Home and Fundraising, and Home shows the range;
//   §5 First gift date is right after an add, a refund, a delete, a merge and
//      an import;
//   §6 the checker holds these orgs to the rules, and catches an erased total.
// Runs against a booted server ($BASE) on the scratch database.
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays } = require("./helpers");
const stripeLib = require("stripe");

const SEED = require("crypto").randomBytes(5).toString("hex");
const PREFIX = "org_n2_";
const PW = bcrypt.hashSync("loadtest1234", 4);
const sys = "'system:test','test'";

async function wipe(like) {
  const tables = await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`);
  for (let pass = 0; pass < 3; pass++) for (const t of tables) await q(`DELETE FROM ${t.table_name} WHERE org_id LIKE $1`, [like]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id LIKE $1`, [like]).catch(() => {});
}
let n = 0;
async function makeOrg(startMonth = 7) {
  const org = `${PREFIX}${SEED}_${++n}`, email = `n2-${SEED}-${n}@example.org`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,stripe_account_id,stripe_connected,vocabulary_json)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW(),false,$4,true,$5)`,
    [org, `Numbers two ${n}`, `n2-${SEED}-${n}`, `acct_${org}`, JSON.stringify({ fiscal_year_start_month: startMonth })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [`u_${org}`, org, email, PW]);
  return { org, tok: await login(email), user: `u_${org}` };
}
const person = async (o, name) => {
  const id = `d_${o.org}_${name.replace(/\W/g, "").toLowerCase()}`;
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,assigned_to,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,$5,${sys})`,
    [id, o.org, name, `${id}@example.org`, o.user]);
  return id;
};
const figs = async (o, id) => ((await api("GET", `/donors/${id}`, o.tok)).body || {}).figures || {};
const row = async id => (await q(`SELECT total_giving::text AS t, gift_count, first_gift_date, last_gift_date FROM donors WHERE id=$1`, [id]))[0];
async function refund(o, giftId, cents, back) {
  const pi = `pi_${giftId}`;
  await q(`UPDATE gifts SET stripe_payment_id=$1 WHERE id=$2`, [pi, giftId]);
  const payload = JSON.stringify({ id: `evt_${giftId}_${back}`, type: "charge.refunded", account: `acct_${o.org}`,
    data: { object: { id: `ch_${giftId}`, payment_intent: pi, amount: cents, amount_refunded: back } } });
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest" });
  return (await fetch((process.env.BASE || "http://localhost:5601") + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload })).status;
}
const giftId = async (donor, amount) => (await q(`SELECT id FROM gifts WHERE donor_id=$1 AND amount=$2 ORDER BY created_at DESC LIMIT 1`, [donor, amount]))[0]?.id;

(async () => {
  console.log(`numbers2-history (NUMBERS-2) · seed ${SEED}`);
  await wipe(`${PREFIX}%`);
  const today = civilToday();
  const { checkOrg } = require("../scripts/check-numbers");
  const NUM = require("../numbers");

  // ── §1 an imported total is never erased ───────────────────────────────
  console.log("\n§1 a $50,000 imported total, with no gifts behind it");
  const A = await makeOrg(7);
  const imp = await api("POST", "/donors/import", A.tok, { sourceName: "bloomerang-export.csv",
    donors: [{ name: "Helen Ward", email: `hw-${SEED}@example.org`, total: 50000, gifts: 40, lastGift: "2025-02-28", lastAmount: 2500 }] });
  ok("§1 the file imports", imp.status === 200 && imp.body.created === 1, imp.body);
  const [helen] = await q(`SELECT id FROM donors WHERE org_id=$1 AND name='Helen Ward'`, [A.org]);
  let f = await figs(A, helen.id);
  ok("§1 Lifetime is $50,000 with no gift rows", f.lifetime && f.lifetime.value === 50000, f.lifetime);
  ok("§1 the profile says \"Includes $50,000 from your old system (before Mar 2025)\"", f.imported && f.imported.words === "Includes $50,000 from your old system (before Mar 2025)", f.imported);
  ok("§1 ...with its source, the file", f.imported && f.imported.source === "bloomerang-export.csv", f.imported);
  // Every recompute: the one statement for the whole org, a gift added and
  // deleted, edited, refunded.
  await q(require("../donorSummary").DONOR_SUMMARY_UPDATE(), [A.org]);
  ok("§1 a whole-org recompute keeps $50,000", (await row(helen.id)).t === "50000.00", await row(helen.id));
  const tmp = await api("POST", `/donors/${helen.id}/gifts`, A.tok, { amount: 75, date: today });
  await api("DELETE", `/gifts/${tmp.body.id || await giftId(helen.id, 75)}`, A.tok);
  ok("§1 a gift added then deleted leaves $50,000", (await row(helen.id)).t === "50000.00", await row(helen.id));
  const add = await api("POST", `/donors/${helen.id}/gifts`, A.tok, { amount: 500, date: today });
  ok("§1 a $500 gift is recorded", add.status === 201, add.status);
  f = await figs(A, helen.id);
  ok("§1 ...and Lifetime is $50,500, stored and shown", f.lifetime && f.lifetime.value === 50500 && (await row(helen.id)).t === "50500.00", [f.lifetime, await row(helen.id)]);
  ok("§1 ...and the gift count is 41", (await row(helen.id)).gift_count === 41, await row(helen.id));
  const g500 = await giftId(helen.id, 500);
  await api("PUT", `/gifts/${g500}`, A.tok, { amount: 600 });
  ok("§1 an edit to $600 makes $50,600", (await row(helen.id)).t === "50600.00", await row(helen.id));
  ok("§1 a partial refund webhook answers", (await refund(A, g500, 60000, 10000)) === 200);
  f = await figs(A, helen.id);
  ok("§1 ...a $100 refund makes $50,500 and the imported $50,000 stands", (await row(helen.id)).t === "50500.00" && f.lifetime.value === 50500, [await row(helen.id), f.lifetime]);

  // ── §2 overlap is decided by the last day the old total covers ─────────
  console.log("\n§2 a gift inside the imported period is not counted twice");
  const hist = await api("POST", "/gifts/import-history", A.tok, { gifts: [
    { donorId: helen.id, amount: 1000, date: "2024-12-01" },   // the old system already counted it
    { donorId: helen.id, amount: 250, date: "2025-04-10" },    // after its last day
  ], importId: `imp_${A.org}` });
  ok("§2 the gift history imports", [200, 201].includes(hist.status), hist.body);
  f = await figs(A, helen.id);
  ok("§2 Lifetime is $50,750: the Dec 2024 gift is inside the $50,000, the Apr 2025 one is added", f.lifetime.value === 50750 && (await row(helen.id)).t === "50750.00", [f.lifetime, await row(helen.id)]);
  const drawer = await require("../figureSources").figure(A.org, { key: "donor-lifetime", params: { donor: helen.id } }, {}, { pageSize: 50 });
  ok("§2 the Lifetime drawer foots: the imported row plus the gifts after it", drawer.rows.some(r => r.type === "imported_total" && r.amount === 50000)
    && !drawer.rows.some(r => String(r.date).slice(0, 10) === "2024-12-01"), drawer.rows.map(r => [r.type, r.date, r.amount]));
  const foot = await require("../figureSources").footCheck(A.org, { key: "donor-lifetime", params: { donor: helen.id } }, {});
  ok("§2 ...to the cent", foot && foot.foots, foot);
  // A merge folds two imported totals into one Lifetime: both added up.
  const imp2 = await api("POST", "/donors/import", A.tok, { sourceName: "old-crm.xlsx",
    donors: [{ name: "Helen M. Ward", email: `hw2-${SEED}@example.org`, total: 1200, gifts: 3, lastGift: "2025-06-30", lastAmount: 400 }] });
  const [helen2] = await q(`SELECT id FROM donors WHERE org_id=$1 AND name='Helen M. Ward'`, [A.org]);
  await api("POST", `/donors/${helen2.id}/gifts`, A.tok, { amount: 40, date: "2025-05-01" });   // inside her old system's period
  const before2 = Number((await row(helen2.id)).t);
  const mg = await api("POST", "/data-health/merge", A.tok, { keptId: helen.id, mergedId: helen2.id });
  ok("§2 two imported people merge", imp2.status === 200 && [200, 201].includes(mg.status), mg.body);
  ok("§2 ...and Lifetime is the two added up ($50,750 + $1,200)", before2 === 1200 && (await row(helen.id)).t === "51950.00" && (await figs(A, helen.id)).lifetime.value === 51950, [before2, await row(helen.id)]);

  // ── §3 one average and one retention ──────────────────────────────────
  console.log("\n§3 average gift and retention, the same on every screen");
  const B = await makeOrg(7);
  const fyStart = `${Number(today.slice(5, 7)) >= 7 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-07-01`;
  const lastFy = `${Number(fyStart.slice(0, 4)) - 1}-08-15`;
  const people = [];
  for (let i = 0; i < 24; i++) people.push(await person(B, `Giver ${i}`));
  // Twenty-four gave last fiscal year (enough for the rate to show) and one of
  // them two years ago too; twelve gave again this one, one with a refund.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,20,$4,'check',${sys})`, [`g_${B.org}_old`, B.org, people[23], civilPlusDays(-700)]);
  for (const [i, p] of people.entries()) await api("POST", `/donors/${p}/gifts`, B.tok, { amount: 100 + i * 10, date: lastFy });
  for (const p of people.slice(0, 12)) await api("POST", `/donors/${p}/gifts`, B.tok, { amount: 300, date: fyStart });
  const r0 = await giftId(people[0], 300);
  await refund(B, r0, 30000, 5000);
  // A credit row is not a gift (on someone who gave again anyway).
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,999,$4,'matching gift credit',${sys})`, [`g_${B.org}_cr`, B.org, people[3], fyStart]);
  await q(require("../donorSummary").DONOR_SUMMARY_UPDATE(), [B.org]);
  // Counted gifts this year: twelve of $300 and a -$50 refund: $3,550 over 12 gifts.
  const want = 295.83;
  const gs = await api("GET", `/reports/giving-summary?from=${fyStart}&to=${today}`, B.tok);
  const FS = require("../figureSources");
  const ask = require("../askEngine");
  const askAvg = await ask.computeGiftMetric(B.org, "average_gift", await ask.giftSet(B.org, { metric: "average_gift", filters: {} }, { from: fyStart, to: today }), { from: fyStart, to: today });
  const annual = await api("GET", `/reports/annual?year=${Number(fyStart.slice(0, 4)) + 1}`, B.tok);
  const glance = await NUM.donorGlance(require("../db").query, B.org, people[0]);
  ok("§3 Reports' average gift is $295.83", gs.body && Number(gs.body.avgGift) === want, gs.body && gs.body.avgGift);
  ok("§3 Ask's average gift is the same", askAvg.value === want, askAvg);
  ok("§3 the annual report's average gift is the same", annual.body && Number(annual.body.avgGift) === want, annual.body && annual.body.avgGift);
  ok("§3 the profile's average for a person with a refund: ($100 + $300 - $50) over 2 gifts = $175", glance.average.value === 175 && glance.average.count === 2, glance.average);
  ok("§3 every average says the same words", FS.sourceDef("donor-average-gift").sentence() === FS.AVERAGE_WORDS
    && require("fs").readFileSync(require("path").join(__dirname, "../shared/askCatalog.js"), "utf8").includes(FS.AVERAGE_WORDS)
    && require("fs").readFileSync(require("path").join(__dirname, "../shared/helpArticles.js"), "utf8").includes(FS.AVERAGE_WORDS));
  // Retention: 12 of 24 = 50%, on Home, the board figure, Ask, Reports' fiscal window.
  const home = (await api("GET", "/metrics/stewardship-summary?scope=all", B.tok)).body || {};
  const board = (await api("GET", "/figures/retention/rows?pageSize=1", B.tok)).body || {};
  const rep = await FS.figureValue(B.org, { key: "retention-window", params: { from1: `${Number(fyStart.slice(0, 4)) - 1}-07-01`, to1: `${fyStart.slice(0, 4)}-06-30`, from0: fyStart, to0: today } }, {});
  ok("§3 Home's retention is 50% (12 of last fiscal year's 24 gave again)", home.retentionRate && home.retentionRate.current === 50 && home.retentionRate.retained === 12 && home.retentionRate.prevYearCount === 24 && !home.retentionRate.thinData, home.retentionRate);
  ok("§3 the board, board pack and Ask figure is the same 50%", Math.round(Number(board.value)) === 50, board);
  ok("§3 Reports' fiscal retention is the same 50%", Math.round(Number(rep.value)) === 50, rep);
  ok("§3 Home names the fiscal years and has the same-dates-last-year version", /^FY /.test(home.retentionRate.yearLabel || "") && home.retentionRate.sameDatesLastYear && "current" in home.retentionRate.sameDatesLastYear, home.retentionRate);

  // ── §4 the org's own year ──────────────────────────────────────────────
  console.log("\n§4 a July year and an October year");
  for (const [sm, label] of [[7, "July"], [10, "October"]]) {
    const O = await makeOrg(sm);
    const p = await person(O, "Year Giver");
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    const start = `${m >= sm ? y : y - 1}-${String(sm).padStart(2, "0")}-01`;
    // An August gift in this year (July start); for October, a September gift is LAST year.
    const inside = sm === 7 ? `${start.slice(0, 4)}-08-15` : start;
    const outside = require("../orgTime").addDays(start, -1);
    await api("POST", `/donors/${p}/gifts`, O.tok, { amount: 700, date: inside <= today ? inside : start });
    await api("POST", `/donors/${p}/gifts`, O.tok, { amount: 40, date: outside });
    const ms = (await api("GET", "/dashboard/my-stats", O.tok)).body || {};
    const ov = (await api("GET", "/fundraising/overview", O.tok)).body || {};
    ok(`§4 ${label} year: Home's Gifts YTD is the $700 gift only`, ms.giftsYtd === 700, ms.giftsYtd);
    ok(`§4 ${label} year: Fundraising's year starts ${start}`, ov.period && ov.period.start === start, ov.period);
    ok(`§4 ${label} year: Home shows the year's range once`, typeof ms.yearLabel === "string" && ms.yearLabel.startsWith(sm === 7 ? "Jul" : "Oct"), ms.yearLabel);
    const pf = await figs(O, p);
    ok(`§4 ${label} year: the profile's This year is $700`, pf.thisYear && pf.thisYear.value === 700, pf.thisYear);
  }

  // ── §5 first gift date ─────────────────────────────────────────────────
  console.log("\n§5 First gift date after an add, a refund, a delete, a merge and an import");
  const C = await makeOrg(7);
  const a = await person(C, "First Ann"), b = await person(C, "First Bob");
  await api("POST", `/donors/${a}/gifts`, C.tok, { amount: 100, date: "2026-03-01" });
  ok("§5 after an add, 2026-03-01", (await row(a)).first_gift_date === "2026-03-01", await row(a));
  await api("POST", `/donors/${a}/gifts`, C.tok, { amount: 80, date: "2025-05-01" });
  ok("§5 an earlier add moves it to 2025-05-01", (await row(a)).first_gift_date === "2025-05-01", await row(a));
  const early = await giftId(a, 80);
  await refund(C, early, 8000, 8000);
  ok("§5 a full refund of that gift means it is no longer a gift: 2026-03-01", (await row(a)).first_gift_date === "2026-03-01", await row(a));
  await api("POST", `/donors/${a}/gifts`, C.tok, { amount: 60, date: "2025-09-09" });
  ok("§5 another earlier add: 2025-09-09", (await row(a)).first_gift_date === "2025-09-09", await row(a));
  await api("DELETE", `/gifts/${await giftId(a, 60)}`, C.tok);
  ok("§5 deleting the first gift moves it forward to 2026-03-01", (await row(a)).first_gift_date === "2026-03-01", await row(a));
  await api("POST", `/donors/${b}/gifts`, C.tok, { amount: 50, date: "2024-02-02" });
  await api("POST", "/data-health/merge", C.tok, { keptId: a, mergedId: b });
  ok("§5 a merge takes the earlier person's 2024-02-02", (await row(a)).first_gift_date === "2024-02-02", await row(a));
  await api("POST", "/gifts/import-history", C.tok, { gifts: [{ donorId: a, amount: 25, date: "2023-01-09" }], importId: `imp_${C.org}` });
  ok("§5 an import of an older gift moves it to 2023-01-09", (await row(a)).first_gift_date === "2023-01-09", await row(a));

  // ── §6 the checker ─────────────────────────────────────────────────────
  console.log("\n§6 the checker holds these orgs to the rules");
  for (const o of [A, B, C]) {
    const r = await checkOrg(o.org, { screens: NUM.screens });
    ok(`§6 every rule holds on ${o.org.split("_").pop()}`, r.problems.length === 0, r.problems.map(p => [p.rule, p.examples]));
  }
  // The guard can fail: erase the imported total the old way (sum of gifts).
  await q(`UPDATE donors d SET total_giving = COALESCE((SELECT SUM(amount) FROM gifts g WHERE g.donor_id=d.id),0) WHERE id=$1`, [helen.id]);
  const planted = await checkOrg(A.org, { screens: NUM.screens });
  ok("§6 an erased imported total is caught (the checker can fail)", planted.problems.some(p => p.rule === "donor-stored"), planted.problems.map(p => p.rule));

  await wipe(`${PREFIX}%`);
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
