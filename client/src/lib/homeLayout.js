// Per-user Home layout (BUILD-34) — the ONE source of truth for which sections
// Home has, their default order, and how a saved [{id,visible}] preference
// merges with that canonical list. JSX-free so the Node suite can dynamic-
// import it directly (tests/home-layout.test.js), same convention as money.js
// and importShape.js.
//
// Sections are the unit — vertical order + visibility only, deliberately NOT a
// free-form widget grid. The hero can move but never hide (Home must never be
// empty). Future Home sections get appended HERE; the merge below guarantees a
// new id appears for every user, even one with an older saved config.

export const HERO_ID = "hero";

// Canonical Home stack, top to bottom = the default order (today's design).
// `label` is what edit mode + the hidden tray call the section.
export const HOME_SECTIONS = [
  { id: "hero", label: "Fundraising goal", hideable: false },
  { id: "goalCards", label: "Goal breakdown", hideable: true },
  { id: "commandCenter", label: "Today at a glance", hideable: true },
  { id: "myPortfolio", label: "My Portfolio", hideable: true },
  { id: "retention", label: "Donor retention & signals", hideable: true },
  { id: "work", label: "Needs attention & outreach", hideable: true },
  { id: "impact", label: "What Steward has done", hideable: true },
];

export const DEFAULT_LAYOUT = HOME_SECTIONS.map(s => ({ id: s.id, visible: true }));

export const sectionMeta = id => HOME_SECTIONS.find(s => s.id === id) || null;

// Merge a saved preference with the canonical list:
//   - keep the user's order for ids that still exist (unknown/retired ids drop)
//   - dedupe (first occurrence wins)
//   - APPEND any canonical id the saved config doesn't know, in canonical
//     order, visible — a new section ships for everyone, never silently hidden
//     by a stale saved config
//   - the hero is forced visible (movable, never hideable)
// Accepts null/garbage and always returns a full, valid layout.
export function mergeLayout(saved) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(saved)) {
    for (const row of saved) {
      const id = row && typeof row.id === "string" ? row.id : null;
      if (!id || seen.has(id)) continue;
      const meta = sectionMeta(id);
      if (!meta) continue; // retired/unknown section
      seen.add(id);
      out.push({ id, visible: meta.hideable === false ? true : row.visible !== false });
    }
  }
  for (const s of HOME_SECTIONS) {
    if (!seen.has(s.id)) out.push({ id: s.id, visible: true });
  }
  return out;
}

export const isDefaultLayout = layout =>
  layout.length === DEFAULT_LAYOUT.length &&
  layout.every((row, i) => row.id === DEFAULT_LAYOUT[i].id && row.visible === true);
