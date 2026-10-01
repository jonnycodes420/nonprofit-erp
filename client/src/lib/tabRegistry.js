// client/src/lib/tabRegistry.js — every fact about the app's tabs, in one place:
// what they are called, where each sits (rail, More, mobile bar), and who sees
// it (the Team flag, the Core tier, the Portal tier, the CRM's hidden set).
//
// FIX-1 split: these lists were moved VERBATIM out of App.jsx. Nothing in them
// changed; App.jsx imports them and renders the tabs as it did. A new tab is
// added here. JSX-free on purpose, so Node can read it (tests/fix1-walk §12).
// Tests read it through readSource("client/src/App.jsx").

// ── Tabs ───────────────────────────────────────────────────────────────────
const TABS=[
  {id:"dashboard",label:"Home",icon:"◈"},
  // BUILD-86 — Home is hers at 7:40 in the morning; Dashboard is the board
  // meeting. The `dashboard` id KEEPS its route and its "Home" label so every
  // deep link, navigateTo("dashboard") call and the morning email's links
  // work unchanged.
  //
  // NAV-1 §2 — THE `board` TAB IS GONE AND THE DASHBOARDS ARE NOT. They fold
  // into Reports, as the first group of its one rail, because "Reports" and
  // "Dashboards" are the same question asked twice and the two shared the ▤
  // glyph to prove it. Nothing is deleted: Dashboards.jsx draws all four as
  // before, and navigateTo("board") lands on them (App.jsx), so every older
  // link, card and email still opens the dashboard it named.
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"fundraising",label:"Fundraising",icon:"↗"},
  // FIX-4 2 — JOURNEYS IS ITS OWN ROOM, under Fundraising. It lived in
  // Settings, reachable by one button on Campaigns & pages, which put the
  // thing an org does weekly behind the screen it opens twice a year. The
  // builder component did not move; this is a second door to it, and the
  // Settings section keeps working so every deep link survives.
  {id:"journeys",label:"Journeys",icon:"⇢"},
  // EVENTS-1 — EVENTS IS ITS OWN ROOM, under Fundraising, for the same reason
  // Journeys is: an organisation runs a gala or a 5K once or twice a year and
  // spends six weeks inside it each time. The screen existed and was
  // unreachable, commented out of this list; the model, the money path and the
  // receipts were all already built. This is the door.
  {id:"events",label:"Events",icon:"◎"},
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"portal",label:"Donor Portal",icon:"◫"},
  {id:"tasks",label:"Tasks",icon:"◻"},
  // FIX-1 §A — Steward Agent is its own room. The Workflows recipes moved
  // into it (Agent → Workflows); the "workflows" id still deep-links there
  // (App.jsx navigateTo), it just has no nav entry of its own.
  {id:"agent",label:"Agent",icon:"✦"},
  {id:"volunteers",label:"Volunteers",icon:"◎"},
  {id:"reports",label:"Reports",icon:"▤"},
  {id:"finance",label:"Finance",icon:"◇"},
  {id:"settings",label:"Settings",icon:"⚙"},
  // DEPRIORITIZED — pivoting to donor dashboard focus, code kept intact, re-enable by uncommenting
  // {id:"board",label:"Board",icon:"◆",earlyAccess:true},
];
// ── FIX-9 Part E — THE BOTTOM BAR IS THE RAIL, IN THE RAIL'S ORDER ────────
// At 390 the bar gave GRANTS a primary slot while Fundraising and Agent sat
// behind More, so the phone taught a different product from the desktop: the
// rail is Home, Donors, Fundraising, Volunteers, Agent, Reports and Finance,
// and Grants is not on it at all. The four primary slots are now the first
// four of the rail's own order, with everything else behind More. Grants
// keeps its place in More, where it has always been reachable.
const BOTTOM_TABS=[
  {id:"dashboard",label:"Home",icon:"◉"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"fundraising",label:"Fundraising",icon:"↗"},
  {id:"agent",label:"Agent",icon:"✦"},
];
const MORE_TABS=[
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"journeys",label:"Journeys",icon:"⇢"},
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"portal",label:"Donor Portal",icon:"◫"},
  {id:"tasks",label:"Tasks",icon:"◻"},
  {id:"volunteers",label:"Volunteers",icon:"◎"},
  {id:"reports",label:"Reports",icon:"▤"},
  {id:"finance",label:"Finance",icon:"◇"},
  {id:"settings",label:"Settings",icon:"⚙"},
  // DEPRIORITIZED — pivoting to donor dashboard focus, code kept intact, re-enable by uncommenting
  // {id:"events",label:"Events",icon:"◎"},
  // {id:"volunteers",label:"Volunteers",icon:"◎",earlyAccess:true},
  // {id:"board",label:"Board",icon:"◆",earlyAccess:true},
];

