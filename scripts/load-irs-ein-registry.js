#!/usr/bin/env node
// BUILD-46 §3.2(1) — load the IRS Tax-Exempt Organization list (Pub 78 data)
// into ein_registry, the table the network signup gate verifies EINs against.
//
// Source: https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads
//   → "Publication 78 Data" (data-download-pub78.zip). The extracted file is
//   pipe-delimited: EIN|Name|City|State|Country|Deductibility.
//
// REFRESH CADENCE: the IRS republishes Pub 78 monthly (typically the second
// Monday). Run this monthly — an org auto-delists (processNetworkGate) only if
// the registry is NON-empty and its EIN is missing/revoked, so a stale registry
// fails safe (it never delists on missing data, it just verifies against last
// month's list).
//
// Usage:
//   node scripts/load-irs-ein-registry.js path/to/data-download-pub78.txt
//   node scripts/load-irs-ein-registry.js --url   # fetch + load from irs.gov (needs unzip)
//
// Idempotent: upserts by EIN; rows absent from the new file are marked
// status='dropped' (never deleted — the audit trail of what was once listed).

const fs = require("fs");
const { execSync } = require("child_process");
const { getDb, query, run } = require("../db");

const PUB78_URL = "https://apps.irs.gov/pub/epostcard/data-download-pub78.zip";

async function main() {
  await getDb();
  let file = process.argv[2];
  if (file === "--url") {
    const tmp = "/tmp/steward-pub78";
    fs.mkdirSync(tmp, { recursive: true });
    console.log("Downloading", PUB78_URL, "…");
    execSync(`curl -sL -o ${tmp}/pub78.zip ${PUB78_URL} && cd ${tmp} && unzip -o pub78.zip`, { stdio: "inherit" });
    const extracted = fs.readdirSync(tmp).find(f => f.endsWith(".txt"));
    if (!extracted) throw new Error("no .txt in the IRS zip");
    file = `${tmp}/${extracted}`;
  }
  if (!file || !fs.existsSync(file)) {
    console.error("Usage: node scripts/load-irs-ein-registry.js <pub78.txt | --url>");
    process.exit(1);
  }
  const started = Date.now();
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let upserted = 0;
  const seen = new Set();
  for (const line of lines) {
    const [ein, name] = line.split("|");
    const digits = String(ein || "").replace(/\D/g, "");
    if (digits.length !== 9 || !name) continue;
    seen.add(digits);
    await run(
      `INSERT INTO ein_registry (ein, name, status, loaded_at) VALUES (?,?, 'ok', NOW())
       ON CONFLICT (ein) DO UPDATE SET name = EXCLUDED.name, status = 'ok', loaded_at = NOW()`,
      [digits, String(name).trim().slice(0, 300)]);
    upserted++;
    if (upserted % 25000 === 0) console.log(`  …${upserted}`);
  }
  // Anything previously listed but absent from this file is dropped (revoked/
  // removed by the IRS) — the auto-delist sweep acts on this.
  const dropped = await run(
    `UPDATE ein_registry SET status = 'dropped' WHERE status = 'ok' AND loaded_at < to_timestamp(?/1000.0)`,
    [started]);
  console.log(`Loaded ${upserted} EINs; marked ${dropped.changes || 0} previously-listed EINs as dropped.`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
