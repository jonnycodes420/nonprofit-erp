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

**SPLIT-1 moved `routes/crm.js` into `server/`**, in the folders its brief named (MAP-1's lines):
`server/events/`, `server/grants/`, `server/outreach/` (campaigns, journeys, thank-yous: mail),
`server/imports/`, `server/tasks/`, `server/reports/`, `server/majorGifts/`, `server/memberships/`,
`server/org/` (auth and orgs) and `server/donors/` (donors and giving). Each folder's `routes.js`
holds its main routes, with sibling files where one file would pass 1,500 lines, and `helpers.js`
for what two of its files share. What two domains share is in `server/shared/`, one file per job.
`routes/crm.js` keeps only the mounting: the order its routers sit in, and `mount()`.

## The three patterns

Steward is **one modular monolith**: one deployable, split inside by domain. Not microservices.
Three patterns, each where it fits:

- **Layered, with closed layers, for the core** (donors, giving, events, mail, finance): a route
  calls a service, a service calls queries. A layer talks only to the one below it.
- **Microkernel for integrations and import readers**: a small core plus plug-ins, one contract
  each. A giving source, a mailbox, a bookkeeping sync or a file shape (Bloomerang, DonorPerfect,
  a Givebutter export) is a plug-in that implements its domain's one contract. Adding one adds
  a file; it does not edit the core.
- **Events and a queue for background work**: anything slow, scheduled or retried (syncs,
  sweeps, big imports, digests) is a job on the queue (`jobQueue.js`), started by an event or a
  schedule, never inside a request. An event is a row in `events_outbox`, written with the change
  it follows, and each reaction to it is a handler (`server/<domain>/handlers/`, JOBS-1).

## One core, many faces

The app, the donor portal, the public giving pages, emails and mail-merge fields all get a donor's
numbers from the same functions ("One home per number" below). **No face computes its own.** A
portal total, a `{{lifetime_total}}` merge field and the profile's Lifetime are one call.

## No org-specific code

No `if (org === …)` and no code path for one customer. Differences between orgs are settings or
data. A demo or fixture org has an id in tests and seeds, never in app code. The `org-specific`
ratchet counts org ids and slugs in app code (tests, scripts and fixtures excepted), and the count
may only go down.

## Layers

- **A route** reads the request, checks who is asking, calls a service and writes the response.
- **A service** holds the rule ("who is lapsed", "what a pledge still owes").
- **Queries** talk to Postgres.
- A route never contains SQL that computes a donor-facing number (a sum of `amount`, a gift
  date window, a count of people). It calls the service or figure source that owns that number.
- The client never computes a number the server already has. It shows it.

## Queries in bulk

- No query inside a loop over rows (N+1). Fetch the set once, with `= ANY(?)` or a join.
- Select only the columns needed; never `SELECT *` into a response.
- A big job (an import, a recompute, a sync) runs in batches as background work, not in a request.
- The yardstick is `messy-25k`: 25,000 people from a messy real-shaped file. A change that is slow
  there is slow.

## One home per number

Every figure a person sees has exactly one function that computes it. The giving numbers live in
`shared/numbers/` (NUMBERS-3): one module per concept, each with its SQL fragment and, where a screen
needs it, its function, and each tested by hand in `tests/numbers-home.test.js`. **Writing a new
copy of any of these is not allowed**; if the shared one doesn't fit, change it (with a test)
rather than writing a second.

| Number | Call this |
|---|---|
| Money in a total | `shared/numbers/money.js`: `MONEY(g)` (hard credit, refunds off), `GIFT(g)` (money above zero), `LIVE(d)`; the sum itself `MONEY_SUM(g, where)` / `MONEY_CENTS(g, where)` (NUMBERS-5) |
| The fiscal year | `shared/numbers/fiscalYear.js`: `fiscalYear`, `fiscalYearToDate` (cut at the org's today), `period` (fiscal or calendar), `thisAndLast`, `yearStarting`. It wraps `orgTime.orgPeriodBounds` |
| Lifetime giving | stored `donors.total_giving` (`donorSummary.js`), live `shared/numbers/lifetime.js` `LIFETIME(d)`; the profile opens `donor-lifetime` |
| Giving in a span (this year, any window) | `shared/numbers/givingBetween.js`: `IN_SPAN(g)`, `SPAN_SUM(g)` / `SPAN_CENTS(g)` (a report's year column), `givingBetween()`; never past the org's today |
| Last gift | `shared/numbers/lastGift.js`: the latest dated gift above zero, never a refund or a credit row, the imported last gift as a floor; on one day the one recorded last, then the larger, then the one further down its file (`gifts.import_row`). Stored on the person by `donorSummary.js`, live `donor-last-gift` |
| First gift and first-time | `shared/numbers/firstGift.js`: `FIRST_DATE(d)` (the old system's first gift counts), `isFirstTimeIn`; on one day `FIRST_GIFT_ORDER` (recorded first, the larger, higher up its file) |
| Retained | `shared/numbers/retained.js`; `computeRetentionRate` (server.js) and the retention sources read it |
| Deposited | `shared/numbers/deposited.js`: `DEPOSITED`, `NOT_DEPOSITED`, `BANKED`, `DEPOSIT_NAME` (Finance, month close, the bookkeeper's file, the deposits file, QuickBooks) |
| A face's numbers (portal, account page, merge fields) | `shared/numbers/donorTotals.js` |
| Lapsed, lapsing, pledge-held, pledge overdue | `shared/numbers/lapse.js` (NUMBERS-4): one SQL fragment, `stateSql` and its conditions; `lapseRule.js` keeps the pure rule (the bounds, `lapseState`) the browser bundles |
| Major and the giving level | `shared/numbers/tags.js` (NUMBERS-4): the org's Giving levels cut on the last 12 months (`cutsOf`, `levelOf`, `LEVEL_SQL`); the tag, filters, groups and the Insights ladder read it. "Top tenth by lifetime" is `TOP_TENTH_SQL`, not major |
| Every other computed tag (lifecycle, retained) | `donorStatus.statusSql`, which reads `firstGift.js`, `lapse.js` and `tags.js` |
| Pledge balance and due | `numbers.pledgeSummary()` and the figure sources `pledges-open`, `pledges-due`, `pledges-overdue`, `pledge-payments`; a pledge's paid `shared/numbers/pledges.js` `PAID_OF`, a grant's received `GRANT_RECEIVED` |
| An event's guests (invited, came, gave, ...) | `shared/numbers/events.js` `eventFigures()`: parties (a household once), people beside them; `numbers.eventStory()` for the page's story |
| Suggested ask | `shared/numbers/ask.js` (NUMBERS-4): one rule for the profile (`engagement.suggestedAsk`) and every Insights card, through `shared/smartAmounts.suggestedAskCents`, rounded by `naturalAskCents`; a rising donor steps up only when Room to give is known (`roomKnown`, NUMBERS-5) |
| People and households | `shared/numbers/households.js` (NUMBERS-4): `PERSON` (not deleted, not sample), `counts()` (people, households with a live person, giving units on EVENTS-3's `PARTY`) |
| Net and fee | `shared/giftFooting.js` |

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

## The connection budget

- The pooler (Supabase → Database → Settings → Connection pooling → Pool Size) holds 40 clients across every process; `POOLER_SIZE` tells `npm run status` if it changes.
- Each process opens at most `DB_POOL_MAX` plus the set-wise pool's `min(3, max(1, floor(DB_POOL_MAX / 3)))`: web 10 + 3 = 13 (the default), worker 5 + 1 = 6.
- A deploy runs the old web, the new web and the worker at once.
- The rule: **2 × web + worker ≤ pooler size** (today 2 × 13 + 6 = 32 of 40). `npm run status`'s `db pool` line checks it.

## Tests

- Each domain's tests live with it (`server/<domain>/`), as files move there.
- Any change to a number needs a test against an independent key: a value worked out by hand or
  by the truth check (TRUTH-1), never against the app's own SQL.
- The battery finds suites by itself (`tests/run-all.sh` runs every `tests/*.test.js`). A suite
  that cannot run in the battery says so on one line in its own file:
  `// battery: skip — <reason>`. `tests/every-test-runs.test.js` checks both.
- A guard must be proven able to fail before it is trusted (CLAUDE.md).
- **Tests set their own clock.** A test that depends on today's date fixes its own date
  ("Tuesday 4 Nov 2026, 2 PM ET") through `tests/clock.js`, never `Date.now()` or `new Date()`.
  Anything that reads a date gets boundary tests: midnight UTC (still yesterday in New York),
  the last day of a month at 11 PM ET, the last day of the fiscal year, and the DST change.
  The `real-clock` check is a hard rule since CLOCK-1: no file under `tests/` reads the real
  clock (`tests/clock.js` gives `testNow`, `civilDay`, `dayOffset`, `civilYear`). The weekend pin
  is gone with it: the battery gives the same result on any day and at any hour, proven by
  running it at 11:45 PM ET on a Saturday and at 10 AM on a Tuesday. `tests/clock-boundaries.test.js`
  holds the key figures at the boundaries.

## Where the rest goes

- **Scripts.** Nothing new goes in the `scripts/` root.
  - `scripts/ops/`: what Jonathan runs by hand (drills, read-only SQL, prod checks, Stripe setup).
  - `scripts/ci/`: what CI, the battery, the hooks or a test runs.
  - `scripts/once/`: a one-time script. It is deleted after it has run on prod and Jonathan
    says so. A script that only served one build's walk or capture is deleted with that build.
  - The existing folders (`scripts/lib/`, `scripts/seed/`, `scripts/load/`, `scripts/sql/`,
    `scripts/nightly-ai/`, `scripts/demo-sites/`, `scripts/demo-assets/`, `scripts/fixtures/`)
    stay where they are. `scripts/README.md` lists what Jonathan runs, with each command.
  - A deleted script is listed in `docs/architecture/scripts-removed.md`; `git show` brings it back.
- **A new route goes in its domain's file** under `server/<domain>/`. `routes/crm.js` registers
  none and only shrinks (the `crm-routes` check). A file that is moved verbatim keeps its ratchet
  counts: `node scripts/ci/arch-check.js --update --moved <old file>` hands them to the new files,
  and refuses unless they add up. A move-only build runs on a `split-*` branch, where
  `scripts/ci/route-diff.js` must find no change in any route's method, path, middleware or order.
- **Routes.** A route is deleted only when a person-readable search shows no caller in the
  client, the server, emails, templates, schedulers, scripts and outside services (Stripe,
  Resend, Mailchimp, PayPal, QuickBooks, Google, Microsoft), **and** its path carries none of
  `token`, `webhook`, `public`, `pay`, `unsubscribe`, `callback` or `run`. A route that fails
  either test needs Jonathan's yes. Every route reviewed is a line in
  `docs/architecture/routes-reviewed.md`: who calls it, or what was searched.
- **Generated files** (suite timings, the route inventory, anything a run writes) are never
  committed. They are written to `.generated/` (git-ignored) and rebuilt on demand. The one
  committed baseline is `audit/suite-counts.json`, the pass-count ratchet, because a ratchet needs
  a floor that a run cannot lower.
- **Screenshots and captured output** are not committed. A walk keeps its notes in markdown and
  its pictures outside git. CI fails on any committed image over 500 KB outside
  `client/src/assets/` and `assets/`.
- **Decisions.** `docs/decisions/house.md` holds the house-wide decisions (soft credits, the
  weekly email, one fiscal year, the modular monolith, no org-specific code, tests set their own
  clock); each area's file holds the rest.
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
| `route-gift-sql` | per file of server code outside `shared/numbers/` (NUMBERS-4 widened it from `routes/`), the lines that sum `amount` or window gift dates | a line matches `SUM(` … `amount`, or `g.date`/`gifts.date` compared with `>=`/`<=`/`BETWEEN`, or `LEFT(…date…, 4)`; counted per file. `money-sums.md` classes every money sum |
| `number-copies` | per app file outside `shared/numbers/`, the lines with a donor label's own rule | a 90th percentile of lifetime, a comparison with `giving_level_major_cents`, a lapse window built from 365 days off a last gift, or a first gift from `MIN(LEFT(date,10)) FROM gifts` (NUMBERS-4) |
| `fiscal-year` | per file, the lines that compute a fiscal-year boundary | a line reads `fiscal_year_start_month` / `orgFiscalStartMonth(` / `fiscalStartMonth` **and** builds a date from it, or is a known hand-rolled form (`fyOf`, `finPeriodBounds`, `windowsFor`); `orgTime.js` and `shared/fiscalPeriod.js` are exempt |
| `scripts-root` | the files in the `scripts/` root | `git ls-files scripts/` with no further `/` (a README excepted); the list may only shrink |
| `real-clock` | a hard rule since CLOCK-1: no test reads the real clock | the lines of every `.js` under `tests/` (not `clock.js`, `lib/browserClock.js` or fixtures) with `Date.now()` or a bare `new Date()`, comments stripped |
| `org-specific` | per app file, lines naming one org | a quoted `org_<id>` literal, `org_slug === "…"`, or `orgId === "org_…"`, in app code (not tests, scripts, docs or audit) |
| `crm-routes` | none (a hard rule, SPLIT-1) | a line of `routes/crm.js` that registers a route (`app.get(` … `routers.x.post(`) |
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
