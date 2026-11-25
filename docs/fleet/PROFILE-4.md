# PROFILE-4 · For the fleet

**Surfaces changed:** a person's profile (any Donors row → the record): the header (face, name, tags, the actions row,
the quiet "Donor since … · email · phone" line), the numbers strip (Lifetime, This fiscal year, Last gift, Last
contact), and the tab row, which now sticks to the top of the middle column with the person's small face and name once
the header has scrolled away. The right rail did not change.

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight, 1440×900.)** Donors → Margaret Chen. The white header from its top to the tabs is under
   about 185px; the name, two tags and the buttons (Log a touch, the icon buttons, More) share one row; under the name
   one line reads "Donor since 2016 · <email> · <city>"; under that one strip of four numbers with thin dividers, Last
   gift with its date beside it.
2. **(Read only.)** Same person: put the mouse over the timeline and scroll down. The header goes up with the page; the
   tab row stops at the top with "MC Margaret Chen" at its left and a light shadow, and all eight tabs (Activity to
   Files) are still in the row, without their counts; the rail does not move. Scroll back
   to the top: the small name disappears and the header is back.
3. **(Read only.)** Scroll down until the tab row is stuck, then click Giving, then Notes. Each time the tab row stays
   at the top and the new tab's first card starts just under it (no jump back to the header). Click Activity: same.
4. **(Read only.)** Click the Lifetime value in the strip: the rows behind it open and foot to the same total. Hover the
   label "This fiscal year": its sentence shows. Off the happy path: on a person whose Lifetime note is long ("Includes
   $… from your old system …"), the note ends in "…" and hovering it shows the whole note; the strip stays one row.
5. **(Read only, 390×844.)** Same person on a phone: back, the face and name with tags, the quiet line, the buttons, the
   numbers two by two, then the next move and Next step, then the tabs. No sideways scroll. The tab row does not stick
   on a phone (the page scrolls as one).
6. **(Needs a write: org_stagewalk.)** Add a person named "Bartholomew Featherstonehaugh-Pemberton Riding Trust" with no
   email or phone. The quiet line reads "Add email or phone" (it opens Edit record); the name wraps beside the buttons,
   the buttons stay right-aligned, and nothing overlaps. Add a phone: "Add email or phone" goes away.

**What could have broken nearby:** the rail's About ("Donor since" is read from the same `/people/:id` answer); the
More menu's position (it opens from the header's More button, which moved up); Log a touch, Note, Email, Task and Atlas
buttons; the Contact tab's "Add" (shares the `dp-contact-add` id with the header's link); tab counts; the profile's
Record a payment from the rail (switches to Giving: with the tab row stuck it should land just under it).
