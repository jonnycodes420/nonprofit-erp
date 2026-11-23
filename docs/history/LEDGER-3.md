# LEDGER-3 · Fund money comes from one place, and a waiting gift can actually post (2026-11-22)

Jarvis's 22 Nov sweep (staging Harborlight, a2746ab) found Reports' Gifts by fund putting $795,952.28, 634 gifts
and 98.8% of the year on Gala Reserve, while Finance showed Gala Reserve at $60, and 3,569 gifts ($6.0M) waiting
to post with nothing able to post them. Reproduced on staging with Playwright clicks before any change.

1. **One default fund.** Four pickers chose "the unrestricted fund": `orgs.default_fund_id` (read only by capture),
   the oldest unrestricted fund (`ensureOrgLedger`, so recordGift ignored a chosen default), any unrestricted fund
   with no order (the partial-chart branch), and the demo seed's first by name, Gala Reserve. Now
   `shared/numbers/defaultFund.js` is the one rule, stamped once on a write as `system:defaultFund`
   (`orgs.default_fund_by`, new). The deposit sheet's "only if a person chose one" (BUILD-88b) reads
   `CHOSEN_SQL`, which ignores that stamp. `GET /finance/funds` no longer heals the ledger (a GET never writes).
2. **The seed.** Unassigned gifts take the default (`DEFAULT_FUND_SQL`), the seed stamps General Operating as the
   default outright (the funds can share a created_at), its ledger rows take each gift's own fund, and CLEAN-1's
   duplicate-pair gifts (written after the seed's fund sweep) take it too. A local seed: every Harborlight gift has
   a fund, Gala Reserve holds one gift, and no ledger row names another fund than its gift.
3. **Post to the books.** `server/finance/ledgerPost.js`: waiting gifts by deposit, posted through
   `postGiftRows`, which recordGift's Rule 3 now calls too. Each batch is `ledger_post_batches` and every row
   carries `post_batch_id`, so Undo removes exactly that batch. A deposit that changed since she read it is
   refused whole. History and undated gifts never post; imports still never post on their own.
4. **Two numbers per fund.** `shared/numbers/fundBooks.js`: Received this fiscal year (gifts), the same rule as
   Reports' Gifts by fund, and Waiting to post, a figure through the `ledger-status` source (new `fund` param).
   The walk found a figure inside a fund card also opened the card's own rows on top: React bubbles the figure's
   (portaled) dialog clicks up to the card's link. `FundBooks.jsx` `Hold` stops them.
5. **Existing rows.** `scripts/ops/ledger3-repair.js`, dry run unless `--apply`: gifts with no fund take the
   default, ledger rows take their gift's fund, one audit row per org changed, org_creo skipped.

Tests: `tests/ledger3-funds.test.js` (27 checks; against origin/main 7 red and then a crash at §3, which has no
route there). `assertSurfacesAgree` has a funds pass (`tests/lib/ledger3Checks.js`). Planted, each red: the
default ordered by name; received summing the whole split gift; a no-fund gift posted with no fund; Undo deleting
more than its batch.

Not done: the deposit list is long on an org with years of unposted gifts (1,544 deposits on the demo); it shows
twelve, then "Show all". A refund recorded on a gift that is still waiting posts its own negative row when posted,
as recordGift does.
