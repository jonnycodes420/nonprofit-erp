// tests/lib/phone.js: HARDEN-2. The phone the speed budgets are held to, in
// one place (tests/perf-giving.spec.js, tests/perf-app.spec.js).
//
// Lighthouse's mobile profile (Moto G Power) applied as Lighthouse's own
// "devtools" throttling applies it, because Playwright throttles per request:
// 412×823 at 1.75x, DevTools slow 4G (562.5 ms round trip, 1,474.56 Kbps down,
// 675 Kbps up), and the CPU slowed down.
//
// THE CPU IS CALIBRATED, as Lighthouse calibrates with its benchmark index.
// "4x slower" is a different phone on a fast laptop and on a slow CI runner,
// so the slowdown is 4x on a machine that scores REF on the benchmark below
// (an Apple M5, where the brief's own 4.3 to 4.9 s for the giving pages was
// reproduced) and scaled by this machine's score, never below 1x. PERF_CPU
// overrides it.
"use strict";
const PHONE = {
  viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};
const SLOW_4G = { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 };
const REF = 54000, REF_RATE = 4;

// Small-string and array work in 500 ms, unthrottled; the median of three.
async function cpuRate(browser) {
  if (process.env.PERF_CPU) return { rate: Number(process.env.PERF_CPU), score: null };
  const page = await browser.newPage();
  const scores = [];
  for (let i = 0; i < 3; i++) scores.push(await page.evaluate(() => {
    const end = performance.now() + 500; let n = 0;
    while (performance.now() < end) { let s = ""; for (let i = 0; i < 1000; i++) s += "a"; const a = []; for (let i = 0; i < 1000; i++) a.push(i); a.sort((x, y) => y - x); n++; }
    return n * 2;
  }));
  await page.close();
  const score = scores.sort((a, b) => a - b)[1];
  return { rate: Math.max(1, Math.round((REF_RATE * score / REF) * 100) / 100), score };
}

module.exports = { PHONE, SLOW_4G, cpuRate };
