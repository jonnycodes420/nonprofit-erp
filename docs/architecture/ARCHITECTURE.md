# The rules of the house (ARCH-1)

Read this before writing code. Where it and a brief disagree, ask; don't guess.

[`map.md`](map.md) is the map of the code as it stood at MAP-1, and
[`recommendations.md`](recommendations.md) is the ranked list of what to cut, split or merge.
This file is the rules every build follows from here on. `scripts/ci/arch-check.js` enforces
the ones a machine can check (see "The ratchet" below), in CI and in the pre-push hook.

## Domains

Steward's code belongs to these domains:

| Domain | What it holds |
|---|---|
| donors | people, organisations and households, tags, merge, the person record |
| giving | gifts, pledges and installments, recurring gifts, soft and matching credits, the fiscal year |
| events | events, parties and guests, check-in, seating, auctions |
| mail | email, journeys, sequences, appeals, the send gates and the mail block |
| imports | file import, shape detection, the mapper, undo, exports |
| finance | deposits, fees, month close, budgets, bookkeeping sync |
| give | public giving pages, forms, the donor portal, Stripe Connect |
| auth and orgs | sign-in, roles, invites, org settings, platform billing |
| ai | Atlas, Ask, Why, drafting, the AI switch |
| admin | the admin console, metrics, support access |

Each domain's server code will live in `server/<domain>/`: its routes, its service, its queries
and its tests. Today's files move there over the coming PRUNE builds, one domain at a time, moved
verbatim the FIX-1 way. **New server code goes in `server/<domain>/` now.** A new file that
belongs to no domain is a sign the domain list needs a line, so ask.

## Layers

- **A route** reads the request, checks who is asking, calls a service and writes the response.
- **A service** holds the rule ("who is lapsed", "what a pledge still owes").
- **Queries** talk to Postgres.
- A route never contains SQL that computes a donor-facing number (a sum of `amount`, a gift
  date window, a count of people). It calls the service or figure source that owns that number.
- The client never computes a number the server already has. It shows it.

## One home per number

Every figure a person sees has exactly one function that computes it. These will live in
`shared/numbers/` (NUMBERS-3 builds it). Until a number moves there, call the place MAP-1 marked
as the shared version. **Writing a new copy of any of these is not allowed**; if the shared one
doesn't fit, change it (with a test) rather than writing a second.

| Number | Call this (until `shared/numbers/` exists) |
|---|---|
| Lifetime giving | the stored rollup `donors.total_giving` (`donorSummary.js` `DONOR_SUMMARY_UPDATE`), or live: figure source `donor-lifetime` |
| This fiscal year's giving | the boundary from `orgTime.orgPeriodBounds(org, "fiscal_year")` / `orgFiscalYearStart`; the money from the `gifts` figure source (`donor-gifts-between` per person) |
| Last gift | stored `donors.last_gift_date` / `last_gift_amount` (`donorSummary.js`), live `donor-last-gift`. MAP-1 §2.3: these and `donorStatus` disagree on refunds; NUMBERS-3 settles one rule |
| Lapsed and lapsing | `lapseRule.js` (the bounds and `lapseState`) and `donorStatus.statusSql` |
| First-time donor | `donorStatus` lifecycle `new`; the `givers` source with `first: new` |
| Retained | `computeRetentionRate` (server.js) behind the `retention` source; the person tag in `donorStatus` |
| Major (and every computed tag) | `donorStatus.statusSql` |
| Pledge balance and due | `numbers.pledgeSummary()` and the figure sources `pledges-open`, `pledges-due`, `pledges-overdue`, `pledge-payments` |
| Event came and gave | `numbers.eventGuests()` and `numbers.eventStory()` |
| Suggested ask | `engagement.suggestedAsk` → `shared/smartAmounts.suggestedAskCents` |
| People and households | the Donors list filter (`groups.buildDonorFilter`) for people; figure source `household-giving` for households |
| Net, fee, deposited | `shared/giftFooting.js` for fee and net; `routes/finance.js` `ON_NO_DEPOSIT` for undeposited |

Every number on a screen is a `<Figure>` with a `source` (CLAUDE.md), so the place that computes it
is also the place its rows come from.

## Words

Defined once. Use these words in code, copy and briefs.

- **A gift**: money the organization received, one row in `gifts` with an amount above zero. A
  refund is a negative row against it, never an edit to it.
- **A pledge**: a promise to give an amount, one row in `pledges`. It is not money until a gift
  pays it.
- **An installment**: one scheduled part of a pledge (`pledge_installments`), with a due date.
- **A soft credit**: recognition, never money. A person is credited with a gift someone else
  made. It is never in lifetime, a campaign total, a goal or an average (`creditTypes.js`).
- **A matching gift**: money, from a company, credited to the company. The employee whose gift it
  matched gets a soft credit for it.
- **A household**: people who give together, one row in `households` with its members in
  `donors`. A household is counted once where the screen says households, and its people are
  counted where it says people.
- **A party** is one row of an event's guest list: one registration, which may seat several
  people. **People** are the distinct persons at the event. Say which one a count is.
