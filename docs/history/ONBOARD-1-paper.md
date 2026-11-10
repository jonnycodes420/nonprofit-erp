## ONBOARD-1 (paper and data in) · the start link and the verified import (2026-11-09)

(The brief reused the name ONBOARD-1; the earlier "Set up Steward for me" build is `ONBOARD-1.md`. This
build's branch is `onboard-1-paper`.)

**Why.** A customer counts when they are billing, and two orgs that were already using Steward (CKRH, the
Jessamine County Food Pantry) had no signed agreement and no card. BUILD-90's close link makes a NEW org, so it
could not finish the paper for an org that exists. And once a file came in, nothing proved to the customer that
it had arrived whole.

**Stage 1 · one link, signature and card together.** `POST /admin/orgs/:id/start-links` (super-admin, the
"Create start link" button on each org row in /admin) takes the contact, the price (the org's custom price or a
band), the first charge date (a fixed day, or 30 days from signing) and a note, and returns `/start/<token>`:
single use, 14 days, stored only as a hash. The page renders `legal/start-agreement.md` with the org's name, price,
date and cancel terms filled in, and sends back the SHA-256 of exactly the text it showed; the server refuses a
signature over any other text. The click-wrap row (`start_signatures`: name, title, email, time, IP, user agent,
version, hash and the text itself) is append-only by trigger. Then Stripe Checkout in subscription mode on the
org's existing customer with `trial_end` = the date, or setup mode at $0. A custom price rides on the band's own
Stripe product as an inline amount: no product or price is created or changed. The webhook reads the trial end off
Stripe (BUILD-90's rule) and stamps `orgs.paper_done_at` only when a signature AND a card exist.

**A latent defect it closed.** The day-minus-7 reminder and Settings → Billing quoted the BAND price for an org on
a custom price. A start-link org on $149 would have been told "$199". Both now quote `custom_price_cents` when set.

**Stage 2 · the staged import.** The one import door since HARDEN-1 is "Import a spreadsheet"
(`/sheet-import/commit`); the old mapper screen is not rendered anywhere, so the preview lives there. "Preview
first" is offered only for an org's first file (nobody live in it). The batch is hidden INSIDE the import's own
transaction: its people get `deleted_at` and `staged_import_id`, so every count and list that already leaves out a
deleted person and that person's gifts (FIX-54, HARDEN-1) leaves the batch out too, with no second filter to
forget. The surfaces that show the trash itself (the trash list, its count, Empty trash, "bring back") leave a
staged person out. If a file's gifts would land on people already live, a preview cannot hold them back, so the
whole import rolls back and says why. Undo before Accept is today's undo by run id. Accept clears both columns, runs
the after-change step, and stamps `orgs.data_in_at`; a super-admin accepting for the customer must type a reason,
shown on the record. "Something's off" stores a note on the import (`GET /admin/onboard/flags`).

**The Verify page** (`/imports/:id/verify`) foots the file against Steward to the cent: the file's own figures are
taken from the reader's plan inside the transaction (`server/onboard/sheetVerify.js`) and never recomputed, and the
gap is said by row (set aside by reason and line, already in Steward, pledged and not yet given). Funds, years and a
10-donor spot check (lifetime, last gift, gift count beside the file's rows) sit under it.

**What the truth check caught.** `surfaces-agree`'s source rule flagged `first_charge_on` (a DATE) being read
through a local-time Date. It now reads through `civilOf`.

**What it does not do.** It does not change prices, Stripe products or the thirty-day rule. It does not send the
link (Jonathan copies it). It does not build the onboarding board; ONBOARD-2 reads `paper_done_at` and `data_in_at`.
