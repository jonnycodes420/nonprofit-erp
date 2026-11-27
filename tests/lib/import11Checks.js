// tests/lib/import11Checks.js · IMPORT-11, run by tests/real-shaped.test.js (§I11).
// What comes in through import is what Steward shows everywhere. Fakes only,
// every name made up (tests/fixtures/import/import11/make.cjs writes the
// workbook and its answer key, never from the reader).
//
//   §I11.1 a two-sheet workbook (Read Me, Donors keyed by Constituent ID, Gifts
//          keyed by it with no name column and a TOTAL row, a decoy sheet):
//          "60 people and 136 gifts ($8,005.00) joined on Constituent ID", the
//          TOTAL row and the two other sheets set aside by name, the sheet
//          picker can leave Gifts out, and the import writes 136 gifts, $8,005.00.
//   §I11.2 a gift over $100,000,000 is set aside on import with its line and the
//          sentence; the gift form refuses it in the same words; the database
//          refuses a write of one by any door; the receipt's footing reads the
//          file's real dollars, never "File $0".
//   §I11.3 a gift far outside the pattern asks on the form ("This is 81,000 times
//          their usual gift and 20 times the largest gift your org has. Record
//          it?"), saves only on "Record it"; on import it is listed and can be set aside.
//   §I11.4 ten exact copies are flagged with their lines, skipped by default and
//          imported on "Import them anyway", counted on the receipt either way.
//   §I11.5 future-dated rows are listed with their dates; the Giving summary's
//          sentence says the real date; a scheduled gift has no thank-you draft,
//          no thank-you task, and refuses a refund until its date.
//
// HOW IT GOES RED ON MAIN: the workbook reads "60 contacts" and no gifts; the
// $1,000,000,000 row is written and the receipt reads "File $0"; the form says
// `amount is not a valid money amount`; the $10,000,000 edit saves at once; the
// copies are ten more gifts; the 2031 gift reads "the next Jan 1".
"use strict";
const fs = require("fs");
const path = require("path");
const { dayOffset, civilDay } = require("../clock");

const FX = path.join(__dirname, "..", "fixtures", "import", "import11");
const KEY = JSON.parse(fs.readFileSync(path.join(FX, "expected.json"), "utf8"))["people-and-gifts.xlsx"];
const centsOf = v => Math.round(Number(v || 0) * 100);

