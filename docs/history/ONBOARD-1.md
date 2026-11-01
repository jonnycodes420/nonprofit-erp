## ONBOARD-1 · "Set up Steward for me": the onboarding agent does the hard part (2026-10-18)

Before: a new org was a dozen screens by hand (profile, receipts, branding, funds, a two-file import through the
mapper, templates, journeys, invites), usually Jonathan's on a call. After: a Setup screen (`/setup`, where a new
org now lands; also Settings → Organization and super-admin's "Run setup for this org") takes the donor files, the
website and the gift tools, and shows a plan in three groups before anything happens. One Start runs the steps on
the server through the screens' own routes (`agentCall.js`), so it survives a closed tab. Every row it creates or
changes is an `agent_writes` row under one `agent_runs` row, and "Undo all of setup" walks that ledger in reverse;
the import is reversed by its own route, recorded under the reversible `gift_file_with_donors` shape. The pieces:
`setupSite.js` reads a few public pages in code (robots, no private hosts, four pages); `shared/setupFiles.js` treats
every file as a sheet of one workbook for `buildWorkbookSubmission` and applies Salesforce's Closed Won rule first;
`setup.js` holds the steps, the ledger and the undo; `routes/setup.js` the routes; `shared/agentPersonas.js` gains
SETUP (not a card, no engine tools). It never sends: staff invitations are `setup_invites` rows until her Send,
journeys are created with `enabled:false`, receipts stay off. Defects only the walk, the eye or the battery
caught, each now a red-before assertion: a hyphenated surname split into the title; the import's own readout
landing after "Steward is ready" and taking Home's row (setup now waits for the import's job); the director
running setup invited to her own org; the logo address skipping the private-host wall; and the cleanup script
proposing to DELETE the new, empty Riverbend demo (it joined `DEMO_ORG_IDS` in `orgKind.js`). Seed changed (`scripts/seed/onboard1-setup.js`, a second demo org,
Riverbend Food Pantry, before setup, with its site and export in `scripts/demo-sites/riverbend/`, served at
`/demo-site/riverbend/`). The inventory is `docs/onboard-1/inventory.md`.
