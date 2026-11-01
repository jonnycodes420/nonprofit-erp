# The house: decisions that hold across every area

Read this when you touch anything: these hold in every domain. The rules they come from are in
`docs/architecture/ARCHITECTURE.md`; each area's own decisions are in its file here.
Seeded by ARCH-1 (1 Nov 2026).

## Decisions

- **A soft credit is not money in a total.** A soft or matching credit is recognition. It is never
  in lifetime giving, a campaign total, a goal, an average or a donor's portal total; it shows as
  its own "Soft credit" figure with the gifts behind it. A matching gift is money, credited to the
  company, and the employee gets a soft credit. `creditTypes.js` says which rows are credits.
  (Jonathan, 25 Oct 2026, FIX-49.)
- **The weekly email is the default for new people.** Everyone new starts with one email a week,
  "Your week", and nothing else; the daily morning email is a click away in Settings → My email.
  Existing people keep what they had. (Jonathan, 31 Oct 2026, STAFF-MAIL-2.)
- **One fiscal year everywhere, labelled with its dates.** The org's setting
  (`fiscal_year_start_month`) is the only fiscal year. Every screen, report, email and export that
  says "this year" means it, computed by `orgTime.orgPeriodBounds(org, "fiscal_year")`, and labels
  it with its span ("FY 2026–27", or "FY 2026" when it is the calendar year). A screen that means
  the calendar year says "2026" and computes the calendar year on purpose. (BUILD-86, FIX-10,
  ARCH-1.)
- **Steward is one modular monolith.** One deployable, split inside by domain (`server/<domain>/`),
  layered for the core, plug-ins for integrations and import readers, a queue for background
  work. Not microservices. (ARCH-1.)
- **No org-specific code.** No code path for one customer; differences between orgs are settings
  or data. The `org-specific` ratchet counts org ids in app code and may only go down. (ARCH-1.)
- **Tests set their own clock.** A test that depends on the date fixes its own date through
  `tests/clock.js`, with boundary tests for midnight UTC, month end at 11 PM ET, fiscal year end
  and the DST change. The weekend pin stays until no test reads the real clock. (FIX-42, ARCH-1.)
