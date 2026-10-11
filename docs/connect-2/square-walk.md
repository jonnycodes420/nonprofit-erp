# Square · connecting a real account in ten minutes

CONNECT-2, 11 Oct 2026. Square is a point of sale: a lesson fee and a donation are the same
kind of payment to it. So **Steward imports nothing from Square until the organisation chooses
which of its Square locations take donations**. Everything is read only.

## What the organisation needs

Either of two ways in:

- **Connect with Square (OAuth, the one to use on a call).** One click, then Square's own approval
  screen. Needs Jonathan's Square application (below). Steward asks for five read scopes:
  `PAYMENTS_READ ORDERS_READ ITEMS_READ CUSTOMERS_READ MERCHANT_PROFILE_READ`.
- **A personal access token** (works today, no app needed). The admin opens
  developer.squareup.com, creates or opens an application, switches to **Production**, opens
  **Credentials** and copies the **Production Access Token**. Heavier for a small organisation.

Docs used: https://developer.squareup.com/docs/oauth-api/create-urls-for-square-authorization,
https://developer.squareup.com/reference/square/oauth-api/obtain-token,
https://developer.squareup.com/docs/oauth-api/square-permissions,
https://developer.squareup.com/reference/square/payments-api/list-payments,
https://developer.squareup.com/reference/square/objects/Payment,
https://developer.squareup.com/reference/square/objects/ProcessingFee,
https://developer.squareup.com/reference/square/locations-api/list-locations

Amounts are in cents (`total_money.amount` 2500 is $25.00); the fee is `processing_fee[].amount_money`.
An OAuth access token lasts 30 days; Steward renews it through the one token seam before it
expires (`accessTokenFor`), so the connection does not lapse after a month.

## Once, before the first OAuth organisation (Jonathan)

1. developer.squareup.com, **+** to create an application (production).
2. **OAuth**: redirect URL exactly `https://www.stewardapp.dev/oauth/square/callback`.
3. Railway variables on the API service: `SQUARE_APP_ID`, `SQUARE_APP_SECRET`, `SQUARE_REDIRECT_URI`.
   Until they are set, the Square card on Connections is hidden and the pasted token is the way in.

## Connecting (on the call)

1. **Connections**, the **Square** card, **Connect**, approve on Square's screen. Or: **Settings**,
   **Connections**, the **Square** tile, paste the token, **Test**, **Connect**.
2. On the tile, press **Choose which Square locations take donations**. Steward reads Square's own
   list of locations; tick the ones that take gifts and press **Save locations**.
3. Choose a fund under **Gifts go to**, then **Check now**.

## What you should see

- Payments at the ticked locations become gifts with gross, fee and net. Payments elsewhere are
  counted as "did not match your donation locations" and never touch a donor record.
- Before any location is ticked, the check says plainly that it read payments and imported none.
- A payment Square marks fully refunded is not written as a gift.

## Disconnecting

**Disconnect** on the tile or card. Steward deletes the token; gifts already read stay. Revoke
Steward in Square (Account, Apps, or the developer dashboard for a personal token).
