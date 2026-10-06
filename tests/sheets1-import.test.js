// tests/sheets1-import.test.js · SHEETS-1's one test. AN OLD SPREADSHEET, BROUGHT IN.
//
//     A grant tracker with grant rows and a column Steward cannot place
//     ("Board liaison"): reading it writes nothing; previewing it writes
//     nothing; confirming imports the grants through the one grant importer
//     and keeps the file, with the unplaced column's values line by line. A
//     file that says it is .xlsx but is not one is refused and the import
//     writes nothing. A table of numbers is kept as a board report with its
//     file, readable back to the byte. Another organisation sees none of it.
//
// Donor data: a funder's history that lands half in the pipeline and half
// nowhere, or a column of notes silently dropped, is a record lying about
// what the office knew.
//
// HOW IT WOULD GO RED (proven before it was trusted, see the build report):
//   · /sheets/read writing a row → §1 "reading writes nothing";
//   · the import dropping unplaced columns → §2 "the column is kept, line by line";
//   · the file stored after the grants are written, outside the check → §3 "a bad file writes nothing".

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const BASE = process.env.BASE || "http://localhost:5601";
const ORG = "org_sheets1", ORG2 = "org_sheets1b";
const TABLES = ["stored_sheets", "grants", "user_sessions", "donors", "users"];

async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const csvUrl = text => "data:text/csv;base64," + Buffer.from(text, "utf8").toString("base64");

