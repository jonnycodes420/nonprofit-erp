# FRESH-5 · For the fleet

## Surfaces changed
- **Donors list → Stage column**, for a person Steward placed in Lapsed.
- **Donor profile → header status (Current / Lapsed)** and **the Giving tab: gifts (Edit), pledges (× Delete), Undo**.
- **Donor profile → "Suggested one-time ask"** (the rail's next move, the scores card).
- **Donor profile → Conversations → ⋯ → Delete** (a call or touch): the list and Last contact.
- **Home → the setup card** (Hide / Show later): a refused save puts it back with the reason.
- **Fundraising → thank-you letters (PDF)**, **Printed letters → Mark these as sent / print**, **Brand kit → a letter's PDF**, **Upload a Word letter → preview**, **Major Gifts → the screening file**: each now goes through the app's one write path.

## Clicks to try for the next three nights
1. **Needs a write.** Donors → find a person whose Stage says **Lapsed** and whose last gift is over a year old → open them → Giving → the gift's **Edit** → set the date to today → **Save**. The profile's header leaves Lapsed. Click **← Donors**: the row's Stage says **Ongoing care**, not Lapsed, with no reload.
2. **Needs a write.** The same person → Giving → **Delete** that gift → confirm → **Undo** on the toast. The gift is back; the header and the list's Stage agree (Ongoing care, or Lapsed again if the gift was the old one). Off the happy path: Undo twice quickly; the second says it is already back.
3. **Needs a write.** A Lapsed person → **More → Record a pledge** → $900 → Save → **← Donors**: Stage says **Ongoing care** at once (it took about 4 s before).
4. **Needs a write.** A person with an open pledge and no gifts → the profile says **Suggested one-time ask: $<the pledge>** → Giving → **×** on the pledge → **Delete pledge**. The ask line no longer names that amount within a second and a half. Then **Undo**: it comes back.
5. **Needs a write.** A profile → Conversations → a call's **⋯ → Delete**. The call leaves and **Last contact** moves (to the touch before, or —). Then **Undo**: both come back.
6. **Needs a write.** The profile's task (**Add a task → Create Task**), note (**Add a note → Save the note**) and file (**Files → drop a file**) each show at once; and on Volunteers → Records, **Log shift** then **Remove** moves Recent shifts and the header's "hours given so far" both ways.
7. Printed letters → pick gifts → print / **Mark these as sent**: the gifts' "letter printed" marks and thank-you lists elsewhere on screen move without a reload.

## What could have broken nearby
- Anything that reads a person's **Stage** (`donors.stage`): Major Gifts' pipeline board and its columns, the Donors list's Stage filter and counts, Moves history (an automatic move "Auto: a gift in the last 12 months" is now written when a gift is edited or put back; and tonight's sweep writes it for people already stuck).
- The **after-change step** now runs when a pledge, call, task, next step, relationship, planned gift or file is deleted from the trash path or restored by Undo: groups by rule, Drift, scores and Insights may move a moment after those, as they do after a gift.
- The **letter and screening downloads** now re-read the open screens after them (they used to change nothing on screen); a slow Home or Donors list re-read after printing is the thing to watch.
