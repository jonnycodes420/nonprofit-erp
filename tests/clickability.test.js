// BUILD-12 Parts 1 & 2 — "everything clickable" + "no subtitle blurb" guards.
// Pure Node source analysis (no React runner exists in this repo; verification
// is committed as static assertions over the JSX + the backend route). Run:
//   node tests/clickability.test.js
//
// Part 2 proves: the shared interactive() treatment exists (role=button,
// keyboard-activatable, focus ring) and is applied to the Fundraising goal
// card, all four Overview stat tiles, the leading-campaign card, and the
// recent-gift rows (which deep-link to the donor), plus the Finance Overview
// stat cards / fund rows / monthly rows and the Funds-subtab drill link.
// Part 1 proves: the removed page-subtitle blurbs are gone.

const fs = require("fs");
const path = require("path");
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const has = (src, needle) => src.includes(needle);
const count = (src, needle) => src.split(needle).length - 1;

const shared = read("client/src/components/shared.jsx");
const fund   = read("client/src/components/Fundraising.jsx");
const fin    = read("client/src/components/Finance.jsx");
const reports= read("client/src/components/Reports.jsx");
const server = read("server.js");

// ── Part 2: shared interactive() treatment ─────────────────────────────────
ok(/export function interactive\(/.test(shared), "shared.jsx exports interactive()");
ok(has(shared, 'role: "button"'), "interactive() sets role=button (accessible name/role)");
ok(has(shared, "tabIndex: 0"), "interactive() is keyboard-focusable (tabIndex 0)");
ok(has(shared, '"Enter"') && has(shared, "onKeyDown"), "interactive() activates on Enter/Space");
ok(has(shared, ".click-card:focus-visible"), "GlobalStyles gives .click-card a visible focus ring");
ok(has(shared, ".click-card:hover"), "GlobalStyles gives .click-card a hover wash");

// ── Part 2: Fundraising (the showcase) — everything clickable ───────────────
ok(has(fund, "interactive") && /import .*interactive.* from "\.\/shared"/.test(fund), "Fundraising imports interactive");
ok(has(fund, 'interactive(() => onGoto && onGoto("campaigns"), { label: "View campaigns", dark: true })'), "Goal card → Campaigns (dark variant)");
ok(has(shared, ".click-card-dark:focus-visible"), "dark interactive panels get a focus ring too");
ok(has(shared, ".click-card-dark:hover") && !/click-card-dark:hover\{background/.test(shared), "dark hover keeps the pine gradient (no bg override)");
// StatTile forwards onClick through interactive()
ok(/function StatTile\(\{[^}]*onClick/.test(fund), "StatTile accepts onClick");
ok(/<div \{\.\.\.interactive\(onClick/.test(fund), "StatTile applies interactive(onClick)");
// All four Overview stat tiles route somewhere
ok(count(fund, 'onNavigate && onNavigate("reports")') >= 2, "Raised + Gifts tiles → Reports");
ok(has(fund, 'onClick={() => onGoto && onGoto("campaigns")}'), "Active campaigns tile → Campaigns");
ok(has(fund, 'onClick={() => onGoto && onGoto("pages")}'), "Live giving pages tile → Giving Pages");
// Leading campaign card interactive; recent-gift rows deep-link to donor
ok(has(fund, 'interactive(() => onGoto && onGoto("campaigns"), { label: `View campaign'), "Leading campaign card → Campaigns");
ok(has(fund, 'onNavigate("donors", { selectDonorId: g.donorId })'), "Recent-gift row → donor profile");
// The old dead hidden button is gone
ok(!has(fund, 'style={{ display: "none" }}'), "dead hidden nav button removed");

// backend supplies donorId for the recent-gift deep-link
ok(has(server, "g.donor_id, d.name AS donor_name"), "/fundraising/overview selects g.donor_id");
ok(has(server, "donorId: g.donor_id || null"), "/fundraising/overview returns donorId");

// ── Part 2: Finance app-wide pass ──────────────────────────────────────────
ok(/import \{[^}]*interactive[^}]*\} from "\.\/shared"/.test(fin), "Finance imports interactive");
ok(has(fin, "const gotoTxns = (patch = {}) =>"), "Finance has gotoTxns() drill helper");
ok(has(fin, 'gotoTxns({ type: "income" })') && has(fin, 'gotoTxns({ type: "expense" })'), "Revenue/Expense stat cards drill by type");
ok(/\.map\(\(\[label, value, color, caption, onClick\]\) => \(\s*<div key=\{label\} \{\.\.\.interactive\(onClick/.test(fin), "Finance stat cards are interactive");
ok(has(fin, "gotoTxns({ fund: f.id })"), "Fund rows drill to fund-filtered transactions");
ok(has(fin, "View txns →"), "Funds subtab row exposes a transactions drill link");
ok(has(fin, "View ${m.label} transactions"), "Monthly breakdown rows drill to transactions");

// ── Part 1: no page-subtitle blurb clutter (removed strings) ────────────────
ok(!has(fund, "sub={narrative}") && !has(fund, "This is your fundraising command center"), "Fundraising subtitle blurb removed");
ok(!has(reports, "Six answers to the questions boards and funders actually ask"), "Reports subtitle blurb removed");
ok(!has(reports, "How much did we raise this period, and from whom?"), "Reports per-report question line removed");
ok(!has(fin, "sub={narrative}") && !has(fin, "You're operating on ${fmtFull"), "Finance headline blurb removed");
// PageTitle for these three renders title only (no sub= prop)
ok(/<PageTitle main="Your" accent="fundraising." \/>/.test(fund), "Fundraising PageTitle = title only");
ok(/<PageTitle main="Your" accent="Reports" \/>/.test(reports), "Reports PageTitle = title only");
ok(/<PageTitle main="Your" accent="finances."\/>/.test(fin.replace(/\n/g, " ")) || fin.includes('<PageTitle main="Your" accent="finances."/>'), "Finance PageTitle = title only");
// Part 1 information-not-lost: the one unique number (vs-prior delta) survives
ok(has(fin, "revDeltaCaption"), "Finance vs-prior-period delta surfaced on a stat card caption (not dropped)");

console.log(`\nclickability.test.js — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
