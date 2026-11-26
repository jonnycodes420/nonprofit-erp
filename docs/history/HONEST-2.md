# HONEST-2 · Badges, public pages and Settings only claim what's true, and no button loops or dies

Jarvis's lead for Thu 26 Nov graded Area 6 C: "badges still overstate what connections and public pages
actually do". HONEST-1 gave every connection one status (server/connections/status.js); this build found
the surfaces that still said a state of their own and made them read it.

- **The census.** Finance's "Money in · Stripe" said "Connected", the Stripe payments panel "Stripe
  Connected", the giving-source tile "Connected", the setup steps "Connected as", and the help assistant
  its own "healthy". Each now reads the card's flow (flowParts.jsx `FlowWord`, routes/support.js through
  connectionsFor). tests/connect2/honest2.js fails if a client file draws "Connected" or "Healthy" on its
  own, with a short allowlist that says why each exception is not a connection state.
- **Demo examples.** In a demo org every connection is made up and connecting is off. The badge says
  "Example" and the line opens "Example: connecting is off in the demo.", then keeps the example's story
  (the QuickBooks waiting line, the quiet Givebutter). OAuth start now refuses every provider in a demo
  org, not only mailboxes, so the sentence is true.
- **Statement imports** said "The last file was brought in ." on staging: `String(a Date).slice(0, 10)`
  is "Tue Nov 24". The day is now the org's own day from SQL.
- **The public site** kept a hand-typed connections table (LANDING-3) that drifted from Settings. It now
  reads GET /public/connections, built from the same registries and OAuth readiness as Settings, in its
  three groups. Footer Terms goes to /terms and /legal/terms redirects (as HONEST-1 did for Privacy).
  "Every feature on every plan" is gone from the site and the help articles. A not-open giving or event
  page shows the org's name, mission line and "Opens soon". The demo seed carries no placeholder films.
- **Billing.** App.jsx already sent people to `section:"billing"`, which did not exist, so Settings fell
  back to Organization: that was the loop. Billing is now its own section (the card moved out of Account),
  with invoices (server/billing/invoices.js, a GET that never creates a Stripe customer) and "Talk to
  Jonathan about changing plans". No in-app link goes to /pricing.
- **Drafts.** An About note's labels ("QA A1 About:") are taken off before a draft or the model reads it
  (shared/draftAbout.js cleanAbout), the template speaks of the note's names rather than quoting it, and
  guardDraft refuses a label-like prefix or a draft that names nobody.
