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

export function grantAwardLine(grant = {}) {
  const g = grant || {};
  const st = awardState(g);
  if (st === "recorded") return null;
  const received = Number(g.received) || 0;
  if (st === "stated") return { key: "awarded_stated", text: `Awarded ${money(g.amountAwarded)}${received > 0 ? ` · ${money(received)} received` : ""} · payments not set up ·`, action: "Set up payments" };
  if (received > 0) return { key: "received_no_award", text: `Received ${money(received)}, award not recorded.`, action: "Record the award" };
  if (st === "missing") return { key: "awarded_no_award", text: "Marked Awarded, with no award amount yet.", action: "Record the award" };
  return null;
}

// PLEDGES-3 · THE GRANT'S FOUR TILES, ONE RULE. Received and % Funded are the
// payments on the award; with no award row there is no schedule to be paid
// against, so they say "No payments set up" rather than $0 and 0%. Once the grant is
// awarded its application deadline has closed and stops counting down; the
// fourth tile counts to the report due date instead (report deadlines remain).
//   grant: { amount, amountAwarded, received, status, deadline, reportDue, awardPledgeId }
//   word(date, opts) is grantDeadline.js's deadlineWord bound to the org's day.
export function grantMoneyTiles(grant = {}, word, { pursuing = true } = {}) {
  const g = grant || {};
  const st = awardState(g);
  const notSetUp = st === "stated" || st === "missing";
  const target = Number(g.amountAwarded) > 0 ? Number(g.amountAwarded) : Number(g.amount) || 0;
  const received = Number(g.received) || 0;
  const pct = target > 0 ? Math.round(received / target * 100) : 0;
  const tiles = [
    st === "none" ? { key: "requested", label: "Amount Requested", value: money(g.amount) }
      : { key: "awarded", label: "Awarded", value: Number(g.amountAwarded) > 0 ? money(g.amountAwarded) : "Not set" },
    { key: "received", label: "Received", value: notSetUp ? "No payments set up" : money(received) },
    { key: "funded", label: "% Funded", value: notSetUp ? "No payments set up" : pct + "%", pct: notSetUp ? null : pct },
  ].filter(Boolean);
  if (pursuing) tiles.push({ key: "deadline", label: "Days to Deadline", ...word(g.deadline, { pursuing: true }) });
  else if (g.reportDue) tiles.push({ key: "report", label: "Days to Report Due", ...word(g.reportDue, { pursuing: true }) });
  else tiles.push({ key: "deadline", label: "Application", word: "Closed", days: null, band: "closed" });
  return tiles;
}
