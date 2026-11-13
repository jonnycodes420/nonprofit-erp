// PROFILE-SPEED-1 · HOW FULL THE WEB'S POOL GOT DURING A LOAD RUN.
//
// Reads /health four times a second (its pool counters are pg's own, no query
// behind them) and keeps the most connections in use at once, how often the
// pool was at 70% or more and at 100%, and, where the server reports it
// (PROFILE-SPEED-1's pools.js), the most any one request held. Loopback only,
// like the rest of scripts/load/.
"use strict";

function startPoolSampler(base, everyMs = 250) {
  const samples = [];
  let stopped = false, max = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const h = await (await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })).json();
      const p = h.pool || {};
      if (Number.isFinite(p.total) && Number.isFinite(p.idle)) samples.push(p.total - p.idle);
      if (Number.isFinite(p.max)) max = p.max;
    } catch { /* a missed sample is a missed sample */ }
    if (!stopped) setTimeout(tick, everyMs);
  };
  tick();
  return {
    async stop() {
      stopped = true;
      let perRequestPeak = null, perRequestMax = null;
      try {
        const h = await (await fetch(`${base}/health`)).json();
        if (h.pool && h.pool.perRequest) { perRequestPeak = h.pool.perRequest.peak; perRequestMax = h.pool.perRequest.max; }
      } catch { /* older server: no per-request line */ }
      const peak = samples.length ? Math.max(...samples) : null;
      const share = n => (samples.length ? Math.round(1000 * samples.filter(n).length / samples.length) / 10 : null);
      return { max, samples: samples.length, peak, peakPct: max && peak != null ? Math.round(100 * peak / max) : null,
        pctAt70: share(v => max && v >= 0.7 * max), pctAtFull: share(v => max && v >= max), perRequestPeak, perRequestMax };
    },
  };
}

module.exports = { startPoolSampler };
