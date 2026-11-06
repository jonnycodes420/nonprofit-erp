# STALE-1 · After any change, every number on screen is the new one, without a reload

**Why.** Muse's Walk B (5 Nov 2026), on every section: "totals frequently show the old figure until
reload." Each past fix gave one page its own refresh (COUNTS-1's profileRefresh, taskBadge and
eventRows, WALKB-1's writeRev), and every page nobody had patched stayed stale.

**What was found.** Driven through each page's own form, all seven of the walk's paths already
refreshed on main: the form re-read its own page, and moving to another page mounts it fresh. The
staleness came from changes made *elsewhere* while the figure stayed on screen: Atlas (which opens
over every page, writes on the server, then calls `told()`), and the worker. On main the Events
page, the Volunteers hub, Groups, Fundraising, the Grants board and award card, Home's figures and
the move deck did not listen to `told()`, and the Tasks badge did but was handed its 60-second kept
answer. Six of the seven paths failed that way on main's client (§1a–§6a of tests/stale1.test.js).
A second defect: the grant profile's Received tile was a copy taken when the grant opened.

**The mechanism** (`client/src/lib/changes.js`). Every change is announced with the kinds it
touched (gift, pledge, event, grant, task, group, volunteer, fund, totals, person, note, import)
and the ids it names. Three doors announce: api.js for every write that lands (from its path and
body), `told()` (every kind), and the bell's 60-second `GET /atlas/activity`, whose answer now
carries the org's latest `org_changes` id per table (`server/shared/changeMarks.js`), so a table the
worker moved is announced on the next poll with no request added. Views subscribe with
`useChanged(kinds, fn, ids)` / `useChangeRev`; changes inside one debounce merge (a `told()` and the
bell read it sets off arrive 10ms apart, and keeping only the last lost the told's kinds). A change
the screen did not make clears api.js's kept and parked answers first. App's boot slices (grants,
volunteers, tasks, financials) re-read one at a time (`lib/bootSlices.js`). profileRefresh,
taskBadge, eventRows and writeRev keep their names and are built on it.

**Cost.** One gift on Home: 6 re-reads (the deck, my-stats, the fundraising overview, goals, the
Home lead, financials). The suite's cap is 8.
