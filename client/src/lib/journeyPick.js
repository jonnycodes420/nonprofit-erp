// lib/journeyPick.js · SENDS-1 item 4 (W-1107-Fundraising-28). THE "ADD TO A JOURNEY" LIST RULE.
//
// Every journey that is not archived is on the list, in the order the
// Journeys page keeps (priority, then name). A journey is never left out:
// one that can't be started for this person is shown greyed out, with why.
//   - already in it                    → "already in it"
//   - no steps yet                     → "no steps yet"
//   - Draft or Paused                  → FLOWS-3: greyed out ("Paused: turn it back on in Journeys…").
//     Only an Active journey starts people (shared/journeyStartRule.js); the server refuses the rest.
// Archived journeys are the only ones not listed (Journeys, Archived).
// The Donors list's bulk "Add to a journey" follows the same rule per row
// (server/outreach/journeyBatchOptions.js), with the counts for the people checked.
import { canStartState, notActiveWhy } from "../../../shared/journeyStartRule.js";

export function journeyPickRows(list, inNow) {
  const inIds = new Set((inNow || []).map(a => a.journeyId));
  return (Array.isArray(list) ? list : []).map(j => {
    const steps = Array.isArray(j.steps) ? j.steps.length : 0;
    const why = inIds.has(j.id) ? "already in it" : !steps ? "no steps yet"
      : j.state && !canStartState(j.state) ? notActiveWhy(j.state) : null;
    return { id: j.id, name: j.name, disabled: !!why, why, label: `${j.name}${why ? ` (${why})` : ""}` };
  });
}

export default { journeyPickRows };
