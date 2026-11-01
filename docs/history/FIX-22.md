## FIX-22 · What the walks found (2026-10-03)

Muse's walks hit the rate limits twice, found an attachment that opened nowhere, and found Room to give half finished.

- **Limits.** Signed-in requests are limited per user (6,000 per 15 minutes), unsigned ones per IP (1,000, unchanged), and
  Ask why has its own 60 an hour per user (`server.js` signedInLimiter / generalLimiter / whyAskLimiter; `auth.js tokenUserId`).
  A 429 says when, in one sentence, and App's load screen says "One moment" rather than "Failed to connect". There was never
  a three-question cap on Ask why: the walk had spent the shared per-IP 1,000. A walk measured ~20 requests a screen, with
  no polling at all; `apiFetch` now shares identical in-flight GETs and keeps ten reference reads for 60 seconds (any write
  clears it), and the profile timeline stopped re-reading tasks and volunteer hours every time interactions load.
- **Attachments.** Not a FIX-20 door. Mailbox sync COUNTS attachments and never stores them (the sentence a person agrees to
  when connecting says so), and the promised link back to the message was never built. Now the count, and the Attachments
  filter, open the message in its Gmail or Outlook mailbox (`routes/finance.js mailFileOf`; Outlook keeps `webLink` from now on).
  Tenant matrix §11 checks every listed file opens for its org and 404s otherwise.
- **Groups.** The click that cleared the page did not reproduce on prod after FIX-21 (1440 and 390, four groups). A person's
  groups are one EXISTS-per-group statement (`groups.js membershipFlags`).
- **Room to give** sorts on the server (`opts.roomRanks` into `buildDonorFilter`, only for those who may see it); the demo
  gives most people an owner so "who knows them best" has names, checked by the seed (`checkKnowsBest`).
- **IRS, not ProPublica** (its terms forbid charging for access). `scripts/load-irs-bmf.js` loads the EO BMF into `irs_bmf`;
  nothing is fetched on render. Grants paid is gone (not in the BMF).
- **Small ones:** native confirms replaced by in-app Undo (deletes) or the in-app confirm (money, sends, irreversible);
  birthdays on the profile and Home (seeded now); a template-started campaign is pinned in the list; `/integrations` redirects;
  Xero Connect hidden ("Xero isn't available yet"); a video thank-you help article; signed-in /pricing goes to Settings, Billing.
