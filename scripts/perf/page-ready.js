// scripts/perf/page-ready.js · PERF-4. The seven main pages' page-ready times
// (tests/lib/pageReadyLeg.js), cold after a fresh sign-in and warm, on the
// walk-sized org and, with --big, the 25,000-person one. LOCAL scratch stack only.
//   BASE=http://localhost:5641 APP_URL=http://localhost:4174 DATABASE_URL=… \
//     node scripts/perf/page-ready.js [--seed] [--big] [--runs 3]
"use strict";
for (const k of ["BASE", "DATABASE_URL", "APP_URL"]) {
  const v = process.env[k];
  if (v && !/localhost|127\.0\.0\.1/.test(v)) { console.error(`Refusing: ${k} is not loopback.`); process.exit(2); }
}
const path = require("path");
const { q, api, closeDb } = require("../../tests/helpers");
const L = require("../../tests/lib/pageReadyLeg");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
(async () => {
  const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
  const { chromium } = require(PW);
  const orgs = [L.WALK_ORG, ...(process.argv.includes("--big") ? [L.BIG_ORG] : [])];
  const browser = await chromium.launch();
  for (const o of orgs) {
    let who;
    const have = await q("SELECT 1 FROM orgs WHERE id=$1", [o.id]);
    if (!have.length || process.argv.includes("--seed")) { const t = Date.now(); who = await L.seedOrg(q, o); console.log(`  seeded ${o.id} in ${Math.round((Date.now() - t) / 1000)} s`); }
    else { const [top] = await q(`SELECT id FROM donors WHERE org_id=$1 ORDER BY gift_count DESC, id LIMIT 1`, [o.id]); who = { email: `admin@${o.slug}.load`, password: "loadtest1234", top: top.id }; }
    const rows = await L.measurePages(browser, { app: process.env.APP_URL || "http://localhost:4173", base: process.env.BASE, api, ...who, log: process.argv.includes("--log") },
      { runs: Number(arg("--runs", 3)), only: arg("--only", null) ? arg("--only").split(",") : null });
    console.log(L.table(`${o.name} (${o.donors.toLocaleString()} people)`, rows));
    for (const r of rows) if (r.errors.length || r.fail5xx.length) console.log(`  ${r.name}: ${r.errors.slice(0, 2).join(" | ")} ${r.fail5xx.slice(0, 2).join(" ")}`);
  }
  await browser.close();
  await closeDb();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
