#!/usr/bin/env node
// scripts/ci/donor-label-scan.js · RULES-1 item 3. THE DONOR LABEL IS THE GIVING RULE.
//
// Jarvis, Nov 23: "A new $0 person is labelled 'Donor' on their profile but is not on the Donors
// tab." A Donor is someone who has given (shared/numbers/isDonor.js). The stored roles
// (person_types) still hold "donor" for a person added with no gift, so any screen that draws its
// label from the stored roles calls a contact a Donor. Global search did (TopBar's chip read
// typeLabels over the stored roles, "Donor · $0 lifetime"); the server now sends the roles through
// isDonor.typesOnRead and the client reads them as sent.
//
// This scan reads the client (not the marketing site) and fails on a line that draws a donor
// label or decision from person roles: typeLabels( / typesOf( / isDonor from shared/personType.js,
// or a test for "donor" in a roles list. Each line that does so today reads roles the server
// already sent through typesOnRead (or GET /people/:id shown_types), and is allowlisted below with
// that reason. A new one needs a line here and a reviewer who agrees.
//
// Proven able to fail: --self-test plants `typeLabels(d).includes("Donor")` and
// `d.personTypes.includes("donor")` and watches both caught. On RULES-1, before the fix, it named
// TopBar.jsx's search chip and DonorDirectory.jsx's count word.
//
// Usage: node scripts/ci/donor-label-scan.js [--self-test]. Exits 1 and prints file:line.
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const PATTERN = /\btypeLabels\s*\(|\btypesOf\s*\(|\bisDonor\b[^\n]*from\s+["'][./]*shared\/personType|includes\(\s*["']donor["']\s*\)/;

// { file, has, reason }: allowed when the line is in `file` and contains `has`.
const ALLOW = [
  { file: "client/src/components/TopBar.jsx", has: "const shownLabels = ",
    reason: "reads person_types as routes/search.js sent them (typesOnRead); typeLabels only for a row with no roles sent" },
  { file: "client/src/components/DonorDirectory.jsx", has: "Array.isArray(t)&&t.includes(\"donor\")",
    reason: "the /donors list's rows, whose roles server/donors/routes.js sends through typesOnRead" },
  { file: "client/src/components/profile/profileShared.jsx", has: "const gave=s?s.includes(\"donor\")",
    reason: "RoleLine: GET /people/:id shown_types (typesOnRead), or no gifts on the profile" },
];

function scanText(file, text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (/^(\/\/|\*|\/\*|\{\/\*)/.test(t)) return;
    if (!PATTERN.test(line)) return;
    if (ALLOW.some(a => a.file === file && line.includes(a.has))) return;
    out.push({ line: i + 1, snippet: t.slice(0, 140) });
  });
  return out;
}

if (process.argv.includes("--self-test")) {
  const a = scanText("client/src/x.jsx", 'const chip = typeLabels(d).includes("Donor") ? "Donor" : "Contact";');
  const b = scanText("client/src/x.jsx", 'const isD = (d.personTypes||[]).includes("donor");');
  const c = scanText("client/src/x.jsx", "// typeLabels(d) in a comment");
  if (a.length !== 1 || b.length !== 1 || c.length !== 0) { console.error("donor-label-scan self-test FAILED", { a, b, c }); process.exit(1); }
  console.log("donor-label-scan self-test: a label from typeLabels and a roles test for \"donor\" are caught; a comment is not.");
  process.exit(0);
}

const files = execSync("git ls-files client/src", { cwd: ROOT, encoding: "utf8" }).split("\n")
  .filter(f => /\.(js|jsx)$/.test(f) && !f.startsWith("client/src/marketing/"));
const bad = [];
for (const f of files) {
  let text; try { text = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
  for (const b of scanText(f, text)) bad.push(`${f}:${b.line}  ${b.snippet}`);
}
if (bad.length) {
  console.error(`donor-label-scan: ${bad.length} line(s) draw a Donor label from stored roles (person_types).`);
  console.error("A Donor is someone who has given: read roles the server sent through isDonor.typesOnRead, and allowlist the line here with that reason.\n");
  for (const b of bad) console.error("  " + b);
  process.exit(1);
}
console.log(`donor-label-scan: every Donor label in the client reads the giving rule (${files.length} files read).`);
