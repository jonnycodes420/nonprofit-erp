// BUILD-20 Parts 3 + 4 — grouped sidebar + Givebutter-style locked previews.
//
// Pure Node source analysis (no React runner exists in this repo — same
// pattern as pipeline-gating.test.js / clickability.test.js). The LIVE tier
// gating (Core→locked-preview-with-own-data / Team→full board / read_only→402,
// and Core solicitations→200+locked with CSV→403) is exercised end-to-end in
// moves.test.js + reports-cadence.test.js. This file guards the SOURCE so a
// future edit can't quietly turn a locked preview back into a bare 403 card,
// re-hide a Team surface, or open a write path.
//
// Run: node tests/locked-features.test.js

const fs = require("fs");
const path = require("path");
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const has = (s, n) => s.includes(n);

const shared   = read("client/src/components/shared.jsx");
const pipeline = read("client/src/components/Pipeline.jsx");
const reports  = read("client/src/components/Reports.jsx");
const app      = read("client/src/App.jsx");
const server   = read("server.js");

// ── The reusable LockedFeature wrapper (shared.jsx) ────────────────────────
ok(/export function LockedFeature\(/.test(shared), "LockedFeature is exported once from shared.jsx");
ok(/export const LockGlyph\s*=/.test(shared), "LockGlyph (SVG padlock, not emoji) is exported from shared.jsx");
const lf = (shared.match(/export function LockedFeature\([\s\S]*?\n\}/) || [""])[0];
ok(/blur\(/.test(lf), "LockedFeature dims the real content behind a blur (frosted glass)");
ok(/pointerEvents:\s*"none"/.test(lf), "LockedFeature makes the previewed content non-interactive");
ok(has(lf, "{children}"), "LockedFeature renders the REAL surface (its children) behind the glass");
ok(has(lf, "Team plan") && has(lf, "Unlock with Team"), "LockedFeature shows the Team-plan unlock CTA");
ok(has(lf, "<LockGlyph"), "LockedFeature uses the SVG lock glyph, not an emoji");

// ── Pipeline: the board renders behind the glass with the org's own data ───
ok(has(pipeline, "LockedFeature") && /import\s*\{[^}]*LockedFeature/.test(pipeline), "Pipeline imports LockedFeature");
ok(/const board = \(/.test(pipeline), "Pipeline builds the real board once (const board)");
ok(/<LockedFeature[\s\S]*\{board\}[\s\S]*<\/LockedFeature>/.test(pipeline), "Pipeline wraps the REAL board in LockedFeature when locked (own data behind glass)");
ok(!/Manage a major-gifts pipeline[\s\S]*T\.gold300[\s\S]*See plans →<\/button>/.test(pipeline), "the old bare upgrade-card block is gone");

// ── Server: Core gets a READ-only board preview (own data), writes still 403 ─
ok(/const locked = tier !== "team";/.test(server), "GET /pipeline computes the board for Core too (locked = tier !== team), not an empty short-circuit");
ok(!/return res\.json\(\{ tier, locked: true, stages, officers: \[\], columns: \{\}, forecast: null \}\)/.test(server), "the old empty-columns Core short-circuit is removed");
ok(/app\.post\("\/pipeline\/:donorId\/move", requireAuth, requirePlan\("team"\), checkWriteAccess/.test(server), "the move WRITE route stays requirePlan('team') + checkWriteAccess (BUILD-19 gate intact)");
ok(/app\.post\("\/donors\/:id\/opportunities", requireAuth, requirePlan\("team"\)/.test(server), "the opportunity WRITE route stays Team-gated");

// ── Server: Team-only reports become a locked preview, CSV export stays 403 ─
ok(has(server, "reportLocked"), "reports handler tracks a reportLocked flag");
ok(/if \(reportLocked && req\.query\.format === "csv"\)[\s\S]*status\(403\)/.test(server), "CSV export of a locked report is still refused (403)");
ok(/if \(reportLocked && data && typeof data === "object"[\s\S]*data\.locked = true/.test(server), "a locked team report returns the org's own data flagged locked:true (not a 403)");

// ── Reports.jsx: dims the real report behind LockedFeature for Core ────────
ok(/import\s*\{[^}]*LockedFeature/.test(reports), "Reports imports LockedFeature");
ok(has(reports, "setPlanLocked(!!d?.locked)"), "Reports reads the server's locked flag from the payload");
ok(/if \(planLocked\) return \(\s*<LockedFeature/.test(reports), "Reports wraps the real report body in LockedFeature when locked");

// ── App.jsx Part 3: grouped sidebar, Pipeline top-level in People ──────────
ok(/const NAV_GROUPS\s*=/.test(app), "App defines NAV_GROUPS for the grouped sidebar");
for (const label of ["People", "Fundraising", "Insight"]) ok(has(app, `label:"${label}"`), `sidebar has a "${label}" section`);
const people = (app.match(/\{label:"People",\s*ids:\[([^\]]*)\]/) || [,""])[1];
ok(/"donors"/.test(people) && /"pipeline"/.test(people) && /"tasks"/.test(people), "People group = Donors · Pipeline · Tasks (Pipeline top-level, not nested under Donors)");
const fund = (app.match(/\{label:"Fundraising",\s*ids:\[([^\]]*)\]/) || [,""])[1];
ok(/"fundraising"/.test(fund) && /"grants"/.test(fund) && /"communications"/.test(fund) && /"workflows"/.test(fund), "Fundraising group = Fundraising · Grants · Communications · Workflows");
const insight = (app.match(/\{label:"Insight",\s*ids:\[([^\]]*)\]/) || [,""])[1];
ok(/"reports"/.test(insight) && /"finance"/.test(insight), "Insight group = Reports · Finance");
ok(!/ids:\[[^\]]*"dashboard"/.test(app), "Home (dashboard) stays ungrouped at the top");
ok(has(app, 'navigateTo("settings")'), "Settings stays pinned at the bottom (its own nav call)");

// ── App.jsx Part 4: Team-gated sidebar items show a lock for Core ──────────
ok(/const TEAM_GATED\s*=\s*new Set\(\["pipeline"\]\)/.test(app), "TEAM_GATED marks the Pipeline nav item");
ok(/import\s*\{[^}]*LockGlyph/.test(app), "App imports the SVG LockGlyph for the sidebar indicator");
ok(has(app, "TEAM_GATED.has(t.id)&&isCoreTier"), "a lock indicator shows only for Core users on Team-gated items (visible, not removed)");
ok(has(app, "<LockGlyph"), "the sidebar renders the lock glyph for locked items");

// ── Donor-profile Core/Team split (FIX) ────────────────────────────────────
// The donor profile stays full CRM for Core; only the major-gifts LAYER is
// Team, wrapped in the SAME LockedFeature (via `lockMajor`) — no new pattern.
// Reads stay visible (behind glass); writes/compute are requirePlan('team').
const donors = read("client/src/components/Donors.jsx");
ok(/import\s*\{[^}]*LockedFeature/.test(donors), "Donors imports the shared LockedFeature (reuses the ONE wrapper, no new pattern)");
const lm = (donors.match(/const lockMajor=\([\s\S]*?\n  \);/) || [""])[0];
ok(/const lockMajor=/.test(donors), "DonorProfile defines lockMajor (the Core/Team split wrapper)");
ok(/isTeam\?children:/.test(lm), "lockMajor passes children through for Team, wraps only for Core (writes stay server-gated)");
ok(/<LockedFeature/.test(lm), "lockMajor wraps the Core preview in the shared LockedFeature");
ok((donors.match(/lockMajor\(/g) || []).length >= 3, "lockMajor is applied to the major-gifts panels (moves & asks, sequences, and the stage/wealth/actions rail)");
// The major-gifts panels are the ones locked
ok(/Pipeline: Moves & Asks[\s\S]{0,300}lockMajor\(/.test(donors), "the Pipeline moves & asks panel is wrapped in lockMajor");
ok(/Major-gifts rail[\s\S]{0,400}lockMajor\(<>/.test(donors), "the Suggested Move / Move Stage / Wealth / Suggested Actions rail is locked as ONE preview");
ok(/sequences\.length>0&&lockMajor\(/.test(donors), "the Sequences enroll panel is locked for Core");
// Reassign (owner display stays; the write control is Team)
ok(/isAdmin&&isTeam&&<button onClick=\{\(\)=>setShowReassign/.test(donors), "the Reassign control is Team-gated (owner shown read-only for Core)");
ok(/showReassign&&isAdmin&&isTeam&&/.test(donors), "the Reassign form is Team-gated too");
// Directory write controls (same capabilities) are hidden for Core
ok(/teamPortfolios&&<div style=\{\{position:"relative"\}\}>[\s\S]{0,300}Move to stage/.test(donors), "directory bulk 'Move to stage' is Team-only");
ok(/\{isAdmin&&teamPortfolios&&orgTeam\.length>0&&\(/.test(donors), "directory bulk 'Assign to' is Team-only");
ok(/teamPortfolios&&<button[\s\S]{0,120}onAssign\(d\)/.test(donors), "directory per-row 'Assign' is Team-only");
// CRM core is NOT gated — still fully available to Core
ok(has(donors, "GivingHistoryChart") && has(donors, "Gifts & Pledges") && has(donors, "Materials"), "CRM core (giving history, Gifts & Pledges, Materials tabs) stays present/ungated");

// ── Server: the major-gifts WRITE/COMPUTE routes are Team-gated ─────────────
ok(/app\.patch\("\/donors\/:id\/stage", requireAuth, requirePlan\("team"\)/.test(server), "PATCH /donors/:id/stage is requirePlan('team')");
ok(/app\.patch\("\/donors\/bulk-stage", requireAuth, requirePlan\("team"\)/.test(server), "PATCH /donors/bulk-stage is requirePlan('team')");
ok(/app\.patch\("\/donors\/:id\/assign", requireAuth, requireAdmin, requirePlan\("team"\)/.test(server), "PATCH /donors/:id/assign is requirePlan('team')");
ok(/app\.patch\("\/donors\/bulk-assign", requireAuth, requireAdmin, requirePlan\("team"\)/.test(server), "PATCH /donors/bulk-assign is requirePlan('team')");
ok(/app\.post\("\/donors\/:id\/score", requireAuth, requirePlan\("team"\)/.test(server), "POST /donors/:id/score is requirePlan('team')");
ok(/app\.post\("\/sequences\/:id\/enroll", requireAuth, requirePlan\("team"\)/.test(server), "POST /sequences/:id/enroll is requirePlan('team')");
// ── Server: the READS powering the previews stay open (visible for Core) ───
ok(/app\.get\("\/donors\/:id\/moves", requireAuth, wrap/.test(server), "GET /donors/:id/moves stays open (read visible behind glass)");
ok(/app\.get\("\/donors\/:id\/opportunities", requireAuth, wrap/.test(server), "GET /donors/:id/opportunities stays open (read)");
ok(/app\.get\("\/donors\/:id\/move-suggestions", requireAuth, wrap/.test(server), "GET /donors/:id/move-suggestions stays open (read)");

console.log(`\nlocked-features: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
