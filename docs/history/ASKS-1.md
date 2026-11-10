## ASKS-1 · Three customer asks from 10 Nov (2026-11-10)

Sarah (CKRH) could not tick Street address on a People report and wanted a gala's auction purchases
uploaded from a spreadsheet; Allie (Justin's Place) could not find Major Gifts, three levels down.

- **One address formatter.** The street was missing from the report catalogue and the donors CSV,
  not from the data. `shared/mailingAddress.js` holds the full mailing address twice, SQL for the
  report builder and JS for the list and the CSV, side by side so they cannot drift. The walk found
  the report's cell collapsing the line break ("Apt 4 Lexington"); text cells now keep it.
- **Major Gifts is a rail entry, not a new screen.** The page draws the same four components
  Fundraising did. The routing is one pure function (`majorGiftsTab.js` `routeMajorGifts`) that
  `navigateTo` and the legacy-URL path both call; the walk caught the address-bar path skipping it.
  At a glance and Proposals stay in Fundraising, where staff without the permission still use them.
- **An auction sheet goes through the one reader.** A second importer was the obvious build and the
  wrong one: the sheet reader already picks or makes the event, dates the gifts, matches people and
  undoes by import. Two roles (item, fmv) and one question were added in `shared/auctionSheet.js`,
  so `sheetRead.js` (over 1,500 lines) grew 10. The batch writer `recordGifts` refused a value
  received; it now carries the three quid-pro-quo columns with recordGift's own rule rather than a
  new gift path.
- **Never assume a value.** With no value column, Import waits on "What were these items worth?";
  $0 is a stated answer, not a default. The preview's total adds each row's deductible, never paid
  minus value over the file (an item sold under its value is deductible $0, not negative).
- **A sold item's auction is closed.** A gala with no auction gets one made for it, closing at the
  end of the gala's day or now, so its public page never takes a bid on something already sold.
- Reproduced each on a production build before the fix; the suite is red on main (`origin/main`
  in a throwaway worktree) and with a planted defect, green after.
