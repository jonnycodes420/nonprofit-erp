// server/imports/beforeChecks.js · POLISH-9 (W-1109-Atlas-13X). AN IMPORT FROM
// BEFORE STEWARD CHECKED IMPORTS IS NOT A STANDING FAILURE.
//
// MONEY-4 (9 Nov 2026) made every import foot in rows and dollars. An import
// committed before that, whose counts were never recorded the way the footing
// reads them, read "40 in the file … = 0, does not reconcile" with nothing
// staff could do. It now reads "Before Steward checked imports (Sep 30)" and
// has Archive. An import from after the checks that does not foot is still a
// finding, as before.
"use strict";

const CHECKS_FROM = "2026-11-09T00:00:00.000Z";   // MONEY-4's footing
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function beforeChecks(row, balanced) {
  if (balanced || !row || !row.committed_at || row.reversed_at) return null;
  if (new Date(row.committed_at).toISOString() >= CHECKS_FROM) return null;
  const d = String(row.committed_on || new Date(row.committed_at).toISOString()).slice(0, 10);
  return `Before Steward checked imports (${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))})`;
}

module.exports = { beforeChecks, CHECKS_FROM };
