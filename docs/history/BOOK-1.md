# BOOK-1 · The booking page books: everything on one screen (25 Nov 2026)

Jonathan on prod /book after ONBOARD-4: "cmonn now that looks shit." Reproduced on staging with Playwright: at
1440x900 the headline was 685px tall and the Book button's bottom edge sat at 2,102px (1280x800: 2,044px).

- **One screen** (`client/src/marketing/pages/book.jsx`, `booking/book.css`): two columns as the mockup, the card in
  its own column so no headline length can push it down; on a phone the card comes right under the headline (grid
  areas head / side / rest). Button bottom now 635px at both desktop sizes.
- **The card books.** Name, work email, organization, "Using today", then the next five weekdays and the intro
  call's open times, read by the server from Calendly's available-times API (`server/admin/sales/calendlyTimes.js`,
  GET /public/book/times, cached a minute). The event is found by its scheduling link, now `shared/bookingLink.js`
  (client config re-exports it). Book sends the form with her time: the deal lands first (as ONBOARD-4, plus
  `sales_bookings.slot_at` and "Picked Tue, Dec 1 at 10:30 AM Eastern" on the note), then the time is checked
  against the open times (a time not offered is refused, 409), and either Calendly's scheduling API books it
  (`CALENDLY_DIRECT_BOOK=1`) or Calendly's own page for that time opens in the card with her name and email filled
  in, for the last click. Without `CALENDLY_API_TOKEN` the card falls back to Calendly's whole calendar after the
  form, as before. Steward sends her nothing.
- **The quote** ships hidden (`showTestimonial: false` in booking/config.js); no name or organisation anywhere.
- **Nav**: "Pricing" reads "How it works" (same page) in the header, the drawer and the footer. **Photo**: an emerald
  circle with his initial until `FOUNDER_PHOTO` is set.
- The deal note now says only what she was asked (the old form's phone, donor count and file lines appear only
  when sent). The booking form no longer takes a file; a file sent before stays on its booking for onboarding.
- What the walk found: the founder's initial was invisible (the row's grey rule hit it); at 390 the fields stacked
  where the mockup keeps two columns. Both fixed.
