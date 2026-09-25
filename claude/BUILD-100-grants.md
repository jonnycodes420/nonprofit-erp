# BUILD-100 (grants) — the brief, as issued

**NB the BUILD-100 label was already used** by a one-off fix
(`tests/build100-score-names.test.js`, "a number beside a person's name makes a
claim"), exactly as BUILD-98's and BUILD-99's were. This build is therefore
**BUILD-100 (grants)** in CLAUDE.md and in its commit messages; its files carry
`build100-` prefixes that do not collide with that suite's.

Committed verbatim, because BUILD-96's brief never was and is lost.

---

# BUILD-100 — Grants

**Repo:** `nonprofit-erp` (Steward). Runs after BUILD-98 Part 3 (report builder) and BUILD-80's institutional list. Own worktree, own database and port, branch `build-100`, CI-gated pushes. Independent of 99; can run beside it.

**What this build is.** Grant management the way a two-person development shop actually does it: funders, cycles, deadlines that come and find you, documents in one place, and restricted money that shows where it sits. Bloomerang's Grant Management page in Steward's terms. Nothing here writes a proposal for anyone; the agent drafts a deadline reminder or a report outline on instruction, and a human sends it.

**Standing rules.** Every write carries an actor. Every number on screen has a sentence. Restricted revenue posts to the ledger under the BUILD-83 rule. Thirty minutes a part, commit green, move on with a note. Affected suites per commit; full battery once at the end. Tenant battery before Parts 1, 2 and 4.

---

## 1. Funders and grants

A funder is an organisation (BUILD-80 kind: organisation) with program officers as related people and a funder type from a fixed list (private foundation, community foundation, corporate, government, church, DAF sponsor). A grant is one request to one funder: program, amount requested, amount awarded, restriction (unrestricted, program-restricted, capital, time-restricted with dates), fund it lands in, status (Researching, LOI, Submitted, Awarded, Declined, Closed), cycle name, and the officer who owns it. Awarded writes the award as a pledge from the funder with the funder's payment schedule; payments auto-apply (88b's pledge path). Declined stores a reason and whether to reapply, with the date.

Grants live on the funder's record and on a Grants screen under Fundraising: pipeline by status in dollars, filter by program, officer, cycle, sort by next deadline. The Sunrise Foundation on the demo org is the fixture funder.

**One test.** Awarded writes exactly one pledge in cents on the funder; a payment applies to it; org A cannot read org B's grants; a person can never be a funder.

## 2. Deadlines that come and find you

Every grant carries dated milestones from a fixed list: LOI due, proposal due, decision expected, report due (repeatable), renewal window opens. Each milestone is a Thread on the officer with a lead time the org sets per milestone type (report due, 21 days; proposal due, 30). The morning digest lists them with the other Threads. A grants calendar shows the next 12 months by month; Home shows "2 grant deadlines in the next 14 days" as a line, only when non-zero. Missing a milestone does not close it; it shows overdue with the day count, the BUILD-81 way.

**One test.** A report-due milestone 21 days out opens a Thread today; the digest names it; moving the date moves the Thread; a closed grant opens nothing.

## 3. Documents

Each grant holds its files: the LOI, the proposal, the award letter, the agreement, each report submitted, correspondence. Upload through the BUILD-94 asset pipeline (private, signed, expiring), typed from a fixed list, versioned by date. A funder record shows every document across its grants. Nothing is parsed or read by a model in this build.

**One test.** Two versions of a proposal store as two files with dates; org A cannot fetch org B's document by path; the retention guard covers grant documents.

## 4. Restricted money

An awarded grant with a restriction posts to the ledger as restricted revenue against its fund (BUILD-83 posting rule, live gifts only, import history never posts). Finance shows a restricted balance by grant: awarded, received, spent against it (spend is entered by hand or from QuickBooks 91f when that lands), remaining, and the release date for time-restricted money. A grant's report-due milestone shows the balance beside it, because that is what the report is about.

**One test.** A $10,000 program-restricted award received in two payments shows $10,000 awarded, $10,000 received, $0 spent, $10,000 remaining, and posts restricted revenue twice in cents; an unrestricted award posts as unrestricted.

## 5. Reports and the agent

Saved reports (98 Part 3) gain: grants pipeline, grants by funder, deadlines next 90 days, awarded vs requested by year, restricted balances. The agent (97 Part 3) accepts "draft the report outline for the Sunrise grant" and returns an outline built only from the grant's own rows: what was promised in the proposal fields, what was received, what was spent, the program's gifts and people counts in the period. It cites rows. It does not write outcomes it cannot see.

**One test.** The five reports reconcile to a hand count on the fixture; an agent outline cites only rows on the grant and its fund; a request for an outline on another org's grant finds nothing.

## 6. Import

Presets for the grant tracking most orgs arrive with: a spreadsheet (funder, amount, due date, status), Salesforce NPSP (Opportunity record type Grant), Bloomerang (Grants as a transaction type), Instrumentl and Submittable exports. Funders match to existing organisations by name and EIN when present; never to a person.

**One test.** A 40-row spreadsheet fixture imports 40 grants on 12 funders with zero new people and the pipeline total in cents.

---

## HOW THIS BUILD ENDS

Full battery, tenant battery, landing verifier, prod smoke, CI green, both SHAs, "prod is N behind main." On the demo org: Sunrise Foundation carries one awarded grant with a report due, the Thread exists, the calendar shows it, Finance shows the restricted balance, and the grants pipeline report reconciles. Report each part with commit and minutes.

## FOR JONATHAN

- Lead times per milestone type are org settings; defaults are 30, 30, 0, 21, 45 days for LOI, proposal, decision, report, renewal. Change them if a funder in the pipeline says otherwise.
- QuickBooks spend against a grant waits on 91f and the Intuit keys.

---

## SESSION CONSTRAINTS ON TOP OF THE BRIEF

- Nothing is done until the full battery is green.
- **Never email a prospect.**
- **Do not run the org_creo walk** — the brief's demo-org ending is Jonathan's to
  run, not this session's.
