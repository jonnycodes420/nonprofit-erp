// scripts/sweep2-walk-org.js · SWEEP-2. A fresh org on the LOCAL
// scratch stack with the three real-shaped files imported (gift history, the
// dinner, contacts) for walking Donors, Data health and imports the way Allie will see it.
// Loopback only (tests/helpers refuses anything else). Sends nothing.
//   BASE=http://localhost:5821 DATABASE_URL=… node scripts/sweep2-walk-org.js
"use strict";
for (const k of ["BASE", "DATABASE_URL"]) {
  const v = process.env[k];
  if (v && !/localhost|127\.0\.0\.1/.test(v)) { console.error(`Refusing: ${k} is not loopback (${v}).`); process.exit(2); }
}
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { login, api, q, closeDb } = require("../tests/helpers");
const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "..", "tests", "fixtures", "import", "real-shaped");
const ORG = process.env.WALK_ORG || "org_sw2walk";
const EMAIL = `${ORG}@test.local`, PASSWORD = "loadtest1234";

async function sheetsOf(file) {
  const R = await import("../shared/sheetRead.js");
  return R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(FX, file)), { type: "buffer", cellDates: true }), XLSX);
}
async function importFile(tok, fileName, answers) {
  const body = { fileName, sheets: await sheetsOf(fileName), answers };
  const u = await api("POST", "/sheet-import/understand", tok, body);
  if (u.status !== 200 || !u.body.ready) throw new Error(`${fileName}: not ready ${JSON.stringify(u.body).slice(0, 300)}`);
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") { console.log(`  ${fileName}: ${j.body.status}`); return; }
    await new Promise(res => setTimeout(res, 200));
  }
}
(async () => {
  const exists = await q("SELECT 1 FROM orgs WHERE id=$1", [ORG]);
  if (exists.length) { console.log(`${ORG} already exists; sign in as ${EMAIL} / ${PASSWORD}`); return closeDb(); }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Real-shaped walk',$2,1,'active','team')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  const tok = await login(EMAIL, PASSWORD);
  // The dinner goes in linked to its event, the way Allie imported it on prod;
  // contacts last, as the brief orders.
  const DINNER = { linkEvent: true, eventName: "Finding Joy Dinner", eventDate: "2026-10-22", useEventDate: true, pledgeDue: "event" };
  await importFile(tok, "jp-gift-history-287.xlsx");
  await importFile(tok, "jp-dinner-gifts-106.xlsx", DINNER);
  await importFile(tok, "jp-contacts-656.xlsx");
  console.log(`sign in as ${EMAIL} / ${PASSWORD}`);
  await closeDb();
})().catch(e => { console.error(e); process.exit(1); });
