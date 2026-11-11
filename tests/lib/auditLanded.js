// tests/lib/auditLanded.js · FLAKE-3. WAIT FOR THE AUDIT ROWS, THEN READ THEM.
//
// The audit middleware (middleware/auditTrail.js) writes a request's rows on
// the response's `finish`, after the answer has gone: the one audit write, by
// design. A suite that reads fin_audit_log the moment the answer arrives can
// read before the rows land. integrity3 did: §4 read the person's "moved to
// trash" row, found none, and a moment later read the undo's own row, which
// the same statement wrote ({"mv":[],"undid":1} on NAV-1's CI run 42939249241).
//
// landed(q, sql, args, want) polls `sql` (a SELECT COUNT(*)::int AS n …) until
// n >= want or the deadline, and returns the last n. It never asserts: the
// suite asserts on the rows it reads afterwards.
"use strict";

async function landed(q, sql, args, want = 1, { timeoutMs = 15000, pollMs = 50 } = {}) {
  const t0 = performance.now();
  let n = 0;
  for (;;) {
    n = Number(((await q(sql, args))[0] || {}).n) || 0;
    if (n >= want || performance.now() - t0 > timeoutMs) return n;
    await new Promise(r => setTimeout(r, pollMs));
  }
}

module.exports = { landed };
