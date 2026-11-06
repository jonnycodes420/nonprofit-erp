## WALKB-1 · What a stranger would notice: the giving page, stale lists, search, plurals (2026-11-05)

Muse's Walk B (5 Nov) read Steward as a stranger would. Each finding, its cause and the fix:

- **Placeholder copy on a live giving page.** The GivingTuesday and Year-end templates saved their writing
  prompt ("Write two or three sentences here…") as the page's own story and as a rich-text block, so a page
  nobody edited published it. The prompt is now the block's `hint`, never saved copy, and every public page
  drops any paragraph or block that is still one of Steward's prompts (`shared/placeholderCopy.js`, applied
  in `givingPagePayload` and `resolveWidgetsPublic`). The editor's preview keeps them and names them in a
  "Fill this in before you share" note.
- **Placeholder EIN (47-1234567) in the footer.** Nothing checked the shape. `isPlaceholderEin` (nine equal
  digits, 123456789, 987654321, 012345678, 471234567) holds it off the giving page, the org page and every
  receipt snapshot (`publicEin`), and Settings > Tax Receipts says so beside the field.
- **Step 2's "Your email is saved when you continue".** Continuing writes one row to the gifts-started list
  (`gift_starts`, PARITY-4), not a person record. A public form making person records is the unsafe way, so
  the sentence changed instead: both forms read `shared/giftStartWords.js` ("…sees that a gift was started
  from this address… You join their records only when a gift goes through.").
- **"1 students".** Each Impact Metrics site did its own `{n}` replace. `impactSentence` in
  `shared/countWords.js` singularises the noun after `{n}` when it is 1; Settings, the Impact Summary PDF and
  the milestone draft all read it.
- **Signature and Brand kit named a former director.** Both showed the saved org signer as if it were the
  person signed in. With nothing saved they now start from the signed-in person's name and title, and a saved
  signer says "From Settings".
- **Volunteers header, Recent shifts, Groups list stale.** Each re-read only after its own buttons. Atlas logs
  hours and removes records on the server, so the screen behind never heard. `client/src/lib/writeRev.js`
  re-reads on COUNTS-1's two signals: api.js `onWrite` for paths that touch the list, and VOICE-4's `told()`.
- **Search: "Marlowe" found people with no Marlowe visible; Home named someone search could not find.** The
  matches were households, linked organizations and emails, with nothing saying so. Each result now carries
  its reason (`personMatchReasonSql`), name matches first. The unfindable name: Home's lists include archived
  people (THREAD-3 keeps them where money is counted) and non-donor records, while the Donors list's default
  view hides both even while searching. A search now looks at everyone, archived included and marked.

Test: `tests/walkb1.test.js` (API and a browser leg). 22 of its 30 checks fail on main.
