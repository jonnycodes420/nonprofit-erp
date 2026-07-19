// BUILD-19 — pipeline reconciliation + solid page titles.
//
// Part 1 proves there is exactly ONE pipeline surface and it is gated the same
// way from every entry point:
//   • the top-level Pipeline tab (Pipeline.jsx) is the canonical board and
//     renders the Core upgrade state when the server says data.locked;
//   • the pre-existing Donors → "My Pipeline" kanban (the free, ungated
//     backdoor board) is retired — no tab, no view block, no DonorKanban;
//   • the Home command-center portfolio cards route to the canonical Pipeline
//     tab, not the old donors sub-view;
//   • the server board endpoint stays requirePlan('team')-gated (the live
//     Core→locked / Team→board / read_only→402 behaviour is exercised end-to-
//     end in moves.test.js — this file guards the source so a future edit
//     can't quietly re-open the backdoor).
//
// Part 2 proves the shared PageTitle renders the whole title in one solid ink
// color (no faded/muted first word) with a tokenized gold underline.
//
// Pure Node source analysis (no React runner exists in this repo — same
// pattern as clickability.test.js / palette.test.js). Run:
//   node tests/pipeline-gating.test.js

const fs = require("fs");
const path = require("path");
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const has = (src, needle) => src.includes(needle);

const donors    = read("client/src/components/Donors.jsx");
const dashboard = read("client/src/components/Dashboard.jsx");
const pipeline  = read("client/src/components/Pipeline.jsx");
const shared    = read("client/src/components/shared.jsx");
const server    = read("server.js");

// ── Part 1: the Donors→My Pipeline backdoor is retired ─────────────────────
ok(!has(donors, '"My Pipeline"'), "Donors.jsx has no 'My Pipeline' view tab");
ok(!has(donors, '["pipeline","My Pipeline"]'), "Donors.jsx view toggle drops the pipeline entry");
ok(!has(donors, 'view==="pipeline"'), "Donors.jsx renders no view===\"pipeline\" board block");
ok(!/function DonorKanban\(/.test(donors), "the ungated DonorKanban board component is removed");
ok(!has(donors, "<DonorKanban"), "nothing renders <DonorKanban> anymore");
ok(!has(donors, 'from "./FunnelChart"'), "the now-unused FunnelChart import is removed from Donors.jsx");
// The per-donor stage quick-label (DonorProfile dropdown) is deliberately kept
// as a Core-fine single-donor label change (BUILD-15 note) — it is NOT a board.
ok(has(donors, "const moveToStage"), "per-donor stage quick-label (moveToStage) is retained");
ok(has(donors, "onStageChange={moveToStage}"), "DonorProfile still exposes the single-donor stage dropdown");

// ── Part 1: the canonical Pipeline tab is the one gated surface ─────────────
ok(has(pipeline, "data.locked"), "Pipeline.jsx branches on the server's locked flag");
ok(has(pipeline, "Team plan") && has(pipeline, "See plans"), "Pipeline.jsx renders the Core upgrade card");
ok(has(server, 'requirePlan("team")') || has(server, "requirePlan('team')"), "server gates the pipeline on the Team plan");
ok(/app\.get\("\/pipeline"/.test(server), "GET /pipeline is the single board data endpoint");

// ── Part 1: Home portfolio cards point at the canonical tab ────────────────
ok(!has(dashboard, 'onNavigate("donors",{view:"pipeline"})'), "Home no longer deep-links to the retired donors sub-view");
ok(!has(dashboard, 'view:"pipeline"'), "no view:\"pipeline\" intent survives anywhere on Home");
ok(has(dashboard, 'onNavigate("pipeline")'), "Home portfolio cards route to the canonical Pipeline tab");

// ── Part 2: solid page titles (no faded first word) ────────────────────────
const ptMatch = shared.match(/export function PageTitle\(\{[^}]*\}\)\s*\{[\s\S]*?\n\}/);
ok(!!ptMatch, "PageTitle component located in shared.jsx");
const pt = ptMatch ? ptMatch[0] : "";
ok(!/color:T\.ink3\}\}>\{main\}/.test(pt), "first word no longer uses the muted T.ink3 color");
ok(/color:T\.ink\}\}>\{main\}/.test(pt), "first word (main) renders in solid T.ink");
ok(/color:T\.ink,borderBottom[^}]*\}\}>\{accent\}/.test(pt), "accent word also renders in solid T.ink");
ok(!/#c9a84c/.test(pt) && /T\.gold500/.test(pt), "gold underline is tokenized (T.gold500, no raw hex)");

console.log(`\npipeline-gating: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
