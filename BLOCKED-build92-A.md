# BLOCKED — BUILD-92 Track A

Nothing in A1–A4 was skipped. Three things need Jonathan, and one path in the
brief did not exist.

## 1. `fixtures/sources/` does not exist in this repo
The A4 brief named `fixtures/sources/` as the place to check for real vendor
exports. There is no such directory. The convention is
`tests/fixtures/<buildname>/` (`build72`, `build77`, `build78`, `build79`,
`build82`, `build84`, `external`, `mapper`, `portal-images`). A4's fixtures
were written to `tests/fixtures/build92/`.

The rule the path was serving is unchanged and was kept: **no named preset for
any vendor without a real exported file in the repo.** There is none for
Givelify, Tithe.ly, Pushpay, Subsplash, Classy or Donorbox, so no preset was
added for any of them, and `tests/build92-statement.test.js` §4 fails the build
if one appears. Only `generic_statement` ("A bank or other statement") was
added.

**And the three presets that already exist have no real file either.** The
BUILD-89S 89d presets `paypal_csv`, `venmo_csv` and `cashapp_csv` were built
from documentation and reports, and each declares its own `confidence`
(`documented` / `reported` / `unconfirmed`). They were NOT removed - that is a
BUILD-89S decision recorded in `BLOCKED-build89d.md` with its own ten-minute
confirmation walk, and removing them would break orgs that have used them.
They are named here so the gap is not rediscovered.

**Needs Jonathan:** one real scrubbed export each of PayPal activity, a Venmo
statement, and a Cash App statement (or confirmation that Cash App is PDF-only,
in which case that preset should be withdrawn rather than propped up). And one
real bank CSV, which would let the A4 fixture be a real file rather than a
written one.

## 2. A2's connect-time verification cannot be exercised by a battery that has
no provider seam for a provider
`POST /giving-sources` asks the provider before it saves. In production that
always runs. On a TEST boot it runs only for a provider whose `*_API_BASE` seam
is set, because the only other thing on the other end of the wire is the real
provider and a suite must never reach one (`verifyBeforeSaving`, server.js).
`tests/build92-source-errors.test.js` spawns its own child server with all four
seams pointed at a mock, so the refusal IS proven - but the main battery server
skips it for PayPal, Zeffy and Givebutter. If the boot recipe ever gains those
three seams the carve-out disappears on its own.

**Needs Jonathan:** nothing, unless he wants the battery boot recipe to set
`PAYPAL_API_BASE` / `ZEFFY_API_BASE` / `GIVEBUTTER_API_BASE` at an unbound port.

## 3. Two suites spawn child servers on HARDCODED ports, and one of them is 5611
Not a BUILD-92 change and not a defect in the product.

- **`tests/donor-accounts.test.js` spawns its flag-off child on `PORT: "5611"`.**
  That is the port this build's parallel-worktree plan assigned to Track A, so
  the child could not bind, and its four "flags off" assertions were answered
  by the Track A server instead - which has the flags ON. It read exactly like
  a feature-flag regression and is not one. **Proven environmental**: the same
  commit, the same database, the only change being the Track A server moved to
  5619, gives `donor-accounts 52 passed, 0 failed`.
- **`tests/drift.test.js` spawns its threshold-override child on
  `PORT: "5631"`**, which is Track C's band. It did not collide during this
  run, but it is the same defect waiting.

Both should take a free port the way `build92-seed` and `build92-source-errors`
do (`net.createServer().listen(0)`), or read one from the environment.

**Needs Jonathan:** nothing; two one-line fixes. Worth doing before the next
parallel build, because a hardcoded port makes a green suite go red for a
reason that has nothing to do with the code under test.
