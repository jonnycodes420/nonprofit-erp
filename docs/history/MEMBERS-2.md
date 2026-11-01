## MEMBERS-2 — the member side, and one page for every supporter (2026-09-28)

Memberships were live on the staff side and could be bought online, and the
member had nowhere to go. Neither did the ticket buyer, the volunteer or the
fundraiser: each was heading for its own surface with its own link and its own
idea of what the organisation looks like.

**One page, at `/you/:orgSlug`.** A member, a ticket buyer, a fundraiser and a
volunteer all land on the same page and see exactly what they have. It is
server-rendered HTML on `shared/publicPage.js` — the shell the volunteer
sign-up and the event registration already wear — so it is one request, no
bundle, the org's own band, and 16px inputs that do not zoom a phone. The
volunteer's own page and the donor portal are SECTIONS of it now, and a live
`/volunteer/me?t=` link in somebody's inbox is exchanged for a session here
rather than opening a second page.

**A section with nothing in it does not render.** Not an empty state, not a
"you have no tickets" card — nothing. A member who has never volunteered
should not be told, on their own page, about a part of the organisation they
have no relationship with, and a page that is four empty boxes and one real
one reads as a page that is broken.

**Nobody ever has a password.** They type their email and a link arrives:
CSPRNG, hashed at rest, fifteen minutes, spent on arrival. Spending it mints a
thirty-day session in its own cookie, so a link forwarded on, or read out of a
mailbox next year, opens nothing. The token rides the URL FRAGMENT, which never
reaches a server log or a Referer header, and the GET it lands on writes
nothing at all: the page reads the fragment and POSTs it, and the POST is what
consumes the link. Known and unknown addresses get the same answer, always.

**The wall, and the one test.** A session is (org, person), and every query on
the page is scoped by both — from the session, never from the URL or a form
field. The one guard this build earned plants the three ways that could break
(another person in the same org, a person in another org, a spent or expired
link) and checks the rendered PAGE, because a page that 200s and prints the
wrong name is the failure worth catching. Verified able to fail: dropping the
cross-org check and loosening the gift query turned four assertions red.

**One QR for every door.** `shared/passCode.js`:
`STW1.<kind>.<org>.<id>.<exp>.<sig>`, HMAC-signed. A member card and (EVENTS-2)
an event ticket are the same string with a different kind, so there is one
scanner rather than two, and the second one is always the one that is out of
date on the night. The org is IN the signed body, so a code from another
organisation is refused by name and not only by signature.

**No second money path.** Renewing prices from the level through the existing
`?membership=` path. A recurring change goes to the donor portal's own routes,
which is where those Stripe calls live. Turning auto-renew off is the existing
`cancel_at_period_end`: the term already paid for runs to its end.

**It installs.** One manifest per org, `display: standalone`, and the thing on
the home screen is the ORG's — its name, its colour, its logo. One icon, an
SVG tile, `sizes: "any"`: declaring `192x192` for a logo whose real dimensions
nobody checked is how an installed app ends up with a blurred tile.

**What the wiring caught.** `gifts` has no `designation` column and
`recurring_subscriptions` has no `next_charge_date` — both were written from
memory of what those tables ought to hold, and both 500'd the page on the
first request by a person who actually had gifts. And `/e/:slug`, EVENTS-1's
public registration page, is missing from `vercel.json`: it is unreachable
from www.stewardapp.dev today. EVENTS-2 fixes that.
