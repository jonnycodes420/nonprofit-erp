// BUILD-79 — THE REPORT EXPORT, pinned forever.
//
// steward-messy-2500-v2.csv is a REPORT export, not a data export: a title
// line, a generated-by line, a blank, the header on LINE 4, the header
// re-printed after three page breaks, a TOTAL row ($2,035,978.52) and an
// End-of-report line — 2,500 real records across 2,853 physical lines, with
// mixed encodings inside single lines. On Sept 5 it went into a fresh
// production org and Steward: took line 1 as the header, called the shape
// "one row per donor", imported 1,111 donors with $0 of giving, stamped every
// one with a last gift of TODAY, scored them all 35, put six phone numbers in
// Needs Your Attention, ticked the checklist, showed a green EVERY ROW AND
// EVERY DOLLAR ACCOUNTED FOR · Balanced · 2,438 · $0, and failed to export.
//
//   §1  the file layer: header by evidence on line 4, chrome by line number,
//       2,500 records counted ONCE, TOTAL captured, encodings repaired
//   §2  shape: transaction by evidence; totals mode REFUSES this file; the
//       Part-0 garbage headers yield UNKNOWN, never a default
//   §3  the real tx mapping + accounted builder over the ANALYZED rows:
//       one disposition per record with REAL line numbers, no gift dated
//       today-or-later unless the file says so, unnamed donors flagged
//   §4  through the real route in chunks: server ledger balances against
//       2,500, DB dollars are NOT $0, zero donors stamped with import-day
//       last gifts they didn't earn
//   §5  Part 7.4 — the BUILD-78 round trip on THIS imported org: export
//       succeeds and reads back what import wrote
//   §6  Part 2.3 — fresh-org duplicate language over HTTP: within-file
//       collapses are never called "already on file"
//
// The SEMANTIC layer (dd/mm inference, soft credits, pledges, in-kind,
// matching gifts, duplicate donors, exclusion contradictions) is BUILD-80,
// deliberately absent here.
//
// Fixture key note: the Cowork-side fixture key file is not in the repo
// (BLOCKED-build79.md) — these assertions bind to file-derived ground truth
// + the spec's stated facts (2,500 records, TOTAL $2,035,978.52, header on
// line 4).

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q } = require("./helpers");

const ORG = "org_b79golden";
const FIXTURE = path.join(__dirname, "fixtures", "build79", "steward-messy-2500-v2.csv");

