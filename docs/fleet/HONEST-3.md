# HONEST-3 · For the fleet

**Surfaces changed:** Settings → Connections (every card's badge: Connected, Needs attention · reason, Not connected,
Not available yet; the Gmail and Outlook card too). Each connection's panel under Manage or Fix (its badge, a new
**Last three checks** list, the "last check" figure). Connections → a source's **History** (daily checks with counts).
Settings → Connections → "Where giving comes in" → **Connects directly** tiles (badge words; "No sign-in held, so
Steward can't check it"; a weekly count that moved says why). Square → **What the register sells** (summary and
Review). Home's connection line and the quiet-connection task (a line when nobody will be emailed). The public
**Connections** page on the website (two groups). Public giving page `/give/<org>`, event page `/e/<event>`,
`/volunteer/<org>`, `/event/<org>/<event>`. Fundraising → a volunteer page → **Share**. The **Book a call** page (`/book`).

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight.)** Settings → Connections. Every connected card (Stripe, PayPal, Givebutter, Square,
   QuickBooks, Mailchimp, Gmail and Outlook) reads **Needs attention · example data, …**; none reads Connected,
   Working or Example. Open QuickBooks (its button): the panel's badge is the same words as the card, and
   **Last three checks** lists dated lines like "Nov 28 · 0 sent in 30 days, 288 waiting · needs attention
   (example data, no sign-in held, …, auto-sync off, nothing sent yet)". Come back the next night: one more line.
2. **(Read only, Harborlight.)** Connections → PayPal → Manage → **History**: a "Daily check:" line per day, each with
   counts. "Connects directly" → PayPal tile: "No sign-in held, so Steward can't check it, N new gifts this week";
   if N moved since the last check, it says why ("Down from 9 at the Nov 27 check: 2 from Nov 20 are now more than a
   week old."). Never "checked just now".
3. **(Read only, Harborlight.)** Connections → Square → Manage → "What the register sells": the summary names the
   unclassified item ("5 items mapped, 1 not classified: <item>."). **Review**: that item's row says "Not classified
   yet"; the others show their class. The count in the summary equals the rows showing "Not classified yet".
4. **(Read only.)** Home with a quiet connection (Harborlight's Givebutter): under its line, "Steward isn't emailing
   anyone about this: email is off in the demo." **(Needs a write: org_stagewalk)** in a real org with staff email
   off, the line reads "…because staff email is off. Turn it on in Settings → Notifications."
5. **(Read only, no sign-in.)** Open `/give/harborlight` and `/e/harbor-run`: the mission, suggested amounts and the
   made-up EIN; the run's name, Jan 30 2027 and North Shore Path; a line "This is an example page in the Steward
   demo…". Press Give / register: the page says the example line and nothing is taken. Off the happy path: open
   `/give/<a real org with no payments>`: "This page isn't published yet", never "Opens soon".
6. **(Read only, no sign-in.)** `/volunteer/harborlight` lands on Harborlight's volunteer page.
   `/event/harborlight/harbor-run` lands on the Harbor Run page. `/volunteer/no-such-org-xyz` and
   `/event/no-such-org-xyz/x` say "We couldn't find that organization". **(Needs a write: org_stagewalk)**
   Fundraising → the volunteer page → Share: the link is `/volunteer/<org>`; the embed code still uses the full address.
7. **(Read only, no sign-in.)** `/book`: before anything else loads, "Open the calendar in a new tab. Or email
   jonathan@stewardapp.dev…" is on the card. Fill the form → Next: the calendar frame has the same link above it; if
   the calendar hasn't drawn in 5 seconds, "The calendar is slow to load…" appears. Don't book a time.
8. **(Read only, no sign-in.)** The website's Connections page: two groups, Connects and Import from a file. No
   "Not available yet" group; Venmo, Cash App and Donorbox are under Import from a file only.

**What could have broken nearby:** Finance → Money in (Stripe word), the Stripe payments panel and the setup steps
(all read FlowWord, now the badge's words). The help assistant's connection answers (still the flow). The quiet-sweep
task title is unchanged; only its notes are new. Membership pages read `/org/<org>/public?memberships=1` (unchanged).
The p2p progress bars (ProgressBar moved to giveParts.jsx). Opportunity links `/volunteer/<opportunity>` still win
over an org with the same slug.

**Needs a write:** steps 4 (second half) and 6 (Share) in org_stagewalk only. Everything on Harborlight is read only.
