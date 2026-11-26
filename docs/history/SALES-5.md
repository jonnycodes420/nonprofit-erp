# SALES-5 · One price per customer, typed once, and every screen in the sales CRM agrees (25 Nov 2026)

**Why.** Jonathan, 25 Nov 20:06: "I updated the MRR and ARR for CKRH and it didn't update in the pipeline or
anywhere else, and the forecast forecasted 600-something dollars in January." CKRH's deal was won (Paying),
$299/mo, first charge Jan 1. January's $612.95 was three open deals weighted (90%, 80%, 35% of $299). The forecast
counted open deals weighted and won deals only once Stripe billed them, so a won deal whose first charge was later
counted nowhere. Underneath: four prices for one customer (the deal's value, the signed order's or quote's price, the
org's agreed `billing_mrr_cents`, and Stripe's live subscription) and nothing tying them together.

- **One rule** (`server/admin/sales/customerPrice.js`): Stripe if billing; else the signed order or accepted quote
  (whichever was signed last; a yearly order ÷ 12); else the agreed price; else the deal's value. `pick()` is pure;
  `forDeals()` reads many deals in a fixed number of statements (the onboarding board's `signals.readFacts` for Stripe
  and agreed). ARR is `arrOf()` (× 12), the only place a monthly price becomes yearly.
- **Every deal row carries it** (`lists.rowsFor` → `price_cents`, `price_source`, `price_says`, `billing_starts_on`), so
  the board's cards and column totals, the deal header, the forecast and the list all read the same row. The record
  page's MRR row, the Steward link panel and the scoreboard's MRR added read the same function.
- **The forecast** gains "Won, billing starts": a won deal Stripe doesn't bill yet counts in full from its first charge
  month (the order's start, else the org's first charge, else the close date). Billing deals are in MRR now only, never
  twice. A won deal with no date, or a start gone by that Stripe still doesn't bill, is not counted, and the sentence
  says how many.
- **The edit asks.** Saving a deal's value when the price is a signed order, a quote or live billing answers 409
  `price_differs`: "This changes the pipeline value only. The signed order says $299/mo… Change the order too?" with a
  link, and "Change the pipeline value only" saves it with `valueOnly`.
- **Live.** The sales tables announce a `sales` topic on LIVE-2's header (`shared/changeTopics.cjs`); the pipeline, the
  deal header, the record page and the forecast listen through FRESH-2's `useLive` and are in `lib/surfaces.js`.
- **Existing rows.** Won deals whose own value disagrees with the price still carry the old value (no screen shows it
  now). `scripts/ops/sales5-price-check.js` lists them, ids and cents only; `--deal <id> --apply` sets one, stamped
  `system:sales5-price-check`, with a note on the deal.
- **Not in this build:** the Customers board (`customers.js`) still reads the quote, else Stripe, else the custom
  price; it should read `customerPrice` next.
