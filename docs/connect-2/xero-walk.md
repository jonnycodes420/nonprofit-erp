# Xero walk · connect a real Xero organisation in ten minutes

Status: built and tested against a stand-in built from Xero's published API (the Xero-OpenAPI
`xero_accounting.yaml` spec at github.com/XeroAPI/Xero-OpenAPI). It has not yet talked to a real
Xero organisation. Do this walk against the **Xero Demo Company**, because **Sync writes to Xero**:
every press creates real bank transactions in whichever organisation you chose.

## What Steward asks Xero for

- Scopes: `openid profile email offline_access accounting.banktransactions accounting.settings.read`.
  These are Xero's granular scopes. Apps created after 2 March 2026 must use granular scopes
  (`accounting.transactions` is refused with invalid_scope, which is what FIX-22 hit). The spec
  file still lists the broad scope; the granular split came from Xero's 2026 migration.
- `accounting.settings.read` reads the organisation's name and chart of accounts.
- `accounting.banktransactions` creates one RECEIVE bank transaction per gift. Nothing else is written.

## One-time setup (Jonathan)

1. developer.xero.com, My Apps, New app. Integration type: Web app.
2. Company or application URL: `https://www.stewardapp.dev`.
3. Redirect URI: `https://www.stewardapp.dev/oauth/xero/callback` (the APP, not the API host).
4. Copy the client id, generate a client secret.
5. Railway variables (names only): `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`
   (set to the redirect URI above). Leave `XERO_API_BASE` UNSET on Railway: it is the test
   stand-in seam, and setting it points every send somewhere else.
6. `STEWARD_CREDENTIAL_KEY` must already be set (it is, for the giving sources).

## The ten-minute walk

1. In Xero, open the Demo Company (top-left organisation menu, "Try the Demo Company").
2. In Steward as an admin: Settings, Connections, Books, Xero, Connect.
3. Xero's consent screen lists the two permissions above. Allow, and pick the Demo Company.
4. Back in Steward, choose the Demo Company when asked which organisation (a login can hold several).
5. Open the Xero card. Press **Read from Xero**. You should see:
   "Steward can read Demo Company (US): N income accounts and M bank accounts. It only read them;
   nothing was sent to Xero." The name proves the connection points at the right books.
6. Map: the bank account the money lands in, the fee account, and an income account for every
   fund and for "No fund named". Save. Until every fund has an account the card says which are
   missing, and auto-sync cannot be turned on.
7. Pending shows the gifts waiting (from the start date, real money only).
8. Press **Sync** once. In Xero: Accounting, Bank accounts, the chosen account, Account
   transactions. Each gift is one "Receive money" line, contact "Donations via Steward" (donor
   names go only if the org turns donor names on), reference = the Steward gift id, the gross on
   the fund's account and the processing fee as a negative line on the fee account.
9. Press Sync again. Nothing new appears in Xero, and Steward says the gifts are already there.

## Disconnect

Connections, Xero, Disconnect. Steward deletes its stored tokens and sends nothing more. Every
bank transaction already sent stays in Xero, and Steward's record of what it sent stays too.
To fully revoke, also remove Steward under Xero Settings, Connected apps.

## Not yet proven

- That Xero accepts an inline `Contact: { Name }` under the banktransactions scope alone, without a
  contacts scope. If the first Sync refuses with a contact error, that is the line to change.
- Auto-sync runs hourly once the admin turns it on and every fund is mapped; it has only run against
  the stand-in.
