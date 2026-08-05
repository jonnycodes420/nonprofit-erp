// BUILD-36 B1 — capture the rebuilt (on-brand) invite-accept page, desktop +
// mobile. Renders the built client from a local `vite preview` and intercepts
// the /auth/invite/:token fetch with a stub, so no server/CORS is needed.
//
// Usage:
//   (cd client && VITE_API_URL=http://localhost:5601 npx vite build && npx vite preview --port 4173 &)
//   PLAYWRIGHT_DIR=$HOME/steward-qa BASE=http://localhost:4173 node scripts/build36-invite-capture.js

const path = require("path");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "build36-" + new Date().toISOString().slice(0, 10));
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, "node_modules", "playwright"));

const INVITE = { orgName: "Creo Arts Collective", email: "benjamin@creoarts.org", role: "staff" };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [tag, width] of [["desktop", 1440], ["mobile", 390]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 3 });
    await page.route("**/auth/invite/**", route => {
      if (/\/accept$/.test(route.request().url())) return route.continue();
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INVITE) });
    });
    await page.goto(`${BASE}/invite/sample-token`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `invite-page-${tag}.png`), fullPage: false });
    console.log("captured", `invite-page-${tag}.png`);
    await page.close();
  }
  await browser.close();
})();
