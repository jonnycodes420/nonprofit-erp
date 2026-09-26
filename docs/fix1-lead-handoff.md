# FIX-1 — lead handoff (26 September 2026, after the workstreams)

The FIX-1 lead's state of play. The brief is `claude/FIX-1.md` (with
Jonathan's amendment). This file supersedes the post-split handoff of the
same day (`083d453`; read it in git history for how the split is wired — the
routes/ modules, `mount(ctx)`, readSource, the `../` rule — all still true).

## 1. Where fix-1 is

`fix-1` at **`__HEAD__`**, pushed. Nothing is merged to main; that is
Jonathan's call. On top of the split (`083d453`), first-parent:

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

**Evidence on `__HEAD__`** (local stack, fresh `steward_fix1`, demo seeded by
run-all): full battery **__BATTERY__**; tenant-matrix 43/0 and
tenant-isolation 32/0 inside it; SKIP grep shows only assertion names
("…SKIPPED…"), no skipped leg; client lint 0 errors / 563 warnings (was 673);
TDZ 0 self-references; route inventory 635 routes (618 + D 3 + C 9 + A 4 + E 1).
Part 0 (`tests/fix1-walk.test.js`, not in CORE): **79 green / 1 red** — the
one red is §12 (below). The walk: 42 screens at 1440 and 390, zero page
errors, zero sideways scroll, no NaN / undefined / `$-` / `**` on any screen,
screenshots in `docs/fix-1/walk/` (+ `walk.json`).

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
Fixture/wait only (no assertion text): tenant-matrix resolvers for the new
`:id` routes; `fix1-people` reset clears `fin_audit_log`; `fix1-volunteers`
reads App.jsx through readSource and its year through `civilToday`; the
three `waitFor` suites; build101-renewals' wait.

## 4. Waiting on Jonathan

1. **§12, the sidebar.** Part 0 wants `PRIMARY_NAV` =
   Home, Donors, Fundraising, Volunteers, Agent, Reports, Finance with
   everything else under More. Today it is
   `dashboard, board, donors, fundraising, volunteers, agent, reports`.
   Getting there changes two pinned assertions no section calls for:
   `build86` "Dashboard sits directly under Home in the sidebar" (Dashboards
   would leave the rail) and `locked-features` "finance folds into More"
   (Finance would join the rail; CORE_HIDDEN_TABS still hides it on Core).
   Not done — the stop rule. Say yes and it is a four-line change.
2. **The demo org.** CLAUDE.md still says the demo login is
   admin@creoarts.org (org_creo). FIX-1 made Harborlight the demo (see §2).
   CLAUDE.md is untouched until Jonathan confirms; prod's Harborlight needs
   `node scripts/seed-demo.js` run against prod (its guarded prod path, which
   only ever touches org_b72demo) if it is to be the pitch there.
3. **Members and Funds placement** in Fundraising (B put Members under
   Campaigns & pages, Funds under Money in; `docs/fix-1/B-NOTES.md`).
4. **The Finance cut** (Accounts tab, the two AI buttons) stands as the brief
   proposed; `docs/fix-1/E-NOTES.md` lists what went.
5. **Volunteer sign-up link** never expires and cannot be revoked; an email
   already on file gains the Volunteer role (`docs/fix-1/C-NOTES.md`).

## 5. For a later FIX (found, not fixed)

- The `recordGift` exceptions: `docs/fix-1/recordGift-exceptions.md`.
- Home's failed-card clause counts a subscription with NO `first_failed_at`
  as this week; the rail tile does not. Two rules for one number; the demo no
  longer trips it, the product still can.
- The donor profile still says "day 0" on an open step and draws "117d ago"
  in red for last contact (both predate FIX-1).
- `fmt()` (compact) renders "$175.5" for sub-$1k amounts with cents.
- The empty-org sweep no longer visits the Pipeline board (no sidebar
  button); fix1-fundraising covers it on a populated org.
- `uploader` (not in CORE) is 69/1 on file inputs in files FIX-1 did not add.
- The eslint config cannot see JSX-only usage; one rule change would clear
  hundreds of false "unused" warnings (C disabled it for VolunteersHub.jsx).

## 6. Databases, ports, scripts

Lead `~/steward-fix1` · `steward_fix1` · 5701/4301 (sink 5702, mocks 5703/5704).
Workstream worktrees `~/steward-fix1-{a..e}` (branches `fix-1-{a..e}2`, dbs
`steward_fix1_{a..e}`, ports 57x1/43x1) are merged and can be removed. The
stack/battery/walk scripts lived in the session scratchpad (not committed):
boot = the run-all.sh header env with the port block substituted; battery =
run-all with BASE, APP_URL, SINK_PORT, STRIPE_MOCK_PORT, BILLING_MOCK_PORT,
NODE_PATH=~/steward-qa/node_modules, DATABASE_URL, SUITE_LOG_DIR. Regenerate
the route inventory against a FRESH database (a used one fails schema init
on suite fixtures) with the server env set.

## 7. How this build ends (not done here; needs the merge to main)

Per the brief: full battery, tenant battery, landing verifier, prod smoke, CI
green, both SHAs, "prod is N behind main", and the same walk recorded on a
fixture org. Everything up to the merge is done on fix-1 except §12.
