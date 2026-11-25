# ONBOARD-4 · The website books a call (Part A)

**Why.** Jonathan, 23 Nov 2026: onboarding is a real commitment with a setup fee, so nobody signs up
cold on the website. The website closes nothing and shows no prices; its one action is Book a call,
and every org that signs does it after the call, through the close link. This is the door Mission
Increase's referred nonprofits arrive at from January.

**What Part A did.**
- **Public signup closed.** `POST /public/signup` refuses every body the same way (410,
  `signup_closed`, pointing to /book) and writes and sends nothing. The close link and everything the
  public door shared with it (plans, the Stripe price check, Checkout, the agreement, provisioning)
  are untouched. `SignupPage.jsx` and the old `/invitation` page (it quoted a founding price) are
  deleted; `/signup`, `/demo` and `/invitation` go to `/book` in the router and at the edge
  (vercel.json), keeping `?partner=`.
- **No prices on the site.** The price block is one line ("Pricing depends on the size of your donor
  file…") and Book a call; every hero has one button; FAQs and Terms no longer state a figure or
  "when you sign up". The included-features words moved to `shared/included.json` so the site can
  say them without bundling `pricing.json`. `client/scripts/no-public-prices.mjs` runs after the
  prerender and fails the build on a price; it reads the prerendered pages, the marketing bundle and
  the public app chunks. Rule: a setup-fee figure counts only near "setup", because $250 is also the
  IRS acknowledgment line in the glossary.
- **The booking page.** `/book`: the form, then the slots, behind one adapter
  (`marketing/booking/slots.jsx`, Calendly). It extends SALES-2's inbound path rather than adding a
  second: the booking is a deal sourced "Website booking" with its answers, the file and a task for
  Jonathan. Partner codes: `partners` (code, name, market, no commission), managed in Sales settings.

**Decisions made in the build.**
- The calendar is Calendly: SALES-1/2 name no booking tool, and the site already used it. The build
  first pointed at the old "New Meeting, 30 min" link; Jonathan then gave the "Steward intro call"
  event (20 minutes, Google Meet), kept as one value in `marketing/booking/config.js`.
- "Free" means an offer of Steward for free (Start free, free trial, months free). The free tools are
  free and still say so.
- The file limit is 3 MB, sent as a data: URL: SECURE-1 reads an anonymous body with the 5 MB parser
  only, and SECURE-2's field caps refused a bare base64 string over a million characters.
- Existing suites that drove the public door (pricing1-bands §2–§3, golden-journeys J11) now go
  through the super-admin close link, which builds the same Checkout; security §12 and sales2-inbound
  §7 assert the closed door.

**What the walk found and fixed.** The partner's "Recommended by" line ran into the Book a call
eyebrow on one line; a partner's name now takes the eyebrow's place. The calendar sat in the hero's
left column, too narrow to use; it has the page's width and the page scrolls to it.

**Planted defects, each red:** `ONBOARD4_PLANT=signupopen` (§1), `nopartner` (§3); §2's checker is
planted in the suite and is red on main's site (66 hits: the $199 line and Start free on every hero).
