# SWEEP-3 · the walk: Communications, thank-yous, receipts, campaigns and Going out

Walked 30 Oct 2026 on the scratch stack (main at 2b4951a, after EDITOR-1 and SWEEP-4), as Allie would, on two orgs:

- **the walk org** (`org_sw3walk`): a fresh org with the real-shaped files imported in order (gift history 287,
  the dinner workbook 106 linked to "Finding Joy Dinner" on Oct 17, contacts 656) and the scrubbed guest list.
  1,081 people, 315 donors, 427 with an email address, 236 givers. Three held emails were planted for Going out
  (a receipt held because receipts are off, one held for no mailing address, one for email being off).
- **the empty org** (`org_sw3empty`): a brand-new org with nothing in it.

Each screen at 1440 and 390: every Communications tab (Overview, Campaigns, Templates with Brand and Media
library, Audience, Analytics, Sequences, Your email tool, Drafts to review, Surveys), Settings › Automatic
email with every Preview, Going out (Next 7 days, Sent, Held), the top-bar chip, Journeys with a shape opened;
in the editor every template kind (thank-yous, receipt, year-end statement, the two welcomes, Update your
card, a campaign starter) in desktop, phone and dark, Send me a test (email is off, so nothing went), and
Quick edit and print; the New campaign gallery and builder with each audience. Screenshots in the scratchpad,
not committed: `shots/before/`, `shots/after/`, `shots/editor-before/`, `shots/editor-after/`,
`shots/campaign/`, `shots/journeys/`, `shots/clicks/`.

Severity: **P1** wrong number, data loss, sends or breaks; **P2** reads or looks wrong; **P3** polish.
The status after the fixes is at the end of each line.

Timings, cold navigation to settled, on the local stack: before, median 615 ms at 1440 and 609 ms at 390
(max 1.33 s, the Media library's first load); after, median 683 ms and 672 ms (max 1.05 s, Overview's first
load). The after run shared the scratch Postgres with other sessions' batteries, which hit its connection
limit during the run. Slow 4G was not throttled in this walk.

