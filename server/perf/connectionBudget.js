// SCALE-4 · DOES ANOTHER WEB REPLICA FIT THE DATABASE'S CONNECTIONS?
//
// SCALE-3's card advised a second web replica on speed alone. Each web process
// opens up to DB_POOL_MAX plus the set-wise pool's share (pools.js: 10 + 3 = 13),
// the worker 5 + 1 = 6, and a deploy runs the old and the new copy of every web
// replica at once. So the worst case is
//     web replicas × (pool + extra) × 2 + the worker
// = 1 × 13 × 2 + 6 = 32 today, and 2 × 13 × 2 + 6 = 58 with a second replica:
// past a database that takes 40. The limit is the smaller of Postgres's own
// max_connections (read live, SHOW max_connections) and the pooler's size
// (POOLER_SIZE, as `npm run status` reads it), so the card never advises a
// replica the database cannot hold, and says what has to come first.
"use strict";

const setMaxFor = (m) => Math.min(3, Math.max(1, Math.floor(m / 3)));            // pools.js SET_POOL_MAX
const perRequestFor = (m) => Math.max(1, Math.min(5, Math.floor(m / 2) || 1));    // pools.js PER_REQUEST_MAX at the default cap

// Pure. `web` and `worker` are { max, setMax } (one process each); `replicas`
// the web replicas running now; `maxConnections` and `poolerSize` the limits
// (either may be null when unknown).
function budget({ maxConnections = null, poolerSize = null, web, worker, replicas = 1 }) {
  const perWeb = Number(web.max) + Number(web.setMax), perWorker = Number(worker.max) + Number(worker.setMax);
  const limits = [
    maxConnections ? { n: Number(maxConnections), what: "Postgres max_connections" } : null,
    poolerSize ? { n: Number(poolerSize), what: "the pooler's pool size" } : null,
  ].filter(Boolean).sort((a, b) => a.n - b.n);
  const limit = limits.length ? limits[0].n : null;
  const worst = (r) => r * perWeb * 2 + perWorker;
  const sum = (r) => `${r} × ${perWeb} × 2 + ${perWorker} = ${worst(r)}`;
  const fits = (r) => limit == null || worst(r) <= limit;
  // The largest web DB_POOL_MAX with which one more replica fits, the worker as it is.
  let fitPool = null;
  for (let m = Number(web.max) - 1; m >= 2; m--) if ((replicas + 1) * (m + setMaxFor(m)) * 2 + perWorker <= limit) { fitPool = m; break; }
  return {
    limit, limitWhat: limits.length ? limits[0].what : null, maxConnections: maxConnections == null ? null : Number(maxConnections),
    poolerSize: poolerSize == null ? null : Number(poolerSize), perWeb, perWorker, replicas,
    now: worst(replicas), next: worst(replicas + 1), nowSum: sum(replicas), nextSum: sum(replicas + 1),
    fitsNow: fits(replicas), fitsNext: fits(replicas + 1),
    fitPool, fitSetMax: fitPool == null ? null : setMaxFor(fitPool), fitPerRequest: fitPool == null ? null : perRequestFor(fitPool),
    sentence: limit == null ? "The database's connection limit was not read."
      : `Connections in a deploy, worst case: ${sum(replicas)} of ${limit} (${limits.map(l => `${l.what} ${l.n}`).join(", ")}); with one more web replica ${sum(replicas + 1)}.`,
  };
}

// What has to come first, in one sentence, when one more replica does not fit.
function firstStep(b) {
  const pool = b.fitPool != null
    ? `lower the web's pool to DB_POOL_MAX=${b.fitPool} (${b.fitPool} + ${b.fitSetMax} a replica; a request may then hold ${b.fitPerRequest} connections, not 5)`
    : "lower the web's pool";
  return `First ${pool}, or put a connection pooler in front of Postgres. The steps and their cost are in docs/needs-jonathan/SCALE-4.md.`;
}

// Live: Postgres's own limit, this web process's pool, the worker's from its heartbeat.
async function readLive(query, { worker = null } = {}) {
  let maxConnections = null;
  try { const [r] = await query("SHOW max_connections", []); maxConnections = r ? Number(r.max_connections) : null; } catch (_) { /* unknown */ }
  const P = require("../shared/pools");
  const w = worker && worker.max != null ? { max: worker.max, setMax: worker.setMax != null ? worker.setMax : setMaxFor(worker.max) } : { max: 5, setMax: 1 };
  return budget({ maxConnections, poolerSize: Number(process.env.POOLER_SIZE) || 40, web: { max: P.POOL_MAX, setMax: P.SET_POOL_MAX },
    worker: w, replicas: Math.max(1, Number(process.env.WEB_REPLICAS) || 1) });
}

module.exports = { budget, firstStep, readLive, setMaxFor, perRequestFor };
