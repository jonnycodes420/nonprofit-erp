# FIX-3 D — the donor profile (findings 9, 10 mockups, 11)

## 9 · The lock flash
- **Cause.** `DonorProfile.jsx` held the plan in `useState("core")` until `/portfolio/officers`
  answered, so "not loaded yet" was the same value as "not included". Every `lockMajor` panel
  (Proposals, Plan, Brief, Pipeline, the major-gifts rail) drew the frosted "Unlock with Team"
  preview until the fetch came back. `Donors.jsx`/`DonorDirectory.jsx` defaulted
  `portfolioMeta.tier` to "core" in the same way, and `App.jsx` `planTierOf(null)` returned
  "team" (safe, but it still stood in a tier for an unknown plan).
- **Fix.** The new `client/src/lib/entitlement.js` exports `PLAN_UNKNOWN`, `planKnown` and
  `planLocks`. Only a known plan without Team (core, portal) may lock. The profile's plan starts
  `PLAN_UNKNOWN`. While the plan is unknown, `lockMajor` draws the new shared `PlanPending`
  (shared.jsx), which shows "Loading…", or "Couldn't check your plan" if the fetch failed. The
  directory's Core hint reads `planLocks(portfolioMeta.tier)`. `planTierOf(null)` now returns
  `PLAN_UNKNOWN`, and `isCoreTier` is still `planTier==="core"`, so the rail lock and the
  CORE_HIDDEN redirect are unchanged for known plans.
- **The other locked markers.** I grepped every one. Pipeline.jsx and Reports.jsx lock only from
  the server's own response, which arrives with the data, so they cannot flash. The rail and
  Fundraising locks read `isCoreTier`, which was already false while billing was unknown.
- **Test.** `tests/fix3-d-lock-flash.test.js`. §1 is source-level: the entitlement values, no
  plan state in client/src starts as "core", `planTierOf`, `lockMajor`, and the directory hint.
  §2 is a browser test. A Playwright route holds `/billing/status` and `/portfolio/officers` for
  2.5s (with service workers blocked, because a worker otherwise answers first). The test polls
  the DOM every 40ms at 1440 and 390, asserts that no locked marker appears and that the
  pending state does, then that Move Stage renders. The browser leg SKIPs without Playwright.
- **Proof the guard can fail.** The red run (`audit/fix3-d-lock-flash-red.txt`, commit c660b23)
  saw `locked-feature` and "Unlock with Team" during the delay at both widths. A Core-org control
  leg on every run proves the same poll does see a lock when one is drawn.

## 11 · The Sunrise suggestion
- **Where it came from.** The template is the `nextmove` prompt in `Donors.jsx` `getAI`: "In four
  short plain sentences: the move to make, when to make it, what to say, and what it is for."
  The model echoed those labels back as the subjects of its sentences. The FIX-1 validator
  checked only capitalised names, numbers and capacity phrases. "NYC" (all capitals) and
  lowercase claims like "underserved youth" or "cycle deadline" were never looked at.
- **On the real record.** Sunrise is on the CREO boot seed. db.js gives CREO the mission
  "Transformative arts education for underserved NYC youth", and Sunrise's note says "Next grant
  cycle opens September." The validator grounds on the org's name and mission, and now also on
  the person's own notes. So on CREO, "underserved NYC youth" is the org's own mission and is
  KEPT, and "the cycle deadline approaching" is REFUSED, because no deadline is on the record.
  The brief's test fixture carries neither fact, and there both are refused. **Decision for the
  lead:** if the org's mission should not ground a claim about what a gift is for, drop
  `data.org.mission` from `record.orgName` in `getAI`. That is a one-line change, and the tests
  do not depend on it.
- **Side effect of grounding on notes.** A name in her notes (CREO's note names Angela Wu) now
  grounds. That is correct, because the note is the record. FIX-1's tests pass no notes and still
  refuse the name.
- **Fix.** `shared/suggestionGuard.js` gains `CLAIM_TERMS`. These cover who is served (youth,
  underserved, families…) and dates the world set (deadline, cycle, match, gala…). Each term has
  to be words on the record. An acronym is checked like a name. The new `shared/nextMove.js`
  `composeNextMove(reply, record)` parses the three fields (from JSON, or from labelled prose),
  cuts the label scaffolding, gives a fragment its lead-in ("Reach out now…", "Say that…", "It is
  for…"), guards each sentence and keeps the first supported sentence per field. Refused lines
  are counted in the existing dropped line. The prompt now asks for
  `{"when","say","for"}` JSON, with no labels to echo.
- **Test.** `tests/fix3-d-suggestion.test.js` is pure and runs in CI. A recorded structured reply
  contains both off-record claims plus the scaffolding. Both claims are refused and counted, the
  output is three sentences (Reach out… / Thank them… / It is for…), and no scaffolding survives.
  The walk's prose version and the positive grounding cases are covered too.
- **Proof the guard can fail.** The red run is `audit/fix3-d-suggestion-red.txt` (commit 27cf784).
  Planting the claims check off gave 7 FAILs. Planting the scaffold strip off failed the five
  scaffold assertions.

## 10 · Built: Direction 1 (Jonathan's pick)
- **Layout.** `DonorProfile.jsx` now renders in four parts. 1) The white band: name, stage, flags,
  roles and three figures, each of which opens its rows (Lifetime and Last gift open "Gifts &
  Pledges", Contact opens "Activity"). The band has ONE emerald ("Log a conversation") and a quiet
  **More** menu holding Plan a follow-up, Request Gift, the four Suggest kinds (Team only),
  Impact Summary, Edit and Export gifts (CSV). 2) **What do I do next**: the open items, the
  suggestion, Proposals, the cultivation plan and Brief me. 3) **What has happened**: one filter
  row (Everything · Gifts & Pledges · Funds · Activity). 4) **How we manage them**: eight
  `<details>` groups, closed by default, each with a one-line summary.