(async () => {
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  for (const [o, slug] of [[ORG, "sheets1"], [ORG2, "sheets1b"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
             VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW())`, [o, `Sheets ${slug}`, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Sam','admin')`, [`u_${o}`, o, `sam@${o}.local`, pw]);
  }
  const tok = await login(`sam@${ORG}.local`), tok2 = await login(`sam@${ORG2}.local`);
  const count = async (t) => Number((await q(`SELECT COUNT(*)::int AS n FROM ${t} WHERE org_id=$1`, [ORG]))[0].n);

  const headers = ["Funder", "Program", "Amount Requested", "Status", "Deadline", "Board liaison"];
  const rows = [
    ["Seabright Foundation", "Youth sailing", "25000", "Submitted", "2026-11-01", "Eleanor Vance"],
    ["Harbor Trust", "Boat repairs", "$12,500.00", "Awarded", "2026-03-15", ""],
    ["Pelican Fund", "Summer camp", "8000", "Prospecting", "", "Tom Ashby"],
  ];
  const csv = [headers, ...rows].map(r => r.map(c => /[,"]/.test(c) ? `"${c}"` : c).join(",")).join("\n");

  // ── §1 · reading and previewing write nothing ────────────────────────────
  console.log("\n§1 nothing before confirming");
  const before = { grants: await count("grants"), sheets: await count("stored_sheets"), donors: await count("donors") };
  const read = await api("POST", "/sheets/read", tok, { headers, rows, fileName: "tracker.csv" });
  ok("§1 Steward reads it as grants", read.status === 200 && read.body.kind === "grants", read.body);
  ok("§1 the column it cannot place is named", JSON.stringify(read.body.unplaced) === JSON.stringify(["Board liaison"]), read.body.unplaced);
  const prev = await api("POST", "/grants/import/preview", tok, { headers, rows });
  ok("§1 the preview shows three grants", prev.status === 200 && prev.body.grants.length === 3, prev.body.counts);
  ok("§1 reading and previewing wrote nothing", await count("grants") === before.grants && await count("stored_sheets") === before.sheets && await count("donors") === before.donors);

  // ── §3 · a file that is not what it says writes nothing ──────────────────
  console.log("\n§3 a bad file writes nothing");
  const bad = await api("POST", "/grants/import", tok, { headers, rows, sheet: { file: "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + Buffer.from("not a zip at all").toString("base64"), fileName: "tracker.xlsx" } });
  ok("§3 a mislabelled file is refused", bad.status === 400 && bad.body.error === "bad_bytes", bad.body);
  ok("§3 …and nothing was written", await count("grants") === before.grants && await count("stored_sheets") === before.sheets && await count("donors") === before.donors);

  // ── §2 · confirming imports the grants and keeps the column ──────────────
  console.log("\n§2 confirmed");
  const imp = await api("POST", "/grants/import", tok, { headers, rows, sheet: { file: csvUrl(csv), fileName: "tracker.csv" } });
  ok("§2 the import ran", imp.status === 201 && imp.body.grants.length === 3 && imp.body.sheet && imp.body.sheet.id, imp.body);
  ok("§2 three grants are in the pipeline", await count("grants") === before.grants + 3);
  const kept = (await api("GET", `/sheets/${imp.body.sheet.id}`, tok)).body;
  ok("§2 the file is kept with the import", kept.kind === "grant_import" && kept.fileName === "tracker.csv" && kept.grantIds.length === 3, kept);
  ok("§2 the unplaced column is kept, line by line", JSON.stringify(kept.unplaced.columns) === '["Board liaison"]'
    && kept.unplaced.rows.length === 2 && kept.unplaced.rows[0].line === 1 && kept.unplaced.rows[0].values["Board liaison"] === "Eleanor Vance"
    && kept.unplaced.rows[1].line === 3 && kept.unplaced.rows[1].values["Board liaison"] === "Tom Ashby", kept.unplaced);
  const file = await fetch(`${BASE}/sheets/${imp.body.sheet.id}/file`, { headers: { Authorization: "Bearer " + tok } });
  ok("§2 the original file comes back to the byte", file.status === 200 && (await file.text()) === csv);

  // ── §4 · a table of numbers is kept as a board report ────────────────────
  console.log("\n§4 a board report");
  const bh = ["Line", "FY 2023-24", "FY 2024-25"], br = [["Individual gifts", "412,300", "455,120"], ["Foundations", "220,000", "198,500"], ["Events", "61,200", "70,410"]];
  const bread = await api("POST", "/sheets/read", tok, { headers: bh, rows: br, fileName: "board.csv" });
  ok("§4 Steward reads it as a table of numbers", bread.body.kind === "board_report", bread.body);
  const bcsv = [bh, ...br].map(r => r.map(c => /,/.test(c) ? `"${c}"` : c).join(",")).join("\n");
  const keep = await api("POST", "/sheets/board-reports", tok, { headers: bh, rows: br, file: csvUrl(bcsv), fileName: "board.csv", title: "Board report 2024-25" });
  const list = (await api("GET", "/sheets/board-reports", tok)).body.reports || [];
  ok("§4 kept under Reports with its file", keep.status === 201 && list.some(r => r.id === keep.body.id && r.fileName === "board.csv" && r.rowCount === 3), { keep: keep.body, list });
  const kb = (await api("GET", `/sheets/${keep.body.id}`, tok)).body;
  ok("§4 the table is exactly as it was", JSON.stringify(kb.rows) === JSON.stringify(br), kb.rows);

  // ── §5 · another organisation ────────────────────────────────────────────
  console.log("\n§5 tenant");
  const t1 = await api("GET", `/sheets/${keep.body.id}`, tok2), t2 = await fetch(`${BASE}/sheets/${keep.body.id}/file`, { headers: { Authorization: "Bearer " + tok2 } });
  const t3 = await api("POST", `/sheets/${imp.body.sheet.id}/undo-grant-import`, tok2, {});
  ok("§5 another organisation cannot read, download or undo it", t1.status === 404 && t2.status === 404 && t3.status === 404, [t1.status, t2.status, t3.status]);
  ok("§5 …and lists none of it", !((await api("GET", "/sheets/board-reports", tok2)).body.reports || []).length);

  // ── §6 · Undo of the import ──────────────────────────────────────────────
  const undo = await api("POST", `/sheets/${imp.body.sheet.id}/undo-grant-import`, tok, {});
  ok("§6 Undo takes the three grants back off", undo.status === 200 && undo.body.removed === 3 && await count("grants") === before.grants, undo.body);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary(); });
