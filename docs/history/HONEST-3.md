# HONEST-3 · A connection, a public page or a link only says what is true

Jarvis's lead for Fri 27 Nov: the connection badges ranked Tier 1 a third night, after HONEST-1 (one
`flow` per card) and HONEST-2 (the census, "Example" in the demo). The flow said what was flowing; it
never asked whether Steward could check the connection today. So badges said Working over panels that
said "example", "no sign-in held", "connecting turned off" or "auto-sync off", resting on a Nov 23 stamp.

- **Why the checks "stopped" after Nov 23** (read on staging by SELECT): they never ran for Harborlight.
  Its four sources hold no sealed credential (the demo holds none), and `processGivingSources` reads
  only sources with one. The Nov 23 15:26 `last_synced_at` was the staging seed writing the rows, and
  nothing kept what any check read.
- **One badge** (`server/connections/checks.js` `badgeOf`): Connected only with a sign-in held,
  connecting on and a check in the last 24 hours that passed; anything else "Needs attention · <reason>"
  (`reasonsOf`). GET /connections puts it on every card; the Settings card, the panel, FlowWord (tiles,
  Finance, setup) and the inbox card (`mailboxBadge`, GET /mailbox) all draw it.
- **The daily check** (`runConnectionChecks`, hourly; each org once a day): one `connection_checks` row
  per connection per run with what it read (seen in 30 days, this week, sent, waiting). The panel shows
  the last three; a source's History lists them with counts; the tile explains a weekly count that moved
  against the last check (`weekWhy.js`).
- **Nobody hears** (`alertReach.js`): the quiet sweep now emails the admin it assigns, through
  notifyUserOnce's gates (their "A connection stops working" and the org's staff email). When either is
  off, Home's line and the task say so. New orgs' first admin starts with the alert on (signup, the
  close-link webhook). Existing orgs: `scripts/ops/honest3-connection-alerts.js`, dry run.
- **Counts agree**: Square's review shows an unclassified item as "Not classified yet" and the summary
  names it (it showed the default class, so all six looked classified). The public connections list has
  Connects and "Import from a file", and no "Not available yet"; the features page lost Xero and QuickBooks.
- **Public pages**: the cause was not the seed. Harborlight's pages were seeded and open in the seed's
  terms, but a page opens only when the org can take a card, and the demo holds no Stripe. A demo org's
  giving and event pages are now drawn whole with an example line, and take nothing. A real org's closed
  page says "This page isn't published yet"; there is no opening date to promise, so "Opens soon" is gone.
- **Short links** (`server/public/shortLinks.js`): `/volunteer/<org>` opens the org's volunteer page when
  no opportunity owns the slug, `/event/<org>/<event>` opens `/e/<event>`, and an unknown slug says "We
  couldn't find that organization". The volunteer page's Share menu offers the short link.
- **Book a call**: the direct calendar link and the email line show at once; the frame loads lazily and,
  without word from the calendar in 5 s, the page says it is slow and points to the link.
