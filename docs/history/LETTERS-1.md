## LETTERS-1 · Her own letter, her own signature, to everyone who gave to one event (2026-11-24)

From a pilot customer's call (24 Nov): her June fundraiser's tax letters start in early December. She had a
designed thank-you letter in Word that "didn't look good" pasted in, signs in blue ink, wanted every donor to
one event in one batch as a PDF or a Word file, and saw an "ANNU" campaign in Add a gift that the Campaigns
page never showed.

**What was built.**
1. *Upload a Word letter.* `server/receipts/letterDoc.js` reads a .docx (jszip and xmldom; mammoth reads the
   same file for its plain text so text this reader did not place is named, not lost) into a layout: the page,
   the Word header as the letterhead, body, footer; paragraphs keep alignment, spacing, indent, size, colour,
   bold, italic; pictures are PNG/JPEG data URIs; a simple table (logo beside address) keeps its columns.
   Fonts print as the nearest of the PDF's three standard faces, and the upload says so. "[First Name]",
   "<<FirstName>>" and Word's «FirstName» MERGEFIELDs are offered as fields to confirm; a {{token}} Steward
   does not know is refused at save. Side by side: her original (docx-preview in the browser) and Steward's
   own PDF for a made-up donor. Stored on `ack_letter_templates.layout`; `body` is the layout's words, so the
   save check and the missing-field check read the same tokens the print fills.
2. *A signature image.* Settings → Tax receipts (the receipt signer, `orgs.receipt_signature_image`) and My
   profile (`users.signature_image`). The browser takes the paper out (pixels near the corners' colour go
   clear), keeps the ink's colour and crops to it. It prints above the signer's typed name in PDF and Word.
   The signer rule is unchanged; the picture follows the name.
3. *Letters for everyone who gave.* Communications → Printed letters, and "Letters for everyone who gave" on an
   event's and a campaign's page. Gifts are `IN_SPAN` and `GIFT` (money, above zero, not refunded in full);
   the batch is BUILD-98's (`letterSet.js`, moved out of `thanks.js`), now leaving out do not contact by name.
   New fields: `{{first_name}}`, `{{last_name}}`, `{{event_name}}`, `{{campaign_name}}`, `{{deductible_amount}}`
   (`deductibleCents`, the receipt's rule), `{{address_block}}`, `{{today}}`. Download PDF or Word
   (`letterWord.js`, the `docx` library, one section per letter) marks nothing; Mark these as sent stamps the
   acknowledgment and sets thanked only when she ticks "This letter was their thank-you" (THANKS-1).
4. *Each campaign once.* Reproduced on staging (356dc03) with clicks: typing "…ANNU" beside "…Annual Fund"
   offered "+ New campaign", one click made it, and it had no goal, so `/fundraising/campaigns` (goal > 0) never
   listed it while the picker (not archived) always did. "ANNU" is a name typed and created, not a code. Now the
   picker hides retired and email-only rows and marks a goal-less one "Draft", does not offer "+ New" for the
   start of an existing name, and the create matches case and spacing. Drafts and same-name groups show on the
   Campaigns page with Finish, Merge (`campaignMerge.js`, `campaign_merges`, Undo) and Delete (removal.js).
5. *Existing duplicates.* `scripts/ops/letters1-campaign-duplicates.js`, dry run by default.

**Why the routes are /campaign-tidy/…** `GET /campaigns/:id` (outreach) would answer `/campaigns/drafts` first.
