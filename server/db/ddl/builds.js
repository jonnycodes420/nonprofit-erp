// server/db/ddl/builds.js · RULES-1 item 6. ONE SCHEMA FILE PER BUILD.
//
// part7.js caused merge conflicts in four builds in one week, because every build appended
// its DDL (or its require line) to the end of it. Now a build's DDL is its own module in
// server/db/ddl/builds/, named for the day and the brief: `2026-11-24-rules1.js`. Boot runs
// every file in that folder in name order, so the order is fixed by the names (a date first,
// then the brief), and two builds on the same day touch two different files.
//
// Each module exports `run(pool)`: additive DDL only (CREATE … IF NOT EXISTS, ADD COLUMN IF
// NOT EXISTS), on part7's DDL session (a short lock_timeout and a retry). No rows are written.
// The schema hash already reads every file under server/db/ (schemaSources.js), so a new file
// runs the init once; clean1-merge reads this folder for person columns.
//
// part7.js no longer grows: the split-shells ratchet caps it (docs/architecture/ARCHITECTURE.md).
"use strict";
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "builds");
const NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.js$/;

// The folder's modules, in the order boot runs them. A file not named for its day refuses boot.
function files() {
  let names;
  try { names = fs.readdirSync(DIR); } catch { return []; }
  const js = names.filter(n => n.endsWith(".js")).sort();
  const bad = js.filter(n => !NAME.test(n));
  if (bad.length) throw new Error(`server/db/ddl/builds: name each file YYYY-MM-DD-<brief>.js (${bad.join(", ")})`);
  return js.map(n => path.join(DIR, n));
}

async function run(pool) {
  for (const f of files()) await require(f).run(pool);
}

module.exports = { run, files, DIR, NAME };
