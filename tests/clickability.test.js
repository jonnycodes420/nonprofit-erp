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
const grants = read("client/src/components/Grants.jsx");
const comms  = read("client/src/components/Communications.jsx");
const donors = read("client/src/components/Donors.jsx");
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

// ── Part 2: app-wide pass — Grants + Communications + Donors ────────────────
ok(/import \{[^}]*interactive[^}]*\} from "\.\/shared"/.test(grants), "Grants imports interactive");
ok(has(grants, "const [statusFilter,setStatusFilter]=useState(null)"), "Grants pipeline has a status filter");
ok(has(grants, "interactive(()=>setStatusFilter(on?null:s)"), "Grants pipeline cards toggle the filter (interactive)");
ok(has(grants, "data.grants.filter(g=>!statusFilter||g.status===statusFilter)"), "Grant list respects the pipeline-card filter");
ok(/import \{[^}]*interactive[^}]*\} from "\.\/shared"/.test(comms), "Communications imports interactive");
ok(has(comms, "onClick: () => setNav(\"campaigns\")"), "Comms 'Campaigns Sent' card → Campaigns subtab");
ok(has(comms, 'interactive(() => setNav("campaigns"), { label: `View campaign ${bestCampaign.name}`'), "Comms 'Best Campaign' card → Campaigns subtab");
// Donors entity rows already navigate (pre-existing) — spot-check they carry onSelectDonor.
ok(has(donors, "onClick={()=>onSelectDonor(d)}"), "Donors TeamView rows open the donor profile");

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

// ── Attribution FIX — Home hero chips are drillable ─────────────────────────
// The four dark-hero chips (Pace · This FY · This week · Re-engaged) route
// through the ONE shared interactive() treatment (dark variant — keyboard
// focus/activation included) to destinations that show the SAME number the
// chip claimed (the count-matches-destination rule; the live agreement
// assertions run in tests/attribution-completeness.test.js Part 6).
const dash = read("client/src/components/Dashboard.jsx");
ok(/const GoalStat=\(\{label,value,valueColor,sub,onClick\}\)/.test(dash), "GoalStat accepts onClick");
ok(has(dash, "interactive(onClick,{label:onClick?`Open ${label}`:undefined,dark:true})"), "GoalStat routes through interactive() (dark variant, keyboard-accessible)");
ok(count(dash, 'onClick={()=>onNavigate("fundraising")}/>') >= 2, "Pace chip → Fundraising Overview (both hero branches)");
ok(has(dash, 'onNavigate("reports",{report:"giving-summary",preset:"thisFY",yearMode:"fiscal"})'), "This-FY chip → Reports Giving Summary (current FY, fiscal)");
ok(has(dash, 'onNavigate("reports",{report:"giving-summary",from:tw.start,to:tw.end})'), "This-week chip → Giving Summary filtered to the chip's exact week");
ok(has(dash, "setReengBreakdownOpen(true)"), "Re-engaged chip opens its donor drill-down");
ok(has(dash, "impact?.reengagedDonors"), "Re-engaged drill-down lists the donors behind the number");
// Time Left has no destination — it must stay visibly static (no dead click).
ok(/label="Time Left"[^/]*sub="left to reach this goal"\/>/.test(dash), "Time Left chip stays static (no onClick — no dead click)");
// The Reports deep-link intent is real (App threads it, Reports consumes it).
const appSrc = read("client/src/App.jsx");
ok(has(appSrc, "setReportsIntent"), "App.jsx carries a reports intent");
ok(has(appSrc, "initialReport={reportsIntent?.report}"), "Reports receives initialReport");
ok(has(reports, "initialReport, initialParams"), "Reports consumes initialReport/initialParams");
ok(has(reports, 'initialParams?.from && initialParams?.to) ? "custom"'), "Reports maps a from/to intent onto the custom preset");

console.log(`\nclickability.test.js — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
