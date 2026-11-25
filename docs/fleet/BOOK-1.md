# BOOK-1 · For the fleet

**Surfaces changed:** the public **Book a call** page (/book): one screen, the booking card beside the headline,
the next five weekdays and open times, "Book <day> at <time>", the last-click calendar inside the card; the site
header, mobile drawer and footer link **How it works** (was Pricing, same /pricing page).

**Clicks to try for the next three nights:**
1. **(Read only.)** Open /book at 1440x900 and at 1280x800: the Book button is on the first screen without
   scrolling. At 390 the card is right under the headline, then Jonathan's name and the three ticks. No quote shows.
2. **(Read only.)** The header and footer say "How it works"; it opens the same page Pricing did. No price anywhere.
3. **(Needs a write: it makes a sales deal; use made-up details, a /book?partner=<test code> link.)** Fill the
   card, pick a day and a time: the button reads "Book Tue, Dec 1 at 10:30 AM" (your day and time). Press it: the
   card shows Calendly's page for that exact time with the name and email filled in (or "You're booked." if the
   scheduling API is switched on). Do not press Calendly's own Schedule. On /ops the deal is "Website booking" with
   "Picked … Eastern" in its note and the partner tag. Off the path: pick a time, then a different day: the button
   goes back to "Pick a time above" until a time on that day is picked.
4. **(Read only.)** If the card shows "Next: pick a time" with no days, live times are not configured on that
   server (no Calendly token): the form then opens Calendly's whole calendar in the card.

**What could have broken nearby:** the sales CRM's Website booking deals and their note; the partner code eyebrow
("Recommended by …"); ONBOARD-4's "file from booking" (new bookings carry no file); the marketing header on every
public page (one label changed); the no-public-prices build check.
