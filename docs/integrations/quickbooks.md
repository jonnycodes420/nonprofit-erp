# QuickBooks Online: the sync, and the answers for Intuit's app assessment

Read this when you touch QuickBooks sync (`qboSync.js`, the `/qbo` routes in
`routes/finance.js`, `client/src/components/QboSync.jsx`) or when you fill in
Intuit's app assessment. PARITY-2 Part 5.

## What it does

- An org connects QuickBooks Online through Intuit's OAuth 2.0 (INT-OAUTH's
  one flow, `shared/oauth.js`, provider key `intuit`). Steward asks for one
  scope: `com.intuit.quickbooks.accounting`.
- In Settings, Connections, QuickBooks, staff map each fund, campaign and
  appeal to an income account and an optional class, and choose a deposit
  account and a Stripe fees account. The lists are the company's own chart of
  accounts and classes, read through the query API. Typed text is the fallback
  only when QuickBooks cannot be asked.
- The Pending list shows every gift waiting, with donor, amount, date and
  where it will land. Sync, Sync all and Skip. Nothing is sent until a person
  presses Sync, unless the org's admin turns auto-sync on (hourly, the same
  engine, as `system:qbo/auto-sync`, and off whenever `DISABLE_BACKGROUND_TICKS=1`).
- Each gift becomes one SalesReceipt (`POST /v3/company/{realmId}/salesreceipt?minorversion=75`),
  with the donor matched to a QuickBooks customer (by email, then by display
  name) or created as one. Income posts through one service Item per mapped
  income account. If the org chooses, each payout becomes one Deposit
  instead: a line per gift and the processor fee as one negative line.
- The result and the QuickBooks id are kept on the gift
  (`gift_bookkeeping_syncs`), with a link out:
  `https://app.sandbox.qbo.intuit.com/app/salesreceipt?txnId=<id>` in the
  sandbox, `https://app.qbo.intuit.com/...` in production.
- Errors are sentences with a Retry, never codes (`plainError` in `qboSync.js`).
- Disconnecting revokes the token at Intuit, drops it in Steward, and keeps the
  history. The bookkeeper file (FIX-BOOKS) stays for every org that does not connect.

## The rules

- **A gift goes to QuickBooks once.** Two belts: Steward's own row, unique on
  (org, gift, vendor), claimed before the call and kept whatever happened; and
  Intuit's `requestid`, derived from the payload, kept across a retry whose
  outcome was unknown. `tests/parity2-qbo-sync.test.js` guards it.
- **No default account.** A gift whose campaign and fund have no account stays
  in Pending and says which mapping is missing. A mapped campaign wins over the
  gift's fund; class follows the same order.
- **Only real money.** Samples, refunds, stock and in-kind never go (the
  `NON_CASH_TYPES` list in `depositsFile.js`), nor gifts before the start date.
- **Behind the founder's flag.** `orgs.qbo_sync_enabled`, set only by a super
  admin (`POST /admin/orgs/:id/qbo-sync`, the toggle in /admin). Off, the
  QuickBooks card is not offered and the Intuit consent screen will not open.
  A connection that already exists is never hidden.
- **The demo sends nothing.** Harborlight's connection holds no token and is
  marked `demo`; Sync answers that it is an example connection.

## Environments

| | Sandbox (now) | Production (after the assessment) |
|---|---|---|
| `INTUIT_API_BASE` | `https://sandbox-quickbooks.api.intuit.com` | `https://quickbooks.api.intuit.com` |
| Link out | `app.sandbox.qbo.intuit.com` | `app.qbo.intuit.com` |
| Keys | Development keys from the Intuit app | Production keys, issued after the assessment |

`INTUIT_ENVIRONMENT=sandbox|production` overrides the guess from the base.
Locally and in CI, `INTUIT_API_BASE` points at the stub the test starts.

## Answers for Intuit's app assessment

Jonathan submits these in the Intuit Developer portal (the app's "Get
production keys" questionnaire). Each answer below is true of the code as
shipped.

**App name and purpose.** Steward, a donor stewardship CRM for small
nonprofits. With the org's consent it writes each donation it has recorded
into the nonprofit's own QuickBooks Online company as a sales receipt (or a
bank deposit per payout), so the bookkeeper does not retype gifts.

**Scopes.** `com.intuit.quickbooks.accounting` only. No payments scope, no
OpenID or profile scopes.

