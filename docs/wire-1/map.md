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

## Before and after, in one line per column

| column | wired before | wired after | partly before | partly after | missing before | missing after |
|---|--:|--:|--:|--:|--:|--:|
| Timeline | 8 | 16 | 12 | 6 | 2 | 0 |
| Org / funder record | 8 | 14 | 12 | 7 | 1 | 0 |
| Calendar + sync | 3 | 9 | 7 | 5 | 5 | 1 |
| ⌘K | 2 | 22 | 6 | 1 | 15 | 0 |
| Groups / Show me | 6 | 17 | 4 | 3 | 11 | 1 |
| Journeys / Comms | 2 | 5 | 7 | 12 | 10 | 2 |
| Reports, opens rows | 11 | 14 | 9 | 8 | 2 | 0 |
| Ask + Agent | 5 | 17 | 13 | 5 | 5 | 1 |
| Home / Thread | 4 | 9 | 4 | 2 | 5 | 2 |
| Import / export | 10 | 14 | 11 | 7 | 0 | 0 |
| Merge / delete / undo | 8 | 20 | 13 | 2 | 1 | 0 |
| **all 253 cells (31 n/a)** | **67** | **157** | **98** | **58** | **57** | **7** |

The map is generated from `map.json` (`before` and `after`), so the counts are counted, not typed.

**SEARCH-2 (6 Oct 2026)** wired the eight ⌘K cells left missing: gift, recurring plan, pledge, journey
step, meeting, email, note and import. The ⌘K column went from 14 wired, 1 partly, 8 missing to 22 wired,
1 partly, 0 missing; all cells from 138 / 67 / 17 to 146 / 67 / 9. The one partly cell left is volunteer
shifts (volunteers are found as people; shifts are not). The After section below is the state after SEARCH-2.

**REPORTS-4 (7 Oct 2026)** made every Reports tab number open rows that foot, plus household totals, giving-page
raised and membership counts. The "Reports, opens rows" column went from 11 wired, 9 partly, 2 missing to
14 wired, 8 partly, 0 missing; all cells from 146 / 67 / 9 to 149 / 66 / 7. The figure-by-figure
list is `docs/reports-4/figures.md`. The After section below is the state after REPORTS-4.
**AGENT-3 (7 Oct 2026)** gave the Agent the objects it could not see: grants and funders, memberships, campaigns and
appeals, giving and peer-to-peer pages, auctions and bids, and pledges. The "Ask + Agent" column went from 9 wired, 13 partly,
1 missing to 17 wired, 5 partly, 1 missing; all cells from 149 / 66 / 7 to 157 / 58 / 7. Recurring plans and
documents were not in this build and wait for AGENT-4. The After section below is the state after AGENT-3.
**THREAD-3 (7 Oct 2026)** wired the six cells where something that needs a person slipped: a donor's email with no reply
after a business day becomes a Reply step (email × Home / Thread), an event's no-shows become one "Missed you at" task
(event × Home / Thread), the next charge date is on the calendar as one line a day (recurring × Calendar), deleting a person
with a live plan is refused and archive keeps the plan running (recurring × Merge / delete), and the Agent reads monthly plans
and documents (recurring × Ask + Agent, document × Ask + Agent). Calendar went from 9 / 5 / 1 to 10 / 5 / 0, Ask + Agent from
17 / 5 / 1 to 19 / 3 / 1, Home / Thread from 9 / 2 / 2 to 11 / 2 / 0, Merge from 20 / 2 / 0 to 21 / 1 / 0; all cells from
157 / 58 / 7 to 163 / 55 / 4. Walked at 1440 and 390 on local Harborlight, 14 of 14 checks (`docs/thread-3/`). The After
section below is the state after THREAD-3.
After was re-walked on 6 Oct against the merged branch: the four builders' API checks on their own seeded
Harborlight copies, `tests/wire-journey.test.js` (63 checks, one person and one funder through every
column), and the Muse walk below. Every cell still partly or missing names its reason and the build it
belongs in. Nothing is hidden.

## The Muse walk (local Harborlight, 1440 and 390)

