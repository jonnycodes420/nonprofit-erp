## IMPORT-12 · Every prospect's file comes in right the first time (2026-11-27)

The brief set a standard instead of fixing one defect: a full-size export from each system our prospects run comes
in with no hand edits, and every figure agrees with the file to the cent. `tests/fixtures/import/systems-full/make.cjs`
writes one made-up org (2,200 to 4,900 people each) the way Salesforce NPSP, Bloomerang, DonorPerfect, Neon, Little
Green Light and eKYROS export it, plus a one-tab spreadsheet. Each fixture has households, organisations, soft
credits, monthly series, refunds, pledges and payments, tributes, anonymous gifts, flags, two emails, splits and true
duplicates. Its key comes from the model, never from the reader.

None of the vendors publishes its default export headers. The headers come from field labels in each vendor's help
pages or package source, and each writer cites its source. Neon's pages refused automated reading, so its headers are
inferred. eKYROS (now FundEasy) publishes nothing, so its fixture is invented and says so.

**What the full-size files found on main**, read through the one reader before any fix:
- The Little Green Light file crashed the reader. A column marked a copy of another kept that mark after a known shape
  placed the other column elsewhere (`duplicateOf` named a role nobody had).
- Salesforce set aside every organisation's gift: 418 rows and $4.1M, as "no name, email or organization". An
  Opportunity with no contact is its Account's gift, and the shape ignored Account Name.
- Every refund was set aside, so Steward held more than the file: $7,000 to $40,000 per system. Refunds now net
  against their gift as a linked negative row (`refund_of`, refunded in full when the whole gift went back), exactly
  as "Record a refund" leaves it. Bloomerang marks the original transaction Is Refunded, and that reads the same way.
- DonorPerfect counted its soft credits (record type S) and a split's main row (M) as money, about 1,030 rows. The
  shape had read M as received. The manual says G is a gift or a split part, P a pledge, M a split's main row and S a
  soft credit.
- Bloomerang read its pledges as gifts and asked what "Primary ZIP Code" was. DonorPerfect asked what SPOUSE_ID was.
  Neon read its Household Name as the person's name. Each system's people file is now a known shape of its own,
  paired with its gift file (`pairWith`).
- A person exported twice under two IDs lost the second ID's gifts. The reader merged the person by email and forgot
  the ID. Both IDs are now kept (`external_donor_ids`), and the gifts find the person.
- Soft credits were kept as text. They now land as `gift_soft_credits`, never money, whether they come as a column
  (Bloomerang, Neon) or as a row of their own (DonorPerfect S, LGL "Soft Credit"). Tributes, anonymous gifts and
  pledge payments (PLINK, Pledge ID) are written onto the gift (`shared/giftExtras.js`,
  `server/imports/giftExtrasWrite.js`).

**Still open, with how to reproduce them,** in the report (`.claude/reports/IMPORT-12.md`), for the next brief:
- Several screens read a gift refunded in full differently (IMPORT-12-R1). Lapsed, On track, Re-engage, LYBUNT, the
  fiscal-year gift tiles and Home's drifting line do not agree with the truth check's key. The suite prints these
  lines as KNOWN.
- The one-tab spreadsheet with gifts in year columns reads as "nothing found".
- The missing-file sentence (item 3), the verified stamp (item 5) and the 25,000-person timing (item 6) were not built
  inside the cap.
