// scripts/preview-perf.js · FIX-55 item 1b. How long the import preview takes,
// file by file, in an org of 2,000 people (500 deleted): the first preview
// (upload to a full answer) and a re-read after one answer. Scratch servers
// only (BASE, DATABASE_URL); writes only its own org, org_fix55perf.
//   BASE=http://localhost:5601 DATABASE_URL=… node scripts/preview-perf.js
"use strict";
const path = require("path");
const { login, api, q, closeDb } = require("../tests/helpers");
const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const P = require("../tests/lib/previewPerfOrg");

(async () => {
  if (!/localhost|127\.0\.0\.1/.test(process.env.BASE || "http://localhost:5601")) throw new Error("scratch servers only");
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || "")) throw new Error("Refused: scratch database only (a loopback DATABASE_URL)");
  const { token } = await P.freshPerfOrg(q, login, "org_fix55perf", "Preview perf (test)");
  const seeded = await P.seedPreviewOrg(q, "org_fix55perf", XLSX);
  console.log(`org: ${seeded.people} people, ${seeded.deleted} deleted`);
  for (const f of [...P.FILES, P.WORKBOOK]) {
    const sheets = await P.sheetsOf(f, XLSX);
    const fileName = path.basename(f);
    const a = await api("POST", "/sheet-import/understand", token, { fileName, sheets, answers: {} });
    const b = await api("POST", "/sheet-import/understand", token, { fileName, sheets, answers: { eventDate: "2026-10-22", useEventDate: true } });
    console.log(`${fileName.padEnd(30)} first ${String(Math.round(a.ms)).padStart(6)}ms  re-read ${String(Math.round(b.ms)).padStart(6)}ms  status ${a.status}/${b.status}  ` +
      `people ${a.body.newPeople} new ${a.body.matchedPeople} matched, ${(a.body.deletedMatches || []).length} deleted, ${(a.body.questions || []).filter(x => !x.optional).length} questions`);
  }
  await closeDb();
})().catch(e => { console.error(e); process.exit(1); });
