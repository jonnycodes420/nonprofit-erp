// client/src/lib/emptyAudience.js · FLOWS-3 (W-1108-Volunteers-34X). A SEND OR
// EMAIL ACTION ON NOBODY IS NOT OFFERED.
// A group with 0 people still offered "Email this group", which opened a
// Communication addressed to nobody. Every send or email action whose
// audience is empty is disabled, with this sentence beside it. The count is
// the one the screen already shows (a group's People figure, an audience's
// recipient count); this file never counts.
export const EMPTY_AUDIENCE = "Nobody in this group yet";

// The count the screen shows, or null when it does not know yet.
export function audienceEmpty(n) {
  return n !== null && n !== undefined && n !== "" && Number(n) === 0;
}

export function figureCount(figures, label = "People") {
  const f = (figures || []).find(x => x && x.label === label);
  return f ? f.value : null;
}
