# HOUSEHOLD-1 · A couple is one giving unit on every list, and each person keeps their own contact details (2026-11-24)

From a paying pilot customer's email (24 Nov, prod 5c922c6): her Top 100 had a couple in two places with no way to see
their combined giving or capacity, so she merged them, and each merge left one email, one phone and one photo behind.
One PR, one new suite (`tests/household1.test.js`), and `assertSurfacesAgree` extended with a household row.

## What happened
- **The root cause.** Households already pooled money for the lapse rule, LYBUNT and Reports (`households.js` UNIT),
  but the working lists were built one row per person, so a household never appeared as a row. Reproduced on staging
  (5c922c6) in org_stagewalk as the walker: a couple added to the Top 100 took places #1 and #2; `POST /top100/members
  { householdIds }` answered 400 "Pick at least one person to add."; after `POST /donors/merge` one email and one phone
  were left. Harborlight (read only) has two households and no "Show households together" on Donors.
- **A household can be a row (item 1).** `portfolio_members.household_id` (additive; `donor_id` loses NOT NULL; a
  CHECK says one or the other). A place's key is its household's id or its person's; rank, drag and remove work on
  the key. The row's money is `shared/numbers/householdGiving.js` (`householdMoney`): Lifetime is each person's
  Lifetime added (the `household-giving` source, the household panel's Combined), This year is their gifts this
  fiscal year (the new `household-span` source, the span rule), the last gift is the latest of theirs, the capacity
  the higher Wealth Score labelled "household". Owner, stage, ask and plan are the lead person's (the primary while
  live). Adding one person of a household offers "Add the household instead"; adding a household whose person is
  listed takes that place at its rank and closes the others. A person whose household holds a place is "already on
  it through their household". The Home portfolio card, the Thread's rank and Atlas's "everyone on your Top 100"
  read a household's place as its people. A "This year" column joins Lifetime for every row.
- **The Donors list (item 2).** "Show households together" is saved on her list layout
  (`donor_list_layouts.households_together`, never the org default). `GET /donors?households=1` pages by giving unit
  through the same filter and order (`server/donors/householdList.js`); sorted by giving, a household ranks by its
  combined Lifetime (`UNIT_LIFETIME`). The counts say rows, households and people (`households.countsWhere`).
- **The household view (item 3).** `GET /households/:id` adds giving by fiscal year (each year opens its gifts), the
  shared address and who differs, open asks, the next step, and each person's own email, phone, photo and contact
  preferences (`server/donors/householdDetail.js`), shown under Household and related. "Log a touch with the
  household" is EDIT-2's touch batch: one touch per person, one Recent changes line, one Undo. The walk found that
  dialog opening behind the Household and related dialog; it now takes a z-index above it.
- **Exports (item 4).** The Donors export always has Household, Addressee ("Debra and Geoffrey Vantongeren", the
  primary first) and Contact preferences columns. With households together, each household brings in its other
  people as rows of their own. "For email / For calls / For a mailing" leaves out anyone whose own preference says
  no; a mailing is one row per household address (`server/donors/householdExport.js`).
- **Undo a couple merge (item 5).** Data health's merge Undo body is now `undoMergeIn(client, …)`, the route
  unchanged. `POST /donors/:id/split-to-household` runs it and makes (or joins) the household in one transaction;
  a profile merged into within 30 days says "This record was merged from two people … Split them back into a
  household?", an older one says it can't be split automatically. `scripts/ops/household1-merged-couples.js` lists,
  read only, the couple-shaped merges per org and which can still be split.

## Proven able to fail
Planted: the household's Lifetime adding only its first person. §1 (Lifetime, the panel), §2 and the truth check §7
went red ("the key (its people's gifts) says $3500.01, the Top 100's household row …"); restored, 40/40 green. Main
has no household place: staging 5c922c6 answered 400 to the household add that §1 needs.

## Left for later
- Officer portfolios (Major gifts → Portfolios) and the Pipeline are still one row per person: they are `assigned_to`
  and `stage` on a person, not `portfolio_members`. A household there needs its own owner and stage first.
- "Bring in ranks" from a spreadsheet matches people, not households.
