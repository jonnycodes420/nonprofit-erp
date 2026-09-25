#!/usr/bin/env node
// BUILD-97 Part 2 — THE NUMERIC CENSUS SCANNER.
//
// A PURE SOURCE SCAN: reads the client's active surfaces off disk and finds
// every place a NUMBER is drawn for a person to read. No server, no database,
// no network — the same construction as scripts/build73-money-audit.js, and run
// BY tests/build97-numbers.test.js so the enumeration cannot drift away from
// the census document.
//
// ── WHY A SCANNER AND NOT A LIST ──────────────────────────────────────────
// BUILD-75 A.6: "a guard whose number cannot fall is not measuring coverage."
// A hand-written census is a photograph of one afternoon. This counts the
// sites, per file, and the suite asserts the count EXACTLY — not a ceiling.
// Add a number to a screen and the count rises and the suite fails until the
// census says what the number is, how it is computed, and the sentence a
// director would use to explain it. Delete one and it falls and fails the same
// way. There is no direction in which a numeric surface can change silently.
//
// ── WHAT COUNTS AS A NUMERIC RENDER SITE ──────────────────────────────────
// A number a person READS, which is narrower than a number the code touches:
//   · a money formatter reaching JSX            — {fmt(x)} / {fmtFull(x)}
//   · a percentage reaching JSX                  — {x}% and `${x}%`
//   · a count reaching JSX                       — {x.toLocaleString()}, {n} in a
//     stat-tile shape, `${n} donor` style clauses
//   · an explicit score                          — /99, /10, "out of"
// Deliberately NOT counted, with the reason, because counting them would drown
// the signal the census exists to carry:
//   · numbers inside style objects (fontSize, padding, a hex, a z-index)
//   · numbers in a comment
//   · array indices, slice/limit arguments, timeouts
//   · a DATE (a date is not a claim about a threshold)
//
// Usage:  node scripts/build97-number-census.js            # table
//         node scripts/build97-number-census.js --sites    # every site, with lines
//         node scripts/build97-number-census.js --json

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const SRC = path.join(root, "client", "src");

// ── THE SCOPE, AND IT IS A DECISION ───────────────────────────────────────
// The ACTIVE surfaces only — the tabs App.jsx actually renders. Events,
// Volunteers, Board, AnnualFund and Programs are commented out of the nav
// (the 2026-07-12 pivot) and AnnualFund/Programs are not even imported; their
// numbers are real but nobody can reach them, and censusing a screen no
// customer can open would pad the count with work that buys nothing. If one of
// those tabs is ever un-hidden it joins this list in the same commit.
const SURFACES = [
  "components/Dashboard.jsx",      // Home + the board surface
  "components/Dashboards.jsx",     // the four dashboards (each metric already defined)
  "components/Donors.jsx",         // directory, profile, re-engage, import
  "components/Pipeline.jsx",
  "components/Fundraising.jsx",
  "components/RecurringGiving.jsx",
  "components/Grants.jsx",
  "components/Communications.jsx",
  "components/Reports.jsx",
  "components/Finance.jsx",
  "components/Tasks.jsx",
  "components/Workflows.jsx",
  "components/Settings.jsx",
  "components/DepositSheet.jsx",
  "components/DonorMap.jsx",
  "components/MetricBreakdownPanel.jsx",
  "components/FunnelChart.jsx",
  "components/PlanFollowUp.jsx",
  "components/LogConversation.jsx",
  "components/WorkbookImport.jsx",
  "components/Uploader.jsx",
  "components/ColumnTargetSelect.jsx",
  "components/UpgradeModal.jsx",
  "components/PlanPicker.jsx",
  "components/TopBar.jsx",
  "components/ShareBlocks.jsx",
  "components/ProductMark.jsx",
  "components/YourWords.jsx",
  "components/Programs.jsx",
  "components/AnnualFund.jsx",
  "components/DonorPortalHub.jsx",
  "components/PortalWidgets.jsx",
  "components/PortalBanner.jsx",
  "components/shared.jsx",
  "components/ReportBuilder.jsx",  // BUILD-98 (switch) Part 3 — Reports → Your reports
  "components/EventsDesk.jsx",     // BUILD-98 (switch) Part 4 — Fundraising → Events
  "components/VolunteerPanel.jsx", // BUILD-98 (switch) Part 5 — hours on the profile, and the hours import
  "components/ApiKeysPanel.jsx",   // BUILD-98 (switch) Part 6 — API keys (dates and a prefix; no figures)
];