**What is read from QuickBooks.** The chart of accounts and classes (for the
mapping lists), customers by email or display name (to avoid duplicates), and
items by name (Steward's own "Steward gifts" service items).

**What is written to QuickBooks.** Customers (one per donor, only when no
match exists), service items (one per mapped income account), sales receipts
(one per gift), and deposits (one per payout, only if the org chooses that
mode). Nothing is ever updated or deleted in QuickBooks.

**When it writes.** Only when a staff member presses Sync, or when the org's
admin has turned on auto-sync. Never on connect.

**Data use.** Data read from QuickBooks is used only to show the mapping lists
and to match donors to existing customers. It is not sold, shared, used for
advertising, or used to train any model.

**What Steward stores from QuickBooks.** The company (realm) id; the account
and class ids and names the org chose; the id of each customer, item, sales
receipt and deposit Steward created or matched. No QuickBooks financial
reports, balances or other transactions are stored.

**Where tokens are stored and how they are encrypted.** The access and
refresh tokens are stored only in Steward's PostgreSQL database, on the org's
connection row (`bookkeeping_connections.credentials_sealed`), sealed with
AES-256-GCM. Each envelope has its own random salt and IV, the key is derived
with HKDF-SHA256 from a master key (`STEWARD_CREDENTIAL_KEY`) held only in the
server's environment on Railway, and the org id is the additional
authenticated data, so a token copied to another org's row will not open. A
database constraint refuses any unsealed value. Tokens are never logged, never
sent to the browser, and never sent anywhere but Intuit. Access tokens are
refreshed five minutes before expiry, and a rotated refresh token is resealed
at once.

**Transport.** HTTPS (TLS 1.2+) everywhere: browser to app, app to API, API to
Intuit.

**Access control inside Steward.** Only an org owner or admin can connect,
map, sync, skip or disconnect. Every action is recorded in the org's audit log
with the person (or `system:qbo/auto-sync`) who did it. Each org sees only its
own connection; this is covered by the tenant isolation battery.

**Data retention and deletion on disconnect.** Disconnecting revokes the
refresh token at Intuit's revoke endpoint
(`https://developer.api.intuit.com/v2/oauth2/tokens/revoke`) and deletes the
sealed tokens from Steward immediately. The record of which gifts were sent
(QuickBooks ids, dates, who pressed Sync) is kept as the org's own bookkeeping
history, and nothing is deleted from QuickBooks. When an org closes its
Steward account, its rows, including that history and the customer matches,
are deleted with the org. A request to privacy@stewardapp.dev deletes them
sooner.

**Redirect URIs.**
- Production: `https://www.stewardapp.dev/oauth/intuit/callback`
- Development (sandbox keys): the same, plus `http://localhost:4173/oauth/intuit/callback` for local testing if wanted.

The redirect lands on the app (a page), which finishes the exchange with an
authenticated POST and a signed, single-use state tied to the org and the
admin who started it.

**Launch and disconnect URLs.** Connect starts from Settings, Connections,
QuickBooks (`https://www.stewardapp.dev/dashboard?tab=settings&sub=connections#books`);
Disconnect is on the same card.

**Host domain.** `www.stewardapp.dev` (app) and
`nonprofit-erp-production.up.railway.app` (API).

**Privacy policy URL.** `https://www.stewardapp.dev/legal/privacy`
(also served at `/privacy`).

**End-user licence agreement / terms URL.** `https://www.stewardapp.dev/legal/terms`
(also served at `/terms`).

**Security page.** `https://www.stewardapp.dev/security`.

**Support contact.** `https://www.stewardapp.dev/contact`, and
jonathan@stewardapp.dev. Privacy requests: privacy@stewardapp.dev. Legal:
legal@stewardapp.dev.

**Error handling.** Every QuickBooks fault is translated into a plain sentence
with a Retry. 401s trigger one token refresh; 429s and 5xx are retried by the
person, with the same `requestid` where the outcome was unknown, so a retry
never duplicates a transaction. The `intuit_tid` of a failing call can be
added to the logs if Intuit support asks.

**Minor version.** 75.

## Before production

1. Walk the sandbox end to end with development keys: connect a sandbox
   company, map, Sync one gift, open the link, Disconnect. A stub proves the
   arithmetic and the once-only rule; only the sandbox proves Intuit's boundary.
2. Submit the assessment with the answers above.
3. Set the production variables (see `NEEDS-JONATHAN.md`), then turn
   `qbo_sync_enabled` on per org from /admin.
