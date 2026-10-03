#!/usr/bin/env node
// scripts/load-irs-bmf.js · FIX-22. Load the IRS Exempt Organizations Business
// Master File (EO BMF) into irs_bmf, the one table the public filing lookup
// reads (prospect.js lookupFiling).
//
// Source (public domain, published by the IRS, refreshed monthly):
//   https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf
//   The four region files eo1.csv .. eo4.csv together cover every state:
//   https://www.irs.gov/pub/irs-soi/eo1.csv (eo2, eo3, eo4 the same way).
//   Per-state files (eo_me.csv, eo_ky.csv ...) are the same columns.
// Columns used: EIN, NAME, CITY, STATE, SUBSECTION, FOUNDATION, NTEE_CD,
// TAX_PERIOD (YYYYMM), ASSET_AMT, INCOME_AMT, REVENUE_AMT (whole dollars).
//
// Usage:
//   node scripts/load-irs-bmf.js                    download eo1..eo4 from irs.gov and load them
//   node scripts/load-irs-bmf.js --file a.csv [--file b.csv] [--date 2026-09-07]
//                                                   load local files (the date defaults to the file's mtime)
//   Production: add --i-know-this-is-prod to a remote DATABASE_URL (prodGuard).
//
// A run REPLACES the table with what it loaded, in one transaction, so a
// lookup never sees half of one month and half of another, and a failed run
// leaves last month's file in place. source_date is the IRS file's own date
// (its Last-Modified header when downloaded), which is what "Source: IRS,
// Exempt Organizations Business Master File, <month year>" quotes.
//
// The server creates irs_bmf at boot (db.js initSchema); this script only
// fills it, and refuses if the table is not there yet (deploy first).
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { Readable } = require("stream");

const IRS_FILES = ["eo1.csv", "eo2.csv", "eo3.csv", "eo4.csv"].map(f => `https://www.irs.gov/pub/irs-soi/${f}`);
const BATCH = 5000;

// One CSV line, quote-aware ("A, B" stays one field; "" is a quote).
function splitLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const dollarsToCents = v => {
  const s = String(v == null ? "" : v).trim();
  if (!s || !/^-?\d+$/.test(s)) return null;
  return String(BigInt(s) * 100n);
};
// One BMF row to the table's shape, or null when it has no nine-digit EIN.
function rowOf(header, fields) {
  const get = k => { const i = header.indexOf(k); return i < 0 ? "" : String(fields[i] == null ? "" : fields[i]).trim(); };
  const ein = get("EIN").replace(/\D/g, "");
  if (ein.length !== 9) return null;
  const tp = get("TAX_PERIOD");
  return {
    ein, name: get("NAME") || null, city: get("CITY") || null, state: get("STATE") || null,
    subsection: get("SUBSECTION") || null, foundation: get("FOUNDATION") || null, ntee: get("NTEE_CD") || null,
    assets: dollarsToCents(get("ASSET_AMT")), income: dollarsToCents(get("INCOME_AMT")), revenue: dollarsToCents(get("REVENUE_AMT")),
    taxPeriod: /^\d{6}$/.test(tp) ? tp : null,
  };
}

async function insertBatch(client, rows, sourceFile, sourceDate) {
  if (!rows.length) return;
  const col = k => rows.map(r => r[k]);
  // unnest keeps it to one statement per batch; a repeated EIN (it happens
  // across region files) keeps the later row.
  await client.query(
    `INSERT INTO irs_bmf (ein, name, city, state, subsection, foundation, ntee_cd, assets_cents, income_cents, revenue_cents, tax_period, source_file, source_date, loaded_at)
     SELECT DISTINCT ON (ein) ein, name, city, state, subsection, foundation, ntee_cd, assets::bigint, income::bigint, revenue::bigint, tax_period, $12, $13::date, NOW()
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[])
         WITH ORDINALITY AS t(ein, name, city, state, subsection, foundation, ntee_cd, assets, income, revenue, tax_period, ord)
      ORDER BY ein, ord DESC
     ON CONFLICT (ein) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, state = EXCLUDED.state, subsection = EXCLUDED.subsection,
       foundation = EXCLUDED.foundation, ntee_cd = EXCLUDED.ntee_cd, assets_cents = EXCLUDED.assets_cents, income_cents = EXCLUDED.income_cents,
       revenue_cents = EXCLUDED.revenue_cents, tax_period = EXCLUDED.tax_period, source_file = EXCLUDED.source_file,
       source_date = EXCLUDED.source_date, loaded_at = NOW()`,
    [col("ein"), col("name"), col("city"), col("state"), col("subsection"), col("foundation"), col("ntee"),
      col("assets"), col("income"), col("revenue"), col("taxPeriod"), sourceFile, sourceDate]);
}

