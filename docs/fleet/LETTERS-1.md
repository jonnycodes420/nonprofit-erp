# LETTERS-1 · For the fleet

**Surfaces changed:** Communications → **Printed letters** (new tab: Letters for everyone who gave, Letter
templates with **Upload a Word letter (.docx)**, Your signature). An event's page → **Letters for everyone who
gave**. A campaign's page → **Letters for everyone who gave**. Settings → Tax Receipts → **Signature picture**.
Settings → My profile → **Signature on printed letters**. Record a gift → the **Campaign** picker. Fundraising →
Campaigns → the new **Draft** strip (Finish, Merge into…, Delete) and "N campaigns are named …" (Merge into one).
Fundraising → Acknowledgments → Print letters (same PDF path, now with the signature).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Communications → Printed letters → Upload a Word letter (.docx) → choose any
   .docx with a header logo and "Dear [First Name]," → you see your original on the left and Steward's PDF on the
   right, "[First Name] → First name {{first_name}}" chosen, and a "What did not carry over" box if the file has a
   text box. Name it → Save this letter. It is listed "From Word (file name)".
2. Printed letters → An event → pick one with gifts → the sentence "N letters, one for each person who gave to …"
   and the deductible sentence; each row shows given and deductible; "Left out (n)" names do not contact, no
   address and deceased people with the reason. Set From after the last gift: "Nobody gave to … in that range."
3. Same screen → Download PDF: one page per person, letterhead on each; "Downloaded N letters. Nothing was sent
   and nothing is marked." Download Word opens in Word, one letter per page, editable.
4. **(Needs a write.)** Mark these as sent with the box unticked: "N gifts now show a letter was sent." The
   person's gift still reads not thanked. A second press changes nothing (first stamp kept).
5. **(Needs a write.)** Settings → Tax Receipts → Signature picture → upload a photo of a signature on white
   paper: the small letter shows it above the signer's name with the paper gone and the ink's colour kept.
   Remove → "No signature picture yet".
6. **(Needs a write.)** Donors → Record a gift → Campaign: type the first four letters of an existing campaign:
   it is listed, and instead of "+ New campaign" it says "Pick … above, or type the whole name of a new
   campaign." Type a whole new name → "+ New campaign" → it shows on Fundraising → Campaigns as **Draft**.
7. **(Needs a write.)** On that Draft: Merge into… an existing campaign → Merge → "Merged … 1 gift moved" with
   Undo; press Undo → the draft is back with its gift. Then Delete → removal's own confirm → gone, with Undo.

**What could have broken nearby:** Fundraising → Acknowledgments (Preview, Print letters, Mailing labels: the
batch moved to `server/receipts/letterSet.js`); Settings → Tax Receipts (layout); My profile; Record a gift and
the gift form's Campaign picker (retired and sent-email campaigns no longer listed); an event's header buttons;
the Campaigns list's Edit/Remove row.

**Needs a write:** 1, 4, 5, 6, 7 (org_stagewalk). 2 and 3 can read Harborlight.
