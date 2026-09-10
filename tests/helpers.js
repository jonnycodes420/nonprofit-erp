// Shared helpers for the scripted verification suites in tests/.
// These run against a LOCAL scratch server + Postgres — never production.
// See tests/README.md for the setup recipe.

const BASE = process.env.BASE || "http://localhost:5601";
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.error("Refusing to run: BASE must be localhost (got " + BASE + ")");
  process.exit(1);
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra)?.slice(0, 400) : "")); }
}
function summary() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

async function login(email, password = "loadtest1234") {
  const r = await fetch(BASE + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.token) throw new Error("login failed for " + email + ": " + JSON.stringify(j));
  return j.token;
}

// Returns { status, body (parsed json or raw text), ms, bytes }
async function api(method, path, token, body) {
  const t0 = performance.now();
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const ms = performance.now() - t0;
  let parsed = text;
  try { parsed = JSON.parse(text); } catch {}
  return { status: r.status, body: parsed, text, ms: Math.round(ms), bytes: Buffer.byteLength(text) };
}

// Wire-size measurement: node fetch transparently gunzips, so this uses raw
// http to see what actually crosses the network (content-encoding + bytes).
const http = require("http");
function wireSize(path, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { "Accept-Encoding": "gzip", ...(token ? { Authorization: "Bearer " + token } : {}) } }, res => {
      let bytes = 0;
      res.on("data", c => { bytes += c.length; });
      res.on("end", () => resolve({ bytes, encoding: res.headers["content-encoding"] || "identity", status: res.statusCode }));
    });
    req.on("error", reject);
    req.end();
  });
}

// Direct DB access for fixture setup — LOCAL scratch Postgres only.
const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (!/localhost|127\.0\.0\.1/.test(DB_URL)) {
  console.error("Refusing to run: DATABASE_URL must be localhost (got " + DB_URL + ")");
  process.exit(1);
}
let _pool = null;
function db() {
  if (!_pool) {
    const { Pool } = require("pg");
    _pool = new Pool({ connectionString: DB_URL, ssl: process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false } });
  }
  return _pool;
}
const q = (sql, params) => db().query(sql, params).then(r => r.rows);
async function closeDb() { if (_pool) await _pool.end(); }

// ── Local mock ports (BUILD-72) ────────────────────────────────────────────
// Every suite that stands up its own Resend mail sink or Stripe mock binds
// THESE, never a bare literal, so a machine running a second product's dev
// stack (which is how this collided) can move them with one env var instead of
// editing twenty files. Defaults are the historical values, so the run-all
// recipe, tests/README.md and ci.yml keep working unchanged.
const SINK_PORT        = Number(process.env.SINK_PORT || 5602);
const STRIPE_MOCK_PORT = Number(process.env.STRIPE_MOCK_PORT || 5603);

// The server's "today" is the ORG's civil date (orgTime.js, default
// America/New_York) — a test that stamps a gift with UTC-today submits a
// FUTURE date every evening after 8pm Eastern and the import refuses it.
// Tests that date something "today" must use the same civil clock.
const civilToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

// ── BUILD-84 census — A GUARD OVER A PAYLOAD WALKS IT ─────────────────────
// `JSON.stringify(payload).includes(x)` throws away every boundary the
// structure provides and then asks a question about letters. That is how a
// leak guard searching for the figure "600" matched inside the server-minted
// id `imp_6e5600ab` and red-lit CI on a docs-only push (FIX-3, 10 Sep). These
// walk the LEAVES, with type awareness, so a number is compared as a number
// and an id is compared as an id.
//
// The rule and the implementation live ONCE, in shared/textMatch.js; this is
// the CommonJS door onto it (the suites are CJS, that module is ESM). Loaded
// lazily and memoised — every suite here is already async.
let _textMatch = null;
async function textMatch() { return _textMatch || (_textMatch = await import("../shared/textMatch.js")); }

// leaks(payload, needles) → the offending [path, value] pairs, or []. Each
// needle is {text} (a phrase, matched inside a STRING leaf with token
// boundaries), {exact} (a leaf that IS this string), {number} (a leaf that IS
// this number, as a number or a numeric string), or {raw} (a literal substring
// inside a string leaf — for markers like ";base64," and "youtube.com/watch"
// that are not words and have no tokens to respect). `skipIds` keeps the two
// kinds of value that legitimately carry random digits out of the way.
async function leaks(payload, needles, { skipIds = true } = {}) {
  const { findLeaf, containsTokenRun } = await textMatch();
  const found = [];
  const isIdish = (v, path) => /(^|\.)id$|Id$|_id$/.test(String(path || "")) || /^[a-z]{2,6}_[0-9a-f]{6,}$/.test(String(v));
  for (const n of needles) {
    const hit = findLeaf(payload, (v, path) => {
      if (typeof v === "number") return n.number !== undefined && v === n.number;
      if (typeof v !== "string") return false;
      if (n.number !== undefined) return /^-?\d+(\.\d+)?$/.test(v.trim()) && Number(v) === n.number;
      if (skipIds && (isIdish(v, path) || v.startsWith("data:"))) return false;
      if (n.exact !== undefined) return v === n.exact;
      if (n.raw !== undefined) return v.includes(n.raw);
      return containsTokenRun(v, n.text);
    });
    if (hit) found.push([hit.path, String(hit.value).slice(0, 80), JSON.stringify(n)]);
  }
  return found;
}

module.exports = { BASE, ok, summary, login, api, wireSize, q, closeDb, SINK_PORT, STRIPE_MOCK_PORT, civilToday, textMatch, leaks };
