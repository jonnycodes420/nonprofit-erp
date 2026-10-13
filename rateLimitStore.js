// rateLimitStore.js — SCALE-1. RATE LIMITS EVERY WEB REPLICA SHARES.
//
// express-rate-limit keeps its counts in the memory of the process that
// served the request, so with two web replicas a sign-in limit of ten became
// twenty, and a restart wiped every count. Every limiter now goes through
// `rateLimit()` here, which gives it a Postgres store: one upsert per counted
// request, against `rate_limit_hits`.
//
// The two general ceilings (signed-in and public, applied to EVERY request)
// are the exception, on purpose: a database round trip on every request is a
// price the whole app would pay to tighten a ceiling of 6,000 per 15 minutes.
// They stay in memory, and each replica takes its share of the ceiling
// (`perReplica: true` divides the limit by WEB_REPLICAS), which is exact when
// the load balancer spreads requests and errs strict when it does not.
//
// A store error never locks anybody out: the request passes, and the error
// is logged (passOnStoreError).
const erl = require("express-rate-limit");
const { query, run } = require("./db");

class PgStore {
  constructor(prefix) { this.prefix = prefix; this.localKeys = false; }
  init(options) { this.windowMs = options.windowMs; }
  async increment(key) {
    const k = this.prefix + key;
    const [r] = await query(
      `INSERT INTO rate_limit_hits (key, hits, reset_at) VALUES (?, 1, NOW() + (?::int * INTERVAL '1 millisecond'))
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limit_hits.reset_at <= NOW() THEN 1 ELSE rate_limit_hits.hits + 1 END,
         reset_at = CASE WHEN rate_limit_hits.reset_at <= NOW() THEN EXCLUDED.reset_at ELSE rate_limit_hits.reset_at END
       RETURNING hits, reset_at`, [k, this.windowMs]);
    // Expired rows are cleared now and then, never on a schedule of their own.
    if (Math.random() < 0.01) run(`DELETE FROM rate_limit_hits WHERE reset_at < NOW() - INTERVAL '1 hour'`).catch(() => {});
    return { totalHits: Number(r.hits), resetTime: new Date(r.reset_at) };
  }
  async get(key) {
    const [r] = await query(`SELECT hits, reset_at FROM rate_limit_hits WHERE key = ? AND reset_at > NOW()`, [this.prefix + key]);
    return r ? { totalHits: Number(r.hits), resetTime: new Date(r.reset_at) } : undefined;
  }
  async decrement(key) { await run(`UPDATE rate_limit_hits SET hits = GREATEST(hits - 1, 0) WHERE key = ?`, [this.prefix + key]); }
  async resetKey(key) { await run(`DELETE FROM rate_limit_hits WHERE key = ?`, [this.prefix + key]); }
}

const replicas = () => Math.max(1, Number(process.env.WEB_REPLICAS) || 1);

// `name` is the limiter's own prefix: it must be the same in every replica, so
// it is written at the call site, never generated.
function rateLimit(name, { perReplica = false, ...opts }) {
  if (perReplica) {
    const lim = opts.limit;
    return erl.rateLimit({ ...opts, limit: typeof lim === "number" ? Math.max(1, Math.floor(lim / replicas())) : lim });
  }
  return erl.rateLimit({ passOnStoreError: true, ...opts, store: new PgStore(`rl:${name}:`) });
}

// A per-key count for callers that are not Express middleware (the public
// API's per-key minute). Same table, same rule.
async function hit(name, key, windowMs) {
  const s = new PgStore(`rl:${name}:`); s.init({ windowMs });
  return s.increment(key);
}

module.exports = { rateLimit, hit, ipKeyGenerator: erl.ipKeyGenerator, PgStore };
