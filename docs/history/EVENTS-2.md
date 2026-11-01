## EVENTS-2 — tickets people can buy, and the attendee side (2026-09-28)

EVENTS-1 built the hub and a public page that could not take a card, and said
so on the page and in the code: "a page that takes a card and does not
reliably finish the registration charges somebody for a seat they do not get."
This is the other half.

**The page takes a card, and it is the donation checkout.** `POST
/e/:slug/checkout` calls the same named `donateHandler` every gift goes
through, and a small shim turns its one success shape into a 303 to Stripe. It
is a plain form POST, so the page needs no JavaScript to take money. The
money settles in the org's own connected account, the server prices every line
from the level, and the gift carries the ticket's fair-market split so the
receipt states the deductible part. Apple Pay and Google Pay come with
Checkout; nothing was added for them.

**A seat is held for fifteen minutes, and a registration is confirmed only by
the webhook.** Capacity is registrations PLUS live holds, computed in one
place, so the page, the checkout and the staff registration cannot disagree
about what is left. An abandoned checkout reaches nothing: its hold runs out
and the seats are on sale again without anybody doing anything.

**The member price is the server's decision.** A ticket type may carry one; a
buyer gets it when the server itself finds a current membership on that email
in that org. The page never says which price applies, and a request claiming
to be a member changes nothing — the suite posts that claim straight at
`/donate` and watches it fail to move the price.

**The attendee's side.** A confirmation page that writes nothing and says
plainly when it is still waiting for the webhook rather than telling somebody
who has just been charged that there is no record of them. A ticket QR, add to
calendar in three formats, directions, and an email carrying the code as an
IMAGE URL, because no email client renders a `data:` URI. The ticket then
lives in the Events section of MEMBERS-2's "Your page".

**One code, one scanner.** The door reads a ticket or a member card through
`shared/passCode.js`. A member card is NOT a ticket, so scanning one never
invents a registration: it names the person, says whether they are on the
list, and lets the person at the door decide. A code signed for another
organisation is refused by name, not only by signature.

**The waiting list.** A sold-out ticket type takes a name instead of a
payment, and a place is OFFERED by a person pressing a button. Nothing is held
and nothing is charged: it is an invitation to come and buy, in order.

**What the build caught that was already live.** `registerForEvent` stamped
`gifts.event_id` only on a gift it wrote itself, so every ticket bought online
— where the webhook writes the gift and hands the id in — left its money
unstamped, and the event's raised figure counted nothing that had actually
been paid for on the public page. That is the whole of what this build sells.
`GET /events/:id/waitlist` answered 200 on another org's event id until the
tenant matrix said so. And `/e/:slug` was missing from `vercel.json`
altogether: EVENTS-1's public page has been unreachable from
www.stewardapp.dev since it shipped.

**Harborlight is a US organisation.** "Harbour" is "Harbor" everywhere in the
seed, the 5K is `/e/harbor-run` with `/e/harbour-run` redirecting through a new
`events.previous_slug` (a link on a poster is not the org's to take back), and
`fmtFull` names its locale: `toLocaleString(undefined, …)` takes the browser's,
and in half of Europe `$25.000` beside a dollar sign reads as twenty-five
dollars.
