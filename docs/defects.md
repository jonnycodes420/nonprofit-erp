# Defects found and not fixed

One line each: where, what, severity (P1 wrong number, data loss, sends or breaks; P2 reads or
looks wrong; P3 polish), which build found it, and the build it belongs in. A build that fixes
one deletes its line.

## Communications (SWEEP-3, 30 Oct 2026; walk in docs/sweeps/sweep-3/walk.md)

- **P1 · A campaign reaches only people set to Always include, even with Campaign emails on for Everyone.** `donorMailDecision` (routes/email.js) refuses kind `campaign` unless `donors.auto_email` is true (SEND-GATE-1), while SEND-GATE-2's rule for a type set to Everyone is "anyone not set to Never". On the walk org with Donor mail and Campaign emails on for Everyone the builder still said "315 donors · 0 can get this email: 247 have no email address, 68 have automatic email off". Who a campaign reaches is a sending rule, so it needs Jonathan's word on which rule is meant, then the real-shaped check and the truth check. Suggested: SEND-GATE-3.
- **P2 · A campaign merge with no gift reads "your gift of your previous gift".** `legacyCampaignBody` (server.js) fills `{{gift_amount}}` with "your previous gift" for someone with no gift, and the Thank-you starter says "Thank you for your gift of {{gift_amount}}". The preview now shows a real giver's gift; the send's fallback is a send change. Suggested: SEND-GATE-3, with the starter's sentence.
- **P3 · Thank-yous and welcomes sign differently.** The one-person thank-yous sign with the org's name when nobody has a signature in My profile or Brand; the designed welcomes sign with the sender's account name. Suggested: the next editor build picks one rule.
- **P3 · Quick edit and print previews the top giver; the email editor previews the newest giver.** Same template, two people. Suggested: the next editor build.
- **P3 · "Use Eastern Daylight Time (America/New_York)".** The Sequences timezone button shows the zone's database name (`zoneLabel`, shared with Settings). Suggested: the Settings sweep.
- **P3 · The Journey emails switch sits flush to the card's left edge** on an open journey. Suggested: the next Journeys build.
- **P3 · Campaign list subjects outside the builder still use the sample "Margaret".** `subjectPreview` in the legacy sequence preview (Communications.jsx) has no donor to fill. Suggested: the next editor build.

## Events and pledges (SWEEP-4, 29 Oct 2026; walk in docs/sweeps/sweep-4/walk.md)

- **P3 · Two tile looks on After the event.** White figure tiles (Raised … Gave) above cream buttons (Invited … Sponsors) on one card; First-time givers and Sponsors open rows but are not `<Figure>`s with a source. Suggested: EVENTS-3.
- **P3 · Check-in draws every guest on the event page.** 195 rows under the door search; the search is the door, the list could fold. Suggested: EVENTS-3.
- **P3 · The open-pledge banner and the Next move repeat each other.** Both list the same installments on the profile. Suggested: the people sweep.

- **P2 · An event's people figures count persons; the Finding Joy key counts guest-list rows.** The combined workbook's key says 443 people, 172 attended, 104 gave, 77 came and gave, 95 came without a gift; Steward makes a couple's row two people, so the event page, Home's Grow card, Fundraising and Ask say 252 came, 149 gave, 122 came and gave, 130 came without a gift (each opens to exactly the key's rows; money matches the key). Decided in FIX-60: an event's people figures count giving units (a household once), as the ladder does; not built in FIX-60's time. The plan is in FIX-60's report: `numbers.eventGuests` groups by `COALESCE(household_id, donor id)`, the four `event-*` sources open one row per unit, the Events list counts, the truth check's event truth, and the suites built on couples as two (fix59-event-import, fundraising2-screens, import5 §6, sweep4, real-shaped §FJ asserts the key directly). Suggested: EVENTS-3.

## Finance, Reports, Grants (SWEEP-5, 29 Oct 2026; walk in docs/sweeps/sweep-5/walk.md)

- **P3 · Budgets' revenue variance reads backwards and in red.** Variance is budget − actual for both sections, so revenue ahead of a $0 budget reads "-$1,750" in red and revenue $39,250 short reads "+$39,250"; "over budget" and an over line are red, which is for a destructive confirm only (overdue is brass). Found by FIX-60's walk. Suggested: FIN-2.
- **P3 · Budgets' projected year-end straight-lines a one-off.** One $1,200 expense in month 3 of a fiscal year projects to $3,600 "over budget". Found by FIX-60's walk. Suggested: FIN-2.
- **P3 · Grants · Reports: "AWARDED, FY 2026–27" broke across two lines at 1440.** Sentence case shortened it and neither walk org had a grant to draw it after the fix. Suggested: the next Grants build looks with a grant on file.
- **P3 · Phone, Reports: the rail is a select.** Each report opens by its own URL on a phone and costs 0.6 to 1.7 s locally; not throttled to slow 4G in this walk. Suggested: PERF-3 measures Reports at 390 on slow 4G.
