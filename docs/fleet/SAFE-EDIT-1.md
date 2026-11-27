# SAFE-EDIT-1 · For the fleet

## Surfaces changed
- Donors → **+ Add** (Add person): Save, Save and record a gift, Save and add another; the new "Already in Steward?" question.
- A profile → More → **Edit record**; Log a touchpoint; the follow-up task; Record a gift and the pledge form on Giving.
- Leaving any of those with changes: browser **Back** and every rail link now ask "Leave without saving?". Settings' section tabs ask the same, in Steward's dialog.
- A profile → **Household and related** (rail "Manage"): **Delete household**, **Remove <name> from household**, + Group into household → Create household.
- Donors list selection bar: **Add tag** and the new **Remove tag**, each with an Undo toast. A profile's tag chips (header and About) have an **×**.
- Donors list → saved views → **Delete this view** now asks.
- A profile → More → **Delete donor** (the "Move … to the trash?" dialog). Settings → **Trash** (its sentence).
- **Data health** ("Checked …, after people came back from the trash").
- Tasks → quick add (one task per Save).

## Clicks to try for the next three nights
1. Donors → + Add → type a made-up name → **double-click Save**. One profile opens; search the name: one person. *(write)*
2. + Add → a new name with the email of someone already on file → Save. "Already in Steward?" with **Open them** / **Add a new person anyway** / Back to the form. Back to the form: nobody is added. Open them: their profile. *(write)*
3. A profile → More → Edit record → change the name and employer → **browser Back**. "Leave without saving?" appears. **Keep editing**: the dialog and your typing are still there, the address is the profile's. Back again → **Leave without saving**: the list, nothing saved. *(write)*
4. The same with a rail link (Tasks) instead of Back. *(write)*
5. Edit record on someone whose phone reads like `617.555.0142` → change only the employer → Save. The phone reads exactly as before. *(write)*
6. Two made-up people → Household and related → + Group into household → pick the other → Create household. Keyboard focus is on the first member's row, not on a delete button. **Delete household** asks; Cancel keeps it. *(write)*
7. A three-person household → "Remove <name> from household" on one → Undo on the toast → all three again, in the open dialog. On a two-person household the button says the household is deleted too. *(write)*
8. Move both people of a household to the trash → Settings → Households/Reports: the household is not listed with 0 people → Settings → Trash → Restore one → the household is back with them; restore the other → both in it. *(write)*
9. Settings → Trash → Restore someone → Data health says "Checked …, after people came back from the trash". *(write)*
10. Donors → tick a few → **Remove tag** → type a tag they have → the toast says "Removed … from N people" → **Undo** → the tag is back on exactly those people (not on anyone who never had it). *(write)*
11. A profile tag chip → **×** → gone, toast with Undo → Undo → back. *(write)*
12. Save a view → Delete this view → "Delete the view …?" → Keep it: still there. *(write)*
13. A person with an open pledge → More → Delete donor: the dialog lists "1 open pledge ($… still to come)" and says "Restore in Settings, Trash". *(read until you press Move to trash)*
14. Settings → Trash: if anyone deleted before 9 Nov is still there, the sentence says they leave on 9 Dec; their rows say 9 Dec.

## What could have broken nearby
- Anything that adds a person through `POST /donors` (an event's typed guest, the Volunteers add): a missing key behaves as before.
- Every navigation goes through `navigateTo`: deep links, Atlas's links, the Fundraising and Major Gifts redirects, Back/Forward on any page (they should still move with no question when nothing is unsaved).
- The trash and restore of people (profile Delete, Donors list Move to trash, import undo's "Move them too", Undo toasts, Recent changes): households now move with their last member.
- Bulk tag's add answer gained fields; groups by tag rule re-check after a remove.
- The delete dialog's counts (`/donors/trash-check`) and the Trash sentence.

## Needs a write
Every check above but 13 and 14 writes: run them in **org_stagewalk**, never in Harborlight.
