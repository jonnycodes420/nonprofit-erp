// NAV-1 — A SIDEBAR YOU CAN SCAN.
//
// The rail was thirteen items in one flat list plus a "More" fold. Events and
// Volunteers shared an icon, Reports and Dashboards shared another, and the
// icons were abstract shapes (a diamond for Home). Tasks and Communications,
// used daily, were behind More. Jonathan, 30 September: "I wish we could
// organize this" and "make the icons make sense, like an actual house for Home."
//
// So: GROUPS, not a fold. Nothing is behind a disclosure any more — the rail
// is five short lists with a small uppercase label over each, and the two
// items that are not about the work (Agent, Settings) sit at the bottom,
// separated. A group of four things you can read is scannable in a way that
// thirteen equally loud items never were, at the same height.
//
// This file is the ONE place the groups and their order live. It is JSX-free
// and network-free on purpose — the same convention as tabRegistry.js and
// homeLayout.js — so the Node suite can import it directly. The per-item
// facts (label, route, who may see it) stay in tabRegistry.js; this file only
// says where each one sits.

// Top to bottom. `label` is the small uppercase heading over the group; null
// means the group has no heading (the first one, and the pinned bottom pair).
// `bottom: true` marks the pair the sidebar pins under its own separator.
//
// Donor Portal sits in RELATIONSHIPS so that a portal-tier org — whose whole
// product is that tab — has a place for it. Every other org has it hidden by
// tabRegistry's CRM_HIDDEN_TABS, as before, and the group simply does not
// render it.
export const NAV_GROUPS = [
  { id: "start",         label: null,              items: ["dashboard", "tasks"] },
  { id: "relationships", label: "Relationships",   items: ["donors", "groups", "journeys", "communications", "portal"] },
  // FIX-25: Auctions, Peer-to-peer and Memberships are parts of Fundraising
  // with a rail entry each, because nobody found them two clicks deep.
  { id: "raise",         label: "Raise",           items: ["fundraising", "events", "auctions", "p2p", "memberships", "grants"] },
  // Volunteers is its own product. It gets its own group rather than a slot
  // inside somebody else's, because a volunteer coordinator signs in to this
  // one word and nothing else on the rail is theirs.
  { id: "volunteers",    label: "Volunteers",      items: ["volunteers"] },
  { id: "money",         label: "Money",           items: ["finance", "reports"] },
  { id: "bottom",        label: null, bottom: true, items: ["agent", "settings"] },
];

// The lucide icon for each item, one per item and no two alike. Drawn by
// client/src/components/NavIcon.jsx; named here so a test can read the map
// without loading React.
export const NAV_ICON_NAMES = {
  dashboard: "house", tasks: "list-checks", donors: "users", journeys: "route",
  communications: "mail", fundraising: "hand-coins", events: "calendar-days",
  grants: "file-text", volunteers: "hand-helping", finance: "wallet",
  reports: "bar-chart-3", agent: "sparkles", settings: "settings",
  portal: "panels-top-left", groups: "group",
  auctions: "gavel", p2p: "flag", memberships: "id-card",
};

// Home is where every deep link lands and Settings is where you fix a mistake:
// hiding either one would leave somebody with no way back.
export const NEVER_HIDDEN = new Set(["dashboard", "settings"]);

// What a role starts with hidden, before anyone customizes anything. A
// volunteer coordinator does not see giving anywhere else in the product
// (routes/volunteer.js), so a ledger on their rail was a door to nothing.
// Nothing else is hidden by default for anybody.
export const ROLE_DEFAULT_HIDDEN = { volunteer_coordinator: ["finance"] };

export const ALL_NAV_IDS = NAV_GROUPS.flatMap(g => g.items);

// ── The saved layout, merged with the canonical groups above ───────────────
// A person's saved layout is [{ id, visible }], the same shape as the Home
// layout (BUILD-34) and stored the same way: per USER, in the users row, so
// it follows them to another browser. Order is only ever WITHIN a group — an
// item cannot leave the group it belongs to, because the groups are what make
// the rail readable and a per-person shuffle across them would undo that.
//
// The merge rules, in one place:
//   · an item the saved list does not name keeps its canonical position, at
//     the END of its group, and is VISIBLE — so a nav item added next month
//     appears for everybody, including people who customized last month
//   · an id the canonical groups no longer hold is dropped
//   · Home and Settings are visible whatever the saved list claims
//   · a role default applies ONLY to somebody who has never saved a layout
export function navLayout(saved, opts = {}) {
  const role = opts.role || null;
  const rows = Array.isArray(saved) ? saved : null;
  const pos = new Map(), vis = new Map();
  if (rows) {
    rows.forEach((r, i) => {
      if (!r || typeof r.id !== "string" || pos.has(r.id)) return;
      pos.set(r.id, i);
      vis.set(r.id, r.visible !== false);
    });
  }
  const roleHidden = new Set(rows ? [] : (ROLE_DEFAULT_HIDDEN[role] || []));
  return NAV_GROUPS.map(g => ({
    id: g.id,
    label: g.label || null,
    bottom: !!g.bottom,
    items: g.items
      .map((id, i) => ({ id, i, p: pos.has(id) ? pos.get(id) : Infinity }))
      .sort((a, b) => (a.p - b.p) || (a.i - b.i))
      .map(({ id }) => ({
        id,
        visible: NEVER_HIDDEN.has(id) ? true
          : vis.has(id) ? vis.get(id)
          : !roleHidden.has(id),
      })),
  }));
}

// The flat [{id,visible}] to send back to the server, read off a merged
// layout. Groups are canonical, so their order carries no information.
export function flattenNav(groups) {
  return (groups || []).flatMap(g => g.items.map(i => ({ id: i.id, visible: !!i.visible })));
}

// Move one item up or down WITHIN its group. Returns a new layout; a move off
// either end of the group is a no-op, so the buttons can stay simple.
export function moveNavItem(groups, groupId, id, delta) {
  return (groups || []).map(g => {
    if (g.id !== groupId) return g;
    const from = g.items.findIndex(i => i.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= g.items.length) return g;
    const items = g.items.slice();
    const [row] = items.splice(from, 1);
    items.splice(to, 0, row);
    return { ...g, items };
  });
}

// Apply an order of ids onto a group, where the ids are only the items the
// viewer could SEE. The Customize dialog lists what this org has, so a Core
// org never sees Finance in it and a CRM org never sees Donor Portal — and a
// reorder done in that dialog must not quietly drop the ones it did not show.
// The visible items take the given sequence, in the slots they already hold;
// anything not in the list stays exactly where it was.
export function reorderWithin(groups, groupId, orderedIds) {
  const ids = (orderedIds || []).slice();
  const moving = new Set(ids);
  return (groups || []).map(g => {
    if (g.id !== groupId) return g;
    const queue = ids.slice();
    // `queue.shift()` is taken ONCE per moving slot. Inlining it into the
    // find() callback shifts on every comparison instead, which leaves the
    // order untouched and looks exactly like a reorder that did not save.
    return { ...g, items: g.items.map(i => {
      if (!moving.has(i.id)) return i;
      const next = queue.shift();
      return g.items.find(x => x.id === next) || i;
    }) };
  });
}

// Hide or show one item. Home and Settings refuse.
export function setNavVisible(groups, id, visible) {
  if (NEVER_HIDDEN.has(id)) return groups;
  return (groups || []).map(g => ({
    ...g,
    items: g.items.map(i => i.id === id ? { ...i, visible: !!visible } : i),
  }));
}
