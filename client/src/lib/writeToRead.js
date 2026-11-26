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
// SCALE-6 item 3
const E = "e_event";
const FUNDRAISING = [{ read: "Fundraising totals (Fundraising.jsx)", kinds: ["gift", "pledge", "totals", "event"] }];
const DONORS_PORTFOLIO = [{ read: "Donors portfolio totals (Donors.jsx loadOfficers)", kinds: ["gift", "person", "totals"] }];
const VOLUNTEER = [
  { read: "Volunteers header, counts and Recent shifts (VolunteersHub.jsx useLive, FRESH-2)", kinds: ["volunteer", "person"] },
  { read: "Profile volunteer hours (VolunteerPanel.jsx)", kinds: ["volunteer"], ids: { person: P } },
];
const EVENT = [
  { read: "Event attendee list (EventsDesk.jsx)", kinds: ["event"], ids: { event: E } },
  { read: "Each event's summary card (EventsDesk.jsx, Events.jsx)", kinds: ["event"] },
];
const BADGE = [{ read: "Sidebar Tasks badge (taskBadge.js)", kinds: ["task"] }];

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
  // SCALE-6 item 3 (W-1112-Volunteers-01X, nine nights): the brief's pairs, each as the
  // screen sends it. tests/scale6.test.js §3 checks them against each screen's own
  // subscription line, and docs/decisions/architecture.md has the table in words.
  { write: "Pledge saved on a profile", method: "POST", path: `/donors/${P}/pledges`, reads: [...PROFILE, ...FUNDRAISING, ...FINANCE] },
  { write: "Pledge payment (schedule)", method: "PUT", path: "/pledges/pl_1/installments", body: { donorId: P }, reads: [...PROFILE, ...FUNDRAISING, ...FINANCE] },
  { write: "Gift deleted on a profile", method: "DELETE", path: "/gifts/g_1", reads: [...PROFILE, ...PORTFOLIO, ...DONORS_PORTFOLIO, ...FUNDRAISING, ...FINANCE] },
  { write: "Volunteer hours logged", method: "POST", path: `/donors/${P}/volunteer-hours`, reads: VOLUNTEER },
  { write: "Event guest added", method: "POST", path: `/events/${E}/attendees`, reads: EVENT },
  { write: "Task completed", method: "POST", path: "/tasks/t_1/complete", reads: BADGE },
  { write: "Next step done (Home's drift row)", method: "POST", path: `/drift/${P}/done`, reads: BADGE },
  { write: "Plan step done (profile rail)", method: "POST", path: "/plan-steps/ps_1/done", reads: BADGE },
  { write: "Owners assigned from Home", method: "POST", path: "/home/owners/assign", reads: [...PORTFOLIO, ...DONORS_PORTFOLIO] },
];