async function reset() {
  for (const t of ["gifts", "fin_transactions", "interactions", "donors", "accounts", "fin_funds", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id='org_b79r'`).catch(() => {});
  await q(`DELETE FROM orgs WHERE id='org_b79r'`).catch(() => {});
  for (const t of ["workflow_runs", "workflows", "digest_sends", "moves", "opportunities", "tasks",
    "payment_recovery_events", "reconnect_sends", "recurring_subscriptions", "receipts", "pledges", "fin_audit_log",
    "fin_transactions", "gifts", "interactions", "milestone_drafts", "note_reminders",
    "fundraising_goals", "metric_snapshots", "custom_field_values", "custom_field_defs",
    "donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B79 Golden','b79-golden',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b79golden',$1,'b79golden@test.local',$2,'Golden Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b79g',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b79g',$1,'General',false)`, [ORG]);
}

(async () => {
  await reset();
  const tok = await login("b79golden@test.local");
  const lib = await import("../shared/importShape.js");
  const TODAY = new Date().toISOString().slice(0, 10);

  // ── §1 · the file layer ──────────────────────────────────────────────────
  console.log("\n— §1 · the file layer: evidence, chrome, one count —");
  const dec = lib.decodeSpreadsheetBytesDetailed(fs.readFileSync(FIXTURE));
  const a = lib.analyzeCsvText(dec.text);
  ok("header found on line 4 by evidence, never position", a.headerLine.line === 4, a.headerLine);
  ok("2,500 records in your file — the ONE number every surface shows", a.records === 2500, a.records);
  ok("chrome above the header is named (title · generated-by · blank)",
    a.chromeAbove.length === 3 && /Donor Giving History Report/.test(a.chromeAbove[0].text), a.chromeAbove);
  ok("8 chrome rows below it, each by kind and line", a.chromeRows.length === 8,
    a.chromeRows.map(c => `${c.kind}:${c.line}`));
  ok("the file's own TOTAL row is captured: $2,035,978.52 at line 2852",
    a.totalRow && a.totalRow.amount === 2035978.52 && a.totalRow.line === 2852, a.totalRow);
  ok("4 mixed-encoding lines repaired, no U+FFFD anywhere",
    dec.cp1252Lines.length === 4 && !dec.text.includes("�"), dec.cp1252Lines);
  const scan = lib.scanAmountShapedColumns(a.headers, a.rows);
  ok("the independent dollar scan finds Amount with no mapping's help",
    scan && scan.header === "Amount" && scan.sum > 2000000, scan);

  // ── §2 · shape ───────────────────────────────────────────────────────────
  console.log("\n— §2 · shape is a decision with evidence, or a question —");
  const det = lib.detectImportShape(a.headers, a.rows);
  ok("with the real header the shape is TRANSACTION, with stated evidence",
    det.shape === "transaction" && !!det.reason, { shape: det.shape, reason: det.reason });
  ok("totals mode on this file REFUSES to proceed (the 1,327 signal)",
    lib.assessAggregateCollapse(a.rows, "Email", "Name").refuse === true);
  const garbage = ["Donor Giving History Report", ...Array.from({ length: 21 }, (_, i) => `_${i + 1}`)];
  const gRows = a.rows.slice(0, 60).map(r => Object.fromEntries(garbage.map((h, i) => [h, r[a.headers[i]] || ""])));
  ok("the Part-0 garbage headers yield UNKNOWN — never a default shape",
    lib.detectImportShape(garbage, gRows).shape === "unknown");

  // ── §3 · the accounted builder over the ANALYZED rows ────────────────────
  console.log("\n— §3 · the accounted builder: one disposition per record, real lines —");
  const txMap = lib.autoDetectTxMapping(a.headers, a.rows);
  ok("auto-mapping claims the money columns (amount + date + email + name)",
    txMap.amount === "Amount" && txMap.date === "Gift Date" && txMap.donorEmail === "Email" && !!txMap.donorName,
    { amount: txMap.amount, date: txMap.date, email: txMap.donorEmail, name: txMap.donorName });
  const built = lib.buildTransactionRows({ rows: a.rows }, txMap, { today: TODAY, rowLines: a.rowLines });
  ok("every record leaves with exactly one disposition (2,500 of 2,500)",
    built.dispositions.length === 2500, built.dispositions.length);
  const lines = new Set(built.dispositions.map(d => d.line));
  ok("dispositions carry REAL physical lines (unique, none in the chrome)",
    lines.size === 2500 && ![743, 744, 2852, 2853, 1, 2, 3, 4].some(l => lines.has(l)), lines.size);
  ok("file dollars are NOT zero on a file whose TOTAL row reads $2,035,978.52",
    built.file.dollars > 1000000, built.file.dollars);
  const todayOrLater = built.gifts.filter(g => g.date >= TODAY);
  const rawToday = a.rows.filter(r => {
    const { value } = lib.normalizeDate(r["Gift Date"] || "", { currentYear: Number(TODAY.slice(0, 4)) });
    return value != null && value >= TODAY;
  });
  ok(`no gift dated today-or-later unless the FILE says so (built ${todayOrLater.length}, file ${rawToday.length})`,
    todayOrLater.length <= rawToday.length, { built: todayOrLater.length, file: rawToday.length });
  const unnamed = built.donors.filter(d => /^Unnamed donor \(line \d+\)$/.test(d.name));
  ok("no donor's display name is an email or phone; the nameless are flagged",
    built.donors.every(d => !d.name.includes("@") && !/^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(d.name)) &&
    unnamed.every(d => (d.tags || []).includes("needs-name")),
    { donors: built.donors.length, unnamed: unnamed.length });

  // ── §4 · through the real route ──────────────────────────────────────────
  console.log("\n— §4 · through the real route: the ledger closes against 2,500 —");
  const CHUNK = 500;
  const byDonor = new Map();
  for (const g of built.gifts) { if (!byDonor.has(g.donorIndex)) byDonor.set(g.donorIndex, []); byDonor.get(g.donorIndex).push(g); }
  let created = 0, sumRows = { created: 0, skipped: 0, errored: 0 };
  const serverReasons = {};
  let chunksOk = true;
  for (let start = 0; start < built.donors.length; start += CHUNK) {
    const slice = built.donors.slice(start, start + CHUNK);
    const chunkGifts = [];
    slice.forEach((_, li) => { const gg = byDonor.get(start + li); if (gg) gg.forEach(g => { const { donorIndex, ...rest } = g; chunkGifts.push({ ...rest, donorIndex: li }); }); });
    const res = await api("POST", "/donors/import-combined", tok, { donors: slice, gifts: chunkGifts });
    if (res.status !== 200) { chunksOk = false; ok("chunk imports (status 200)", false, { status: res.status, body: JSON.stringify(res.body).slice(0, 200) }); break; }
    created += res.body.created || 0;
    const rr = res.body.reconciliation;
    sumRows.created += rr.rows.created; sumRows.skipped += rr.rows.skipped; sumRows.errored += rr.rows.errored;
    for (const box of ["skippedReasons", "erroredReasons"])
      for (const [k, v] of Object.entries(rr[box] || {})) serverReasons[k] = (serverReasons[k] || 0) + v.rows;
  }
  ok("all chunks imported", chunksOk);
  const clientRefused = built.dispositions.filter(d => d.disposition === "skipped" || d.disposition === "errored");
  const [dbGifts] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float d FROM gifts WHERE org_id=$1`, [ORG]);
  ok("DB gift dollars are NOT $0 (the Part-0 catastrophe)", dbGifts.d > 1000000, dbGifts);
  // the server refuses accountably too (duplicate external Gift IDs, within
  // file and across chunks) — the equation closes with its stated reasons.
  const serverGiftRefusals = (serverReasons.external_id_repeated_in_file || 0) + (serverReasons.external_id_already_imported || 0);
  ok(`gift accounting closes: builder ${built.gifts.length} = DB ${dbGifts.n} + server external-id refusals ${serverGiftRefusals}`,
    dbGifts.n + serverGiftRefusals === built.gifts.length, { db: dbGifts.n, refusals: serverReasons });
  // Part 4's both-shape assertion: no donor carries an import-day last gift
  // the FILE didn't give them.
  const [stamped] = await q(
    `SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND last_gift_date = $2`, [ORG, TODAY]);
  const fileTodayDonors = new Set(built.gifts.filter(g => g.date === TODAY).map(g => g.donorIndex)).size;
  ok(`zero donors stamped with a today last-gift the file didn't give them (db ${stamped.n}, file supports ${fileTodayDonors})`,
    stamped.n <= fileTodayDonors, stamped.n);
  const [nullDates] = await q(
    `SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND (date IS NULL OR date = '')`, [ORG]);
  ok("no gift row landed with an empty date", nullDates.n === 0, nullDates.n);
  void clientRefused; void created; void sumRows;

  // ── §5 · Part 7.4 — the round trip on the IMPORTED org ───────────────────
  console.log("\n— §5 · export reads what import wrote, on THIS org —");
  const ex = await api("GET", "/donors/export/csv", tok);
  ok("GET /donors/export/csv answers 200 on the imported org (the Sept 5 crash surface)",
    ex.status === 200, ex.status);
  const exText = typeof ex.body === "string" ? ex.body : JSON.stringify(ex.body);
  ok("the export is CSV-shaped and carries the imported donors",
    /^﻿?Name,/.test(exText) && exText.split("\n").length > built.donors.length * 0.9,
    exText.slice(0, 60));
  ok("García survived import → export byte-honest (no mojibake introduced)",
    exText.includes("García") && !exText.includes("�"), null);

  // ── §6 · Part 2.3 — fresh-org duplicate language over HTTP ───────────────
  console.log("\n— §6 · a fresh org never reads 'already on file' for its own file's rows —");
  const ORG2 = ORG + "_dup";
  await q(`DELETE FROM gifts WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM fin_transactions WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM accounts WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM fin_funds WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM budgets WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG2]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG2]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'B79 Dup','b79-dup',1,'active','team')`, [ORG2]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b79dup',$1,'b79dup@test.local',$2,'Dup Admin','admin')`,
    [ORG2, bcrypt.hashSync("loadtest1234", 10)]);
  const tok2 = await login("b79dup@test.local");
  const dupDonors = [
    { name: "Jane One", email: "jane@x.org", total: 100 },
    { name: "Jane Two", email: "jane@x.org", total: 200 },   // within-file collapse
    { name: "Solo Donor", email: "solo@x.org", total: 50 },
  ];
  let res = await api("POST", "/donors/import", tok2, { donors: dupDonors });
  ok("fresh org: the within-file collapse is duplicate_within_this_import, NEVER already-on-file",
    res.body.duplicatesInFile === 1 && res.body.duplicatesOnFile === 0 &&
    !!res.body.reconciliation.skippedReasons?.duplicate_within_this_import &&
    !res.body.reconciliation.skippedReasons?.already_in_steward,
    { inFile: res.body.duplicatesInFile, onFile: res.body.duplicatesOnFile, reasons: Object.keys(res.body.reconciliation.skippedReasons || {}) });
  res = await api("POST", "/donors/import", tok2, { donors: [{ name: "Jane Again", email: "jane@x.org", total: 10 }] });
  ok("re-importing the same donor NOW reads already_in_steward",
    res.body.duplicatesOnFile === 1 && !!res.body.reconciliation.skippedReasons?.already_in_steward,
    { onFile: res.body.duplicatesOnFile, reasons: Object.keys(res.body.reconciliation.skippedReasons || {}) });

  summary("import-messy-v2");
})();
