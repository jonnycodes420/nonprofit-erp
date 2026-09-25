# Receipts and tax

Read this when you touch receipts, acknowledgments, letters, year-end statements, or the legal entity and EIN.

## Rules
- **A gift receipt names the donee, never the vendor.** `renderReceiptPdf` prints the org's legal name,
  EIN and address; `tests/legal-entity.test.js` asserts it contains no part of Steward Software LLC. (FIX legal entity)
- **Write Steward's own legal name only in `shared/legalEntity.js`.** No other importable file may carry
  the literal; read `LEGAL_ENTITY_NAME`, `copyrightLine()` or `operatedByLine()`. (FIX legal entity)
- **Put no real tax ID anywhere in the repo.** `tests/legal-entity.test.js` allows only its list of
  synthetic demo EINs; add a new fixture EIN to that allowlist, never loosen the guard. (FIX legal entity)
- **Never convert org_creo into a real organisation.** Its legal name, address and signer are invented
  for demo receipts; a real CREO starts as a fresh org record. (FIX CREO demo)
- **Org vocabulary never reaches a receipt, a year-end statement or the portal.** A section 170
  acknowledgment is a legal document; the suite asserts it. (BUILD-86)
- **State a quid pro quo split through `recordGift`, never a second receipt renderer.** Pass
  `quidProQuoValue`/`quidProQuoDesc`; the existing receipt prints the deductible part. (BUILD-98, BUILD-101)
- **Fair-market value is the org's number; Steward records it and never estimates it.** FMV above price
  is refused at the route and by a CHECK; a $0 FMV is stated in a sentence ("the whole $X is deductible"). (BUILD-98, BUILD-101)
- **A full refund voids the active receipt; a partial refund never edits it.** The void keeps the record
  with `gift_id` NULLed; a partial lands in the `receipt_mismatch` queue for a human. (FIX attribution)
- **A receipt states the charged total, including any donor-covered fee.** No fee itemisation; only
  goal progress uses the net. (BUILD-08, FIX attribution)
- **Receipts are transactional mail: they ignore marketing opt-outs but not deliverability.** Bounced,
  complained, `email_unreachable` and deceased still block; no unsubscribe footer on the cover email. (BUILD-58, BUILD-94, BUILD-35)
- **Do not grow the set of automatic donor mail.** Receipt auto-send for online gifts is a documented
  transactional exception; adding another needs the same deliberate human decision. (BUILD-75)
- **Refuse an unknown merge field at save, naming every bad token.** A field with no value for a donor
  is named and that letter is left out with the reason; never printed blank (`shared/ackLetter.js`). (BUILD-98)
- **An acknowledgment letter's amount is the gift rows summed in integer cents,** one letter per donor
  listing every gift in the batch. Year-end statements are pinned to foot the same way. (BUILD-98)
- **Printing changes nothing; marking is its own press.** `POST /acknowledgments/mark` stamps
  `acknowledged_*` and `acknowledgement_sent_at` once (first stamp kept) and closes the drafted thank-yous. (BUILD-98)
- **Leave out, by name, a deceased donor and a donor with no postal address.** Labels read the address
  only, so a template a gift cannot fill never costs somebody their envelope. (BUILD-98)
- **A letter is signed by the org's receipt signer, else by the person printing it, never unsigned.**
  The signature is the user's name, not `actor(req).name` (that is the login email). (BUILD-98)
- **Only a template marked default stands in for "no choice"; otherwise use the built-in letter.**
  Never take whichever saved template sorts first. (BUILD-98)
- **The acknowledgment backlog is the org's own N days** (`orgs.ack_backlog_days`, default 7):
  unthanked, older than N, non-sample, and the count carries its sentence. (BUILD-98)
- **Thank-you drafts never touch receipts and Steward never sends them.** One per gift; no draft for a
  small pledge payment, anonymous, do-not-contact/deceased or sample; lift only her greeting and sign-off. (BUILD-88b)
- **Count acknowledgments by `acknowledgement_sent_at`, not the boolean.** A gift acknowledged before
  the stamp existed belongs to no week, and the definition says so. (BUILD-88a)
- **The year-end email is a "year-end giving statement", never a "donation receipt".** Subject and
  body say so. (BUILD-35)
- **`receipt_address` is also the CAN-SPAM postal address.** `unsubscribeEmailFooterHtml` reads it with
  `legal_name`; without it marketing mail gets an unsubscribe-only footer and a prompt to add it. (CAN-SPAM FIX)

