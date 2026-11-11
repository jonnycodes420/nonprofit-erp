# ACCESS-3 · A cabinet member's Home that feels made for them (2026-11-11)

Jonathan walked Home as a Campaign cabinet member on 10 Nov. It worked, but read unfinished: an empty
band between the Atlas box and the Thread (ACCESS-2B flagged it), a right rail holding one "Today" line
in an otherwise blank column, the org's name and the greeting run together above the date, and Export
CSV on the Donors list for someone whose export is off.

What changed, and why:
- **No empty band.** For a portfolio user (`lib/portfolioRoutes.js isPortfolioUser`, the sign-in flag)
  Home draws no slot for what is closed to them: the moves deck has no wrapper, and the Ask box's two
  reserved rows (suggestions, the agent's line) draw only with something in them (`AskHero collapse`).
  Those rows were reserved by SHIFT-2 so late words never push the page; for this user the reads behind
  them are closed, so they would stay blank forever. The first Thread block loses its top margin
  (`homeGrid.js .home-shell-scoped`). Found on the walk: Home holds its sections until the deck settles
  (FEEL-1 `holdUnderDeck`), and with no deck the Thread never drew; the hold is off for them.
- **Your portfolio.** `GET /home/portfolio` (server/home/portfolioCard.js, declared "scoped") reads
  shared/numbers through `visibleSql` only: `everyoneCount` (the Donors list's Everyone),
  `givingBetween` over the fiscal year to date (it now takes `visible`), the new
  `givingBetweenByPerson` (top 5; its rows foot to the same span) and `nextSteps.peopleWithStepOverdue`
  (a follow-up or task on the person, not done, day passed; a person once). The next three are open
  tasks and follow-ups on their Top 100 rows, soonest first; a follow-up's next step is mirrored as a
  task (`link_kind 'next_step'`), so a follow-up is read only without an open mirror. Someone who sees
  everyone gets `{ scoped: false }`: for them "Your" would be the whole org. An empty portfolio is the
  sentence "No one is assigned to you yet. Ask your admin to assign donors." The figures carry their
  sentences and open their lists (Donors, Tasks overdue), not the `<Figure>` drawer: `/figures/*` is
  closed to portfolio users, and opening it for them is its own piece of work.
- **The header.** For them the date is the headline, the greeting (POLISH-8's, the org's hour) its own
  line, the org's name small under it (`HomeFirstLook.jsx scopedHead`). Everyone else's header is as it was.
- **Export.** The gate refused a cabinet export with 404, the person-scope answer. Export is a
  capability, not a person, so it is now 403 with a sentence (`portfolio.js NO_EXPORT`); it names no one.
  The Donors list hides the button when `/me` says `canExport: false` (`portfolioAccess.useCanExport`).

Tests: `tests/access3-home.test.js` (the build's one new suite): §card each figure equals shared/numbers
over exactly the fixture's people; §empty; §admin; §export 403; in a browser, §band (no gap over 64 px in
the work column, the Thread under Ask), §rail, §head, §button, and §same (an admin's Home has main's
shape, snapshot in `tests/fixtures/access3-admin-home.json`, captured from main's build). Red on main in
§band, §rail, §head, §button, §export. Planted: the card read org-wide is red in 11 checks.
`access2-portfolio` §5 now expects the cabinet export's 403.
