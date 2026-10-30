# SWEEP-6 · the walk: giving pages, the donor side and the phone

Walked 30 Oct 2026 on the scratch stack (main at 2b4951a, after EDITOR-1), as Allie would and as her
donors would, on two orgs:

- **the walk org**: a fresh org with the real-shaped files imported in order (gift history 287, the
  dinner workbook 106, contacts 656, then the scrubbed guest list), connected to a local Stripe stub
  (checkout → signed webhooks → back to the page; nothing leaves the machine), with two membership
  levels, an upcoming event with a $75 ticket, and one monthly gift whose card failed.
- **the empty org**: a brand-new org with nothing in it and no Stripe.

Each screen at 1440 and 390. Flows driven end to end: a giving page from New giving page through the
editor to Publish, a $100 card gift on it (the upsell, three steps, Stripe, the thank-you), the org-wide
form, a membership signup, an event ticket, Update your card, a receipt with receipts on, and on the
phone Home, a profile, Tell Steward (Atlas), Snap a check and To confirm. Screenshots in the session
scratchpad (`walk-before/`, `flows/`, `walk-after/`, `vshots/`), not committed. Severity: **P1** wrong
number, data loss, sends or breaks; **P2** reads or looks wrong; **P3** polish. Status after the fixes
is at the end of each line.

No P1 was found. The money path is right: each gift was written once by the webhook through
`recordGift` (`system:stripe-webhook`), on the right page and person, the ticket and the membership
were each one row, and Home's "behind last year" figure moved by exactly the $235 the walk gave.

## Speed (PERF-1)

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 1 | Home on a phone (perf-app: slow 4G, CPU slowed to a Moto G Power) | Usable at 4.82 s, ready 4.37 s, against a 3 s bar. The phone is bandwidth-bound: ~315 KB of JavaScript plus ~60 KB of Home's data at 184 KB/s. Asking for the app's chunks earlier makes no difference (measured: preloads at 0.6 s instead of 1.4 s, ready the same). | P2 | half: the panels Home opens on a click (Tell Steward, Snap a check's sheet, Ask's answers, the figure breakdown, Your words, Plan a follow-up, What changed, pinned answers, customize the rail, the plan picker) and the What's new list now load when used. Usable 4.50 s, ready 3.85 s, JS 271 KB. Budget lowered 5 s → 4.8 s. The rest: defects.md |
| 2 | Home on a desktop | 600 ms. Meets the bar. | | 493 ms after |
| 3 | Giving pages on a phone (perf-giving: Story, simple, campaign, peer-to-peer, membership, event) | LCP 2.23–2.25 s, usable 2.17–2.23 s, 119 KB of JavaScript. Meets the 2.5 s bar. | | budget lowered 3 s → 2.5 s |