## Gotchas
- **`POST /donors/:id/year-end-statement` takes `{year, send}`, not `taxYear`.** (Tax receipting)
- **The thank-you queue must write the user's name as logged-by, not the actor email.** Same trap as
  the letter signature. (BUILD-88b)

## Where the code is
- `server.js` `issueGiftReceipt` / `issueYearEndStatement` / `renderReceiptPdf` — the one receipt path
- `shared/ackLetter.js` — merge-field validation, letter composition, `ACK.WINDOW` (#10 window position)
- `POST /acknowledgments/letters/preview`, `/letters/pdf`, `/acknowledgments/mark` — print and mark
- `shared/draftNote.js` — drafted thank-yous
- `shared/legalEntity.js` — Steward Software LLC, the only place it is written
- `tests/legal-entity.test.js` — donee-not-vendor receipt check and the EIN allowlist

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## Database tables (moved from the old "Database — key tables and columns")

### Tax Receipting & Year-End Giving Statements — 2026-07-16
Compliant, branded tax receipts for gifts, plus consolidated calendar-year giving statements per donor. **US-only v1, cash/cash-equivalent gifts only — explicit non-goals: no Canadian/CRA receipts, no in-kind gift receipting.** Statements are always **calendar year**, never fiscal year, even though the org's own fiscal year starts July 1 (see "Fiscal year" under CRITICAL WORKING RULES) — every date range in this feature's UI copy is labeled "tax year," not "fiscal year." The legal copy in the PDF/email templates is flagged for attorney review before being relied on in production — this is compliance-adjacent copy, not verified by counsel as part of this build.

- **`orgs`** — `legal_name`, `ein` (normalized to `XX-XXXXXXX`), `receipt_address`, `receipt_signature_name`, `receipt_signature_title`, `receipt_custom_message` (nullable per-org override, `{{token}}` convention), `receipts_enabled BOOLEAN DEFAULT false` (server refuses to flip true unless `legal_name`/`ein`/`receipt_address` are all present), `receipt_counter INTEGER DEFAULT 0` (atomic per-org receipt-number allocation via `UPDATE ... RETURNING`, never `SELECT MAX()+1`).
- **`gifts`** — `deductible_amount` (nullable; null means "equals amount", the common case — only set when a quid-pro-quo gift's deductible portion differs), `quid_pro_quo_desc`, `quid_pro_quo_value`.
- **`receipts`** — id, org_id, donor_id, gift_id (nullable — null for a `year_end` statement), type (`gift`\|`year_end`), tax_year (nullable — only set for `year_end`), receipt_number, amount, deductible_amount, `snapshot JSONB` (a frozen copy of everything the PDF needs, so a later edit to org tax settings never changes what an already-issued receipt says), pdf_data (base64), sent_to, sent_at, voided_at, void_reason, created_at. Two partial-unique indexes carry the real invariants: `receipts_active_gift_uk (gift_id) WHERE voided_at IS NULL AND type='gift'` (at most one active receipt per gift) and `receipts_active_statement_uk (org_id, donor_id, tax_year) WHERE voided_at IS NULL AND type='year_end'` (at most one active statement per donor per tax year).
- **`issueGiftReceipt(gift, org, donor, {send})`** (server.js) — the single choke point for gift receipts. Idempotent: checks for an existing active receipt before creating one (the partial-unique index is the second line of defense against a race between that check and the insert). Skips `is_sample` gifts and orgs with `receipts_enabled=false`. Renders the PDF via `renderReceiptPdf(snapshot)` (shared with year-end statements via internal branching on `snapshot.type`, avoiding a duplicate PDF-layout implementation), stores it, attempts a Resend email, and sets `gifts.acknowledgement_sent=true` **regardless of email outcome** — the PDF existing and being stored (downloadable/mailable by staff even if the send failed or the address is suppressed) is what satisfies the IRS "contemporaneous written acknowledgment" requirement (IRC §170(f)(8), IRS Pub 1771), not the send succeeding.
- **`issueYearEndStatement(org, donor, year, {send})`** — deliberately **supersede, not idempotent-reject**: regenerating a statement for a donor/year voids the prior active one (`void_reason='Superseded by a newly generated statement'`) and issues a fresh one covering all that year's gifts. Unlike a single gift's receipt, a donor's year-end statement legitimately needs regenerating as more of the year's gifts land — the partial-unique index still guarantees exactly one active statement per donor/year at any moment.
- **Routes**: `GET /receipts/preview` (sample PDF for Settings, doesn't touch the DB), `POST /receipts/year-end-run` (admin bulk-generate across all donors with tax_year gifts), `GET /receipts/:id/pdf` (streams stored PDF, requireAuth + org-scoped), `POST /receipts/:id/void`, `POST /gifts/:id/receipt` (`checkWriteAccess` — the one-click offline path, never automatic), `GET /donors/:id/receipts`, `POST /donors/:id/year-end-statement` (`checkWriteAccess`, body is `{year, send}` — not `taxYear`).
- **Webhook integration**: `payment_intent.succeeded` in `/stripe/webhook` fires `issueGiftReceipt` fire-and-forget after the existing gift-insert — this is the auto-send path for online gifts, gated purely on `org.receipts_enabled`.
- **Offline gifts are never automatic** — `POST /gifts/:id/receipt` is the only path for a manually-entered gift, by design: staff often backfill historical gift data they don't want re-receipted the moment it's entered.
- **Gift-edit-after-receipt-issued**: `PUT /gifts/:id` never auto-voids or auto-updates an existing receipt — a receipt is a legal record of what was actually sent to a donor, not something that should silently drift to match a later correction. Instead, `GET /dashboard/today` surfaces it for a human: a `receipt_mismatch` queue item (priority 70) when a receipted gift's amount/date has since changed or the gift was deleted (`LEFT JOIN gifts` so a deleted gift is caught too, comparing against `snapshot->>'giftDateRaw'`, the raw ISO date stored alongside the human-formatted `giftDate` specifically so this comparison doesn't need to reparse a formatted string). As of 2026-07-16, `DELETE /gifts/:id` refuses (409) to delete a gift with an ACTIVE receipt — see "MGO backend routes" — so the deleted-gift mismatch case now only arises from bulk paths (purge-trash, org delete), which remove the receipts themselves.
- **Dashboard queue — "$250+ needs a tax receipt"** — `GET /dashboard/today`, priority **76** (deliberately one point above the pre-existing "not yet thanked" bucket's 75, not the same number — `upsertItem`'s tie-break is strict `<`, so a legally-required receipt needs to outrank, not tie, the stewardship nudge when both apply to the same offline gift; this was verified to actually happen at runtime, not just assumed from the priority numbers — see PROGRESS.md). Scoped to gifts ≥$250, unacknowledged, non-sample, within the last 60 days. In practice this bucket only ever surfaces offline gifts — online gifts auto-receipt near-instantly via the webhook and so already show `acknowledgement_sent=true` by the time this query runs.
- **Frontend**: `Settings.jsx`'s `TaxReceiptsManager` (module-scope component, mirrors the Impact Metrics/Custom Fields manager pattern) — legal/EIN/address/signature fields, a live PDF preview, and the year-end dry-run/generate-and-send controls. `DonorProfile`'s Gifts & Pledges tab gained a "Receipt" column per gift (`Receipt ✓ #2026-00042`, click → PDF download; or a one-click "Send receipt" button, `isReadOnly`-gated with the standard tooltip; a dash if receipts aren't enabled for the org) and a "Year-end statement" button + expandable panel in the tab header.
- **Cascades**: both the admin org-delete cascade (`DELETE /admin/orgs/:id`) and `clear-sample-data` delete `receipts` before `donors`/`gifts`, matching the FK-ordering convention documented under "Admin data integrity."
- **Verified**: real local Postgres + Stripe-Connect test infra (not mocks) — schema types spot-checked against what the code writes, EIN normalization, the enable-requires-legal-fields gate, one-click issue + idempotency + void + re-issue, year-end supersede behavior, both PDF types confirmed single-page (re-checked the pdfkit footer-overflow bug pattern specifically), the priority-76-beats-75 dashboard tie-break, and the mismatch bucket — all exercised live, plus a real Stripe-signed `payment_intent.succeeded` webhook (HMAC-signed with a `stripe listen`-issued secret, no live platform API key needed) POSTed to the real `/stripe/webhook` route, confirming the full auto-receipt path fires end-to-end from the actual production code. Full detail in PROGRESS.md's "Tax Receipting & Year-End Giving Statements" entry.
