// BUILD-38 Part 1 — SessionCache unit tests (in-process, no server/DB).
// Proves the cache keeps requireAuth off the per-request DB path (the query-spy
// assertion) and that a change is reflected within the TTL. All assertions fail
// against pre-fix code (there was no cache — every request would have hit the DB,
// or, in BUILD-37, no revocation lookup existed at all).
const { SessionCache } = require("../sessionCache");
const { ok, summary } = require("./helpers");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ── Query spy: N reads inside the TTL → exactly one loader (DB) call ────────
  {
    const c = new SessionCache({ ttlMs: 1000, max: 100 });
    let calls = 0;
    const loader = async (id) => { calls++; return { id, role: "admin", org_id: "o1", sessions_valid_after: "2020-01-01" }; };
    for (let i = 0; i < 25; i++) await c.get("u1", loader);
    ok("25 requests inside TTL → exactly one DB read", calls === 1, calls);
    ok("cache holds the loaded value", (await c.get("u1", loader)).role === "admin");
    ok("still one DB read after the extra hit", calls === 1, calls);
  }

  // ── Reflected within TTL: after expiry the loader is re-invoked (role change) ─
  {
    const c = new SessionCache({ ttlMs: 150, max: 100 });
    let role = "admin", calls = 0;
    const loader = async () => { calls++; return { role, org_id: "o", sessions_valid_after: "2020-01-01" }; };
    ok("first read sees admin", (await c.get("u", loader)).role === "admin");
    role = "staff"; // change the underlying value
    ok("within TTL still sees the cached admin", (await c.get("u", loader)).role === "admin", "should be stale");
    await sleep(200); // exceed TTL
    const after = await c.get("u", loader);
    ok("after TTL the change is reflected", after.role === "staff", after.role);
    ok("exactly two DB reads across the window", calls === 2, calls);
  }

  // ── evict() forces an immediate reload (the bump path) ─────────────────────
  {
    const c = new SessionCache({ ttlMs: 10000, max: 100 });
    let calls = 0;
    const loader = async () => { calls++; return { role: "x" }; };
    await c.get("u", loader); await c.get("u", loader);
    ok("cached before evict (one read)", calls === 1, calls);
    c.evict("u");
    await c.get("u", loader);
    ok("evict forces a reload", calls === 2, calls);
  }

  // ── null (missing user) is cached too, so bogus tokens don't hammer the DB ──
  {
    const c = new SessionCache({ ttlMs: 1000, max: 100 });
    let calls = 0;
    const loader = async () => { calls++; return null; };
    const a = await c.get("gone", loader); const b = await c.get("gone", loader);
    ok("missing user resolves to null", a === null && b === null);
    ok("null result is cached (one read)", calls === 1, calls);
  }

  // ── LRU: cap enforced, least-recently-used evicted, recency respected ───────
  {
    const c = new SessionCache({ ttlMs: 10000, max: 2 });
    const mk = () => { let n = 0; return async () => ({ n: ++n }); };
    const la = mk(), lb = mk(), lc = mk();
    await c.get("a", la);           // [a]
    await c.get("b", lb);           // [a,b]
    await c.get("a", la);           // touch a → [b,a] (a is MRU)
    await c.get("c", lc);           // insert c → evict LRU (b) → [a,c]
    ok("cap enforced (size ≤ max)", c.size === 2, c.size);
    let aCalls = 0; const laSpy = async () => { aCalls++; return {}; };
    await c.get("a", laSpy);
    ok("recently-used 'a' survived (no reload)", aCalls === 0, aCalls);
    let bCalls = 0; const lbSpy = async () => { bCalls++; return {}; };
    await c.get("b", lbSpy);
    ok("least-recently-used 'b' was evicted (reload)", bCalls === 1, bCalls);
  }

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
