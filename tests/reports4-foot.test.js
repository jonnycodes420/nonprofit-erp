// REPORTS-4 · EVERY FIGURE FOOTS TO ITS ROWS.
//
// The one test this build earns, because these are the money figures a board
// and a bookkeeper read: every figure in docs/reports-4/figures.md that this
// build made open is walked here, and each one must
//   1. open rows (its source is a real one, its rows can be read), and
//   2. foot: the rows add up to the figure, to the cent and to the count
//      (figureSources.footCheck, the one footing rule), and
//   3. be the number on screen: the value the report or record hands the
//      screen is the source's value, to the cent.
// It also pins the one figure that was WRONG and not only bare: a profile's
// "household total" counted a deleted spouse's giving (fails before the fix).
//
// By default it builds its own small organisation shaped like Harborlight
// (three years of gifts, refunds, first-time givers, funds, a campaign, a
// giving page with a covered fee, a household, memberships, deleted people).
// FOOT_EMAIL / FOOT_PASSWORD walk any other account instead, which is how the
// build walks the demo locally; no suite names the demo.
//
// WHAT WOULD MAKE THIS FAIL (planted before it was trusted):
//   · the annual report shows its own SQL numbers again instead of the
//     sources' → "is the number on screen" goes red (retention to one decimal
//     against the source's whole percent);
//   · the `members` source forgets `d.deleted_at IS NULL` → the lapsed count on
//     Memberships no longer matches its rows;
//   · the relationships route adds total_giving itself again → the deleted
//     spouse is counted and "household total leaves out a deleted spouse" fails.
//
//   BASE=http://localhost:5601 node tests/reports4-foot.test.js
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api } = require("./helpers");
const FS = require("../figureSources");

const ORG = "org_r4foot";
const ADMIN = "director@r4foot.local";

async function clear(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}

const Y = new Date().getFullYear();
const y = n => Y - n;   // y(1) is last year, the last complete one