- **The Direction 2 borrowing.** At 1100px and wider, the next step is pinned in the band
  (`dp-pinned-next`). The band stays put and only the body scrolls. On a phone the band scrolls
  with the page instead: the takeover (`.dp-root`) is the one scroller.
- **Nothing dropped.** The inventory above is the contract, and `tests/fix3-d-profile.test.js`
  walks it at 1440 and 390. Every element is reached in its place: the band, a section, behind
  More, on a filter, or inside a group once opened. The elements a record only sometimes has
  (flags, drift, matching gift, soft credit, recurring, events, membership, funder panel) are
  checked at source level to sit in their question's part of the page. An organisation's
  funder panel is checked in the browser to sit above "what do I do next".
  **Planted proof:** with the "Export gifts (CSV)" menu item deleted, the suite fails at both
  widths (`audit/fix3-d-profile-planted.txt`, 142 passed / 2 failed).
- **Fixed on the way.** ProposalRow and the plan steps wrap on a person's record instead of
  holding fixed columns, which ended the one-letter-per-line wrap at 390 and the date running
  under the stage chip at 1440. The Proposals screen table (`showDonor`) keeps its grid.
- **Screenshot fixes.** Two emerald buttons became ink outlines ("Won" in the pipeline, "+ Link
  to another donor"): the screen keeps one emerald even with every group open. Em dashes came
  out of four panel sentences that now sit on the default view. A closed group's body is
  `display:none`, so it is off the screen and out of the page text. The group titles replace
  the duplicate "Sequences" and "Custom Fields" eyebrows.
- **Materials** load with the record, because the group summary counts them. Before, they
  loaded only when their tab opened.
- **Captures.** `docs/fix-3/profile/built-{1440,390}.png` (viewport), `-more-open.png`,
  `-groups-open.png`, and `-full.png`.

## 10 · Mockups (stopped for Jonathan)
Everything is in `docs/fix-3/profile/`. The README has the directions, the trade-off and the
recommendation (Direction 1). Captures come from `scripts/fix3-d-profile-capture.js` (the
`today` mode seeds `org_fx3dprof`).

### Inventory: every element on today's profile
Question key: 1 = who is this and where do we stand · 2 = what do I do next · 3 = what has
happened · 4 = how we manage them.

| Element today | Q | Direction 1 place | Direction 2 place |
|---|---|---|---|
| Back button | 1 | Band, "← Donors" | Left pane top |
| Photo / face (drop to upload) | 1 | Band | Left pane |
| Name | 1 | Band | Left pane |
| Stage pill | 1 | Band pill; opens Move stage | Left pane pill; opens Move stage |
| Drift badge + drift reason line | 1 | Band, under the chips | Left pane, under the chips |
| Safety flags (deceased, do not contact, do not solicit, imported sustainer) | 1 | Band, beside the stage | Left pane, beside the stage |
| Email (and phone) | 1 | Band | Left pane |
| Role chips (Donor set by giving, Volunteer, + Staff and board) | 1 | Band | Left pane |
| "$X lifetime · N gifts" line | 1 | Lifetime figure (opens gifts) | Lifetime figure |
| Source-recurring sentence ("Gives $50 monthly through PayPal") | 1 | Band, under the figures | Left pane, under the figures |
| Stat tile Lifetime (with definition) | 1 | Band figure | Left figure |
| Stat tile Last gift (with definition) | 1 | Band figure (opens the gift) | Left figure |
| Stat tile Contact (with definition) | 1 | Band figure "Last contact" (opens conversations) | Left figure |
| Unitemized-total note | 1 | Under the Lifetime figure | Under the figures |
| Household total banner | 1 | Band sub-line; opens the Household group | Left pane sub-line |
| Matching-gift employer flag | 2 | Next card, when present; also in the Household group | Left pane, Next block |
| Log a conversation (primary) | 2 | Band, emerald | Left pane, emerald |
| Plan a follow-up | 2 | More → Reach out | More |
| Request Gift | 2 | More → Reach out | More |
| Impact Summary PDF | 4 | More → This record | More |
| Edit | 4 | More → This record, and the Record group | More, and the drawer's Record group |
| Mobile ⋯ menu | 2 | Replaced by More (same on every width) | Replaced by More |
| Open items (thread / tasks: Done, calendar, set aside) | 2 | Next step card | Left pane, Next block |
| Proposals panel (+ New proposal, Move, Edit) | 2 | Open proposal card | Left pane, Open proposal block; full list in Manage → Plan and pipeline |
| Cultivation plan (steps, skip, stop) | 2/4 | Summary in the proposal card; controls in Manage → Plan and pipeline | Proposal block line; the drawer |
| Before you go / Brief me | 2 | "Brief me" button on the proposal card | "Brief me" on the proposal block |
| Suggested actions (Next move, Outreach, Draft email, Call script) + the suggestion panel | 2 | Suggestion in the Next card; the others in More → Suggest | Suggestion block; the others in More |
| Suggested move (smart-move signal) | 2/4 | Manage → Owner and stage | Drawer → Owner and stage |
| Giving history chart | 3 | What has happened → Giving | Timeline tab, chart |
| Tags | 3 | "Her notes" card | "Her notes" card |
| Notes | 3 | "Her notes" card | "Her notes" card |
| Soft credit panel | 3 | History filter "Soft credit" | Gifts tab |
| Volunteering panel (hours, log a shift, link) | 4 | Manage → Volunteering, membership, events | Drawer, same group |
| Membership panel | 4 | Same group | Same group |
| Household (group, remove, hard/soft/combined, members) | 4 | Manage → Household and relationships | Drawer, same group |
| Planned giving & designations toggles | 4 | Same group | Same group |
| Pipeline: moves & asks (add to pipeline, add ask, won/lost) | 4 | Manage → Plan and pipeline | Drawer, same group |
| Follow-up tasks (+ Add task) | 2/4 | Open tasks in the Next card; the list in Manage → Files and tasks | Next block; drawer |
| Touchpoint timeline (+ Log) | 3 | Conversations column | Timeline tab |
| Delete donor | 4 | Manage → Record (behind its confirm) | Drawer → Record |
| Tab: Gifts & Pledges (gift table, tax year, CSV, inline edit, recurring health, New gift with soft credit/tribute/match, pledges, planned giving) | 3 | History filters Gifts / Pledges; CSV in More | Gifts and Pledges tabs |
| Tab: Funds (what they support, restricted vs unrestricted, suggested asks) | 3 | History filter Funds | Funds tab |
| Tab: Related (household giving, linked donors) | 4 | Manage → Household and relationships | Related tab and the drawer |
| Tab: Materials (upload, view, delete) | 4 | Manage → Files and tasks | Files tab |
| Tab: Activity (stewardship log, activity list) | 3 | "Everything" filter; Log stewardship in the group | Timeline tab |
| Rail: Recurring donor | 1 | Band sub-line (source-recurring sentence) | Left pane |
| Rail: Relationship owner (Reassign, Team) | 4 | Manage → Owner and stage | Drawer |
| Rail: Sequences (enrolled, enroll, Team) | 4 | Manage → Sequences | Drawer |
| Rail: Custom fields (edit) | 4 | Manage → Custom fields | Drawer |
| Rail: Events | 4 | Manage → Volunteering, membership, events | Drawer |
| Rail: Move stage (Team) | 4 | Manage → Owner and stage, and the stage pill | Drawer and the pill |
| Rail: Wealth score (hidden until defined) | 4 | Manage → Owner and stage, still hidden until defined | Same |
| Funder panel (organisations: type, EIN, grants, documents) | 1/4 | Under the band for an organisation | Left pane for an organisation |
| Photo adjust / remove | 4 | On the face | On the face |

## Test changes for the build (navigation, wait and census only)
- `tests/build98-volunteers.test.js`: opens the "Volunteering, membership and events" group
  before reading `volunteer-total`. Navigation only; no assertion text changed.
- `tests/build101-renewals.test.js`: opens the same group before waiting for
  `membership-panel`. Navigation and wait only.
- `tests/fix3-d-lock-flash.test.js` (mine): waits for Move Stage to be attached, not visible,
  because it is in a closed group.
- `tests/build97-numbers.test.js` census: `Donors.jsx` 117 → 116 and the total 413 → 412, plus
  the same row in `audit/BUILD-97-NUMBER-CENSUS.md`. The header's "$X lifetime · N gifts" line
  repeated the Lifetime figure beside it, so it went, and the gift count moved under that
  figure.
- No existing assertion text changed.

## Suites run
The battery on my stack covered every CORE suite that reads a file I touched (34 suites):
`Suites: 34 passed, 0 failed`. For the counts and the SKIP result, see the final report.

## Not in CORE, checked by hand
- `uploader`: 69 passed and 1 failed, and the same failure is in files I never touched
  (`type="file"` inputs in DepositSheet, GrantImport, Settings, VolunteerPanel…). The suite is
  not in CORE.
- `fix1-walk`: 80 passed, 0 failed.

## For the lead at merge
- CORE lines to append: `fix3-d-lock-flash` and `fix3-d-suggestion`.
- Browser suites rewrite the `docs/fix-2/E/*.png` screenshots when they run. I restored them
  before each commit.
