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
// PLEDGES-3 (W-1107-Finance-31): awarded by status with its amount on the grant
// (no award row) says "Awarded $120,000 · payments not set up" + Set up
// payments. It is awarded; what is missing is the payment schedule, so it
// never says "Record the award", and the grant's Received and % Funded say
// "No payments set up" (grantMoneyTiles below) instead of $0 and 0%.
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

// MONEY-4 (W-1107-Finance-31, W-1109-Finance-33) · ONE STATE MACHINE, ONE
// STORY. An awarded grant's three money facts (Awarded, Received, Remaining)
// say the same thing on the line and in the tiles, and never "No payments set
// up":
//   stated   the amount is known (Wexford's $120,000): it IS the award.
//            Received is what has come in (the payments, or before the award
//            row exists the typed figure, which becomes its first payment):
//            "Awarded $120,000 · $0 received of $120,000".
//   missing  marked Awarded with no amount (NEA): money that came in is shown
//            as received, the amount is what is missing, and the action records
//            it (prefilled from the ask), turning that money into the award's
//            first payment: "Awarded · $35,000 received · award amount not
//            recorded" + Record the award.
//   recorded nothing here (the award panel says the rest).
export function grantAwardLine(grant = {}) {
  const g = grant || {};
  const st = awardState(g);
  if (st === "recorded" || st === "none") return null;
  const received = Number(g.received) || 0;
  if (st === "stated") return { key: "awarded_stated", text: `Awarded ${money(g.amountAwarded)} · ${money(received)} received of ${money(g.amountAwarded)}`, action: null };
  return { key: "awarded_no_amount", text: received > 0 ? `Awarded · ${money(received)} received · award amount not recorded ·` : "Awarded · award amount not recorded ·", action: "Record the award" };
}

// THE GRANT'S FOUR TILES, ONE RULE (PLEDGES-3, MONEY-4). Received and %
// Funded read the payments; an award amount not yet recorded says "Not
// recorded" on Awarded alone. Once the grant is awarded its application
// deadline is closed and the fourth tile counts to the report due date.
//   grant: { amount, amountAwarded, received, status, deadline, reportDue, awardPledgeId }
//   word(date, opts) is grantDeadline.js's deadlineWord bound to the org's day.
export function grantMoneyTiles(grant = {}, word, { pursuing = true } = {}) {
  const g = grant || {};
  const st = awardState(g);
  const awarded = Number(g.amountAwarded) || 0;
  const received = Number(g.received) || 0;
  const pct = awarded > 0 ? Math.round(received / awarded * 100) : null;
  const tiles = [
    st === "none" ? { key: "requested", label: "Amount Requested", value: money(g.amount) }
      : { key: "awarded", label: "Awarded", value: awarded > 0 ? money(awarded) : "Not recorded" },
    { key: "received", label: "Received", value: money(received) },
    st === "none" ? { key: "funded", label: "% Funded", value: (Number(g.amount) > 0 ? Math.round(received / Number(g.amount) * 100) : 0) + "%", pct: 0 }
      : pct == null ? { key: "remaining", label: "Remaining", value: "Not recorded", pct: null }
      : { key: "remaining", label: "Remaining", value: money(Math.max(0, awarded - received)), pct },
  ];
  if (pursuing) tiles.push({ key: "deadline", label: "Days to Deadline", ...word(g.deadline, { pursuing: true }) });
  else if (g.reportDue) tiles.push({ key: "report", label: "Days to Report Due", ...word(g.reportDue, { pursuing: true }) });
  else tiles.push({ key: "deadline", label: "Application", word: "Closed", days: null, band: "closed" });
  return tiles;
}
