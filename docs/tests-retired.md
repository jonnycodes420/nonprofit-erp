# Retired tests (CHORE-2)

238 suites were removed from `tests/` in CHORE-2. Every one of them is
intact in git at **`921bc4dd466fa8557a977b72c30d7fb315ed42e9`**, and any of them comes back with one command:

```sh
git checkout 921bc4dd466fa8557a977b72c30d7fb315ed42e9 -- tests/<name>.test.js
```

then add its name back to `CORE` in `tests/run-all.sh`. Some also need a
fixture directory that went with them:

```sh
git checkout 921bc4dd466fa8557a977b72c30d7fb315ed42e9 -- tests/fixtures/<dir>
```

Retired with them: `tests/fix2-b-fixture.js`, `tests/state-diff.lib.js`,
`tests/state-diff.manifests.js`, `tests/state-diff2.manifests.js`, and the
fixture directories `build101-members`, `build79`, `build84`, `build92`,
`build97`, `mapper`, `portal-images` and `fix1-fundraising-before.json`.

## Why, and what replaced them

The battery had grown to 272 suites and twenty minutes. CHORE-2 kept the 34
that guard **money, donor data, email and security**, added one `smoke-walk`
that opens every route and every donor-profile tab and fails on a blank
screen, an error boundary, a 5xx or a console error, and retired the rest.

What that trades away is real and worth naming: these suites held the copy,
the layout, the per-screen numbers and the design-system rules. Several of
them caught genuine defects in the week they were retired — `fix2-c-cream`
caught an emerald-count violation on the donor profile hours before this
commit, and `presentation-wiring` caught a lifetime figure that under-
reported every donor with imported history. Those classes of defect are now
caught by review and by the walk, not by the battery.

## The list

