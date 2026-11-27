# FRESH-4 · For the fleet

**Surfaces changed:**
- Every screen that shows a number or a list now reads again after any save in this browser tab or another tab on the same organization. This matters most on Donors (the list's Lifetime and Last gift), Home, the donor profile, Finance, Fundraising and Volunteers.
- Home's header: the organization's name.
- Communications → Templates → the email editor: a ready-made block such as Event invite, taken out with ✕.
- Donor profile → Volunteer tab → Can give → Edit, with Hours a week emptied.
- The donor profile's Engagement and Generosity card (the scores) just after a gift, a touch or hours.

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Donors → Record a gift → pick someone on the first page → $41 → **Save and add another**. With the dialog still open, look behind it: that person's Lifetime in the list moves within a second.
2. **(Needs a write.)** Settings → Organization → Edit the name → Save, then click Home in the sidebar. Home's header shows the new name with no reload. Put the old name back the same way.
3. **(Needs a write.)** Communications → Templates → First gift welcome → Start from this → Blocks → Event invite. Save. Click the invite's photo, press ✕: the toast says all 4 parts are out. Save, go back to Templates, open it again: no part of the invite is left. Off the happy path: after the ✕, press Undo in the editor and all four parts come back together.
4. **(Needs a write.)** A volunteer's profile → Volunteer tab → Can give → Edit → empty Hours a week → Save. Steward asks "Clear hours a week?". Keep it: nothing changes. Do it again and choose Clear it: the line drops the hours.
5. **(Needs a write.)** A donor's profile → More → Record a pledge → $300 → Save. The pledge shows in Giving, and the Engagement and Generosity card is right straight away, not a few seconds later.
6. Open the same donor in two tabs. Record a gift in one; the other tab's figures move within a second. Hide the second tab first and show it again: it catches up when shown.

**What could have broken nearby:**
- Any screen open during a save makes a few more requests now: Home, the profile and the Donors list each read again once per save. Watch for a slow screen or a flicker on Home and the profile right after a save.
- Bulk actions on Donors (bulk delete, merge) re-read the list as before.
- The email editor's Undo and Redo around a ready-made block.
- The profile's Engagement and Generosity card on a 25,000-person org right after a gift: it is computed for that one answer.

**Needs a write:** checks 1 to 5 run in org_stagewalk, never in Harborlight.
