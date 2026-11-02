// screens1-parts — SCREENS-1. EVERY PART OF THE SPLIT SCREENS MOUNTS.
//
// SCREENS-1 moved Settings' cards into components/settings/, the import
// wizard's steps into components/import/ and Home's later half into
// components/home/, verbatim. Each part gets one small render here: mounted
// with fake data in a real browser, it draws its main text and no error. The
// cases are tests/lib/screens1Parts.jsx, bundled with the client's own esbuild
// and React; the network is cut, so a card that reads on mount draws its
// empty or failed state, never a stranger's data.
//
// HOW IT GOES RED: a part that throws on mount (a name it reads that the move
// left behind, a TDZ read, an import path one folder off) draws the boundary's
// "RENDER ERROR" instead of its text, and a part that draws nothing fails its
// pattern. SCREENS-1 planted both: an import of "./MetricBreakdownPanel"
// left un-rewritten in home/homeParts.jsx, and a prop read before its const.
//
// Browser suite conventions (BUILD-44 Part 6): SKIPs cleanly without Playwright.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, browserLegOrSkip } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, ".generated", "screens1-parts");
const skip = why => { browserLegOrSkip(why); console.log("\n0 passed, 0 failed (suite skipped)"); process.exit(0); };
let chromium, esbuild;
try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); }
catch { skip("Playwright not found (set PLAYWRIGHT_DIR)"); }
try { esbuild = require(path.join(ROOT, "client", "node_modules", "esbuild")); }
catch { skip("esbuild not found (npm ci --prefix client)"); }

// main.jsx boots the whole app when it is imported; a part only needs useAuth.
const stubMain = {
  name: "stub-main",
  setup(b) {
    b.onResolve({ filter: /(^|\/)main(\.jsx)?$/ }, a => (path.resolve(a.resolveDir, a.path).replace(/\.jsx$/, "") === path.join(ROOT, "client", "src", "main") ? { path: "main", namespace: "stub" } : undefined));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents:
      'export const useAuth = () => ({ auth: { user: { id: "u_fake", name: "Allie Test", role: "admin" }, org: { id: "org_fake", name: "Fake Org" } }, logout() {} });' }));
  },
};

const PAGE = "http://screens1-parts.test", FAKE_API = "http://127.0.0.1:9";
const FAKE = {
  "/legal/dpa": { published: true },
  "/settings/giving-levels": { midCents: 100000, majorCents: 500000 },
  "/settings/inbound-email": { address: "log-wrenfield@log.stewardapp.dev", unmatched: [] },
  "/import-mappings": { mappings: [{ id: "m1", name: "Wrenfield gift export", columns: [{ key: "gift date", header: "Gift Date", role: "date" }, { key: "amount", header: "Amount", role: "amount" }] }], roles: [{ key: "date", label: "Gift date" }, { key: "amount", label: "Amount" }] },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(__dirname, "lib", "screens1Parts.jsx")], bundle: true, format: "iife", outfile: path.join(OUT, "parts.js"),
    jsx: "automatic", loader: { ".js": "jsx", ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl", ".css": "empty", ".woff2": "empty" },
    // one React: the client's, for the cases and the parts alike
    nodePaths: [path.join(ROOT, "client", "node_modules")], plugins: [stubMain], logLevel: "error",
    alias: { react: path.join(ROOT, "client", "node_modules", "react"), "react-dom": path.join(ROOT, "client", "node_modules", "react-dom") },
    define: { "import.meta.env": JSON.stringify({ VITE_API_URL: FAKE_API, MODE: "test", DEV: false, PROD: true }), "process.env.NODE_ENV": '"development"' },
  });
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  // No network: the page is served here, a handful of reads get fake answers
  // so their cards draw, and everything else is refused, so nothing a part
  // reads on mount reaches a server.
  await page.route("**/*", r => {
    const u = new URL(r.request().url());
    if (u.origin === PAGE) return r.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
    if (u.origin === FAKE_API && FAKE[u.pathname]) return r.fulfill({ contentType: "application/json", body: JSON.stringify(FAKE[u.pathname]) });
    return r.abort();
  });
  await page.goto(PAGE + "/");
  await page.addScriptTag({ content: fs.readFileSync(path.join(OUT, "parts.js"), "utf8") });
  const names = await page.evaluate(() => window.__names);
  const files = ["settings", "import", "home"].flatMap(d => fs.readdirSync(path.join(ROOT, "client", "src", "components", d))
    .filter(f => /\.jsx?$/.test(f)).map(f => d + "/" + f.replace(/\.jsx?$/, "")));
  const missing = files.filter(f => !names.includes(f));
  ok(`every part file has a case (${files.length} files)`, files.length > 0 && missing.length === 0, missing);
  for (const name of names) {
    const r = await page.evaluate(n => window.__case(n), name);
    const re = new RegExp(r.pattern, r.flags);
    ok(`${name} mounts and shows its text`, !r.error && re.test(r.text), (r.error || r.text).replace(/\s+/g, " ").slice(0, 200));
  }
  await browser.close();
})().catch(e => ok("suite ran", false, e.stack)).finally(() => summary());
