// NAV-1 §3 — ONE LITERAL ICON PER NAV ITEM, AND NO TWO ALIKE.
//
// The rail's icons were the BUILD-20 geometric set (◈ ♦ ◫ ◑ …). That set is
// still right for a chip, a table cell or an empty state, and it was wrong
// here: a diamond for Home taught nothing, and TWO PAIRS of items shared a
// glyph — Events and Volunteers were both ◎, Reports and Dashboards were both
// ▤ — so the one place an icon has a job (tell two rows apart at a glance)
// was the one place it could not do it.
//
// lucide-react (ISC) draws the thirteen. Every one is the literal thing: a
// house for Home, a wallet for Finance, a hand holding a coin for Fundraising.
// One size, one stroke width, `currentColor` — so the active item, the resting
// item and the collapsed rail all inherit the colour the button already sets,
// and an icon is never a second decision about colour.
//
// The map lives in client/src/lib/navGroups.js (NAV_ICON_NAMES) so it can be
// read without React; this file is the drawing of it.
import {
  House, ListChecks, Users, Route, Mail, HandCoins, CalendarDays, FileText,
  HandHelping, Wallet, BarChart3, Sparkles, Settings as SettingsGear, PanelsTopLeft,
} from "lucide-react";

const ICONS = {
  dashboard: House,
  tasks: ListChecks,
  donors: Users,
  journeys: Route,
  communications: Mail,
  fundraising: HandCoins,
  events: CalendarDays,
  grants: FileText,
  volunteers: HandHelping,
  finance: Wallet,
  reports: BarChart3,
  agent: Sparkles,
  settings: SettingsGear,
  portal: PanelsTopLeft,
};

// 20px and stroke 1.75 everywhere. `aria-hidden` because the button beside it
// already carries the name — a screen reader that reads both says "Donors
// Donors".
export const NAV_ICON_SIZE = 20;
export const NAV_ICON_STROKE = 1.75;

export function NavIcon({ id, size = NAV_ICON_SIZE, style }) {
  const Glyph = ICONS[id];
  if (!Glyph) return null;
  return <Glyph size={size} strokeWidth={NAV_ICON_STROKE} aria-hidden="true"
    style={{ flexShrink: 0, display: "block", ...style }} />;
}

export const hasNavIcon = id => !!ICONS[id];
