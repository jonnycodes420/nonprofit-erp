# HONEST-2 · For the fleet

## Surfaces changed
- Settings → Connections: every badge and the giving-source tiles (Example in a demo org; the Statement imports line)
- Finance → Money in · Stripe (the badge beside the heading)
- Settings → Connections → Stripe's Payments panel ("Stripe: <state>")
- Setup (/app/setup): the giving-source and QuickBooks steps ("<account> · <state>")
- The "?" help assistant's answer about a connection
- Settings → **Billing** (new section): plan, price, next charge, card, invoices, "Talk to Jonathan about changing plans"
- Settings → Account (Billing moved out), Settings → Team ("See your plan →"), the trial banner, the import "Reactivate", the record/seat limit dialog
- Settings → Atlas (the AI-off line), Settings → Giving Pages → Giving levels, Settings → Team → Invited, Settings → Major gifts
- Fundraising → Giving page editor (your organization's page): One-time and Monthly amounts
- Atlas thank-you drafts from a person's About note
- Public site: footer Terms, /legal/terms, /connections, /features, /crm, /volunteer, /agent, /why, /pricing and FAQ copy; help articles
- Public giving page and event page when not open yet

## Clicks to try for the next three nights
1. Harborlight (read only): Settings → Connections. Every connected card's badge reads **Example**, and its line starts "Example: connecting is off in the demo." No card says Connected or Working.
2. Harborlight: Finance → Money in · Stripe. The badge beside the heading is the Stripe card's word (Example), not "Connected".
3. org_stagewalk: Settings → Connections → Statement imports. "The last file was brought in N days ago." (never "brought in .").
4. org_stagewalk: Settings → Account. No Billing card there. Settings → **Billing**: the plan, the price, and "Talk to Jonathan about changing plans" (a mail link). Invoices say "No invoices: your plan was set by hand…" for a manual grant. Off the path: the old link `?section=billing` (and the trial banner's link) opens Billing, not Organization.
5. Settings → Team when every seat is used: "See your plan →" opens Billing. No click anywhere in the app opens /pricing.
6. org_stagewalk (needs a write): Settings → Giving Pages → Giving levels. Clear "Mid starts at", Save: "Mid starts at can't be blank…" under that field. Type 40 nines in Major (the box stops at 16), Save: "Major starts at has to be under $1,000,000,000." under it. No "Internal server error". Then put 1,000 and 10,000 back and Save: "Saved."
7. Settings → Atlas on staging (AI off, no key): "AI isn't set up on this Steward, so there is no switch to turn it on." and no link to Your Data.
8. Settings → Major gifts: the copy reads "Choose which tabs the Major Gifts page shows. …".
9. org_stagewalk (needs a write): Fundraising → Giving page editor for the organization's page, One-time amounts 25, 50, 999, 250, 500. Save the draft and reload: 25, 50, 250, 500, 999. The public page shows them in that order.
10. Public site: footer Terms → /terms ("Terms of Service", in effect). Open /legal/terms directly: it lands on /terms.
11. Public /connections: three groups, Connects, Bring in a file (Cash App, Venmo, Toast, Spreadsheets and statements, Donorbox) and Not available yet (on staging: Square, QuickBooks Online, Xero, Mailchimp, Constant Contact, and Gmail and Outlook when their keys aren't set). It should match what Settings → Connections shows the walker.
12. Public /features, /crm, /why: no "every feature on every plan", "nothing to unlock" or "Included on every plan".
13. A giving page of an org with no Stripe: the org's name, its mission line, "Opens soon" and the sentence. An event page with paid tickets and no Stripe: the same.
14. Atlas, AI on (prod CREO Arts Demo, read only): "draft a thank-you to <person whose About note starts with a label>". The draft names the person and carries the note's detail without "QA", "TEST" or "About:".

## What could have broken nearby
- Home's connection lines and Finance's QuickBooks line (same GET /connections); Setup's progress (setupRoutes "Open billing" now goes to Billing)
- Any screen that linked `section=account` for billing (Account still holds the setup door, DPA, BCC, voice and the org's email)
- The public giving page (Donate.jsx sorts the ladder when it reads it), the embedded form, the memberships page (same not-open answer)
- Atlas draft emails with AI on (a model draft that names nobody or carries a label now falls back to the template)
- The demo seed: placeholder films are gone, so the volunteer page and two email templates have no video block after the next re-seed

## Needs a write (org_stagewalk only)
Clicks 3 (only if no import exists yet), 6 and 9. Everything else is a read.
