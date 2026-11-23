// tests/lib/changedHeaderGuard.js · LIVE-2 item 4. EVERY WRITE SAYS WHAT IT CHANGED.
//
// The browser re-reads what a write's X-Steward-Changed header names
// (server/shared/changedTables.js, client/src/lib/changes.js). A write that
// answers 2xx without it falls back to the old URL rules, and a screen goes
// stale again. The tenant matrix sends every write route in the live router's
// inventory (its §2–§8 probes, org A's admin and anonymous); each answer passes
// record() here, and check() fails on any 2xx write without the header.
//
// It also fails on a table with org_id that shared/changeTopics.cjs neither
// maps to a topic nor names SILENT, so a new table is placed on purpose.
//
// Proven able to fail: with the middleware's mount removed from
// server/boot/steps-1.js every 2xx write is listed here; with a table taken out
// of the map, that table is listed.
"use strict";
const { topicsOfTable } = require("../../shared/changeTopics.cjs");

// Pure-session and telemetry writes: they change no record a screen shows.
const SESSION_ONLY = /^\/(auth\/(login|logout|refresh|csrf|session|mfa)[^?]*|perf\/|csp-report|client-errors?|vitals)/;

const seen = [];
function record(method, path, status, header) {
  const m = String(method || "").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return;
  seen.push({ m, path: String(path).split("?")[0], status, header });
}

async function check({ ok, q }) {
  const writes = seen.filter(s => s.status >= 200 && s.status < 300);
  const missing = writes.filter(s => s.header == null && !SESSION_ONLY.test(s.path)).map(s => `${s.m} ${s.path} ${s.status}`);
  ok(`LIVE-2: every 2xx write the matrix sent carries X-Steward-Changed (${writes.length} writes, ${new Set(writes.map(s => s.m + " " + s.path)).size} paths)`,
     writes.length > 0 && missing.length === 0, [...new Set(missing)].slice(0, 15));
  const tables = (await q(`SELECT DISTINCT table_name AS t FROM information_schema.columns
                            WHERE table_schema = 'public' AND column_name = 'org_id' ORDER BY 1`)).map(r => r.t);
  const unplaced = tables.filter(t => topicsOfTable(t).includes("other"));
  ok(`LIVE-2: every table with org_id (${tables.length}) has a topic or is SILENT in shared/changeTopics.cjs`, unplaced.length === 0, unplaced);
}

module.exports = { record, check, SESSION_ONLY, _seen: seen };
