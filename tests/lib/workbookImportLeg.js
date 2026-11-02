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
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

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
  return IS.buildWorkbookSubmission(roled, { signals, signalAnswers: {}, legend, currentYear: 2026, anchorDate: "2026-09-06" });
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
  const sub = await buildSubmission();
  console.log(`  messy-25k: ${sub.donors.length} people, ${sub.gifts.length} gifts (built in ${Math.round((performance.now() - t0) / 1000)} s)`);
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Perf Workbook Trust','perf-25k',1,'active','impact','America/New_York')`, [ORG]);
  const email = `${ORG}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + ORG, ORG, email, bcrypt.hashSync("loadtest1234", 4)]);
  const token = await login(email, "loadtest1234");

  // The screen's own two writes (WorkbookImport.jsx doImport), one run id.
  const runId = "run_" + require("crypto").randomBytes(8).toString("hex");
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
  ok("the 25,000-person workbook (messy-25k) imports whole: every person, every gift, its pledges, merges and background work",
    !err && res.status === 200 && sem.status === 200 && settled && res.body.created === sub.donors.length && g >= res.body.giftsInserted,
    { err, status: res && res.status, created: res && res.body.created, semantics: sem && sem.status, settled, people: d, gifts: g });
  timed(`...and in under ${BUDGET_MS / 1000} s (${ms} ms; PERF-2: over 15 minutes)`, { drew: !err, ms, budget: BUDGET_MS });
  await wipe();
}

module.exports = { workbookImportLeg, BUDGET_MS };
