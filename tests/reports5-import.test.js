// REPORTS-5 · OLD REPORTS COME IN AS THEY WERE, AND NEVER AS GIFTS.
//
// The one test this build earns, because it guards money figures a board reads
// and the line between an old system's numbers and the org's own giving:
//   1. a CSV giving summary is read, guessed and mapped, and comes in as
//      historical totals that foot to the file to the cent (and to the file's
//      own Total line, which is set aside, not added twice);
//   2. it shows on the three-year comparison for a year Steward has no gifts
//      for, labelled as from the old system, opening rows that foot;
//   3. nothing it brings in is a gift or a person;
//   4. an image-only PDF is kept as a file, said to be a scan, and its numbers
//      are refused (no OCR guessing);
//   5. undo takes back every file and every total in one step.
//
// WHAT WOULD MAKE THIS FAIL (planted before it was trusted):
//   · totalsFromTable adds the Total line in → "foots to the file" goes red;
//   · readPdf stops calling a text-less PDF scanned → "a scan's numbers are
//     refused" goes red;
//   · the undo route forgets historical_totals → "undo takes the totals" red.
//
//   BASE=http://localhost:5601 node tests/reports5-import.test.js
const bcrypt = require("bcryptjs");
const PDFDocument = require("pdfkit");
const { ok, summary, q, closeDb, login, api } = require("./helpers");
const FS = require("../figureSources");

const ORG = "org_r5import";
const ADMIN = "director@r5import.local";
const Y = new Date().getFullYear();
const OLD = Y - 6;             // a year Steward has no gifts for
const VIEW = OLD + 2;          // the three-year comparison that ends two years later

async function clear(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}
const dataUrl = (type, buf) => `data:${type};base64,${Buffer.from(buf).toString("base64")}`;
function pdf(draw) {
  return new Promise(resolve => {
    const doc = new PDFDocument({ size: "LETTER" }); const bufs = [];
    doc.on("data", b => bufs.push(b)); doc.on("end", () => resolve(Buffer.concat(bufs)));
    draw(doc); doc.end();
  });
}

