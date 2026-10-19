# CAPTURE-1 inventory: how a gift that arrives on paper gets into Steward today

Taken on origin/main 8af7a2b, 18 Oct 2026, before any CAPTURE-1 code. File and line references are to that tree.

## How a check gets in today

There are two doors, and both need a person to type or paste.

**1. One gift, typed on the person's record.**
- Open the donor, then Add gift. The form is `addGiftForm` in `client/src/components/DonorProfile.jsx:1182`, saved by `addGift` (:1665).
- It posts to `POST /donors/:id/gifts` (`routes/crm.js:6991`), which calls `recordGift` with `source: "gift_form"` and `conflict: "idempotency"` (crm.js:7098-7105), then opens the gift's thank-you thread (`openGiftThread`, crm.js:7143).
- The form has no place for a photo of the check. The check number has no field either.

**2. A deposit, on the deposit sheet (BUILD-88b, BUILD-95).**
- Fundraising, then Money in, then Deposits, then "add a deposit" (`DepositsView`, `client/src/pages/Fundraising.jsx:1225`; the button :1245) opens `DepositSheetModal` (`client/src/components/DepositSheet.jsx:34`). Finance opens the same sheet (`Finance.jsx:1881`).
- Clicks: paste the slip's lines, then `POST /deposits/plan` (crm.js:9145), which reads and writes nothing.
- Optional, BUILD-95: "read checks" sends the photos to `POST /deposits/read-cheques` (crm.js:9052). The model transcribes the amount in figures and the amount in words separately (`shared/chequeRead.js`: `CHEQUE_READ_SCHEMA` :29, `writtenAmountToCents` :66, `reconcileAmount` :111). An amount is filled in only when the two agree to the cent. The route writes nothing.
- Optional: photograph each line's check (DepositSheet.jsx:341-350).
- Commit: `POST /deposits/commit` (crm.js:9158) re-plans on the server and calls `recordGift` with `paymentMethod: "Check"`, `idempotencyKey: deposit:<import>:<line>`, `chequeAssetId` and `source: "deposit"` (crm.js:9240-9260).
- **The check image:** `storeChequeImage` (crm.js:28180) takes png, jpeg or webp up to 10 MB (`CHEQUE_MAX_BYTES` :28179), checks the bytes match the type, resizes to a 1600px long edge as webp and stores it private (`putThemeAsset`, `assetStore.js:112`, `is_public` false). The gift points at it with `gifts.cheque_asset_id` (db.js:4973). It is shown through a signed, expiring URL (`donorPhotoUrl`, crm.js:27933; `GET /person-photos/:id`, :27938). `POST /gifts/:id/cheque` (crm.js:28211) attaches one to an existing gift, but no screen calls it.
- **Bank numbers:** nothing reads or stores a routing or account number. The read schema has no field for them. The check number goes into the gift's notes on the deposit path; `gifts.check_number` (db.js:6510) is filled only by the QuickBooks read.

## What INT-4 stores from an email with an attachment today

None of the attachment.
- `syncMailboxRun` (`server.js:9393`) reads the staff mailbox through `fetchMailboxMessages` (:9961). Gmail is `readGmail` in `mailboxFetch.js:68`; Outlook is the Graph delta.
- A message is matched to a person by exact email only (`donorsByEmail`, :9431; `classifyMailboxMessage`, `shared/mailboxLog.js:157`).
- It stores one `interactions` row per matched person, `type 'email'`, whose metadata holds the message id, provider, direction, subject, web link, thread key and **a count** of attachments (:9497-9510).
- `gmailToMessage` (:10031) knows each attachment's name, type, size and id (:10039-10044); `graphToMessage` (:10095) knows only that there are some. `fetchMailboxAttachments` (:10075) can download them, and today only grant routing calls it (:9520-9529).

The forwarding path is the same shape. `POST /inbound-email` (`routes/webhooks.js:2823`) takes mail to `log+<slug>@INBOUND_EMAIL_DOMAIN` (`slugFromAddress`, `shared/inboundEmail.js:111`), accepts it only from a staff user, and writes an `interactions` row. Its attachments are reachable through `bccAttachmentLoader` (`routes/grantMail.js:246`), again used only for grants.

## What the receipt setting does on a hand-entered gift

- The setting is `orgs.receipts_enabled` (db.js:2411). The one receipt path is `issueGiftReceipt` (server.js:3736), which skips an org with it off.
- `recordGift` never issues a receipt. A hand-entered or deposit-sheet gift is receipted only when staff press the one-click `POST /gifts/:id/receipt` (crm.js:7865).
- The only automatic receipt is the Stripe webhook's, for online gifts.
- A receipt also sets `gifts.acknowledgement_sent`, so that column cannot tell a receipt from a thank-you.

## Where thank-you drafts are created

- `queueThankYouDraft` (server.js:2712), called from inside `recordGift` (:1289), writes one row per gift to `thank_you_drafts` (db.js:2084). Nothing is sent.
- Drafts are read and closed by `GET /thank-yous` and `/opened`, `/sent`, `/skip`, `/mark-all-sent` (crm.js:570-655). `/sent` sets `gifts.acknowledgement_sent_at` and closes the thank-you thread.
- An old gift a history read brought in gets no draft (`history: true`, `historyGifts.js`); imports can pass `alreadyThanked` (`importThanks.js`).

## Other pieces this build touches

- **Soft credit:** `gift_soft_credits` (db.js:5299), written inside `recordGift` from `extras` (`checkGiftExtras` server.js:1520, `writeGiftExtras` :1562).
- **Matching gift:** a pledge on the employer with `pledges.is_match` and `matches_gift_id` (server.js:~1610).
- **QuickBooks dedupe:** the QuickBooks read puts a line that matches a hand-entered gift (same person, same cents, within 3 days, not from a vendor) in `already_in_steward` and records nothing (`qboRead.js:360-381`).
- **Major-gift line:** none exists. The nearest settings are `orgs.major_prospect_cents` (db.js:2809) and `call_gift_floor_cents` (why.js:231, default $250), which feeds Home's calls to make.
- **A call on the Thread:** `openThreadTx` (server.js:4269), one open thread per person.
- **Matching a person:** `matchPerson` in `personMatch.js:61` (email, then name, then street or ZIP; returns matched, ambiguous or none).

## What CAPTURE-1 reuses

- The BUILD-95 transcription and its two-amount rule (`shared/chequeRead.js`), so a check's amount is filled only when the figures and the words agree.
- `storeChequeImage` and the private asset store with signed, expiring URLs; `gifts.cheque_asset_id` for the image on the gift.
- `recordGift` for every confirmed gift (with `chequeAssetId`, `checkNumber`, `extras` for soft credit), which also queues the thank-you draft through `queueThankYouDraft`.
- `issueGiftReceipt`, called by the confirm tap only when `receipts_enabled` is on, the same outcome as the staff one-click.
- `openThreadTx` for the call a major gift puts on today's Thread.
- `matchPerson` for the donor, `fetchMailboxAttachments` and `bccAttachmentLoader` for email files, the inbound slug path for the forward address.
- `offerUndo` and the shared Undo toast; the Uploader for drag and drop.

## What is new

- `capture_items` and `capture_batches`: one card per document or check, and a batch that knows its deposit slip.
- The "To confirm" part under Money in, with a count on the sidebar.
- `gifts.received_at` and `gifts.thanked_at`, and the one clock line on the thank-yous screen.
- A per-org capture address, `capture+<slug>@` the inbound domain.
- A major-gift line the org can edit (default $1,000).
