## ATLAS-6 · Atlas never states a fact it didn't read (2026-11-11)

Why (lead-2026-11-10): a lifetime given for a quarter (W-1109-Atlas-01), a real $2,500 gift placed in a month it
wasn't given (W-1110-Atlas-02), no executive director though three settings screens name one (W-1110-Atlas-07X),
and a two-part question echoed back (W-1110-Atlas-07). All four reproduced by real typing into Atlas on a
production build, the date one with a stand-in model.

- **Periods, in code** (`shared/atlasDates.js` `periodOf`): a range in words or numbers, a month, a quarter, a fiscal
  year (labeled by the year it ends, as Reports do), a year, "last year", "year to date". `giving_total` with a period
  reads `shared/numbers/givingBetween` for that window, lists each gift from its row ("$4,361 on Feb 14, 2026"), keeps
  the row ids on the answer, and says Lifetime labeled. With no period it is Lifetime, as before. The parser only ever
  overrode the step's kind, never read the period: that was the fall-through.
- **The grounding check** (`server/atlas/grounded.js` `groundedIn`): every $ amount and every date in a reply
  (full dates, "Mar 31", "March 2026") must be one the answer read; otherwise the template sentence goes. It runs on
  Ask's model sentence at the source (`routes/why.js` writeSentence, fallback reason `dates`) and again on the line
  Atlas says from an Ask answer. Before, the sentence check compared numbers only: a real amount and a year present
  anywhere let a wrong month through.
- **Org facts** from settings: executive director (a teammate's title in My profile, or the receipt signer's title in
  Tax Receipts and the Brand kit), the signer, EIN, address, fiscal year, time zone.
- **Compound questions** are split and each part answered in plain words; a forecast says what is known instead
  ("I can't predict next year's giving, but Rosalind gave …"). Never the question echoed.
- Not in this build: Atlas's other model texts (the email draft, the call script) carry their own fact rules and were
  not touched; the check could be extended to them.
