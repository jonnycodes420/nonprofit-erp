// BUILD-92 B3 — HOME PROPORTIONS. Run: node tests/build92-home-proportions.test.js
//
// B3's brief asked for a Home that is calm and dense: a short headline instead
// of a three-line one, two columns with a Today rail, a lighter ground, one
// action per row, a 240px sidebar, and one column on a phone.
//
// ALL OF THAT IS ALREADY BUILT. BUILD-88d (commit 29b8c4b) did the proportions
// pass and BUILD-89 then superseded parts of it in the same direction (the
// header is the greeting and the day; the rail is a panel column, not a grid
// cell; it stacks at 1100 rather than 900, which is a superset of "one column
// under 900"). So B3 did not rebuild the screen. What it ADDED is the one
// thing the brief asked for that was genuinely missing: a DEFINITION under
// each of the rail's three numbers.
//
// This suite is the guard that keeps all of it, measured in a real browser at
// 1440 and 390 rather than asserted from source, so a later build cannot undo
// the proportions without a red test. Skips cleanly (never a false pass)
// without Playwright, a dist built against this API, or an app at APP_URL.

const fs = require("fs");
const path = require("path");
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");

const root = path.join(__dirname, "..");
const EMAIL = "b41mobile@example.org";      // the shared 25-donor fixture org

