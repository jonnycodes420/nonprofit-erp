## FIX-52 · Import undo, honest receipts, no timeouts (2026-10-27)

- **What happened.** On 27 Oct a real event workbook (people, gifts, a "Check these" notes sheet) was imported on prod.
  The modal waited about two minutes and went back to the start three times; one import committed. Its receipt said
  "Does not reconcile" (43 unpaid rows went in as pledges and the receipt counted only gifts) and had no Undo. The
  preview counted the notes sheet as people, and every new person was a Prospect. Deleting the people from Donors
  left them in event counts and other totals.
- **Where the two minutes went.** The commit wrote every row as its own statement (about 6,844 round trips on the
  fake fixture, 1.7 s locally, roughly two minutes at a remote database's latency), after asking CHECK-2's matcher
  once per person, twice (preview and commit), and asking the model again inside the commit. The request was held
  open the whole time with no transaction, so a dropped request left a committed import and a blank screen, and each
  click minted a new run id. Now: a job (`sheet_import_jobs`) in one ambient transaction (`db.withAmbientTransaction`),
  batched writes, the org's people read once (`orgPeopleIndex`), the model's proposals carried from the preview.
  Fixture commit 1,735 ms → about 800 ms locally; about 1,660 queries including preview and after-change.
- **The fixture** is `tests/fixtures/import/fix52/` (the brief said `test/`; the repo's fixtures live under `tests/`).
  The People sheet's "People 443 / Invited 422 / RSVP'd 230 / Attended (checked in) 172" rows are checked against the
  preview; "Not yet paid" is now a pledge word (it was not, so the whole Status column fell through to a kept field).
- **Stage.** The stage list has no Donor or Pledger: a giver starts at `steward` (Ongoing care), a pledger at `solicit`.
- **Tests.** `tests/fix52-import-undo.test.js` (one new suite, 46 checks): preview counts, two clicks at once, a
  dropped request, a planted mid-write failure that must roll back whole, the receipt and its Undo, deletes and Undo
  after deletes. Planted defects seen red: the Events filter removed (180 shown for 3), the transaction removed (462
  people left behind).
