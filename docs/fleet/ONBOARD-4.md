# ONBOARD-4 · For the fleet (Part A)

**Surfaces changed:** the public website (every hero, the closing call to action, the Pricing page,
FAQ, Home's price block), the new Book a call page (/book), /signup, /demo and /invitation (now go to
/book), Lost & Found's buttons, Log in's "No account?" link, Terms §4; /ops → Sales → Settings →
Partner codes; /ops → Sales → a deal → Booking panel.

**Clicks to try for the next three nights:**
1. www (staging) Home → the hero's Book a call. Right: /book opens; no "Start free" or "Start now"
   anywhere on Home; the Pricing section reads "Pricing depends on the size of your donor file…" with
   no dollar figure.
2. Open /pricing. Right: no dollar figure, no band, no setup-fee amount; one Book a call.
3. Type /signup?partner=nobody in the address bar. Right: lands on /book?partner=nobody with no
   "Recommended by" line (an unknown code shows nothing).
4. (Needs a write, org_stagewalk's partner code) /book?partner=<a code made in Sales settings>, fill
   the form with a made-up name and a small CSV, Next: pick a time. Right: "Recommended by <name>",
   then "Thank you. Now pick a time below…" and the calendar under it. Do not book a slot.
5. Off the happy path: on /book type "not-an-email" as the work email and submit. Right: the browser
   or the page refuses; nothing lands in Sales.
6. (Needs a write) /ops → Sales → the deal from step 4. Right: source "Website booking", the Booking
   panel shows the answers, the partner and market, and the file downloads; a task "Booked a call
   from the website…" due today.
7. Lost & Found: run the audit on a sample file. Right: the end buttons say "Book a call about this
   file" and open /book.

**What could have broken nearby:** close links and Settings → Billing (they still read
GET /public/pricing and the plans); the Pricing page for a signed-in org (Change your plan in
Settings); SALES-2's inbound (demo request, Lost & Found lead, partner referral pages); Terms page.

**Needs a write:** steps 4 and 6 (org_stagewalk only; never Harborlight).
