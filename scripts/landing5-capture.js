// LANDING-5 · the mockup captures: Home (six pillars and four) and /pricing,
// at 1440 and 390. Fails on sideways scroll at 390 and on a console error.
// Run: PLAYWRIGHT_DIR=$HOME/steward-qa BASE=http://localhost:4251 node scripts/landing5-capture.js
const path = require("path");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || ".", "node_modules/playwright"));
const BASE = process.env.BASE || "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "landing-5");
const FOUR = () => {
  document.querySelectorAll('section.pillar[data-pillar="4"], section.pillar[data-pillar="5"]').forEach(n => n.remove());
};
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [name, route, w, tweak] of [
    ["home-six", "/", 1440], ["home-six", "/", 390], ["home-four", "/", 1440, FOUR], ["home-four", "/", 390, FOUR],
    ["pricing", "/pricing", 1440], ["pricing", "/pricing", 390]]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    const errs = []; p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
    await p.goto(BASE + route, { waitUntil: "networkidle" });
    if (tweak) await p.evaluate(tweak);
    const h = await p.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < h; y += 700) { await p.evaluate(y => window.scrollTo(0, y), y); await p.waitForTimeout(60); }
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForLoadState("networkidle"); await p.waitForTimeout(400);
    const sideways = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const file = path.join(OUT, `${name}-${w}.jpg`);
    await p.screenshot({ path: file, fullPage: true, type: "jpeg", quality: 78 });
    const real = errs.filter(e => !/Failed to load resource|ERR_CONNECTION_REFUSED|localhost:56/.test(e));
    if (sideways > 0 || real.length) bad++;
    console.log(`${sideways > 0 || real.length ? "FAIL" : "ok  "} ${file}  sideways=${sideways}px  console=${real.length}${real.length ? " " + real[0].slice(0, 120) : ""}`);
    await p.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
