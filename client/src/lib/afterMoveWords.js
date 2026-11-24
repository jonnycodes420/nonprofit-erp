// client/src/lib/afterMoveWords.js · THANKS-1 item 4. THE PROFILE'S NEXT MOVE WHEN NO CARD HAS ONE.
// The server says the newest gift and whether it waits for a thank-you
// (server/insights/afterMove.js); this turns that into the line and its why.
import { displayDate } from "../../../shared/displayDate.js";

const money = c => { const v = Math.abs(Number(c) || 0) / 100; return "$" + v.toLocaleString("en-US", v % 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {}); };

export function afterMoveWords(after, firstName) {
  if (!after) return null;
  const who = firstName || "them", on = `${money(after.cents)} on ${displayDate(after.date)}`;
  const second = after.nth === 2;
  if (after.awaiting) return {
    thank: true,
    line: `Next: thank ${who} for the ${money(after.cents)} gift on ${displayDate(after.date)}.`,
    why: second
      ? "It is their second gift, so the first-gift move is finished, and it isn't thanked yet. A thank-you comes before any new ask."
      : "It isn't thanked yet. A thank-you comes before any new ask.",
  };
  return {
    thank: false,
    line: firstName ? `Nothing due for ${firstName} right now.` : "Nothing due right now.",
    why: `${second ? `Their second gift (${on}) finished the first-gift move, and it is thanked.` : `Their last gift (${on}) is thanked.`} Steward suggests the next step when their usual time to give passes or their giving grows.`,
  };
}
