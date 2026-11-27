// server/connections/history.js · HONEST-1 item 5. A SOURCE'S HISTORY AGREES WITH ITS STATUS.
//
// The status (the card, the "Connects directly" tile, "last successful check") reads
// giving_sources.last_synced_at. The history reads one line per run kept in imports. When the
// newest check has no run of its own, the history says the check happened, on the same instant the
// status names, and says plainly that what it read was not kept. It never invents counts.
"use strict";

const SAME_CHECK_MS = 2 * 60 * 1000;   // a run is committed a moment before last_synced_at is stamped

function withLastCheck(lines, source, C) {
  const at = source && source.last_synced_at ? new Date(source.last_synced_at) : null;
  if (!at || isNaN(at)) return lines;
  const newestRunAt = lines.length ? Math.max(...lines.map(l => Date.parse(l.atInstant || l.at) || 0)) : 0;
  if (newestRunAt && at.getTime() - newestRunAt <= SAME_CHECK_MS) return lines;
  const day = at.toISOString().slice(0, 10);
  lines.unshift({ id: "last-check", at: day, atInstant: at.toISOString(), ok: true,
    sentence: "Steward checked, and it worked. What that check read was not kept, so there are no counts for it.",
    skipped: [], skippedRows: [], notices: [] });
  return lines;
}

// HONEST-3 item 3 (W-1126-Integrations-05): "PayPal history keeps no counts". Each daily check now
// keeps what it read (server/connections/checks.js), and the history lists those runs with their
// counts beside the sync's own runs, newest first. The "not kept" line above stays only for a stamp
// no run of either kind explains (a source the seed wrote, a sync from before runs were kept).
async function withHistory(query, lines, source, C) {
  const CK = require("./checks");
  const by = await CK.recentChecks(query, source.org_id, 50);
  for (const chk of by[source.id] || []) {
    lines.push({ id: "check:" + chk.at, at: chk.at.slice(0, 10), atInstant: chk.at, ok: chk.ok, counts: chk.counts,
      sentence: `Daily check: ${chk.sentence}.`, skipped: [], skippedRows: [], notices: [] });
  }
  lines.sort((a, b) => (Date.parse(b.atInstant || b.at) || 0) - (Date.parse(a.atInstant || a.at) || 0));
  return withLastCheck(lines, source, C);
}

module.exports = { withLastCheck, withHistory };
