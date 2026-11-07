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

// TRUTH-3 (W-1107-Finance-31): the award's state, from ONE place. A grant
// read "Awarded" beside "no award recorded" when the award amount was on the
// grant (grants.amount_awarded) but its award record (the pledge) was not.
//   recorded  an award record (awardPledgeId)
//   stated    an awarded amount on the grant, no award record yet
//   missing   marked Awarded, no amount and no record
//   none      not awarded
export function awardState(grant = {}) {
  const g = grant || {};
  if (g.awardPledgeId) return "recorded";
  if ((Number(g.amountAwarded) || 0) > 0) return "stated";
  if (normalizeStatus(g.status) === "awarded") return "missing";
  return "none";
}

export function grantAwardLine(grant = {}) {
  const g = grant || {};
  const st = awardState(g);
  if (st === "recorded") return null;
  const received = Number(g.received) || 0;
  if (st === "stated") return { key: "awarded_stated", text: `Awarded ${money(g.amountAwarded)}${received > 0 ? `, ${money(received)} received` : ""}. Record the award to track its payments.`, action: "Record the award" };
  if (received > 0) return { key: "received_no_award", text: `Received ${money(received)}, award not recorded.`, action: "Record the award" };
  if (st === "missing") return { key: "awarded_no_award", text: "Marked Awarded, with no award amount yet.", action: "Record the award" };
  return null;
}
