# SUPPORT-1 · Inventory of screens and help text (19 Oct 2026, origin/main 6a90804)

Read from the code on main. Paths are app paths built by `client/src/lib/appUrls.js`
(Home `/dashboard`, Donors `/donors`, other tabs `/app/<tab>`, a Fundraising part
`/app/fundraising?fr=<part>`, a Settings section `/app/settings?section=<id>`).

## 1. Every screen

### Rail tabs (`client/src/lib/tabRegistry.js`, grouped by `client/src/lib/navGroups.js`)

| Tab id | Label | Path | What it is for | Own help article |
|---|---|---|---|---|
| dashboard | Home | /dashboard | The morning view: The Thread, Drift, thank-yous, today's tiles | home |
| tasks | Tasks | /app/tasks | Follow-ups grouped by when they are due | tasks |
| calendar | Calendar | /app/calendar | Everything with a date: meetings, steps, shifts, events | calendar |
| donors | Donors | /donors | The people list, Directory / Re-engage / Map / Data health views | donors |
| groups | Groups | /app/groups | Saved lists of people, by hand or by rule | groups |
| journeys | Journeys | /app/journeys | Staff-written sequences and triggers | journeys |
| communications | Communications | /app/communications | Appeals, templates, drafts to review, surveys, as-sent | communications |
| portal | Donor Portal | /app/portal | Portal hub (hidden from CRM orgs, portal-tier only) | donor-portal |
| fundraising | Fundraising | /app/fundraising | Overview, Campaigns & pages, Major gifts, Money in | fundraising |
| events | Events | /app/events | Galas, 5Ks, tickets, guests, seating | events |
| auctions | Auctions | /app/fundraising?fr=auctions | Online auction, items, winners | folded into fundraising; now **auctions** |
| p2p | Peer-to-peer | /app/fundraising?fr=p2p | Walks and team fundraising | folded into fundraising; now **peer-to-peer** |
| memberships | Memberships | /app/fundraising?fr=members | Levels, members, renewals | folded into fundraising; now **memberships** |
| grants | Grants | /app/grants | Funders, deadlines, documents, reports | grants |
| volunteers | Volunteers | /app/volunteers | Volunteers, shifts, hours, recruiting | volunteers |
| finance | Finance | /app/finance | Ledger, funds, deposits, bookkeeper files | finance |
| reports | Reports | /app/reports | Reports and the folded-in Dashboards | reports |
| agent | Agent | /app/agent | Instructions, plans, drafts, workflows | agent |
| settings | Settings | /app/settings | Every section below | settings |

### Fundraising parts (`client/src/lib/fundraisingSections.js`)

| Part | Path | For | Own article |
|---|---|---|---|
| overview | ?fr=overview | Goals, raised this period, active campaigns | fundraising |
| campaigns, pages, events | ?fr=campaigns / pages / events | Campaigns, giving pages & forms, tickets & sponsors | fundraising (+ settings-giving-pages) |
| recurring | ?fr=recurring | Monthly and yearly gifts, failed cards | two paragraphs in fundraising; now **recurring-gifts** |
| majorgifts, pipeline, proposals, portfolios, plans | ?fr=majorgifts etc. | Major gift cultivation | two lines in fundraising only |
| toconfirm | ?fr=toconfirm | Check photos and gift documents waiting for a tap | none; now **to-confirm** |
| deposits, acknowledgments, funds, unfinished | ?fr=deposits etc. | Deposit sheet, letters, funds, started-not-finished | fundraising (deposits, acknowledgments lines only) |

### Settings sections (`client/src/components/Settings.jsx` ~line 2636)

| Section id | Label | Own article |
|---|---|---|
| org, team | Organization, Team | settings-organisation-team |
| connections (+ integrations) | Connections | settings-connections |
| giving | Giving Pages | settings-giving-pages |
| customization, words | Customization, Your words | settings-customization-words |
| journeys | Journeys | journeys |
| portal | Donor Portal (portal tier) | donor-portal |
| receipts | Tax Receipts | settings-tax-receipts |
| brandkit | Brand kit | none; now **brand-kit** |
| imports | Imports | settings-imports |
| audit | Audit log (admin) | settings-audit-log |
| privacy | Privacy | none; now **privacy-mode** |
| data, account | Your Data, Account | settings-data-account |
| security | Security | settings-security |

### Donor profile (`client/src/components/DonorProfile.jsx` PROFILE_TABS)
Path `/donors/<id>`. Tabs: Overview, Gifts & pledges, Asks & pipeline, Conversations, Emails, Tasks, Notes, Funds, Related, Files, plus the right rail. One article: **donor-profile** (screen `profile`). Per-tab detail is thin for Asks & pipeline, Funds, Related.

### Other app pages and surfaces

