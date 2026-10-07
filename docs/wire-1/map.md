# WIRE-1 · The wiring map

Part 0, committed before anything was fixed. Walked on 6 Oct 2026 against Harborlight (`org_b72demo`,
seeded by `scripts/seed-demo.js` into a scratch database) and the code at `628ab85`.

**How each cell was walked.** Four read-only passes over the code, one per group of columns (timeline
and merge; calendar and the Thread; search, Groups and Journeys; reports, Ask, the Agent and import), each
citing the line that decides the cell. Then the cells that could be checked on the running demo were
checked as Dana Reyes (`director@harborlight.demo`): Rafael Quintero-Byrne's record, ⌘K, two months of
the calendar, and Ask. A cell is **wired** when the object reaches that place the same way a hand-entered
one does, **partly** when some of its events or some of its paths do, **missing** when none do, and **n/a**
when the place does not apply (a note has no date, a report has no merge).

**What the demo walk found that the code read alone did not**
- Ask refuses "what has Rafael Quintero-Byrne done with us this year?" ("Steward can't answer that one yet").
- Three journey steps are on October's calendar twice: once as the journey step and once as the Thread
  step it opened (Eulalia Carrowmore, Mordecai Dellacroix, Amabel Ashgrove).
- The eleven PROSPECT-1 demo people have gifts but `total_giving = 0` (Rafael: two $100 gifts, lifetime
  $0.00), so every surface that reads the person's totals treats them as never having given. The seed
  writes their gifts without recomputing the person. This is a seed defect, not a product one.
- Two Harborlight people with logged shifts are not typed as volunteers (`person_types` lacks it).

The map is generated from `map.json` (`before` now; `after` in Part 3), so the counts are counted, not typed.

| object | Timeline | Org / funder record | Calendar + sync | ⌘K | Groups / Show me | Journeys / Comms | Reports, opens rows | Ask + Agent | Home / Thread | Import / export | Merge / delete / undo |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| person | W | P | W | P | W | P | W | P | · | W | P |
| household | M | · | · | M | W | M | M | P | · | P | P |
| organization / funder | P | W | · | W | M | M | P | P | · | W | P |
| gift | W | P | · | M | W | W | W | W | P | P | P |
| recurring plan | P | P | M | M | P | P | W | P | W | P | P |
| pledge | P | P | W | M | M | M | W | P | W | W | W |
| campaign | W | W | P | M | W | P | W | P | · | P | P |
| appeal | P | P | P | M | W | P | W | P | · | P | P |
| giving page | P | P | M | M | M | M | M | M | · | W | W |
| peer-to-peer page | M | M | M | P | M | M | W | M | M | W | P |
| event and ticket | P | P | P | M | P | P | P | W | M | P | W |
| auction item | P | P | M | P | M | M | W | M | M | P | P |
| membership | P | P | M | P | M | P | P | P | P | P | P |
| grant | P | W | P | W | M | M | W | P | P | P | W |
| volunteer shift and hours | W | P | P | P | W | P | P | W | P | W | W |
| journey step | W | W | P | M | M | W | P | P | W | · | P |
| task / next step | P | P | P | M | M | M | P | W | W | · | P |
| meeting | W | W | W | M | P | · | W | P | · | P | M |
| email | W | W | · | M | M | M | P | P | M | W | W |
| note | W | W | · | M | · | · | W | W | · | W | W |
| document | P | W | · | M | · | · | · | M | · | P | P |
| import | P | P | · | M | M | M | P | M | M | W | W |
| report | · | · | · | P | P | · | P | P | · | W | · |

**Counts per column** (W wired · P partly · M missing · n/a)

| column | W | P | M | n/a |
|---|--:|--:|--:|--:|
| Timeline | 8 | 12 | 2 | 1 |
| Org / funder record | 8 | 12 | 1 | 2 |
| Calendar + sync | 3 | 7 | 5 | 8 |
| ⌘K | 2 | 6 | 15 | 0 |
| Groups / Show me | 6 | 4 | 11 | 2 |
| Journeys / Comms | 2 | 7 | 10 | 4 |
| Reports, opens rows | 11 | 9 | 2 | 1 |
| Ask + Agent | 5 | 13 | 5 | 0 |
| Home / Thread | 4 | 4 | 5 | 10 |
| Import / export | 10 | 11 | 0 | 2 |
| Merge / delete / undo | 8 | 13 | 1 | 1 |
| **all** | **67** | **98** | **57** | **31** |

