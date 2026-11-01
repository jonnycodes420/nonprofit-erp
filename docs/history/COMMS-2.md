## COMMS-2 · templates in the org's voice, and better statements (2026-10-02)

- **Brand kit** (Settings → Brand kit): two colours from the safe palette in `shared/brandKit.js`, the
  signature block, the address and the tax language. The logo, signer and address are the columns
  receipts already read, so there is still one store for each. The tax language replaces the
  default footer sentence on receipts and statements; the EIN always follows it.
- **Template library** (Communications → Templates): ten kinds with Steward's plain starting words in
  `shared/brandKit.js`, saved per org in `message_templates`. A template is "Not yet reviewed" until
  someone saves it, and cannot be used until then. An email becomes a draft in Drafts to review; a
  letter prints in the kit's colours. Live preview against any person; unknown merge fields are
  refused at save, and a field the person has no value for blocks use rather than printing a gap.
- **Statement money is one function**, `statementTotals.js`, in cents. It fixed two real defects: a
  partially refunded gift kept its old `deductible_amount`, so both a statement and the gift's own
  receipt could claim more was deductible than was given; and a gift whose dispute was lost stayed
  on the statement. The gift receipt now uses the same function.
- **"Your year with us"** on the year-end statement: hours volunteered and events attended that year,
  on by default, off in the brand kit. Facts only; never part of a total.
- **Seed:** the kit filled in, receipts switched on for the demo (its mail stays off), and three
  templates reviewed in Harborlight's own words.
