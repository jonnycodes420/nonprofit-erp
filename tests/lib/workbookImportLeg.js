// tests/lib/workbookImportLeg.js · NUMBERS-4 item 1. THE 25,000-PERSON WORKBOOK
// IMPORTS IN UNDER TWO MINUTES.
//
// PERF-2 imported messy-25k (tests/fixtures/build82, 25,034 people and 90,523
// gifts) the way WorkbookImport.jsx does, one /donors/import-combined, and it
// ran for over 15 minutes. Inside the import's transaction a fresh org's rows
// are not in the planner's statistics, so it planned every person as if the
// org had one: KEEP_IMPORTED_TOTAL joined donors to itself, and the recompute
// read the org's every gift once per person. Both were quadratic in the people.
// This leg builds the workbook's submission with the client's own builder,
// sends it the way the screen does, then the pledges and merges, and waits for
// the background work the import queued. A database that has ANALYZEd its
// other orgs (as every real one has) is the condition, so it ANALYZEs first.
// API only, so perf-app runs it before the browser skip.
//
// NUMBERS-5: through the door the Donors page recommends. "Import a
// spreadsheet" (SpreadsheetImport.jsx) refused this file (413: its routes sat
// under the 5 MB default) and, given room, read it as 1,101 people and no
// gifts. Now its cells fit (/sheet-import/*, 50 MB), and the screen reads the
// workbook's roles and hands it to the workbook screen (sheetRead
// readsAsWorkbook), which reads every sheet. And every row is accounted for
// (IMPORT-6): each person row on the Donors sheet is a person written or one
// folded into another, each gift row is written, set aside or routed with its
// reason, and the database holds exactly the gifts the receipt says it wrote.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { undoAndWait } = require("./undoWait");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "build82", "steward-messy-25k-v3.xlsx");
const ORG = "org_perf25k";
const BUDGET_MS = 120000;   // the brief: the whole workbook in under 2 minutes locally

// The submission WorkbookImport.jsx builds, from the same shared builder.
async function buildSubmission() {
  const IS = await import(path.join(ROOT, "shared", "importShape.js"));
  const XLSX = require(path.join(ROOT, "client", "node_modules", "xlsx"));
  const wb = XLSX.read(fs.readFileSync(FIXTURE), { type: "buffer", cellNF: true, cellFormula: true, cellStyles: true });
  const sheets = IS.extractWorkbookFromSheetJS(wb, XLSX).map(s => {
    if (!s.records.length) return { name: s.name, headers: [], rows: [], typedRows: [], rowCount: 0, meta: s.meta, formulaCellRatio: s.formulaCellRatio };
    const a = IS.analyzeWorkbookSheet(s.records);
    return { name: s.name, ...a, rowCount: a.records, meta: s.meta, formulaCellRatio: s.formulaCellRatio };
  });
  const roled = IS.classifyWorkbookSheets(sheets);
  const legend = IS.extractWorkbookLegend(roled);
  const signals = IS.buildWorkbookSignals(roled, legend);
  const sub = IS.buildWorkbookSubmission(roled, { signals, signalAnswers: {}, legend, currentYear: 2026, anchorDate: "2026-09-06" });
  // The door's own reading of the same file (SpreadsheetImport.readSheetFile)
  const SR = await import(path.join(ROOT, "shared", "sheetRead.js"));
  const grids = SR.gridsFromWorkbook(XLSX.read(fs.readFileSync(FIXTURE), { type: "buffer", cellDates: true }), XLSX);
  const door = { grids, toWorkbook: typeof SR.readsAsWorkbook === "function" && SR.readsAsWorkbook(grids, roled),
                 personRows: (roled.find(s => s.role === "donors") || {}).rowCount || 0 };
  return { sub, door };
}

