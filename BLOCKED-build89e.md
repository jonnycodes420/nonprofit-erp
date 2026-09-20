# BLOCKED-build89e — the org's own Stripe, and what only a real key can prove

Written 20 September 2026. The Zeffy/Givebutter field-name gap is in
`BLOCKED-build89c.md`; this file is the Stripe half.

## THE SEPARATION IS STRUCTURAL, AND ASSERTED

Steward already talks to Stripe two ways (`stripeKeys.js`): the DONATION client
on an org's connected account, and the PLATFORM BILLING client for Steward's
own subscription. 89e adds a third, unrelated thing: an organisation that takes
gifts through its **own** Stripe account pastes a restricted read-only key.

`sources/stripeSource.js` shares no code path with either, and the suite proves
it structurally (comments stripped, so the file can still explain the rule by
name): it imports no `stripeKeys`, no `server.js`, **and not the Stripe SDK**.
An SDK client would hand anything holding it a `.refunds.create()`, and the
read-only handle could not see that happen. Raw GETs through the handle mean
the write cannot be FORMED.

## WHAT ONLY A REAL RESTRICTED KEY CAN CONFIRM

1. **Which permissions the restricted key actually needs.** The adapter reads
   `/v1/charges` with `expand[]=data.balance_transaction` and
   `expand[]=data.invoice`. Stripe's restricted keys scope expansion by the
   *expanded* resource's permission, so the key needs read on **Charges,
   Balance transactions, Invoices** and — if `customer` is ever expanded —
   **Customers**. The connect screen's help text says Charges, Subscriptions,
   Invoices and Customers. Confirm against a real key and trim the text to what
   is genuinely required; asking for more than necessary is its own small harm.
2. **The API version the account is pinned to.** BUILD-57's real-Stripe drill
   established that a subscription id lives at `invoice.subscription` on older
   payloads and `invoice.parent.subscription_details.subscription` on 2025+
   ones. Both are read (`subscriptionIdOf`, asserted both ways), but only a
   live read confirms which one this account sends.
3. **Whether a failed subscription charge appears in `/v1/charges` at all** for
   the account's configuration. The same-day Thread depends on it. If it does
   not, the fallback is `/v1/invoices?status=open` and the adapter grows one
   more GET.

## GIVEBUTTER, THE SAME SHAPE

`/transactions` and `/plans` are read; a plan whose status is `failed`,
`canceled` or `paused` comes back as a **`failed` contract row carrying the
plan id**, which is how it raises the Thread without a second channel into the
runner. Page shape (`meta.last_page` / `links.next`) is read both ways; the
field names are the `BLOCKED-build89c.md` gap.

## NOT BUILT, ON PURPOSE

OAuth for either provider. A restricted key ships in thirty minutes and OAuth
does not — Cowork's call, and the right one until a second customer asks.
