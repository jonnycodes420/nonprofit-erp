# HONEST-1 · A connection only says Connected when something is flowing

From the 25 Nov sweep (root cause D). "Connected" answered whether a key was on file; a person reading it
asks whether anything is flowing. Stripe read Connected and Healthy with its giving pages off; QuickBooks
read Healthy with nothing ever sent and 273 gifts behind two unmapped funds; Givebutter had been silent 66
days with no Home line and no task, because nothing scheduled `sweepQuietConnections` (docs/defects.md P3).

- One status per connection, computed once: `server/connections/status.js` (`flowOf`), applied to every
  card by `server/connections/honest.js`. The card builder moved out of routes/give.js unchanged into
  `server/connections/cards.js`. Settings' card, its detail, the summary line, Home and Finance read `flow`.
- The quiet sentence is one function (`quietSentence`) for the card, Home and the task. A money door with
  too few gifts for a rhythm is quiet after 14 days (`QUIET_FALLBACK_DAYS`); the email tool keeps 120.
- The sweep runs every six hours for live orgs, opens one task per incident, and sends no email.
- QuickBooks: campaign accounts are optional (a campaign's gift lands on its fund's account), so the status
  names only what holds gifts back: unmapped funds and a missing deposit account. The checklist lists
  campaigns as optional rows rather than calling them blockers.
- Mailchimp's "not connected" came from the audience list call on a connection holding no sign-in (the demo
  holds none by design); it now says so.
- PayPal's History read import runs only; the status read `last_synced_at`. History now includes that check.
- Privacy: /legal/privacy (the attorney draft, no Google Limited Use text) redirects to /privacy.
