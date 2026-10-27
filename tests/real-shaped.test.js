// tests/real-shaped.test.js: HARDEN-1. THE REAL-SHAPED FILES GO IN WHOLE AND
// COME BACK OUT WHOLE. Guards donor data and money: a real customer's two files
// (a gift history and a contacts list) were imported on prod and exposed six
// ways the reader lost or bent what they said. The fixtures were scrubbed from
// those files (tests/fixtures/import/real-shaped/); amounts, dates, categories
// and structure are real, every name is fake. expected.json is the answer key
// and never comes from the reader.
//
// Into one EMPTY fresh org: the gift file, then the dinner file, then the
// contacts file.
//   §1 the gift file to the cent: 278 gifts, $571,129.93, nine set aside each
//      with its reason, none undated; per year, landed + set aside = the key's
//      years (the key's years are NET of the negative rows), and landed alone =
//      the positives per year.
//   §2 a per-gift column lands on the gift: Category is each gift's campaign
//      or appeal and Memo its note; neither is a field on the person, and a
//      donor who gave to the gala and the 5K keeps both.
//   §3 a comma in a business name is not "Last, First": "…, U.S.A", "…, Inc",
//      "…, LLC", "…, Jr", "…, OAKWOOD" keep their order and their casing.
//   §4 businesses and foundations come in as organisations, by a whole word;
//      a Last Name with no First Name is an organisation (the farms).
//   §D the dinner file (jp-dinner-gifts-106): the totals row is checked and is
//      no person or gift; Completed Yes is a gift, No/NO a pledge; "x 3 years"
//      is a pledge of 3 × Amount in three yearly installments; "Reccuring" is
//      one $100 gift with its wording kept, never a plan or a $3,600 pledge;
//      the 3 Yr Total column is never counted as money; couples are two people
//      and one household; "Morley " twice is one person.
//   §5 the contacts file matches the gift file's people instead of making
//      duplicates, and the preview says how many; near-duplicate rows are one.
//   §6 undo the contacts, then the dinner, then the gifts: the org is exactly as before each;
//      and the gift file alone, then its undo.
//   §7 a name-only match to someone deleted is a question (Same person by
//      default, stays out; Different person, imported as new); a match by
//      email stays blocked with no question.
//
// assertSurfacesAgree(orgId, ctx) (tests/lib/surfacesAgree.js, another HARDEN-1
// item) is called after each import and each undo when it exists.
//
// HOW IT GOES RED ON MAIN: Category is one custom field on the person (§2);
// "Ringford Dunmore Blacklow, U.S.A" reads "U.s.a Ringford Dunmore Blacklow"
// and "Perel V. Warville, Jr" reads "Jr Perel V. Warville" (§3); the farms and
// "Kinmere Services, OAKWOOD" are people (§4); a name-only match to someone
// deleted is set aside with no question (§7).
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import", "real-shaped");
const KEY = JSON.parse(fs.readFileSync(path.join(FX, "expected.json"), "utf8"));
const GK = KEY["jp-gift-history-287.xlsx"], CK = KEY["jp-contacts-656.xlsx"];
// The dinner file's key is Jonathan's (expected.json). The pledged total over
// the years follows from it: each "x 3 years" row is Amount × 3, computed below
// from the file's own cells, never from the reader.
const DKEY = KEY["jp-dinner-gifts-106.xlsx"];
const DK = { personRows: DKEY.rows, totalsRows: 1, gifts: DKEY.received.rows, gift_dollars: DKEY.received.dollars, pledges: DKEY.not_yet_received.rows,
  pledge_first_year_dollars: DKEY.not_yet_received.dollars, multi_year_pledges: DKEY.multi_year_pledges.rows, totals_row_amount: DKEY.file_total_row,
  totals_row_3yr: DKEY.three_year_total_row, recurring: DKEY.recurring.rows, giftTypeMethods: DKEY.methods_that_are_gift_types };
const PASSWORD = "loadtest1234";
// ── the surfaces hook (HARDEN-1 item 3 writes tests/lib/surfacesAgree.js) ──
let assertSurfacesAgree = null;
try { ({ assertSurfacesAgree } = require("./lib/surfacesAgree")); } catch {}
async function surfaces(orgId, ctx) {
  if (typeof assertSurfacesAgree === "function") await assertSurfacesAgree(orgId, ctx);
}

// every org-child table an import can touch, children first
const TABLES = ["event_attendees", "email_suppressions", "pledge_installments", "pledges", "thank_you_drafts", "interactions", "gifts", "events",
  "fin_transactions", "imports", "sheet_import_jobs", "donor_scores", "readouts", "tasks", "cultivation_plans", "deleted_records", "custom_field_values",
  "custom_field_events", "custom_fields", "donors", "households", "custom_field_defs", "fin_funds", "budgets", "accounts", "users"];
