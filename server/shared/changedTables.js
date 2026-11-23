// LIVE-2 · EVERY WRITE SAYS WHAT IT CHANGED.
//
// After a write the browser chose what to re-read from a table of URL rules
// (client/src/lib/changes.js). A route the rules didn't name, or whose effects
// reached further than its path (a household made from a profile, a gift that
// moves Team totals, a delete that changes Trash), refreshed the wrong screens
// or none. The server knows exactly which tables the request wrote.
//
// Every connection a request uses is checked out for its scope
// (requestLimits.checkout), so each statement it sends passes watch() below,
// which notes the tables a write statement names on the scope. The database's
// own triggers write further (a thread's next step is a task row, a grant's
// milestone is a task, a task done writes the person's line): those are read
// once from pg_trigger/pg_proc at boot and added. When the response's headers
// go out, X-Steward-Changed carries the topics of those tables
// (shared/changeTopics.cjs), or "none".
//
// What is written after the response (the after-change step, the queue) is
// not in it: the bell's worker marks announce those (lib/changes.js).
"use strict";
const { changedHeader } = require("../../shared/changeTopics.cjs");

const HEADER = "X-Steward-Changed";
const MAY_WRITE = /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i;
const TARGET = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:"?public"?\s*\.\s*)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
// Words that follow UPDATE without naming a table: ON CONFLICT DO UPDATE SET,
// SELECT … FOR UPDATE [OF|SKIP LOCKED|NOWAIT], a trigger's INSERT OR UPDATE ON.
const NOT_A_TABLE = new Set(["set", "of", "skip", "nowait", "on", "or"]);

// The tables one statement writes, by name.
function tablesWritten(text) {
  const s = typeof text === "string" ? text : text && typeof text.text === "string" ? text.text : "";
  if (!s || !MAY_WRITE.test(s)) return [];
  const out = new Set();
  for (const m of s.matchAll(TARGET)) { const t = m[1].toLowerCase(); if (!NOT_A_TABLE.has(t)) out.add(t); }
  return [...out];
}

// table → tables its triggers write, closed (grants → grant_milestones → tasks → interactions).
let triggerWrites = new Map();
async function loadTriggers(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT c.relname AS tbl, p.prosrc AS src FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname = 'public'`);
    const direct = new Map();
    for (const r of rows) {
      const set = direct.get(r.tbl) || new Set();
      for (const w of tablesWritten(r.src)) if (w !== r.tbl) set.add(w);
      direct.set(r.tbl, set);
    }
    const closed = new Map();
    for (const t of direct.keys()) {
      const seen = new Set(), todo = [t];
      while (todo.length) for (const w of direct.get(todo.pop()) || []) if (!seen.has(w) && w !== t) { seen.add(w); todo.push(w); }
      if (seen.size) closed.set(t, seen);
    }
    triggerWrites = closed;
  } catch (e) { console.warn("[live-2] trigger map not read:", e.message); }
}

function note(sc, text) {
  if (!sc || sc.read) return;
  const ts = tablesWritten(text);
  if (!ts.length) return;
  const w = sc.wrote || (sc.wrote = new Set());
  for (const t of ts) { w.add(t); for (const x of triggerWrites.get(t) || []) w.add(x); }
}

// Once per pooled client: each statement it sends is noted on the scope that
// holds it at that moment (requestLimits sets client.__stewardScope).
function watch(client) {
  if (!client || client.__stewardWatched) return client;
  const send = client.query;
  client.query = function watched(text, ...rest) {
    try { note(client.__stewardScope, text); } catch { /* noting never stops a statement */ }
    return send.call(this, text, ...rest);
  };
  client.__stewardWatched = true;
  return client;
}

// The header, set as the response's headers go out. `scopeOf()` is the
// request's scope (requestLimits.live, read when the middleware runs).
function middleware(scopeOf) {
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || req.__stewardInProcess) return next();
    const sc = scopeOf();
    if (sc) {
      const writeHead = res.writeHead;
      res.writeHead = function (...a) {
        try { if (!res.headersSent && !res.getHeader(HEADER)) res.setHeader(HEADER, changedHeader(sc.wrote)); } catch { /* never stops an answer */ }
        return writeHead.apply(this, a);
      };
    }
    next();
  };
}

module.exports = { HEADER, tablesWritten, loadTriggers, watch, middleware, note, _triggerWrites: () => triggerWrites };