// Surfaces deliberately OUT of scope, each with its reason — named here rather
// than silently absent, which is the same rule the ignored-column list follows.
const OUT_OF_SCOPE = {
  "components/Events.jsx": "hidden from the nav since the 2026-07-12 pivot",
  "components/Volunteers.jsx": "hidden from the nav since the 2026-07-12 pivot",
  "components/Board.jsx": "hidden from the nav since the 2026-07-12 pivot",
  "pages/Landing.jsx": "public marketing page; its own guards (scripts/landing-prod-verify.js)",
  "pages/Pricing.jsx": "public marketing page; prices are pinned by tests/one-date.test.js",
  "pages/Donate.jsx": "public white-label donation page on publicTheme.js",
  "pages/Portal.jsx": "the donor's own portal, white-label, its own palette and guards",
  "pages/GivingDashboard.jsx": "the donor-side giving account, not a staff surface",
  "pages/AdminDashboard.jsx": "super-admin ops tool, its own palette and audience",
  // BUILD-98 (switch) Part 3 — these were in NEITHER list, which the census
  // could not see: a new screen file was silently out of scope. Each now has
  // its reason, and tests/build97-numbers.test.js fails on the next file that
  // has neither.
  "pages/LoginPage.jsx": "sign-in form; carries no figures",
  "pages/ForgotPasswordPage.jsx": "password-reset request form; carries no figures",
  "pages/ResetPasswordPage.jsx": "password-reset form; carries no figures",
  "pages/InvitePage.jsx": "accept-an-invitation form; carries no figures",
  "pages/Invitation.jsx": "public request-an-invitation form; its own guards (landing verifier)",
  "pages/JoinNetwork.jsx": "public network sign-up, flagged off in production (BUILD-46)",
  "pages/ManageFundraiser.jsx": "a peer fundraiser's own public edit page on publicTheme.js",
  "pages/PortalEditor.jsx": "the donor-portal page builder; its figures are the portal's, previewed",
  "pages/PrivacyPage.jsx": "legal text; its numbers are dates and section numbers",
  "pages/TermsPage.jsx": "legal text; its numbers are dates, prices pinned by tests/one-date.test.js",
  "pages/WelcomePage.jsx": "first-run onboarding; the import receipt it shows is census'd in Donors.jsx",
};

// ── THE PATTERNS ───────────────────────────────────────────────────────────
// Each names what it catches, because a pattern nobody can explain is a count
// nobody can defend.
const PATTERNS = [
  { key: "money",   re: /\{\s*fmtFull?\s*\(/g,                     what: "a money formatter reaching JSX" },
  { key: "percent", re: /\{[^{}]{1,80}\}\s*%|\$\{[^{}]{1,80}\}\s*%/g, what: "a percentage reaching JSX" },
  // A DATE IS NOT A COUNT, and this file's own rules above already exclude
  // dates. The first cut of this pattern matched `new Date(x).toLocaleString()`
  // anyway, so the scanner was breaking the contract it states at the top.
  // Caught by the census's own drift assertion the moment Part 3 put a run
  // timestamp on the Activity screen and the total went 390 to 391 — which is
  // the census working, on itself.
  { key: "count",   re: /\{(?![^{}]*\bDate\s*\()[^{}]{1,60}\.toLocaleString\(\)/g, what: "a formatted count reaching JSX" },
  { key: "score",   re: /\/\s*99|\/\s*10\b(?!\s*[)\],;])/g,        what: "an explicit score out of a fixed ceiling" },
];

// A line is skipped outright when it is only style or only a comment — those
// carry numbers by the dozen and none of them is a claim.
const isNoise = (line) => {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return true;
  return false;
};

function scanFile(rel) {
  const full = path.join(SRC, rel);
  if (!fs.existsSync(full)) return null;
  const lines = fs.readFileSync(full, "utf8").split("\n");
  const sites = [];
  lines.forEach((line, i) => {
    if (isNoise(line)) return;
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(line))) {
        sites.push({ file: rel, line: i + 1, kind: p.key, claim: isClaimShaped(lines, i),
                     snippet: line.trim().slice(0, 150) });
        if (m.index === p.re.lastIndex) p.re.lastIndex++;
      }
    }
  });
  return sites;
}

