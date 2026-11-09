# TRUTH-4 · Every surface agrees on gifts, people and at-risk money (8 Nov 2026)

The fleet (lead-2026-11-08) found the same fact two ways on two screens, eight times over. Each had one cause: two
readers of one rule, one of them hand-written.

- **$0 gifts (W-1107-Donors-21X).** Fundraising's period count read every money row (`givingBetween().rows`), the
  Giving summary's months `COUNT(*)`, and a total's drill-down listed $0 rows while the count's did not. Now every
  count and every counted list reads `giftCount.js`; a $0 row is said apart (`alsoOnFile`, "Also on file: 1 $0
  record, not counted"), and labeled "$0, not counted" where history lists it (profile, Recent gifts). By year and a
  one-day report say the $0 record is on file instead of "no gifts".
- **Top 50 (W-1107-Fundraising-11).** The header (`top-lifetime`) read the stored `total_giving` with erased people in;
  the rows read Lifetime live without them. Both read `shared/numbers/topDonors.js` now. All-time names its basis.
- **LYBUNT households (W-1108-Fundraising-07).** The rows fold a household into one line; the header still counted
  people. The header now counts the rows and names the people beside it.
- **Split gifts (W-1108-Finance-38).** Gifts by fund grouped on `gifts.fund_id` (the largest line); the drill-down cut
  by lines. The table reads `fundLines.GIFT_FUND_ROWS`.
- **At risk (W-1108-Fundraising-15).** Lost & Found summed lifetime with no label. One definition,
  `shared/numbers/atRisk.js`: the last year of giving (twelve months ending on the last gift). Lost & Found's tile and
  the Lost report's total read it; lifetime is beside it, labeled.
- **People (W-1108-Fundraising-25X).** Communications' "N people in it" counted everyone in the segment, address or
  not, by its own filter. It now counts Everyone's people (`everyone.js`) with an address.
- **Volunteer starter (W-1108-Volunteers-31X).** The starters counted erased people; a group did not. Both read
  Everyone's rule, and "given" is a counted gift in both.
- **Tasks (W-1107-Volunteers-14).** Home's set is "people with a next step", a name of its own.
- The fixture's erased giver also showed Re-engage listing an erased person its badge left out: `reengageSql` now
  leaves erased people out.
- CI on the merge with main went red once in `import2-history` (By year "1 gift(s)" beside "no gifts"): a year
  where a refund took a gift back to $0 or below. The random 1,000-donor file only sometimes holds that shape, so
  it read as a flake. By year's Change now says "refunded, net $X" when the year has a gift; the fixture's Pell
  Varga (a gift and its refund in one year) holds it every run: red on the old wording, green after.

The pairs live in `tests/lib/truth4Pairs.js` (surfacesAgree's check `truth4`), on the fixture in
`tests/lib/truth4Fixture.js`, run by `tests/truth4-surfaces.test.js`.
