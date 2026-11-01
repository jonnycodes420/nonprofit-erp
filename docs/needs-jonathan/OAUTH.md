## 0-OAUTH · THE CONNECT BUTTONS WORK NOW, AND THE REDIRECT URI IS THE APP (2026-09-29)

INT-OAUTH built the handshake the three builds below were waiting for. Pressing
**Connect** now opens the provider's real consent screen, and Steward stores the
tokens encrypted. Nothing else about the list below changed: without the
credentials, each button is greyed out and says in its own words which variable
is missing.

**The one thing easy to get wrong when you register each app.** The redirect URI
is on the **app**, not the API:

    https://www.stewardapp.dev/oauth/xero/callback
    https://www.stewardapp.dev/oauth/intuit/callback
    https://www.stewardapp.dev/oauth/square/callback

That is deliberate. A provider's redirect is a plain browser navigation carrying
no session, and a GET may not write; landing on the app means there is a
signed-in admin for the server to check the state against, which is what makes a
forwarded or replayed callback connect nothing. If you register the API host by
mistake it still works: that URL forwards to the app and stores nothing itself.

Two more, both optional: **`APP_URL`** on Railway if the app ever moves off
`www.stewardapp.dev`, and `*_API_BASE` only to point a provider at its sandbox
(a connected org now reaches the real API without one).

What Steward will ask each provider for is fixed in `shared/oauth.js` and a
request cannot widen it. Square is **five read-only scopes** and nothing with
WRITE in its name. Xero is `accounting.banktransactions` plus
`accounting.settings.read` (INT-PROD-1: Xero retired `accounting.transactions`
for new apps), which cannot read a contact, an invoice or a report.
