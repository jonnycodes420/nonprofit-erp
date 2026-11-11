## FLAKE-3 · Three tests that failed on code they don't cover (2026-11-11)

On 10 Nov, `lag1`, `integrity3` and `load1-no-jam` failed CI runs for NAV-1, ACCESS-2B, CI-SPEED-1 and
TOUCH-1, none of which touched what they test. Each was looped 30 times locally on main before
any fix, then again after the fix, and also on CI with the new Repeat workflow (`.github/workflows/repeat.yml`).

**lag1: "TypeError: Failed to fetch".** When a page is left with a read still in flight, Chromium
rejects that read with a plain `TypeError: Failed to fetch`, the same words as a network drop, and
does so after `pagehide` (measured: beforeunload, pagehide, unload, then the rejections). React's
cleanup never runs on a full page change, so the Donors list's catch logged it with
`console.error`. Every one of the local reds was that one line, on the profile the walk was
leaving. The app now marks the page as left on `pagehide` (`client/src/lib/leaving.js`), and
`apiFetchNow` turns a rejection after that into an AbortError, which the Donors list treats as
normal. lag1 gained leg A, which holds the list's read at the network and leaves the page: with
the old catch it is red on every run, not one in five.

**integrity3: `{"mv":[],"undid":1}`.** The audit middleware writes a request's rows on `finish`,
after the answer, by design. §4 read the moved person's row before it landed and the undo's
own row (the same INSERT) just after. §5 had the same race on Empty trash. The suite now
waits for the request's rows (`tests/lib/auditLanded.js`) before it reads them. The app is
unchanged: the audit trail is still one write, after the answer.

**load1-no-jam: planted sleeps left running.** A product bug. A read abandoned while still in
`requireAuth` reached its route afterwards. `requestLimits.checkout` saw a done scope, which
it took for background work, so it ran the statement with no limit and nothing able to cancel it. That
was 60 s for the plant, and in production a refresh at the wrong moment could leave an unbounded
read running, the shape of the 4 Nov incident LOAD-1 was about. An abandoned scope now refuses new
work (`refuseIfAbandoned`). The suite reads Postgres on a pool of its own, counts only its own
run's statements, and cancels every planted sleep in its teardown, so a red run can't poison the
next one, which is why it failed on Jonathan's laptop every time.

**`npm run affected` and browser suites.** It ran a changed browser suite with no client build
and no preview. Now it builds the client for its own server and the shard waits for the preview
to answer before any suite starts. If Playwright, the client's modules, the build or the preview
is missing, the browser suite is skipped with "CI will run it", and it is never started half-ready.
