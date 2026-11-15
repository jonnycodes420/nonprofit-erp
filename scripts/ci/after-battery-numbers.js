#!/usr/bin/env node
// NUMBERS-6 · AFTER THE BATTERY, THE STORED TOTALS STILL ADD UP.
//
// A CI shard runs its suites against its own database. When they are done,
// tests/shard.sh runs this on every org the suites created (every org not in
// the list it wrote down before the first suite), with the nightly check's
// narrow rules (scripts/ci/check-numbers.js checkOrg, `narrow`): the totals
// kept on a person (`donor-stored`), First/Largest/Last, and rows pointing at a
// removed gift. Any of those non-zero fails the shard, so a path that leaves a
// stored total stale breaks the build that brought it in, not a customer's
// morning. A suite that leaves a stale total ON PURPOSE (to prove a screen
// reads the gifts, not the stored figure) names its org in
// tests/lib/storedTotalsPlanted.js, with why.
//
//   DATABASE_URL=<the shard's> node scripts/ci/after-battery-numbers.js --before <file of org ids>
//
// Local databases only: it refuses any other DATABASE_URL. It writes nothing.
"use strict";
const fs = require("fs");
const path = require("path");

const url = process.env.DATABASE_URL || "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refused: the after-battery check reads a CI shard's local database only (localhost or 127.0.0.1).");
  process.exit(2);
}
const argv = process.argv.slice(2);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const RULES = ["donor-stored", "donor-first-largest-last", "removed"];

async function main() {
  const cwd = process.cwd();
  const { query } = require("../../db");
  const { checkOrg } = require("./check-numbers");
  process.chdir(cwd);
  const beforeFile = val("--before");
  const before = new Set(beforeFile && fs.existsSync(beforeFile) ? fs.readFileSync(beforeFile, "utf8").split(/\s+/).filter(Boolean) : []);
  const planted = require(path.join(__dirname, "..", "..", "tests", "lib", "storedTotalsPlanted.js"));
  const orgs = (await query(`SELECT id FROM orgs ORDER BY id`)).map(r => r.id).filter(id => !before.has(id));
  const t0 = Date.now();
  const bad = [], held = [];
  for (const id of orgs) {
    let r;
    try { r = await checkOrg(id, { narrow: true, sample: 40 }); }
    catch (e) { if (/no org/.test(e.message)) continue; bad.push({ id, line: `the check could not run: ${e.message}` }); continue; }
    const hits = r.problems.filter(p => RULES.includes(p.rule));
    if (!hits.length) continue;
    const line = hits.map(p => `${p.count} ${p.rule} e.g. ${JSON.stringify(p.examples.slice(0, 2))}`).join("; ");
    (planted.lookup(id) ? held : bad).push({ id, line });
  }
  for (const h of held) console.log(`  held  ${h.id}: ${h.line.slice(0, 160)}  (${planted.lookup(h.id)})`);
  for (const b of bad) console.log(`  FAIL  ${b.id}: ${b.line}`);
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(bad.length
    ? `after-battery numbers: ${bad.length} of ${orgs.length} org(s) the suites made left a stored total, First/Largest/Last or a removed-gift row wrong (${secs}s)`
    : `after-battery numbers: ${orgs.length} org(s) the suites made, every stored total adds up (${secs}s, ${held.length} planted on purpose)`);
  return bad.length ? 1 : 0;
}

main().then(rc => process.exit(rc)).catch(e => { console.error(e); process.exit(2); });
