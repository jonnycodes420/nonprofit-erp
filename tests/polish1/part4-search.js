// POLISH-1 Part 4 · SEARCH CAN BE CLICKED.
//
// The walk: clicking the header search box only focused it, Ctrl+K did
// nothing on Windows, and the only hint said ⌘K. The box is the palette, and
// it showed nothing until she typed, so every way in looked dead.
//   §4a on Windows (a non-Mac platform), Ctrl+K opens the palette
//   §4b clicking the header search box opens it
//   §4c the hint shows the visitor's own key: Ctrl K on Windows, ⌘K on a Mac
//   §4d ⌘K (Meta+K) still opens it on a Mac
//
// WHAT WOULD MAKE THIS FAIL (planted before trusted): the dropdown shown only
// once something is typed (§4a, §4b red); a hard-coded "⌘K" placeholder
// (§4c red).
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const ORG = "org_pol1srch";
const ADMIN = "admin@pol1srch.local";

async function wipe(h) {
  const tables = (await h.q(`SELECT table_name FROM information_schema.columns
                              WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await h.q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await h.q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
}

const WINDOWS = { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", platform: "Win32" };
const MAC = { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", platform: "MacIntel" };

module.exports = async function part4(h) {
  const ROOT = path.join(__dirname, "..", "..");
  const DIST = path.join(ROOT, "client", "dist");
  const APP = process.env.APP_URL || "http://localhost:4173";
  const skip = why => h.browserLegOrSkip(why, "§4");
  if (!fs.existsSync(path.join(DIST, "index.html"))) return skip("client/dist not built");
  const API_ORIGIN = h.BASE.replace(/^https?:\/\//, "");
  const assetDir = path.join(DIST, "assets");
  if (!fs.readdirSync(assetDir).filter(f => f.endsWith(".js")).some(f => fs.readFileSync(path.join(assetDir, f), "utf8").includes(API_ORIGIN)))
    return skip("client/dist not built against the local API");
  let chromium;
  try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
  catch { return skip("Playwright not found (set PLAYWRIGHT_DIR)"); }

  await wipe(h);
  await h.q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
             VALUES ($1,'Polish Search Fixture','pol1-srch',1,'active','team','America/New_York')`, [ORG]);
  await h.q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_pol1srch',$1,$2,$3,'Search Admin','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 4)]);
  const li = await h.api("POST", "/auth/login", null, { email: ADMIN, password: "loadtest1234" });
  const shots = process.env.POLISH1_SHOTS || "";
  const browser = await chromium.launch();
  const open = async (plat) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", userAgent: plat.ua });
    await ctx.addInitScript(([t, u, o, p]) => {
      Object.defineProperty(navigator, "platform", { get: () => p });
      try { Object.defineProperty(navigator, "userAgentData", { get: () => undefined }); } catch { /* not every engine */ }
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [li.body.token, JSON.stringify(li.body.user || {}), JSON.stringify(li.body.org || {}), plat.platform]);
    const page = await ctx.newPage();
    await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
    const box = page.locator('[data-testid="global-search"]').first();
    await box.waitFor({ state: "visible", timeout: 30000 });
    // Something else has the focus first, the way a person arrives at a page.
    await page.locator("body").click({ position: { x: 700, y: 600 } }).catch(() => {});
    return { ctx, page, box };
  };
  const dropdown = page => page.locator('[data-testid="search-dropdown"]').first();
  try {
    {
      const { ctx, page, box } = await open(WINDOWS);
      const ph = await box.getAttribute("placeholder");
      h.ok("§4c on Windows the hint says Ctrl K, not ⌘K", /Ctrl K/.test(ph || "") && !/⌘/.test(ph || ""), ph);
      await page.keyboard.press("Control+k");
      const opened = await dropdown(page).isVisible({ timeout: 4000 }).catch(() => false);
      const focused = await box.evaluate(el => document.activeElement === el);
      h.ok("§4a on Windows, Ctrl+K opens the search palette", opened && focused, { opened, focused });
      if (shots && opened) await page.screenshot({ path: path.join(shots, "part4-palette-ctrlk-1440.png") });
      await page.keyboard.press("Escape");
      await page.locator("body").click({ position: { x: 700, y: 600 } }).catch(() => {});
      await box.click();
      const clicked = await dropdown(page).isVisible({ timeout: 4000 }).catch(() => false);
      h.ok("§4b clicking the header search box opens the palette", clicked);
      await ctx.close();
    }
    {
      const { ctx, page, box } = await open(MAC);
      const ph = await box.getAttribute("placeholder");
      h.ok("§4c on a Mac the hint says ⌘K", /⌘K/.test(ph || ""), ph);
      await page.keyboard.press("Meta+k");
      const opened = await dropdown(page).isVisible({ timeout: 4000 }).catch(() => false);
      h.ok("§4d on a Mac, ⌘K opens the search palette", opened);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await wipe(h);
  }
};
