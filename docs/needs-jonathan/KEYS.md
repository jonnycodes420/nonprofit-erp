## 0-KEYS · THE DEVELOPER ACCOUNTS THESE THREE BUILDS WAIT ON (2026-09-28)

Everything downstream of each token is built, tested and merged. What is
missing in every case is an account only you can open.

**PayPal** (INT-1). The webhook receiver is live and its signature verification
is proven against forged requests. To turn it on:
  · a REST app on your live PayPal account with a webhook subscribed to
    `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`,
    `PAYMENT.SALE.COMPLETED`, `BILLING.SUBSCRIPTION.ACTIVATED`,
    `BILLING.SUBSCRIPTION.CANCELLED` and `BILLING.SUBSCRIPTION.PAYMENT.FAILED`,
    pointed at `https://nonprofit-erp-production.up.railway.app/paypal/webhook`
  · Railway variable: **`PAYPAL_WEBHOOK_ID`** (the webhook's id, not a secret)
  · native OAuth onboarding ("Log in with PayPal" / Partner Referrals) needs an
    approved PayPal **partner** account, which is an application and a review.
    Until then an org connects with its own client id and secret, which works.

**Square** (INT-POS). The item mapping, the classification and every signal are
finished and exercised. To read a real register:
  · a Square developer account and an application, with read-only scopes:
    `PAYMENTS_READ`, `ORDERS_READ`, `ITEMS_READ`, `CUSTOMERS_READ`,
    `MERCHANT_PROFILE_READ`
  · Railway variables: **`SQUARE_APP_ID`**, **`SQUARE_APP_SECRET`**,
    **`SQUARE_WEBHOOK_SIGNATURE_KEY`**
  · Square reviews an application before production OAuth is enabled.

**Toast** (INT-POS). Toast's API is behind their partner programme. Steward
ships Toast as a file import today, which is the truth rather than a
placeholder, and the mapping and signals are identical either way. To apply:
Toast Partner Connect, "Integration Partner", which asks for a company, an
integration description and a review. Until it is approved there is nothing to
paste and nothing is waiting on it.

**Intuit / QuickBooks Online** (INT-2, PARITY-2 Part 5). Gift-by-gift sync
(sales receipts, or a deposit per payout), the mapping from the company's own
accounts, Pending with Sync / Sync all / Skip, and auto-sync are built and
proven against a stub. Shown only to orgs you turn on in /admin (QuickBooks
sync toggle). Every assessment answer is in `docs/integrations/quickbooks.md`.
One line per step:
  · DONE 2026-10-07: Intuit approved the app; the production keys, redirect URI and `INTUIT_API_BASE` are on Railway.
  · Turn QuickBooks sync on per org in /admin. First walk: `docs/int-prod-1/qb-walk.md`.

**Xero** (INT-2). Same code, same mapping, tracking categories instead of
classes.
  · a Xero developer account and an app (it will request
    `accounting.banktransactions` and `accounting.settings.read`), plus Xero's
    app review for production
  · Railway variables: **`XERO_CLIENT_ID`**, **`XERO_CLIENT_SECRET`**,
    **`XERO_REDIRECT_URI`**, **`XERO_API_BASE`**

None of these is set on production today, and none of them breaks anything by
being absent: every screen says plainly that the organisation is not connected,
and the send route builds the deposit, holds it against its payout and refuses
to send rather than pretending.
