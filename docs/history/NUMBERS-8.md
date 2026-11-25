## NUMBERS-8 · Every money figure agrees with the one beside it, and every figure opens (2026-11-25)

Six Tier 1 fails from the fleet's 25 November lead, each reproduced on staging first (real clicks, Playwright, 1440).

- **A fund's card and its dialog are one function** (`shared/numbers/fundCard.js`). The dialog counted the first 2,000
  gifts it listed (a LIMIT) and only gifts naming the fund, so General Operating read "2000 gifts ... 1,351 waiting" beside
  a card of 3,483 waiting. Both now read `fundCard`: Balance (income less expense rows, every year), the rows behind it,
  and every gift that lands in the fund by ledger status, a no-fund gift landing in the default fund where it posts. A
  ledger row of any other type is in no balance and is said so, never signed. The cards moved to
  `client/src/components/finance/FundCards.jsx` (Finance.jsx 2,062 → 1,954 lines).
- **The $25** in org_stagewalk was a real, posted fleet gift dated 2025-09-25 ("Gift from QA A3 Scale One"); Balance is
  every year and Transactions opened on 2026. Nothing to repair: choosing a fund in Transactions now starts on All years.
- **Gives through comes from the soft credit, not the link type** (`softThrough.givesThroughOf`). Granville Thistlewood is
  Tidewater's program officer and holds no soft credit; Tidewater's $25,000 is its own lifetime and none of its gifts
  credit anyone. A person whose organisation's gifts DO credit them now has a Gives through section whatever links them,
  and the organisation lists every credited person at the same figure (figure source `gives-through`). The truth check
  gained the pair (`tests/lib/numbers8Checks.js`).
- **Raised opens its gifts.** Not reproduced on a fresh session: every figure-source request carried the token and both
  dialogs listed rows. The fleet's "No token provided" is what a tab whose stored token is gone receives: staging sets no
  session cookie, so the request goes with no header and the dialog printed the server's line. A 401 to a request with
  no token now reads "You're signed out in this tab ... Sign in again" with a Sign in link; the CSV download no longer
  sends "Bearer null". The suite censuses every client fetch of a figure source.
- **The LYBUNT chip opens the unit it names**, with its own year and basis; Reports lists people or households and lets
  you switch.
- **Unthanked is one rule.** Home's tile counts from the day the org started with Steward (the fleet's "last 30 days"); it
  now says "since <day>". The report builder's Thanked was `THANKED` only, so a refund row read "Thanked = No"; it is now
  `thanks.THANKED_OR_AWAITING` (null for a refund or a gift refunded in full).
- **A thank-you never thanks a gift that was not made** (`server/mail/giftPreview.js`). The preview laid a real person over
  the brand kit's sample ($250) and skipped empty fields, so the sample gift stayed and the merge filled the empty field
  with its fallback, "your gift". Previewed as a real person, gift fields are theirs or empty; a gift template previewed
  as a never-giver shows "Ana hasn't given yet. Preview this as someone who has." and offers the newest giver. A draft
  for them was already refused (`usable()`, missing gift amount); the suite pins it.
