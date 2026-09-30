// scripts/fix10-walk-org.js — FIX-10. A FIXTURE ORG FOR THE PROD WALK.
//
// FIX-10's walk has to press real buttons on production: read Home's drift
// card, open the early signs, read Fundraising over an EMPTY fiscal year, add
// a gift and delete it, open Connections, pick a vendor tile. None of that may
// touch a real organisation, so it runs against an org that exists only to be
// walked.
//
// Unlike scripts/trans1-walk-org.js this one DOES write donors and gifts,
// because the shape of the file is the whole point: the walk is about an org
// whose giving history all predates the current fiscal year, which is the
// condition Part B exists for. Fourteen donors, twenty-three gifts, $19,750 —
// Muse's Bluegrass Literacy Project, reproduced exactly.
//
// Five of those donors have exactly two gifts, a hundred days apart, with a
// hundred and sixty days of silence after: two gifts is MEDIUM confidence by
// construction (drift.js: n === 2), which is the state Home used to describe
// as "No donors drifting".
//
// IT WRITES, SO IT IS GUARDED LIKE EVERY OTHER WRITER (prodGuard, BUILD-55):
//   node scripts/fix10-walk-org.js --dry-run              (prints, writes nothing)
//   node scripts/fix10-walk-org.js --i-know-this-is-prod  (creates it on prod)
//
// The password is printed the instant it exists and never in a closing
// summary — the CKRH-1 rule, which cost a real account once.
const { writerBase } = require("./lib/prodGuard");
const crypto = require("crypto");

const DRY = process.argv.includes("--dry-run");
const API = DRY ? "http://localhost:5601" : writerBase("http://localhost:5601");

const ORG_NAME    = "FIX-10 Walk (fixture)";
const OWNER_NAME  = "Walk Fixture";
const OWNER_EMAIL = "fix10-walk@stewardapp.dev";

// Dates are relative to the run, so the fixture keeps its shape whenever it is
// rebuilt: everything lands in the last twelve months and before the current
// fiscal year's July start.
function plan(today) {
  const d = n => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
  const rows = [];
  const add = (name, date, amount) => rows.push({ name, date, amount });
  // 5 two-gift donors: 100-day cadence, 160 days of silence -> medium drift.
  for (const n of ["Ruth Calloway", "Marcus Delgado", "Ada Whitfield", "Samuel Okafor", "Nell Bracken"]) {
    add(n, d(260), 500); add(n, d(160), 500);
  }
  // 2 monthly donors who stopped -> lapsed, not drifting.
  for (const n of ["Iris Pemberton", "Otis Vandermeer"]) {
    for (const days of [182, 152, 121]) add(n, d(days), 250);
  }
  // 7 single-gift donors -> not eligible for a pattern.
  const singles = [["Hattie Lindqvist", 5000, 232], ["Clyde Nakamura", 2500, 218],
    ["Junie Abernathy", 2000, 209], ["Roscoe Villanueva", 1500, 195],
    ["Etta Fairbanks", 1000, 176], ["Percy Holloway", 750, 141], ["Wilma Strand", 500, 104]];
  for (const [n, a, days] of singles) add(n, d(days), a);
  return rows;
}

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
  const rows = plan(new Date());
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const names = [...new Set(rows.map(r => r.name))];
  console.log(`\nFIX-10 walk fixture → ${API}${DRY ? "  (DRY RUN — nothing is written)" : ""}\n`);
  console.log(`  ${names.length} donors · ${rows.length} gifts · $${total.toLocaleString()}`);
  if (names.length !== 14 || rows.length !== 23 || total !== 19750) {
    console.error(`  the fixture drifted from Muse's file (want 14/23/$19,750) — refusing`);
    process.exit(1);
  }
  if (DRY) { console.log(`  would create org "${ORG_NAME}" with admin ${OWNER_EMAIL}\n`); return; }

  const password = "walk-" + crypto.randomBytes(9).toString("base64url");
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

  const donors = names.map(n => ({ name: n, email: n.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.org" }));
  const idx = new Map(names.map((n, i) => [n, i]));
  const imp = await api("POST", "/donors/import-combined", token, {
    donors,
    gifts: rows.map(r => ({ donorIndex: idx.get(r.name), amount: r.amount, date: r.date, type: "cash", paymentMethod: "Check" })),
  });
  console.log(`  ${imp.status === 200 ? "✓" : "·"} import   ${imp.body?.giftsInserted} gifts (${imp.status})`);

  // The onboarding goal, so Fundraising has one to show over the empty year.
  const ov = await api("GET", "/fundraising/overview", token);
  const g = await api("POST", "/goals", token, {
    label: "Annual Fund 2026", goalAmount: 50000, goalType: "total_raised",
    periodStart: ov.body?.period?.start, periodEnd: ov.body?.period?.end });
  console.log(`  ${g.status === 201 ? "✓" : "·"} goal     Annual Fund 2026, $50,000 (${g.status})`);
  console.log(`  · this org's fiscal year (${ov.body?.periodLabel}) holds $${ov.body?.period?.raised ?? "?"}, which is the point`);

  console.log(`\n  Walk it at https://www.stewardapp.dev/login as ${OWNER_EMAIL}`);
  console.log(`  Home → Drift → See all · Fundraising → Overview · a donor → add a gift, delete it\n`);
})().catch(e => { console.error(e); process.exit(1); });
