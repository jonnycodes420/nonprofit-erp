# FIX-1 — lead handoff (27 September 2026, merged to main)

The FIX-1 lead's state of play. The brief is `claude/FIX-1.md` (with
Jonathan's amendment). This file supersedes the post-split handoff of the
same day (`083d453`; read it in git history for how the split is wired — the
routes/ modules, `mount(ctx)`, readSource, the `../` rule — all still true).

## 1. Where fix-1 is

FIX-1 is **merged to main** on Jonathan's word (27 Sep), through the PR from `fix-1`; §8 has the PR, the CI runs and the live SHAs. On top of the split (`083d453`), first-parent:

| Commit | What |
|---|---|
| `b9cb4a7` | Findings 9, 10, 11, 13 (the lead) |
| `f830f9d` | `settle()` → `waitFor()` in theme-depth / donor-dashboard / donor-accounts; `docs/fix-1/recordGift-exceptions.md` |
| `e7de392` | merge **D** — people, without the lecture |
| `a8d57a6` | merge **C** — Volunteers, its own hub |
| `cb82b50` | audience "where they live" links → Volunteers / Settings (D + C follow-up) |
| `5a051b0` | merge **B** — Fundraising, four questions |
| `5dc6478` | merge **A** — Steward Agent, the run sheet |
| `90e4934` | Agent confirm runs the gift form's after-gift steps (unlapse, wealth score) |
| `4da5b9f` | merge **E** — Finance that earns its place |
| `02e7971` | two dates back through the seam (date-seam 68, test-clock-seam 76) |
| `a023c3d` | build101-renewals §10 waits for the Renewed row (a battery-load flake) |
| `f939b48` | the demo's failed card has the day it failed (found by the walk) |
| `06c2d45` | Home's Thread rows read at 390 again (found by the walk; predates FIX-1) |
| `32a0e4b` | PageTitle's underline no longer cuts its sentence at 390; Volunteers says its empty sentence once |
| `b7f2afc` | the 26 Sep handoff and the walk |
| `a782338` | **§12** — the rail is Home, Donors, Fundraising, Volunteers, Agent, Reports, Finance (Jonathan approved) |
| `b065875` | CLAUDE.md: Harborlight is the demo; the rail as it now is |
| `b19569a` `a462f9b` | the volunteer sign-up link can be taken back (red first, then the fix) |
| `244058e` `8ffa957` | Home's institutional list: gift vs grant by kind, dates as "Jan 14, 2026" (red first, then the fix) |
| `7088516` | two browser checks B's fold had silently stopped running, running again |

**Evidence on `7088516`** (local stack, fresh `steward_fix1`, demo seeded by
run-all): full battery **245 suites green, 0 red** (239 + six fix1-* suites; demo-shape runs, 33/0); tenant-matrix 43/0 and
tenant-isolation 32/0 inside it; SKIP grep shows only assertion names
("…SKIPPED…"), no skipped leg; client lint 0 errors / 562 warnings (was 673);
TDZ 0 self-references; route inventory 636 routes (618 + D 3 + C 9 + A 4 + E 1 +
the link regenerate). Part 0 (`tests/fix1-walk.test.js`, not in CORE): **80 green, 0 red**.
A per-suite assertion-count diff against the pre-merge battery found no
unexplained drop (presentation-wiring and empty-states had dropped silently;
`7088516` restored both). The walk: 22 screens × 1440 and 390 (44 captures, logged in to the local
demo, read-only), zero page errors, zero sideways scroll, no NaN / undefined / `$-` / `**` on any screen,
screenshots in `docs/fix-1/walk/` (+ `walk.json`). Each was looked at: that
looking found the two 390 layout defects fixed in `06c2d45` and `32a0e4b`,
which no automated check saw. The profile's Suggested panel reads "Stream
failed: 503" on the local stack only (no ANTHROPIC_API_KEY).

CI does not run on `fix-1` (ci.yml: main and PRs to main).

## 2. What each workstream shipped (their notes: `docs/fix-1/<X>-NOTES.md`)

