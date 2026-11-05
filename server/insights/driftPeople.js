// server/insights/driftPeople.js · HOME-6. HOME'S DRIFTING LIST.
//
// The people Drift says are past their own giving rhythm, as Home lists them
// under the moves: one row each, the most money at stake first. It reads
// GET /drift's own list (the one rule, the same rows the deck's drift moves
// come from, routes/insights.js deckWithDrift), less the people she has done,
// set aside or snoozed past today there. Nothing here decides who is drifting.
//
//   stakeCents  Drift's value at risk for the person
//   lastCents   the person's last gift (stored by donorSummary.js, the one
//   lastDate    home of the last gift), with its date
//   short       "Gave Dec 2025, nothing since": the last gift's month, said
//               from the date, so the row reads at a glance; `reason` keeps
//               Drift's whole sentence
"use strict";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortReason(lastDate, asOf) {
  const d = String(lastDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "Past their usual time";
  const mon = MON[Number(d.slice(5, 7)) - 1];
  const year = d.slice(0, 4) === String(asOf || "").slice(0, 4) ? "" : " " + d.slice(0, 4);
  return `Gave ${mon}${year}, nothing since`;
}

// `list` is GET /drift's list, `gone` the drift item keys acted on, `last` a
// Map of donor id -> { amount, date } read from the person record.
function driftPeople(list, { gone = new Set(), last = new Map(), asOf } = {}) {
  return (list || [])
    .filter(r => r && r.donorId && !gone.has(r.donorId))
    .map(r => {
      const l = last.get(r.donorId) || {};
      const lastDate = l.date ? String(l.date).slice(0, 10) : (r.lastGiftDate ? String(r.lastGiftDate).slice(0, 10) : null);
      return {
        id: r.donorId, name: r.donorName || "Someone", reason: r.reason || "Past their own giving rhythm.",
        short: shortReason(lastDate, asOf), early: r.confidence === "medium",
        stakeCents: Math.round((Number(r.valueAtRisk) || 0) * 100),
        lastCents: l.amount != null ? Math.round(Number(l.amount) * 100) : null, lastDate,
      };
    })
    .sort((a, b) => b.stakeCents - a.stakeCents || a.name.localeCompare(b.name));
}

module.exports = { driftPeople, shortReason };
