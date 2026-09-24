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
// BUILD-83 Part 3.1 — HOME IS THE THREAD FIRST, THE SUSTAINERS SECOND, DRIFT
// THIRD, AND THE NUMBERS LAST. That was BUILD-81's order and it is not what
// rendered: a fresh org opened on an auto-set goal, a six-step checklist, four
// zero tiles and a $38.7M at-risk card, with the Thread on the second screen.
// Retired here (the merge rule drops unknown ids, so saved layouts follow):
//   goalCards      — the roll-up breakdown; the hero line carries it
//   commandCenter  — Portfolio / Tasks / Need to do / Pipeline, four tiles whose
//                    contents are in the cards below or in the checklist, and
//                    which contradicted them (0 prospects beside 634)
//   work           — split into `thread` and `retentionPipeline`
//   retention      — folded into `retentionPipeline`, demoted
// ── BUILD-86 — TWO SURFACES ────────────────────────────────────────────────
// Home is hers at 7:40 in the morning. Dashboard is the board meeting.
//
// THE TEST FOR WHICH SURFACE A SECTION BELONGS ON: can she DO something about
// it before her first coffee, and does it name a person? If yes it is `home`.
// A number over a period, however true and however good, is `board` — one
// click away, and better for being somewhere a person goes deliberately.
//
// `surface` is a property on this registry, which is the whole reason this
// build is a move rather than a rebuild: the sections already existed, the
// ordering machinery already existed (BUILD-34), and nothing below is a new
// component.
export const SURFACES = { HOME: "home", BOARD: "board" };

export const HOME_SECTIONS = [
  // ── hers, at 7:40 ────────────────────────────────────────────────────────
  { id: "setup",   label: "Set up Steward", hideable: true,  surface: "home" },
  { id: "thread",  label: "The Thread",     hideable: false, surface: "home" },
  { id: "drift",   label: "Drift",          hideable: true,  surface: "home" },
  // BUILD-86 — the failing monthly gifts, WITH the donors' names on them.
  // Split out of `retentionPipeline`, where they were a count inside a card of
  // board metrics; a failing gift is the most actionable thing on this screen
  // and it belongs beside the other two lists of people.
  { id: "recurring", label: "Monthly gifts that need you", hideable: true, surface: "home" },
  // BUILD-88b B.3 — the thank-yous Steward has drafted and she has not sent.
  // It passes the surface test twice over: she can do something about it before
  // her first coffee, and every row names a person. It sits BELOW the Thread
  // because a thank-you is what you owe somebody who already gave, and above
  // Drift because it is the one list with a deadline made of goodwill.
  { id: "thankYous", label: "Thank-yous ready", hideable: true, surface: "home" },
  // BUILD-94 Part 3 — ONE LINE PER SEQUENCE. A sequence runs without her, so
  // the only thing Home owes her is proof it is running and an immediate say
  // if it is not: "Welcome: 4 people in it, next send Thursday", and a failure
  // at the end of the same sentence (BUILD-37 H2 — never swallowed).
  { id: "sequences", label: "Sequences", hideable: true, surface: "home" },
  // BUILD-97 Part 3 — the sixth Home section: the daily line, and the box she
  // types an instruction into. NOT hideable: "Steward did 14 things for you
  // yesterday" is the one place the agent accounts for itself on the screen she
  // actually opens, and a surface that can act on her behalf must not be
  // possible to hide from her.
  { id: "agent", label: "Tell Steward what to do", hideable: false, surface: "home" },

  // ── the board's ──────────────────────────────────────────────────────────
  { id: "hero",             label: "Fundraising goal",      hideable: false, surface: "board" },
  { id: "retentionPipeline", label: "Retention & pipeline", hideable: true,  surface: "board" },
  { id: "monthly",          label: "Your monthly donors",   hideable: true,  surface: "board" },
  { id: "myPortfolio",      label: "My Portfolio",          hideable: true,  surface: "board" },
  { id: "impact",           label: "What Steward has done", hideable: true,  surface: "board" },
];

// The hero is not hideable on the BOARD (it is that screen's headline) and the
// Thread is not hideable on HOME (a Home with no queue is a blank screen, the
// same reasoning that made the hero unhideable in BUILD-34).
export const sectionsFor = surface => HOME_SECTIONS.filter(s => s.surface === surface);
export const surfaceOf = id => sectionMeta(id)?.surface || SURFACES.HOME;

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

// "Move to top" (one click/keypress from edit mode) — respects the
// unhideable-hero rail: when the hero is the first VISIBLE section, "top" for
// any other section means directly under the hero; if the user moved the hero
// down, top is genuinely first. Moving the hero itself always lands it first.
// Returns the SAME array reference when the move is a no-op (already at top /
// unknown id) — the UI uses that to decide whether to offer the button.
// BUILD-86 — "top" NOW MEANS TOP OF ITS OWN SURFACE. One layout array holds
// both surfaces, so a bare move-to-index-0 sent a board section above the Home
// sections and, filtered back to the board, above the hero — breaking the
// unhideable-hero rail on the only screen the hero is on. The move is scoped:
// a section lands at the top of the surface it belongs to, still respecting
// that rail. Returns the SAME array reference on a no-op, which is how the UI
// decides whether to offer the button at all.
export function moveToTop(layout, id) {
  if (!Array.isArray(layout)) return layout;
  const from = layout.findIndex(r => r && r.id === id);
  if (from < 0) return layout;
  const surface = surfaceOf(id);
  const sameSurface = i => surfaceOf(layout[i]?.id) === surface;

  // The first slot belonging to this surface.
  let to = layout.findIndex((_, i) => sameSurface(i));
  if (to < 0) return layout;

  // The hero rail, applied within the board: while the hero is the first
  // VISIBLE section of its surface, "top" for anything else means under it.
  const firstVisibleHere = layout.find((r, i) => sameSurface(i) && r && r.visible !== false);
  if (id !== HERO_ID && firstVisibleHere && firstVisibleHere.id === HERO_ID) {
    to = layout.findIndex(r => r.id === HERO_ID) + 1;
  }
  if (from === to) return layout;
  const next = [...layout];
  const [row] = next.splice(from, 1);
  next.splice(from < to ? to - 1 : to, 0, row);
  return next;
}

export const isDefaultLayout = layout =>
  layout.length === DEFAULT_LAYOUT.length &&
  layout.every((row, i) => row.id === DEFAULT_LAYOUT[i].id && row.visible === true);