async function buildFixture() {
  await clear(ORG);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Foot Harbour Youth','r4foot',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_r4_admin',$1,$2,$3,'Dana Footer','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_r4_gen',$1,'General',false), ('ff_r4_sch',$1,'Scholarships',true)`, [ORG]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount) VALUES ('c_r4_spring',$1,'Spring appeal','appeal','active',5000)`, [ORG]);
  await q(`INSERT INTO giving_pages (id,org_id,title,slug,status) VALUES ('gp_r4',$1,'Summer studio','r4-summer','published')`, [ORG]);
  await q(`INSERT INTO households (id,org_id,name) VALUES ('hh_r4',$1,'The Okafor household')`, [ORG]);
  const person = (id, name, extra = {}) => q(
    `INSERT INTO donors (id,org_id,name,email,kind,stage,household_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','steward',$5,'system:test','test')`,
    [id, ORG, name, id + "@r4.test", extra.household || null]);
  const P = ["d_r4_ada", "d_r4_ben", "d_r4_cy", "d_r4_dee", "d_r4_eli", "d_r4_fay", "d_r4_gus", "d_r4_hal"];
  for (const [i, id] of P.entries()) await person(id, ["Ada Okafor", "Ben Okafor", "Cy Lund", "Dee Marsh", "Eli Novak", "Fay Quill", "Gus Reyes", "Hal Stone"][i], { household: i < 2 ? "hh_r4" : null });
  await person("d_r4_gone", "Gone Okafor", { household: "hh_r4" });
  let n = 0;
  const gift = (donor, amount, date, extra = {}) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,campaign_id,giving_page_id,cover_fee_amount,stripe_payment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [`g_r4_${++n}`, ORG, donor, amount, date, extra.type || "cash", extra.fund || null, extra.campaign || null, extra.page || null, extra.fee || 0, extra.stripe || null]);
  // Three years of giving, with refunds, first-time givers and a lapse.
  await gift("d_r4_ada", 250.10, `${y(3)}-03-01`, { fund: "ff_r4_gen" });
  await gift("d_r4_ada", 300.33, `${y(2)}-03-01`, { fund: "ff_r4_gen" });
  await gift("d_r4_ada", 410.07, `${y(1)}-03-01`, { fund: "ff_r4_sch", campaign: "c_r4_spring" });
  await gift("d_r4_ben", 99.99, `${y(2)}-05-05`);
  await gift("d_r4_ben", -99.99, `${y(2)}-05-20`);   // a refund
  await gift("d_r4_ben", 120.00, `${y(1)}-06-06`, { page: "gp_r4", fee: 3.80, stripe: "pi_r4_1" });
  await gift("d_r4_cy", 1000.00, `${y(2)}-09-09`, { fund: "ff_r4_sch" });   // gave, then lapsed
  await gift("d_r4_dee", 55.55, `${y(2)}-11-11`);
  await gift("d_r4_dee", 65.65, `${y(1)}-11-11`, { campaign: "c_r4_spring", stripe: "pi_r4_2" });
  await gift("d_r4_eli", 12.34, `${y(1)}-01-15`);   // first gift last year
  await gift("d_r4_eli", 12.34, `${y(1)}-02-15`);
  await gift("d_r4_fay", 5000.00, `${y(1)}-12-01`, { fund: "ff_r4_gen", type: "matching gift credit" });
  await gift("d_r4_gus", 75.25, `${y(3)}-07-07`);   // SYBUNT
  await gift("d_r4_hal", 33.33, `${y(0)}-01-02`);
  await gift("d_r4_gone", 777.77, `${y(1)}-04-04`, { page: "gp_r4" });
  for (const id of [...P, "d_r4_gone"]) {
    await q(`UPDATE donors d SET total_giving = COALESCE((SELECT SUM(amount) FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id),0),
                                 gift_count = (SELECT COUNT(*) FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id),
                                 last_gift_date = (SELECT MAX(date) FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id)
              WHERE id=$1`, [id]);
  }
  // A spouse link to someone who is then deleted: the household total must
  // leave them out.
  await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type) VALUES ('dr_r4_1',$1,'d_r4_ada','d_r4_ben','spouse'), ('dr_r4_2',$1,'d_r4_ada','d_r4_gone','spouse')`, [ORG]);
  // Memberships, one held by the person who is then deleted.
  await q(`INSERT INTO membership_levels (id,org_id,name,price,term) VALUES ('ml_r4',$1,'Friend',50,'12_months')`, [ORG]);
  const mem = (id, donor, status, starts, expires) => q(
    `INSERT INTO memberships (id,org_id,donor_id,level_id,status,joined_on,starts_on,expires_on) VALUES ($1,$2,$3,'ml_r4',$4,$5,$5,$6)`,
    [id, ORG, donor, status, starts, expires]);
  await mem("m_r4_1", "d_r4_ada", "active", `${y(0)}-01-01`, `${y(-1)}-01-01`);
  await mem("m_r4_2", "d_r4_cy", "lapsed", `${y(2)}-01-01`, `${y(1)}-01-01`);
  await mem("m_r4_3", "d_r4_dee", "cancelled", `${y(1)}-01-01`, `${y(0)}-01-01`);
  await mem("m_r4_4", "d_r4_gone", "lapsed", `${y(2)}-01-01`, `${y(1)}-01-01`);
  await q(`UPDATE donors SET deleted_at = NOW() WHERE id = 'd_r4_gone'`);
}

// Every { source, displayed } pair a response hands the screen.
const PAIRS = { householdTotalSource: "householdTotal", combined_source: "combined_giving", raised_source: "raised_amount",
  campaign_raised_source: "campaign_raised" };
function collect(node, out, where) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((x, i) => collect(x, out, `${where}[${i}]`)); return out; }
  if (node.source && node.source.key) {
    const shown = "value" in node ? node.value : "total" in node ? node.total : "total_giving" in node ? node.total_giving : undefined;
    out.push({ where, source: node.source, shown });
  }
  for (const [k, field] of Object.entries(PAIRS)) {
    if (node[k] && node[k].key) out.push({ where: `${where}.${k}`, source: node[k], shown: node[field] });
  }
  // A response's `figures` map: each figure's displayed number is the field
  // of the same name beside the map (what the screen reads), when there is one.
  if (node.figures && typeof node.figures === "object" && !Array.isArray(node.figures)) {
    for (const [k, f] of Object.entries(node.figures)) {
      if (f && f.source && f.source.key) out.push({ where: `${where}.${k}`, source: f.source, shown: k in node ? node[k] : f.value });
    }
  }
  if (node.byStatusSource) for (const st of Object.keys(node.byStatusSource)) out.push({ where: `${where}.byStatus.${st}`, source: node.byStatusSource[st], shown: node.byStatus[st] });
  for (const [k, v] of Object.entries(node)) if (k !== "source" && k !== "figures" && !k.endsWith("Source") && !k.endsWith("_source")) collect(v, out, `${where}.${k}`);
  return out;
}
const same = (a, b) => a === b || (a !== null && b !== null && a !== undefined && b !== undefined && Math.round(Number(a) * 100) === Math.round(Number(b) * 100));

(async () => {
  console.log("reports4-foot");
  const own = !process.env.FOOT_EMAIL;
  if (own) await buildFixture();
  const tok = await login(process.env.FOOT_EMAIL || ADMIN, process.env.FOOT_PASSWORD || "loadtest1234");
  const me = await api("GET", "/org", tok);
  const orgId = own ? ORG : (me.body && (me.body.id || (me.body.org && me.body.org.id)));
  const yr = own ? y(1) : Number(process.env.FOOT_YEAR || y(1));
  const from = `${yr}-01-01`, to = `${yr}-12-31`;

  // The screens, as the screens ask for them.
  const asks = [
    ["giving summary", `/reports/giving-summary?from=${from}&to=${to}`],
    ["by fund", `/reports/by-group?groupBy=funds&from=${from}&to=${to}`],
    ["by campaign", `/reports/by-group?groupBy=campaigns&from=${from}&to=${to}`],
    ["by giving page", `/reports/by-group?groupBy=giving_pages&from=${from}&to=${to}`],
    ["LYBUNT", `/reports/lybunt?year=${yr}&yearMode=calendar`],
    ["SYBUNT", `/reports/sybunt?year=${yr}&yearMode=calendar`],
    ["retention", `/reports/retention?yearMode=calendar`],
    ["top donors, period", `/reports/top-donors?scope=period&from=${from}&to=${to}&limit=5`],
    ["top donors, lifetime", `/reports/top-donors?scope=lifetime&limit=5`],
    ["three-year", `/reports/three-year?year=${yr}&yearMode=calendar`],
    ["annual", `/reports/annual?year=${yr}&yearMode=calendar`],
    ["bookkeeper", `/reports/bookkeeper?from=${from}&to=${to}`],
    ["giving pages", `/giving-pages`],
    ["memberships", `/memberships`],
  ];
  if (own) {
    asks.push(["household", `/households/hh_r4`], ["household total", `/donors/d_r4_ada/relationships`]);
  } else if (process.env.FOOT_DONOR) {
    asks.push(["household total", `/donors/${process.env.FOOT_DONOR}/relationships`]);
  }

  let figures = 0;
  for (const [name, path] of asks) {
    const r = await api("GET", path, tok);
    if (r.status !== 200) { ok(`${name} answers`, false, { status: r.status, body: r.body }); continue; }
    const pairs = collect(r.body, [], name);
    ok(`${name}: has figures that open`, pairs.length > 0, Object.keys(r.body || {}));
    for (const pr of pairs) {
      figures++;
      let f;
      try { f = await FS.footCheck(orgId, pr.source); } catch (e) { f = { error: e.message }; }
      const label = `${pr.where} (${pr.source.key})`;
      if (!f || f.error) { ok(`${label} opens rows`, false, f); continue; }
      ok(`${label} foots: ${f.measure} ${f.value} = rows ${f.rowsFoot}`, f.foots, f);
      if (pr.shown !== undefined) ok(`${label} is the number on screen (${pr.shown})`, same(pr.shown, f.value), { shown: pr.shown, figure: f.value });
    }
  }
  ok(`walked at least 40 figures (${figures})`, figures >= 40, figures);

  if (own) {
    // The wrong figure: a deleted spouse's giving was in the household total.
    const rel = await api("GET", "/donors/d_r4_ada/relationships", tok);
    ok("household total leaves out a deleted spouse (Ada + Ben only)", same(rel.body.householdTotal, 960.50 + 120.00), rel.body.householdTotal);
    // Memberships: the deleted person's lapsed membership is not counted.
    const m = await api("GET", "/memberships", tok);
    ok("lapsed members leave out a deleted person", m.body.byStatus.lapsed === 1, m.body.byStatus);
    // The kept rows: a CSV of the rows, and the people for a Group.
    const src = encodeURIComponent;
    const csv = await fetch(`${process.env.BASE || "http://localhost:5601"}/figures/gifts/export.csv?from=${src(from)}&to=${src(to)}`, { headers: { authorization: "Bearer " + tok } });
    const body = await csv.text();
    const fc = await FS.footCheck(ORG, { key: "gifts", params: { from, to, measure: "count" } });
    ok("the CSV holds every row behind the figure", csv.status === 200 && body.trim().split(/\r?\n/).length - 1 === fc.value, { status: csv.status, lines: body.trim().split(/\r?\n/).length - 1, rows: fc.value });
    const ppl = await api("GET", `/figures/givers/people?from=${from}&to=${to}`, tok);
    const giv = await FS.footCheck(ORG, { key: "givers", params: { from, to } });
    ok("the people behind a figure are the people it counts", ppl.status === 200 && ppl.body.donorIds.length === giv.value, { people: ppl.body, givers: giv.value });
    await clear(ORG);
  }
  await closeDb();
  summary("reports4-foot");
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary("reports4-foot"); });