(async () => {
  // ── the token census may not rise ────────────────────────────────────────
  // Same count, same ceiling, same file as tests/palette-census.test.js. It is
  // repeated here because B3 is a LAYOUT pass and a layout pass is exactly how
  // a palette quietly grows a fifth colour.
  console.log("— the census does not rise —");
  const census = fs.readFileSync(path.join(root, "tests/palette-census.test.js"), "utf8");
  const ceiling = Number((census.match(/const HEX_CEILING = (\d+)/) || [])[1]);
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const hex = walk(path.join(root, "client/src"))
    .reduce((n, f) => n + (strip(fs.readFileSync(f, "utf8")).match(/#[0-9a-fA-F]{6}\b/g) || []).length, 0);
  ok(`the palette census has a ceiling to measure against`, ceiling > 0, ceiling);
  ok(`hex literals did not rise (${hex} <= ${ceiling})`, hex <= ceiling, { hex, ceiling });

  console.log("\n— Home, measured in a browser at 1440 and 390 —");
  const APP = process.env.APP_URL || "http://localhost:4173";
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  const DIST = path.join(root, "client", "dist");
  const note = why => console.log("  SKIP  browser checks: " + why);
  await (async () => {
    if (!fs.existsSync(path.join(DIST, "index.html"))) return note("client/dist not built");
    const origin = BASE.replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(origin)))
      return note(`client/dist not built against ${BASE} (VITE_API_URL)`);
    let chromium;
    try { module.paths.unshift(path.join(PW_DIR, "node_modules")); ({ chromium } = require("playwright")); }
    catch { return note("Playwright not found (set PLAYWRIGHT_DIR)"); }
    try { const r = await fetch(APP + "/", { signal: AbortSignal.timeout(2000) }); if (!r.ok) throw new Error(); }
    catch { return note(`nothing serving ${APP} (set APP_URL; the API's CORS allowlist must cover that origin)`); }

    // The shared fixture org (25 seeded donors), created here if this stack
    // has never run empty-states / presentation-wiring.
    let auth;
    const signIn = async () => {
      const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "loadtest1234" }) });
      return r.json();
    };
    auth = await signIn();
    if (!auth.token) {
      const r = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName: "B41 Mobile Fixture", userName: "B41 Admin", email: EMAIL, password: "loadtest1234" }) });
      const j = await r.json();
      if (!j.token) return note("could not create the fixture org");
      await api("POST", "/onboarding/complete", j.token, {});
      await api("POST", "/org/load-sample-data", j.token, {});
      auth = await signIn();
    }
    if (!auth.token) return note("could not sign in to the fixture org");

    const browser = await chromium.launch();
    try {
      const measure = async (width, height) => {
        const page = await browser.newPage({ viewport: { width, height } });
        const errs = [];
        page.on("pageerror", e => errs.push("pageerror: " + e.message));
        await page.goto(APP + "/", { waitUntil: "domcontentloaded" });
        await page.evaluate(a => {
          localStorage.setItem("npe_token", a.token);
          localStorage.setItem("npe_user", JSON.stringify(a.user));
          localStorage.setItem("npe_org", JSON.stringify(a.org));
        }, auth);
        await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
        await page.waitForSelector(".home-shell", { timeout: 10000 });
        await page.waitForTimeout(1200);
        const m = await page.evaluate(() => {
          const q = s => document.querySelector(s);
          const box = el => { if (!el) return null; const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
          const head = q(".home-day");
          const cs = head && getComputedStyle(head);
          const rows = [...document.querySelectorAll(".attn-row")];
          // THE PRIMARY ACTION IS THE EMERALD ONE. On a given row exactly one
          // thing may be it, so the count is of FILLED emerald controls.
          const emerald = el => {
            const bg = getComputedStyle(el).backgroundColor.replace(/\s/g, "");
            return bg === "rgb(13,92,58)" || bg === "rgba(13,92,58,1)";
          };
          return {
            boundary: /Something went wrong|Try reloading/i.test(document.body.innerText),
            shell: box(q(".home-shell")), main: box(q(".home-shell-main")), rail: box(q(".home-rail")),
            sidebar: box(q(".app-sidebar")),
            ground: getComputedStyle(q(".dash-root")).backgroundColor.replace(/\s/g, ""),
            headline: head ? { ...box(head), fontSize: parseFloat(cs.fontSize), lineHeight: parseFloat(cs.lineHeight), text: head.innerText } : null,
            tiles: [...document.querySelectorAll('[data-testid^="rail-tile-"]')].map(t => ({
              key: t.getAttribute("data-testid").replace("rail-tile-", ""),
              text: t.innerText.replace(/\s+/g, " ").trim(),
              definition: (t.querySelector('[data-testid^="rail-def-"]') || {}).innerText || "",
            })),
            rowCount: rows.length,
            actionsPerRow: rows.map(r => [...r.querySelectorAll("button,a")].filter(emerald).length),
            docWidth: document.documentElement.scrollWidth,
          };
        });
        await page.close();
        return { m, errs };
      };

      // ══ 1440 ══════════════════════════════════════════════════════════════
      const wide = await measure(1440, 1000);
      const w = wide.m;
      ok("Home renders rather than landing in an error boundary", w.boundary === false);
      ok("no page error at 1440", wide.errs.length === 0, wide.errs.slice(0, 3));

      // THE HEADLINE. The brief asked for 34px and two lines instead of 60px
      // and three; BUILD-89 landed on 30px serif. What is GUARDED is the
      // property, not the decoration: it is serif-scale, it is not the old
      // 60px, and it is AT MOST TWO LINES.
      ok("there is a headline", !!w.headline, w.headline);
      ok("it is headline scale and nowhere near the old 60px",
         w.headline.fontSize >= 26 && w.headline.fontSize <= 40, w.headline.fontSize);
      const lines = Math.round(w.headline.h / w.headline.lineHeight);
      ok("it is at most two lines", lines <= 2, { lines, h: w.headline.h, lineHeight: w.headline.lineHeight, text: w.headline.text });

      // TWO COLUMNS, the work left and the Today rail right, one hairline
      // between them.
      ok("the Today rail is on the screen at 1440", !!w.rail, w.rail);
      ok("...to the RIGHT of the work, not above it",
         w.rail.x > w.main.x + w.main.w - 2 && Math.abs(w.rail.y - w.main.y) < 40, { main: w.main, rail: w.rail });
      ok("...and the two share one panel", !!w.shell && w.shell.w >= w.main.w + w.rail.w - 4, w.shell);

      // THREE TILES, EACH WITH ITS DEFINITION.
      ok("the rail carries exactly three tiles", w.tiles.length === 3, w.tiles.map(t => t.key));
      ok("each tile says what its number counted",
         w.tiles.every(t => t.definition.trim().length > 25), w.tiles.map(t => [t.key, t.definition]));
      ok("...and no two tiles share a definition",
         new Set(w.tiles.map(t => t.definition.trim())).size === 3, w.tiles.map(t => t.definition));

      // ONE ACTION PER ROW.
      ok("the Thread has rows to measure", w.rowCount > 0, w.rowCount);
      ok("no row offers more than one emerald action", w.actionsPerRow.every(n => n <= 1), w.actionsPerRow);

      // THE GROUND IS LIGHTER THAN WHITE AND LIGHTER THAN THE OLD CREAM.
      ok("the ground is the light warm ground, not cream and not white",
         w.ground === "rgb(247,245,240)", w.ground);

      // THE SIDEBAR IS 240.
      ok("the sidebar is 240px", w.sidebar && w.sidebar.w === 240, w.sidebar);

      // ══ 390 ═══════════════════════════════════════════════════════════════
      const narrow = await measure(390, 844);
      const n = narrow.m;
      ok("Home renders at 390 too", n.boundary === false);
      ok("no page error at 390", narrow.errs.length === 0, narrow.errs.slice(0, 3));
      ok("under 900 the rail is STACKED, not a column",
         n.rail && n.rail.y + n.rail.h <= n.main.y + 4, { main: n.main, rail: n.rail });
      ok("...and it comes first, because three numbers are the right thing to meet on a phone",
         n.rail.y <= n.main.y, { railY: n.rail.y, mainY: n.main.y });
      ok("the definitions survive the phone", n.tiles.every(t => t.definition.trim().length > 25),
         n.tiles.map(t => t.definition));
      ok("nothing pushes the page sideways at 390", n.docWidth <= 390, n.docWidth);
      const nlines = Math.round(n.headline.h / n.headline.lineHeight);
      ok("the headline is still at most two lines on a phone", nlines <= 2, { nlines, text: n.headline.text });
      ok("no row offers more than one emerald action on a phone",
         n.actionsPerRow.every(x => x <= 1), n.actionsPerRow);
    } finally { await browser.close(); }
  })();

  await closeDb();
  summary();
})();
