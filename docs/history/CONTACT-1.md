# CONTACT-1 · A person's address, email and phone in one click (24 Nov 2026)

From a pilot customer's call: to see an address or an email she opened Edit record, and on some people the rail's Contact section was missing altogether ("I'm not even seeing it on some of these"). For an invoice or an envelope she needs the address.

**Item 1 (shipped on its own).** The section was drawn only when the record had `email`, `phone`, a contact person or the rail read's address. Three ways that missed a reachable person: the address came only from `GET /donors/:id/rail`, so a person with just an address had no Contact section until that read answered and none at all when it failed (About offered "Add email or phone" instead); the workbook import fills `mobile` and `email2`, which the client's `adaptDonor` dropped and the section never read, so a mobile-only person had none and their mobile showed nowhere on the profile; and a person with nothing showed nothing. Now `shared/contactDetails.js` reads the person's own columns (the address line is the same function the rail read uses), the section is always drawn, and an empty one says "No contact details yet · Add".

**Items 2 and 3.** The profile is Jonathan's, so the proposed Contact tab is a mockup first and is built only after his yes (`docs/needs-jonathan/CONTACT-1.md`).

Found on the way, for a later brief: `adaptDonor` does not carry `phone_unreachable` either, so the rail's "Marked wrong. Never dialed or texted from Steward." line under a phone never draws (the "Phone marked wrong" flag under Careful still does).
