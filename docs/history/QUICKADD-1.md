## QUICKADD-1 · Add a person and their gift in one go (2026-11-10)

- **Why.** Allie Barnett (Justin's Place, beta) typed six Good Giving Challenge donors on 10 Nov: add each one,
  search for them, open their giving, record the gift. Four screens a donor. Save on Add person closed the form
  and left her on the list with nothing open (reproduced with Playwright on the production build of main).
- **Add person lands somewhere.** Save opens the new profile; Save and record a gift opens it with the profile's
  own gift form open (the existing `giftHandoff`), scrolled into view; Save and add another keeps the form,
  emptied, with "Added Maria Lopez. Open".
- **+ New person inside gift entry.** Record a gift (now also on Donors) and each deposit-sheet line. The dialog
  sends `POST /gifts/new-person`, one request for both, with the duplicate check ("… is already on file. Use that
  record?"). The deposit sheet already made new donors for unmatched names; a line can now be made a new person
  when its name matched somebody, and a new person's line can carry email, phone and address.
- **Campaign, Appeal, Fundraiser / giving page** on the dialog, the profile's gift form and each deposit line,
  searched from the org's own rows, Campaign and Appeal made inline. Appeals are a new table (`appeals`,
  `gifts.appeal_id`), additive. Steward used "appeal" as another word for campaign until now (askCatalog maps it).
- **Same as last.** Date, method, fund, campaign, appeal and fundraiser carry from the last gift in this tab
  (sessionStorage, per org) into the next one opened from Donors' Record a gift or from Save and record a gift,
  and down the deposit sheet's lines; each shows as a chip with ×. Event and grant dialogs start clean.
- **After-write refresh.** `changes.js` names the writes that add people (`ADDS_PEOPLE`); the Donors list and its
  counts re-read on any of them.
- **Tests.** `tests/quickadd1.test.js` (API leg and browser leg). Planted defect: the dialog drops `person` from
  the inline create; the server refuses the gift and §B4 goes red.
