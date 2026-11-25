# SENDS-3 · For the fleet

**Surfaces changed:** Atlas's answer under a list question (**Open list** now opens People; a new **Save as group**
beside it); People (Donors) list with a new line above it, "Showing the N people Atlas found for "…". Nothing was made
from them." with **Save as group** and **Show everyone**; a person's profile → Journeys rail → **Mark done** (now a toast
with Undo, and a Recent changes line "Marked done: <step> for <name>."); Recent changes (one line per tick or Done, not
two); Settings → Imports / the import receipt → **Undo this import** (the "Move them to the trash too" choice and the
"Remove them too" button now ask about receipts); the campaign and template editors' **Send me a test** (works with the
org's email switched off; a refusal says why); a person's rail → Contact → a phone marked wrong ("Marked wrong. Never
dialed or texted from Steward."); every email with a photo (sent as JPEG); pledge reminders (only when an installment is
past due).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Communications → Campaigns → a draft → Edit in editor → **Send me a test**. It goes
   (staging's mail capture gets "[Test] …" to the walker's address) though the org's donor and staff email are off. Press
   it twice: two tests, the campaign's counts do not move.
2. **(Needs a write.)** Ask Atlas "Who gave over $100 this year?" → **Open list**. People opens with the line "Showing the N
   people Atlas found for …" and exactly those people. Settings → Groups (or Groups): no new group. Back in People press
   **Save as group**: "Saved as the group <question> (<date>)." Press Open list again from Atlas, then Save as group
   again: the same group, not a second one. **Show everyone** clears the line.
3. **(Needs a write.)** Put a person in a two-step journey. Profile → Journeys rail → **Mark done**, type a line, Save:
   the toast reads "Marked done: <step>." with Undo and See all. See all: exactly ONE line "Marked done: <step> for
   <name>." Press Undo there: "<step> is open again. The step that opened after it is waiting again." Reload the profile:
   step 1 of 2 again; the timeline has no "Journey step: <step 2>" line and no "<step>: <your line>".
4. **(Needs a write.)** Tasks → tick a person's task, then open Recent changes from the toast: one line for it (was two
   for 30 minutes: the toast's and the server's). Untick from Recent changes: the line goes.
5. **(Needs a write, receipts on: may need Harborlight's read-only view instead.)** Import a small file of new people, give
   one of them a gift and a receipt, then Undo the import: the confirm lists that person under "activity since". Choose
   "Move them to the trash too": "1 receipt was issued to this person. Void it and move them to the trash?" and the
   button reads "Void the receipt and undo it". Choose Keep them instead: nobody moves, the receipt stays live.
6. **(Read only, Harborlight.)** Open a person whose phone is marked wrong (Data health → wrong numbers, or a file with a
   bad phone): under the number, "Marked wrong. Never dialed or texted from Steward."
7. **(Read only.)** Open any sent campaign or template preview with a photo: right-click the photo → open image: the
   address ends `?fmt=jpeg` when the stored photo is WebP, and the file is a JPEG.

**What could have broken nearby:** Groups (Save as group uses the same Groups routes); the People list's other filters
and Clear filters (a new `atlas` key in the address); Recent changes for refunds, touches and deletes (same panel);
Home's Done and the Calendar's Mark done toasts (now `listed`); journey drafts in Communications → Drafts (a draft of a
step that was undone is archived and comes back if the step opens again); every email with a page image (the URL gains
`?fmt=jpeg`); the pledge reminder job (fewer reminders: none without a past-due installment); Settings → Imports undo.

**Needs a write:** 1–5 in org_stagewalk. 6 and 7 are read-only.