## The donor side

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 4 | Thank-you after a monthly gift | "A receipt will be sent to your email" on an org whose receipts are off. A one-time gift gets Stripe's own receipt (`receipt_email`); a monthly checkout does not, so the promise could be false. | P2 | fixed (the page knows whether a receipt would really reach the donor: receipts on and the mail gate open for a receipt, the same check the send makes) |
| 5 | Thank-you, Year-end template | The template's own words promised "Your receipt is on its way to your inbox" whatever the org's settings. | P2 | fixed for new pages (the template no longer promises it); pages already made keep their words: defects.md |
| 6 | Membership signup → back from Stripe | "Thank you! Your gift to Justin's Walk Place has been received … Ask a friend to give too": a membership read as a gift. | P2 | fixed ("Welcome. You are a member of …", Ask a friend to join, the membership link) |
| 7 | Org-wide form, no photo or logo | An empty block of colour the size of a photo above the headline. | P2 | fixed (nothing is drawn; the editor still shows the photo slot) |
| 8 | Org-wide form, giving pages, memberships | ALL-CAPS labels: the org's name, How often, Monthly amount, Designate My Gift (optional), Your Information, More ways to give. | P2 | fixed (sentence case, a size up) |
| 9 | Org-wide form | "Designate My Gift (optional)" and "Your Information" in title case. | P2 | fixed ("Where your gift goes (optional)", "About you") |
| 10 | Every giving page at 390 | Amount buttons 43 px, share buttons 33 px, the membership Join 41 px. | P2 | fixed (44 px) |
| 11 | New giving page | "Nothing changes for donors until you publish": a new page is live at its own link from the moment it is made (it is not listed anywhere). | P2 | fixed (the words say the page has its link from the start and edits reach donors on Publish); the model: defects.md |
| 12 | Org-wide form | Stripe is said twice: under the button and in the trust panel. | P3 | left: defects.md |
| 13 | Org-wide form | The org's name three times above the form (bar, eyebrow, "Give to …"). | P3 | left: defects.md |
| 14 | Giving page in the editor, Publish | The confirm says "Donors will see it immediately." and it is so. Meets the bar. | | |
| 15 | A $100 card gift on the new page | The monthly nudge, three steps, Stripe, "Thank you for closing the year with us." One gift, on the page, to a new person. Meets the bar. | | |
| 16 | A gift by bank account (ACH) | The form says Stripe's page offers a US bank account; the Steward side is the same webhook as a card. Stripe's own page and ACH's days-later settlement cannot be driven on the stub. | | not walked end to end |
| 17 | A receipt (receipts on) | Issued once, 2026-00001, $100 with $100 deductible, stamped by the webhook; the mail gate held it because the walk org's email is off. Meets the bar. | | |
| 18 | Update your card | The emailed link goes to Stripe's card page and back to "Card updated, thank you!". | P3 | the page shows for anyone who adds `?card_updated=true`: defects.md |
| 19 | Event page and a ticket | "$40 of this is what you receive on the night, so $35 is tax deductible", Buy and pay, Stripe, "You are coming, Walk." with the door code. Meets the bar. | | |
| 20 | Donor portal, portal off | "This page isn't available." and nothing else: no name, no way to give. | P3 | left: defects.md |
| 21 | /giving sign-in | "Your Giving" in capitals. | P3 | left: defects.md |
| 22 | Empty org, its giving link | "Not open yet. Fresh Start Trust's giving page isn't open yet." Meets the bar. | | |

## The phone (390)

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 23 | Home, a profile, Fundraising, the rail | ALL-CAPS labels everywhere outside Finance, Reports and Grants (SWEEP-5's open line): Keep · Year-end giver, Today, Monthly donors that need you, Lately, The ask, the rail's group names. | P2 | fixed (SWEEP-5's `.no-caps` rule on the app root: every CRM screen) |
| 24 | Phone header, Fundraising's tabs and part rows, profile tabs | 24–39 px taps (search 36, Email off 24, the bell 32, the part rows 26, tabs 34). | P2 | fixed (44 px) |
| 25 | Recurring | Ten "Not set": every Change this month row, the retention figure, Next charge and Total given. | P2 | fixed ("None", "None yet", "No date", "Stopped", "Paused", "No gifts yet") |
| 26 | Recurring | "$50 · 0 active sustainers · 1 at risk": the $50 is the at-risk one. | P3 | fixed ("1 sustainer · 1 at risk") |
| 27 | Recurring | A failed card is terracotta text on a pink band: red is for a destructive confirm only. | P2 | left: defects.md |
| 28 | Home | The figure's "?" sits between "$21,020" and "behind last year", breaking the sentence on a phone. | P3 | left (the open Figure line in defects.md) |
| 29 | A profile | "Log a call" wraps to three lines; the status chips and "+" are 20–29 px. | P3 | left: defects.md (PROFILE-2 is rebuilding the profile) |
| 30 | Home, the Thread | "Nov 1 / Due on": the date above its own label. | P3 | left: defects.md |
| 31 | Tell Steward (Atlas) | Opens over Home with the mic and the camera, says it keeps no recording. Meets the bar. | | |
| 32 | Snap a check, To confirm | "Nothing is logged until you tap, and nothing is sent to a donor", and with AI off it says the image is shown beside an empty form. Meets the bar. | | |
| 33 | Every screen above, both orgs, both widths | No sideways scroll, no "undefined", "NaN" or blank interpolation, no console error, no 4xx or 5xx (the local preview's missing Vercel analytics scripts aside). | | |

## After

`walk-after/` on the same orgs: lines 4–11, 23–26 read right at 1440 and 390, with no "Not set" and no
ALL-CAPS label on any screen walked and every tab and giving-page button at 44 px. The smoke walk's new
leg (`givingSideAndPhoneSayNothingWrong`) checks these mechanically on its own org.
