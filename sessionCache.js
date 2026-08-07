// BUILD-38 Part 1 — short-TTL LRU cache for per-request session revocation.
//
// requireAuth (auth.js) reads each user's { sessions_valid_after, role, org_id }
// through this cache, so the revocation check is NOT a DB read on every request.
// Worst-case revocation lag is the TTL (default 30s) instead of the JWT's 7-day
// lifetime — the hole BUILD-37 left open (a deleted/removed user's token kept
// reading org data for a week). Per-process by design: in a multi-instance
// deploy each instance expires independently, so 30s is the cross-instance
// ceiling; the instance that performs a bump evicts its own entry immediately.
//
// No DB dependency here on purpose — this module is unit-testable in isolation
// with a spy loader (tests/session-cache.test.js).
class SessionCache {
  constructor({ ttlMs, max } = {}) {
    // Honor an explicit 0 (disables caching → every read is fresh). The scripted
    // suites boot with SESSION_CACHE_TTL_MS=0 because they reuse fixed user ids
    // and delete/recreate rapidly; in prod, ids are uuids and deletes permanent,
    // so the default 30s cache is safe.
    const envTtl = Number(process.env.SESSION_CACHE_TTL_MS);
    this.ttlMs = ttlMs ?? (Number.isFinite(envTtl) ? envTtl : 30000);
    this.max = max ?? 10000;
    this.map = new Map(); // userId -> { value, expires } ; Map keeps insertion order → LRU
  }

  // Returns the loaded value (may be null = no such user). `loader(userId)` is
  // awaited only on a miss/expiry; repeated calls within the TTL hit the cache
  // and never touch `loader`.
  async get(userId, loader) {
    const now = Date.now();
    const hit = this.map.get(userId);
    if (hit && hit.expires > now) {
      this.map.delete(userId); // refresh recency (move to MRU end)
      this.map.set(userId, hit);
      return hit.value;
    }
    if (hit) this.map.delete(userId); // expired
    const value = await loader(userId);
    this.map.set(userId, { value, expires: now + this.ttlMs });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value; // LRU: first key is least-recently-used
      this.map.delete(oldest);
    }
    return value;
  }

  evict(userId) { this.map.delete(userId); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

const sessionCache = new SessionCache();
module.exports = { SessionCache, sessionCache };
