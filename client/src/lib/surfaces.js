// client/src/lib/surfaces.js · FRESH-2 item 3. EVERY LIST AND COUNT, AND WHAT IT SHOWS.
//
// FRESH-1's census fails when a write route answers no topic. This is the other
// half: each list or count surface, by the name it passes to lib/liveRead.js,
// with the tables whose rows it shows. tests/lib/surfaceCensus.js reads the
// topics each surface listens for from its source, and fails when:
//   · a surface named here has no useLive/useLiveRead/useLiveRev call in its file
//     (it stopped listening), or a call names a surface not listed here;
//   · a table it shows announces no topic on a write (silent or unnamed in
//     shared/changeTopics.cjs), so a write to it re-reads nothing;
//   · it does not listen for any topic a write to one of its tables announces,
//     so that write leaves it stale until a reload.
// Data only: nothing in the app imports this file.
export const SURFACES = [
  { name: "profile.record", file: "components/Donors.jsx", read: "the open record: Notes summary line, header, and what the profile was handed", shows: ["donors", "gifts", "interactions"] },
  { name: "donors.list", file: "components/Donors.jsx", read: "Directory, the people count, the whole-org list", shows: ["donors"] },
  { name: "donors.officers", file: "components/Donors.jsx", read: "Team: each owner's people and dollars", shows: ["donors", "gifts"] },
  { name: "people.by-id", file: "lib/people.js", read: "Home's rail person view (Lifetime, Last gift), Finance names, the hand-picked audience", shows: ["donors", "gifts", "interactions"] },
  { name: "comms.overview", file: "components/Communications.jsx", read: "Overview: Recent sends, emails sent, who you can reach", shows: ["campaigns", "donors"] },
  { name: "comms.campaigns", file: "components/Communications.jsx", read: "Campaigns list and its count", shows: ["campaigns"] },
  { name: "comms.sent", file: "components/Communications.jsx", read: "Sent list and its counts", shows: ["campaigns"] },
  // COMMS-3: the thank-you queue (Drafts to review, the profile's Emails tab, Money in).
  // COMMS-3: Audience: who you can reach, the six cards, the list.
  { name: "comms.audience", file: "components/communications/AudienceView.jsx", read: "Audience: the reach bar, the biggest gap, each card's count and given, the list", shows: ["donors", "gifts"] },
  { name: "comms.thank-yous", file: "components/ThankYouDrafts.jsx", read: "Thank-yous waiting to send, and their count", shows: ["thank_you_drafts"] },
  { name: "volunteers.roster", file: "components/VolunteersHub.jsx", read: "Volunteers header sentence, the counts card, the list", shows: ["donors", "volunteer_shifts"] },
  { name: "volunteers.shifts", file: "components/VolunteersHub.jsx", read: "Records → Recent shifts", shows: ["volunteer_shifts", "donors"] },
  // FRESH-3 item 1 (W-1112-Volunteers-01X, Area 3 F1): every Finance panel, so a money write that reaches none fails.
  { name: "finance.ledger", file: "components/Finance.jsx", read: "Finance: transactions, accounts, budgets, the period tiles and cash on hand", shows: ["fin_transactions", "gifts", "fin_funds", "budgets"] },
  { name: "finance.this-month", file: "components/Finance.jsx", read: "Overview → This month: the four figures, the months, gifts with no fund", shows: ["gifts", "fin_transactions", "pledges"] },
  { name: "finance.month-close", file: "components/Finance.jsx", read: "Exports → Month close: the bookkeeper's file and the deposits for the month", shows: ["gifts", "deposits"] },
  { name: "finance.fund-cards", file: "components/finance/FundCards.jsx", read: "Funds: each fund's card, its balance and the dialog it opens", shows: ["gifts", "fin_funds", "pledges"] },
  { name: "finance.post-to-books", file: "components/finance/PostToBooks.jsx", read: "Transactions: gifts waiting to post to the books", shows: ["gifts", "fin_transactions"] },
  { name: "finance.restricted", file: "components/RestrictedView.jsx", read: "Grants money → Restricted: each grant's balance, the totals and the sentence", shows: ["grants", "gifts", "pledges"] },
  { name: "finance.recurring", file: "components/RecurringGiving.jsx", read: "Recurring giving: the roster, its counts and this month's movement", shows: ["giving_recurring", "offline_recurring_plans", "gifts"] },
  { name: "fundraising.pledges", file: "components/Pledges.jsx", read: "Pledges: every open pledge, what is paid and what is left", shows: ["pledges", "gifts"] },
  { name: "events.list", file: "components/Events.jsx", read: "Events list, its cards' Raised and the stats strip", shows: ["events", "event_attendees", "gifts"] },
  { name: "event.rows", file: "lib/eventRows.js", read: "an event's guests, the check-in header (N of M), Came", shows: ["event_attendees", "events"] },
  // FRESH-3 item 2 (W-1112-Volunteers-01X Area 4, W-1126-Volunteers-01): the Schedule, the Applications list, the
  // profile's volunteer panel and the Events desk (guests, waitlist, each card's counts).
  { name: "volunteers.schedule", file: "components/VolunteerSchedule.jsx", read: "Schedule: Day, Week, Month and List, each shift's people, short and conflict tags, Schedule conflicts", shows: ["volunteer_slots", "volunteer_signups", "donors"] },
  { name: "volunteers.applications", file: "components/VolunteerRecruit.jsx", read: "Applications: the list and the pending count on the hub", shows: ["volunteer_applications", "donors"] },
  { name: "profile.volunteer", file: "components/VolunteerPanel.jsx", read: "a profile's Volunteer tab: hours, shifts, can give, status", shows: ["volunteer_shifts", "volunteer_records", "volunteer_signups"] },
  { name: "events.desk-guests", file: "components/EventsDesk.jsx", read: "an event on the desk: guests, the waitlist, seats and Came", shows: ["event_attendees", "events", "donors"] },
  { name: "events.desk-cards", file: "components/EventsDesk.jsx", read: "the desk's event cards: Invited, Going, Came and Raised", shows: ["events", "event_attendees", "gifts"] },
  { name: "trash.list", file: "components/settings/TrashList.jsx", read: "Settings → Trash: the rows", shows: ["donors", "deleted_records"] },
  { name: "trash.count", file: "components/settings/TrashLink.jsx", read: "Settings: Trash (n)", shows: ["donors"] },
  // SALES-5: /ops → Sales. Each reads the customer's one price (server/admin/sales/customerPrice.js).
  { name: "sales.pipeline", file: "pages/ops/sales/PipelineView.jsx", read: "Pipeline board: column counts and monthly totals, each card's price", shows: ["sales_deals", "sales_quotes", "orgs"] },
  { name: "sales.deal-header", file: "pages/ops/sales/DealHeader.jsx", read: "the deal page's header: stage, price, ARR, next step", shows: ["sales_deals", "sales_quotes", "orgs"] },
  { name: "sales.record", file: "pages/ops/sales/RecordPage.jsx", read: "a sales record: its fields, the Steward org's MRR row", shows: ["sales_deals", "sales_orgs", "orgs"] },
  { name: "sales.home", file: "pages/ops/sales/SalesView.jsx", read: "Forecast: weighted, signed, won billing starts, MRR now and ARR, month by month; Today", shows: ["sales_deals", "sales_quotes", "orgs"] },
];