// SCALE-6 item 3 · THE WRITES THAT CHANGE NO SCREEN. scripts/ci/write-announce-scan.mjs
// fails CI on a write in client/src that announces nothing (lib/changes.js kindsOfWrite
// answers "other") unless it is named here, with why no figure on any screen shows it.
export const NO_SCREEN_READS = [
  // ONBOARD-5: the setup page's own progress, its yearly events and the website-colors read are
  // shown only on the setup page, which re-reads itself (Home's card reads it when Home opens).
  { method: "POST", re: /^\/onboarding\/guided\/(at|confirm|finish)$/, why: "setup progress shows only on the setup page, which re-reads it, and on Home's card when Home opens" },
  { method: "POST", re: /^\/onboarding\/setup\/site-colors$/, why: "reading her website's colors writes nothing" },
  { method: "POST", re: /^\/onboarding\/setup\/events(\/remove)?$/, why: "her yearly events are listed only on the setup page's Funds step, which re-reads them" },
  // ORDER-1: an order is edited and sent from the order panel on /admin, for ANOTHER org; the panel
  // shows its own answer, and no screen of the signed-in org shows the order.
  { method: "PATCH", re: /^\/admin\/start-links\/[^/]+\/order$/, why: "an order edit shows only in the /admin order panel, which shows its own answer" },
  { method: "POST", re: /^\/admin\/start-links\/[^/]+\/send$/, why: "Send shows only its own sentence in the /admin order panel; it writes the order's sent time" },
  // ONBOARD-4: a skip is shown only on the guided setup card, which re-reads itself; the
  // concierge map and Load run on /ops for ANOTHER org, whose people no /ops screen shows.
  { method: "POST", re: /^\/onboarding\/guided\/skip$/, why: "a skipped setup step shows only on the guided setup card, which re-reads itself" },
  { method: "POST", re: /^\/ops\/onboarding\/concierge\/[^/]+\/(map|load)$/, why: "a concierge map or Load on /ops writes another org's file and people; the /ops list re-reads itself" },
  // BUILDER-2B: a saved email block is shown only in the editor's Blocks tab, which re-reads
  // itself after a save, a rename or a delete; no other screen lists or counts them.
  { method: "POST", re: /^\/email-blocks$/, why: "a saved email block is shown only in the editor's Blocks tab, which re-reads itself" },
  { method: "PUT", re: /^\/email-blocks\/[^/]+$/, why: "renaming a saved email block shows only in the Blocks tab, which re-reads itself" },
  // BUILDER-3: who has an email open is a heartbeat the editor reads back in its own answer; a
  // comment and its Resolve show only in the editor's Comments panel (and the review page), which
  // re-read themselves, and in a mentioned person's bell, which reads them every minute.
  { method: "POST", re: /^\/email-templates\/[^/]+\/presence(\/leave)?$/, why: "a heartbeat: the editor shows who is here from its own answer; no other screen shows it" },
  { method: "POST", re: /^\/email-templates\/[^/]+\/comments$/, why: "a comment shows only in the editor's Comments panel and the review page, which re-read themselves, and in the bell" },
  { method: "POST", re: /^\/email-comments\/[^/]+\/resolve$/, why: "a resolved comment hides from the Comments panel, which re-reads itself, and from the bell" },
  { method: "POST", re: /^\/email-templates\/[^/]+\/share$/, why: "a review link shows only in the editor's Share panel, which re-reads its list" },
  { method: "POST", re: /^\/email-review-links\/[^/]+\/revoke$/, why: "turning a review link off shows only in the Share panel, which re-reads its list" },
  { method: "POST", re: /^\/email-export$/, why: "an export renders the email and writes nothing" },
  { method: "PUT", re: /^\/email-style$/, why: "the house style shows in an email's preview, which the editor redraws; no figure reads it" },
  // SENDS-2: building a send plan writes only the list she is shown (send_plans); nothing is sent.
  { method: "POST", re: /^\/send-plans$/, why: "a send plan is the list shown before a bulk send; no screen counts plans" },
  // LETTERS-1: reading a Word file and previewing letters write nothing; a letter template and a
  // signature picture are shown only on the screen that saves them, which re-reads itself.
  { method: "POST", re: /^\/letters\/giving\/preview$/, why: "a preview of who gets a letter writes nothing" },
  { method: "POST", re: /^\/acknowledgments\/templates\/docx$/, why: "reading a Word file into a layout writes nothing" },
  { method: "POST", re: /^\/acknowledgments\/templates$/, why: "a letter template is listed only on Printed letters, which re-reads it" },
  { method: "DELETE", re: /^\/acknowledgments\/templates\/[^/]+$/, why: "a letter template is listed only on Printed letters, which re-reads it" },
  { method: "PUT", re: /^\/letters\/signatures\/[^/]+$/, why: "a signature picture is shown only where it is uploaded" },
  // ONBOARD-4: a partner code is listed only in Sales settings → Partner codes, which re-reads itself.
  { method: "POST", re: /^\/ops\/sales\/partner-codes$/, why: "a partner code is listed only on the card that adds it, which re-reads it" },
  { method: "DELETE", re: /^\/ops\/sales\/partner-codes\/[^/]+$/, why: "a partner code is listed only on the card that removes it, which re-reads it" },
];
