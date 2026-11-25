# CONTACT-1 · For the fleet

**Surfaces changed:** the donor profile's right rail, Contact section (item 1); the profile's new Contact tab, after Conversations (item 3); `GET /households/:id` people gain `sameAddressAs` and `addresseeHere`; the rail's Careful flags gain "No calls".

**Clicks to try for the next three nights**
1. Donors → search "Halvorsen" → open Halvorsen Family Foundation. Scroll the rail to Contact. Right: a Contact section with Address "Portland, ME". About does not offer "Add email or phone".
2. Same person, open it, and while it loads look at the rail: Contact is there from the first paint, not after a second.
3. Any person with an email and a phone: Contact shows Email and Phone as before, with no "Other email" or "Mobile" line unless the record has a different second email or mobile.
4. (Needs a write, org_stagewalk) + Add a person with only a name. Open them. Right: Contact reads "No contact details yet · Add". Click Add: the Edit record dialog opens. Type a city and state, save. Right: the "No contact details yet" line is gone and Address shows the city and state, without a reload.
5. (Needs a write, org_stagewalk, off the happy path) On that person, open Edit record again, clear the city and state, save. Right: Contact goes back to "No contact details yet · Add", and nothing else in the rail moves.

6. Open any person with a full address. Press the Contact tab. Right: the address block (name, street, City, ST ZIP), Copy address, and paste it anywhere: the same three or four lines. The rail's Contact section is still there.
7. Open a person in a household where everyone lives at one address. Contact tab: "Address it to:" offers the person and the joint name; pick the joint name, Copy address, paste: the joint name heads the block.
8. Open a person in a household where one member lives elsewhere. Contact tab: the joint name leaves that member out; the Household card says "A different address (open their profile to see it)" for them, and clicking their name opens their profile.
9. At 390 wide: the tab row scrolls sideways to reach Contact, the page itself does not scroll sideways, and every Copy button can be pressed.
10. A viewer (read-only) role: the Contact tab has no Edit button and no "Add one".

**What could have broken nearby**
- The Wealth Score row: it now always sits in the Contact section (it used to move into About on a person with no contact details). Check it still shows and saves for an admin.
- The Privacy row (client flag) and the Careful flags (Do not mail, Email bounced) in Contact.
- GET /donors/:id/rail's address line (the same words, now from `shared/contactDetails.js`): any screen that reads `contact.address` from it.
- The read-only view (a viewer role): Contact says "No contact details yet" with no Add.
- The tab row: eight tabs now. Activity is still first and is still what a profile opens on; the timeline search still jumps to Activity from Contact.
- The household page (`/households/:id`): it reads the same response, with two new fields per person it ignores.

**Needs a write:** checks 4 and 5, in org_stagewalk only.
