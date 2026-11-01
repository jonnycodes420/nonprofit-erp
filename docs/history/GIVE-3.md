## GIVE-3 · Giving pages that look like the org, and an editor that works (2026-10-25)

- **Where the preview and the page drifted apart.** The editor never drew the page. GIVE-EDIT-1's Details and
  Design modes drew `FormPreview`, a hand-built stand-in (a logo, the title, the amount buttons, a Give bar) that
  shared no code with `Donate.jsx`, so it showed "the header and two rows of amount buttons" whatever the page held.
  Now `Donate.jsx` takes a `preview` payload from `GET /giving-pages/:id/page/preview`, which is built by the same
  `givingPagePublicPayload` (routes/crm.js) as the public read, and the desktop pane renders it at 1280 wide, scaled.
  Layout is by container queries, so a 390 frame draws the phone page.
- **The draft's form counts only if it changed**, as Publish rules: the preview first called every unchanged
  one-step form "configured", and the suite caught it.
- **The logo crop was the square Uploader tile's `object-fit: cover`** ("arborl"). Square tiles are logos; they fit.
- **Goal bar** reads `numbers.campaignGiftTotals` by the page's campaign id, plus donors and days left.
- **Payments (Part 3):** Stripe Checkout, redirect, direct charge on the org's account, `payment_method_types` not
  pinned. No PayPal or Venmo button exists on the form; PayPal is a read-only giving source.
- `tests/give3-pages.test.js` is the build's one test.