| Surface | Path / entry | For | Own article |
|---|---|---|---|
| Set up Steward for me | /setup | Files + website + tools in, a plan, one Start | none; now **set-up-steward** |
| To confirm | /app/fundraising?fr=toconfirm | Capture cards | now **to-confirm** |
| Data health | /donors?view=health | Duplicates, addresses, moves, emails | none; now **data-health** |
| Ask box / Ask rail | Home, under the greeting (AskPanel.jsx, AskRail.jsx) | Ask a question of your own records | none (FIX-46 is changing the answer engine; left alone) |
| Search (⌘K) | Top bar, every screen (TopBar.jsx GlobalSearch) | Find any record | none; now **search** |
| Tell Steward | Home button, sidebar, More on a phone, profile (TellSteward.jsx) | Voice or typed memo to paperwork | none; now **tell-steward** |
| Help panel "?" | Top bar (HelpPanel.jsx) | Article for the current screen, Ask Steward, Ask a person | n/a |
| Lost & Found | /lost-and-found and /tools/lost-and-found | Free in-browser audit of a giving export | none (tool page copy only) |
| Giving page editor | Settings, Giving Pages (one editor, GIVE-EDIT-1) | Draft, publish, version pages | settings-giving-pages |
| Portal editor | /portal-editor | Donor portal page builder | donor-portal (brief) |
| Welcome / signup | /welcome, /signup | First run | none |
| Super admin | /admin | Orgs, tickets, question log, directory review | none (internal) |
| Public pages | /give/..., /portal/..., /giving, /join, /volunteer-page/..., /fundraiser/manage/... | Donor- and supporter-facing | none (not staff screens; give form and directory are FIX-46's) |

## 2. Help and FAQ text that exists today

| Where | What | Count |
|---|---|---|
| `shared/helpArticles.js` | HELP-1 articles, one per tab + profile + Settings sections + 8 task articles (import donors, connect Stripe, inbox and calendar, thank a gift, video thank-you, year-end receipts, two-factor, export or erase) | 34 |
| `shared/helpSearch.js` | Search + the one Ask Steward prompt | n/a |
| `client/src/marketing/data/faqs.js` | HOME_FAQ (homepage), FAQ_PAGE (/faq) | 8 + 9 |
| `client/src/marketing/data/features.js` | /features/<slug> pages: drift, major-gifts, forms, p2p, reports, ask, grants, events, memberships, journeys, inbox, audit, import, finance, receipts | 15 |
| `client/src/marketing/data/connections.js` | /connections cards, one per provider | 15 |
| `shared/connections.js` | Connection health states, each with its defining sentence (healthy, quiet, broken...) | 15 sentences |
| `client/src/marketing/data/glossary.js` | /glossary terms | 50 |
| `client/src/marketing/data/guides.js`, `templates.js`, `articles/*.md` | Guides, letter templates, 13 long-form articles | n/a |
| `docs/MESSAGING.md` | The voice and the approved claims | 1 |
| Marketing pages with inline Q&A | pages/home, product, resources, tools, why, pricing, trust | 7 files |
| `figureSources.js` | The "?" definition on every number that opens (`sentence:`) | 100 sources, 116 sentences |
| `routes/crm.js` reportFigures (~22708) | Report figure definitions | per report |
| `shared/threadFigures.js`, `shared/vocabulary.js`, `shared/askGuide.js` | Thread, vocabulary and Ask guide sentences | small |
| Server `sentence:` fields | Most list and count responses carry their own defining sentence (memberships, data health, recurring, p2p) | many |
| EmptyState copy | `<EmptyState` in 13 component files | 26 uses |
| Tooltips | `title="..."` of 15+ characters in components/pages | 101 in 41 files |

## 3. Screens with no help text of their own (before this build)

- **Auctions, Peer-to-peer, Memberships**: only folded into the Fundraising article (one paragraph says they have rail entries).
- **Recurring**: two "Good to know" lines in Fundraising.
- **Major gifts** (At a glance, Pipeline, Proposals, Portfolios, Plans): two lines in Fundraising. Still uncovered.
- **To confirm** (capture): none.
- **Data health**: none.
- **Set up Steward for me** (/setup): none.
- **Tell Steward**: one line in the Home article about meeting notes; nothing on the memo sheet.
- **Search (⌘K)**: none.
- **Brand kit**, **Privacy** (Settings): none.
- **Ask box / Ask rail**: none (left for FIX-46's lane).
- **Started, not finished**, **Funds** (Fundraising parts): none. Still uncovered.
- **Lost & Found**, **Welcome**, **Portal editor**: tool page copy only. Still uncovered.

## Articles written in docs/help/

| Slug | Screens |
|---|---|
| auctions | auctions |
| peer-to-peer | p2p |
| memberships | memberships |
| recurring-gifts | fundraising:recurring |
| to-confirm | fundraising:toconfirm |
| data-health | donors:health |
| set-up-steward | setup |
| tell-steward | tell |
| search | search |
| brand-kit | settings:brandkit |
| privacy-mode | settings:privacy |

Pseudo-screen ids used beyond tab ids and `settings:<id>`: `fundraising:<part>`, `donors:health`, `setup`, `tell`, `search`. Each article's `route:` is a real path per appUrls.js.

## What I softened

- **Auctions refunds**: said Steward does not issue refunds and you refund in Stripe, then mark it. The screen lists "Payments to refund" but I did not trace every case that creates a refund flag, so I did not say when one appears.
- **Peer-to-peer coaching notes**: said a fundraiser's options show a suggested note opening in your own mail ("Open in my mail"). I did not confirm which menu holds it at 390 width, so the step is general.
- **Memberships renewal timing**: did not state the default renewal or grace days; said "a set number of days" you choose on the screen, because the defaults are org settings.
- **Memberships level fields**: "Individual" / "Household" and the four terms are from the rendered labels; I did not confirm every combination is offered for every level.
- **To confirm by email**: the component mentions documents arriving from email and a capture/forward address. I could not confirm where the address is shown to an org on prod, so the article only describes photos, drops and scanned PDFs, and says cards can come from documents without telling people how to forward.
- **To confirm thank-you**: said a thank-you draft is prepared to send from your thank-you list. The card says "The thank-you draft, not sent"; I did not confirm it appears for every kind of card.
- **Data health change of address**: left out any provider name; the screen only prepares and reads a file, and the NCOA provider pick is still open.
- **Set up Steward for me**: did not promise how long setup takes or that every listed file format succeeds; listed formats exactly as the screen states. Did not say connections are made automatically (they wait for "Connect").
- **Tell Steward on a phone**: the hold-to-talk path needs the browser's own speech recognition; I said "On a phone, hold to talk, or tap and talk" and offered the keyboard microphone, without naming which phones support it.
- **Search**: did not describe matching rules beyond the three examples the code documents ($ amount, a day, "name gift").
- **Recurring**: cards updated automatically depend on the card network and the org's own Stripe account (kept that caveat from the Fundraising article). Did not describe dunning email cadence. Did not claim imported sustainers can be managed here; said they show separately.
- **Privacy**: kept the code's own line that Steward is not HIPAA compliant and has no business associate agreements.
- **Brand kit**: did not name the palette colors or claim which documents beyond "every template, printed letter and receipt" read it (the screen's own claim).
- **Ask box**: no article written, because FIX-46 owns the answer engine and is changing it.
- **Tasks (HELP-1, corrected):** "A task that belongs to something else is changed where it lives" is said in general; I did not check every kind of linked task.
- **Groups (HELP-1, corrected):** the starter groups named are four of the twelve; how many people fit each one is not stated.
- **Agent (HELP-1, corrected):** "What changed" is described in one phrase from its code comment, not walked.

## HELP-1 articles corrected

Checked against the components on this branch; every quoted label was searched for in client/src.

- **tasks**: rewritten. "+ New task", the Overdue/Due today/Upcoming/No date grouping, "Mine / All" and "cannot edit or delete" were all stale since TASKS-2: now the plain-words quick add ("Add", "Save task"), the six tabs, Mine/Everyone and "Any staff member", the task sheet (owner, repeats, checklist), "Save and mark done", Snooze, and Select for bulk work.
- **home**: added the Ask box under the greeting (HOME-TIDY).
- **communications**: added the Surveys tab; "Email This Segment →" is now "Email this audience".
- **donor-profile**: four figures are now seven; the tabs are the ten of PROFILE-1, not six; "What do I do next" is gone; "+ Add task" on Overview is now More ▾, "Add a task"; Erase moved into More ▾; More ▾ now also holds drafting help and the video thank-you.
- **export-or-erase-a-donor**: Erase is in More ▾, not at the bottom of Overview.
- **donors**: added the Data health view; "Gifts & Pledges" is "Gifts & pledges" (also fixed in receipts and thank-a-gift).
- **reports**: the Dashboards group also holds saved dashboards, "Board pack", "Past reports" and "New dashboard".
- **grants**: rewritten for GRANTS-1: six tabs (Pipeline, Funders, Deadlines, Library, Reports, Find grants), the eight-stage board, "Add a grant" / "Save grant" (was "+ Add Grant" / "Save Grant"), Custom deadlines, "Edit" and "Take off" (was "Move to"), "Bring in a spreadsheet"; removed the stale "Awarded and LOI only by dragging" and "Report Outline" lines.
- **fundraising**: Events is "Tickets & sponsors" inside Fundraising; Money in also has To confirm and Started, not finished; giving pages now start from "New giving page" here, with "Edit in editor", "Open page", "Copy link" and "QR and embed" (was "Open ↗", and "created in Settings").
- **settings-giving-pages**: added "Edit in editor" (the page editor, publish to change what donors see).
- **settings**: added the Brand kit and Privacy sections.
- **settings-connections**: "Save and keep in step" does not exist; the email tool's buttons are "Save and read" / "Save, read and add people".
- **connect-inbox-calendar**: "Sync now" does not exist; it is "Check again" and "Reconnect" on a failed read.
- **groups**: added the starter groups, "New group", "Email this group" and "Start a journey".
- **agent**: five tabs are now six (What changed).
