# Constant Contact · connecting a real account in ten minutes

CONNECT-2, 11 Oct 2026. Steward reads three things from Constant Contact: who unsubscribed, which
campaigns went out, and who opened, clicked or opted out of each. It never sends an email through
Constant Contact, and it adds nobody to a list unless the organisation turns adding on.

## Once, before the first organisation (Jonathan)

1. Sign in at https://developer.constantcontact.com and open **My Applications**, then **New Application**.
   Choose the server flow (authorization code with a client secret).
2. Redirect URI, exactly: `https://www.stewardapp.dev/oauth/constantcontact/callback`
   (the app, not the API host: the provider's redirect carries no Steward sign-in).
3. Generate the client secret and set three Railway variables on the API service:
   `CONSTANT_CONTACT_CLIENT_ID`, `CONSTANT_CONTACT_CLIENT_SECRET`, `CONSTANT_CONTACT_REDIRECT_URI`
   (the URI above). Nothing else is needed: `STEWARD_CREDENTIAL_KEY` already seals the tokens.
4. Scopes Steward asks for, fixed in `shared/oauth.js`: `contact_data campaign_data offline_access`.
   `offline_access` is what returns a refresh token; the access token lasts a day and Steward renews
   it five minutes before it expires.

## Connecting an organisation (on the call, about five minutes)

1. Sign in to Steward as the organisation's admin and open **Connections**.
2. On the **Constant Contact** card press **Connect**. Constant Contact's own sign-in opens; sign in
   with the organisation's Constant Contact login and approve.
3. Back on the card, choose the **list** to keep in step. Leave **Also add people from Steward to this list** unticked. Press **Save and read**.
4. Later reads: press **Read now** on the card, or wait for the daily read.

### What you should see

- The card reads **Healthy**, with the time of the read.
- A sentence such as "3 campaigns read back, 12 unsubscribes brought in, 15 records updated."
  If Constant Contact sent a contact with no usable address, the sentence ends
  "1 row from Constant Contact had no usable address and was skipped." The read still finished.
- Communications shows the campaigns with sends, opens and clicks, each opening its people.
- A donor who opened or clicked has one line on their timeline ("Opened October letter, clicked
  the link"). Reading again does not add a second line.
- A donor who unsubscribed in Constant Contact now has Steward's email opt-out: no Steward donor
  mail reaches them, the same opt-out a Steward unsubscribe link sets.
- Nobody new appears in Steward. An address on the list that is nobody in Steward is ignored.

If the card reads **Broken** with "Constant Contact no longer accepts Steward's permission",
press Connect again; nothing already read is affected.

## What Steward never does

- It never sends a campaign. No scope it holds can.
- It never re-subscribes anybody. Constant Contact's guide says its create-or-update call
  (`POST /contacts/sign_up_form`) can turn an unsubscribed contact back to explicit permission, so
  even with adding turned on, Steward never offers the tool an address the tool reported as
  unsubscribed in the same read, and never offers anybody opted out in Steward.
- Unsubscribes arrive on the daily read (Constant Contact has no webhook for contact changes), or at
  once when somebody presses Read now.

## Disconnecting

On the card press **Disconnect**. Steward forgets the tokens and stops reading. Every campaign,
timeline line and opt-out already read stays. To also remove Steward's access on Constant
Contact's side, the organisation revokes it in Constant Contact under its connected apps.

## Docs used (read 11 Oct 2026)

- OAuth server flow: https://developer.constantcontact.com/api_guide/server_flow.html
- Contacts collection: https://developer.constantcontact.com/api_guide/contacts_get_collection.html
- Create or update a contact: https://developer.constantcontact.com/api_guide/contacts_create_or_update.html
- Campaigns: https://v3.developer.constantcontact.com/api_guide/email_campaigns_overview.html
- Email reporting overview: https://v3.developer.constantcontact.com/api_guide/email_reporting_overview.html
- Opens report: https://developer.constantcontact.com/api_guide/email_summary_opens_report.html
- Clicks report: https://developer.constantcontact.com/api_guide/email-reporting/email-reporting-clicks
- Opt-outs report: https://developer.constantcontact.com/api_guide/email_summary_optouts_report.html
- Campaign activity stats: https://developer.constantcontact.com/api_guide/email_campaign_activities_stats_report.html

## How it is tested

`tests/connect2/constantcontact.js` (part of `tests/connect2-sources.test.js`) runs against a local
stand-in built from those response shapes, reached through `CONSTANT_CONTACT_API_BASE`.
