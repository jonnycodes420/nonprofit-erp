// SPLIT-2: moved VERBATIM from db.js (the schema version). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
// The hash now covers db.js and every file under server/db/, so an edit to
// any DDL part still runs the init once, as an edit to db.js did.
const SCHEMA_SOURCES = require("./schemaSources");

// SPLIT-2 db.js piece 34

// BUILD-54 §1 — schema-init fast path. initSchema is ~280 sequential DDL
// statements; against a remote Postgres that's a 40–70s "Database initializing"
// 503 window on EVERY deploy. The schema is fully determined by this file's
// contents, so a hash of db.js is a faithful schema version: unchanged file →
// the DDL is a guaranteed no-op → skip it. Any edit to db.js (i.e. any
// migration) changes the hash and the full init runs exactly once, then the
// new hash is stored. SCHEMA_INIT_FORCE=1 overrides the skip (break-glass,
// e.g. after manual DDL surgery in Supabase).
const SCHEMA_HASH = require("crypto")
  .createHash("sha256")
  .update(SCHEMA_SOURCES())
  .digest("hex");
// SPLIT-2 end

module.exports = { SCHEMA_HASH };
