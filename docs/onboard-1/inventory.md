# ONBOARD-1 · From signup to a useful Home: every step, before and after

How the click counts were taken: each "before" count is the clicks and form fields on a FRESH org, counted by
following the screen's code path (WelcomePage, Settings sections, DonorImport, Journeys, Connections) and the
walk on Riverbend. Typing in a field counts as one. A step that needs a person's judgement or credential is
marked **ask** or **click**, never **do**.

- **do**: setup does it on its own after the one Start.
- **prepare**: setup gets it ready, and a person's single click finishes it.
- **ask**: only a person can answer. Setup asks it as a card with a default already picked.

| Step | Where it lives today | Clicks before | Setup | Clicks after |
|---|---|---|---|---|
| Account | Close link → Stripe Checkout → `/signed-up` | 4 | not setup's (Jonathan's close link) | 4 |
| Org details (mission, website) | Settings → Organization (`PATCH /orgs/:id`) | 6 | **do**, from the website; a missing mission is **ask** | 0 |
| Branding (colour) | Settings → Brand kit / `PUT /orgs/branding` | 4 | **do**, theme colour or the site's most-used colour | 0 |
| Logo | Settings → Organization, upload | 3 | **do**, the image the site marks as its logo | 0 |
| EIN and receipt details | Settings → Receipts (legal name, EIN, address, signer) | 7 | **do** from the site; anything missing is **ask**; turning receipts ON stays **click** | 1 (turn on) |
| Funds | Finance → Funds, one form per fund | 3 per fund | **do**, the funds the file names, listed by dollars | 0 |
| Campaigns | Created by the import from the file's campaign column | 0 | **do** (through the import) | 0 |
| Import | Donors → Import, mapper, preview, confirm (two files = the workbook path by hand) | 12 to 20 | **do**; the Salesforce pair is joined by Contact ID; Closed Lost and other non-cash stages are left out by line | 0 |
| Duplicates | Donors → Data health | 2 to open, then one per pair | **ask** on the ready screen: review now or later | 1 |
| Already-thanked question | Inside the import (FIX-37) | 1 | **ask**, with FIX-37's default picked | 0 to 1 |
| Reconcile an old report | Reports → Old reports → check (RECONCILE-1) | 4 | **not done**: see "What it can't do" | 4 |
| Connections | Settings → Connections, one card each | 2 per tool + OAuth | **prepare**: a card per tool named or found in the file; the OAuth click is hers | 1 per tool + OAuth |
| Inbox | Settings → Connections → Inbox | 3 + OAuth | not setup's (CAPTURE-1's lane) | 3 + OAuth |
| Team | Settings → Team, invite form per person | 4 per person | **prepare**: names and titles from the site become prepared invitations; she adds an email and presses Send | 2 per person |
| Thank-you templates | Communications → Templates, from a starter | 5 | **do**, three drafts (one plus two variations) in her own words; nothing sent | 0 |
| Receipt template | Settings → Receipts | in "EIN and receipt details" | **do** (same fields) | 0 |
| Journeys | Journeys → New, preset or by hand | 6 per journey | **do**, three, every one paused | 0 (1 each to turn on) |
| Starter groups | Groups → Starters | 2 per group | **do**, four starters | 0 |
| Volunteer setup | Volunteers → settings, roles, shifts | 8+ | not done: no volunteer data in a donor file | 8+ |
| Home | `/dashboard` | 0 | **do**: "Steward is ready" is the newest readout row on Home's Thread | 0 |

**On the Riverbend/fixture org:** about 75 clicks and fields by hand before (12 to 20 for the import alone, two
files through the mapper). After: 3 to give the files, the website and the tools, 1 Start, and then only the
clicks that are hers by rule (an email and Send per invitation, Connect per tool, turning receipts and journeys on).
