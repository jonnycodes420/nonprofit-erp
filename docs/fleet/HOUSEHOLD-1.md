# HOUSEHOLD-1 · For the fleet

**Surfaces changed:** Major Gifts → **Top 100** (a household can hold a place: its name with both photos and
"Household", both first names, Lifetime and the new **This year** column added for both people, Wealth Score with
"household" under it, Log a touch logs to both; "Add the household instead" after adding one of a couple; the count
line says places, households and people). **Donors** list (the **Show households together** switch beside the
count; a household row with Lifetime and This year and "Show 2 people"; the count line "N rows: H households and P
people on their own"; the **Everyone / For email / For calls / For a mailing** picker beside Export CSV). The Donors
**CSV export** (new Household, Addressee and Contact preferences columns). A person's record → rail **Household and
related → Manage** (each person's own card with email, phone, preferences; Address; Combined giving by year; Open
asks; Next step; **Log a touch with the household**). A person's record header (**"This record was merged from two
people"** with **Split them back into a household**).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Donors → Add two made-up people with the same last name, each with an email and
   phone; record a gift on each. Open one → rail Household and related → Manage → Group into household → pick the
   other → save. Major Gifts → Top 100 → Add someone: type the first one's name → pick them. The line "They are in
   The … Household. Add the household instead" appears; press **Add the household instead**. Right: one row named
   for the household, both photos, Lifetime = the two gifts added to the cent; click Lifetime: the drawer lists both
   people and its total is the same figure.
2. **(Needs a write.)** On that Top 100, type the other person's name and pick them. Right: "Added 0 … 1 already on it
   through their household", and no new row. Press × on the household's row: it comes off and the ranks close up
   (off the happy path: pressing × twice must not take off the row below).
3. **(Needs a write.)** Donors → tick **Show households together**. Right: the couple is one row with both photos and
   "Show 2 people"; the count line says households and people separately. Press Show 2 people: both rows appear with
   their own emails. Reload the page: the switch is still on. Untick it: one row per person, the count is people.
4. **(Needs a write.)** With the switch on, search the first person's name, pick **For email** and Export CSV. Right:
   two rows, each with their own email, the same Household, and Addressee "A and B Lastname". Mark one of them No
   email (Edit → Contact preferences) and export For email again: only the other person is in the file.
5. **(Needs a write.)** On either person's record → Household and related → Manage → **Log a touch with the
   household** → title "Fleet household call" → Log to 2 people. Right: "Logged to 2 people" with Undo; both
   timelines show it. Press Undo: both lines go.
6. **(Needs a write.)** Make two more same-last-name people, record a gift on each, then Data health → merge them (or
   More → Merge). Open the kept record. Right: "This record was merged from two people (…) Split them back into a
   household?" Press it: "… are two people again, in The … Household", both records back with their own email,
   phone and gifts; the banner does not come back on reload.
7. **(Read only, Harborlight.)** Open Henrietta Stonebridge → rail Household and related → Manage. Right: two
   person cards, each with their own email; "Combined giving by year" figures each open rows that foot.

**What could have broken nearby:** the Top 100's rank moves, drag and remove (they now key on the place, not the
person), its CSV and Print (new This year and People columns), the plan of care (a household's is its lead
person's); Home's "Your portfolio" card count and the Thread's "#rank" mark (a household's people count as on the
list); Atlas "everyone on my Top 100"; the Donors list's paging and sort (unchanged with the switch off); the Donors
CSV (new columns); Data health → Undo a merge (its body moved into a function, behaviour unchanged); the Household
and related dialog; Log a touch to many people (z-index).

**Needs a write:** 1 to 6 in org_stagewalk. 7 is read only in Harborlight.