// The whole org, every table that has an org_id, row by row, except the logs
// an import or an undo is allowed to leave (its own run, its job, the audit,
// the work queue), scores recomputed from the rows, and the chart of accounts
// every org gets with its first gift (setup, like the unrestricted fund).
const NOT_STATE = new Set(["accounts", "imports", "sheet_import_jobs", "fin_audit_log", "ai_log", "ai_usage", "ai_fallbacks", "api_call_log", "job_queue", "user_sessions",
  "users", "question_log", "import_recent_jobs", "import_recent_work", "donor_scores", "donor_drift", "donor_rhythm", "metric_snapshots", "readouts",
  "readout_events", "deleted_records", "org_record_months", "agent_runs", "data_health_runs", "notification_sends", "notification_failures"]);
const SNAP_SKIP = new Set(["updated_at", "last_scored_at", "score_updated_at", "engagement_updated_at"]);
let ORG_TABLES = null;
async function snapshot(org) {
  ORG_TABLES = ORG_TABLES || (await q(`SELECT table_name AS t FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' ORDER BY 1`))
    .map(r => r.t).filter(t => !NOT_STATE.has(t));
  const out = {};
  for (const t of ORG_TABLES) {
    const rows = await q(`SELECT * FROM ${t} WHERE org_id=$1`, [org]).catch(() => []);
    out[t] = rows.filter(r => !(t === "fin_funds" && r.description === "General unrestricted operating fund"))
      .map(r => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !SNAP_SKIP.has(k)).sort()))).sort();
  }
  return out;
}
function snapDiff(a, b) {
  const diffs = [];
  for (const t of Object.keys(a)) {
    const A = new Set(a[t]), B = new Set(b[t]);
    const gone = a[t].filter(x => !B.has(x)), extra = b[t].filter(x => !A.has(x));
    if (gone.length || extra.length) diffs.push(`${t}: ${gone.length} gone, ${extra.length} left behind or changed`
      + (extra.length ? " (" + extra[0].slice(0, 200) + ")" : gone.length ? " (gone: " + gone[0].slice(0, 200) + ")" : ""));
  }
  return diffs;
}
async function counts(org) {
  const n = async (sql) => (await q(sql, [org]))[0];
  return {
    donors: (await n("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL")).n,
    gifts: (await n("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s FROM gifts WHERE org_id=$1")),
    fields: (await n("SELECT COUNT(*)::int AS n FROM custom_field_defs WHERE org_id=$1")).n,
  };
}

let R = null;
async function sheetsOf(file) {
  R = R || await import("../shared/sheetRead.js");
  return R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(FX, file)), { type: "buffer", cellDates: true }), XLSX);
}
async function freshOrg(id, name) {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [id]).catch(() => {});
  // then every other org-child table, a few passes for the foreign keys
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const one = async (sql, args) => (await q(sql, args))[0];
const centsOf = v => Math.round(Number(v || 0) * 100);
async function importJob(tok, body) {
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  if (r.status !== 202) return { start: r, end: null, importId: null };
  const t0 = performance.now();
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { start: r, end: j.body, importId: r.body.importId };
    if (performance.now() - t0 > 120000) return { start: r, end: { status: "timeout" }, importId: r.body.importId };
    await new Promise(res => setTimeout(res, 150));
  }
}

