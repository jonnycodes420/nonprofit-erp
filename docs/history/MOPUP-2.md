# MOPUP-2 · Today's leftovers: split gifts on the deposit sheet, an imported org's Grow move, Home on a phone, bulk trash (2026-11-06)

From the reports of FEEL-1, GIFTS-2, SPEED-2 and IMPORT-9.

1. **A split gift is split in the bookkeeper's files.** GIFTS-2 named a split gift's largest line on
   `gifts.fund_id` so readers that never heard of lines still see a real fund. The bookkeeper's
   gift-detail file and the deposits file were such readers: a $500 gift given $300 / $200 left as one
   $500 row on the $300 fund. Bookkeepers code to funds, so that was a wrong book. Now
   `server/reports/splitGiftRows.js` turns each split gift into one row per line (its fund, its amount),
   and cuts the processor fee the way the ledger row is cut (in proportion, the last line takes the
   remainder). The deposits file groups those rows, so a deposit has a line per fund and still foots.
   A split gift is still one gift: the count, the "with no payment method" issues and the deposit's gift
   count read gift ids (`bookkeeperRefusals` counts gifts by id).
2. **An imported org's Grow move tells the truth.** The move deck read only gifts, so an organization whose
   file stated $37,206 and who gave $244 since was "First gift of $244 … Nothing since." The deck now
   reads the stated total (FEEL-1's `imported_import_id`; nothing else counts as stated) and the gifts
   that count after it (the AFTER_IMPORT rule Lifetime uses). Such a person is never on "First gift, no
   second yet"; they have their own Grow card, "Gave before Steward, once since": "Gave $37,206 before
   Steward; $244 since." (or, when the one gift is inside the stated total, "…, the latest $244 on …").
3. **Home on a phone never jumps either.** See the report for the measured numbers.
4. **Copy and flake.** The goal card's note reads its dates through `shared/displayDate.js`. perf-app's
   held routes (the late header, the late deck) are wrapped so a route whose page is closing gives up
   quietly, and `measure` waits for running handlers (`unrouteAll({ behavior: "wait" })`) before it
   closes the context; that close under an in-flight `route.fetch` was the ECONNRESET crash.
5. **Bulk trash.** The Donors list's red Delete became More → Move to trash
   (`client/src/components/donors/BulkTrash.jsx`). It is the same trash route (`POST /donors/bulk-delete`):
   one request, one audit row, one trash row each, one Undo toast. New: `withGifts` ("skip", the
   default the screen sends, or "include" with `withGiftsCount`, the number the confirm named; a different
   number is refused whole) and `POST /donors/bulk-delete/check`, a read that tells the confirm how many
   have gifts. Without `withGifts` the route is as before, because Undo import's "remove them too" names
   its own people and has its own confirm.

Noticed, not this build: QuickBooks sync (`routes/finance.js`) still sends a split gift as one line on its
largest fund, and the bookkeeper report's optional fund filter selects by `gifts.fund_id`.
