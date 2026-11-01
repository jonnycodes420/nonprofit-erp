## PROFILE-1 (header) · The donor profile, one header and one row of tabs (2026-10-14)

Before: seven white number boxes under the header, a six-tab row halfway down, then "Everything with" and
its own chips doing the same job again, and The Ask, household, planned giving, membership and sequences
stacked below with big buttons. After (approved mockup "Donor profile header mockup", 14 Oct): the seven
numbers sit in the header (`ProfileHeaderFigures.jsx`; This year is new, `donor-gifts-between` from
1 January; the line under Last gift, Last met and Last email is read off that figure's own first row); one
row of ten tabs replaces both the tabs and the chips (the list tabs are `RelationshipTimeline` with `fixed`,
counted by `buildTimelineItems`); the Overview is meeting, How did it go, Lately, one ask card with the
stage bar, Highlights and an About card; the rail reads `GET /donors/:id/rail` (rhythm, recurring,
thank-yous, coming up, contact flags, volunteering, connected; `donor-gifts-from` is the new source). The
proposals are read once (`useDonorProposals`). Where every old clickable went: `docs/profile-1/inventory.md`,
checked row by row by `tests/profile1-everything-clicks.test.js`.