| suite | what it held |
|---|---|
| `actor-stamp` | BUILD-75 C.1 — THE ACTOR ON EVERY WRITE. |
| `asset-retention` | BUILD-56 — asset retention & undo. |
| `attribution-completeness` | Attribution completeness (FIX, 2026-08-04) — every money path attributes, |
| `billing` | BUILD-24 — platform billing cutover (Core $149 / Team $299 subscriptions). |
| `billing-config-error` | Billing config-error classification + wiring guard (FIX 2026-07-29). |
| `bookkeeper-export` | BUILD-87 Part 4 — THE BOOKKEEPER'S EXPORT. Run: node  |
| `brand-allowlist` | BUILD-33 Part 4 — the HARD token allowlist. Every color literal in active |
| `brand-glyph` | grep-guard (FIX 2026-07-29 — retire the hexagon/diamond mark |
| `branding` | BUILD-13 Part 2 — Org branding suite. |
| `build100-deadlines` | BUILD-100 (grants) Part 2 — DEADLINES THAT COME AND FIND YOU. |
| `build100-documents` | BUILD-100 (grants) Part 3 — THE FILES A GRANT CARRIES. |
| `build100-funders` | BUILD-100 (grants) Part 1 — FUNDERS AND GRANTS. |
| `build100-import` | BUILD-100 (grants) Part 6 — READING SOMEBODY ELSE'S GRANT SPREADSHEET. |
| `build100-reports` | BUILD-100 (grants) Part 5 — REPORTS, AND THE AGENT THAT DRAFTS AN OUTLINE. |
| `build100-restricted` | BUILD-100 (grants) Part 4 — WHERE RESTRICTED MONEY ACTUALLY IS. |
| `build100-score-names` | BUILD-100 — A NUMBER BESIDE A PERSON'S NAME MAKES A CLAIM. |
| `build100-screens` | BUILD-100 (grants) Part 7 — THE SCREENS, WALKED. |
| `build101-import` | BUILD-101 Part 6 — MEMBERSHIPS FROM A FILE. |
| `build101-lapsed` | BUILD-101 Part 3 — LAPSED MEMBERS ARE THEIR OWN LIST. |
| `build101-memberships` | BUILD-101 Part 1 — LEVELS AND MEMBERSHIPS. |
| `build101-online` | BUILD-101 Part 4 — SELLING IT ONLINE. |
| `build101-renewals` | BUILD-101 Part 2 — RENEWALS THAT COME AROUND. |
| `build101-reports` | BUILD-101 Part 5 — DIRECTORY, CARD AND REPORTS. |
| `build102-attribution` | BUILD-102 (Steward Give) Part 5 — THANK-YOU, RECEIPT AND ATTRIBUTION. |
| `build102-embed` | BUILD-102 (Steward Give) Part 4 — EMBEDDING ON THE ORG'S OWN SITE. |
| `build102-extras` | BUILD-102 (Steward Give) Part 3 — TRIBUTES, MATCHING AND CUSTOM QUESTIONS. |
| `build102-form-config` | BUILD-102 (Steward Give) Part 1 — A FORM IS A GIVING PAGE WITH A FORM CONFIG. |
| `build102-funnel` | BUILD-102 (Steward Give) Part 6 — ANALYTICS, AND A SIMPLE A/B. |
| `build102-steps-upsell` | BUILD-102 (Steward Give) Part 2 — MULTI-STEP, WALLETS, AND THE UPSELL. |
| `build65` | BUILD-65 — what the storage migration left behind. |
| `build84` | BUILD-84 — the four defects, the two censuses, and the timed step reminder. |
| `build85` | BUILD-85 — THE FOLLOW-UP ENGINE. Run: node  |
| `build86` | BUILD-86 Part A — HOME, AND THE BOARD MEETING. Run: node  |
| `build88a-finance` | BUILD-88a A.3 — FINANCE, EDITABLE AND FED. Run: node  |
| `build88a-giving` | BUILD-88a A.6 — GIVING, NOT REVENUE. Run: node  |
| `build88a-mapper` | BUILD-88a A.7 — THE MAPPER, CORRECTED. Run: node  |
| `build88a-one-task` | BUILD-88a A.2 — ONE TASK, EVERY SCREEN. Run: node  |
| `build88a-profile` | BUILD-88a A.4 — THE PROFILE, TIDIED. Run: node  |
| `build88a-week` | BUILD-88a A.5 — THE WEEK IN REVIEW IS THE ACTIVITY REPORT. |
| `build88b-deposit` | BUILD-88b B.1 — THE DEPOSIT SHEET. Run: node  |
| `build88b-pledges` | BUILD-88b B.2 — PLEDGES THAT KEEP THEMSELVES. |
| `build88b-thankyous` | BUILD-88b B.3 — THANK-YOUS, DRAFTED. Run: node  |
| `build88c-composer` | BUILD-88c C.2 — NEVER A BLANK BOX. Run: node  |
| `build88c-domain` | BUILD-88c C.1 — HER OWN DOMAIN, VERIFIED. Run: node  |
| `build89s-paypal` | BUILD-89S 89b — PAYPAL. Run: node  |
| `build89s-presets` | BUILD-89S 89d — STATEMENT PRESETS. Run: node  |
| `build89s-sources` | BUILD-89S 89a — GIVING SOURCES: THE PIPE. |
| `build89s-stripe-givebutter` | BUILD-89S 89e — STRIPE (THEIR OWN) AND GIVEBUTTER. |
| `build89s-surfaces` | BUILD-89S 89f — WHERE SHE SEES IT. Run: node  |
| `build89s-zeffy` | BUILD-89S 89c — ZEFFY. Run: node  |
| `build91-public-sources` | BUILD-91 91i — THE PUBLIC SOURCE ROW, AND THE THREE THINGS THAT GATE IT. |
| `build92-close-existing` | BUILD-92 — CLOSING AN ORGANISATION THAT ALREADY EXISTS. |
| `build92-close-screen` | BUILD-92 B1 — THE CLOSE LINK SCREEN. Run: node  |
| `build92-dedupe` | BUILD-92 A3 — THE SAME GIFT FROM TWO PLACES (was BUILD-91 91a). |
| `build92-home-proportions` | BUILD-92 B3 — HOME PROPORTIONS. Run: node  |
| `build92-seed` | BUILD-92 A1 — THE DEMO SEED, ON A GENUINELY FRESH DATABASE. |
| `build92-source-errors` | BUILD-92 A2 — GIVING-SOURCE ERRORS THAT TELL THE TRUTH. |
| `build92-sources-page` | BUILD-92 B2 — WHERE GIFTS COME IN. Run: node  |
| `build92-statement` | BUILD-92 A4 — ANY STATEMENT, REMEMBERED (was BUILD-91 91b). |
| `build93-civil-date` | BUILD-93 Part 1 — A DATE WRITTEN FOR AN ORGANISATION IS THE ORG'S CIVIL DATE. |
| `build93-paypal-request` | BUILD-93 Part 3 — THE EXACT REQUEST SHAPE PayPal IS ASKED FOR. |
| `build93-superadmin` | BUILD-93 Part 2 — A SUPER-ADMIN IS NOT AN ORG ADMIN'S TO REMOVE. |
| `build94-bulk` | BUILD-94 Part 4 — WHAT MAILCHIMP DID THAT STEWARD NOW HAS TO DO. |
| `build94-calendar` | BUILD-94 Part 5 — PUT IT ON MY CALENDAR. |
| `build94-people` | BUILD-94 Part 2 — PEOPLE WHO ARE NOT DONORS. |
| `build94-photo` | BUILD-94 Part 1 — A FACE ON EVERY PROFILE. |
| `build94-sequences` | BUILD-94 Part 3 — SEQUENCES. |
| `build94-welcome` | BUILD-94 FIRST RUN — the greeting an organisation gets once. |
| `build95-cheque` | BUILD-95 — A PICTURE OF THE CHEQUE. |
| `build95-cheque-read` | BUILD-95 — READING A CHEQUE, AND REFUSING TO GUESS ONE. |
| `build95-square` | BUILD-95 §5A — READING AN ORGANISATION'S SQUARE. |
| `build96-photos-folder` | BUILD-96 Part 5 — A FOLDER OF PHOTOS, AND THE FACES IT REFUSES TO GUESS. |
| `build96-sample-data` | BUILD-96 Part 2 — CLEARING SAMPLE DATA OFF A REAL ORGANISATION'S ORG. |
| `build96-verifying` | BUILD-96 Part 4 — ZEFFY AND SQUARE, HONEST ON EVERY SURFACE. |
| `build97-agent` | BUILD-97 Part 3 — THE AGENT YOU CAN TELL WHAT TO DO. |
| `build97-audiences` | BUILD-97 — AN AUDIENCE IS A THING WITH A NAME. |
| `build97-npsp` | BUILD-97 Part 1 — SALESFORCE NPSP: THE PRESET, AND THE THREE THINGS IT |
| `build97-numbers` | BUILD-97 Part 2 — EVERY NUMBER ON SCREEN HAS A SENTENCE UNDER IT. |
| `build97-observability` | BUILD-97 Part 5 — OBSERVABILITY, BECAUSE YOU CANNOT RUN WHAT YOU CANNOT SEE. |
| `build97-part0` | BUILD-97 Part 0 — WHAT BUILD-96 LEFT, AND THE FILE grep COULD NOT SEE. |
| `build98-api` | BUILD-98 (switch) Part 6 — THE PUBLIC API, AND A WEALTH SCREEN THAT SURVIVES AN IMPORT. |
| `build98-credit` | BUILD-98 Part 1 — SOFT CREDITS, TRIBUTES AND MATCHING GIFTS. |
| `build98-events` | BUILD-98 (switch) Part 4 — THE DONOR SIDE OF A GALA. |
| `build98-letters` | BUILD-98 (switch) Part 2 — ACKNOWLEDGMENTS AND LETTERS THAT PRINT. |
| `build98-migration` | BUILD-98 (switch) Part 7 — MIGRATION THAT MAKES SWITCHING CHEAP. |
| `build98-photos` | BUILD-98 — A FACE IS ATTACHED TO THE PERSON, NOT TO ONE SCREEN. |
| `build98-reports` | BUILD-98 (switch) Part 3 — REPORTS PEOPLE CAN BUILD. |
| `build98-security` | BUILD-98 (switch) Part 8 — TWO-STEP SIGN-IN FOR ADMINS, AND EVERYTHING IN ONE FILE. |
| `build98-volunteers` | BUILD-98 (switch) Part 5 — VOLUNTEERS AND HOURS. |
| `build99-brief` | BUILD-99 (major gifts) Part 4 — THE PROSPECT BRIEF. |
| `build99-dashboard` | BUILD-99 (major gifts) Part 5 — THE MAJOR-GIFTS DASHBOARD. |
| `build99-grant-timeline` | BUILD-99 — A TOUCHPOINT YOU CANNOT READ IS NOT A RECORD. |
| `build99-import` | BUILD-99 (major gifts) Part 6 — IMPORT AND EXPORT. |
| `build99-plans` | BUILD-99 (major gifts) Part 3 — CULTIVATION PLANS. |
| `build99-portfolios` | BUILD-99 (major gifts) Part 2 — PORTFOLIOS. |
| `build99-proposals` | BUILD-99 Part 1 — PROPOSALS. |
| `campaign-impact` | BUILD-54 §2 — gifts wired to campaign impact (+ §3 engagement endpoint and |
| `chore2-sharding` | (no header line) |
| `claude-md` | CHORE-1 — CLAUDE.md stays lean, and every decisions file it points at exists. |
| `concurrency` | BUILD-27 Part C — concurrency & multi-user battle test. |
| `concurrency2` | BUILD-44 Part 5 — concurrency additions (extends tests/concurrency.test.js). |
| `cover-fees` | BUILD-08 Phase B — donor-covers-fees verification. |
| `custom-fields` | BUILD-78 Parts 1 + 5.3 + 6.3 — custom fields, grown up. |
| `custom-fields-roundtrip` | BUILD-78 Part 6 — THE ROUND TRIP IS THE PROOF. The export rendering |
| `dashboards` | BUILD-86 C.3 — FOUR DASHBOARDS. Run: node  |
| `date-seam` | BUILD-72 Part 4 — DATE BOUNDARIES IN THE ORGANIZATION'S TIMEZONE. |
| `demo-content` | guard (BUILD-54 follow-up, 2026-08-15). Pure Node, no DB. |
| `demo-shape` | BUILD-73 Part 3.2 — THE DEMO'S SHAPE, ASSERTED. |
| `deploy-shape` | BUILD-79 Part 7.3 — THE DEPLOY ARTIFACT IS A CODE PATH. |
| `designations` | BUILD-14 Parts 2-3 — Constituent designations / planned-giving tagging. |
| `digests` | BUILD-17 — Development reporting cadence: digests. |
| `donor-accounts` | BUILD-46 §1.1 — global donor accounts: signup/verify/login/reset lifecycle, |
| `donor-dashboard` | BUILD-46 §2 — the cross-org donor dashboard is a VIEW: every figure equals |
| `donor-field` | BUILD-73 Part 4 — THE DONOR FIELD'S PROPERTIES. |
| `donor-front-door` | BUILD-49 — the donor front door: /giving as a real landing page + the |
| `donor-linking` | BUILD-46 §1.2 — identity linking: EXACT match on VERIFIED emails only, |
| `donor-merge` | BUILD-08 Phase C — duplicate detection + merge verification. |
| `donors-pagination` | BUILD-06 Phase A verification: server-side donor pagination/filtering, |
| `drift` | BUILD-76 — MAKE DRIFT REAL, AND PROVE IT. |
| `email-links` | Canonical email base URL — guard suite (FIX 2026-08-04). |
| `email-polish` | BUILD-35 Part 2 — email polish, proven on REAL captured email bytes. |
| `empty-states` | BUILD-44 Part 6 — empty/thin-state sweep. TESTS ONLY. |
| `export-zip` | Full-org CSV zip export (BUILD-03's uncommitted verification, rebuilt as the |
| `external-fixture-provenance` | BUILD-58 Part 3 — the property that generalizes the BUILD-57 §2a lesson |
| `finance-entity-routing` | Finance entity-routing FIX (2026-08-04) — donor/grant money enters through |
| `finance-funds` | BUILD-21 Part 2 — Funds view crash insurance. |
| `finance-overview` | BUILD-10 Part 3 — Finance Overview credibility + copy verification. |
| `finance-reintegration` | BUILD-09 — Finance reintegration verification. |
| `finance-reports-consistency` | BUILD-26 Part B1 — Finance ↔ Reports can never be read as contradictory. |
| `first-login-matrix` | BUILD-58 W-2 — no first login may dead-end. Every combination of |
| `fix1-agent` | FIX-1 §A — STEWARD AGENT, ITS OWN PRODUCT. |
| `fix1-finance` | FIX-1 E — FINANCE THAT EARNS ITS PLACE. |
| `fix1-fundraising` | FIX-1 §B — FUNDRAISING, REORGANISED. |
| `fix1-institutional` | FIX-1 — HOME'S INSTITUTIONAL LIST SAYS WHAT EACH ORGANISATION GAVE. |
| `fix1-people` | FIX-1 D — PEOPLE, WITHOUT THE LECTURE. |
| `fix1-volunteers` | FIX-1 WORKSTREAM C — VOLUNTEERS, ITS OWN HUB. |
| `fix1-walk` | FIX-1 PART 0 — WHAT THE WALK FOUND, AS ASSERTIONS BEFORE FIXES. |
| `fix2-a-dashboards` | FIX-2 A — DASHBOARDS A BOARD CAN READ, AND EVERY NUMBER ON THEM OPENS. |
| `fix2-a-footing` | FIX-2 A — EVERY NUMBER OPENS, AND WHAT IT OPENS ADDS UP TO IT. |
| `fix2-b-reports` | FIX-2 B — REPORTS, ONE WAY IN. |
| `fix2-c-cream` | FIX-2 C — LESS GREEN, MORE CREAM (claude/FIX-2.md Part 0 finding 5, Part C). |
| `fix2-c-hex` | FIX-2 C — ZERO HEX LITERALS OUTSIDE THE TOKENS (claude/FIX-2.md Part C, Tests). |
| `fix2-codeql` | FIX-2 F — THE CODEQL FOUR. |
| `fix2-d-agent` | FIX-2 D — THE AGENT ROOM, AND THE AGENT YOU CAN TURN ON. |
| `fix2-e-grant-word` | FIX-2 finding 9 — "last grant" ON CHURCHES AND BUSINESSES. |
| `fix2-e-no-iso` | FIX-2 finding 10 — NO ISO DATE ON ANY SCREEN. |
| `fix2-e-profile` | FIX-2 finding 11 — THE DONOR PROFILE'S "day 0" AND ITS RED. |
| `fix3-a-home` | FIX-3 A — HOME'S BOTTOM HALF. Run: node  |
| `fix3-b-agent` | FIX-3 B — THE AGENT'S ASK (claude/FIX-3.md Part 0, findings 4–7). |
| `fix3-c-demo-giving` | FIX-3 C, finding 14 — THE DEMO GIVES LIKE A REAL MID-SIZED NONPROFIT. |
| `fix3-c-demo-people` | FIX-3 C, finding 8 — NO REAL PERSON IN THE DEMO. |
| `fix3-d-lock-flash` | FIX-3 finding 9 — NOTHING RENDERS AS LOCKED UNTIL THE ORG'S PLAN IS KNOWN. |
| `fix3-d-suggestion` | FIX-3 finding 11 — THE SUNRISE SUGGESTION. |
| `fix3-e-reports` | FIX-3 E — REPORTS: THE RAIL REGROUPED, AND ONE "SAME POINT LAST YEAR". |
| `fundraising` | BUILD-11 — Fundraising tab verification. |
| `gift-attribution` | BUILD-32 Part 1 — gift → campaign attribution. |
| `giving-flow-brand` | BUILD-60 — THE GIVING PAGE IS THE ORG'S PAGE (permanent battery). |
| `giving-page-builder` | BUILD-95 §5B — THE GIVING-PAGE BUILDER. |
| `giving-summary` | BUILD-64 Part 4 — the giving summary is the donor's own page. |
| `goals` | BUILD-16 Part 2 — typed, multiple, roll-up fundraising goals. |
| `greeting` | BUILD-36 B3 — greeting windows. |
| `guards` | Small-fix #1 — guardsOk must not false-alarm on every deploy. |
| `home` | BUILD-16 Part 1 — Home command center (GET /dashboard/home). |
| `home-layout` | BUILD-34 — customizable Home (per-user section layout). |
| `households` | BUILD-14 Part 1 — Households / soft credit suite. |
| `impact` | FIX — honest "what Steward has done for you" number (GET /impact). |
| `import-assign` | FIX — Team onboarding: assign donors to officers on import. |
| `import-both` | FIX — "Import both" for a multi-sheet workbook (Donors + Gift History). |
| `import-combined` | FIX — magical one-file import (server side): a transaction/gift-ledger file |
| `import-header` | BUILD-79 Part 1 — FIND THE HEADER, DON'T ASSUME IT. |
| `import-messy-cf` | BUILD-78 — THE CUSTOM-FIELD GOLDEN. steward-messy-cf.csv (seed 20260905, |
| `import-messy-v2` | BUILD-79 — THE REPORT EXPORT, pinned forever. |
| `import-sentence` | BUILD-87 Part 2 — THE MOMENT AFTER IMPORT. Run: node  |
| `import-shape` | FIX — magical one-file import: shape AUTO-DETECTION + transaction grouping. |
| `import-stage` | FIX — smart initial stage on import (infer from giving history via inferStage). |
| `import-workbook-server` | BUILD-82 — the SERVER half of the workbook layer: |
| `imports-history` | BUILD-87 Part 1 — NAMED IMPORTS AND HISTORY. Run: node  |
| `inbound-email` | BUILD-87 Part 3 — EMAIL LOGGING BY BCC. Run: node  |
| `invitation` | pivot (2026-08-06) — POST /invitation-request contract. |
| `invitation-only` | BUILD-87 F.2 — THE PUBLIC SIGNUP IS CLOSED, AND THE PRICE IS REAL. |
| `landing-field` | BUILD-81 Part 4 — THE LANDING PAGE, IN A REAL BROWSER. |
| `landing-reveal` | BUILD-40 P0-1, rewritten by BUILD-73 Part 4 — NO INVISIBLE LANDING CONTENT. |
| `ledger-provisioning` | BUILD-58 W-3 — the chart-of-accounts hole, fixed as an instance AND a class. |
| `legal-entity` | FIX: legal entity name — the permanent guards (2026-09-12). |
| `locked-features` | BUILD-20 Parts 3 + 4 — grouped sidebar + Givebutter-style locked previews. |
| `mapper-one-dropdown` | FIX (2026-09-09) — THE COLUMN-TARGET DROPDOWN IS ONE COMPONENT. |
| `migc` | client-site API suite — drives /api/migc/* (routes/migc.js) against |
| `modal-shell` | BUILD-87 F.1 — ONE MODAL SHELL. Run: node  |
| `money-grammar` | BUILD-80 Part 1 — THE CLOSED MONEY GRAMMAR, every shape pinned individually. |
| `moves` | BUILD-15 — Moves management & prospect pipeline (Team plan). |
| `name-normalize` | BUILD-26 Part B2 — imported-name normalization. |
| `network-directory` | BUILD-47 — find your nonprofits: the directory + the add flow + follows. |
| `network-gate` | BUILD-46 §3 — the network gate: gated self-serve nonprofit signup. |
| `notifications` | BUILD-36 Part A — officer notifications, proven on REAL captured email bytes. |
| `notify-delivery` | BUILD-44 Part 3 — notifications actually ARRIVE. TESTS ONLY. |
| `officer-chip` | BUILD-50 (directory chip fix) — the "Officer portfolios" chip row on the donor |
| `onboarding-brand` | Onboarding brand grep-guard (FIX 2026-07-21 — kill the AI gradient + diamond). |
| `one-date` | BUILD-90 90c — ONE DATE, THREE SURFACES. |
| `page-widgets` | BUILD-95 §5B — THE ONE WIDGET REGISTRY, AND THE GUARD THAT MAKES IT ONE. |
| `palette-census` | BUILD-86 C.1 — THE PALETTE CENSUS. Run: node  |
| `pipeline` | FIX — the pipeline is a portfolio, not the whole donor list. |
| `pipeline-gating` | BUILD-19 — pipeline reconciliation + solid page titles. |
| `portal` | BUILD-45 — donor portal: auth (§2), dashboard wiring (§3), recurring |
| `portal-contrast` | BUILD-59 — WCAG AA over the portal, pinned. Two families: |
| `portal-crop` | BUILD-61 Part 2 — NON-DESTRUCTIVE CROP (banner slot). |
| `portal-designation` | BUILD-55 Part 3 — the portal funds widget's designation + order contract. |
| `portal-page` | BUILD-54 §4 — the portal page: typed widgets, draft/publish lifecycle, |
| `portal-visual` | BUILD-59 — the portal banner, measured in a real browser at every |
| `portfolio-pipeline-consistency` | BUILD-30 — assignment = portfolio = pipeline membership, ONE definition. |
| `portfolios` | BUILD-14 Part 4 — Officer portfolios + color (Team plan). |
| `presentation-wiring` | BUILD-44 Part 2 — presentation wiring: the RENDERED number equals the API |
| `profile1-figures` | PROFILE-1 — THE FOUR NUMBERS AT THE TOP OF A PERSON'S RECORD OPEN. |
| `profile1-screen` | PROFILE-1 — THE DONOR PROFILE, AS APPROVED. Run: node  |
| `recurring-surface` | BUILD-57 Part 1 — the staff recurring-giving surface. |
| `report-truth` | BUILD-33 Part 1 — REPORT TRUTH: every report proven against hand-computed |
| `reports` | correctness (BUILD-02's uncommitted verification, rebuilt as the |
| `reports-cadence` | BUILD-17 — Development reporting cadence: the report views. |
| `reserved-recovered` | BUILD-26 Part B3, replaced by BUILD-73 Part 3 — the OUTCOME-CLAIM BAN. |
| `session-cache` | BUILD-38 Part 1 — SessionCache unit tests (in-process, no server/DB). |
| `setup-checklist` | BUILD-35 — "Set up Steward" activation checklist. |
| `smart-moves` | BUILD-22 — Smart pipeline moves (auto-lapse + un-lapse + suggestions). |
| `solicitations-winrate` | Item 2 (2026-08-08) — /reports/solicitations win rate used the WRONG |
| `state-diff` | BUILD-43 — the WIRING test: full-org state-diff harness. |
| `state-diff2` | BUILD-44 Part 1 — state-diff wiring sweep, B-series (extends BUILD-43). |
| `task-due` | Item 1 (2026-08-08) — the follow-up task badge rendered "Overdue" on a FUTURE |
| `tasks` | BUILD-13 Part 1 — Tasks tab backend suite. |
| `theme-assets` | BUILD-51 — theme-asset storage: base64 theme images (portal header, logo) |
| `theme-depth` | BUILD-48 — theme depth + adaptive takeover, the SERVER side of the contract: |
| `thread-next-step` | FIX (2026-09-09) — the Thread's next step reads the NOTE, and the |
| `thread-nudge` | BUILD-81 Part 2 — THE NUDGE LEAVES THE APP. One email per user per weekday |
| `thread-step-inline` | FIX (2026-09-09) item 3 — THE PROPOSED STEP IS EDITABLE FROM THE ROW. |
| `threads` | BUILD-81 — THE THREAD: the surface behind "log a conversation, get the next |
| `trial-billing` | BUILD-90 90b — THE REMINDER AND THE CANCEL BUTTON. |
| `uploader` | redesign source guard (2026-08-15) — the ONE shared uploader |
| `user-removal` | BUILD-75 C.3 — USER REMOVAL: soft-detach, revoke, preserve authorship. |
| `vocabulary` | BUILD-86 Part B — HER WORDS. Run: node  |
| `workflows` | BUILD-13 Part 3 — Workflows engine suite. |
| `workflows-e2e` | BUILD-25 Part A — Workflow recipes, end to end (the highest-stakes suite). |