- **Lead (findings 9/10/11/13).** `shared/threadFigures.js`: a row's figure is
  max(days open, days late); the Thread header's "oldest", the badges, the
  rail and the Home sentence all read it, and `stat.oldest` covers the whole
  list. The Home sentence counts the header's overdue number, never the capped
  list. `giverCountWord`: people get her word, organisations are
  organisations, a mix is givers. **The demo is Harborlight** (`org_b72demo`,
  director@harborlight.demo / demo-harbor-2026): `scripts/seed-demo.js` (the
  old seed-build72-demo, renamed), with organisation donors and a Thread in a
  development office's words; its seasonal anchor 420 → 440 days (420 made the
  seed REFUSE on late-month dates — the real cause of the demo-shape skip);
  demo-shape never skips; CI and run-all seed it. org_creo stays the boot-seed
  fixture the suites use.
- **D.** Donors shows donors (`role=donor`); role chips under the name, one
  write each (`PUT /people/:id/roles`); Donor is set by giving and removing it
  while gifts exist is refused (409 with the sentence) from the chip and from
  `PUT /donors/:id`; staff and board under Settings → Organization; search says
  what each person is; the "Everyone is on one list" paragraph is gone.
  Donors.jsx's unused imports pruned (lint 673 → 563).
- **C.** Volunteers hub: roster (hours this year in hundredths = the record,
  last shift, also gives), shifts and hours (+ the existing Wranglr/VolunteerHub
  importer), a signed sign-up link (`/volunteer/join`, GET writes nothing),
  internal notes in their own `volunteer_notes` table (never interactions,
  timeline or Drift — proven able to fail), volunteers who give.
- **B.** Fundraising: Overview · Campaigns & pages · Major gifts · Money in
  (`client/src/lib/fundraisingSections.js`). Every old id deep-links
  (`?fr=<id>`, `navigateTo("pipeline")`); the sidebar Pipeline folded into
  Major gifts and keeps its Team gate there; no sideways scroll at 1440/390;
  every figure equal to the pre-change capture in cents.
- **A.** Agent, Direction 2: Plans, Ask, Workflows (moved from its own tab),
  Waiting for you, Guardrails (pause, can/cannot, the 30-day undo list moved
  from Settings). The plan is compiled from the steps that run (the model's
  schema has no summary); the Sunrise gift is PREPARED and recorded only on
  her confirm, through `recordGift`, her as actor, once (409 twice); reads
  scoped to what she named; run state is the server's (`GET /agent/runs/:id`);
  suggestions pass `shared/suggestionGuard.js` (plain text, every kept
  sentence cites a row); organisations are never "sponsors" (`giverWordFor`).
- **E.** Finance leads with Restricted; a payout expands to its charges,
  refunds and fees, each linked, reconciled in integer cents
  (`shared/payoutReconcile.js`), and one that does not reconcile names the
  difference; the bookkeeper export as a monthly close; cash on hand has its
  sentence and a $0 Stripe balance is explained; `fmtFull` sign-first
  everywhere. Cut: the Accounts tab and the AI "6-Month Forecast" / "Risk
  Analysis" buttons (`/finance/accounts` routes kept; other surfaces use them).

## 3. Assertion changes, and why each was allowed

Called for by a section:
- `finance-funds` fmtFull pin `$-4,200` → `-$4,200` (§E, reviewed contract).
- `locked-features`, `empty-states` sidebar lists lose Pipeline (§B) and
  Workflows (§A), gain Agent (§A). `build97-agent`'s browser leg navigates to
  Agent → Guardrails (same testids, same assertions).
- `build97-numbers` EXPECTED census: Finance.jsx 43 → 38, total 413 → 408,
  claims 121 → 123 (§E changed what Finance draws; the census is exact by design).
- `demo-shape` §3: three assertions read `/impact` fields BUILD-83 deleted on
  purpose; they now ask the same questions of `/drift` (§11, "fixes
  demo-shape"). Its skip path became a failure.
- `script-guards`: the classification entry renamed with the seed file.
- **§12, approved by Jonathan (27 Sep)** — three pins of one fact: `build86`
  "Dashboard sits directly under Home in the sidebar" → "Dashboards is on the
  desktop rail's More"; `locked-features` "Home leads the rail and Dashboards
  is the item under it" → "…Donors is the item under it" (the third pin of the
  same property; the brief named two); `locked-features` "finance folds into
  More" → Finance is a primary rail item.