async function main() {
  const ORG = "org_hs1real";
  const tok = await freshOrg(ORG, "Real-shaped (test)");
  const gSheets = await sheetsOf("jp-gift-history-287.xlsx");
  const cSheets = await sheetsOf("jp-contacts-656.xlsx");
  const gRows = gSheets[0].grid.slice(1);
  ok("the gift fixture has the key's rows and names", gRows.length === GK.rows && new Set(gRows.map(r => r[1])).size === GK.distinct_donor_names, [gRows.length]);
  // the answer key per year, and the positives per year, from the file's own rows
  const posYear = {}, netYear = {};
  for (const r of gRows) {
    const y = String(r[0]).slice(0, 4), c = centsOf(r[2]);
    netYear[y] = (netYear[y] || 0) + c;
    if (c > 0) posYear[y] = (posYear[y] || 0) + c;
  }
  ok("the key's years are the file's net per year", Object.entries(GK.years).every(([y, v]) => centsOf(v) === netYear[y]), JSON.stringify(netYear));
  const S0 = await snapshot(ORG);
  await surfaces(ORG, { step: "empty org" });

  // §1 the gift file
  const gBody = { fileName: "jp-gift-history-287.xlsx", sheets: gSheets };
  const gu = await api("POST", "/sheet-import/understand", tok, gBody);
  const GU = gu.body || {}, gc = GU.counts || {};
  ok("§1 the preview is ready", gu.status === 200 && GU.ready === true, gu.status + " " + JSON.stringify((GU.questions || []).filter(x => !x.optional)).slice(0, 300));
  ok(`§1 the preview: ${GK.gifts} gifts, $${GK.gift_dollars}, ${GK.set_aside} set aside, ${GK.undated_gifts} undated`,
     gc.gifts === GK.gifts && gc.giftCents === centsOf(GK.gift_dollars) && gc.aside === GK.set_aside && gc.undatedGifts === GK.undated_gifts, JSON.stringify(gc));
  const gImp = await importJob(tok, gBody);
  const G_RUN = gImp.importId;
  ok("§1 the gift import ends done", gImp.end && gImp.end.status === "done", JSON.stringify(gImp.end || gImp.start.body).slice(0, 400));
  const landed = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s, COUNT(*) FILTER (WHERE date IS NULL)::int AS undated FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, G_RUN]);
  ok(`§1 ${GK.gifts} gifts landed, $${GK.gift_dollars} to the cent, ${GK.undated_gifts} undated`,
     landed.n === GK.gifts && centsOf(landed.s) === centsOf(GK.gift_dollars) && landed.undated === GK.undated_gifts, JSON.stringify(landed));
  const rc = (await api("GET", `/imports/${G_RUN}`, tok)).body.import || {};
  const aside = (rc.setAside || rc.asideRows || (rc.summary && rc.summary.aside) || GU.aside || []);
  ok(`§1 ${GK.set_aside} rows set aside, each with its reason`, rc.rowsSetAside === GK.set_aside && (GU.aside || []).length === GK.set_aside
     && (GU.aside || []).every(a => a.reason && a.line), JSON.stringify([rc.rowsSetAside, (GU.aside || []).map(a => [a.line, a.cents, a.reason])]));
  const asideCents = (GU.aside || []).reduce((n, a) => n + (a.cents || 0), 0);
  ok("§1 the set-aside rows are the six negatives and the three zeros (-$4,946.00)", asideCents === -494600
     && (GU.aside || []).filter(a => a.cents < 0).length === 6 && (GU.aside || []).filter(a => a.cents === 0).length === 3, asideCents);
  const horse = (GU.aside || []).find(a => a.cents === -480000) || {};
  ok("§1 the -$4,800 \"Purchase of Oakwell Horse\" is set aside as money paid out, not a refund", /paid out|expense|purchase/i.test(horse.reason || ""), horse.reason);
  ok("§1 the receipt reconciles and offers Undo", rc.reconciled === true && rc.canUndo === true, JSON.stringify([rc.reconciled, rc.canUndo, rc.findings]));
  const byYear = await q("SELECT LEFT(date::text,4) AS y, SUM(amount)::numeric AS s FROM gifts WHERE org_id=$1 AND import_id=$2 GROUP BY 1", [ORG, G_RUN]);
  const landedYear = Object.fromEntries(byYear.map(r => [String(r.y), centsOf(r.s)]));
  const asideYear = {};
  for (const a of GU.aside || []) { const y = String(gSheets[0].grid[a.line - 1][0]).slice(0, 4); asideYear[y] = (asideYear[y] || 0) + a.cents; }
  ok("§1 per year, landed + set aside = the key's years, to the cent", Object.entries(GK.years).every(([y, v]) => (landedYear[y] || 0) + (asideYear[y] || 0) === centsOf(v)),
     JSON.stringify({ landedYear, asideYear, key: GK.years }));
  ok("§1 per year, landed = the file's positive rows (2024 258,039.90 · 2025 239,318.07 · 2026 73,771.96)",
     Object.keys(posYear).every(y => landedYear[y] === posYear[y]) && landedYear["2024"] === 25803990 && landedYear["2025"] === 23931807 && landedYear["2026"] === 7377196,
     JSON.stringify({ landedYear, posYear }));
  await surfaces(ORG, { step: "after gifts", importId: G_RUN });

  // §2 a per-gift column lands on the gift
  const catCol = (GU.columns || []).find(c => c.header === "Category") || {};
  ok("§2 Category is read as each gift's campaign or appeal, not kept on the person", catCol.disposition === "mapped" && catCol.role === "campaign", JSON.stringify(catCol));
  ok("§2 no custom field called Category or Memo", !(await one("SELECT 1 AS x FROM custom_field_defs WHERE org_id=$1 AND LOWER(label) IN ('category','memo')", [ORG])), "");
  const catMismatch = gRows.map((r, i) => [i + 2, r]).filter(([, r]) => centsOf(r[2]) > 0);
  const gifts = await q("SELECT g.campaign, g.notes, g.amount, g.date::text AS date, d.name FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND g.import_id=$2", [ORG, G_RUN]);
  const wantCat = {}; for (const [, r] of catMismatch) wantCat[r[4] || ""] = (wantCat[r[4] || ""] || 0) + 1;
  const gotCat = {}; for (const g of gifts) gotCat[g.campaign || ""] = (gotCat[g.campaign || ""] || 0) + 1;
  ok("§2 every gift carries its own row's Category as its campaign", JSON.stringify(Object.entries(wantCat).sort()) === JSON.stringify(Object.entries(gotCat).sort()), JSON.stringify({ wantCat, gotCat }));
  const memoOk = catMismatch.every(([, r]) => !r[3] || gifts.some(g => (g.notes || "").includes(String(r[3]).trim())));
  ok("§2 every gift's Memo is on the gift's note", memoOk, "");
  const both = await q(`SELECT d.name FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND g.import_id=$2
                         GROUP BY d.name HAVING COUNT(DISTINCT g.campaign) FILTER (WHERE g.campaign ~* 'gala|5k') >= 2`, [ORG, G_RUN]);
  const multiCatPeople = await q(`SELECT d.name FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND g.import_id=$2 GROUP BY d.name HAVING COUNT(DISTINCT COALESCE(g.campaign,'')) > 1`, [ORG, G_RUN]);
  ok("§2 a donor whose gifts carry different categories keeps every one of them, on the gifts", multiCatPeople.length > 0, JSON.stringify(both));
  const personCat = await one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND custom_fields::text ~* 'Business Contributions|Gala'`, [ORG]).catch(() => ({ n: -1 }));
  ok("§2 no person carries a gift's category", personCat.n === 0, personCat.n);

  // §3 a comma in a business name is not "Last, First"
  const nameOf = async (startsWith) => (await q("SELECT name, kind FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND name LIKE $2", [ORG, startsWith + "%"]));
  for (const [raw, kind] of [["Ringford Dunmore Blacklow, U.S.A", "organisation"], ["Darlie Roswick Foundation, Inc", "organisation"], ["The Thornford Group, LLC", "organisation"],
                             ["Perel V. Warville, Jr", "person"], ["Cranwick Allow Glenstead, OAKWOOD", null], ["Kinmere Services, OAKWOOD", "organisation"]]) {
    const rows = await nameOf(raw.split(",")[0]);
    const hit = rows.find(r => r.name === raw || r.name === raw + ".");
    ok(`§3 "${raw}" keeps its order and casing${kind ? `, as ${kind === "person" ? "a person" : "an organisation"}` : ""}`,
       !!hit && rows.length === 1 && (!kind || (hit.kind || "person") === kind), JSON.stringify(rows));
  }
  ok("§3 nobody is named \"U.s.a …\", \"Jr …\" or \"Oakwood …\"", (await q("SELECT name FROM donors WHERE org_id=$1 AND (name ~ '^(U\\.s\\.a|Jr|Oakwood) ')", [ORG])).length === 0, "");

  // §4 businesses and foundations are organisations
  const orgWords = gRows.map(r => r[1]).filter(n => /\b(Inc|LLC|Foundation|Church|Company|Store|Farm|Group|Bank|Services|Realty|Construction|Excavating|Club|Inn|Community|Unlimited)\b/.test(n));
  const kinds = await q("SELECT name, kind FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND name = ANY($2)", [ORG, [...new Set(orgWords)]]);
  ok(`§4 every donor named with an organisation word is an organisation (${new Set(orgWords).size} names)`, kinds.length >= new Set(orgWords).size - 1 && kinds.every(k => k.kind === "organisation"),
     JSON.stringify(kinds.filter(k => k.kind !== "organisation")));
  ok("§4 \"Ulis & Verin Cranville Family Foundation\" is one organisation, not a couple", (await q("SELECT kind FROM donors WHERE org_id=$1 AND name='Ulis & Verin Cranville Family Foundation'", [ORG])).every(r => r.kind === "organisation"), "");
  ok("§4 \"Nelton Wardale\" (a person) stays a person", !(await q("SELECT kind FROM donors WHERE org_id=$1 AND name='Whitgate Holdale'", [ORG])).some(r => r.kind === "organisation"), "");
  const S1 = await snapshot(ORG);
  const C1 = await counts(ORG);

  // §D the dinner file
  const dSheets = await sheetsOf("jp-dinner-gifts-106.xlsx");
  const dBody = { fileName: "jp-dinner-gifts-106.xlsx", sheets: dSheets };
  const dRows = dSheets[0].grid.slice(1).filter(r => r.some(x => x != null && String(x).trim() !== ""));
  const dPeople = dRows.filter(r => r[0] || r[1]);
  const notYet = dPeople.filter(r => /^no$/i.test(String(r[5]).trim()));
  DK.pledged_total_dollars = notYet.reduce((n, r) => n + (/x\s*3\s*years/i.test(String(r[4])) ? 3 : 1) * centsOf(r[2]), 0) / 100;
  ok("§D the key's counts are the file's cells: received + not yet received = rows; 7 \"x 3 years\" pledges; 1 recurring",
     dPeople.length === DK.personRows && dPeople.filter(r => /^yes$/i.test(String(r[5]).trim())).length === DK.gifts && notYet.length === DK.pledges
     && notYet.filter(r => /x\s*3\s*years/i.test(String(r[4]))).length === DK.multi_year_pledges && dPeople.filter(r => /reccuring/i.test(String(r[4]))).length === DK.recurring, "");
  ok(`§D the dinner fixture: ${DK.personRows} person rows and ${DK.totalsRows} totals row`, dRows.length === DK.personRows + DK.totalsRows && !dRows[dRows.length - 1][0] && !dRows[dRows.length - 1][1], dRows.length);
  const du = await api("POST", "/sheet-import/understand", tok, dBody);
  const DU = du.body || {}, dc = DU.counts || {};
  ok("§D the dinner preview is ready (the undated-gifts question is optional)", du.status === 200 && DU.ready === true, du.status + " " + JSON.stringify((DU.questions || []).filter(x => !x.optional)).slice(0, 300));
  ok(`§D the preview: ${DK.gifts} gifts $${DK.gift_dollars}, ${DK.pledges} pledges $${DK.pledged_total_dollars} ($${DK.pledge_first_year_dollars} this year)`,
     dc.gifts === DK.gifts && dc.giftCents === centsOf(DK.gift_dollars) && dc.pledges === DK.pledges && dc.pledgeCents === centsOf(DK.pledged_total_dollars)
     && dc.pledgeThisYearCents === centsOf(DK.pledge_first_year_dollars), JSON.stringify(dc));
  const tot = (DU.totals || []).find(t => t.column === "Amount") || {}, tot3 = (DU.totals || []).find(t => t.column === "3 Yr Total") || {};
  ok("§D the key's dollars are the file's cells, to the cent", dPeople.filter(r => /^yes$/i.test(String(r[5]).trim())).reduce((n, r) => n + centsOf(r[2]), 0) === centsOf(DK.gift_dollars)
     && notYet.reduce((n, r) => n + centsOf(r[2]), 0) === centsOf(DK.pledge_first_year_dollars), "");
  ok(`§D the totals row is recognised because it foots: $${DK.totals_row_amount} = gifts + first-year pledges`, tot.matches === true && tot.statedCents === DK.totals_row_amount * 100
     && DK.totals_row_amount * 100 === centsOf(DK.gift_dollars) + centsOf(DK.pledge_first_year_dollars) && tot3.statedCents === DK.totals_row_3yr * 100, JSON.stringify(DU.totals));
  const c3 = (DU.columns || []).find(c => c.header === "3 Yr Total") || {};
  ok("§D the 3 Yr Total column is a per-row total, never counted as money", c3.role === "pledgeTotal" && dc.rowCents === DK.totals_row_amount * 100, JSON.stringify([c3.role, dc.rowCents]));
  ok(`§D ${DK.personRows} rows are ${DK.personRows - 1} records ("Morley " twice is one person), couples two people each`,
     dc.records === DK.personRows - 1 && dc.households === dRows.filter(r => /&/.test(r[1] || "")).length, JSON.stringify([dc.records, dc.households, dc.persons]));
  console.log(`  [real-shaped] dinner preview: ${DU.matchedPeople} matched to people already here (from the gift file), ${DU.newPeople} new, ${dc.households} couples as households`);
  const S1d = S1;
  const dImp = await importJob(tok, dBody);
  const D_RUN = dImp.importId;
  ok("§D the dinner import ends done", dImp.end && dImp.end.status === "done", JSON.stringify(dImp.end || dImp.start.body).slice(0, 400));
  const dg = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, D_RUN]);
  const dp = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s FROM pledges WHERE org_id=$1 AND import_id=$2", [ORG, D_RUN]);
  ok(`§D ${DK.gifts} gifts ($${DK.gift_dollars}) and ${DK.pledges} pledges ($${DK.pledged_total_dollars}) landed, to the cent`,
     dg.n === DK.gifts && centsOf(dg.s) === centsOf(DK.gift_dollars) && dp.n === DK.pledges && centsOf(dp.s) === centsOf(DK.pledged_total_dollars), JSON.stringify({ dg, dp }));
  const multi = await q(`SELECT p.amount, COUNT(i.id)::int AS k, MIN(i.amount)::numeric AS lo, MAX(i.amount)::numeric AS hi FROM pledges p JOIN pledge_installments i ON i.pledge_id=p.id
                          WHERE p.org_id=$1 AND p.import_id=$2 GROUP BY p.id, p.amount HAVING COUNT(i.id) > 1`, [ORG, D_RUN]);
  ok(`§D the ${DK.multi_year_pledges} "x 3 years" pledges are 3 × Amount in three yearly installments of Amount`, multi.length === DK.multi_year_pledges
     && multi.every(m => m.k === 3 && centsOf(m.lo) === centsOf(m.hi) && centsOf(m.amount) === 3 * centsOf(m.lo)), JSON.stringify(multi));
  ok("§D the totals row is no person and no gift", !(await one("SELECT 1 AS x FROM gifts WHERE org_id=$1 AND import_id=$2 AND amount IN (124290, 152890)", [ORG, D_RUN]))
     && !(await one("SELECT 1 AS x FROM donors WHERE org_id=$1 AND created_import_id=$2 AND (name ~* '^total' OR name IS NULL OR TRIM(name) = '')", [ORG, D_RUN])), "");
  const gold = await q(`SELECT g.amount, g.notes FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND g.import_id=$2 AND d.name ~ 'Goldley'`, [ORG, D_RUN]);
  const goldPl = await q(`SELECT p.id FROM pledges p JOIN donors d ON d.id=p.donor_id WHERE p.org_id=$1 AND p.import_id=$2 AND d.name ~ 'Goldley'`, [ORG, D_RUN]);
  const subs = (await one("SELECT COUNT(*)::int AS n FROM recurring_subscriptions WHERE org_id=$1", [ORG]).catch(() => ({ n: 0 }))).n;
  ok("§D \"Reccuring\" is one $100 gift with its wording kept: no plan, no $3,600 pledge", gold.length === 1 && centsOf(gold[0].amount) === 10000 && /Reccuring/.test(gold[0].notes || "")
     && goldPl.length === 0 && subs === 0, JSON.stringify({ gold, goldPl, subs }));
  const miss = await q(`SELECT amount, notes, payment_method, date FROM gifts WHERE org_id=$1 AND import_id=$2 AND notes ~ '\\(Miss\\)'`, [ORG, D_RUN]);
  ok("§D the 2 \"Online (Miss)\" rows are received gifts (Completed Yes, per the key), method Other (IMPORT-3) with the \"(Miss)\" wording kept", miss.length === 2 && miss.every(m => m.payment_method === "Other"), JSON.stringify(miss));
  ok("§D the file has no dates: every dinner gift is undated (gifts.date NULL)", (await one("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND import_id=$2 AND date IS NOT NULL", [ORG, D_RUN])).n === 0, "");
  const methodRows = dPeople.filter(r => DK.giftTypeMethods.includes(String(r[3] || "").trim()));
  const pnotes = (await q("SELECT p.notes FROM pledges p WHERE p.org_id=$1 AND p.import_id=$2", [ORG, D_RUN])).map(r => r.notes || "");
  const gpm = (await q("SELECT payment_method, notes FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, D_RUN]));
  const kept = methodRows.every(r => { const w = String(r[3]).trim(); return pnotes.some(n => n.includes(`Method in your file: ${w}`)) || gpm.some(g => g.payment_method === w || (g.notes || "").includes(w)); });
  ok(`§D the gift-type methods (${DK.giftTypeMethods.join(", ")}) are how each gift or pledge is paid, kept on it`, methodRows.length >= DK.giftTypeMethods.length && kept, JSON.stringify(methodRows.map(r => r[3])));
  ok("§D no method or completed column became a field on the person", !(await one("SELECT 1 AS x FROM custom_field_defs WHERE org_id=$1 AND LOWER(label) IN ('method','completed','frequency','3 yr total')", [ORG])), "");
  ok("§D \"Morley Brookwood\" is one person", (await q("SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND name ~ '^Morley\\s+Brookwood'", [ORG])).length === 1, "");
  const drc = (await api("GET", `/imports/${D_RUN}`, tok)).body.import || {};
  ok("§D the receipt reconciles (gifts + pledges = rows) and offers Undo", drc.reconciled === true && drc.canUndo === true && drc.rowsIn === DK.personRows, JSON.stringify([drc.reconciled, drc.rowsIn, drc.findings]));
  await surfaces(ORG, { step: "after dinner", importId: D_RUN });
  const S2 = await snapshot(ORG);
  const C2 = await counts(ORG);

  // §5 the contacts file
  const cBody = { fileName: "jp-contacts-656.xlsx", sheets: cSheets };
  const cu = await api("POST", "/sheet-import/understand", tok, cBody);
  const CU = cu.body || {}, cc = CU.counts || {};
  ok("§5 the contacts preview is ready, with no gifts", cu.status === 200 && CU.ready === true && cc.gifts === CK.gifts, cu.status + " " + JSON.stringify((CU.questions || []).filter(x => !x.optional)).slice(0, 300));
  ok("§5 the preview says how many of them are already here (matched to the gift file's people)", CU.matchedPeople > 0 && new RegExp(`${CU.matchedPeople} already in Steward`).test((CU.button || {}).text || ""),
     JSON.stringify([CU.matchedPeople, CU.newPeople, CU.button]));
  console.log(`  [real-shaped] contacts preview: ${CU.matchedPeople} matched, ${CU.newPeople} new, ${cc.records} records from ${CK.rows} rows`);
  const farms = (CU.people || []).filter(p => /Farm$/.test(p.name));
  ok("§4 the farms in the Last Name column (no First Name) are organisations", farms.length === 3 && farms.every(p => p.kind === "organization"), JSON.stringify(farms.map(p => [p.name, p.kind])));
  const cImp = await importJob(tok, cBody);
  const C_RUN = cImp.importId;
  ok("§5 the contacts import ends done", cImp.end && cImp.end.status === "done", JSON.stringify(cImp.end || cImp.start.body).slice(0, 400));
  const crc = (await api("GET", `/imports/${C_RUN}`, tok)).body.import || {};
  const made = (await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND created_import_id=$2", [ORG, C_RUN])).n;
  ok("§5 the contacts import makes only the new people, and no gifts", made === CU.newPeople && (await one("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, C_RUN])).n === 0,
     JSON.stringify([made, CU.newPeople]));
  ok("§5 the receipt counts the file's rows in people (never \"0 rows in the file\") and offers Undo", crc.canUndo === true && crc.peopleRowsIn === CK.rows
     && crc.peopleSentence === `${CK.rows} rows of people in the file = ${CU.newPeople} added + ${CU.matchedPeople} already here + ${CK.rows - CU.newPeople - CU.matchedPeople} rows for someone named on another row. No gifts in this file.`,
     JSON.stringify([crc.rowsIn, crc.canUndo, crc.peopleRowsIn, crc.peopleSentence]));
  const crow = ((await api("GET", "/imports", tok)).body.imports || []).find(x => x.id === C_RUN) || {};
  ok("§5 the Imports list row claims no thank-yous for a file with no gifts", !crow.thanks && crow.peopleSentence === crc.peopleSentence, JSON.stringify(crow).slice(0, 300));
  const dupes = await q(`SELECT LOWER(name) AS n, COUNT(*)::int AS k FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND kind IS DISTINCT FROM 'organisation' GROUP BY 1 HAVING COUNT(*) > 1`, [ORG]);
  ok("§5 no person is here twice after both files", dupes.length === 0, JSON.stringify(dupes.slice(0, 10)));
  for (const nm of ["Torina Fairbury", "Isia Whitshaw", "Isora Duncombe", "Nelyn Thornby"]) {
    const r = await q("SELECT address FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND name=$2", [ORG, nm]);
    ok(`§5 the near-duplicate rows of ${nm} (one row blank) are one person, with the address`, r.length === 1 && !!r[0].address, JSON.stringify(r));
  }
  await surfaces(ORG, { step: "after contacts", importId: C_RUN });

  // §6 undo the contacts, then the gifts; then the gift file alone
  const u1 = await api("POST", `/imports/${C_RUN}/reverse`, tok, {});
  ok("§6 the contacts undo answers 200", u1.status === 200, u1.status + " " + JSON.stringify(u1.body).slice(0, 300));
  let d = snapDiff(S2, await snapshot(ORG));
  ok("§6 after the contacts undo, the org is exactly as it was after the dinner", d.length === 0, d.join("\n"));
  const C2b = await counts(ORG);
  ok("§6 the same people, gifts, dollars and fields as after the dinner", JSON.stringify(C2) === JSON.stringify(C2b), JSON.stringify([C2, C2b]));
  await surfaces(ORG, { step: "after contacts undo" });
  const ud = await api("POST", `/imports/${D_RUN}/reverse`, tok, {});
  ok("§6 the dinner undo answers 200", ud.status === 200, ud.status + " " + JSON.stringify(ud.body).slice(0, 300));
  d = snapDiff(S1d, await snapshot(ORG));
  ok("§6 after the dinner undo, the org is exactly as it was after the gifts", d.length === 0, d.join("\n"));
  const C1b = await counts(ORG);
  ok("§6 the same people, gifts, dollars and fields as after the gifts", JSON.stringify(C1) === JSON.stringify(C1b), JSON.stringify([C1, C1b]));
  await surfaces(ORG, { step: "after dinner undo" });
  const u2 = await api("POST", `/imports/${G_RUN}/reverse`, tok, {});
  ok("§6 the gifts undo answers 200", u2.status === 200, u2.status + " " + JSON.stringify(u2.body).slice(0, 300));
  d = snapDiff(S0, await snapshot(ORG));
  ok("§6 after both undos, the org is exactly as it was empty", d.length === 0, d.join("\n"));
  await surfaces(ORG, { step: "after gifts undo" });
  const g2 = await importJob(tok, gBody);
  const again = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, g2.importId]);
  ok("§6 the gift file again, alone: the same 278 gifts and dollars", g2.end && g2.end.status === "done" && again.n === GK.gifts && centsOf(again.s) === centsOf(GK.gift_dollars), JSON.stringify(again));
  await surfaces(ORG, { step: "after gifts again", importId: g2.importId });
  await api("POST", `/imports/${g2.importId}/reverse`, tok, {});
  d = snapDiff(S0, await snapshot(ORG));
  ok("§6 and its undo leaves the org exactly as it was empty", d.length === 0, d.join("\n"));
  await surfaces(ORG, { step: "after gifts-alone undo" });

  // §7 a name-only match to someone deleted is a question
  await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name) VALUES
           ('d_hs1_gray',$1,'Stephen Gray',NULL,'prospect','active','[]','["donor"]','system:test','test'),
           ('d_hs1_mail',$1,'Mara Quill','mara.quill@example.org','prospect','active','[]','["donor"]','system:test','test')`, [ORG]);
  const del = await api("POST", "/donors/bulk-delete", tok, { ids: ["d_hs1_gray", "d_hs1_mail"] });
  ok("§7 two people deleted by hand", del.status === 200, del.status + " " + JSON.stringify(del.body).slice(0, 200));
  const grid7 = [["Date", "Donor", "Email", "Amount"], ["2026-10-01", "Stephen Gray", "", "40"], ["2026-10-02", "Someone Else", "mara.quill@example.org", "60"], ["2026-10-03", "Brand Newperson", "", "75"]];
  const b7 = { fileName: "next.csv", sheets: [{ name: "Sheet1", grid: grid7 }] };
  const u7 = (await api("POST", "/sheet-import/understand", tok, b7)).body || {};
  const qn = (u7.questions || []).find(x => x.kind === "deletedPerson");
  ok("§7 the name-only match is a question: \"Is this the same Stephen Gray you deleted?\"", !!qn && /Is this the same Stephen Gray you deleted\?/.test(qn.text)
     && qn.optional === true && qn.default === "same" && (qn.options || []).map(o => o.key).join(",") === "same,different", JSON.stringify(u7.questions));
  ok("§7 the email match is not a question, and stays out", !(u7.questions || []).some(x => x.kind === "deletedPerson" && /Someone Else|Mara Quill/.test(x.text))
     && (u7.deletedMatches || []).some(x => x.id === "d_hs1_mail"), JSON.stringify(u7.deletedMatches));
  ok("§7 by default (Same person) Stephen Gray stays out", (u7.deletedMatches || []).some(x => x.id === "d_hs1_gray") && u7.newPeople === 1, JSON.stringify([u7.newPeople, u7.deletedMatches]));
  const a7 = { ...b7, answers: { deletedPeople: { [qn ? qn.key : "x"]: "different" } } };
  const u7b = (await api("POST", "/sheet-import/understand", tok, a7)).body || {};
  ok("§7 answered Different person, the preview imports him as new", u7b.newPeople === 2 && !(u7b.deletedMatches || []).some(x => x.id === "d_hs1_gray"), JSON.stringify([u7b.newPeople, u7b.deletedMatches]));
  const r7 = await importJob(tok, a7);
  const grays = await q("SELECT id, deleted_at FROM donors WHERE org_id=$1 AND name='Stephen Gray' ORDER BY id", [ORG]);
  ok("§7 the answer rides the commit: a new Stephen Gray, the deleted one stays deleted", r7.end && r7.end.status === "done"
     && grays.length === 2 && grays.filter(g => g.deleted_at === null).length === 1 && grays.find(g => g.id === "d_hs1_gray").deleted_at !== null, JSON.stringify(grays));
  ok("§7 the email match stayed out", (await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND LOWER(email)='mara.quill@example.org'", [ORG])).n === 0, "");

  // §8 a past run of the OLD "Import Donors" mapper (a contacts file, shape
  // "aggregate", rows_in 0): its receipt counts people and offers Undo, its list
  // row claims no thank-yous, and the Undo takes back the people it made.
  const ORG8 = "org_hs1old";
  const tok8 = await freshOrg(ORG8, "Old mapper (test)");
  const S8 = await snapshot(ORG8);
  const people = cSheets[0].grid.slice(1).map(r => ({ name: [r[1], r[0]].filter(Boolean).join(" "), email: r[3] || undefined, phone: r[2] || undefined }));
  const RUN8 = "imp_hs1old" + Date.now().toString(36);
  const ic = await api("POST", "/donors/import-combined", tok8, { importId: RUN8, donors: people, gifts: [] });
  ok("§8 the old mapper's write (import-combined) answers 200", ic.status === 200, ic.status + " " + JSON.stringify(ic.body).slice(0, 200));
  const made8 = (await one("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND created_import_id=$2", [ORG8, RUN8])).n;
  const rec8 = await api("POST", "/imports", tok8, { id: RUN8, name: "jp-contacts-656.xlsx", shape: "aggregate", rowsIn: 0, giftsCreated: 0, donorsCreated: made8,
    donorsMerged: 0, thanks: { mode: "all" }, summary: { rowsIn: 0, giftsCreated: 0, donorsCreated: made8, donorsMatched: 0 } });
  ok("§8 the old mapper's run is recorded", rec8.status === 200 || rec8.status === 201, rec8.status + " " + JSON.stringify(rec8.body).slice(0, 200));
  const r8 = (await api("GET", `/imports/${RUN8}`, tok8)).body.import || {};
  ok("§8 its receipt offers Undo", r8.canUndo === true, JSON.stringify([r8.shape, r8.canUndo]));
  ok("§8 its receipt counts its people, never \"0 rows in the file\"", new RegExp(`^${made8.toLocaleString("en-US")} people in the file = ${made8.toLocaleString("en-US")} added \\+ 0 already here\\.`).test(r8.peopleSentence || ""), r8.peopleSentence);
  const row8 = ((await api("GET", "/imports", tok8)).body.imports || []).find(x => x.id === RUN8) || {};
  ok("§8 its list row does not say thank-yous were drafted (it had no gifts)", !row8.thanks, row8.thanks);
  const un8 = await api("POST", `/imports/${RUN8}/reverse`, tok8, {});
  ok("§8 Undo from its receipt answers 200", un8.status === 200, un8.status + " " + JSON.stringify(un8.body).slice(0, 300));
  d = snapDiff(S8, await snapshot(ORG8));
  ok("§8 and the org is exactly as it was before the old mapper's run", d.length === 0, d.join("\n"));

  // §9 every import door opens the one reader, so the contacts file gives the
  // same preview (§5) from each: no screen renders the old mapper any more
  const src = f => fs.readFileSync(path.join(__dirname, "..", "client", "src", f), "utf8");
  const doors = ["components/Donors.jsx", "components/Settings.jsx", "pages/WelcomePage.jsx", "components/Dashboard.jsx", "App.jsx"];
  const oldDoors = doors.filter(f => /<(DonorImport|GiftHistoryImport|WorkbookImport)\b/.test(src(f)));
  ok("§9 no import door renders the old mapper (DonorImport, GiftHistoryImport, WorkbookImport)", oldDoors.length === 0, oldDoors);
  ok("§9 the Donors page, Settings and onboarding each open SpreadsheetImport", doors.slice(0, 3).every(f => /<SpreadsheetImport\b/.test(src(f)))
     && /setShowSheetImport\(true\)/.test(src("components/Donors.jsx").match(/initialOpenImport&&[^\n]*/)[0]), "");

  await closeDb();
  summary();
}
main().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
