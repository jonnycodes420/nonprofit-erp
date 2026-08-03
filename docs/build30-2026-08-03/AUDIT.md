# BUILD-30 — one definition: assignment = portfolio = pipeline board

**Date:** 2026-08-03

## The bug (verified on live prod, org_creo, Team, logged in as admin)

| Surface | Definition (before) | Result |
|---|---|---|
| Home "Portfolio" card | `COUNT/SUM(total_giving) WHERE assigned_to = me` (`server.js`) | **16 · $358,251** |
| Home "Pipeline" card | `… WHERE assigned_to = me AND stage ∈ pipeline` | **16 · $358,251** |
| Pipeline board membership | `WHERE in_pipeline = TRUE` (+ scope) | **3** |

Three surfaces, two definitions of one concept. A separate boolean
`donors.in_pipeline` (added 2026-07-21) was the board's membership marker, but
Home counted `assigned_to`. On this org **all 16 donors were `assigned_to` the
admin, yet only 3 had `in_pipeline = TRUE`** — so Home said 16 over a 3-card
board. Nothing kept the two states in sync (assignment set `in_pipeline` only on
some paths; seed/older assignment set `assigned_to` alone).

## The fix — assignment IS membership (one shared definition)

- **`portfolioMembership()` helper (server.js)** is the ONE definition: donors
  where `assigned_to` matches (org-scoped) **and** `stage ∈` the 6 pipeline
  stages. It feeds **Home's Portfolio card, Home's Pipeline card, the Pipeline
  board, and the officer-portfolios legend** — they cannot diverge again.
- **`in_pipeline` retired.** Nothing reads or writes it. The physical column is
  kept dormant (not dropped) to avoid a destructive live-prod migration; do NOT
  reintroduce a separate "on the board" flag. Assigning ⇒ on the board;
  unassigning ⇒ off the board (back to the Directory only).
- **Unassigned donors match nothing** in the helper → they stay in the Directory
  and never flood any board (preserves the 2026-07-21 "not the whole donor list"
  guarantee). A large *assigned* portfolio is legitimate and shows in full,
  paginated by the existing per-column cap + search/filters.
- The non-pipeline-stage guard (`stage ∈ 6`) means a donor in some stray stage
  (e.g. a hypothetical `closed`) is excluded from **all** surfaces identically —
  the one way the three counts could ever differ is closed off.

## Class audit — every Home stat card vs its destination

Second time a count and its destination disagreed (first: Finance $0 vs Reports
$697k). Swept every Home stat card:

| Card | Value source | Click destination | Verdict |
|---|---|---|---|
| **Portfolio** | `portfolioMembership` (mine) | Pipeline board, `scope:mine` | ✅ FIXED — lands on exactly N |
| **Pipeline** | `portfolioMembership` (scope) | Pipeline board, same scope threaded | ✅ FIXED — lands on exactly N |
| **Need to Do** | `visibleQueue.length` | scrolls to `#dash-needtodo` rendering `visibleQueue` | ✅ already consistent (same array) |
| **Tasks** | `/dashboard/home` tasks (scope-aware) | Tasks tab | ✅ FIXED — Tasks tab now honors `?scope`, defaults "Mine", and the card threads its scope |
| Portfolio "lifetime giving" ($358.3k) | `SUM(total_giving)` over the portfolio | same on both cards + the board | ✅ same source (asserted in tests) |
| Pipeline forecast (open asks) | open opps of the portfolio's donors | the board's asks (same donors) | ✅ aligned to the board |

Other count/destination pairs checked and left correct:
- **Directory Owner column** shows `assignedToName` when assigned, "—" only when
  genuinely unassigned — correct under the unified model (all 16 prod donors
  carry `assigned_to_name`, so the earlier "—" was pre-assignment/stale, not a
  live bug). Home's count of 16 is truthful; the board was the bug.
- Donors directory / Re-engage / Team / stage filters read `assigned_to` and the
  stage label directly — no separate counter to drift.

Remaining minor edge (documented, low severity): none outstanding — the Tasks
and Pipeline cards now thread their scope, so they match in both "mine" and
"all" Home-scope states.

## Part 2 — import → portfolio → board (automatic, no manual step)

Satisfied by the unification: import already sets `assigned_to` (Team owner
column / bulk / pending-invitee), and the board now derives membership from
assignment — so an imported+assigned donor appears on the officer's board in the
smart-stage-inferred stage with no extra step. Pending invitees resolve to a
populated board on acceptance. Unassigned imports stay in the Directory only.
Home counts reflect it immediately. (Covered by `import-assign.test.js`'s live
board-API assertions.)

## Part 3 — drag-and-drop on the board (Team)

Direct card drag between stage columns (`Pipeline.jsx`): optimistic move, a
one-field note prompt pre-filled `from → to` (Enter saves — never an empty move,
so the Week-in-Review/reports stay whole), rollback + a clear error toast on
server reject. The keyboard/button "Move →" path stays. Writes remain
`requirePlan('team')` + `checkWriteAccess`; the locked Core preview can't drag.
Concurrency handled by the existing server move guarantees (BUILD-27).

## Verification

- `tests/portfolio-pipeline-consistency.test.js` (NEW, 28/28): Home Portfolio ==
  Home Pipeline == board == the shared definition (count + value); assign/unassign
  updates all four; 0-assigned officer → 0 everywhere + empty board; unassigned
  never on any board (mine/all/by-officer); non-pipeline-stage donor excluded
  uniformly; click-through (board renders exactly the card's number); org-scoped.
- `tests/consistency-e2e.test.js` extended: Home pipeline value == the board's
  value, and == Σ(assigned/portfolio giving) not Σ(all donors).
- `tests/pipeline.test.js`, `moves`, `import-assign`, `home`, `portfolios`,
  `tasks` updated to the assignment model.
- **Full `bash tests/run-all.sh`: 43 suites, 0 failed.**
- Client builds clean (eslint `no-undef` gate + vite).