Fixture/wait/navigation only (no assertion text): tenant-matrix resolvers for
the new `:id` routes; `fix1-people`/`fix1-volunteers` resets clear
`fin_audit_log`; `fix1-volunteers` reads App.jsx through readSource and its
year through `civilToday`; the three `waitFor` suites; build101-renewals'
wait; presentation-wiring and empty-states reach the Pipeline board by
`?fr=pipeline`.

## 4. Jonathan's answers (27 Sep), and where each landed

1. §12 sidebar — yes: `a782338`.
2. Harborlight is the demo — CLAUDE.md and `docs/decisions/architecture.md`
   say so (`b065875`). **Jonathan runs the prod seed himself**
   (`node scripts/seed-demo.js` through its guarded prod path, which only ever
   touches org_b72demo).
3. Members/Funds placement — approved as B built it.
4. The Finance cut — approved.
5. The volunteer link must be revocable — `a462f9b`:
   `orgs.volunteer_link_version` is signed into the link; "Make a new link"
   (Volunteers → Sign-up link, behind a confirm) bumps it, the old link 404s
   and its form writes nothing, the audit log says who. fix1-volunteers §9,
   proven able to fail.
Also asked: Home's institutional list says "last grant" only for foundations
and DAFs and "last gift" for churches and businesses, with dates as
"Jan 14, 2026" (`shared/institutional.js`, `8ffa957`; fix1-institutional).

## 5. For a later FIX (found, not fixed)

- The `recordGift` exceptions: `docs/fix-1/recordGift-exceptions.md`.
- Home's failed-card clause counts a subscription with NO `first_failed_at`
  as this week; the rail tile does not. Two rules for one number; the demo no
  longer trips it, the product still can.
- The donor profile still says "day 0" on an open step, draws "117d ago"
  in red for a stale last contact, and the Lapsed pill is red (all predate
  FIX-1; overdue should be brass).
- `fmt()` (compact) renders "$175.5" for sub-$1k amounts with cents.
- `uploader` (not in CORE) is 69/1 on file inputs in files FIX-1 did not add.
- The eslint config cannot see JSX-only usage; one rule change would clear
  hundreds of false "unused" warnings (C disabled it for VolunteersHub.jsx).
- A server restarted on a database that has run a battery fails schema init
  (`opportunities_one_open_per_fund` against suite fixtures) and does not come
  up; every stack here boots on a fresh database. Prod is unaffected (no
  fixtures), but a migration that dies on data is worth a look.

## 6. Turning on agent drafting

One gate decides it (`agentGate` in server.js, via `aiGate`), and it answers
with a reason when it is off:
- **The server needs `ANTHROPIC_API_KEY`.** Without it every drafting surface
  says `agent_unavailable` / `brief_unavailable` rather than inventing text.
- **The org must not have switched it off:** Settings → Data → "Reading and
  drafting" (`orgs.ai_enabled`; NULL/true is on). Admins only.
- **The agent must not be paused:** Agent → Guardrails → "Pause everything"
  (`orgs.agent_paused_at`).
- Then every step is still drafted for a person: nothing reaches a donor or
  moves money until she confirms it on the run sheet.
Locally: add `ANTHROPIC_API_KEY=<key>` to the server's env (the run-all.sh
header env) and restart; `AGENT_MODEL` is set in server.js. On prod: Railway →
nonprofit-erp → Variables → `ANTHROPIC_API_KEY` (NEEDS-JONATHAN §3 records it
as already set, and asks for a spend cap on that Anthropic workspace first).

## 7. Databases, ports, scripts

Lead `~/steward-fix1` · `steward_fix1` · 5701/4301 (sink 5702, mocks 5703/5704).
The workstream worktrees, branches and databases are removed (all merged).
The stack/battery/walk scripts lived in the session scratchpad (not
committed): boot = the run-all.sh header env with the port block
substituted; battery = run-all with BASE, APP_URL, SINK_PORT,
STRIPE_MOCK_PORT, BILLING_MOCK_PORT, NODE_PATH=~/steward-qa/node_modules,
DATABASE_URL, SUITE_LOG_DIR. Regenerate the route inventory against a FRESH
database with the server env set.

## 8. The merge

Filled in after the merge: the PR, CI on it and on main, and both live SHAs.
