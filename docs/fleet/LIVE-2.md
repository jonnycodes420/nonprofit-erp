# LIVE-2 · For the fleet

**Surfaces changed:** every screen that refreshes after a save, delete or restore (the refresh is
now driven by what the server says it wrote, the `X-Steward-Changed` header on every write).
By name: Donors → the foot's "Trash (n)" link, Settings → Trash, Your Data's Trash link, Settings →
Imports' Trash link; the donor profile's About card (Household); every list and figure that
re-reads after a write (Donors, Team, the profile's header and tabs, Tasks badge, Fundraising,
Events, Volunteers, Groups).

**Clicks to try for the next three nights:**
1. *(needs a write, org_stagewalk)* Donors → tick one person → More → Move to trash → Move. The row
   leaves at once, and the foot's "Trash (n)" goes up by one without a reload. Then Settings →
   Trash → Restore that person: the Donors foot's count goes back down when you return, with no
   reload.
2. *(needs a write, org_stagewalk)* Open a person with no household → Giving → About → Household →
   Add → tick a second person → Group. The card names "The … Household" at once. Then, off the
   happy path: See who's in it → remove the second person → the card says "Not in a household"
   again, without a reload, and the Undo in the toast brings it back.
3. *(needs a write, org_stagewalk)* Two tabs. Tab 1: a person's profile, Giving tab, no household.
   Tab 2: Donors → Data health → a "same household?" pair including that person → Make a
   household. Within about a minute (the bell's poll) tab 1's card names the household, with no
   reload.
4. *(needs a write, org_stagewalk)* A person's profile → + Add Gift → $25 → Save. The gift list,
   the header's Lifetime and Last gift, and By year all move together. Then Delete that gift: all
   of them go back, with no reload. Donors → Team: the owner's total moves both times.
5. *(needs a write, org_stagewalk)* Profile → Add a note → Save: the note shows on Notes and the
   tab count moves. Volunteers → a volunteer → add a note: the same.
6. Off the happy path *(needs a write, org_stagewalk)*: Move to trash with the box "and their gifts"
   unticked on someone who has gifts: the button says "Nobody to move" and nothing changes.

**What could have broken nearby:** anything that hears the change channel
(`client/src/lib/changes.js`): the Tasks badge, Home's figures after a write, the profile's tabs,
Events' Raised, Volunteers' header, Groups' cards, Fundraising totals. A write that now names
fewer kinds than the old URL rule could leave one of those stale; a write that names more costs
only an extra read. Settings and editors that save (brand kit, templates) announce "org".

**Needs a write:** rows 1–6 (org_stagewalk only). Harborlight read-only check: open any profile and
any list; nothing changes there.
