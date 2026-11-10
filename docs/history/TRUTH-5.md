# TRUTH-5 · Amounts mean what their label says (9 Nov 2026)

The fleet (lead-2026-11-09) read amounts under labels that named something else: a lifetime under a period
question, a trust's row holding a person who only gives through it, linked people's lifetimes under a trust's
"Through" list, an import's stated count beside a list of fewer gifts. Each had one cause: a reader that took the
nearest stored figure instead of the one the label asks for.

- **A period question (W-1109-Atlas-01).** The query layer lists a person with `donors.total_giving`, and the Ask
  answer printed it beside each name, unlabeled, under "who gave last December". `shared/numbers/periodAmounts.js`
  reads the question's window from the plan (the first gift condition that is not a "nothing since") and each
  person's money in it by givingBetween's rule; Lifetime (lifetime.js) is beside it, labeled. "How Steward read
  this" is the plan's words plus the basis read from the same window (`readWords`). Atlas's list reads the same
  module. The rows are parts of the window's whole, so they can never add to more.
- **Gives through (W-1108-Fundraising-07).** INTEGRITY-1's LYBUNT units joined an `owner` link like a household, so
  Louisa's $2,659 sat inside Marlowe Charitable Trust's row and the header counted 307 rows over 308 people. A unit
  is now a household (or the household whose primary record the person is) or a spouse, partner or "same
  household" link (`households.js UNIT_LINK_TYPES`). Owner and Works at are listed beside the row, "Also
  connected", with that person's own amount on their own row.
- **The Through list (W-1109-Finance-37X).** An organization's linked people showed their lifetimes. They show
  soft credit on the organization's own gifts now (`shared/numbers/softThrough.js`), under one line: "$4,682 given
  through this organization, by 3 people".
- **Gift counts (W-1109-Finance-35X).** The Directory read the stored rollup, which is an import's stated count plus
  gifts after it (6), above a Giving tab of 5 rows. The Directory's column, its sort and filter, the export, the
  profile and Top donors read `giftCount.js DONOR_GIFT_COUNT` (gifts on file). The stored rollup is unchanged.
- **$0 rows (W-1107-Donors-21X).** The label is "$0, not counted, not a last gift". The event gift that "did not
  move Reports" did not reproduce (three paths tried); a test now holds it.
- **One word, one population (W-1108-Fundraising-15).** `shared/lapseWords.js`: LYBUNT (last fiscal year, not this
  one), Lapsed (12 to 24 months), Lost (over 24 months), each defined on hover where it shows.
- **Fundraising Overview (W-1109-Fundraising-07).** `?period=this_fy|last_fy|custom` (`server/reports/
  overviewPeriod.js`), read by the one computation Reports reads; a LYBUNT figure beside it is the report's header.
- **Pledges from before installments (W-1107-Finance-20).** `shared/numbers/pledgeSchedule.js`: one installment of
  the whole amount, payments applied oldest first; the sidebar shows every schedule, each payment on its
  installment.
