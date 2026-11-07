# MOPUP-3 · QuickBooks gets split gifts, an imported org's ask uses its history, LYBUNT is fast, a new org's phone Home stays still (2026-11-06)

From the reports of MOPUP-2, GIFTS-2, FEEL-1 and SPEED-3.

1. **QuickBooks gets every fund line.** QuickBooks sync (`qboSync.js`) read `gifts.fund_id`, which for a
   split gift is only its largest line (GIFTS-2), so a $500 gift given $300 / $200 was one $500 line on
   the $300 fund's account. Now `server/qbo/giftParts.js` turns a gift into its parts, one per fund line,
   cut the way the deposit sheet cuts it (`splitGiftRows.cutInProportion`): a sales receipt has a line per
   part, each through its own fund's item and class; a payout deposit has a line per part and the fee as a
   negative line per fund (a payout on one fund still has one fee line). One unmapped part holds the whole
   gift back with that part's sentence. Pending says where each part lands.
2. **An imported org's ask uses its stated history.** The ask read gifts in Steward only, so an org whose
   file stated $37,206 was asked $250 ("largest gift $244"). `shared/numbers/statedAsk.js`: when
   `imported_import_id` is set, the stated history is the base: the stated average gift when the file
   gave a count (or the stated last gift if larger), else the stated last gift, else a year's giving from
   the stated dates, else the stated total. The ask is the larger of that and the ask from gifts in
   Steward, and says "based on $37,206 given before Steward". Home's moves and the profile read the same
   function, so they agree. With only a total stated, the base is the total: the ask is large, and the
   card says what it is based on; a person reviews every ask.
3. **LYBUNT under the bar.** Its rule (`shared/numbers/bunt.js`) ran as a semi-join over the prior year's
   gifts and an anti-join over this year's, three times a request (the rows, the count, the money at
   stake), each prior-year hash built once per parallel worker, and each row then read its last year
   twice more. `lybuntSet` is the same rule in one pass over the two years' gifts per person; a LYBUNT
   person's last year is the prior year by the rule, so the amount is that year's money rows. Proven
   equal to the old form on every org of the load fixture and on planted refunds, soft credits, $0 and
   undated gifts. The report's figures are asked beside its rows. No index was needed. SYBUNT and the
   group page keep the predicate form.
4. **A new org's phone Home stays still.** MOPUP-2's 1,200 px phone stand-in is right for a deck with
   moves (what sits under it is out of view before and after), but a new org's empty deck is ~230 px, so
   the Thread jumped up into view when it landed (CLS 0.225). The Insights build now keeps the deck's move
   count beside its body (`stored_insights.deck_moves`, `server/insights/deckMoves.js`), GET /org carries
   it, and a phone that knows the deck is empty holds what sits under it until it lands (FEEL-1's gate,
   which a wide screen always uses). An empty deck's height can't be known ahead: it can carry the
   drifting list and the chips.
5. **The bookkeeper's fund filter reads fund lines.** It read `gifts.fund_id`, so filtered to General a
   $500 gift split $300 Food Pantry / $200 General was missing. Now (`server/reports/bookkeeperFund.js`)
   a gift is in when any of its fund rows is on the fund, and the file keeps only that fund's rows; the
   database total it foots against is that fund's line amounts.
