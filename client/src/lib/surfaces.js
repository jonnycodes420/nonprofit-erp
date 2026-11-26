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
  { name: "volunteers.roster", file: "components/VolunteersHub.jsx", read: "Volunteers header sentence, the counts card, the list", shows: ["donors", "volunteer_shifts"] },
  { name: "volunteers.shifts", file: "components/VolunteersHub.jsx", read: "Records → Recent shifts", shows: ["volunteer_shifts", "donors"] },
  { name: "events.list", file: "components/Events.jsx", read: "Events list, its cards' Raised and the stats strip", shows: ["events", "event_attendees", "gifts"] },
  { name: "event.rows", file: "lib/eventRows.js", read: "an event's guests, the check-in header (N of M), Came", shows: ["event_attendees", "events"] },
  { name: "trash.list", file: "components/settings/TrashList.jsx", read: "Settings → Trash: the rows", shows: ["donors", "deleted_records"] },
  { name: "trash.count", file: "components/settings/TrashLink.jsx", read: "Settings: Trash (n)", shows: ["donors"] },
  // SALES-5: /ops → Sales. Each reads the customer's one price (server/admin/sales/customerPrice.js).
  { name: "sales.pipeline", file: "pages/ops/sales/PipelineView.jsx", read: "Pipeline board: column counts and monthly totals, each card's price", shows: ["sales_deals", "sales_quotes", "orgs"] },
  { name: "sales.deal-header", file: "pages/ops/sales/DealHeader.jsx", read: "the deal page's header: stage, price, ARR, next step", shows: ["sales_deals", "sales_quotes", "orgs"] },
  { name: "sales.record", file: "pages/ops/sales/RecordPage.jsx", read: "a sales record: its fields, the Steward org's MRR row", shows: ["sales_deals", "sales_orgs", "orgs"] },
  { name: "sales.home", file: "pages/ops/sales/SalesView.jsx", read: "Forecast: weighted, signed, won billing starts, MRR now and ARR, month by month; Today", shows: ["sales_deals", "sales_quotes", "orgs"] },
];
