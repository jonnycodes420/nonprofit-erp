# SALES-4 · The sales CRM says what's next and logs itself (Part A)

**Why.** Jonathan has Tuesday and Thursday, 11 to 5, for sales and a goal of 20 demos booked by
20 December. With SALES-1 to 3 he still sat down not knowing whom to call, logging took clicks,
it looked clunky, and there were no leads. Every item was judged by one question: does it get
him from opening Sales to dialing in under ten seconds?

**What Part A built.**
- **Now** (`now.js`, `routesE.js`, `NowView.jsx`) is the first thing on the Sales tab. Due rows
  come first (tasks and next steps due or overdue, today's meetings to prep, "How did it go?",
  back from Later, trial or billing steps within three days); then every other open deal that
  needs a move, ranked by monthly value × stage probability × days since the last touch, the sum
  shown on the row. One row per deal: Follow up (no reply), Reply (their email is last), Going
  stale (14 days at 20% or more), or Call (no next step). A deal with a meeting ahead or a next
  step not yet due is waiting on its day and is not on Now.
- **Start** opens call mode on Now's own call rows in Now's order (`/call/queue?now=1`); a row's
  Call starts there. The week's bar (dials, conversations, meetings against 50, 8 and 3) is the
  scoreboard's own numbers, and each opens its rows.
- **A touch** (`touch.js`) is a call, a meeting, a note, a drafted email or a captured email. A
  task is a plan, not a touch. A deal's last touch is the newest of its own, its organization's
  and its people's.
- **The calendar logs meetings** (`calendar.js`), on the same consent the sales mailbox already
  had (Calendars.ReadWrite / calendar.events), read by the customers' own `fetchCalendarEvents`.
  Only events with a sales contact as an attendee are kept (title, time, place, contacts); the
  rest leave nothing. A new meeting moves an open deal that sits before Meeting booked to Meeting
  booked and records the move in `sales_auto_moves`; Now and the deal page offer Undo. A meeting
  found after it happened is dated booked at its own time, so the scoreboard doesn't count last
  week's demo as booked this week.
- **The next step is proposed** from the last touch by the call rules and accepted with one click
  (`acceptNext`): it becomes the deal's next step and day. Nothing is sent.
- **It looks like Steward.** The Pipeline sub-tab is the board: per column its count, probability
  and monthly total; cards show the organization, $/mo, days since a touch and the next step. Every
  drag answers with its Undo. The deal page opens on a header (stage, value, next step, last
  touch), long notes show three lines, and the log box opens when a kind is picked. Lists default
  to name, organization, fit, last touch and next step (`scanRows.js`). Today's lines and the
  forecast moved under Forecast.

**Decisions made in the build.**
- Outlook mail was already read (SALES-1 Part B). The guard here is that Outlook's mixed-case
  addresses still match a contact (`SALES4_PLANT=outlookcase`).
- Due rows are never ranked by score. A $5,000 cold lead can't sit above a $299 follow-up due today.
- Accepting a proposal sets the deal's next step rather than adding a task, so the due line shows
  it once.

**Planted defects, each red:** `rankdue`, `outlookcase`, `nomove`, `noundo`, `send` (tests/sales4.test.js).

# Part B · Leads to work

- **Add prospects** (`propublica.js`, `prospectAdd.js`, `routesF.js`, `ProspectsPanel.jsx`) searches
  ProPublica's Nonprofit Explorer API by state (KY, OH, TN), category (an NTEE major group plus the
  code prefixes that count: K31 food banks, D with "equine/riding/therapeutic" for animal-assisted
  therapy, O youth, A arts, P human services) and revenue ($100K to $2M by default). A row shows
  the organization, city, the latest filing's revenue and year, its fit by SALES-2's rule, and
  whether it is already in Sales. Picked rows go on a named prospect list. Each organization keeps
  its EIN, its ProPublica link (`source_url`), address and ZIP.
- **What ProPublica can't give.** The API has no phone and no officers. They are in the 990
  itself, and ProPublica's filing download sits behind a security check, so fetching it would be
  scraping. The screen says so on every result; "Find contact" opens a Google search for the ED's
  name with the organization's (a link only); a CSV with Phone, Executive director and
  Development director columns fills them. ProPublica unreachable from Railway: the screen says so
  and offers the CSV path, read the same way.
- **De-duplication** before anything is written: by EIN, then by name and city (case, punctuation
  and "Inc" ignored). A match goes on the list instead and the answer names it.
- **Needs a number.** Call mode already skipped an organization with no number; it now lists them.
- **Misfiled notes** (`scripts/ops/sales-misfiled-notes.js`, dry run by default): a note or task
  whose title is about Steward (a month's campaign, the scoreboard, "open question for Jonathan",
  goals) and that never names the prospect it sits on moves to the built-in "Steward (us)"
  record (`sor_steward_us`, made on `--apply`, marked Do not contact so no queue offers it).

**Planted defect, red:** `dupe` (§5).