// Stream one file (a local path or a fetched body) into the table.
async function loadStream(client, input, sourceFile, sourceDate) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let header = null, batch = [], n = 0;
  for await (const raw of rl) {
    const line = raw.replace(/^﻿/, "");
    if (!line.trim()) continue;
    if (!header) {
      header = splitLine(line).map(h => h.trim().toUpperCase());
      if (!header.includes("EIN") || !header.includes("ASSET_AMT")) throw new Error(`${sourceFile} does not look like an EO BMF file (no EIN / ASSET_AMT header).`);
      continue;
    }
    const r = rowOf(header, splitLine(line));
    if (!r) continue;
    batch.push(r);
    if (batch.length >= BATCH) { await insertBatch(client, batch, sourceFile, sourceDate); n += batch.length; batch = []; if (n % 100000 === 0) console.log(`  ${sourceFile}: ${n}`); }
  }
  await insertBatch(client, batch, sourceFile, sourceDate);
  return n + batch.length;
}

const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The loader as a function, so a test can load the fixture through the same
// code: sources = [{ file } | { url }], date optional.
async function load(client, { sources, date } = {}) {
  const [{ t }] = (await client.query(`SELECT to_regclass('irs_bmf') AS t`)).rows;
  if (!t) throw new Error("irs_bmf does not exist yet. Boot the server on this database first (db.js creates it).");
  await client.query("BEGIN");
  try {
    await client.query("DELETE FROM irs_bmf");
    const done = [];
    for (const s of sources) {
      if (s.file) {
        const sourceDate = date || isoDate(fs.statSync(s.file).mtime);
        const n = await loadStream(client, fs.createReadStream(s.file), path.basename(s.file), sourceDate);
        done.push({ file: path.basename(s.file), rows: n, sourceDate });
      } else {
        const r = await fetch(s.url, { headers: { "User-Agent": "Steward (stewardapp.dev)" } });
        if (!r.ok) throw new Error(`${s.url} answered ${r.status}`);
        const lm = r.headers.get("last-modified");
        const sourceDate = date || isoDate(lm ? new Date(lm) : new Date());
        const n = await loadStream(client, Readable.fromWeb(r.body), path.basename(new URL(s.url).pathname), sourceDate);
        done.push({ file: path.basename(new URL(s.url).pathname), rows: n, sourceDate });
      }
    }
    await client.query("COMMIT");
    return done;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

module.exports = { load, splitLine, rowOf, IRS_FILES };

if (require.main === module) {
  const url = require("./lib/prodGuard").writerDbUrl(); // remote needs --i-know-this-is-prod (BUILD-55)
  const argv = process.argv.slice(2);
  const files = [], at = k => argv.indexOf(k);
  argv.forEach((a, i) => { if (a === "--file" && argv[i + 1]) files.push(argv[i + 1]); });
  const date = at("--date") >= 0 ? argv[at("--date") + 1] : null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("--date is YYYY-MM-DD (the IRS file's date)."); process.exit(1); }
  for (const f of files) if (!fs.existsSync(f)) { console.error(`No such file: ${f}`); process.exit(1); }
  const sources = files.length ? files.map(file => ({ file })) : IRS_FILES.map(u => ({ url: u }));
  const { Client } = require("pg");
  const loop = /localhost|127\.0\.0\.1/.test(url);
  const client = new Client({ connectionString: url, ssl: loop ? false : { rejectUnauthorized: false } });
  (async () => {
    await client.connect();
    const t0 = Date.now();
    console.log(`Loading the IRS EO BMF from ${files.length ? files.join(", ") : IRS_FILES.join(", ")}`);
    const done = await load(client, { sources, date });
    for (const d of done) console.log(`  ${d.file}: ${d.rows} rows, IRS file dated ${d.sourceDate}`);
    const [{ n }] = (await client.query("SELECT COUNT(*)::int AS n FROM irs_bmf")).rows;
    console.log(`irs_bmf now holds ${n} organisations (${((Date.now() - t0) / 1000).toFixed(1)}s).`);
    await client.end();
  })().catch(async e => { console.error(e.message || e); await client.end().catch(() => {}); process.exit(1); });
}
