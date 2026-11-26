# POLISH-13 · For the fleet

**Surfaces changed:** Donors (Everyone, Donors and Contacts tabs; Re-engage's badge and list), Home's people count,
the onboarding card's people count, Grants (Delete grant, and its Undo), a donor profile's Giving (Delete gift and
its Undo, and the timeline), Import (the confirm screen and the receipt after import), Settings → Imports (each row
and each receipt), Major Gifts (Top 100 table; direct load or refresh of /app/majorgifts).

**Clicks to try for the next three nights:**
1. *(Needs a write: org_stagewalk.)* Grants → New grant, funder "Walk Funder <date>" (a name nobody has) → Save.
   Donors → Everyone and Contacts each go up by 1. Move the grant to LOI, then Delete it: Everyone and Contacts are
   back where they were, and the Trash lists the funder. Press Undo: the grant and the funder come back (+1 again).
   Off the path: add a second grant for the same funder, delete the first. The funder stays.
2. Donors: Everyone = Donors + Contacts, and Everyone = Home's people count. Archive a person *(org_stagewalk)*:
   all of them drop by 1, Re-engage's badge equals the rows under it, and Unarchive brings the 1 back.
3. *(org_stagewalk.)* Add a person, record one $25 check. The timeline shows the gift and a "Send thank-you note"
   step. Delete the gift: the gift line, the step and its task are gone. Recent changes → Undo: all three are back.
4. *(org_stagewalk.)* Import a small spreadsheet. Before Import, the screen says "You can undo this import until
   <date 30 days out>." After Import, the receipt says the same date, and so do Settings → Imports and that row's
   receipt. Off the path: an import older than its window says "The window to undo this import closed on <date>"
   and has no Undo button.
5. Major Gifts at 1440 wide with Top 100 on: the table scrolls sideways inside its card, Plan reads in full, and
   the Name column stays put while you scroll. With Top 100 off, refresh /app/majorgifts: it opens on Pipeline
   (it used to open Portfolios).

**What could have broken nearby:** anything that reads /donors/summaries (Re-engage, Map, the touch picker,
the call list); these now leave archived and erased people out. Fundraising and Home money figures still keep
archived people's money (THREAD-3), and that is unchanged. Grant removal of any grant, and gift Undo.

**Still OPEN (re-check on prod after Ship):** Settings → Brand kit and My profile at under 1 s (0.2–0.96 s on staging).
Atlas list questions under 5 s and "Who should I call tomorrow?" under 8 s with the AI switch on (staging has it off:
0.2–0.4 s). A full refund retiring the thank-you. The Gala Reserve fund on a confirmed check.
