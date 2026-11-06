#!/usr/bin/env node
// STAGE-1 · WAIT UNTIL ONE COPY OF STEWARD SERVES THIS COMMIT (web, worker, frontend).
//
// The staging deploy and ship.yml use this; ci.yml's prod jobs keep their own
// inline loops, unchanged, so the flow without staging is exactly as before.
//   --api <url>        /health must say status ok and buildSha == --sha
//   --worker           and /health's worker must be on --sha with role worker
//   --env <name>       and /health's env must be this ("staging" or "production")
//   --frontend <url>   the page's build-sha meta must be --sha
//   --minutes <n>      how long to wait (default 5)
"use strict";
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(k);
const SHA = arg("--sha", process.env.GITHUB_SHA);
const API = arg("--api"), FRONT = arg("--frontend"), ENV = arg("--env");
const MAX = Number(arg("--minutes", "5")) * 60000;
const short = s => (s ? String(s).slice(0, 7) : "-");

async function look() {
  const seen = {};
  if (API) {
    try {
      const h = await (await fetch(API.replace(/\/+$/, "") + "/health", { signal: AbortSignal.timeout(10000) })).json();
      seen.ok = h.status === "ok"; seen.web = h.buildSha; seen.env = h.env || "production";
      seen.worker = h.worker && h.worker.buildSha; seen.role = h.worker && h.worker.role;
    } catch { seen.ok = false; }
  }
  if (FRONT) {
    try {
      const t = await (await fetch(FRONT, { signal: AbortSignal.timeout(10000) })).text();
      seen.frontend = ((/name="build-sha" content="([0-9a-f]{40})"/.exec(t)) || [])[1] || null;
    } catch { seen.frontend = null; }
  }
  const good = (!API || (seen.ok && seen.web === SHA && (!ENV || seen.env === ENV) && (!has("--worker") || (seen.worker === SHA && seen.role === "worker"))))
    && (!FRONT || seen.frontend === SHA);
  return { good, seen };
}

(async () => {
  if (!SHA || !(API || FRONT)) { console.error("wait-live: --sha and --api or --frontend are required"); process.exit(2); }
  const t0 = Date.now();
  for (let i = 1; ; i++) {
    const { good, seen } = await look();
    const line = `web ${short(seen.web)}${has("--worker") ? ` worker ${short(seen.worker)} (${seen.role || "-"})` : ""}${FRONT ? ` frontend ${short(seen.frontend)}` : ""}${ENV ? ` env ${seen.env || "-"}` : ""}`;
    if (good) { console.log(`OK: serving ${short(SHA)} · ${line}`); return; }
    if (ENV && seen.env && seen.env !== ENV) { console.error(`FAIL: ${API} says env ${seen.env}, not ${ENV}. Refusing to treat it as ${ENV}.`); process.exit(1); }
    if (Date.now() - t0 > MAX) { console.error(`FAIL: never served ${short(SHA)} within ${MAX / 60000} min · last seen ${line}`); process.exit(1); }
    console.log(`  [${i}] ${line}`);
    await new Promise(r => setTimeout(r, 5000));
  }
})();
