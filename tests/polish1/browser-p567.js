// POLISH-1 — the browser leg shared by the sections: Playwright from
// PLAYWRIGHT_DIR, a dist built against THIS $BASE, and a context signed in as
// a fixture admin by token (never the login form). Returns null and prints the
// leg-skip marker when any of the three is missing (REQUIRE_BROWSER=1 makes
// that a failure, via helpers.browserLegOrSkip).
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..", "..");
const DIST = path.join(ROOT, "client", "dist");

function why(h) {
  if (!fs.existsSync(path.join(DIST, "index.html"))) return "client/dist not built";
  const origin = h.BASE.replace(/^https?:\/\//, "");
  const assets = path.join(DIST, "assets");
  const js = fs.existsSync(assets) ? fs.readdirSync(assets).filter(f => f.endsWith(".js")) : [];
  if (!js.some(f => fs.readFileSync(path.join(assets, f), "utf8").includes(origin))) return "client/dist not built against the local API";
  try { require.resolve(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright")); }
  catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
  return null;
}

async function open(h, label) {
  const w = why(h);
  if (h.browserLegOrSkip(w, label)) return null;
  const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
  const browser = await chromium.launch();
  const APP = process.env.APP_URL || "http://localhost:4173";
  const signedIn = async (email, viewport = { width: 1440, height: 900 }) => {
    const li = await h.api("POST", "/auth/login", null, { email, password: "loadtest1234" });
    const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
    await ctx.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [li.body.token, JSON.stringify(li.body.user || {}), JSON.stringify(li.body.org || {})]);
    return { ctx, page: await ctx.newPage() };
  };
  return { browser, APP, signedIn };
}

module.exports = { open };
