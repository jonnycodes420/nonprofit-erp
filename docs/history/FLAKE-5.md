# FLAKE-5 · Stop the reruns (2026-11-11)

Every build that day lost a CI cycle to something it didn't cause. Five causes, each found
before it was fixed.

**The access2 login flake.** `access2-portfolio` failed "fetch failed" at its first login, after
`/ready`, three times in two days, twice failing its in-run retry too, and never alone: Repeat
ran it 30 times green. A throwaway diagnostic on CI's own Linux runner settled it. A Node server
and `fetch` in one process: a kept-alive socket reused after the event loop was blocked 6 s or
more fails with ECONNRESET every time, and under 5 s never. The suite's own router walk
(`buildInventory`, 1,633 routes) blocks that loop for 5.4 s on a runner, right at Node's 5 s
keep-alive timeout, so a busier shard tipped it over. When the loop wakes, the login is written
onto the pooled socket and, in the same turn, the server's keep-alive timer destroys that socket
with the request unread; Linux answers with a reset. macOS orders it the other way, which is why
it never failed on a laptop. `/ready`, the pool, boot DDL and the port were each ruled out. The
fix is in the shared boot step: `untilReady` sets an in-process server's `keepAliveTimeout` to 0
before its first request (`tests/lib/inProcessServer.js`), and the two in-process suites that
slept instead of calling it now call it. access2 §0 blocks the loop 7 s and asks again: red 5 of
5 on CI with the fix taken out, ECONNRESET, the same as the fleet saw.

**The day sweep.** 11b7a36 had fixed one test that turned "now + 10 days" into a UTC day. 75
suites that make days from the clock were run at 2026-11-13T00:30:00Z (7:30 PM Eastern, when the
UTC and New York days differ) under TZ=America/New_York and TZ=UTC: none went red. The class is
now guarded: script-guards fails a new test that turns the run's clock into a UTC day, holding
the 17 older lines (8 files), each green in the sweep.

**The /ops trial day.** The facts box cut a trial's end instant at the UTC day, so a trial ending
in the evening Eastern showed a day late. CONNECT-1 had pinned the test fixture to noon, which
hid it. It now reads the org's own day (`orgToday` in its time zone), and the fixture ends at
9 PM New York.

**Guests on the Donors list.** On the default view (Donors once an org has a donor), "Guest of",
"Introduced by" and "Brought people in" showed only givers, and guests usually haven't given.
With one of these filters the default view now searches Everyone and the switch says so
(`groups.directoryRoles`, beside "a search finds everyone"). A view that picked Donors keeps it.

**Drift.** Prod's web has no start command and staging's says `node server.js`; Railway runs
`npm start`, which is package.json's `start`. `railway-drift.js` reads it that way before
comparing.
