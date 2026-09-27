# FIX-2 — lead handoff (27 September 2026, merged to main, live)

The FIX-2 lead's state of play. The brief is `claude/FIX-2.md`: Jonathan's
"Every number opens" brief plus **Part F, the CodeQL four**, which he added the
same day. Each workstream's own notes are in `docs/fix-2/<X>-NOTES.md`, with
their screenshots in `docs/fix-2/<X>/`. The prod walk is in `docs/fix-2/walk/`.

## 1. What shipped (first-parent on `fix-2`, PR #17)

| Commit | What |
|---|---|
| `4c44223` | the brief (+ Part F) |
| `88aeb45` | `shared/displayDate.js`, the one display-date formatter (finding 10's shared piece); `shortCivilDate` reads through it |
| `58c61bc` | **F**: the CodeQL four (see §4) + `tests/fix2-codeql.test.js` |
| `a841f70` | merge **D**: the Agent room, drafting you can turn on, reads without drafting |
| `8ef5e61` | merge **E**: one date on every screen, the profile's "day 0" and red, JSX use counts in lint |
| `0f0a3ac` | merge **B**: Reports, one way in |
| `30b95ef` | Finance's "Gifts by fund →" opens Gifts by fund (found by B) |
| `32ea149` | merge **A**: every number opens, and dashboards a board can read |
| `13c741d` | merge **C**: less green, more cream |
| `5d54fb1` | C's exception lists emptied; A, B and D meet the cream rules (Agent ink is its own `data-agent-margin`) |
| `51e8a3f` | the two ratchets the merged battery caught (script-guards classification, test-clock-seam) |
| `a575f54` | Board line: last year's point no longer hides under this year's (found by the walk) |
| `24fd3f9` | a report's words wrap so six columns fit the card at 1440 (found by the walk) |
| `de437da` | workstream screenshots re-captured on the merged build |

What each part does now:
- **The rule, every number opens.**
  - `<Figure>` (`client/src/components/Figure.jsx`) takes a value, a kind, a definition and a `source`. Clicking it, or pressing Enter or Space, opens the one drill-through panel (`MetricBreakdownPanel.jsx`): the figure, its sentence, the rows 50 to a page, and a total that equals the figure. A percentage opens its numerator rows and its denominator rows. A blank opens a sentence saying what is missing and when it will appear.
  - `figureSources.js` holds each figure's single definition. The value is the aggregate over the same SELECT the panel pages through. It is served by `GET /figures/:source/rows`: tenant-scoped, read-only, paginated.
  - **Guards:**
    - `build97-numbers` §6: a figure on an in-scope screen without a `source` fails, naming the file and line. The in-scope list is `FIGURE_SOURCE_SCOPE`, which is Dashboards today.
    - `fix2-a-footing` foots all 79 dashboard figures in cents.
    - Both guards were planted red first.
  - The rule is written into CLAUDE.md and `docs/decisions/home-and-reports.md`.
- **A — the dashboards.**
  - Each dashboard opens with its answer sentence. Board reads "We are $X ahead / behind this time last year"; `$X` is the two tiles' difference in cents, and it opens like every other number.
  - Board draws a month-by-month line through the fiscal year, this year against last, and every point opens.
  - Retention shows its cohort ("576 of the 681…"), or says the day it will appear.
  - Designation is split into Restricted and Unrestricted, with their funds under each.
  - Labels read "Monthly givers", dates are human, and the PDF prints the sentences.
  - **Behaviour changes** (A-NOTES §6):
    - the org's own fiscal start month (it was always July);
    - "pledged, not yet paid" capped per pledge;
    - "pledged and paid" counts payments against any pledge;
    - monthly giving is rounded per commitment;
    - designations are grouped by fund id.
- **B — Reports.**
  - The tab row is gone. One rail is grouped by the brief's five questions, with Build a report at the top; below 760px it becomes a picker.
  - All 38 old tab and report ids deep-link through `resolveReportId`.
  - One results table: human dates, whole dollars unless there are cents, a totals row that foots in cents, sortable columns, and a person row that opens the profile.
  - The 74 CSV/PDF exports are byte-identical before and after (`scripts/fix2-b-capture-exports.js`).
- **C — colour.**
  - Zero hex literals outside the token definitions (`fix2-c-hex`).
  - One active treatment, `activeMark(on, edge)`: cream's shade, ink, weight 700, and a 3px emerald inset rule.
  - Page grounds are cream or white, and emerald is kept for the one primary action (`fix2-c-cream`, a browser leg over every rail screen at 1440 and 390).
  - Lapsed and overdue are brass.
- **D — the Agent.**
  - The room is the Direction 2 run sheet.
  - `GET /agent/status` gives the one drafting state (key → org switch → pause). **Turn on drafting** lands on the switch in Guardrails, which writes through `PATCH /org/ai-settings` and is now audited. Anyone else is told who can turn it on.
  - Read instructions work without drafting (`agentShape.readIntent`): "gave last year but not this year" answers with LYBUNT's count, opens it and writes nothing.
  - A missing `ANTHROPIC_API_KEY` is named in one line.
- **E — the carry-overs.**
  - **Finding 9:** "last grant" is pinned to foundations and DAFs (`fix2-e-grant-word`). The three names Jonathan saw come from the BUILD-89 demo file and already read "last gift" on this build.
  - **Finding 10:** a browser guard, `fix2-e-no-iso`, finds no ISO date on any rail screen, tab, report or profile.
  - **Finding 11:** "opened today", never "day 0"; the Lapsed pill and stale contact are brass.
  - **Lint:** JSX use counts as use (562 → 105 warnings).
  - **Volunteer link:** already revocable (FIX-1), re-verified.

## 2. Evidence

- **Local full battery on `de437da`** (fresh database, demo seeded by run-all): **255 passed, 0 failed**.
  - This is the 246 baseline suites plus 9 new FIX-2 suites.
  - Per-suite PASS counts against the pre-merge baseline: no suite lower. Three are higher (brand-glyph 98, build97-numbers 72, script-guards 488).
  - The SKIP grep finds only assertion names.
  - tenant-matrix 43/0 and tenant-isolation 32/0 are inside the battery.
  - TDZ: 0 self-references. Lint: 0 errors.
  - The route inventory has 638 routes (+ `/agent/status` and `/figures/:source/rows`).
- **CI on PR #17: test 255/0** (browser legs skip there by design), plus CodeQL and analyze.
- **Merged** by the lead (Jonathan's standing instruction): **`7c18bac`**.
- **CI on main** (run 36340010057): test ✓, deploy-railway ✓, deploy-vercel ✓.
- **Live:** backend `/health` buildSha `7c18bac…` and frontend `<meta name="build-sha">` `7c18bac…`.
- **Prod smoke** (`npm run status`): ok. **Landing verifier:** 80 passed, 0 failed.

## 3. The prod walk (Harborlight, 1440 and 390)

The script is `walk2.js` in the lead's scratchpad; its captures and `walk.json` are in `docs/fix-2/walk/`.

- **Every dashboard figure opened once.**
  - 57 figure sources answered `GET /figures/:source/rows`, and each footed to its figure in cents.
  - In the browser, at both widths: Board 29/29, Fundraising 11/11, People 33/33 and Recurring 8/8 figures opened a panel.
  - No sideways scroll, and no NaN, ISO or undefined on any dashboard.
- **One report from the rail:** SYBUNT, at both widths. There is no tab row and no sideways scroll.
- **The LYBUNT instruction in the Agent** answered with LYBUNT's count ("446 people…"), said "Steward read this and wrote nothing", and **Open LYBUNT** landed on LYBUNT.
  - **Honest caveat:** on prod the key is set and Harborlight's switch is on, so this ran with drafting ON. The read path is identical whether drafting is on or off.
  - The drafting-off case is proven by `fix2-d-agent`, locally and in CI. I did not flip the demo org's switch, because only `seed-demo.js` writes the demo org.
- **A gift confirmed in the Agent on a fixture org.**
  - I registered a fresh prod org, "FIX-2 walk fixture <stamp>". Its user is `fix2-walk-<stamp>@example.org`, and register sends no email and creates the org with email off.
  - I added one donor (Maria Chen), and "Just got a cheque from Maria Chen, 75 dollars" gave the plan. **Record $75 and run** recorded exactly one $75 gift, created by her user.
  - That org stays on prod as a fixture. Delete it from the super-admin console if it's unwanted.
- **What the walk found.** The first local run found two defects that no suite saw, both fixed before the merge:
  - last year's chart points hidden under this year's (`a575f54`, now guarded in `fix2-a-dashboards` §4);
  - a report's last column clipped behind an undrawn scrollbar (`24fd3f9`).
- **Also on prod.** While a dashboard loads, the previous one's heading stays up (see §6).

## 4. The CodeQL four (Part F)

| Alert | Rule | Resolution |
|---|---|---|
| #76 | html-attribute-sanitization, `routes/email.js` | **Fixed.** The email header's escaper now escapes `"` and `'`, and the logo URL goes through it. |
| #18 | multi-character-sanitization, `server.js` | **Fixed.** The campaign sender's unused `textBody` (a one-pass tag strip) is deleted. |
| #77 | missing-rate-limiting, `routes/webhooks.js` | **Fixed on the route.** `/resend/webhook` takes `resendWebhookLimiter`: 3000 per IP per minute, the shared 429 handler, off in TEST_MODE. `generalLimiter` no longer counts it against the browser budget; before, 1000 per 15 minutes was shared with browser traffic. The Stripe and billing webhooks are untouched and stay unlimited, so no limiter can drop a Stripe retry. |
| #75 | insufficient-password-hash, `hashApiKey` | **Dismissed as a false positive**, with the reason written in CodeQL: it hashes a 192-bit random API key, not a password; SHA-256 is the right lookup hash. |

- All four are closed on main (fixed at 18:18Z, or dismissed).
- FIX-2's own tests raised two new warnings, #78 and #79, both at `tests/fix2-c-cream.test.js:165`: a regex built from a colour string escaped only its parentheses. They're fixed in this handoff's commit, with every metacharacter escaped; the suite runs 194/0.
- `tests/fix2-codeql.test.js` proves the three code fixes, and was planted red.

## 5. Assertion changes, and why each was allowed

- `build97-numbers` EXPECTED: total 408 → 413, claims 123 → 121, per-file counts for Dashboards, MetricBreakdownPanel, Figure and Reports. Part A and Part B change what those screens draw, and the census is exact by design.
- `clickability` ×2: the Fundraising goal card and Home's GoalStat were pinned as `interactive(…, {dark: true})`. They are white now (Part C, "the ground of every page is cream or white").
- `palette-census`: `HEX_CEILING` 1149 → 273 (the token definitions; Part C, "zero hex literals outside tokens"). `RGB_CEILING` 232 → 169 (the ratchet only falls).
- Fixture and list data, no assertion text:
  - `script-guards` classifies `fix2-b-capture-exports` as SELF_REFUSING;
  - `tenant-matrix` exempts `/figures/:source/rows` (its parameter is a name, not a row id);
  - `fix2-d-agent` takes its year from `civilToday`.
- `fix2-a-dashboards` (a FIX-2 suite): its rail check also accepts `activeMark(on, "left")`, the shared form of the rule it pinned inline.

No assertion outside what the brief calls for was changed; there was no stop-and-ask.

## 6. For a later FIX (found, not fixed)

- Dashboards: while the next dashboard loads, the previous one's heading and sentence stay on screen.
- Home still says "Not enabled for this organization yet" when the server has no key. `build97-agent` pins that text; the honest sentence is ready as `agentShape.KEY_MISSING_SENTENCE`.
- A plan's list item reads "Done · 2 of 2 steps" while the sheet lists three steps. The read step isn't counted.
- `FIGURE_SOURCE_SCOPE` covers the dashboards only. Home, Reports totals and Finance still draw numbers outside `<Figure>`, and each screen joins the list as it adopts the component.
- On the rail and in the More drawer, the Tasks count badge is still terracotta.
- The Contact tile says "0d ago" for someone contacted today.
- A long email in a report wraps mid-word at 1440 ("example.de / mo").
- C deliberately left some green in place (C-NOTES "Deliberately left"):
  - the Thread row's emerald hairline, which palette-census pins;
  - inline emerald text links;
  - light green notice tints;
  - the ink bulk-selection toolbar, toasts and first-run welcome;
  - the pipeline stage ramp.
- Two ordering flakes, each from a query with no tie-breaker (C and B notes): `build88c-composer`'s first recipient, and the Acknowledgment backlog's order on equal dates.
- From FIX-1's handoff §5, still open:
  - Home's failed-card clause counts a subscription with no `first_failed_at`;
  - `fmt()` renders "$175.5";
  - `uploader` is 69/1;
  - a restarted server on a used database fails schema init.

## 7. Databases, ports, scripts

- **Lead:** `~/steward-fix2` · `steward_fix2` · 5801/4401 (sink 5802, mocks 5803/5804).
- **Workstreams:** the worktrees `~/steward-fix2-{a..e}`, their branches and databases are removed (all merged).
- **Scripts** (session scratchpad, not committed):
  - `stack.sh <wt> <api> <preview> <db> [fresh] [nodist]`
  - `battery.sh <wt> <api> <preview> <db>`
  - `inv.sh <wt>`: the route inventory on a fresh database with the server env.
  - `walk2.js`: the end walk. `FIXTURE=1` adds the fixture gift, `ONLY_FIXTURE=1` runs only that. A fresh org needs `POST /onboarding/complete` before its Agent shows.
- **Merge-time lesson:** C shipped its guards with per-file exception lists for A, B and D's files. Emptying them at merge is what surfaced the Agent's ink page root and two untreated active states. The ratchets (test-clock-seam, script-guards) went red only on the merged tree.

## 8. Still Jonathan's

- A spend cap on the Anthropic workspace (NEEDS-JONATHAN §3, unchanged).
- Whether to keep or delete the prod fixture org "FIX-2 walk fixture <stamp>".
