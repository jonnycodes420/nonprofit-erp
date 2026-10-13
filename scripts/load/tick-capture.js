// SCALE-1 · time every background job without touching one.
//
// Preloaded into a load-run server (`node -r ./scripts/load/tick-capture.js
// server.js`). It records each setInterval the server registers (every one of
// them is a background job) and holds it instead of scheduling it, and drops
// the boot-delayed first runs, so nothing fires on its own. Then
//
//   POST http://localhost:6709/run?max=300000
//
// runs every held job whose period is at most `max` ms, one after another,
// and answers with each one's wall time. A job whose callback returns its
// promise is timed exactly; one that fires and forgets is timed until the
// database has been quiet for a second. Loopback only, load runs only.
const http = require("http");
const realInterval = global.setInterval;
const realTimeout = global.setTimeout;
const held = [];

function label(fn) {
  const src = String(fn).replace(/\s+/g, " ");
  const named = src.match(/recordTick\("([^"]+)"/) || src.match(/\b(process\w+|sync\w+|run\w+|refresh\w+|purge\w+|check\w+|snapshot\w+|recompute\w+|reconcile\w+|deliver\w+|retry\w+|statusCheck\w*|autoEnroll)\(/);
  return named ? named[1] : src.slice(0, 60);
}
const fromBoot = () => /routes[\\/]jobs\.js|server\.js:\d+|routes[\\/](crm|dataHealth)\.js/.test(new Error().stack || "");

global.setInterval = function (fn, ms, ...rest) {
  // express-rate-limit's own expiry sweep is not a job: holding it would
  // leave every limiter's window open forever.
  if (typeof fn === "function" && fromBoot() && !/clearExpired/.test(String(fn))) { held.push({ fn, ms, name: label(fn) }); return { unref() {}, ref() {}, hasRef: () => false }; }
  return realInterval(fn, ms, ...rest);
};
global.setTimeout = function (fn, ms, ...rest) {
  if (typeof fn === "function" && ms >= 3000 && /routes[\\/]jobs\.js/.test(new Error().stack || "")) return { unref() {}, ref() {}, hasRef: () => false };
  return realTimeout(fn, ms, ...rest);
};

async function dbQuiet() {
  const { Pool } = require("pg");
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 1 });
  try {
    let quietSince = Date.now();
    const start = Date.now();
    while (Date.now() - start < 20 * 60 * 1000) {
      const r = await p.query(`SELECT COUNT(*)::int n FROM pg_stat_activity
                                WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()`);
      if (r.rows[0].n > 0) quietSince = Date.now();
      if (Date.now() - quietSince >= 1000) return Date.now() - 1000;
      await new Promise(res => realTimeout(res, 100));
    }
    return Date.now();
  } finally { await p.end(); }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/jobs") { res.end(JSON.stringify(held.map(h => ({ name: h.name, everyMs: h.ms })))); return; }
  if (u.pathname !== "/run") { res.statusCode = 404; res.end(); return; }
  const max = Number(u.searchParams.get("max") || 300000);
  // Answer at once when asked to: the run can outlast any client timeout, and
  // TICK_LOG holds each job's line as it finishes.
  if (u.searchParams.get("async") === "1") res.end(JSON.stringify({ started: true }));
  const only = u.searchParams.get("only");
  const out = [];
  for (const h of held) {
    if (h.ms > max) continue;
    if (only && !only.split(",").includes(h.name)) continue;
    const t0 = Date.now();
    let error = null, timedBy = "promise";
    try {
      const p = h.fn();
      if (p && typeof p.then === "function") await p;
      else { timedBy = "db-quiet"; }
    } catch (e) { error = String(e && e.message || e).slice(0, 200); }
    const end = timedBy === "db-quiet" ? await dbQuiet() : Date.now();
    const row = { name: h.name, everyMs: h.ms, ms: end - t0, timedBy, error, at: new Date().toISOString() };
    out.push(row);
    if (process.env.TICK_LOG) require("fs").appendFileSync(process.env.TICK_LOG, JSON.stringify(row) + "\n");
  }
  if (process.env.TICK_LOG) require("fs").appendFileSync(process.env.TICK_LOG, JSON.stringify({ done: true, at: new Date().toISOString() }) + "\n");
  if (u.searchParams.get("async") === "1") return;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(out));
}).listen(6709, "127.0.0.1");