async function import11({ ok, api, q, freshOrg, importJob, surfaces, XLSX, drainQueue }) {
  const one = async (sql, args) => (await q(sql, args))[0];
  const R = await import("../../shared/sheetRead.js");

  // ── §I11.1 the two-sheet workbook ──────────────────────────────────────────
  {
    const ORG = "org_i11book";
    const tok = await freshOrg(ORG, "Import 11 workbook (test)");
    const sheets = R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(FX, "people-and-gifts.xlsx")), { type: "buffer", cellDates: true }), XLSX);
    const body = { fileName: "people-and-gifts.xlsx", sheets };
    const u = (await api("POST", "/sheet-import/understand", tok, body)).body || {};
    const c = u.counts || {};
    ok(`§I11.1 the preview: "${KEY.people} people and ${KEY.gifts} gifts ($8,005.00) joined on Constituent ID"`,
      u.joinSentence === `${KEY.people} people and ${KEY.gifts} gifts ($8,005.00) joined on ${KEY.joinedOn}.` && c.people === KEY.people && c.gifts === KEY.gifts && c.giftCents === KEY.giftCents,
      JSON.stringify([u.joinSentence, c.people, c.gifts, c.giftCents]));
    const asideSheets = (u.sheetsSetAside || []).map(x => x.sheet).sort();
    const total = (u.totals || []).find(t => t.sheet === KEY.totalRowSheet);
    ok("§I11.1 the TOTAL row is checked and set aside, and Read Me and the decoy sheet are set aside by name",
      JSON.stringify(asideSheets) === JSON.stringify([...KEY.setAsideSheets].sort()) && total && total.matches === true && total.statedCents === KEY.giftCents
      && (u.rowLedger || {}).balanced === true, JSON.stringify([asideSheets, total, (u.rowLedger || {}).balanced]));
    const left = (await api("POST", "/sheet-import/understand", tok, { ...body, answers: { sheetKinds: { Gifts: "skip" } } })).body || {};
    ok("§I11.1 the sheet picker can leave Gifts out: no gifts, and Gifts is set aside by name",
      (left.counts || {}).gifts === 0 && (left.sheetsSetAside || []).some(x => x.sheet === "Gifts" && /left it out/.test(x.reason)), JSON.stringify([(left.counts || {}).gifts, left.sheetsSetAside]));
    const imp = await importJob(tok, body);
    const landed = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s, COUNT(DISTINCT donor_id)::int AS p FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, imp.importId]);
    ok(`§I11.1 the import writes ${KEY.gifts} gifts that foot to the cent ($8,005.00) on their people`,
      imp.end && imp.end.status === "done" && landed.n === KEY.gifts && centsOf(landed.s) === KEY.giftCents && landed.p === KEY.people, JSON.stringify([imp.end && imp.end.status, landed]));
    await surfaces(ORG, { step: "§I11.1 after the workbook", importId: imp.importId, token: tok });
  }

  // ── §I11.2, §I11.4, §I11.5 one CSV of edge rows ────────────────────────────
  const ORG = "org_i11rows";
  const tok = await freshOrg(ORG, "Import 11 rows (test)");
  const soon = dayOffset(60), far = "2031-01-01";
  const grid = [["Donor ID", "Name", "Amount", "Date", "Fund", "Note"]];
  for (let i = 0; i < 20; i++) grid.push([`D${100 + i}`, `Pat Quillfeather${String.fromCharCode(65 + i)}`, `$${50 + i}.00`, `2025-0${1 + (i % 9)}-15`, "General", ""]);
  grid.push(["D900", "Edge Overcap", "$1,000,000,000.00", "2025-05-05", "General", "too big"]);   // line 22
  for (let i = 0; i < 10; i++) grid.push(grid[1 + i].slice());                                      // lines 23-32: copies of 2-11
  grid.push(["D901", "Fran Laterday", "$1,234.56", far, "General", ""]);                              // line 33
  grid.push(["D902", "Sol Soonday", "$75.00", soon, "General", ""]);                                  // line 34
  const sheets = [{ name: "Sheet1", grid }];
  const body = { fileName: "edge-rows.csv", sheets };
  const u = (await api("POST", "/sheet-import/understand", tok, body)).body || {};
  const rc = u.rowChecks || {};
  const capRow = (u.aside || []).find(a => a.line === 22) || {};
  ok("§I11.2 the $1,000,000,000 row is set aside with its line and \"over $100,000,000, the most one gift can be in Steward\"",
    capRow.reason === "over $100,000,000, the most one gift can be in Steward" && rc.overCap && rc.overCap.rows.some(r => r.line === 22)
    && !(u.gifts || []).some(g => g.line === 22), JSON.stringify([capRow, rc.overCap]));
  ok("§I11.4 \"10 rows are exact copies of another row\", with their line numbers",
    rc.copies && rc.copies.count === 10 && rc.copies.sentence.startsWith("10 rows are exact copies of another row: row 23 (copy of row 2)")
    && rc.copies.rows.map(r => r.line).join() === "23,24,25,26,27,28,29,30,31,32" && rc.copies.imported === false, String(JSON.stringify(rc.copies)).slice(0, 400));
  ok("§I11.5 the preview lists the future-dated rows with their dates",
    rc.future && rc.future.count === 2 && rc.future.from === soon && rc.future.to === far && rc.future.rows.map(r => r.date).sort().join() === [soon, far].join(),
    JSON.stringify(rc.future));
  const imp = await importJob(tok, body);
  const landed = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s, MAX(amount)::numeric AS mx FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, imp.importId]);
  const fileCents = (20 * 50 + 190) * 100 + 123456 + 7500;   // the 20 originals ($50..$69), the two future gifts
  ok("§I11.2/4 the import writes 22 gifts: no copy and nothing over the cap", imp.end && imp.end.status === "done" && landed.n === 22 && centsOf(landed.s) === fileCents && centsOf(landed.mx) < 100_000_000_00,
    JSON.stringify([imp.end && imp.end.status, landed, fileCents]));
  const rec = (await api("GET", `/imports/${imp.importId}`, tok)).body.import || {};
  const foot = JSON.stringify(rec.footing || rec.dollarsSentence || rec);
  ok("§I11.2 the receipt's footing reads the file's real dollars, never \"File $0\"", !/File \$0 /.test(foot) && /File \$1,000,0/.test(foot), foot.slice(0, 600));
  const sum = (await one("SELECT summary_json FROM imports WHERE id=$1", [imp.importId])).summary_json;
  const srch = (typeof sum === "string" ? JSON.parse(sum) : sum).rowChecks || {};
  ok("§I11.4 the receipt counts the copies (skipped) and the future-dated gifts", srch.copies && srch.copies.count === 10 && srch.copies.imported === false && srch.future && srch.future.count === 2, String(JSON.stringify(srch)).slice(0, 300));
  const vf = (await api("GET", `/imports/${imp.importId}/verify`, tok)).body || {};
  ok("§I11.5 the import check page's headline is the file's money, and it counts the copies",
    vf.money && vf.money.fileCents > 0 && !/^Your file: \$0\.00/.test(vf.money.sentence) && vf.rowChecks && vf.rowChecks.copies.count === 10, JSON.stringify([vf.money && vf.money.sentence, vf.rowChecks && vf.rowChecks.copies && vf.rowChecks.copies.count]));
  await surfaces(ORG, { step: "§I11 after the edge rows", importId: imp.importId, token: tok });

  // "Import them anyway" writes the ten copies, and the receipt counts them as imported
  const undo = await api("POST", `/imports/${imp.importId}/reverse`, tok, { confirm: true });
  const again = await importJob(tok, { ...body, answers: { copies: "import" } });
  const n2 = await one("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, again.importId]);
  const s2 = (await one("SELECT summary_json FROM imports WHERE id=$1", [again.importId])).summary_json;
  const rc2 = (typeof s2 === "string" ? JSON.parse(s2) : s2).rowChecks || {};
  ok("§I11.4 \"Import them anyway\" writes the ten copies, and the receipt counts them as imported",
    undo.status === 200 && n2.n === 32 && rc2.copies && rc2.copies.count === 10 && rc2.copies.imported === true, JSON.stringify([undo.status, n2, rc2.copies && rc2.copies.imported]));
  if (drainQueue) await drainQueue();

  // §I11.5 a scheduled gift: no thank-you draft, no thank-you task, no refund, the real date said
  const sched = await q(`SELECT g.id, g.donor_id, g.scheduled_on FROM gifts g WHERE g.org_id=$1 AND g.import_id=$2 AND g.scheduled_on IS NOT NULL ORDER BY g.scheduled_on`, [ORG, again.importId]);
  const ids = sched.map(r => r.id);
  const drafts = await one("SELECT COUNT(*)::int AS n FROM thank_you_drafts WHERE org_id=$1 AND gift_id = ANY($2::text[])", [ORG, ids]);
  const tasks = await one("SELECT COUNT(*)::int AS n FROM tasks WHERE org_id=$1 AND donor_id = ANY($2::text[]) AND (title ILIKE '%thank%')", [ORG, sched.map(r => r.donor_id)]);
  ok("§I11.5 the two future-dated gifts are scheduled, with no thank-you draft and no thank-you task",
    sched.length === 2 && sched[1].scheduled_on === far && drafts.n === 0 && tasks.n === 0, JSON.stringify([sched, drafts, tasks]));
  // the gift form too: a gift typed for 60 days out gets no draft and no task
  const sol = (await one("SELECT donor_id FROM gifts WHERE id=$1", [ids[0]])).donor_id;
  const typed = await api("POST", `/donors/${sol}/gifts`, tok, { amount: "80", date: soon, type: "cash" });
  if (drainQueue) await drainQueue();
  const typedId = typed.body && typed.body.gift && typed.body.gift.id;
  const tDraft = await one("SELECT COUNT(*)::int AS n FROM thank_you_drafts WHERE org_id=$1 AND gift_id=$2", [ORG, typedId || ""]);
  const refund = await api("POST", `/gifts/${ids[1]}/refund`, tok, { amount: "1234.56", reason: "test" });
  ok("§I11.5 a typed scheduled gift gets no draft, and a scheduled gift refuses a refund until its date",
    typed.status === 201 && tDraft.n === 0 && refund.status === 409 && refund.body.error === "scheduled", JSON.stringify([typed.status, tDraft, refund.status, refund.body]));
  const fran = (await one("SELECT donor_id FROM gifts WHERE id=$1", [ids[1]])).donor_id;
  const rail = (await api("GET", `/donors/${fran}/rail`, tok)).body || {};
  ok("§I11.5 the profile's rail lists no thank-you for a gift that has not come in", Array.isArray(rail.thankYous) && !rail.thankYous.some(t => ids.includes(t.giftId)),
    JSON.stringify(rail.thankYous));
  const SC = require("../../shared/numbers/scheduled");
  const line = await SC.scheduledLine((sql, args) => q(sql.replace(/\?/g, (() => { let i = 0; return () => `$${++i}`; })()), args), ORG);
  ok(`§I11.5 the Giving summary says the real dates ("from ${soon} … to Jan 1, 2031"), never "the next Jan 1"`,
    line && /dated from .+ to Jan 1, 2031/.test(line.sentence) && !/the next/.test(line.sentence), line && line.sentence);

  // ── §I11.2 the form and the database refuse a gift over the cap ────────────
  const big = await api("POST", `/donors/${sol}/gifts`, tok, { amount: "1000000000", date: civilDay(), type: "cash" });
  ok("§I11.2 the gift form refuses $1,000,000,000 in the same words",
    big.status === 400 && big.body.error === "This gift is over $100,000,000, the most one gift can be in Steward.", JSON.stringify([big.status, big.body]));
  let dbRefused = false;
  try { await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, created_by, created_by_name) VALUES ('g_i11cap', $1, $2, 1000000000, $3, 'system:test', 'test')`, [ORG, sol, civilDay()]); }
  catch (e) { dbRefused = /ck_gifts_amount_within_cap/.test(e.message); }
  ok("§I11.2 the guard: no write path can store an amount toCents cannot read (the database refuses it)", dbRefused, dbRefused);

  // ── §I11.3 a gift far outside the pattern asks first ───────────────────────
  {
    const ORG3 = "org_i11outlier";
    const tok3 = await freshOrg(ORG3, "Import 11 outlier (test)");
    const edge = (await api("POST", "/donors", tok3, { name: "Edge Smallgift", email: "edge@i11.test" })).body;
    const big3 = (await api("POST", "/donors", tok3, { name: "Bea Largegift", email: "bea@i11.test" })).body;
    const g1 = await api("POST", `/donors/${edge.id}/gifts`, tok3, { amount: "123.45", date: "2025-03-01", type: "cash" });
    const g2 = await api("POST", `/donors/${big3.id}/gifts`, tok3, { amount: "500000", date: "2025-04-01", type: "cash", confirmFarOutside: true });
    ok("§I11.3 the two gifts the pattern is made of are saved", g1.status === 201 && g2.status === 201, JSON.stringify([g1.status, g2.status, g1.body]).slice(0, 300));
    const gid = g1.body && g1.body.gift && g1.body.gift.id;
    // on import: the row is listed under its own heading, and "set them aside" sets it aside
    const ob = { fileName: "outlier.csv", sheets: [{ name: "Sheet1", grid: [["Name", "Email", "Amount", "Date"], ["Bea Largegift", "bea@i11.test", "$480.00", "2025-06-01"], ["Cy Newcomer", "cy@i11.test", "$400,000,000.00", "2025-06-02"]] }] };
    const capped = (await api("POST", "/sheet-import/understand", tok3, ob)).body || {};
    const ob2 = { fileName: "outlier.csv", sheets: [{ name: "Sheet1", grid: [["Name", "Email", "Amount", "Date"], ["Bea Largegift", "bea@i11.test", "$480.00", "2025-06-01"], ["Edge Smallgift", "edge@i11.test", "$9,000,000.00", "2025-06-02"]] }] };
    const ou = (await api("POST", "/sheet-import/understand", tok3, ob2)).body || {};
    const orow = ou.rowChecks && ou.rowChecks.outliers && ou.rowChecks.outliers.rows.find(r => r.line === 3);
    const skip = (await api("POST", "/sheet-import/understand", tok3, { ...ob2, answers: { outliers: "skip", outlierRows: ["Sheet1:3"] } })).body || {};
    ok("§I11.3 the import preview lists a gift far outside the pattern, and \"set them aside\" sets it aside",
      !!orow && (ou.counts || {}).gifts === 2 && (skip.counts || {}).gifts === 1 && (skip.aside || []).some(a => a.line === 3 && a.outlier) && (capped.rowChecks || {}).overCap,
      JSON.stringify([orow, (ou.counts || {}).gifts, (skip.counts || {}).gifts]));
    const asked = await api("PUT", `/gifts/${gid}`, tok3, { amount: "10000000" });
    const still = await one("SELECT amount::numeric AS a FROM gifts WHERE id=$1", [gid]);
    ok("§I11.3 the edit to $10,000,000 asks \"This is 81,000 times their usual gift and 20 times the largest gift your org has. Record it?\" and saves nothing",
      asked.status === 409 && asked.body.code === "far_outside" && asked.body.sentence === "This is 81,000 times their usual gift and 20 times the largest gift your org has. Record it?"
      && centsOf(still.a) === 12345, JSON.stringify([asked.status, asked.body, still]));
    const yes = await api("PUT", `/gifts/${gid}`, tok3, { amount: "10000000", confirmFarOutside: true });
    const now = await one("SELECT amount::numeric AS a FROM gifts WHERE id=$1", [gid]);
    ok("§I11.3 \"Record it\" saves it", yes.status === 200 && centsOf(now.a) === 1_000_000_000, JSON.stringify([yes.status, now]));
  }
}

module.exports = { import11 };
