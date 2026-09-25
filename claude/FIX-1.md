# FIX-1 — The block in the road

(Brief as given by Jonathan, 25 September 2026. The amendment he made the same
day is at the foot and supersedes "HOW THIS RUNS" where they differ.)

**Repo:** `nonprofit-erp` (Steward). A large build that stops the roadmap on purpose. Nothing after BUILD-102 starts until FIX-1 is on main. Branch `fix-1` from main, integrated by one lead session from five parallel workstreams. Merge to main only on Jonathan's word.

**Why.** On 25 September Jonathan walked the product as a customer would and found it deep in places and wrong in the places a customer looks first. FIX-1 makes what exists feel like the product it is, before anything new is added.

**What does not move.** One database, one person record, one gift path (`recordGift`), one ledger. Agents read, draft and propose; a human signs anything that reaches a donor or moves money. Every number on screen has a sentence. The four colours. Every write carries an actor. `scripts/tdz-scan.js` before every commit. Nothing is done until the full battery is green.

## PART 0 — WHAT THE WALK FOUND (each one a test before it is a fix)
1. The agent's plan and its run disagree (Sunrise, $5,000: plan said record + follow-up; run recorded nothing, opened no thread, drafted a note and a task).
2. The run said "read 400 people" for an instruction about one named organisation.
3. The button sat on "Running..." after the run had finished.
4. The profile's Suggested panel invented facts (Angela Wu, "68% participant retention", "three youth advancing to paid apprenticeships") and rendered raw `**markdown**`.
5. A foundation was called a "sponsor".
6. Fundraising carries twelve tabs and scrolls sideways.
7. Donors holds everyone and explains itself in a paragraph ("Everyone is on one list...").
8. Finance shows a payout of `$-1.33`, "Available $0" beside "Cash on hand $400.4k" with nothing saying why, and no way to see which gifts made up a payout.

## A. STEWARD AGENT, ITS OWN PRODUCT
Own sidebar item **Agent**, its own look inside the four colours: ink ground, brass for what the agent is doing, emerald only for the one yes. Five views: **Ask** (large box, three examples in the org's words; Home keeps a one-line entry that opens Agent with the text carried over) · **Plans** (every plan with its run, each step done / waiting for you / not done and why) · **Workflows** (the seven recipes move here) · **Waiting for you** (thank-you drafts, tribute notices, renewal notes, gifts to confirm; one queue, oldest first) · **Guardrails** (pause everything, can/cannot in plain sentences, the 30-day undo list moved from Settings).
Fixes: the plan is compiled from the steps that will actually run; a step the agent may not do alone (recording money) is "Prepared for you to confirm" and the confirm card records the gift through `recordGift` with the human as actor. Reads scoped to what the instruction names. Run state is the server's. Suggestions may only say what the record says (BUILD-99 brief rule, a validator not a prompt; no raw markdown). An organisation is never a "sponsor" (from `donors.kind` and funder type).
Tests: the Sunrise instruction replayed (plan = steps run; gift absent until confirm, present in cents after; thread exists). A suggestion naming someone not on the record is refused. No `**` in Agent. Zero hex outside tokens.

## B. FUNDRAISING, REORGANISED
Four tabs, each a question: **Overview** · **Campaigns & pages** (campaigns, giving pages, forms (102), events, recurring) · **Major gifts** (pipeline, proposals, portfolios, plans as sections; the sidebar Pipeline folds in) · **Money in** (deposits, acknowledgments). No sideways scroll at 1440. Every old tab id still deep-links.
Tests: every old id lands; fits at 1440 and 390; no number moved (in cents).

## C. VOLUNTEERS, ITS OWN HUB
Sidebar **Volunteers**: Roster (hours this year, last shift, also gives?) · Shifts and hours (log, records, Wranglr/VolunteerHub imports) · Sign-up link · Internal notes (never in the donor timeline or Drift) · Volunteers who give. Rebuilt on-palette over `person_types` and `volunteer_shifts`; the old `Volunteers.jsx` is not revived.
Tests: a Volunteer is on the roster and not in Donors unless they give; roster hours equal the record in hundredths; internal notes never in the timeline or Drift.

## D. PEOPLE, WITHOUT THE LECTURE
Donors shows donors; the paragraph is deleted. Role chips under the name (Donor, Volunteer, Staff, Board); adding Volunteer puts them on the roster that moment; Donor is set by giving and cannot be removed while gifts exist (the chip says why). Staff and board listed under Settings → Organization. Search finds anyone and says what they are.
Tests: tagging Volunteer adds to the roster with no second record; removing Donor with gifts refused with the reason; Donors count = donor-role people; the paragraph appears nowhere.

## E. FINANCE THAT EARNS ITS PLACE
Three questions: which gifts made up this payout (charges, refunds, fees, each linked; a non-reconciling payout says by how much) · where does restricted money sit (moved to lead) · what goes to the bookkeeper this month (BUILD-87 export as a monthly close). Removed: the manual Accounts tab and the AI "6-Month Forecast" / "Risk Analysis" buttons. Cash on hand gets its sentence; a $0 Stripe balance is explained. `fmtFull` sign-first everywhere (`-$1.33`), the pinning suite updated as a reviewed contract change.
Tests: a fixture payout of three charges, one refund and fees expands to exactly those rows and reconciles to the cent; a non-reconciling payout names the difference; no screen renders `$-`.

## HOW THIS RUNS (original)
Five workstreams A–E in parallel, each its own agent, worktree (`~/steward-fix1-a` … `-e`), branch off `fix-1`, ports and database (`steward_fix1_a` … on :5544). One lead owns `fix-1`, writes Part 0 red first, reviews each branch and merges in order **D, C, B, A, E**, affected suites after each merge, full battery after the last. Each workstream moves the routes it touches into `routes/` and registers its tabs in one list in `App.jsx`. B waits until BUILD-102 is on main.

## HOW THIS BUILD ENDS
Full battery, tenant battery, landing verifier, prod smoke, CI green, both SHAs, "prod is N behind main". Then the same walk, recorded at 1440 and 390 on a fixture org, screenshots in `docs/fix-1/`.

## FOR JONATHAN
- The Agent's look: two directions as screenshots before A builds past its first part. Pick one.
- Removing the Accounts tab and the two AI buttons in Finance is a cut; say if either should stay.
- Board and staff under Settings → Organization is a guess.

---

## AMENDMENT (25 September, Jonathan) — SPLIT THE MONOLITH BEFORE THE SWARM FANS OUT
1. Now, while BUILD-102 finishes: create fix-1 from main, commit the brief, write Part 0's failing tests and commit them red, and produce two design directions for the Agent as screenshots. Don't touch server.js, App.jsx or Donors.jsx yet.
2. When BUILD-102 is on main: the lead does the split alone, before any workstream starts. Move server.js into `routes/` by product (crm, give, volunteer, agent, finance, billing, webhooks, jobs, email), with server.js left as boot and wiring. Give App.jsx one tab registry. Split Donors.jsx into profile, import and directory files. Change no behaviour. The full battery must pass with ZERO test edits; if any assertion has to change, stop and tell Jonathan.
3. Then create the five workstream worktrees, each with its own port pair and database on :5544, and spawn C, D and E. Hold A until Jonathan picks a design. B can start once 102 is merged.
Also: the workstreams' partial progress from before the amendment is kept, committed and pushed on `fix-1-a/-c/-d/-e`; after the split each workstream picks up from its branch and moves its changes into the new files.
Everything else stands: merge order D, C, B, A, E; affected suites after each merge; full battery and the walk at the end; no merge to main without Jonathan's word.
