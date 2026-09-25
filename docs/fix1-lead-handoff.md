# FIX-1 — lead handoff (25 September 2026)

Written by the FIX-1 lead session before it was cleared. The brief, with
Jonathan's amendment, is `claude/FIX-1.md` on this branch. This file is the
state of play; read it and the brief before touching anything.

## 1. Branches and worktrees

| Branch | Last SHA | Worktree | State |
|---|---|---|---|
| `fix-1` (lead) | `1ba724a` before this file | `~/steward-fix1` | Part 0 committed RED (381d4d7). Brief + amendment (`claude/FIX-1.md`). Two Agent directions + decision (`docs/fix-1/agent-directions/`). **No product code changed.** `server.js`, `App.jsx` and `Donors.jsx` untouched, per the amendment. |
| `fix-1-a` | `98b9f93` | none (removed) | Stopped mid-way. `shared/suggestionGuard.js` new (the §4 validator; §4 green by its own report); `shared/agentShape.js` + `shared/vocabulary.js` modified (compilePlan/scope/runIsLive/giverWordFor work in progress). Server side not started. No design mockups on it (the lead made those on `fix-1`). |
| `fix-1-c` | `5af62c6` | none (removed) | Stopped mid-way. Red suite committed (7755ccb, 27 assertions); `routes/volunteers.js` started; `db.js` + `server.js` modified (volunteer_notes table, route mounting). Was widening the actor-stamp guard to `routes/*.js`. |
| `fix-1-d` | `31ae106` | none (removed) | Stopped mid-way. Red suite committed (2e3159a, 10 pass / 25 fail); `routes/people.js`, `server.js`, `scripts/lib/routeInventory.js` modified. Server side green by its own report; client (Directory filter, chips, Settings list, search labels, paragraph removal) NOT started. |
| `fix-1-e` | `a688b84` | none (removed) | Stopped mid-way. `routes/finance.js` + `shared/payoutReconcile.js` new; `money.js` (fmtFull sign-first), `Finance.jsx`, `RestrictedView.jsx`, `server.js`, `tests/finance-funds.test.js` modified. Was fixing `data-testid`s that `Card` drops. |

All four workstream branches are based on `fix-1` at 381d4d7 (Part 0 only), are
pushed, unfinished and **not reviewed**. Their commits are titled "PARKED:
FIX-1 workstream x, stopped before the split". After the split, each workstream
resumes from its own branch and moves its changes into the new files. Anything
it put in `server.js` must move into the split's `routes/` modules, not
alongside them.

**Part 0** (`tests/fix1-walk.test.js`, pure, no server): 22 red / 3 green at
381d4d7, output in `audit/fix1-verify-first-red.txt`. NOT in `run-all.sh`
CORE yet; the lead adds it when it goes green after the merges. It fixes the
contract names the workstreams build to.

## 2. Decisions made