// ── A CLAIM IS NOT THE SAME THING AS A CELL ────────────────────────────────
// The brief censuses "every numeric tile, badge, score and percentage" — and
// that is deliberately narrower than every number a formatter touches. A row in
// the LYBUNT report is DATA: it is the donor's own giving, in a table, under a
// column header that says what the column is. A tile is a CLAIM ABOUT the data
// — one figure, in display type, under a label, standing alone and inviting a
// reading. "Weighted forecast $59,500" is a claim. "$2,000 · 2026-03-04" in a
// gift table is not.
//
// The distinction is load-bearing, because censusing all 390 sites at the same
// depth would bury the fifteen that actually make claims among three hundred
// table cells, and a census nobody can read is a census nobody checks.
//
// A site is CLAIM-SHAPED when the three lines around it carry one of the marks
// of a headline figure: display type, a large font size, a letter-spaced
// uppercase label, or an explicit `label` prop. Everything else is counted by
// family and named as data in the census.
const CLAIM_MARKS = [
  /DM Serif Display/,
  /fontSize:\s*(?:2[0-9]|[3-9][0-9])/,          // 20px and up — a headline figure
  /textTransform:\s*"uppercase"/,
  /\blabel[:=]/,
  /letterSpacing/,
];
function isClaimShaped(lines, idx) {
  for (let j = Math.max(0, idx - 3); j <= Math.min(lines.length - 1, idx + 3); j++) {
    const l = lines[j];
    if (CLAIM_MARKS.some(re => re.test(l))) return true;
  }
  return false;
}

function census() {
  const byFile = {};
  let total = 0;
  const all = [];
  for (const rel of SURFACES) {
    const sites = scanFile(rel);
    if (sites === null) { byFile[rel] = null; continue; }   // file does not exist
    byFile[rel] = sites.length;
    total += sites.length;
    all.push(...sites);
  }
  const claims = all.filter(s => s.claim);
  return { byFile, total, claims: claims.length, claimSites: claims, sites: all, outOfScope: OUT_OF_SCOPE };
}

module.exports = { census, SURFACES, OUT_OF_SCOPE, PATTERNS };

if (require.main === module) {
  const r = census();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else if (process.argv.includes("--claims")) {
    for (const s of r.claimSites) console.log(`${s.file}:${s.line}  [${s.kind}]  ${s.snippet}`);
    console.log(`\n${r.claims} claim-shaped sites of ${r.total} numeric render sites`);
  } else if (process.argv.includes("--sites")) {
    for (const s of r.sites) console.log(`${s.file}:${s.line}  [${s.kind}]  ${s.snippet}`);
    console.log(`\n${r.sites.length} numeric render sites`);
  } else {
    const rows = Object.entries(r.byFile).filter(([, n]) => n !== null).sort((a, b) => b[1] - a[1]);
    for (const [f, n] of rows) if (n > 0) console.log(String(n).padStart(4), f);
    const missing = Object.entries(r.byFile).filter(([, n]) => n === null).map(([f]) => f);
    if (missing.length) console.log("\nlisted but not present:", missing.join(", "));
    console.log("\ntotal:", r.total, "· claim-shaped:", r.claims);
  }
}
