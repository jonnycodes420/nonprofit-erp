# HONEST-4 · Every connection proves itself with its last real activity

From Jarvis's competitor report of Fri 27 Nov (Section 4C, quick wins 2, 14, 17, 25) and HubSpot's Connected
Apps page, which shows a dot and a Last Activity date and leaves the status blank where an app has none.

- **The proof** (`server/connections/proof.js`): every card carries `proof` from its own rows: the last real
  activity in words ("Last gift read Nov 26, 2:14 PM", in the org's zone, from when Steward read the row) and
  what moved in 30 days. "Real" means not sample data and not a demo org. The card and its panel both show it.
- **Examples are not connections.** A demo org's connection, or one whose every row is a sample, gets the badge
  state `example` ("Example data"). It is never Connected and is left out of every count (`summarize`). The demo
  mailbox gets the same. File-only tools have no status word. The dot is emerald only when the badge says Connected.
- **Quiet is never Connected.** HONEST-3's badge trusted a passing check. A source quiet past its own rhythm now
  reads Needs attention, whatever its last check said (`badgeOf`).
- **The public status page** (W-1128-Integrations-N4: "Stripe gift sync Working at 100 percent" over example
  data). Its Stripe and giving-source lines say Working only over real activity in a real org in the last 14
  days, and each states its last real gift read. With nothing real to measure the line has no status word. On
  staging no non-demo org held a sealed source or a Stripe account (read by SELECT), so both lines were "up"
  over nothing. The stored history is repaired by `scripts/ops/honest4-repair.js` (dry run).
- **QuickBooks** (`server/finance/qboPause.js`): the headline is the waiting count and dollars, then each reason
  as its own sentence and a link to the control that fixes it (`flow.fixes`). A run in which nothing went and
  something failed is a failed try. Three in a row pause the hourly auto-sync, and the card leads with "Needs
  attention: paused after 3 failed tries on Nov 25". Only a person's Try again clears it. Nothing new sends.
- **The card updater**: Recurring Health always shows "Cards updated by the bank this year: N", even at nought,
  and each recurring gift's row shows its card and who last updated it, the bank or the donor
  (`server/give/cardLine.js`). `docs/decisions/recurring-and-stripe.md` now says exactly what Stripe's updater
  covers.
- **Zapier is listed as Zapier**: one line ("connect to 6,000+ apps") with what it triggers and does. Zapier, the
  Open API and webhooks share one "Build your own" group on the public list, as they already did in Settings.
- **Stripe's row** (F20): the connected Stripe card opened on "Set up Stripe" when the org held history but no
  account. A connected row now opens its proof and checks first, and only an unconnected row calls Connect.
- **Silent for N days**: the task froze the day count it was written with, so Givebutter read 69 days on Settings,
  68 on Home and 67 on the task. A stored sentence now names the day the source went quiet (`quietSentence`,
  `stored: true`); live surfaces count from the org's own today. A 30-day count that moved since the last check
  says why (`weekWhy.js` `monthWhys`).
- **Book a call** (W-1126-Integrations-03 and -05): the page showed five weekdays and fell back to Calendly's
  embed. It now shows three weeks, with Later dates for more. Each week is one Calendly request with its own cache
  entry, served stale while it is read again, and the first page is kept warm. A day with no times says so. When
  Calendly can't be read, the page says "Times didn't load. Open the calendar in a new tab" at once, and each
  failed read is logged with its status.
