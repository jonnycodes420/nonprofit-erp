// tests/lib/undoWait.js · IMPORT-7. AN UNDO THAT CANNOT HANG THE SHARD.
//
// On 3 Nov a CI shard hung twice at perf-app's Undo of the 25,000-person
// workbook: the test POSTed /imports/:id/reverse with no timeout and the
// request never answered. This presses Undo the way the screen does
// (ImportUndo.jsx): the POST has its own timeout, a 202 is followed on
// GET /imports/:id/undo-status until it is done or has stopped, and the whole
// wait has a deadline. Past it the answer is { status: "timeout" } with what
// was last seen, never a wait.
"use strict";

// A dropped keep-alive socket is tried again (twice): pressing Undo again is
// safe, the route answers the same undo. Its own timeout is never tried again.
async function call(base, token, method, route, body, ms) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(base + route, { method, signal: AbortSignal.timeout(ms),
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: body == null ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    } catch (e) {
      if (e.name === "TimeoutError" || i >= 2) throw e;
      await new Promise(z => setTimeout(z, 200));
    }
  }
}

async function undoAndWait(base, token, importId, { timeoutMs = 120000, pollMs = 250 } = {}) {
  const t0 = performance.now(), left = () => Math.max(1, Math.floor(timeoutMs - (performance.now() - t0)));   // AbortSignal.timeout takes whole ms
  const seen = [];
  let first;
  try { first = await call(base, token, "POST", `/imports/${encodeURIComponent(importId)}/reverse`, {}, left()); }
  catch (e) {
    return { status: e.name === "TimeoutError" ? "timeout" : "unreachable", ms: Math.round(performance.now() - t0), seen,
      error: e.name === "TimeoutError" ? `the undo did not answer in ${Math.round(timeoutMs / 1000)} s` : `the undo could not be sent: ${e.message}` };
  }
  const answeredMs = Math.round(performance.now() - t0);
  if (first.status !== 202) return { status: first.status, body: first.body, via: "inline", answeredMs, ms: answeredMs, seen };
  for (;;) {
    if (performance.now() - t0 > timeoutMs) return { status: "timeout", via: "queue", answeredMs, ms: Math.round(performance.now() - t0), last: seen[seen.length - 1] || null, seen,
      error: `the queued undo did not finish in ${Math.round(timeoutMs / 1000)} s (last: ${(seen[seen.length - 1] || {}).sentence || "nothing"})` };
    await new Promise(z => setTimeout(z, pollMs));
    let s;
    try { s = await call(base, token, "GET", `/imports/${encodeURIComponent(importId)}/undo-status`, null, Math.min(10000, left())); }
    catch { continue; }
    if (s.status !== 200) return { status: s.status, body: s.body, via: "queue", answeredMs, ms: Math.round(performance.now() - t0), seen };
    seen.push({ status: s.body.status, phase: s.body.phase, done: s.body.done, total: s.body.total, sentence: s.body.sentence });
    if (s.body.status === "done") return { status: 200, body: s.body.result || {}, via: "queue", answeredMs, ms: Math.round(performance.now() - t0), seen };
    if (s.body.status === "failed") return { status: "failed", body: s.body, via: "queue", answeredMs, ms: Math.round(performance.now() - t0), seen, error: s.body.sentence };
  }
}

module.exports = { undoAndWait };
