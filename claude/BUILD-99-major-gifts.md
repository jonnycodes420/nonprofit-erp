# BUILD-99 (major gifts) — the brief, as issued

**NB the BUILD-99 label was already used** by a one-off fix (`tests/build99-grant-timeline.test.js`,
"a touchpoint you cannot read is not a record"), exactly as the BUILD-98 label
had been used twice. This build is therefore referred to as **BUILD-99 (major
gifts)** in CLAUDE.md and in its commit messages; its files carry
`build99-` prefixes that do not collide with that suite's.

The brief below is the one issued on 2026-09-25, committed verbatim — BUILD-96's
was never committed and is lost, which is the reason for this file.

---

# BUILD-99 — Major gifts

**Repo:** `nonprofit-erp` (Steward). Runs after BUILD-98 Part 1 (soft credits) is on main. Own worktree, own database and port, branch `build-99`, CI-gated pushes.

**What this build is.** Moves management on top of the stages Steward already has, for the organisation with a development officer and a portfolio. Bloomerang's Major Gifts page in Steward's terms: proposals, portfolios, plans, and a prospect brief the agent writes on request. Nothing here decides a donor's capacity; a model never infers a number about a person.

**Standing rules.** Every write carries an actor. Every number on screen has a sentence. Agents draft and propose; a human commits. Thirty minutes a part, commit green, move on with a note. Affected suites per commit; full battery once at the end, untouched. Tenant battery before Parts 1, 2 and 4.

---

## 1. Proposals

A proposal is one ask to one person or household: purpose, ask amount, expected close date, stage (Identified, Cultivating, Asked, Committed, Declined, Stewarding), probability she sets by hand from a fixed list (10, 25, 50, 75, 90), fund it lands in, the officer who owns it, notes. One person can have several proposals over time; one open at a time per fund. Committed writes a pledge (98 Part 1's pledge path) or a gift, never both. Declined records a reason from a fixed list and the date, and never reopens silently.

Proposals live on the person's profile above giving history, and on a Proposals screen under Fundraising: pipeline by stage in dollars and count, filter by officer and fund, sort by expected date. Weighted total is shown only with its sentence: "$142,000 weighted, from 9 proposals at the probabilities you set."

**One test.** Proposal to Committed writes exactly one pledge in cents; Declined stores reason and date; two open proposals on one fund for one person is refused; org A cannot read org B's proposals.

## 2. Portfolios

An officer has a portfolio: the people assigned to them, with a target for the year and a count cap she chooses. Assignment is on the person (relationship owner already exists; this is the same field, surfaced). The Portfolio screen per officer: her people ranked by open proposal amount then by days since last contact, with the last logged conversation on each row and the next step from the Thread. Unassigned major prospects (lifetime over a threshold the org sets, no owner) show as a list to assign from.

**One test.** Assigning writes owner with actor; the portfolio row count matches the assignments; a person with no contact in 90 days sorts above one contacted yesterday at equal proposal size.

## 3. Cultivation plans

A plan is a sequence of Threads for one person, authored by the officer: visit, invite to the barn, send the annual report, ask. Each step is a Thread with a due date; completing one opens the next (BUILD-81's engine, chained). Plans are templates the org keeps ("First-time $1,000 donor," "Board prospect") and applies to a person with one click, dates offset from today. Nothing in a plan sends anything; every step is a human action with a logged line.

**One test.** Applying a four-step template creates one open Thread and three pending; closing the first opens the second with the right due date; skipping is recorded as skipped.

## 4. The prospect brief

On any person, "Brief me": the agent (97 Part 3) writes a one-page brief from the org's own rows: giving history in the org's vocabulary, relationships and soft credits, open proposal, the last five conversations quoted, the plan's next step, and what the officer wrote in notes. Every sentence cites a row. No capacity, no wealth, no inference about the person beyond what the file says; the schema cannot express a number the rows don't contain. Printable as a PDF for the car. Logged as an agent run with the rows it read.

**One test.** A brief for a fixture person cites only rows that exist, contains no numeric threshold not in the constants module, and the PDF renders with the org's letterhead.

## 5. The major-gifts dashboard

Under Fundraising: pipeline by stage in dollars, proposals due this quarter, officer activity (conversations logged this month per officer), asks made vs committed this year, and the Thread backlog per officer. Every tile has its sentence on hover. No goal is invented; the target is the one she typed in Part 2.

**One test.** Each figure reconciles to a hand count on the fixture org; tiles render on an org with zero proposals with an honest empty state.

## 6. Import and export

The mapper gains Proposal and Portfolio Owner column targets for the Bloomerang, DonorPerfect and NPSP presets (NPSP: Opportunity stage Prospecting/Qualification map to Identified/Cultivating; Closed Won is a gift, never a proposal). Proposals export from the report builder (98 Part 3) with all fields.

**One test.** An NPSP fixture with four open Opportunities imports as four proposals in the right stages and zero gifts.

---

## HOW THIS BUILD ENDS

Full battery, tenant battery, landing verifier, prod smoke, CI green, both SHAs, "prod is N behind main." On the demo org: one proposal walked from Identified to Committed with a pledge, one portfolio with three people, one plan applied, one brief generated (if the key is set) and the dashboard reconciled. Report each part with commit and minutes.

## FOR JONATHAN

- The lifetime threshold for "major prospect" is an org setting; the demo org default is $1,000. Say if you want a different default.
- Wealth screening (109) will fill capacity later; nothing here pretends to.