**Every partly and missing cell, with what is wrong**

- **person × Org / funder record** (partly): contacts are listed on the org, but their gifts, meetings and hours do not roll up to it
- **person × ⌘K** (partly): name and email only; phone, contact name and household are not searched
- **person × Journeys / Comms** (partly): a Group can feed a Journey, but the Communications builder has no way to pick a Group (SEG_MODES has no audience mode and openBuilder drops audienceId)
- **person × Ask + Agent** (partly): Ask refuses 'what has [name] done with us this year?' (no activity answer about one person); people entity has no kind or person_types
- **person × Merge / delete / undo** (partly): merge leaves calendar meetings (calendar_events.person_ids), agent_writes and custom_field_events on the merged-away id; bulk delete writes no Undo row; /tasks still lists a deleted person's tasks
- **household × Timeline** (missing): joining or leaving a household writes nothing on the timeline
- **household × ⌘K** (missing): household names are not searched
- **household × Journeys / Comms** (missing): no household audience or trigger
- **household × Reports, opens rows** (missing): household total renders bare on the profile, no figure source
- **household × Ask + Agent** (partly): the Agent can add to a household; Ask has no household entity
- **household × Import / export** (partly): import stamps external_household_id but never creates a households row
- **household × Merge / delete / undo** (partly): purge-trash leaves households.primary_donor_id dangling
- **organization / funder × Timeline** (partly): the funder record shows its own rows and the grants panel, never its contacts' activity or the gifts it matched
- **organization / funder × Groups / Show me** (missing): no rule for kind = organization or funder of a grant
- **organization / funder × Journeys / Comms** (missing): no audience for organizations or funders
- **organization / funder × Reports, opens rows** (partly): funder grant figures only; no organisations figure
- **organization / funder × Ask + Agent** (partly): Ask cannot tell an organisation from a person
- **organization / funder × Merge / delete / undo** (partly): purge-trash leaves grant_sends.funder_donor_id dangling
- **gift × Org / funder record** (partly): an employer never sees the gifts it matched (gifts.match_employer_id)
- **gift × Home / Thread** (partly): a Thank step opens for manual and Stripe gifts only, not for tickets, auction payments or synced sources; the giving-source 'gone quiet' task never opens (queries tasks.completed/due_date, columns that do not exist)
- **gift × Import / export** (partly): /gifts/import-history writes no import_id or payment_method, so Undo import cannot reach those gifts and the bookkeeper file's method is blank
- **gift × Merge / delete / undo** (partly): purge-trash leaves fin_transactions and other donors' tribute/match pointers
- **recurring plan × Timeline** (partly): starting a plan writes no line; each charge shows as a gift
- **recurring plan × Calendar + sync** (missing): next charge date is not on the calendar
- **recurring plan × Groups / Show me** (partly): only 'monthly'; no any-interval or failed rule; two definitions of 'has recurring' (groups.js vs journey audience)
- **recurring plan × Journeys / Comms** (partly): first_recurring triggers; failed or cancelled does not
- **recurring plan × Ask + Agent** (partly): Ask yes; the Agent cannot see plans
- **recurring plan × Import / export** (partly): an imported sustainer is a flag, not a plan, so it is missing from recurring figures and Ask
- **recurring plan × Merge / delete / undo** (partly): soft delete does not stop the Stripe plan; purge leaves recurring_proposals and recurring_change_log
- **pledge × Timeline** (partly): creating a pledge writes no line; only reminders do
- **pledge × Groups / Show me** (missing): no has-pledge rule
- **pledge × Journeys / Comms** (missing): no trigger or audience
- **pledge × Ask + Agent** (partly): only the outstanding metric; no pledges entity; the Agent cannot see pledges
- **campaign × Calendar + sync** (partly): sends are on it; campaign start and end dates are not
- **campaign × Journeys / Comms** (partly): only as a gift-trigger filter; a campaign's donors are not an audience
- **campaign × Ask + Agent** (partly): entity amount is the goal only; the Agent cannot see campaigns
- **campaign × Import / export** (partly): imported gifts carry the campaign name only, so Reports filtered by campaign (id match) miss them
- **campaign × Merge / delete / undo** (partly): purge leaves sequence_sends and reconnect_sends
- **appeal × Timeline** (partly): attribution shows only as text on the gift
- **appeal × Calendar + sync** (partly): as campaign
- **appeal × Journeys / Comms** (partly): as campaign
- **appeal × Ask + Agent** (partly): as campaign
- **appeal × Import / export** (partly): as campaign
- **appeal × Merge / delete / undo** (partly): as campaign
- **giving page × Timeline** (partly): the gift shows; nothing page-specific
- **giving page × Calendar + sync** (missing): giving_pages.ends_on is not on the calendar
- **giving page × Groups / Show me** (missing): no gave-through-this-page rule
- **giving page × Reports, opens rows** (missing): raised on a giving page has no figure source
- **giving page × Ask + Agent** (missing): neither Ask nor the Agent can see giving pages
- **peer-to-peer page × Timeline** (missing): creating a fundraiser page writes nothing on the fundraiser's timeline
- **peer-to-peer page × Calendar + sync** (missing): page end date not on the calendar
- **peer-to-peer page × ⌘K** (partly): a 'Go to' shortcut only; pages are not searchable
- **peer-to-peer page × Groups / Show me** (missing): no is-a-fundraiser rule
- **peer-to-peer page × Ask + Agent** (missing): neither Ask nor the Agent can see peer-to-peer pages
- **peer-to-peer page × Home / Thread** (missing): a page waiting for approval opens no step
- **peer-to-peer page × Merge / delete / undo** (partly): purge leaves peer_fundraisers.person_id
- **event and ticket × Timeline** (partly): paid tickets show; a free RSVP writes nothing and door check-in writes no 'Came to' line
- **event and ticket × Calendar + sync** (partly): on Steward's calendar; never pushed to Google or Outlook (no owner)
- **event and ticket × Groups / Show me** (partly): gaveEvent counts ticket gifts; no attended or registered rule; guests cannot be saved as a Group
- **event and ticket × Journeys / Comms** (partly): attended_event fires from the attendance list only, not from check-in or scan; no event's-guests audience
- **event and ticket × Reports, opens rows** (partly): event rows open through a private endpoint, not the figure registry
- **event and ticket × Home / Thread** (missing): a no-show opens nothing
- **event and ticket × Import / export** (partly): no attendee import and no guest CSV export
- **auction item × Timeline** (partly): donated items and paid wins show; bids write nothing
- **auction item × Calendar + sync** (missing): auction close is not on the calendar
- **auction item × ⌘K** (partly): a 'Go to' shortcut only
- **auction item × Groups / Show me** (missing): no bidder rule
- **auction item × Ask + Agent** (missing): neither Ask nor the Agent can see auctions
- **auction item × Home / Thread** (missing): won but not paid opens no step
- **auction item × Import / export** (partly): no import; JSON export only
- **auction item × Merge / delete / undo** (partly): purge leaves auction_bidders, auction_items, auction_refund_flags
- **membership × Timeline** (partly): shows only when paid; a comp join or a cancel writes nothing
- **membership × Calendar + sync** (missing): memberships expiring are not on the calendar
- **membership × ⌘K** (partly): a 'Go to' shortcut only
- **membership × Groups / Show me** (missing): no member-level or member-status rule
- **membership × Journeys / Comms** (partly): became_member triggers; lapsed does not; no Communications audience
- **membership × Reports, opens rows** (partly): status counts render bare; member reports return no sources
- **membership × Ask + Agent** (partly): Ask yes (no money); the Agent cannot see memberships
- **membership × Home / Thread** (partly): expiring opens a renewal step; lapsed does not
- **membership × Import / export** (partly): imported members carry no money, so they are absent from membership revenue
- **membership × Merge / delete / undo** (partly): a member blocks purge-trash (FK with no cascade, not in CHILD_TABLES)
- **grant × Timeline** (partly): only grant emails reach the funder; stage changes, the award and grant notes (grant_interactions) do not
- **grant × Calendar + sync** (partly): milestones are on it; a report with its own due date and no milestone is not
- **grant × Groups / Show me** (missing): no funder-of-a-grant rule
- **grant × Ask + Agent** (partly): Ask yes; the Agent cannot see grants
- **grant × Home / Thread** (partly): raised at lead time, but skipped when the grant has no funder record and for reports with no milestone
- **grant × Import / export** (partly): grant import drops decision date and report due, and stamps awarded_at = now, so old awards count as this year's
- **volunteer shift and hours × Calendar + sync** (partly): shifts on Steward's calendar; never pushed (no owner)
- **volunteer shift and hours × ⌘K** (partly): volunteers are found as people; shifts are not
- **volunteer shift and hours × Journeys / Comms** (partly): new_volunteer triggers; an hours milestone does not
- **volunteer shift and hours × Reports, opens rows** (partly): a coordinator gets 403 on /figures, so their hour figures cannot open
- **volunteer shift and hours × Home / Thread** (partly): 20 hours opens a task; a no-show opens nothing
- **journey step × Calendar + sync** (partly): each open journey step shows twice (journey + the Thread step it opened), and is pushed twice
- **journey step × Groups / Show me** (missing): no in-a-journey rule
- **journey step × Reports, opens rows** (partly): journey rows open through a private endpoint
- **journey step × Ask + Agent** (partly): the Agent can start or stop one; Ask has no journey entity
- **journey step × Merge / delete / undo** (partly): purge leaves workflow_runs
- **task / next step × Timeline** (partly): tasks show; an open Thread step does not, and a dismissal writes nothing
- **task / next step × Calendar + sync** (partly): on it; pushed only when assigned, and auto steps often have no owner
- **task / next step × Groups / Show me** (missing): no has-an-open-task rule
- **task / next step × Reports, opens rows** (partly): next steps closed has a source; tasks have none
- **task / next step × Merge / delete / undo** (partly): /tasks still lists a deleted person's tasks
- **meeting × Groups / Show me** (partly): counts toward no-contact-since only
- **meeting × Ask + Agent** (partly): Ask conversations leave out calendar meetings, which the meetings figure counts
- **meeting × Import / export** (partly): calendar_events is not in the CSV export
- **meeting × Merge / delete / undo** (missing): merge does not move calendar_events.person_ids, so the meetings vanish from the kept person
- **email × Groups / Show me** (missing): no opened or clicked rule
- **email × Reports, opens rows** (partly): bulk email stats are computed in the browser or bare
- **email × Ask + Agent** (partly): as conversations
- **email × Home / Thread** (missing): a donor's email that needs a reply opens no step
- **document × Timeline** (partly): attachments show; grant documents only on the funder panel; receipt PDFs never
- **document × Import / export** (partly): stored files are left out of the export (by design, the export is data)
- **document × Merge / delete / undo** (partly): erase leaves interaction_attachments
- **import × Timeline** (partly): imported rows show; the import itself is never an item
- **import × Groups / Show me** (missing): no came-from-this-import rule
- **import × Reports, opens rows** (partly): import health and the move report are bespoke, no figure sources
- **import × Home / Thread** (missing): new duplicates from an import open no step (counted, never shown)
- **report × ⌘K** (partly): one 'Reports' shortcut; saved reports, dashboards and board files are not searchable
- **report × Groups / Show me** (partly): a dashboard takes a Group; report rows cannot become one
- **report × Reports, opens rows** (partly): Reports tab: retention, top donors, LYBUNT/SYBUNT and three-year numbers render bare
- **report × Ask + Agent** (partly): Ask answers open; stored board reports never reach Ask
