// BUILD-50 (directory chip fix) — the "Officer portfolios" chip row on the donor
// directory hides officers with 0 assigned donors. Source-guard (pure, no DB),
// same style as brand-glyph / reserved-recovered.
//
// Scope note: this is the CHIP ROW only. Officers with 0 donors remain in
// Settings → Team and in every owner/assign dropdown, which read /portfolio/
// officers directly (unfiltered) — so this guard does NOT touch those.

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error("  ✗ " + name); } };

const src = fs.readFileSync(path.join(__dirname, "..", "client/src/components/Donors.jsx"), "utf8");

// Locate the Officer portfolios chip row and inspect just that block.
const i = src.indexOf("Officer portfolios</span>");
ok("Officer portfolios chip row present", i !== -1);
const region = src.slice(i, i + 500);

// The chip row filters officers to those with a real portfolio before mapping.
ok("chip row filters officers by portfolio_count > 0 before .map",
  /officers\.filter\(\s*o\s*=>\s*Number\(o\.portfolio_count\)\s*>\s*0\s*\)\.map/.test(region));

// Regression guard: the row must NOT map the raw, unfiltered officers list.
ok("chip row does NOT render the unfiltered officers list",
  !/Officer portfolios<\/span>[\s\S]{0,120}\{officers\.map\(/.test(src));

console.log(`\nofficer-chip: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
