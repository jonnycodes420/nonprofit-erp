# FIX-2 — Every number opens

**Repo:** `nonprofit-erp` (Steward). Runs right after FIX-1 lands on main. Branch `fix-2` from main. One tab, one lead; the lead may run its own subagents, each with its own worktree, ports and database, and merges their work itself. **When the full battery is green and CI is green on the PR, the lead merges to main, confirms the deploy, walks prod and reports** (Jonathan's instruction, 27 September).

**Why this build exists.** On 27 September Jonathan walked FIX-1 on localhost. The structure is right, but the product still looks unfinished where a board member or ED looks first: the dashboards are thin tiles with no way to see where a number comes from, Reports has two navigations and a tab row that runs off the screen, the app is too green, and the Agent room dead-ends with "drafting is not enabled" and no way to turn it on.

**What does not move.** One database, one person record, one gift path (`recordGift`), one ledger. Agents read, draft and propose; a human signs anything that reaches a donor or moves money. The four colours. Every write carries an actor. `scripts/tdz-scan.js` before every commit. Nothing is done until the full battery is green.

---

## THE NEW RULE, FOREVER: EVERY NUMBER OPENS

Every number Steward shows (a tile, a count in a sentence, a total, a percentage, a badge) is clickable, and clicking it opens the rows that make it: the people, gifts or records behind it, the sentence that defines it, and a total that foots to the number on screen to the cent. A number that cannot open does not ship.

- One shared component (`<Figure>` or the existing figure/Def pattern, extended) takes a value, its definition sentence and a `source` (the route and filter that returns its rows). The drill-through panel is one component used everywhere.
- The server has one endpoint shape for "rows behind a figure", tenant-scoped, read-only, paginated, with the same filter the figure used, so the rows and the number cannot disagree.
- A percentage opens both its numerator and denominator rows. A "—" or "not enough history yet" opens a sentence saying exactly what is missing and when it will appear.
- **Guard:** extend the BUILD-97 number census so every figure on an in-scope screen must carry a `source`; a figure without one fails the battery by file and line. Prove it can fail by planting one.
- **Guard:** for every figure with a `source`, a suite fetches the rows and checks they foot to the figure on a fixture org.
- Add the rule to CLAUDE.md's never-crossed rules and to `docs/decisions/home-and-reports.md`.

## PART 0 — WHAT THE 27 SEPTEMBER WALK FOUND (each a failing test first)

1. **Dashboards: no number opens.** Giving this year, same point last year, change on last year, people who gave, retention, monthly gifts, stopped and recovered this quarter, giving by designation: none can be clicked.
2. **Dashboards look thin.** Six small tiles, a half-empty second row and one designation line on a large empty page. "Monthly gifts giving" is not English. "Retention —" says why, but not when it will appear. The as-of date is ISO.
3. **Reports has two navigations.** A tab row (Your reports, Giving Summary, Gifts by Fund, LYBUNT, SYBUNT, Retention, Top Donors, Week in Review, 3-Year Comparison, Annual Report, Solicit…) and a left list (LYBUNT, SYBUNT, First-time donors...) that repeat each other, and the tab row runs off the screen at 1440.
4. **Report results look like a spreadsheet dump.** ISO dates (2024-11-15), cents on whole-dollar amounts ($24,500.00), no totals row, rows that don't open the donor.
5. **Too much green.** The sidebar, top bar, Agent room and active states are all dark green, and the green reads as the whole app. Cream and white are the ground.
6. **The Agent room is not Direction 2.** Jonathan picked the run sheet: a cream sheet laid on ink, instructions down the left, the open plan as a checklist on the sheet. What shipped is a dark green room with a small cream empty card.
7. **The Agent dead-ends.** "build a report for my donors that gave last year but not this year" returns "Planning anything else needs drafting, which is not enabled for this organization yet." It gives no way to turn drafting on, no link to where it lives, and nothing about who is allowed to.
8. **The Agent refuses a read.** Building or opening a report touches no donor and moves no money, so it needs no drafting permission. That instruction should open LYBUNT (or save a report with that filter) and say so.

Carried from FIX-1's look at Home and its handoff §5:

9. **"last grant" on churches and businesses.** Hope Presbyterian Church, Ironworks Coffee Roasters and Rivet Bakery show "last grant". Only foundations and DAFs give grants; everyone else is "last gift" (from `donors.kind` and funder type).
10. **ISO dates anywhere on screen.** One date formatter for display ("Jan 14, 2026"; "Sep 27" within the year where the design already does that). Guard: no rendered text in the client matches `\d{4}-\d{2}-\d{2}` outside inputs, exports and CSV.
11. **"day 0"** and **the red Lapsed pill** on the donor profile (FIX-1 handoff §5).

---

## A. DASHBOARDS THAT A BOARD CAN READ

Each dashboard (Board, Fundraising, People, Recurring) answers its question in a sentence at the top, then shows its figures, each of which opens.

- Board: giving this year against the same point last year as a simple month-by-month line (this year vs last), with the sentence "We are $800 ahead of this time last year." Retention with its cohort and a plain sentence when there isn't enough history ("Retention appears after your first full year in Steward, on Jan 1, 2027").
- Figures sized and laid out so the page is full at 1440 and stacks cleanly at 390; no half-empty rows.
- Giving by designation shows restricted and unrestricted with their funds, each opening its gifts.
- Labels in plain English ("Monthly givers", not "Monthly gifts giving").
- Export PDF keeps working and prints the sentences.

**Tests.** Every figure on all four dashboards carries a source and its rows foot; the Board sentence's dollar difference equals the two tiles' difference in cents; no ISO date renders; layout fits at 1440 and 390 with no horizontal scroll.

## B. REPORTS, ONE WAY IN

- One navigation. A left rail grouped by question ("Who stopped giving?", "Who gives the most?", "How did the year go?", "Volunteers and members", "Your saved reports"), with Build a report at the top. The horizontal tab row is removed; every old report id still deep-links.
- Results: human dates, whole dollars unless cents exist, a totals row that foots, every row opens the person, sortable columns, CSV and PDF unchanged in content.
- The Start here card stays and opens LYBUNT.

**Tests.** Every old report id and tab id lands on its report; no row of tabs on Reports; totals equal the sum of rows in cents; a row click opens the right person.

## C. LESS GREEN, MORE CREAM

- The ground of every page is cream or white. Ink is for the sidebar and top bar only. Emerald is only for the one primary action on a screen. Brass is for what the agent is doing and for Start here.
- The Agent room is rebuilt to the Direction 2 mockup in `docs/fix-1/agent-directions/direction-2*.png`: the cream sheet takes the room, ink is only the margin around it, instructions list down the left with each run's state, and the open plan is a checklist on the sheet with its confirm at the foot.
- Active sidebar items and tab states use a lighter treatment than a solid green block.

**Tests.** No page root outside the sidebar and top bar uses the ink or dark-green background token; the Agent room matches the Direction 2 layout (sheet width ≥ 70% at 1440, instruction list present); zero hex literals outside tokens.

## D. THE AGENT YOU CAN TURN ON

- When drafting is off, the Agent says what it can do now, what drafting would add, and shows **Turn on drafting** to the person allowed to (owner or admin), linking to the exact setting in Guardrails. Anyone else sees who can turn it on.
- Read-only instructions work without drafting: open or build a report, find people, count, explain a number. "Donors who gave last year but not this year" opens LYBUNT and offers to save it.
- Locally, if the AI key is missing, the room says so in one line instead of pretending drafting is off.

**Tests.** With drafting off, the LYBUNT instruction opens LYBUNT and writes nothing; a non-admin sees who can enable drafting and no toggle; with the key missing the message names the key, not the permission.

## E. CARRY-OVERS

Findings 9 to 11 above. Plus: the volunteer sign-up link is revocable (if not already done in FIX-1), and the one-line lint config fix so JSX use counts (the 552/562 warnings).

## F. THE CODEQL FOUR (Jonathan, 27 September)

The four CodeQL warnings FIX-1's handoff §8 left open. Fix the real ones in code. For the webhooks rate-limit warning, don't add a limiter that could drop Stripe's retries: either make the existing server-wide limiter visible to CodeQL (apply it at the router level) with a webhook-safe ceiling, or, if it's a false positive, dismiss it in CodeQL with a one-line written reason.

---

## HOW THIS BUILD ENDS

Full battery green, tenant battery, tdz-scan, the new figure-source guard proven able to fail, CI green on the PR into main. Then the lead merges to main (fast-forward or a merge commit if main moved), confirms CI on main and both deploys, checks the live build sha, and walks **prod** on the Harborlight demo at 1440 and 390: every dashboard figure opened once, one report opened from the rail, the LYBUNT instruction in the Agent with drafting off, a gift confirmed in the Agent on a fixture org. Screenshots in `docs/fix-2/walk/`. Update the handoff, report, stop.

If any assertion text has to change for something this brief does not call for, stop and ask.
