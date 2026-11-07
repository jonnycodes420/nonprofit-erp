# TRUTH-3 · Every money figure a donor or a board sees is right, and Atlas does arithmetic correctly

From the QA fleet lead synthesis for 7 Nov (W-1107-*), run on prod in CREO Arts (Demo). What was wrong, and why:

- **Stored drafts read wrong figures (Fundraising-19).** TRUTH-2 made a new draft state the true lifetime and
  refused a stale Send, but a draft's words were rendered once and stored, so an old draft still opened with
  "$12,500" for $21,000. A draft now stores figure KEYS (`{{total_giving}}`, `{{giving_this_year}}`,
  `{{last_gift_amount}}`, `{{gift_count}}`, `shared/numbers/draftRender.js`) and every open, preview and send
  fills them from `draftFigures.js` (`server/drafts/render.js`). An old draft with a number in a total sentence
  is read as that key, so it opens true before anyone runs the script; `scripts/ops/truth3-rerender-drafts.js`
  (dry run first, `--apply` with one audit row per org, `--undo`) stores the keys. The card says when lifetime
  includes an import's stated "before Steward" total.
- **Atlas arithmetic (Atlas-22, 01X, 20X).** "How much did Marlowe and Renee give together" went to /ask as one
  name ("$0 in 0 gifts"); Atlas's person answers read the stored `gift_count`; one name summed every match. A
  giving question is now answered in code (`server/atlas/givingTotal.js`): each name resolved alone ("Which
  Walter?" with each match's lifetime, never merged), each figure from `lifetime.js` and `giftCount.js`, the sum
  in cents. The model's roster reads the same figures.
- **One rule for counting a gift (Donors-21X).** A gift is counted when it is hard credit above $0
  (`shared/numbers/giftCount.js`). By year counted every row, so a $0 row made "1 gift" beside "no gifts yet";
  report counts and averages divided by different numbers. The truth check now says "gift count agrees".
- **Top donors vs the Directory (Fundraising-11).** Top donors (lifetime) read the stored rollup; the Directory
  showed the live lifetime but sorted on the stored rollup, so a stale row sat out of order. Both now read the
  live lifetime, the Directory sorts on the amount it shows, and report tables sort amount text as numbers.
- **Near-duplicate funds (Fundraising-09).** Merge funds (`server/finance/fundMerge.js`): preview, move, retire,
  Undo exactly; an import asks before making a fund that is an existing one in other words.
- **The ledger (Finance-39X).** The "not in the ledger" alarm is three figures that foot to every gift: Posted,
  Waiting to post and History only (`shared/numbers/ledgerStatus.js`); a fund's drill-down shows its gifts.
- **Grants, retention, Re-engage, campaigns.** An awarded grant called a future deadline "Passed"; the Deadlines
  list read milestone rows only; the award line ignored an awarded amount. "Calendar year" retention read the
  fiscal year. Re-engage ranked by an unstated rule. A campaign to nobody said "Sent to 0".
- **Receipts and checkout.** Tax Receipts lists every receipt (search, PDF, Void with a note). A donation
  Checkout names the charity (`branding_settings.display_name`, a statement descriptor suffix).
