// scripts/trans1-walk-org.js — TRANS-1. A FIXTURE ORG FOR THE PROD WALK.
//
// The TRANS-1 walk has to press real buttons on production: pick a tile, read
// the how-to page, import a file, open the Move Report, re-import, press
// "We've moved". None of that may touch a real organisation's data, so it runs
// against an org that exists only to be walked.
//
// THIS IS NOT A DEMO SEED. It writes no donors and no gifts: the walk imports
// the fixture file itself, which is the whole point of the exercise. The only
// rows it creates are the org, one login, and one fund.
//
// IT WRITES, SO IT IS GUARDED LIKE EVERY OTHER WRITER (prodGuard, BUILD-55):
//   loopback by default; a remote BASE additionally needs --i-know-this-is-prod.
//
//   node scripts/trans1-walk-org.js --dry-run              (prints, writes nothing)
//   node scripts/trans1-walk-org.js --i-know-this-is-prod  (creates it on prod)
//
// The password is printed the instant it exists and never in a closing
// summary — the CKRH-1 rule, which cost a real account once.
const { writerBase } = require("./lib/prodGuard");
const crypto = require("crypto");

const DRY = process.argv.includes("--dry-run");
const API = DRY ? "http://localhost:5601" : writerBase("http://localhost:5601");

const ORG_NAME    = "TRANS-1 Walk (fixture)";
const OWNER_NAME  = "Walk Fixture";
const OWNER_EMAIL = "trans1-walk@stewardapp.dev";

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

(async () => {
  console.log(`\nTRANS-1 walk fixture → ${API}${DRY ? "  (DRY RUN — nothing is written)" : ""}\n`);
  if (DRY) { console.log(`  would create org "${ORG_NAME}" with admin ${OWNER_EMAIL}`); return; }

  const password = "walk-" + crypto.randomBytes(9).toString("base64url");
  // Printed HERE, the instant it exists, not at the end.
  console.log(`  PASSWORD (save this now): ${password}\n`);

  const reg = await api("POST", "/auth/register-org", null, {
    orgName: ORG_NAME, userName: OWNER_NAME, email: OWNER_EMAIL, password,
    provisioned: true, demoData: false,
  });
  if (reg.status !== 201) {
    console.error(`  register-org ${reg.status}: ${JSON.stringify(reg.body)}`);
    console.error("  (a 409 means the fixture org already exists — reuse it, or pick another e-mail)");
    process.exit(1);
  }
  const { token } = reg.body;
  console.log(`  ✓ org      ${reg.body.org.id}`);
  console.log(`  ✓ admin    ${reg.body.user.id}  ${OWNER_EMAIL}`);

  // One unrestricted fund, so an imported gift has somewhere to land without
  // the importer inventing one mid-walk.
  const f = await api("POST", "/funds", token, { name: "General", restricted: false });
  console.log(`  ${f.status === 200 || f.status === 201 ? "✓" : "·"} fund     General (${f.status})`);

  console.log(`\n  Walk it at https://www.stewardapp.dev/login as ${OWNER_EMAIL}`);
  console.log(`  Donors → Import & tools → Import donors → "Where are your donors today?"\n`);
})().catch(e => { console.error(e); process.exit(1); });
