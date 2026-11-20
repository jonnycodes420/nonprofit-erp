# For the fleet · FLOWS-20

Harborlight is read only. Every check marked **Needs a write** runs in **org_stagewalk**.

## Surfaces changed
- A person's profile: the task box in **Coming up**, the **Activity** timeline and the **Tasks** tab, and the task
  sheet's **Mark done**, for a call or meeting task: they open the **"The call with …" / "The meeting with …"** dialog
  (the Tasks page's own), not Log a touch.
- That dialog everywhere (Tasks page, Calendar, profile): when the person has a different next step open, it starts on
  **No next step** and says "Their next step stays: …".
- **Recent changes** (the clock icon / "See all" on an undo toast): a bulk touch is one line, "Logged "<title>" to N people.", with Undo.
- **Journeys**: the list's "N entered · N in it · N exited · N completed", a one-line definition under the list, and
  **How it is going** in the editor (same counts, same definition before the caveat).
- A person's profile → **Giving** tab when another org was signed in to in the same browser: a "switched to … in another
  tab" banner instead of "Donor not found".
- **Donors → Saved views** menu: "<view> (edited)" after a filter, chip or sort changes.
- **Donors → Filters → Touch titled**: "Type the touch's title." under the empty box, and "Recent:" titles to click.
- **Does this match your old system?** (after an import): an **Ask Jonathan** button beside Looks right.

## Clicks to try for the next three nights
| # | Where | Clicks | Right when |
|---|---|---|---|
| 1 | org_stagewalk (**Needs a write**) | Tasks → quick add "Call about the spring visit" for a walk person who has an open next step, today → open that person → Tasks tab → tick its box | "The call with <name>" opens (Reached them / No answer, How did it go?, What's next?). "No next step" is ticked and the line reads "Their next step stays: <that step>". |
| 2 | org_stagewalk (**Needs a write**) | Same dialog → type "She will come on the 14th" → Save and mark done | The task is done on the profile at once (no reload) and under Tasks → Done. The person's other next step is still open, with its day. No new "Follow up" task anywhere. Undo in the toast reopens the task. |
| 3 | org_stagewalk (**Needs a write**, off the happy path) | Another call task on a person → click its title → the sheet's **Mark done** | The same "The call with …" dialog, never Log a touch. Untick "No next step": the line reads "This replaces their next step: …". Cancel: nothing changes. |
| 4 | Harborlight (read) | Tasks page → tick "Call about the spring showcase" (Eleanor Whitcombe) → Cancel | The same dialog opens, then closes on Cancel; the task stays open. |
| 5 | org_stagewalk (**Needs a write**) | Donors → tick 3 → Log a touch → Event invite, title "Fleet invite F20" → Log to 3 people → wait 15 seconds → open Recent changes | The toast "Logged to 3 people" stays (60 seconds, holds while hovered). Recent changes lists **Logged "Fleet invite F20" to 3 people.** with Undo. |
| 6 | org_stagewalk (**Needs a write**, off the happy path) | Recent changes → Undo on that line → then the toast's Undo if still showing | All three touches leave all three timelines; the line leaves Recent changes; the toast's Undo says "That batch was already undone." |
| 7 | org_stagewalk (**Needs a write**) | Recent changes | Also lists **Logged "Test invite F20 repro" to 3 people.** (the build's own repro from Nov 20) until someone undoes it. |
| 8 | Harborlight (read) | Journeys → "New donor, first year": compare the list line with How it is going | The same four numbers in both (on Nov 20: 6 entered · 4 in it · 1 exited · 1 completed, where the list said 17 · 9 · 7 · 1). The line under the list and the panel's last paragraph both say counts are entries of people still on file. |
| 9 | Harborlight (read, off the happy path) | Journeys → land (it opens one) → at once click another journey → wait → read How it is going twice | It shows the journey you clicked, and both reads match. |
| 10 | Harborlight (read) | Fundraising → Lost & Found → Verity Underhill → Giving | By year and the fund breakdown load ($125,000, Gala Reserve 100%), no "could not be read". |
| 11 | Harborlight + org_stagewalk (off the happy path) | Tab 1: Harborlight, open Verity. Tab 2 (same browser): sign in as the walker. Back to tab 1 → Giving | Tab 1 shows "You switched to … in another tab. Reload to see it." and never "Donor not found". Reload: tab 1 is now org_stagewalk's Home. |
| 12 | Harborlight (read) | Donors → Saved views → pick a view → remove one filter chip (or change the sort) → open the menu → pick the same view | The menu reads "<view> (edited)" after the change; picking the view puts its filters and sort back. |
| 13 | Harborlight (read) | Donors → Filters → Touch titled → leave the box empty | "Type the touch's title." under the box; "Recent:" titles below (Harborlight: the org's recent batch titles, if any). Click one → Add filter → the chip reads it. Enter in the box adds it. |
| 14 | org_stagewalk (**Needs a write**) | Import a small file → "Does this match your old system?" → press Ask Jonathan (no figures typed) | Each year reads that it went to Jonathan, then "Jonathan has it…". Looks right still works. |

## What could have broken nearby
- **Tasks page** and **Calendar** import FinishSheet from its new home: finish a call there (and the email task's
  "The email to … is sent" step).
- Every page's reads now carry the tab's org: any 409 "switched to … in another tab" with only ONE org signed in is a defect.
- Recent changes still lists trash rows, skipped To confirm cards and people added today.
- Journeys' "Sending tomorrow" and the applied-journey toast re-read stats after Apply.
- Donors' Saved views: saving a view, deleting a view, a shared view.
