# LIST-6 · For the fleet

**Surfaces changed:** People (Donors) → Directory: the search box's placeholder ("Search name, email, phone or
household"), Clear filters (now beside + Add filter whenever any filter is on, Owner alone included), + Add filter →
Notes or tags, the chip "Notes or tags: 'gala'", the Giving strength column and its hover, Saved views (Update "…" and
Save as new on an edited view; the view's id in the address as `?sv=`). Re-engage, Team and Map: no Filters bar of
their own any more; they show "Filtered: N filters from the Directory · Clear" and only the people the Directory's
filters (search included) match. A person's profile: the score card's "Generosity" is now "Giving strength", and the
role line under the name reads "Contact" for someone with no gift and no other role.

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight.)** People → Directory. Hover the Giving strength of the second row: it reads "Giving
   strength N of 100: Lifetime giving … of 30, Last 24 months … of 30, …". Open that person: the score card's Giving
   strength is the same N (Alaric Applewhite read 81 on the list and 77 on the profile before this build).
2. **(Read only.)** Pick an Owner. "Clear filters" shows beside + Add filter. Add any chip (City is Nowhere: 0 people
   match). Press Clear filters: the address is `/donors` with no `owner=`, the Owner select reads All owners, and the
   count is back to the full Donors count. Off the path: press Clear filters with only a search typed: the box empties.
3. **(Read only.)** + Add filter → Notes or tags → contains "gala" → Add filter. The chip reads "Notes or tags: 'gala'"
   and the rows are exactly the people with "gala" in their notes, About or a tag (search the same word in the main box:
   it does not find notes, and its placeholder no longer says it does). Then open Re-engage and Team: each says
   "Filtered: 1 filter from the Directory" and lists only those people; Clear there empties the Directory's filters too.
4. **(Needs a write: org_stagewalk.)** Pick an Owner, Saved views → Save this view… → name it. Change the Stage: the menu
   reads "(edited)" and two buttons show, Update "<name>" and Save as new. Press Update: still one view of that name
   (Saved views lists it once). Copy the address (it holds `sv=`), go to Home, paste it: the list opens on that view
   with its Owner and Stage. Off the path: Save as new with a new name gives a second view; Delete this view removes
   it and the address loses `sv=`.
5. **(Read only.)** Open someone on the Contacts tab who has no gift (Everyone → Contacts). The line under their name
   reads "Contact", never "Donor".

**What could have broken nearby:** everything that reads the People list's address (a link from Home or the Pipeline
with `?stage=`, a household's link `?household=`, an import's "See the people it brought in" `?import=`, Back from a
profile): each should land on the list with that one filter on, and Clear filters should take it off. Export CSV and
Save these filters as a group (same filter object). The call list draft (reads the stored score now). Re-engage's tab
count when a filter is on. Anything that shows person roles (`person_types`): a never-giver marked Donor no longer
carries "donor" on GET /donors and GET /donors/:id.

**Needs a write:** check 4 only (org_stagewalk). Checks 1, 2, 3 and 5 read Harborlight and change nothing.
