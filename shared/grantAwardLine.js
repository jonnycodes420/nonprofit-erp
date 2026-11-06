// shared/grantAwardLine.js · WALKB-2 item 4. A GRANT NEVER CONTRADICTS ITSELF.
//
// Muse's Walk B: a grant read "Awarded, but no award recorded" right beside
// "Received $35,000, 100% funded". The cause: the grant had no award pledge,
// so its Received was still the legacy typed `grants.received` column (from
// before GIFTS-1 made Received the payments on the award; the Edit form no
// longer writes it, and scripts/ops/gifts1-grant-received.js turns it into a
// payment once there is an award). The status line ignored that number.
//
// One rule for the line beside the funder: when there is no award record,
// say what is true and what to do.
//   money in, no award:  "Received $35,000, award not recorded." + Record the award
//   awarded, no money:   "Awarded, but no award recorded." + Record the award
//   an award on file:    nothing (the award panel says the rest)
import { normalizeStatus } from "./grantShape.js";

const money = n => "$" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

export function grantAwardLine(grant = {}) {
  const g = grant || {};
  if (g.awardPledgeId) return null;
  const received = Number(g.received) || 0;
  if (received > 0) return { key: "received_no_award", text: `Received ${money(received)}, award not recorded.`, action: "Record the award" };
  if (normalizeStatus(g.status) === "awarded") return { key: "awarded_no_award", text: "Awarded, but no award recorded.", action: "Record the award" };
  return null;
}
