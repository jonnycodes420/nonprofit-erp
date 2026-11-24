#!/usr/bin/env node
// scripts/ci/served-scan.js · RULES-1 item 1. EVERY HOURS SUM COUNTS THROUGH SERVED.
//
// VOL-3 put the rule in one place (shared/numbers/served.js: a volunteer_shifts row
// counts once its day has come) and fixed the readers it found. The ones it didn't
// find kept counting tomorrow's shift: Jarvis, Nov 23, "future-dated volunteer hours
// are still counted on the person profile sidebar, contradicting the Volunteers area".
//
// This scan reads every app file (not tests, scripts, the client or the DDL) and, for
// each SELECT that sums over `volunteer_shifts` (a SUM( and the word hours between the
// SELECT and the table), requires `SERVED(` or `SERVED_LIVE(` in that query: in the SELECT's own text or
// in its WHERE, up to where the sub-select closes. A sum that means to include future
// shifts on purpose (a sign-up's planned hours) is allowlisted below with its reason.
//
// Proven able to fail: --self-test plants a bare `SELECT SUM(hours) FROM volunteer_shifts`
// and watches it caught, and one with SERVED pass. On RULES-1 the first run (before
// the fixes) named the profile sidebar (server/donors/routes.js) and the rest of the
// brief's list.
//
// Usage: node scripts/ci/served-scan.js [--self-test]. Exits 1 and prints file:line.
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");

// Sums that include shifts dated after today ON PURPOSE. { file, has, reason }: the
// query is allowed when it is in `file` and its text contains `has`.
// None today: RULES-1 found every sum meant hours served (volunteerScheduling.js's group
// rosters, which the brief asked about, already count through SERVED).
const ALLOW = [];

const SKIP = f => /^(tests|scripts|client|node_modules|server\/db\/ddl|docs|audit)\//.test(f) || f === "shared/numbers/served.js";

function lineOf(text, i) { return text.slice(0, i).split("\n").length; }

// One file's offending reads: [{ line, snippet }].
function scanText(file, text) {
  const out = [];
  const re = /\bvolunteer_shifts\b/g;
  let m;
  while ((m = re.exec(text))) {
    const i = m.index;
    const ls = text.lastIndexOf("\n", i) + 1;
    const lineText = text.slice(ls, text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i)).trim();
    if (/^(\/\/|\*|\/\*)/.test(lineText)) continue;                // a comment
    // The SELECT this table belongs to: the nearest one above, inside the same string.
    const back = text.slice(Math.max(0, i - 1500), i);
    const sel = back.search(/\bSELECT\b(?![\s\S]*\bSELECT\b)/i);
    if (sel < 0) continue;                                         // an INSERT, UPDATE or DELETE
    const head = back.slice(sel);
    if (/[;]/.test(head.replace(/\$\{[^}]*\}/g, ""))) continue;   // a different statement
    if (!/\bSUM\s*\(/i.test(head) || !/hours/i.test(head)) continue;
    // Its tail: to where the sub-select closes, or the string ends.
    let depth = 0, j = i, end = Math.min(text.length, i + 1500);
    for (; j < end; j++) {
      const c = text[j];
      if (c === "`") break;
      if (c === "$" && text[j + 1] === "{") { let d = 0; for (; j < end; j++) { if (text[j] === "{") d++; else if (text[j] === "}" && --d === 0) break; } continue; }
      if (c === "(") depth++;
      else if (c === ")") { if (--depth < 0) break; }
    }
    const query = head + text.slice(i, j);
    if (/\bSERVED(_LIVE)?\s*\(/.test(query)) continue;
    const near = query + text.slice(j, j + 300);                   // its alias may follow the close
    const allow = ALLOW.find(a => a.file === file && near.includes(a.has));
    if (allow) continue;
    out.push({ line: lineOf(text, i), snippet: lineText.slice(0, 140) });
  }
  return out;
}

if (process.argv.includes("--self-test")) {
  const bad = scanText("x.js", "const r = await query(`SELECT COALESCE(SUM(hours), 0) AS h\n  FROM volunteer_shifts WHERE org_id = ?`, [o]);");
  const sub = scanText("x.js", "q(`SELECT d.id, (SELECT SUM(vs.hours) FROM volunteer_shifts vs WHERE vs.person_id=d.id) AS h, (SELECT 1 FROM gifts g WHERE ${SERVED('g', t)}) FROM donors d`)");
  const good = scanText("x.js", "q(`SELECT SUM(ROUND(hours*100)) FROM volunteer_shifts WHERE org_id=? AND ${SERVED(null, today)}`)");
  const insert = scanText("x.js", "q(`INSERT INTO volunteer_shifts (id, hours) VALUES (?, ?)`)");
  ALLOW.push({ file: "routes/volunteerScheduling.js", has: "AS planned_hours", reason: "self-test" });
  const allowed = scanText("routes/volunteerScheduling.js", "q(`SELECT o.id, COALESCE((SELECT SUM(vs.hours) FROM volunteer_shifts vs WHERE vs.opportunity_id=o.id), 0) AS planned_hours FROM o`)");
  const pass = bad.length === 1 && sub.length === 1 && good.length === 0 && insert.length === 0 && allowed.length === 0;
  if (!pass) { console.error("served-scan self-test FAILED", { bad, sub, good, insert, allowed }); process.exit(1); }
  console.log("served-scan self-test: a bare hours sum is caught (alone and as a sub-select); SERVED, an INSERT and an allowlisted sum pass.");
  process.exit(0);
}

const files = execSync("git ls-files '*.js'", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean).filter(f => !SKIP(f));
const bad = [];
for (const f of files) {
  let text; try { text = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
  if (!text.includes("volunteer_shifts")) continue;
  for (const b of scanText(f, text)) bad.push(`${f}:${b.line}  ${b.snippet}`);
}
if (bad.length) {
  console.error(`served-scan: ${bad.length} hours sum(s) over volunteer_shifts without SERVED (shared/numbers/served.js).`);
  console.error("Count through SERVED(alias, orgToday), or add the read to ALLOW in this file with its reason.\n");
  for (const b of bad) console.error("  " + b);
  process.exit(1);
}
console.log(`served-scan: every hours sum over volunteer_shifts counts through SERVED (${files.length} files read).`);
