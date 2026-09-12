# BLOCKED — FIX: legal entity name (2026-09-12)

Everything in Parts 0–3 shipped. **One assertion in Part 2 was inverted rather
than implemented as written**, because implementing it as written would have
created the exact defect the brief opens by warning about. That is the whole of
this file. Census and per-surface verdicts: `audit/FIX-legal-entity-FINDINGS.md`.

---

## 1 · Part 2's fourth assertion, as briefed, cannot be made true

> *"A receipt rendered from the demo org names Steward Software LLC and the 40390
> address."*

**Why it can't.** A receipt in this product is a **§170 charitable contribution
receipt**, issued by a nonprofit to its donor. `renderReceiptPdf`
(`server.js:6055–6170`) prints, by construction:

- the header band: `snapshot.orgLegalName` and `EIN: <the org's EIN>`
- the body: the org's `receipt_address`
- the footer, on every page: `<org legal name> is a tax-exempt organization. EIN: <org EIN>.`

The demo org is **CREO Arts** (`db.js:2566`), a fictional NYC nonprofit. Steward
Software LLC is the **software vendor**, not the donee. Printing this company's
name and Wilmore address on that document asserts that the donation went to a
Kentucky LLC — and the brief's own words for that are:

> *"the receipt PDF or receipt email template (a gift receipt naming the wrong
> entity is a real problem)"*

Making the assertion pass and honouring that warning are the same sentence
pointing in opposite directions. There is no reading of the receipt template on
which both hold.

**What was built instead.** `tests/legal-entity.test.js` §4 renders a real
receipt through the real `renderReceiptPdf` (via `GET /receipts/preview`, from a
dedicated fixture org so no shared demo data is mutated), extracts the PDF text,
and asserts:

| | |
|---|---|
| the receipt names the **organisation's** legal name | twice — header band and tax footer |
| the receipt carries the **organisation's** address | the one on the org record |
| the receipt says **the organisation** is the tax-exempt organization | the legal footer sentence |
| the receipt does **NOT** contain `Steward Software LLC` | ← the inverted guard |
| the receipt contains **no** part of this company's address | no `Wilmore`, no `101 W Main St`, no `40390` |
| no bracketed placeholder reached a document a donor keeps for their taxes | the §2 family, applied to rendered PDF text |

Same guard, correct direction. It is the assertion that actually protects a gift
receipt from naming the wrong entity, and it is in `run-all.sh`, so it holds
from here on.

**If Jonathan wants Steward's entity on a receipt anyway**, these are the three
shapes it could take — each is a product decision, not a fill, which is why none
was taken autonomously:

1. **A vendor attribution line.** e.g. *"Prepared with Steward, a product of
   Steward Software LLC."* in the page footer. Note this reverses a deliberate
   BUILD-65 Part 5 decision, recorded in the code: the receipt footer was
   stripped back to *"the legal tax line ONLY"* precisely because *"a document
   handed to an accountant should not carry a marketing link."* Reversing it is
   allowed — it is Jonathan's call — but it should be made knowingly.
2. **The subscription invoice, not the gift receipt.** Steward Software LLC
   *is* the correct named entity on the org's own **billing** documents. Those
   are rendered by Stripe today (the Customer Portal), not by this repo, so the
   entity name goes in the Stripe account's business profile — a dashboard
   setting, not a code change. This is the likeliest thing the assertion was
   reaching for.
3. **Nothing.** The vendor's name has no business on the charity's tax document,
   and the entity is already named where an owner is legitimately named: the
   footer copyright, Terms, and Privacy.

**Recommended: (2), then (3).** No code change is needed for either.

---

## 2 · Not blocked, but needing Jonathan — carried from Part 3

The four documents that live in Cowork are listed in the findings' Part 3 with
their owner. Two of them are now the **source of truth for a repo page that was
filled in this pass**, so they need to match:

- `steward-terms-draft.md` → `client/src/pages/TermsPage.jsx`
- `steward-data-handling.md` → `client/src/pages/PrivacyPage.jsx`

The repo pages were filled by **defining a term the documents had left
undefined** — both said "we" and named no party at all — and no other wording
changed. If Cowork's wording later diverges, the repo pages follow Cowork.

Also carried: `steward-founding-partner-agreement.md` names a legal counterparty
and the Cowork "Steward Landing Page" artifact still shows the bracketed ©
placeholder the repo just filled.

---

## 3 · Noticed, recorded, deliberately not fixed

`tests/affected.sh`'s `CLIENT_SUITES` omits **`landing-field`** and
**`donor-field`**, so a change touching only `client/src/pages/Landing.jsx`
would not run the landing golden in the **pre-push** hook. CI still runs the
full battery, so this is a local speed gap and not a hole in verification.
`legal-entity` was added to that list in this pass; the other two were left
alone rather than widening scope. One line, a later pass.

---

**Not blocked:** the pre-push hook, the push, the deploy, or any other part of
Parts 0–3. THE ONE RULE was observed — no tax ID is in this repo, this file, or
any commit message from this pass, and `tests/legal-entity.test.js` §3 now
enforces that permanently against an allowlist of the eleven synthetic demo
EINs that were already in the tree.
