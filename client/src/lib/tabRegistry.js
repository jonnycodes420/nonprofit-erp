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
  // work unchanged; the board is a new id beside it. Renaming the old one
  // would have been ~40 call sites for no user-visible gain.
  {id:"board",label:"Dashboards",icon:"▤"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"fundraising",label:"Fundraising",icon:"↗"},
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"portal",label:"Donor Portal",icon:"◫"},
  {id:"tasks",label:"Tasks",icon:"◻"},
  {id:"workflows",label:"Workflows",icon:"◧"},
  {id:"volunteers",label:"Volunteers",icon:"◎"},
  {id:"reports",label:"Reports",icon:"▤"},
  {id:"finance",label:"Finance",icon:"◇"},
  {id:"settings",label:"Settings",icon:"⚙"},
  // DEPRIORITIZED — pivoting to donor dashboard focus, code kept intact, re-enable by uncommenting
  // {id:"events",label:"Events",icon:"◎"},
  // {id:"volunteers",label:"Volunteers",icon:"◎",earlyAccess:true},
  // {id:"board",label:"Board",icon:"◆",earlyAccess:true},
];
const BOTTOM_TABS=[
  {id:"dashboard",label:"Home",icon:"◉"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"settings",label:"Settings",icon:"⚙"},
];
const MORE_TABS=[
  {id:"board",label:"Dashboards",icon:"▤"},
  {id:"fundraising",label:"Fundraising",icon:"↗"},
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"portal",label:"Donor Portal",icon:"◫"},
  {id:"tasks",label:"Tasks",icon:"◻"},
  {id:"workflows",label:"Workflows",icon:"◧"},
  {id:"volunteers",label:"Volunteers",icon:"◎"},
  {id:"reports",label:"Reports",icon:"▤"},
  {id:"finance",label:"Finance",icon:"◇"},
  // DEPRIORITIZED — pivoting to donor dashboard focus, code kept intact, re-enable by uncommenting
  // {id:"events",label:"Events",icon:"◎"},
  // {id:"volunteers",label:"Volunteers",icon:"◎",earlyAccess:true},
  // {id:"board",label:"Board",icon:"◆",earlyAccess:true},
];

// ── BUILD-87 F.3.5 — SIX THINGS, THEN THE REST ─────────────────────────────
// The sidebar had eleven items in three labeled groups (BUILD-20 Part 3), and
// every one of them was equally loud. Five stay on the rail — Home, Dashboards,
// Donors, Fundraising, Reports — with Settings pinned at the bottom where it
// already was; the other six fold into ONE collapsible "More", shut by default
// and remembered per browser. Nothing is hidden and nothing is deleted: the
// group opens on click, and opens ITSELF whenever the surface you are on lives
// inside it, so you can never be standing somewhere the nav does not show.
//
// MOBILE IS UNCHANGED. The bottom bar + "More" drawer is already this shape,
// and four slots is a different constraint from a 220px rail.
const PRIMARY_NAV=["dashboard","board","donors","fundraising","volunteers","reports"];
const MORE_NAV=["grants","communications","tasks","workflows","finance","portal"];
const NAV_MORE_KEY="steward_nav_more";
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

export { TABS, BOTTOM_TABS, MORE_TABS, PRIMARY_NAV, MORE_NAV, NAV_MORE_KEY, TEAM_GATED, CORE_HIDDEN_TABS, PORTAL_TIER_TABS, CRM_HIDDEN_TABS };
