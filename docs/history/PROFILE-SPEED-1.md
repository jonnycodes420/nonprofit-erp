# PROFILE-SPEED-1 · A profile opens in one trip, and no single page can take every database connection

12 Nov 2026. The why, not instructions. The full measurements are in the build's report.

## What was wrong
REPORTS-SPEED-2 found it on the nightly load runner: opening a profile kept the web's ten database
connections busy, and two Donors list reads together held all ten. Measured first on a production
build with a 10,000-person org, every page clicked in a real browser:

- **One request could hold the whole pool.** `GET /donors` held 10 of 10 connections, the
  profile's above-the-fold bundle 10, `/donors/list-setup` 9, `/donors/:id` 8. Each fanned its
  statements out with `Promise.all`, and every statement took its own connection.
- **A profile was two requests racing.** The Donors list read the person's record the moment a row
  was clicked, then the profile asked for the rest of its first screen beside it.
- **One profile open sent 246 statements**, 135 of them different: the 17 routes behind the first
  screen each asked the same questions again (one money sum 21 times).
- **Communications read every person in the file on open**, 500 at a time (21 pages, ~40 s on
  10,000 people, 6 connections each), and kept going after you left.
- **The pages' first reads were only bundled at boot** (PERF-4). Clicking to Settings, Reports or
  Donors later sent each panel's read on its own: 11 to 13 requests.

## What changed
- **A per-request connection cap** (`server/shared/pools.js` `PER_REQUEST_MAX`, 3; the places are
  taken in `server/shared/requestLimits.js` `checkout`, where every connection passes). Both pools
  count. A connection held for a callback (`withClient`, `withTransaction`, the ambient transaction,
  an advisory lock) takes a place; a connection asked for inside one waits at the front of the
  request's queue, and goes past the cap only when every place is a held callback (the one case
  that would deadlock), counted and logged as `[conn-cap] <route>`. The first version let nested and
  lock connections skip the queue, and the runner caught a request at 4.
- **`GET /donors/:id/profile`** (`server/donors/profileBundle.js`): the record and everything the
  first screen draws in one answer, each part the route's own answer run in-process
  (`routes/homeBundle.js` `answer()`), so no rule has a second copy. The separate routes stay for
  re-reads after an action. Receipts, open asks and planned gifts are read when the Giving tab
  opens. Custom fields (the rail's facts) and uploads (the Files tab's count) stay in the first
  trip because they are on screen.
- **One answer per statement inside a bundle** (`server/db/query.js` `memoKey`): the same plain read
  with the same values is sent once per bundle request, and each caller gets its own copy of the
  rows. Nothing outlives the request. 246 → 160 statements per profile open.
- **A page's first reads leave as you click** (`client/src/App.jsx` navigateTo →
  `lib/pageReads.js`), and Events, Communications and Finance got lists (nothing that asks a third
  party: Finance's Stripe summary stays with the page). Communications reads people only for a
  hand-picked audience. Events asks for its four year figures once.
- The nightly reports how full the pool got (`scripts/load/poolSampler.js`).

## The pool target
The brief asked for "pool peak under 70%". A per-request cap cannot reach a momentary peak: ten
requests in the same instant each holding up to three is 30 wanted of 10. Reaching it would take a
second cap on all requests together, leaving connections idle while requests wait, which costs
throughput on prod where each statement crosses the network. Jonathan chose (12 Nov) to hold the
pool to its time at 70% or more instead. In the battery's load shape the one-trip profile spends
~9–12% of the run there, the old 13-call shape 29%.

## Tests
- `tests/profile-speed1.test.js`: parity (seven fixture people, every part byte for byte the route's
  and LOAD-1's bundle's, the header's Lifetime worked out by hand against a deliberately wrong
  stored rollup) and a load shape (no request over 3, the pool under 18% of the run at ≥70%).
- `tests/page-budget.test.js`: every main page in a browser, at most 5 requests on open (the
  profile 3 before its first screen lands), a few pages at today's count, and no request over 3.
