# GIFTS-3 · Edit is create, pickers pick, previews preview the draft (2026-11-23)

From Jarvis's Nov 22 sweep (a2746ab). The root cause was three copies: the gift form and the gift edit
form were separate code, pickers accepted typed text that never became a record, and the giving page
preview drew the server's idea of the page rather than the draft.

1. **One gift form.** `client/src/components/gifts/GiftForm.jsx` is New gift and Edit, one component in
   two modes with the same fields (Campaign, Appeal, Fundraiser / giving page, fund or split, event,
   soft credit, tribute, match, custom fields, Anonymous). Its state and its one body are
   `client/src/lib/giftForm.js`; the server reads POST /donors/:id/gifts and PUT /gifts/:id through
   one reader, `server/donors/giftShape.js`. The edit now writes appeal, giving page and fundraiser.
   A blank method is stored as nothing (recordGift's GIFT_METHOD_UNKNOWN is null) and reads "Not set";
   it used to be stored as the word "Needs you", which an edit then saved back as typed.
   `scripts/ops/gifts3-needs-you-method.js` lists the old rows (dry run; --apply per org); every screen
   already reads them as Not set.
2. **Pickers pick.** AttributionField reports text typed and never picked, and Save refuses it with a
   sentence; a name with no match offers "No campaign called 'Spring'. Create it?". Soft credit, tribute
   and matching employer are `gifts/PersonField.jsx`, a person search that holds a person only once one
   is clicked (a tribute may choose "Use the name 'X' (not on file)"). The server refuses a campaign sent
   as words that names no campaign (`campaign_not_found`), and resolves one that names exactly one.
3. **Money stays cents.** The float was not reproduced on staging or locally (the column is
   NUMERIC(12,2) and the edit box read 123.45; see the report). The amount box is now text filled from
   whole cents (`amountInput`), so no browser float can reach it.
4. **Preview the draft.** Cause: the preview route and Publish kept a never-set-up page's old one-step
   form whenever the drafted form equalled Steward's defaults (one-time, no yearly, $25/$50/$100/$250),
   so the preview drew the legacy form: monthly first, an Annual button, the org's $10 to $500 ladder.
   Setting any form field now marks the draft `formSet`, which both honour, and the editor lays the draft
   form over the preview at once (`client/src/lib/previewForm.js`, the same `formSpec`). With smart
   amounts on, the preview says "The live page builds amounts from your gifts." above them.
5. **Cancel means gone.** Cancel resets the New gift draft; leaving the form any other way keeps it.
6. **ACH and Anonymous.** `shared/giftMethods.js` is the one list of methods ("Bank transfer (ACH)"
   among them) and the one label; receipts, the bookkeeper export and the deposit rules read it, and an
   old deposit-account mapping for "ach" still holds. `gifts.anonymous` (recordGift writes it) makes every
   public recent-donors line, the fundraiser's donor list and a tribute notice say Anonymous; the gift
   stays on the donor's record and totals.

Tests: `tests/gifts2-split-goal.test.js` §5 (11 checks), red on the planted defect (a typed campaign
silently dropped: 2 red). `tests/build88a-one-gift.test.js` now expects a blank method stored as nothing.