(async () => {
  console.log("reports5-import");
  await clear(ORG);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Old Reports Harbour','r5import',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_r5_admin',$1,$2,$3,'Dana Importer','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,kind,stage,created_by,created_by_name) VALUES ('d_r5_now',$1,'Nora Nowgiver','individual','steward','system:test','test')`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g_r5_1',$1,'d_r5_now',250.00,$2,'cash')`, [ORG, `${VIEW}-05-05`]);
  const tok = await login(ADMIN);
  const counts = async () => (await q(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS g, (SELECT COUNT(*) FROM donors WHERE org_id=$1)::int AS d`, [ORG]))[0];
  const before = await counts();

  // ── 1. a CSV giving summary: read, guessed, mapped, footed ──────────────
  const csv = [
    "Fiscal Year,Gift Total,# of Gifts,Donors",
    `${OLD},"$184,250.17",412,233`,
    `${OLD - 1},"$166,004.83",398,221`,
    `Total,"$350,255.00",810,`,
  ].join("\r\n") + "\r\n";
  const csvFile = { fileName: `donorperfect-giving-summary-${OLD}.csv`, file: dataUrl("text/csv", csv) };
  const read = await api("POST", "/old-reports/read", tok, csvFile);
  ok("the CSV is read, writing nothing", read.status === 200 && read.body.readable === true && read.body.wrote === false, read.body);
  ok("its kind is guessed: a giving summary", read.body.kind === "giving_summary", read.body.why);
  ok("its system is recognised by name: DonorPerfect", read.body.system === "donorperfect", read.body.why);
  ok("the guess says why, in one line", /^Giving summary, from DonorPerfect: /.test(read.body.why) && !/\n/.test(read.body.why), read.body.why);
  const mapping = read.body.mapping;
  ok("the columns are mapped the way a person would", mapping.amount === 1 && mapping.period === 0 && mapping.gifts === 2 && mapping.donors === 3, mapping);

  const batch = await api("POST", "/old-reports/batches", tok, {});
  ok("an import starts", batch.status === 201 && batch.body.id, batch.body);
  const put = await api("POST", `/old-reports/batches/${batch.body.id}/files`, tok, { ...csvFile, kind: "giving_summary", system: "donorperfect", pull: true, mapping });
  ok("the file is kept and its numbers pulled in", put.status === 201 && put.body.kept && put.body.totals && put.body.totals.count === 2, put.body);
  ok("the totals foot to the file to the cent", put.body.totals.cents === 18425017 + 16600483, put.body.totals);
  ok("…and to the file's own Total line, which was set aside, not added twice",
    put.body.totals.fileTotal === 35025500 && put.body.totals.footsToFile === true && put.body.totals.setAside.includes("total line"), put.body.totals);
  // A by-fund table has no year on each line: the period is the file's, so
  // only the Total rule keeps its Total line from being counted twice.
  const fund = await api("POST", "/old-reports/preview", tok, { periodFrom: `${OLD}-01-01`, periodTo: `${OLD}-12-31`, mapping: { label: 0, amount: 1 },
    table: { headers: ["Fund Description", "Gift Total"], rows: [["General", "$1,000.10"], ["Scholarships", "$2,000.20"], ["Total", "$3,000.30"]] } });
  ok("a by-fund file's Total line is set aside: two totals, $3,000.30, matching the file",
    fund.body.ok && fund.body.count === 2 && fund.body.cents === 300030 && fund.body.footsToFile === true && fund.body.wrote === false, fund.body);
  const sheetId = put.body.sheetId;
  const f = await FS.footCheck(ORG, { key: "historical-totals", params: { from: "1900-01-01", to: "2999-12-31", sheet: sheetId } });
  ok("the imported rows open and foot to their figure", f.foots && f.value === 350255 && f.rowsCount === 2, f);

  // ── 2. on the three-year comparison, labelled ──────────────────────────
  const ty = await api("GET", `/reports/three-year?year=${VIEW}&yearMode=calendar`, tok);
  const oldYear = (ty.body.years || []).find(y => y.year === OLD);
  ok("the three-year comparison has the old year", !!oldYear, ty.body.years);
  ok("Steward has no gifts for it", oldYear && oldYear.total === 0, oldYear);
  ok("and shows the old system's total for it, labelled, to the cent",
    oldYear && oldYear.imported && oldYear.imported.value === 184250.17 && /From your old system: DonorPerfect/.test(oldYear.imported.note), oldYear && oldYear.imported);
  const fy = oldYear && oldYear.imported ? await FS.footCheck(ORG, oldYear.imported.source) : null;
  ok("…which opens rows that foot to it", fy && fy.foots && fy.value === 184250.17, fy);
  const nowYear = (ty.body.years || []).find(y => y.year === VIEW);
  ok("a year with Steward's own gifts shows only Steward's", nowYear && nowYear.total === 250 && !nowYear.imported, nowYear);

  // ── 3. never a gift, never a person ─────────────────────────────────────
  const after = await counts();
  ok("no gift and no person was made", after.g === before.g && after.d === before.d, { before, after });

  // ── 4. an image-only PDF is kept, and its numbers are refused ──────────
  const scan = await pdf(doc => { doc.rect(60, 60, 400, 300).fill("#777777"); doc.rect(80, 80, 200, 40).fill("#222222"); });
  const scanFile = { fileName: `board-report-${OLD}-scanned.pdf`, file: dataUrl("application/pdf", scan) };
  const sr = await api("POST", "/old-reports/read", tok, scanFile);
  ok("an image-only PDF is read as a scan", sr.status === 200 && sr.body.scanned === true && sr.body.readable === false && /is a scan/.test(sr.body.sentence), sr.body);
  const pullScan = await api("POST", `/old-reports/batches/${batch.body.id}/files`, tok, { ...scanFile, kind: "board_report", system: "spreadsheet", pull: true, mapping: { amount: 0 } });
  ok("a scan's numbers are refused (no OCR guessing)", pullScan.status === 400 && pullScan.body.error === "unreadable", pullScan.body);
  const keepScan = await api("POST", `/old-reports/batches/${batch.body.id}/files`, tok, { ...scanFile, kind: "board_report", system: "spreadsheet", pull: false });
  ok("…and the scan is kept as a file", keepScan.status === 201 && keepScan.body.kept && keepScan.body.scanned === true && !keepScan.body.totals, keepScan.body);
  const fileBack = await fetch(`${process.env.BASE || "http://localhost:5601"}/sheets/${keepScan.body.sheetId}/file`, { headers: { authorization: "Bearer " + tok } });
  ok("…exactly as it came", fileBack.status === 200 && Buffer.from(await fileBack.arrayBuffer()).equals(scan));
  const list = await api("GET", "/old-reports", tok);
  ok("both are listed under Past reports, by year and kind", (list.body.reports || []).length === 2 && list.body.reports.every(r => r.year === String(OLD)), list.body.reports);
  const found = await api("GET", `/search?q=${encodeURIComponent("scanned")}`, tok);
  ok("the kept PDF is found in search", (found.body.results || []).some(r => r.kind === "boardFile" && r.id === keepScan.body.sheetId), found.body.results);

  // ── 5. undo takes everything back, in one step ──────────────────────────
  const undo = await api("POST", `/old-reports/batches/${batch.body.id}/undo`, tok, {});
  ok("undo answers with what it took back", undo.status === 200 && undo.body.files === 2 && undo.body.totals === 2, undo.body);
  const [left] = await q(`SELECT (SELECT COUNT(*) FROM historical_totals WHERE org_id=$1)::int AS t,
                                 (SELECT COUNT(*) FROM stored_sheets WHERE org_id=$1 AND removed_at IS NULL)::int AS s`, [ORG]);
  ok("undo takes the totals and the files", left.t === 0 && left.s === 0, left);
  const ty2 = await api("GET", `/reports/three-year?year=${VIEW}&yearMode=calendar`, tok);
  ok("the old year no longer shows an imported total", !(ty2.body.years || []).some(y => y.imported), ty2.body.years);
  const again = await api("POST", `/old-reports/batches/${batch.body.id}/files`, tok, { ...csvFile, kind: "giving_summary", system: "donorperfect" });
  ok("an undone import takes no more files", again.status === 409, again.body);

  await clear(ORG);
  await closeDb();
  summary("reports5-import");
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary("reports5-import"); });
