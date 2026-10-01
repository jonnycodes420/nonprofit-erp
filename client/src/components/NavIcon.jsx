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

// 24px and stroke 2 everywhere. `aria-hidden` because the button beside it
// already carries the name: a screen reader that reads both says "Donors
// Donors".
//
// FIX-11 Part 6 — IT WAS 20px AND STROKE 1.75, AND THAT IS WHY THEY LOOKED
// GRAINY. Measured on a retina screenshot rather than guessed at: nothing
// scales them, nothing dims them, no ancestor carries a transform, a filter or
// a fractional width, and all thirteen sit exactly on the device-pixel grid.
// The softness is the STROKE, and the arithmetic is the whole story.
//
// An SVG stroke is centred on its path, so at device-pixel ratio 2 it is crisp
// only when it covers an EVEN number of device pixels. The coverage of one
// vertical stroke, read straight across:
//
//   20px / 1.75  = 2.917 device px   116 255 255 116   two half-lit pixels
//   20px / 1.8   = 3.000 device px   127 255 255 127   two half-lit pixels
//   20px / 1.5   = 2.500 device px    63 255 255  63   two half-lit pixels
//   20px / 1.2   = 2.000 device px       255 255       clean
//   24px / 2     = 4.000 device px   255 255 255 255   clean
//
// So "a whole number of device pixels" is NOT the rule — 1.8 gives exactly 3.0
// and is still soft, because 3 centred on a boundary is 1.5 either side. It
// has to be EVEN.
//
// At 20px the only clean strokes are 1.2 (31% less ink, dimmer on a dark rail)
// and 2.4 (38% more, noticeably bolder). Neither keeps the weight. 24px with
// stroke 2 is clean AND keeps the proportion: 2/24 is 0.083 where 1.75/20 was
// 0.088. The icon is 20% bigger, which is the visible part of this change.
export const NAV_ICON_SIZE = 24;
export const NAV_ICON_STROKE = 2;

export function NavIcon({ id, size = NAV_ICON_SIZE, style }) {
  const Glyph = ICONS[id];
  if (!Glyph) return null;
  return <Glyph size={size} strokeWidth={NAV_ICON_STROKE} aria-hidden="true"
    style={{ flexShrink: 0, display: "block", ...style }} />;
}

export const hasNavIcon = id => !!ICONS[id];