// ── NAV-1 — THE SIDEBAR'S SHAPE MOVED OUT OF THIS FILE ────────────────────
// PRIMARY_NAV, MORE_NAV and NAV_MORE_KEY described a flat rail with a "More"
// fold (BUILD-87 F.3.5, FIX-1 §12, EVENTS-1). The rail is GROUPS now and
// nothing is behind a disclosure, so the shape lives in one place that the
// desktop rail, the collapsed rail and the phone's More drawer all read:
// client/src/lib/navGroups.js. This file keeps what a tab IS — its label, its
// icon name, who may see it. navGroups.js says where it sits.
// FIX-1 §B — the Pipeline left the sidebar and folded into Fundraising →
// Major gifts (App.jsx's navigateTo sends every "pipeline" there). The gate
// did not move: the Pipeline part inside Major gifts reads this same Set, so
// a Core org sees the lock where the board now lives.
const TEAM_GATED=new Set(["pipeline"]);
// BUILD-88a A.3 — FINANCE IS BEHIND THE TEAM FLAG. Cowork's recommendation,
// and Jonathan's to overturn in one line by emptying this set: a ledger, a
// chart of accounts and a budget are a bookkeeper's tools, and a one-person
// shop that opens Finance meets an empty set of books it did not ask for and
// cannot fill. Unlike the Pipeline this is not a locked PREVIEW — there is
// nothing of the org's own to show behind glass, and an empty ledger under a
// padlock is an advertisement, not a feature (BUILD-87's rule about showing
// somebody a screen that is not for them). No customer is on Core with books
// today, so nothing is taken away from anyone.
const CORE_HIDDEN_TABS=new Set(["finance"]);

// BUILD-58 W-2 — the Portal tier is NOT the CRM, and its shell says so
// honestly: only the surfaces the tier's own capabilities live on (gift
// recording + import in Donors, the portal hub/editor + impact updates in
// Donor Portal, receipts + giving in Settings). First login lands on the
// portal hub, never an error screen. The server's portal_tier gate is
// unchanged — this is the UI finally matching it.
const PORTAL_TIER_TABS=new Set(["donors","portal","settings"]);

// ── HIDDEN FROM THE CRM's NAVIGATION (2026-09-10) ──────────────────────────
// The same "hidden, not deleted" move as Events / Volunteers / Board: the tab
// comes out of the navigation and every route, table, component and test
// behind it stays intact, re-enabled by deleting an id from this set.
//
// GIVING PAGES ARE NOT AFFECTED and are a different surface entirely: they
// live in Settings → Giving Pages, along with Stripe Connect, donor-covers-
// fees, the org's timezone and the public /give page. None of that moves.
//
// NOT hidden for a `plan === "portal"` org, whose ENTIRE product is this tab
// (PORTAL_TIER_TABS above) — hiding it globally would leave those orgs
// navigating to something that is not there, which is the one case that has to
// keep working. `tabAllowed` below is where the two rules meet.
const CRM_HIDDEN_TABS=new Set(["portal"]);

export { TABS, BOTTOM_TABS, MORE_TABS, TEAM_GATED, CORE_HIDDEN_TABS, PORTAL_TIER_TABS, CRM_HIDDEN_TABS };
