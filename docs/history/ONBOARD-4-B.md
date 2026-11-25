# ONBOARD-4 Part B · After the call and the close link (24 Nov 2026)

Jonathan, 23 Nov: nobody signs up cold; every org signs through the close link after a call. Part B is
what she sees after that: one guided setup on Home, a way to hand over her file, and a Stuck column so
Jonathan sees who has stalled.

- **Item 4: the guided setup** (`server/onboard/guided.js`, `guidedRoutes.js`, `GuidedSetup.jsx`). Five
  steps read from what happened, never ticked by hand: Make it yours (logo, colours, fiscal year), Bring
  your people (done at ONBOARD-3's "Looks right"), See who to call (ONBOARD-3's first session, embedded
  as the step, not a second card), Connect what you use (Stripe first; QuickBooks and Mailchimp say "Can
  wait"), Invite your team. A skip is the one stored fact (`onboard_guided.skipped`); the current step is
  the first neither done nor skipped, so she resumes on any device. It replaces "Getting set up" on Home;
  Settings still draws ONBOARD-2's five stages. Step 2 shows three ways side by side; the giving way says
  how far back each source's gifts reach (count and oldest date of `source = 'stripe'` / `giving-source:*`
  gifts), or that Steward reads as far back as the provider keeps.
- **Item 5: Send it to us** (`server/onboard/concierge.js`, `opsConciergeRoutes.js`, `OnboardStuck.jsx`).
  The file is kept on `onboard_concierge_jobs`. The mapper's first pass is the importer's own
  `understand` (shared/sheetRead.js): on the server for CSV/TSV, in the reviewer's browser for a workbook
  (the importer's `readSheetFile`), cells kept so Load writes exactly what was reviewed. Load is
  `routes/sheetImport.js` `INTERNAL.commit`, the same job as the import modal's, so the run is a sheet
  import in her Imports with its Undo, stamped with the person who pressed Load. A required question the
  importer asks refuses Load with its own sentence; that file is imported by hand in a support session.
  Her states: Received, Being mapped, Ready for you to check (Load ran), Loaded (Looks right on or after
  the load); an undone load reads Being mapped again. The file she attached at booking (Part A's
  `sales_bookings`) is offered as already waiting, read through `server/admin/sales/bookingFiles.js`
  because only that folder may name a `sales_` table.
- **Item 6: Stuck** (`server/onboard/stuck.js`). Five rules from timestamps already kept, one row per org
  for the three org rules (earliest step first), drafted notes Jonathan sends himself (Copy, or his own
  mail). Nothing sends. The board's old "Stuck: N" (ONBOARD-2's past-its-window count) is now "Late: N",
  so the page never shows two different "Stuck" numbers.
- **What the walk found and fixed.** Every org now signs through a close link, and ONBOARD-1/2/3 only
  knew paper, start links and verbal yes: a close-link org's first file never made "Does this match your
  old system?" due (`totals.markDue`), the board showed it at Paper with "Send start link", and Home did
  not treat it as onboarding. A completed close link now counts in `markDue`, `inOnboarding`,
  `boardOrgIds` and the paper gate (`signals.readFacts`, signer = the link's contact). §1b was red before.
  "Once your donors are in (the first step above)" read wrong under a five-step card; it says "the step
  above" now.
- Planted defects, each red: `autoload` (§1), `nowindow` and `noclose` (§3), ONBOARD4B_PLANT on the server.