Rafael Quintero-Byrne gives, volunteers and (after this build's seed fix) came to the Harbor Lights Gala.
`1-timeline` his record says "came to Harbor Lights Gala 2026" and 20 hours, lifetime $200 (it read $0
before the seed fix). `2-search` ⌘K finds him. `3-calendar` the calendar with the new kinds in its legend
(memberships ending, auctions closing, campaign and page end dates); Rafael has no dated item of his own
in October, so the walk shows the org's week. `4-ask` "what has Rafael Quintero-Byrne done with us this
year?" answers "gave $100 in one gift, volunteered 20 hours over one shift and was at or registered for
one event", each line opening its rows. `5-group` a Group by rule, "came to the gala", holds him.
`6-number` a money figure on that Group opens rows that include his gift. 11 of 13 checks passed; the two
failures are the same environment error at both widths (`/ai/stream` 503, no local AI key).

## After

| object | Timeline | Org / funder record | Calendar + sync | ⌘K | Groups / Show me | Journeys / Comms | Reports, opens rows | Ask + Agent | Home / Thread | Import / export | Merge / delete / undo |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| person | W | P | W | W | W | W | W | W | · | W | W |
| household | W | · | · | W | W | M | W | W | · | P | W |
| organization / funder | W | W | · | W | W | P | P | W | · | W | W |
| gift | W | W | · | W | W | W | W | W | P | W | W |
| recurring plan | W | W | W | W | P | P | W | W | W | P | W |
| pledge | W | W | W | W | W | P | W | W | W | W | W |
| campaign | W | W | P | W | W | W | W | W | · | W | W |
| appeal | P | P | P | W | W | W | W | W | · | W | W |
| giving page | P | P | W | W | W | P | W | W | · | W | W |
| peer-to-peer page | W | W | W | W | W | P | W | W | W | W | W |
| event and ticket | W | W | P | W | W | P | P | W | W | P | W |
| auction item | P | P | W | W | W | P | W | W | W | P | W |
| membership | W | W | W | W | W | P | P | W | W | P | W |
| grant | W | W | W | W | W | P | W | W | P | W | W |
| volunteer shift and hours | W | P | P | P | W | P | P | W | W | W | W |
| journey step | W | W | W | W | W | W | P | W | W | · | W |
| task / next step | P | P | P | W | W | P | P | W | W | · | W |
| meeting | W | W | W | W | P | · | W | P | · | P | W |
| email | W | W | · | W | M | M | P | P | W | W | W |
| note | W | W | · | W | · | · | W | W | · | W | W |
| document | P | W | · | W | · | · | · | W | · | P | P |
| import | P | P | · | W | W | P | P | M | W | W | W |
| report | · | · | · | W | P | · | W | P | · | W | · |

**Counts per column** (W wired · P partly · M missing · n/a)

| column | W | P | M | n/a |
|---|--:|--:|--:|--:|
| Timeline | 16 | 6 | 0 | 1 |
| Org / funder record | 14 | 7 | 0 | 2 |
| Calendar + sync | 10 | 5 | 0 | 8 |
| ⌘K | 22 | 1 | 0 | 0 |
| Groups / Show me | 17 | 3 | 1 | 2 |
| Journeys / Comms | 5 | 12 | 2 | 4 |
| Reports, opens rows | 14 | 8 | 0 | 1 |
| Ask + Agent | 19 | 3 | 1 | 0 |
| Home / Thread | 11 | 2 | 0 | 10 |
| Import / export | 14 | 7 | 0 | 2 |
| Merge / delete / undo | 21 | 1 | 0 | 1 |
| **all** | **163** | **55** | **4** | **31** |

**Every partly and missing cell, with what is wrong**

- **person × Org / funder record** (partly): an organisation lists its contacts but does not roll up their gifts, meetings and hours. Next: ORG-ROLLUP
- **household × Journeys / Comms** (missing): no household audience or trigger; a Group with the household rule is the way in today. Next: COMMS-3
- **household × Import / export** (partly): import stamps external_household_id but does not create households. Next: IMPORT-HOUSEHOLDS
- **organization / funder × Journeys / Comms** (partly): a Group of organisations or funders can feed a Communication or Journey; no trigger of its own. Next: COMMS-3
- **organization / funder × Reports, opens rows** (partly): funder grant figures only; no organisations figure. Next: REPORTS-4
- **gift × Home / Thread** (partly): a Thank step opens for manual and Stripe gifts; tickets, auction payments and synced-source gifts still open none. Next: THREAD-4
- **recurring plan × Groups / Show me** (partly): any-active recurring rule now, one shared status list; no failed-plan rule yet. Next: GROUPS-2
- **recurring plan × Journeys / Comms** (partly): first_recurring triggers; a failed or cancelled plan does not. Next: JOURNEYS-3
- **recurring plan × Import / export** (partly): an imported sustainer is a flag, not a plan, so it is missing from recurring figures. Next: IMPORT-RECURRING
- **pledge × Journeys / Comms** (partly): a Group with an open pledge feeds a Communication or Journey; no pledge trigger. Next: JOURNEYS-3
- **campaign × Calendar + sync** (partly): end dates are on it; start dates are not. Next: CAL-2
- **appeal × Timeline** (partly): attribution shows as text on the gift. Next: PROFILE-2
- **appeal × Org / funder record** (partly): as timeline. Next: PROFILE-2
- **appeal × Calendar + sync** (partly): as campaign. Next: CAL-2
- **giving page × Timeline** (partly): the gift shows; nothing page-specific (views, abandoned starts are on Gifts not finished). Next: PROFILE-2
- **giving page × Org / funder record** (partly): as timeline. Next: PROFILE-2
- **giving page × Journeys / Comms** (partly): a Group of page givers feeds a Communication or Journey; no trigger. Next: JOURNEYS-3
- **peer-to-peer page × Journeys / Comms** (partly): a Group of fundraisers feeds a Communication or Journey; no trigger. Next: JOURNEYS-3
- **event and ticket × Calendar + sync** (partly): on Steward's calendar; not pushed to Google or Outlook because an event has no owner (by design, FIX-28). Next: none planned
- **event and ticket × Journeys / Comms** (partly): attended_event now fires from check-in and scan; there is still no this-event's-guests audience except a Group. Next: COMMS-3
- **event and ticket × Reports, opens rows** (partly): event rows open through a private endpoint, not the figure registry. Next: REPORTS-4
- **event and ticket × Import / export** (partly): no attendee import and no guest CSV export. Next: EVENTS-3
- **auction item × Timeline** (partly): donated items and paid wins show; bids write nothing (a bid war would flood the timeline). Next: none planned
- **auction item × Org / funder record** (partly): as timeline
- **auction item × Journeys / Comms** (partly): a Group of bidders feeds a Communication or Journey; no trigger. Next: JOURNEYS-3
- **auction item × Import / export** (partly): no import; JSON export only. Next: EVENTS-3
- **membership × Journeys / Comms** (partly): became_member triggers; a lapse does not. Next: JOURNEYS-3
- **membership × Reports, opens rows** (partly): member counts by status open (REPORTS-4); the member reports (directory, by level, expiring, revenue) still return no sources. Next: REPORTS-6
- **membership × Import / export** (partly): imported members carry no money, so they are missing from membership revenue (by design, no invented gifts)
- **grant × Journeys / Comms** (partly): a Group of funders feeds a Communication or Journey; no grant trigger. Next: JOURNEYS-3
- **grant × Home / Thread** (partly): raised at lead time, but skipped when the grant has no funder record. Next: GRANTS-2
- **volunteer shift and hours × Org / funder record** (partly): 
- **volunteer shift and hours × Calendar + sync** (partly): shifts on Steward's calendar; not pushed (no owner, by design)
- **volunteer shift and hours × ⌘K** (partly): volunteers are found as people; shifts are not. Next: SEARCH-2
- **volunteer shift and hours × Journeys / Comms** (partly): new_volunteer triggers; an hours milestone does not. Next: JOURNEYS-3
- **volunteer shift and hours × Reports, opens rows** (partly): a volunteer coordinator gets 403 on /figures, so their hour figures do not open. Next: VOL-3
- **journey step × Reports, opens rows** (partly): journey rows open through a private endpoint. Next: REPORTS-4
- **task / next step × Timeline** (partly): tasks show; an open Thread step does not, and a dismissal writes nothing. Next: PROFILE-2
- **task / next step × Org / funder record** (partly): as timeline
- **task / next step × Calendar + sync** (partly): on it; pushed only when someone owns it. Next: CAL-2
- **task / next step × Journeys / Comms** (partly): a Group with open tasks feeds a Communication or Journey; no trigger. Next: JOURNEYS-3
- **task / next step × Reports, opens rows** (partly): tasks have no figure source. Next: REPORTS-4
- **meeting × Groups / Show me** (partly): counts toward no-contact-since only. Next: GROUPS-2
- **meeting × Ask + Agent** (partly): Ask's conversations leave out calendar meetings (the person answer counts them). Next: ASK-5
- **meeting × Import / export** (partly): calendar_events is not in the CSV export. Next: EXPORT-2
- **email × Groups / Show me** (missing): no opened or clicked rule. Next: GROUPS-2
- **email × Journeys / Comms** (missing): no email-opened trigger. Next: JOURNEYS-3
- **email × Reports, opens rows** (partly): bulk email stats are computed in the browser. Next: REPORTS-4
- **email × Ask + Agent** (partly): as conversations. Next: ASK-5
- **document × Timeline** (partly): attachments show; grant documents only on the funder panel; receipt PDFs never. Next: PROFILE-2
- **document × Import / export** (partly): stored files are left out of the export (by design, the export is data)
- **document × Merge / delete / undo** (partly): erase leaves interaction_attachments. Next: TRUST-3
- **import × Timeline** (partly): imported rows show; the import itself is never an item. Next: PROFILE-2
- **import × Org / funder record** (partly): as timeline
- **import × Journeys / Comms** (partly): a Group from an import feeds a Communication or Journey. Next: none needed
- **import × Reports, opens rows** (partly): import health and the move report are bespoke, no figure sources. Next: REPORTS-4
- **import × Ask + Agent** (missing): Ask cannot see imports. Next: ASK-5
- **report × Groups / Show me** (partly): a dashboard takes a Group; report rows cannot become one. Next: GROUPS-2
- **report × Ask + Agent** (partly): Ask answers open; stored board reports never reach Ask. Next: ASK-5

## Before (Part 0, committed at 5e72a53)

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
