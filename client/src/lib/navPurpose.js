// client/src/lib/navPurpose.js · NAV-2 (27 Nov). WHAT EACH SIDEBAR ENTRY IS FOR.
//
// One plain sentence for each entry. The menu editors show it beside an entry
// that is not on the sidebar, with its Add button (components/NavAddList.jsx).
// Its own file, read only by the editors (both load lazily), so Home's first
// download does not carry it. JSX-free, so Node reads it.
export const NAV_PURPOSE = {
  dashboard: "Where every day starts: who to thank, call or ask next.",
  tasks: "Your to-do list, and what is due for each person.",
  calendar: "Everything with a date: events, deadlines and tasks.",
  donors: "Every person and organization you know, and their giving.",
  groups: "Lists of people you keep together, like a board or a committee.",
  journeys: "Steps that follow up with people over time, each one yours to send.",
  communications: "Letters, emails and thank-yous: drafts and what went out.",
  portal: "The page your donors sign in to.",
  fundraising: "Campaigns, giving pages, pledges and money coming in.",
  majorgifts: "Big asks: the pipeline, portfolios and plans for each prospect.",
  events: "Galas, tickets, sponsors and who came.",
  auctions: "Auction items, bids and what each item raised.",
  p2p: "Supporters raising money for you on their own pages.",
  memberships: "Membership levels, members and renewals.",
  grants: "Funders, deadlines, reports and restricted money.",
  volunteers: "Volunteers, their shifts and their hours.",
  finance: "The ledger, deposits and funds.",
  reports: "Every report and dashboard, and the board report.",
  settings: "Your organization, people, connections and this menu.",
};
