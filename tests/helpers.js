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
    _pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  }
  return _pool;
}
const q = (sql, params) => db().query(sql, params).then(r => r.rows);
async function closeDb() { if (_pool) await _pool.end(); }

module.exports = { BASE, ok, summary, login, api, wireSize, q, closeDb };
