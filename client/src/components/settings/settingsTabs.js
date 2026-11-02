import { T } from "../shared";

// Billing status badge styling, keyed by orgs.subscription_status.
// "cancelled" (2 l's) is included alongside "canceled" (1 l) because old
// rows may have been written with either spelling (see server.js).
export const BILLING_STATUS_META = {
  active:        { label:"Active",        bg:T.green100, color:T.greenDk, border:T.greenDk },
  trialing:      { label:"Trialing",      bg:T.bgElevated, color:"rgba(240,237,230,0.7)", border:T.green650 },
  past_due:      { label:"Past Due",      bg:T.terra100, color:T.terra700, border:T.terra200 },
  trial_expired: { label:"Trial Expired", bg:T.terra100, color:T.terra700, border:T.terra200 },
  canceled:      { label:"Canceled",      bg:T.bgElevated, color:"rgba(240,237,230,0.7)", border:T.green650 },
  cancelled:     { label:"Canceled",      bg:T.bgElevated, color:"rgba(240,237,230,0.7)", border:T.green650 },
};

export const SETTINGS_TABS=[
  {id:"org",label:"Organization"},
  {id:"team",label:"Team"},
  // BUILD-95 §4 — ONE TAB FOR EVERY OUTSIDE CONNECTION. Setting up online
  // giving is two jobs — a card processor for Steward's own pages, and the
  // places you already take gifts so Steward can see them — and they lived on
  // two different tabs, with the Home checklist deep-linking to a THIRD (the
  // page builder). The copy promised both and the link delivered neither.
  //
  // FIX-13 Part 5 — and then there were two again: Integrations ("set this
  // up") and Connections ("is it still working") covered the same ground and
  // things were scattered between them. ONE page now, Connections. The old
  // ids are aliases (SECTION_ALIAS below), so every saved link, nav intent
  // and ?sub= URL still lands, on the right card when it names one.
  {id:"connections",label:"Connections"},
  {id:"giving",label:"Giving Pages"},
  {id:"customization",label:"Customization"},
  // BUILD-86 Part B — the five questions, reachable forever after the first run.
  {id:"words",label:"Your words"},
  // THREAD-2b 3 — the journey builder lives here, and Fundraising links to
  // it. It is a SETTINGS thing because it is a rule the organisation keeps,
  // not a thing you do to one donor.
  {id:"journeys",label:"Journeys"},
  // 2026-09-10 — the Donor Portal tab is hidden from the CRM's navigation
  // (App.jsx CRM_HIDDEN_TABS), and this section was only ever a POINTER to it,
  // so it goes with it rather than becoming a link to nowhere. Still shown to a
  // `portal` plan org, whose product that tab is. Giving Pages is a separate
  // section and is untouched.
  {id:"portal",label:"Donor Portal",portalTierOnly:true},
  // SEND-GATE-2 — which emails Steward sends on its own, and what is going out.
  {id:"automatic",label:"Automatic email"},
  {id:"going-out",label:"Going out"},
  {id:"receipts",label:"Tax Receipts"},
  // COMMS-2 — colours, signature, address and tax language for every template.
  {id:"brandkit",label:"Brand kit"},
  // BUILD-87 Part 1 — every import run, newest first, with the receipt it
  // showed when it committed. Read only: this build does not undo an import.
  {id:"imports",label:"Imports"},
  // AGENT-5 — Atlas's rules, in plain words, and its pause switch: the
  // Agent page's Guardrails moved here when the page went.
  {id:"atlas",label:"Atlas"},
  // FIX-11 Part 1 — EVERY CHANGE ANYONE MADE. Owners and admins only, which
  // the tab list enforces here and the route enforces again: the log names who
  // signed in, whose role changed and who downloaded a donor file.
  {id:"audit",label:"Audit log",adminOnly:true},
  // CLIENT-SAFE-1 — "We serve clients whose details are private".
  {id:"privacy",label:"Privacy"},
  {id:"data",label:"Your Data"},
  // FIX-57 — how each person signs what is drafted for them.
  {id:"profile",label:"My profile"},
  {id:"account",label:"Account"},
  // STAFF-MAIL-1 — the morning email (what is in it, when) and every other
  // staff email, each off until the person turns it on.
  {id:"myemail",label:"Your email"},
  // SEC-1 — two-factor, the team rule, sessions and the password, in one place.
  {id:"security",label:"Security"},
];

// FIX-13 Part 5 — a retired section id opens the section that took it over,
// and the focus it implies when the caller did not name one.
export const SECTION_ALIAS={integrations:{section:"connections"},sources:{section:"connections",focus:"giving"}};
