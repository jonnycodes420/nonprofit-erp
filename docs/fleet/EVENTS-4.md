# EVENTS-4 · For the fleet

**Surfaces changed:** Events → an event's page: the header date (a one-day event is one date), the Archive/Delete
button (now with a line under it: "Has 1 guest, so it's archived, not deleted."), a new **Tickets and sponsorships**
card under The public page, The public page card's sentence (a free ticket opens the page), Check-in (search finds
invited and waiting-list guests by name or email; the walk-in part has an email box), and Auction (an item with a
recorded winner shows "Winner recorded. To change it, More > Remove winner." instead of Record the winner; saving a
winner has an Undo). Fundraising → Tickets & sponsors (the same Tickets and sponsorships card; "Price (0 = free)").
The public event page `/e/<slug>` (open with a free ticket and no payments; a paid ticket says "Tickets go on sale once
payments are connected."; the free registration's thank-you page). Volunteers → Schedule → a shift's drawer (**Delete
shift** when nobody is on it, **Remove shift…** when people are; "Delete draft" is gone). Volunteers → Check-in (the
shift picker and the board name a shift by its own label, then its opportunity). The address `/app/events/<id>` (now
opens the event).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk, which has no payments.)** Events → New event → a made-up name, one date, no end
   date → open it. The header shows that one date, not "date – date". Scroll to Tickets and sponsorships → Ticket,
   name "Supper place", Price 0, Places 10 → Add: "Supper place is free: people register with no payment, and no gift
   is recorded." The row reads "Free · registers with no payments; no gift is recorded · 0 of 10 taken".
2. **(Needs a write.)** Same card → Ticket "Patron", Price 60, Value received 20 → Add. The row reads "$60 · worth $20,
   so $40 deductible · on sale once payments are connected". The public page card now says it is live for the free
   tickets. Edit the page → give it an address → open `/e/<address>` signed out: "Supper place" shows **Free** and a
   Register form; "Patron" shows "Tickets go on sale once payments are connected." and no form; nowhere does the page
   say "Not open yet".
3. **(Needs a write.)** On that public page register for Supper place as a made-up person, 2 places: "You are
   registered for <event>." Back in Steward: the guest list shows them Registered ×2; Gifts on their record: none;
   the event's Raised stays $0; Check-in shows "0 of 1 checked in"; tap them: "In", "1 of 1".
4. **(Needs a write.)** Off the path: Guest list → Add Guest → a made-up name and email (invited only). Check-in →
   type their name: they appear with "Invited, not registered"; tap to check them in. Then type a new name, put that
   invited person's email (in capitals) in the walk-in email box, press Add: no second person is made (search People
   for the name: one record).
5. **(Needs a write.)** The event from step 3 → the button under the header reads **Archive event** with "Has <N> guests,
   so it's archived, not deleted." under it; press it: the Archive dialog. Cancel. A brand-new empty event reads
   **Delete event** with "Nothing on it yet, so it can be deleted."
6. **(Needs a write.)** The event → Volunteer team → Add a shift (17:00 to 19:00). Volunteers → Schedule → open that
   shift (published) → **Delete shift**: gone at once, with Undo in the toast; press Undo: it is back. Sign a made-up
   person up, open it again → **Remove shift…**: the dialog names them ("<name> is signed up. Their sign-ups are
   cancelled with it…") → Remove → Undo: the shift and their sign-up (Confirmed) are back.
7. **(Read only, Harborlight.)** Volunteers → Check-in → the shift list: a shift with its own name shows that name
   first, with its opportunity in brackets, then the day and time.
8. **(Needs a write.)** The event → Auction → New auction → an item → Record the winner → a person with an email, 120
   → Save: the toast has Undo, and the item shows "Winner recorded…" with no Record the winner. Press Undo: Record the
   winner is back. Second press of Undo: there is none.
9. **(Read only.)** Sign out, sign in, paste `/app/events/<an event id>`: the event opens (the address becomes
   `/app/events?event=<id>`).

**What could have broken nearby:** Fundraising → Tickets & sponsors (the card moved into a shared component; Register
someone and the guest list there are unchanged). Paid checkout on an org with payments (`/e/<slug>/checkout`; a free
ticket on such a page registers instead of going to Stripe). The ticket confirmation email (not sent for a free
registration). Remove selected on Volunteers → Schedule (a shift with people now cancels their sign-ups, and the
confirm says so). Recent changes (a removed shift's Undo). The kiosk's live count (still Registered, not invited).
Journeys on "they win an auction item" (one recorded winner per item now).
