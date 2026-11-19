# For the fleet · FLOWS-19

What changed on staging with FLOWS-19, and what each re-check should now show. Harborlight is read only; any write goes in org_stagewalk.

**Re-baseline (W-1118-Donors-09, not a build):** the one person who moved from Contacts to Donors is **Meridian Foundation** (FLOWS-18 item 3: anyone with a counted gift is a donor; $55,000 on file, roles `donor, other`). Read on staging Nov 18: Everyone 1,232 · **Donors 1,185 · Contacts 47**. Use these as the new baseline.

## Surfaces changed
- Communications → New campaign: every starter card's sample person and gift (Thank-you, Monthly giving, Year-end…); the editor's preview person; "Send me a test" read as a person.
- Recurring giving → the roster (the Canceled and All statuses filters, the Next column).
- Journeys: a Paused journey's people (the Thread, Tasks, the profile timeline, Calendar's journey steps, What's going out, automatic journey emails); Paused's sentence in the journey list; applying a paused journey as a plan from a profile.
- Journeys → a journey's stats → Steps skipped (the "step N" on each row).
- Donors → Re-engage: a new line under Lapsed/Lost & Found saying how the count moved since the last day Steward kept, and who.

## Clicks to try for the next three nights
| W-ID | Clicks | Expect when right |
|---|---|---|
| W-1118-Fundraising-T1 | Communications → New campaign; read the Thank-you card | "Hello <name>, Thank you for your gift of <their last real gift>…": never a refunded gift. If the card names Silas it reads $5,801, never $25. The card, the editor (Use this →) and the saved draft name the same amount. Off the path: open Monthly giving and Year-end too, and Send me a test as that person (org_stagewalk): same person, same gift. |
| W-1118-Finance-24 (needs a write: org_stagewalk) | A donor → Giving → add an offline monthly plan; Recurring giving shows it; cancel it from the profile; Recurring giving → filter Canceled, then All statuses, search the name | The plan is listed as **Canceled**, Source "Offline · recorded by staff", Next column "Canceled <date>". MRR drops by its amount and the sustainer count by one. Off the path: a card plan cancelled reads the same way; the Active filter shows neither. |
| Area 1 Explore 8 (needs a write: org_stagewalk) | Journeys → a two-step by-hand journey, Running; apply it to one person (step 1 opens); Pause it; on the person, mark step 1 Done | No step 2 opens: no new Thread or task, no "Journey step:" line, nothing in What's going out. Resume it: step 2 opens at once. Off the path: while paused, Apply and the profile's apply-a-plan both refuse ("…is paused. Turn it back on in Journeys…"). |
| W-1115-Fundraising-32 | Journeys → Birthday card → stats → Steps skipped | Every row reads "Entered <day> · step 1, Mail a birthday card" (the journey has one step). The two old rows still read "Reason not recorded (before Nov 16)": that is history and stays. Any new skip has its reason. |
| W-1118-Donors-T6 | Donors → Re-engage (read the line under Lapsed / Lost & Found) | From the day after this build reaches staging: "N more/fewer than <day>: <Name> crossed 12 months without a gift on <day>…" or "The same N as <day>." On the day it arrives it says "Steward keeps who is on Re-engage each day; tomorrow this says who moved since today, and why." The N is the Re-engage badge's. Anyone named "for another reason" is a finding: report it with the name. Off the path: with Directory filters on, the line hides (it explains the whole count). |

**On Margaret Chen's Birthday-card rows (Area 1 Explore 8):** every entry (Margaret Nov 12, 14, 17; Verity Underhill Nov 13; Silas Inglewood Nov 18) was the walk's own: staging's audit log shows Dana Reyes resumed the journey, applied it by hand, stopped the plan and paused it again each night. They are stamped "Steward (journey)" because every journey write is; that label is next brief's. None was the runner.

## What could have broken nearby
- Home and Communications sample previews (one fill now: `previewPerson.js`); a segment with nobody yet still previews "Margaret".
- Recurring giving's MRR, "N sustainers" line and At risk queue (must not count a cancelled plan); the donor profile's Giving tab offline plan.
- Running journeys: steps should open exactly as before; the auto-send tick; the birthday and anniversary sweeps; Calendar's journey items.
- Re-engage's badge, Lapsed and Lost & Found counts (unchanged rule; the line reads the same condition).

## Needs a write
Finance-24 and Explore 8 above: org_stagewalk only.