## Communications

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 1 | Campaigns · audience | **A campaign to "Lapsed" reached nobody.** The segment read the stage column, which nothing sets: 0 people, beside Audience's "Lapsing or lapsed 42". | P1 | fixed: it is the one lapse rule (`donorStatus.quietIds`), 140 donors of whom 42 have an email, the Audience tab's 42; the picker says "Lapsing or lapsed" |
| 2 | Campaigns · audience | **Known miss: counts and reasons add up.** They do: 315 donors = 247 no email + 68 not switched on; 1,081 = 654 + 427. But with Campaign emails on for Everyone the 68 still can't get it, because the campaign rule asks for each person's Always include. | P1 | counts checked; the rule goes to defects.md (a send rule, not a sweep's to change) |
| 3 | Campaigns · audience | "All donors" and "Donors" both offered: the same 315 people. "Major donors (>$10k)" when Major is the giving level in Settings. Stages as keys ("steward"). | P2 | fixed |
| 4 | Overview | "All donors 68 · Everyone who has given, and nobody who hasn't": 10 of the 68 have only pledged, and every count here is people with an email, which no line said. | P2 | fixed (the same sentence as Audience) |
| 5 | Overview | "None yet, Volunteers →", "None yet, Settings, under Organization →". | P2 | fixed ("None yet. They are kept in Volunteers →") |
| 6 | Overview, Campaigns | The mailing-address prompt and the "Everyone with an email" dot in terracotta; the open-rate and campaign-date reds. | P2 | fixed (brass and ink) |
| 7 | Campaigns | "+ New Campaign", "Total Sent", "Avg Open Rate" in Title Case; "START HERE" ALL-CAPS; New campaign in brass beside an emerald button. | P2 | fixed (sentence case, emerald, `.no-caps` on the area) |
| 8 | Campaigns | "doesn't need to be clever, a plain thank-you…" runs two sentences together; the address prompt for a non-admin read "…automatically ask an admin to add it". | P3 | fixed |
| 9 | New campaign gallery | Subjects "You are now a monthly giver, Margaret", "Welcome to your organization, Margaret"; the Thank-you read "Thank you for your gift of your last gift"; Year-end "Your giving so far comes to $0" beside a donor who gave. "New Campaign", "START FROM A TEMPLATE". | P2 | fixed (the newest giver's name, gift and total, the org's name; sentence case) |
| 10 | Templates | **Known miss: the preview greets "Dear Allie".** Confirmed on every template kind: the editor previewed as the signed-in staff member. Card subjects said "Thank you, Margaret". | P2 | fixed: the preview is the org's newest giver by default (Preview as yourself is still there), card subjects use the same donor |
| 11 | Templates | Two cards each for "Thank-you"/"Thank you", "Event invitation", "Volunteer thank-you"/"Volunteer thank you". | P2 | fixed (a designed starter with the same name as a listed card is not offered twice) |
| 12 | Templates · Brand | ALL-CAPS field labels (LOGO, MAIN COLOR, …). | P2 | fixed |
| 13 | Audience | ALL-CAPS table head. Counts: All donors 68 of 315, Major 1, Lapsing or lapsed 42, each footing to its rows. | P2 | fixed |
| 14 | Analytics | ALL-CAPS tiles. Empty state says what to do. | P2 | fixed |
| 15 | Sequences | Two sections: "New sequence… No sequences yet." then "Sequences + New Sequence… No sequences yet" again, with "The engine runs every hour. Trigger now →", a developer control that answered with a browser alert. "Edit Sequence". | P2 | fixed (the older list draws only when the org has older sequences; Trigger now is gone) |
| 16 | Sequences | "Use Eastern Daylight Time (America/New_York)": the zone's database name in a button. | P3 | left: defects.md |
| 17 | Your email tool, Drafts to review, Surveys, Media library | Meet the bar. | | |

## The editor (every template kind)

| # | Template | Miss | Sev | Status |
|---|---|---|---|---|
| 18 | Receipt | **Known miss: legal name, address, EIN, tax language, gift detail, signature.** The email printed "[org address]" for an org with no address. | P2 | fixed: left out, and the rail says "Your mailing address is not on file yet… Add it in Settings, Tax Receipts". The EIN and legal detail are on the attached receipt PDF (`renderReceiptPdf`), not this email; the email signs with the sender's signature, else the org's (FIX-57) |
| 19 | Year-end statement | The tax language said "unless this receipt says so" in a statement (the receipts rule: a year-end email is a statement, never a receipt). | P2 | fixed (the default reads "unless it says so here") |
| 20 | Thank-yous, welcomes, Update your card | Signatures differ: thank-yous sign with the org's name ("It is signed with your organization's name. Add your signature in My profile…"), the welcomes with the sender's account name. | P3 | left: defects.md |
| 21 | Quick edit and print | Previews the org's top giver; the email editor now previews the newest giver. Two people for one template. | P3 | left: defects.md |
| 22 | Desktop, phone, dark, Send me a test | Meet the bar. The test says "Email is switched off for this organization" and sends nothing. | | |

## Settings › Automatic email, Going out, the chip

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 23 | Automatic email · Preview | Every sample said "Your donation receipt from your organization… With gratitude, your organization" and "Hi Sam": the org's name was never passed. | P2 | fixed (the org's name and its newest giver's first name) |
| 24 | Automatic email | "Off since created" on every switch; ALL-CAPS group labels. | P3 | fixed ("Off. Nobody has turned it on yet") |
| 25 | Going out · Held | **Known miss: Held items say why and what to do.** They said why; only a missing address said what to do, and Send was offered while the org's email was off (the route refuses it). | P2 | fixed (each reason has its next step; no Send while email is off) |
| 26 | Going out | ALL-CAPS section labels. | P2 | fixed |
| 27 | Top-bar chip | At 390 it read "Email off" when only automatic email was off. | P3 | fixed ("Auto email off") |

## Journeys

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 28 | Journeys | "It never sends anything. Every step waits for you." A step can be set to send itself. | P2 | fixed |
| 29 | Journeys | ALL-CAPS "Journey settings", "Start from one of these". | P2 | fixed |
| 30 | A journey, opened from a shape | Steps, dates and the live preview on a real donor meet the bar. The "Journey emails are off" switch sits flush to the card's left edge. | P3 | left: defects.md |

## The same screens, empty

Every screen draws, says what to do next, and has no "Not set", no undefined, no placeholder and no console
error. "Nobody on file has an email address yet" on Overview; "Send your first campaign to see analytics";
"No journeys yet… Start from one of the shapes below".

## After

Walked again after the fixes on both orgs at both widths: no screen says anything the bar names, no ALL-CAPS
label, no console error that was not the shared Postgres refusing connections. The smoke-walk's new `§sweep3`
leg holds that (proven by planting "Not set" in Going out: four reds, nothing else).
