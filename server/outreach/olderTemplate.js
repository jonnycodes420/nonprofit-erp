// server/outreach/olderTemplate.js · POLISH-9 (W-1108-Atlas-11X). A DRAFT MADE
// FROM AN OLDER VERSION OF ITS TEMPLATE SAYS SO.
//
// The draft "New donor, first year" read "7 touches over 7 months" while the
// template read "7 touches over 12 months". Both sentences are computed from
// steps at render time (journeyShape.touchesSentence); the draft's own steps
// are a copy taken before FIX-4 retimed the template, and POST /journeys kept
// handing that copy back. A journey nobody has ever turned on and whose steps
// differ from its template is "made from an older version":
//   · the list and the builder say so, with the template's own sentence
//   · choosing the template again gives the template's current steps
//   · scripts/ops/journey-older-template.js lists (and, with --apply, updates)
//     the drafts already carrying the old copy
// A journey that has ever been on is hers; it is never touched.
"use strict";

const shape = steps => JSON.stringify((Array.isArray(steps) ? steps : []).map(s => [s.type, Number(s.offsetDays) || 0]));

// The preset this row came from, when the row is an untouched older copy of it.
function olderTemplateOf(row, presets) {
  if (!row || !row.preset_key || row.journey_enabled || row.ever_enabled) return null;
  const p = (presets || []).find(x => x.key === row.preset_key);
  if (!p || shape(p.steps) === shape(row.steps)) return null;
  return p;
}

// What the list and the builder show for it: null, or { name, touches, steps }.
function olderTemplateNote(row, presets, touchesSentence) {
  const p = olderTemplateOf(row, presets);
  return p ? { name: p.name, touches: touchesSentence(p.steps), steps: p.steps } : null;
}

module.exports = { olderTemplateOf, olderTemplateNote };
