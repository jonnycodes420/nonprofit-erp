## POLISH-2 · Every word sounds like us: the copy and craft sweep from PREMIUM-1 (2026-10-13)

Built as the lead (the audit's copy table, engineer-speak, the test) plus three forks in their own
worktrees: A American spelling, B missing spaces and the Imports list, C one way to say each thing.
- 378 en-GB spellings to US in UI, emails, PDFs, help, marketing, `shared/dashboards.js`, the demo
  banner and seed text; stored values and import parsers kept. Giving page cover-fee line through `fmtFull`.
- 15 of the 24 copy-table rows applied here; POLISH-1 had already done 9, 15-20 and 24. With Jonathan's
  changes: import tiles read "We're moving from DonorPerfect"; volunteers name VolunteerHub and
  SignUpGenius ("Wranglr" could not be verified as a product and was dropped from what people read);
  "Undo removes everything this import added."
- Thank-you drafts: "Dear <first name>," and "With thanks," + sender (signed at read time by whoever opens
  the queue) + org. `fin_funds.public_name` (new, editable on the fund) or "where it's needed most" for
  the org's general fund. TRAP: the first version asked `orgUnrestrictedFundId`, which HEALS the ledger
  and created a fund in connect2-sources' fixture org; a draft now reads the fund with a plain SELECT.
- LYBUNT/SYBUNT renamed in Reports ("Gave last year, not this year"); the rail search still finds "lybunt".
  `shares-id:` joined `has-refused-rows:` as an internal tag; GET /journeys filters both.
- Missing spaces: the audit's "thisweek"/"says969" came from its page reader joining text nodes, not from
  the screen. The six seams were made single text nodes anyway; the static guard was 0 on main.
- Competitor-name bans retired in landing2-marketing and landing-prod-verify (13 Oct rule).
- Next build: Home Thread row reads "Next: meridian Foundation" (lowercased name in a step sentence).
