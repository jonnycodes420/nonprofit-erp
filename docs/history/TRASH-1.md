# TRASH-1 · One meaning of delete, for people and everything with money on it (2026-11-23)

**Why.** Jarvis's 22 Nov sweep: "Finance fund balances never revert when a donor is trashed … Finance keeps the
deleted gifts forever ($735 of test gifts still showing). Single gift deletes work; the trash path misses." Delete
meant two things. Deleting one gift cascades (receipts, ledger row, tasks, journeys). Trashing a person is a flag
(`donors.deleted_at`) every reader must remember; the gift readers did (LIVE), the ledger readers did not, so a fund's
Balance kept a trashed person's money while Received dropped it, and their receipts stayed live. Separately, nine delete
routes carrying money or people hard-deleted with no confirm of their own: a grant took its deadlines, documents and
notes (ON DELETE CASCADE) and left its gift and pledge live on the funder.

**What changed.**
- `LEDGER_LIVE` (shared/numbers/money.js), inside `LEDGER_FUND_ROWS` and on every raw ledger total (Finance dashboard,
  budgets, month-end check, board report, finance basis, export). Read-time, so staging's $735 cleared by itself and
  no row needed repair.
- The person delete asks about live receipts and voids them on her yes, in the trash's own transaction.
- removal.js got six kinds (server/removal/moneyKinds.js); the old DELETE routes answer through `removeThrough`.
  `scripts/ci/delete-scan.js` holds the line in CI (red on main: the eight hard deletes).
- Profile → More: Delete and Erase apart, each with one line. Settings → Trash: the count follows every person write;
  the search narrows the rows on screen at once.
- `scripts/ops/staging-trash-tidy.js`: the walkers' trash rows on staging, dry run by default.

**Learned.** A flag-style soft delete needs its "is it live" predicate in the one shared fragment that every reader of
that kind of row already goes through (here LEDGER_FUND_ROWS), not in each reader. And a count hook that listens for a
custom event nobody sends looks right in review; the change bus (lib/changes.js) is the one channel.