// This leg's own org, emptied without its triggers (25,000 audited deletes
// would be the slowest part of the run), on one connection.
async function wipe() {
  const { Client } = require("pg");
  const c = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest" });
  await c.connect();
  try {
    const tabs = (await c.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).rows.map(r => r.table_name);
    await c.query("SET session_replication_role = replica");
    for (const t of tabs) await c.query(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    await c.query(`DELETE FROM orgs WHERE id=$1`, [ORG]);
    await c.query("SET session_replication_role = origin");
    await c.query("ANALYZE donors; ANALYZE gifts");
  } finally { await c.end(); }
}

async function post(base, token, route, body, signal) {
  const r = await fetch(base + route, { method: "POST", signal, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function workbookImportLeg({ ok, timed, q, login, base, importWorkSettled }) {
  const t0 = performance.now();
  const { sub, door } = await buildSubmission();
  console.log(`  messy-25k: ${sub.donors.length} people, ${sub.gifts.length} gifts (built in ${Math.round((performance.now() - t0) / 1000)} s)`);
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Perf Workbook Trust','perf-25k',1,'active','impact','America/New_York')`, [ORG]);
  const email = `${ORG}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + ORG, ORG, email, bcrypt.hashSync("loadtest1234", 4)]);
  const token = await login(email, "loadtest1234");

  // NUMBERS-5: "Import a spreadsheet" takes the file and hands it to the workbook screen
  const u0 = performance.now();
  const und = await post(base, token, "/sheet-import/understand", { fileName: "steward-messy-25k-v3.xlsx", sheets: door.grids, answers: {}, overrides: {}, useModel: false });
  ok(`"Import a spreadsheet" takes the 25,000-person workbook's cells (${Math.round(JSON.stringify(door.grids).length / 1e6)} MB; main: 413, too large)`,
    und.status === 200, { status: und.status, error: und.body && und.body.error, ms: Math.round(performance.now() - u0) });
  ok("...and reads it as a workbook of people and their gifts, every sheet, the workbook screen's way (main: 1,101 people and no gifts)",
    door.toWorkbook === true && sub.donors.length > 25000 && sub.gifts.length > 90000, { toWorkbook: door.toWorkbook, people: sub.donors.length, gifts: sub.gifts.length });

  // The screen's own two writes (WorkbookImport.jsx doImport), one run id.
  const runId = "imp_" + require("crypto").randomBytes(12).toString("hex");   // movePlan.newRunId's shape
  const donors = sub.donors.map(({ _line, _freqMonthlyClaim, _staleChargeClaim, staleFrequency, address1, ...d }) => d);
  // Locally the budget is also the timeout (main's code never answered); on a
  // shared CI runner the time is a warning (tests/lib/budget.js), so it waits
  // three budgets before calling it a hang.
  const waitMs = require("./budget").lenient() ? 3 * BUDGET_MS : BUDGET_MS;
  const abort = AbortSignal.timeout(waitMs);
  const s0 = performance.now();
  let res = null, sem = null, settled = false, err = null;
  try {
    res = await post(base, token, "/donors/import-combined", { donors, gifts: sub.gifts, identityResolved: true, importId: runId }, abort);
    sem = await post(base, token, "/donors/import-semantics", {
      importId: runId,
      pledges: sub.pledges.pledges.map(p => ({ donorExternalId: p.donorExternalId, amount: p.amount, date: p.date, externalId: p.externalId, status: p.status })),
      merges: sub.merges.map(m => ({ surviving: m.surviving, survivingEmail: m.survivingEmail || "", folded: m.folded })),
      fileStats: sub.fileStats,
    }, abort);
    settled = !!(await importWorkSettled(ORG, { timeout: Math.max(1000, waitMs - (performance.now() - s0)) }));
  } catch (e) { err = e.name === "TimeoutError" ? `no answer in ${waitMs / 1000} s` : e.message; }
  const ms = Math.round(performance.now() - s0);
  console.log(`  messy-25k imported in ${ms} ms (${err || `import ${res.status}, pledges and merges ${sem.status}, background work ${settled ? "done" : "not done"}`})`);
  const [{ d, g }] = await q(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1 AND deleted_at IS NULL)::int d, (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int g`, [ORG]);
  // IMPORT-6's every row, on this file
  const [{ runGifts }] = await q(`SELECT COUNT(*)::int "runGifts" FROM gifts WHERE org_id=$1 AND import_id=$2`, [ORG, runId]);
  const wrec = sub.reconciliation.workbook, rrows = ((res && res.body.reconciliation) || {}).rows || {};
  const every = {
    personRows: door.personRows, people: sub.donors.length, folded: sub.totals.folded, written: res && res.body.created,
    giftRows: wrec.rowsInFile, built: wrec.imported, refused: wrec.refused, routed: wrec.routed,
    sent: sub.gifts.length, created: rrows.created, skipped: rrows.skipped, errored: rrows.errored, inDb: runGifts,
  };
  ok("every row is accounted for: each person row is a person written or one folded into another; each gift row is written, set aside or routed with its reason; the database holds exactly the gifts the receipt wrote",
    !err && every.personRows === every.people + every.folded && every.written === every.people
      && every.giftRows === every.built + every.refused + every.routed && sub.reconciliation.perSheet.every(x => x.balanced)
      && every.sent === every.built && Number(rrows.inFile) === every.sent
      && Number(rrows.created) + Number(rrows.skipped || 0) + Number(rrows.errored || 0) === every.sent && every.inDb === Number(rrows.created),
    every);
  ok("the 25,000-person workbook (messy-25k) imports whole: every person, every gift, its pledges, merges and background work",
    !err && res.status === 200 && sem.status === 200 && settled && res.body.created === sub.donors.length && g >= res.body.giftsInserted,
    { err, status: res && res.status, created: res && res.body.created, semantics: sem && sem.status, settled, people: d, gifts: g });
  // NUMBERS-5: the one Undo on the receipt (WorkbookImport records the run, ImportUndo reverses it)
  const rec = await post(base, token, "/imports", { id: runId, name: "steward-messy-25k-v3", sourceFilename: "steward-messy-25k-v3.xlsx", shape: "workbook",
    startedAt: new Date(0).toISOString(), rowsIn: every.giftRows, giftsCreated: Number(rrows.created) || 0, donorsCreated: every.written || 0 });
  // IMPORT-7: the Undo runs on the queue (more than 5,000 rows) and this waits
  // on it with its own deadline: a slow undo fails the leg, never hangs the shard
  const back = rec.status < 300 ? await undoAndWait(base, token, runId, { timeoutMs: waitMs }) : rec;
  console.log(`  messy-25k undone in ${back.ms} ms (${back.via || back.status}, answered in ${back.answeredMs} ms)`);
  const [left] = await q(`SELECT (SELECT COUNT(*) FROM donors WHERE org_id=$1 AND deleted_at IS NULL)::int d, (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int g, (SELECT COUNT(*) FROM pledges WHERE org_id=$1)::int p`, [ORG]);
  ok("...and its one Undo takes the whole workbook back on the queue, answered at once and followed to done: no person, gift or pledge left",
    rec.status < 300 && back.status === 200 && back.via === "queue" && left.d === 0 && left.g === 0 && left.p === 0,
    { record: rec.status, undo: back.status, via: back.via, answeredMs: back.answeredMs, ms: back.ms, error: back.error, sentence: back.body && (back.body.sentence || back.body.message), left });
  timed(`...and in under ${BUDGET_MS / 1000} s (${ms} ms; PERF-2: over 15 minutes)`, { drew: !err, ms, budget: BUDGET_MS });
  await wipe();
}

module.exports = { workbookImportLeg, BUDGET_MS };
