## INT-3 — Mailchimp and Constant Contact, and Steward still never sends (2026-09-30)

The premise is that she keeps paying Mailchimp and keeps sending from it. Steward
reads the one thing the tool knows and the CRM does not: who opened, who clicked
and who asked to stop. `shared/emailMarketing.js` holds all of that judgement
once, and the two providers are registry entries: Mailchimp's own word is
"audience" and Constant Contact's is "list", Mailchimp's token never expires and
Constant Contact's lasts a day, Mailchimp pushes unsubscribe webhooks and
Constant Contact has none. None of those differences reach the judgement.

**NO SECOND OPTED-OUT FLAG.** BUILD-94 already owns the opt-out truth
(`email_suppressions` plus `do_not_email`, read by `donorMailDecision`), so an
unsubscribe arriving from Mailchimp is written by BUILD-94's own
`recordUnsubscribe`, published out of `routes/webhooks.js` for the purpose. Two
flags would eventually disagree and the half that lost would mail somebody who
asked to stop.

**A BOUNCE IS NOT AN UNSUBSCRIBE, and the one test caught it.** Mailchimp's
`cleaned` means the mailbox stopped working; the first draft wrote it as an
`unsubscribed` suppression as well, which puts "she asked to stop" on a donor's
record about somebody who never said it, and outranks the bounce in every later
reading. `unsubscribe` writes the suppression, `cleaned` writes unreachable, and
neither writes the other.

**The order of a sync is the safety.** Opt-outs come IN before the push goes OUT.
Reversed, somebody who unsubscribed an hour ago is read as eligible, pushed back,
and only then read as unsubscribed. Mailchimp's upsert uses `status_if_new` for
the same reason: sending `status` would re-subscribe an existing contact, which is
the one thing this build must never do. And when Steward and the tool disagree,
the MORE RESTRICTIVE answer wins, never the newest.

**FIVE DEFECTS ONLY THE BROWSER WALK FOUND**, four of them things the screen said
that were not true:
· The Mailchimp card read "the last gift through it arrived 17 days ago, 3 gifts
  so far". `assessConnection` decides the STATUS for every connection and that
  shared judgement is right, but its SENTENCES are about money and Mailchimp has
  never carried a gift. The status still comes from the shared layer; the words
  are counted from campaigns. This is the FIX-9 A.3 mistake in a new place.
· Opening the mapping panel turned the demo's healthy card BROKEN, and left it
  there. A connection with no stored credentials cannot be asked anything, and
  Steward declining to call out is a state, not an incident: a 409 or 503 refusal
  no longer records `status='error'`.
· The same panel then said "Mailchimp reports no audiences on this account yet",
  which sends somebody into another company's settings to fix nothing. "Steward
  could not ask" and "there are none there" are different sentences now.
· The Sent column printed `$0` for every campaign: `fmtFull` is a MONEY
  formatter, so a date rendered as nothing, and `$0` also reads as a campaign
  that raised nothing.
· The gifts column counted every gift the organisation took within thirty days
  and put "131 gifts, $149,715" beside a newsletter. A footnote cannot outrun a
  number that big. It is scoped to the people who opened or clicked THAT
  campaign, which is the honest version of "a gift after a click".

**A figure that opens onto fewer rows than it claims must say why.** Mailchimp
counts 188 opens; Steward can name the ones whose address belongs to somebody on
file. Opening 188 onto three rows does not foot, so the drill-down says both
numbers, and the gap is itself worth knowing: it is how many people are on her
list and not in her CRM.

Also: `accessTokenFor` wrote a rotated token to the bookkeeping or giving table
only, so a Constant Contact refresh would have changed no rows, silently, and
locked the connection out at the next renewal. Three kinds, three tables, one
switch. The daily pull rides the existing tick; Mailchimp's webhook secret lives
in the URL because that is the only verification Mailchimp offers, and a wrong
one gets the same flat 200 a good one does so the path cannot be probed.
