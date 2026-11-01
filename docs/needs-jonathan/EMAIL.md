## 0-EMAIL · THE TWO EMAIL TOOLS NEED THEIR APPS REGISTERED (2026-09-30)

INT-3 built both sides of Mailchimp and Constant Contact: the audience sync out,
the campaign activity and unsubscribes back in, the webhook, and the daily pull.
Each Connect button is greyed out and names the variable it is missing until the
app exists. Nothing about an org's own mail changes: Steward still never sends a
newsletter.

**Mailchimp** (a free account is enough to test).
  · Register an app: Mailchimp account → Extras → Registered apps → Register an app.
  · Redirect URI, on the APP and not the API, exactly:
    `https://www.stewardapp.dev/oauth/mailchimp/callback`
  · Railway variables: **`MAILCHIMP_CLIENT_ID`**, **`MAILCHIMP_CLIENT_SECRET`**,
    **`MAILCHIMP_REDIRECT_URI`** (set it to the URI above).
  · No app review, and no scopes to choose: Mailchimp grants a whole account and
    offers nothing narrower. The card says that plainly rather than implying
    Steward asked for less.
  · The webhook needs nothing from you. Steward mints a per-org secret when the
    connection is made and registers the URL itself.

**Constant Contact** (a developer account, free).
  · developer.constantcontact.com → My Applications → New Application, and choose
    the confidential ("Server") flow so it is issued a client secret.
  · Redirect URI, exactly: `https://www.stewardapp.dev/oauth/constantcontact/callback`
  · Railway variables: **`CONSTANT_CONTACT_CLIENT_ID`**,
    **`CONSTANT_CONTACT_CLIENT_SECRET`**, **`CONSTANT_CONTACT_REDIRECT_URI`**.
  · Scopes Steward asks for and cannot widen: `contact_data`, `campaign_data`,
    `offline_access`. Nothing there can send a campaign.
  · No app review for a developer account. Constant Contact has no webhook for
    contact changes, so unsubscribes arrive on the daily pull instead of the same
    day, and the card says so.

Neither is needed for the demo: Harborlight shows Mailchimp connected with three
campaigns and holds no credentials at all.
