// client/src/lib/writeToRead.js · FLOWS-13 item 1 (W-1112-Volunteers-01X, fourth night).
// THE WRITE-TO-READ LIST: each write the fleet saw leave a stale screen, and the
// reads on that screen that must re-read when it lands, with no reload.
//
// FLOWS-8 and FLOWS-10 fixed the first screen after an action panel by panel.
// This list names the writes, so a write that loses its rule in lib/changes.js
// (or never had one) is caught by tests/flows13.test.js §1, not by the fleet.
// `hears` is what a view on that screen subscribes to (useChanged kinds, and the
// id it is scoped to); the test asks lib/changes.js whether each write reaches it.
//
// A new entry: the write's method and path as api.js sends it, a body when the
// rule reads one, and every read on the screen where she made it.
const P = "d_person", G = "g_gift", PL = "pl_pledge";
const PROFILE = [
  { read: "Header Lifetime, This fiscal year, Last gift (useProfileRefresh)", kinds: ["person"], ids: { person: P } },
  { read: "By year (ByYear.jsx)", kinds: ["gift", "pledge"], ids: { person: P } },
  { read: "What they support, pledges (useProfileGiving.jsx)", kinds: ["gift", "pledge"] },
  { read: "Suggested ask, Insights for this person (Insights.jsx)", kinds: ["gift", "pledge", "insights"] },
  { read: "Receipts drift (ReceiptsAndStatements.jsx)", kinds: ["gift"] },
  { read: "Recurring plans recorded by staff (OfflinePlans.jsx)", kinds: ["gift"] },
];
const PORTFOLIO = [{ read: "Home's portfolio card (PortfolioCard.jsx)", kinds: ["gift", "person", "task", "totals"] }];
const FINANCE = [{ read: "Finance totals (Finance.jsx)", kinds: ["gift", "pledge", "fund", "totals"] }];
const BRAND = [
  { read: "Brand Identity preview (BrandingManager.jsx)", kinds: ["org"] },
  { read: "Brand kit letterhead (BrandKit.jsx)", kinds: ["org"] },
];
const TEAM = [{ read: "Team, Invited (InvitedList.jsx)", kinds: ["org"] }];

export const WRITE_TO_READ = [
  // FLOWS-8 / FLOWS-10, kept here so the list is whole
  { write: "A guest added to an event", method: "POST", path: "/events/e1/attendees", reads: [{ read: "After the event, seats (Events.jsx)", kinds: ["event"], ids: { event: "e1" } }] },
  { write: "A gift recorded on a profile", method: "POST", path: `/donors/${P}/gifts`, reads: [...PROFILE, ...PORTFOLIO, ...FINANCE] },
  // FLOWS-13: the fleet's list, 14 Nov
  { write: "Gift edit ($100 to $150)", method: "PUT", path: `/gifts/${G}`, body: { amount: 150, donorId: P }, reads: [...PROFILE, ...PORTFOLIO, ...FINANCE] },
  { write: "Pledge payment", method: "POST", path: `/pledges/${PL}/installments`, body: { donorId: P }, reads: [...PROFILE, ...FINANCE] },
  { write: "Pledge write-off", method: "PUT", path: `/pledges/${PL}`, body: { status: "written_off", donorId: P }, reads: [...PROFILE, ...FINANCE] },
  { write: "Recurring cancel (Stripe)", method: "POST", path: "/recurring/subs/sub_1/cancel", reads: [...PROFILE, ...FINANCE] },
  { write: "Recurring cancel (recorded by staff)", method: "POST", path: "/offline-plans/op_1/cancel", reads: [...PROFILE, ...FINANCE] },
  { write: "Recurring payment (recorded by staff)", method: "POST", path: "/offline-plans/op_1/payments", reads: [...PROFILE, ...FINANCE] },
  { write: "Deposit undo (Finance)", method: "POST", path: "/finance/imported-deposited/undo", reads: [...PROFILE, ...FINANCE] },
  { write: "Deposit undo (the deposit sheet)", method: "POST", path: "/deposits/dep_1/undo", reads: [...PROFILE, ...FINANCE] },
  { write: "A person deleted", method: "DELETE", path: `/donors/${P}`, reads: [...PORTFOLIO, ...FINANCE] },
  { write: "A person erased", method: "POST", path: `/donors/${P}/erase`, reads: [...PORTFOLIO, ...FINANCE] },
  { write: "Org name saved", method: "PATCH", path: "/orgs/org_1", reads: BRAND },
  { write: "Logo or accent saved", method: "PUT", path: "/orgs/branding", reads: BRAND },
  { write: "Brand kit saved", method: "PUT", path: "/brand-kit", reads: BRAND },
  { write: "Invite sent", method: "POST", path: "/auth/invite", reads: TEAM },
  { write: "Invite revoked", method: "DELETE", path: "/org/invites/inv_1", reads: TEAM },
];