- **The split comes first** (Jonathan's amendment). No workstream starts until
  the lead has split the monolith alone, with zero behaviour change.
- **Agent = Direction 2, "the run sheet"**: the cream/white sheet on ink.
  Content lives on the sheet; ink is the room around it. Mockups and README in
  `docs/fix-1/agent-directions/`. Jonathan: "I always love the white/cream."
  A is HELD until the split is done, then builds this way.
- **Merge order into `fix-1`: D, C, B, A, E.** Affected suites after each
  merge, full battery + tenant battery + the walk at the end. **No merge to
  main without Jonathan's word.**
- **Finance cut** (Accounts tab, AI "6-Month Forecast" + "Risk Analysis"):
  E removes the screens only, routes/tables stay. Jonathan has not objected
  yet; confirm with him before the merge.
- **Members and Funds** (Fundraising has 14 tabs, not 12): proposed Members
  under "Campaigns & pages" and Funds folded into Finance with a cross-link.
  Not yet confirmed by Jonathan. Part 0 §6 requires all 14 ids + `pipeline` to
  land on one of the four sections.
- The lecture paragraph ("Everyone is on one list") is in
  `Communications.jsx`'s audience hub, not Donors (Part 0 §7).

## 3. What we are waiting on, in order

1. **BUILD-102 on main.** `origin/build-102` at `f9b422d`: battery 230/0 and
   walk 62/0 by the 102 session's report. **It does not merge cleanly.** It
   branched at e744fff; main has 12 commits since (the rest of BUILD-100).
   `git merge-tree` shows conflicts in `shared/reportBuilder.js`,
   `tests/build98-reports.test.js` (both builds added standard reports; the
   count is the sum), `tests/giving-page-builder.test.js`,
   `tests/tenant-matrix.test.js` (reset list, both added tables) and
   `audit/route-inventory.json` (regenerate, don't hand-merge). The lead
   recommended the 102 session merge main into build-102 and re-run the
   battery; Jonathan has NOT yet said go. Jonathan merges 102 himself.
   `dacbef8` on that branch (tdz-scan as a pre-push/CI gate) is independent
   of 102's scope.
2. **CHORE-1 on main** (Jonathan's ordering; its content is not described in
   this session).
3. **Then the split**, on `fix-1` rebased onto that main.

The lead session had a background watcher polling `origin/main` for
"BUILD-102"; it dies with the session. The next lead re-checks by hand:
`git fetch && git log origin/main --oneline | grep -E "BUILD-102|CHORE-1"`.

## 4. The split plan (lead alone, before any workstream)

Rules: change no behaviour. **The full battery passes with ZERO test edits; if
any assertion must change, STOP and tell Jonathan.** `node scripts/tdz-scan.js`
before every commit. A new root module is invisible to `deploy-shape` until
`git add`ed (BUILD-79/84 class). Re-run `scripts/build75-route-inventory.js`
(routes move, paths don't; the inventory should come out byte-identical).

### ⚠ The obstacle to raise with Jonathan BEFORE starting
Measured at 1ba724a: **52 suites read `server.js` as text** (source
assertions: actor-stamp, date-seam, deploy-shape, build97-agent, the money-tool
absence proof, tdz and brand guards, fix1-walk §2/§3, ...), **17 read
`Donors.jsx`** and **9 read `App.jsx`**. Moving code out of those files turns
their source checks red with no behaviour change. So "zero test edits"
is very likely not achievable as literally stated. Options to put to him:
(a) one mechanical, reviewed test change: a `tests/helpers.js`
`readSource("server")` that concatenates `server.js` + `routes/*.js` (and the
same for the Donors/App splits), with every source-reading suite switched to
it in one commit and nothing else changed; or (b) a smaller split that keeps
source-asserted code in place. Per the amendment the lead does not choose. It
stops and asks. Enumerate the exact suites first:
`grep -lE 'server\.js|Donors\.jsx|App\.jsx' tests/*.js scripts/*.js`.

### server.js (38,263 lines, 611 routes, 68 timers) → `routes/<product>.js`
Each module exports `function mount(app, deps)`, like `routes/migc.js` shows;
shared helpers (`query`, `run`, `requireAuth`, `checkWriteAccess`, `recordGift`,
`orgOwns`, `actor`, `publicAppUrl`, the Stripe/Resend clients, ...) stay in
`server.js` or move to `lib/` and are passed in `deps`, never re-implemented.
Route order matters (Express first-match: e.g. `/donors/duplicates` and
`/donors/summaries` before `/donors/:id`; `/sequences/process` before
`/sequences/:id`; `/reports/board*` before `/reports/:key`); **mount order in
server.js reproduces today's declaration order exactly.** Prefix counts below
are today's.

- **`routes/crm.js`**: donors (64), gifts (9), pledges (7), households (5),
  interactions, threads (6), tasks (5), step-reminders, nudges, drift (2),
  pipeline (6), portfolio (5), opportunities (2), proposals (3), plans,
  plan-steps, cultivation-templates (4), briefs (2), major-gifts, moves,
  custom-fields (8), donor-relationships, people, person-photos, photos (3),
  materials, planned-gifts (2), import-merges (2), imports (4),
  import-field-mappings, statement-mappings (4), geocode (2), dashboard (11),
  dashboards (3), reports (5), saved-reports (8), report-builder (2), metrics
  (2), impact (1), impact-metrics (4), goals (2), grants (26), funders (5),
  grant-documents, grant-outlines, programs (6), memberships (6),
  membership-levels (4), events (15), event-levels (2), board (2),
  annual-fund (2), settings (3), me (9), users, org (36), orgs (3),
  onboarding, audiences (4), communications, campaigns (12), fundraising (5),
  deposits (3), acknowledgments (10), thank-yous (5), tribute-notices (3),
  milestone-drafts (4), note-reminders (3), voice-memos (2), digests (3),
  inbound-email, api-keys (3), api (5, the v1 read API).
  *(Large. If it proves unwieldy, split crm into crm-people / crm-money /
  crm-grants / crm-reports within the same commit series; the product names
  in the amendment are the floor, not the ceiling.)*
- **`routes/give.js`**: the public giving surfaces: donate, giving-pages (10),
  peer-fundraisers (3), portal (14), portal-page (5), portal-settings (2),
  portal-assets, portal-engagement, portal-audit, impact-updates (4),
  account (23), network (4), giving-sources (13), giving-recurring (4),
  recurring (18), track, invitation-request, demo-request.
- **`routes/volunteer.js`**: volunteer (2), volunteers (4), volunteer-shifts,
  volunteer-hours.
- **`routes/agent.js`**: agent (11), ai (2), workflows (5), sequences (22).
- **`routes/finance.js`**: finance (16), financials (2).
- **`routes/billing.js`**: billing (8, minus the webhook), auth (8), admin (23),
  health.
- **`routes/webhooks.js`**: `/stripe/webhook` + the rest of stripe (5),
  `/billing/webhook`, resend (1), unsubscribe (2), inbound-email webhook.
  **The raw-body parsers must still be registered before `express.json()`
  for these paths**; check the current order and keep it.
- **`routes/jobs.js`**: the 68 `setTimeout`/`setInterval` registrations +
  the functions only they call (processSequences, processDunning,
  processDigests, processThreadNudges, sweeps, purges, card-expiry, geocode
  queue, photo queue, ...), started from one `startJobs(deps)` call in server.js
  at the same point in boot as today.
- **`routes/email.js`** (or `lib/email.js`): the Resend client proxy (mail
  block, `donorMailDecision`), `brandEmailHeaderHtml`,
  `unsubscribeEmailFooterHtml`, the donor-mail senders. **`tests/mail-block`
  pins that EVERY send passes through the proxy; the proxy must stay the only
  client.**
- **gmail (7)** belongs with crm (it logs interactions); the webhook-less OAuth
  callback stays public.
- **`server.js` after the split**: Sentry init + process handlers, env/boot
  checks, db init, app + middleware + parsers + CORS + rate limiters, the
  shared helpers (or their `require`s), `mount()` calls in today's order,
  the final 404 + error handler, `listen`, `startJobs`.

### App.jsx (803 lines) → one tab registry
Today the tab facts live in nine parallel structures: `TABS` (l.31),
`BOTTOM_TABS` (55), `MORE_TABS` (61), `PRIMARY_NAV` (88), `MORE_NAV` (89),
`TEAM_GATED` (91), `CORE_HIDDEN_TABS` (101), `PORTAL_TIER_TABS` (127),
`CRM_HIDDEN_TABS` (142), plus ~22 `tab===` render branches. Replace with ONE
array, `client/src/lib/tabRegistry.js` (JSX-free so Node can test it) or
inside App.jsx, one entry per tab: `{id, label, icon, component, rail:
"primary"|"more"|"hidden", mobile: "bottom"|"more"|null, teamGated,
coreHidden, portalTier, crmHidden, intents}`. The old arrays become derived
`const`s computed from it (same names, same order, same contents), so every
consumer and every source-reading test sees what it saw. The render switch
becomes a lookup. **Asserted by comparing each derived array to its literal
from before the change, then deleting the literals.**

### Donors.jsx (8,013 lines) → profile, import, directory
Top-level components today (line numbers at 1ba724a):
- **`DonorImport.jsx` (import)**: `CSV_FIELDS`…`IMPORT_REASON_LABELS`
  (l.55–309, the import tables), `DonorImport` (816, exported and reused by
  WelcomePage), `GiftHistoryImport` (3183), `MergeDuplicatesModal` (7385).
- **`DonorProfile.jsx` (profile)**: `FollowUpTaskModal` (3768),
  `LogTouchpointModal` (3822), `EditDonorModal` (4013), `GiftLinkModal`
  (4085), `PhotoAdjuster` (4218), `DonorPhotoControl` (4345),
  `PersonTypeChips` (4418), `DonorProfile` (4476), plus `GIVING_STRENGTH_*`,
  `WEALTH_SCORE_*`, `DONOR_RELATIONSHIP_LABELS`, `DESIGNATION_OPTS`.
- **`DonorDirectory.jsx` (directory)**: `ReEngageView` (6578), `AssignModal`
  (6691), `DirectoryView` (6740), `TeamView` (7217), `TIER_META`,
  `PATTERN_META`, `FilterBar` (7272), `ColDef` (152).
- **`Donors.jsx`** keeps `export function Donors` (7510) and re-exports
  `DonorImport` so `import { DonorImport } from "./Donors"` still works.
  `STAGE_COLORS`, `STAGE_TOKEN_RULES`, `NEGATOR_PHRASES`, `inferStage`,
  `normalizeStage` go to one shared place (`client/src/lib/donorStage.js`)
  both import. **The TDZ rule applies**: every module-scope const moves
  ABOVE its first reader in its new file. Run `scripts/tdz-scan.js --all` on
  the four files after the move.

### Order of work
1. Rebase `fix-1` on the new main; confirm Part 0 is still 22 red for the same
   reasons.
2. Put the source-reading obstacle to Jonathan and get his answer.
3. Split commits, each green on the battery before the next: jobs → email →
   webhooks → billing → finance → volunteer → agent → give → crm (smallest to
   largest, so a failure localises), then App.jsx, then Donors.jsx.
4. Full battery + tenant battery + a browser walk of every tab at 1440 and 390
   (the TDZ class only shows in a browser). Push `fix-1`.
5. Recreate the five worktrees from the split `fix-1`; each workstream merges
   `fix-1` into its own branch and moves its changes into the new files.
   Spawn C, D, E and B; hold A until after the split, then A builds
   Direction 2.

## 5. Databases and ports (all on :5544, none currently exist)

The four `steward_fix1_*` databases were DROPPED when the workstreams were
stopped; recreate with `createdb -h localhost -p 5544 -U steward <name>`. The
shared `steward_loadtest` DB is never used by FIX-1.

| Worktree | Branch | Database | API | Preview | SINK | STRIPE_MOCK | BILLING_MOCK |
|---|---|---|---|---|---|---|---|
| `~/steward-fix1` (lead, split + integration) | `fix-1` | `steward_fix1` | 5701 | 4301 | 5702 | 5703 | 5704 |
| `~/steward-fix1-a` | `fix-1-a` | `steward_fix1_a` | 5711 | 4311 | 5712 | 5713 | 5714 |
| `~/steward-fix1-b` | `fix-1-b` (new) | `steward_fix1_b` | 5721 | 4321 | 5722 | 5723 | 5724 |
| `~/steward-fix1-c` | `fix-1-c` | `steward_fix1_c` | 5731 | 4331 | 5732 | 5733 | 5734 |
| `~/steward-fix1-d` | `fix-1-d` | `steward_fix1_d` | 5741 | 4341 | 5742 | 5743 | 5744 |
| `~/steward-fix1-e` | `fix-1-e` | `steward_fix1_e` | 5751 | 4351 | 5752 | 5753 | 5754 |

Worktree setup: `git -C ~/nonprofit-erp worktree add ~/steward-fix1-x fix-1-x`,
then symlink `node_modules` and `client/node_modules` from `~/nonprofit-erp`
(never commit the symlinks: `.gitignore`'s `node_modules/` has a trailing
slash, so `git add -A` would pick up a symlink). The boot recipe is
`tests/README.md` + `tests/run-all.sh` with these ports substituted. Browser
suites need the preview on the API's CORS allowlist (`CORS_ORIGIN`).

## 6. Loose ends
- Tell the 102 session go/no-go on merging main into build-102 (Jonathan's
  call).
- Confirm the Finance cut and the Members/Funds placement with Jonathan.
- CLAUDE.md gets its FIX-1 entry from the lead at the end; workstreams write
  notes in `docs/fix-1/<X>-NOTES.md`, never CLAUDE.md.