- **The fiscal year**: the org's setting (`fiscal_year_start_month`), labelled with its dates
  (`shared/fiscalPeriod.js`: "FY 2026–27", or "FY 2026" when it is the calendar year). A screen
  that means the calendar year says "2026" and computes the calendar year on purpose.

## Size

No new file over 1,500 lines. A file already over that may only shrink, and the ratchet allows it
to grow by at most 50 lines in a build (so a fix can land while the split is still to come).

## Tests

- Each domain's tests live with it (`server/<domain>/`), as files move there.
- Any change to a number needs a test against an independent key: a value worked out by hand or
  by the truth check (TRUTH-1), never against the app's own SQL.
- The battery finds suites by itself (`tests/run-all.sh` runs every `tests/*.test.js`). A suite
  that cannot run in the battery says so on one line in its own file:
  `// battery: skip — <reason>`. `tests/every-test-runs.test.js` checks both.
- A guard must be proven able to fail before it is trusted (CLAUDE.md).

## Where the rest goes

- **Scripts.** Nothing new goes in the `scripts/` root.
  - `scripts/ops/`: what Jonathan runs by hand (drills, read-only SQL, prod checks, Stripe setup).
  - `scripts/ci/`: what CI, the battery, the hooks or a test runs.
  - `scripts/once/`: a one-time script. It is deleted after it has run on prod and Jonathan
    says so. A script that only served one build's walk or capture is deleted with that build.
  - The existing folders (`scripts/lib/`, `scripts/load/`, `scripts/sql/`, `scripts/nightly-ai/`,
    `scripts/demo-sites/`, `scripts/demo-assets/`, `scripts/fixtures/`) stay where they are.
- **Generated files** (suite timings, the route inventory, anything a run writes) are never
  committed. They are written to `.generated/` (git-ignored) and rebuilt on demand. The one
  committed baseline is `audit/suite-counts.json`, the pass-count ratchet, because a ratchet needs
  a floor that a run cannot lower.
- **Screenshots and captured output** are not committed. A walk keeps its notes in markdown and
  its pictures outside git. CI fails on any committed image over 500 KB outside
  `client/src/assets/` and `assets/`.
- **History.** One file per brief in `docs/history/` (`docs/history/<BRIEF>.md`). Add a file;
  never edit another brief's. `docs/history/README.md` says how. The same for things waiting on
  Jonathan: `docs/needs-jonathan/<BRIEF>.md`, with `node scripts/ci/needs-jonathan.js` printing
  the open list.

## The ratchet

`node scripts/ci/arch-check.js` runs in CI's `guards` job and in the pre-push hook. Each check
keeps today's violations in `docs/architecture/baseline/<check>.json`. A check fails when a count
goes **up**. When a build removes violations, it lowers the baseline in the same commit
(`node scripts/ci/arch-check.js --update`, which refuses to raise a count). The checks and how
each one matches:

| Check | Baseline | Method |
|---|---|---|
| `big-files` | every tracked `.js`/`.jsx` file over 1,500 lines, with its length | `git ls-files`, count `\n`. A file not in the list may not exceed 1,500; a listed file may not exceed its baseline + 50 |
| `route-gift-sql` | per file in `routes/`, the lines that sum `amount` or window gift dates | a line matches `SUM(` … `amount`, or `g.date`/`gifts.date` compared with `>=`/`<=`/`BETWEEN`, or `LEFT(…date…, 4)`; counted per file |
| `fiscal-year` | per file, the lines that compute a fiscal-year boundary | a line reads `fiscal_year_start_month` / `orgFiscalStartMonth(` / `fiscalStartMonth` **and** builds a date from it, or is a known hand-rolled form (`fyOf`, `finPeriodBounds`, `windowsFor`); `orgTime.js` and `shared/fiscalPeriod.js` are exempt |
| `scripts-root` | the files in the `scripts/` root | `git ls-files scripts/` with no further `/`; the list may only shrink |
| `big-images` | none (it is a hard rule, not a ratchet) | any committed image over 500 KB outside `client/src/assets/` and `assets/` |

A pattern match will miss things and catch some innocent lines. That is the trade: it is a
ratchet, so a false positive that already exists is in the baseline, and a new one costs the
author a minute to reword or a reviewer a line to accept with `--update` and a reason in the PR.

## CI

- **A PR that changes only `docs/**` or `*.md`** runs the guards job (lint and the arch-check)
  and not the battery. The `test` job is skipped and reads as skipped, not as passed.
- **Main's skipped test job is deliberate.** On a push to main, `tree-check` skips the battery
  when the exact tree (`git rev-parse HEAD^{tree}`) already passed on its PR. A squash of a green
  PR is that tree, so testing it again buys nothing; a merge that resolved a conflict is a new
  tree and is tested in full. The deploy jobs accept either a green battery or that skip.
- **The perf suites** (`perf-app`, `perf-giving`) keep their strict millisecond budgets on the
  local battery. In CI (`CI=true`) a budget miss is reported as a warning, not a failure: a
  shared runner's speed varies more between runs than the budgets allow for, and a perf
  regression is caught by the local battery a build runs before it merges. The suites still
  fail in CI on a wrong answer, an error or a timeout.
