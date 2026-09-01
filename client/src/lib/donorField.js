// donorField.js — the deterministic donor dot field. BUILD-73 Part 4.
//
// JSX-free on purpose (the money.js / importShape.js pattern) so the Node
// suite can import it directly and assert the properties the page's honesty
// depends on.
//
// ── WHY THIS IS A MODULE CONSTANT AND NOT A SHUFFLE ─────────────────────────
// The reference mock contains 199 literal <div>s because it was built by hand.
// The page GENERATES them — but which donors drift must be FIXED, not random
// per render. Three reasons, and each of them is a real failure:
//
//   1. A field that reshuffles on every render looks broken. The reader's eye
//      returns to the hero after scrolling and the pattern has changed.
//   2. Server and client must produce byte-identical markup or React hydration
//      warns and repaints.
//   3. The year section's whole claim is that June's drifted donors are a
//      SUBSET of December's — the same people, further along. A random draw
//      per field makes that false, and the section would be lying about the
//      one thing it exists to show.
//
// So the drift set is a hard-coded index list, taken from the reference mock.
//
// ── THE ORDERING IS LOAD-BEARING ────────────────────────────────────────────
// DRIFT_ORDER is not sorted. It is ordered so that taking the FIRST N gives a
// visually scattered set at every N, and so that each month's set nests inside
// the next:
//
//     January  = first 0  = {}                      (everyone current)
//     June     = first 31 ⊂ December                (the window)
//     December = first 74 = the whole set           (the year's damage)
//     hero     = first 74 = December                (the same file, today)
//
// The first 31 are the mock's own June indices, so the rendered page matches
// the reference exactly AND the nesting is true by construction rather than by
// coincidence. Sorting this array would cluster June's gold in the top-left
// corner of the field and break the picture while keeping the arithmetic.
//
// Pinned by tests/donor-field.test.js.

export const FIELD_SIZE = 199;

// The 74 drifting donors, in the order they drift. See above — do not sort.
export const DRIFT_ORDER = [
  3, 10, 23, 24, 36, 40, 47, 48, 77, 101, 114, 115,
  119, 121, 130, 131, 137, 143, 150, 152, 157, 159, 161, 162,
  166, 167, 177, 187, 191, 195, 198, 0, 1, 4, 7, 9,
  15, 16, 17, 21, 27, 50, 53, 54, 58, 59, 61, 65,
  71, 73, 74, 75, 80, 83, 98, 102, 104, 112, 116, 117,
  118, 127, 132, 135, 136, 141, 149, 151, 153, 160, 169, 180,
  190, 192,
];

// The four renders on the page. One component, four counts.
export const DRIFT_COUNTS = { hero: 74, january: 0, june: 31, december: 74 };

// Steady donors in the hero legend: 199 − 74.
export const STEADY_COUNT = FIELD_SIZE - DRIFT_COUNTS.hero;

// Which indices are drifting at a given count. Returns a Set for O(1) lookup
// while rendering 199 dots.
export function driftSet(count) {
  const n = Math.max(0, Math.min(DRIFT_ORDER.length, Math.trunc(Number(count) || 0)));
  return new Set(DRIFT_ORDER.slice(0, n));
}

// The rendered field as data: one entry per donor, in reading order.
// `drifting` decides the colour; `delay` staggers the entrance wave so the
// field draws itself left-to-right instead of appearing all at once.
//
// Both are pure functions of the index, so two renders of the same count are
// byte-identical — which is the whole point.
export function fieldDots(count, { stagger = 6 } = {}) {
  const set = driftSet(count);
  const out = new Array(FIELD_SIZE);
  for (let i = 0; i < FIELD_SIZE; i++) {
    out[i] = { i, drifting: set.has(i), delay: i * stagger };
  }
  return out;
}

// The breathing offset for a drifting dot. Six buckets so the field shimmers
// rather than pulsing in unison — again derived from the index, never random.
export function breatheDelay(i) {
  return 1500 + (i % 6) * 180;
}
