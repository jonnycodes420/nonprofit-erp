// BUILD-44 Part 6 — empty/thin-state sweep. TESTS ONLY.
//
// A brand-new org with ZERO donors drives every screen at 390px AND 1440px:
//   - no "NaN", "$NaN", "Invalid Date", "undefined", "Infinity" anywhere
//   - no uncaught page errors while rendering
//   - the Home retention figure with no history must NOT claim a rate
//     (a fresh org "retaining 100%" — or 0% — of nobody is a demo-visible lie)
// This is the class a prospect hits in the first five minutes of a trial.
//
// Browser suite conventions (same as landing-reveal): SKIPs cleanly when
// Playwright or a localhost-API client/dist is missing, so run-all stays
// portable; on the dev machine it always runs. Build first:
//   cd client && VITE_API_URL=http://localhost:5601 npx vite build

const path = require("path");
const fs = require("fs");
const { ok, summary, login, api, q } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const PORT = 4173;
const ORG = "org_emptysweep";
const ADMIN = "empty-sweep@example.org";

const skip = why => { console.log("  SKIP  " + why + "\n\n0 passed, 0 failed (suite skipped)"); process.exit(0); };
if (!fs.existsSync(path.join(DIST, "index.html"))) skip("client/dist not built");
const distJs = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
// BASE, never a literal port (BUILD-72 S-2): the dist must be built against
// whatever local API this run uses, which is not always :5601 on a machine
// running a second product's dev stack.
const API_ORIGIN = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
if (!distJs.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(API_ORIGIN)))
  skip(`client/dist not built against the local API (VITE_API_URL=${process.env.BASE || "http://localhost:5601"})`);
let chromium;
try { module.paths.unshift(path.join(PW_DIR, "node_modules")); ({ chromium } = require("playwright")); }
catch { skip("Playwright not found (set PLAYWRIGHT_DIR)"); }

const http = require("http");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };
// The scratch API's CORS allowlist covers origin :4173 only (the standard
// capture recipe) — the app MUST be served from 4173 or every fetch dies.
// Reuse whatever already serves there (vite preview); else serve dist there.
async function frontendBase() {
  try {
    const r = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return { base: `http://localhost:${PORT}`, srv: null };
  } catch { /* not running — serve it ourselves */ }
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url.startsWith("/_vercel/")) { res.statusCode = 404; return res.end(); } // analytics stubs: 404, not HTML
    let file = path.join(DIST, url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => srv.listen(PORT, r));
  return { base: `http://localhost:${PORT}`, srv };
}

const BAD = [/\bNaN\b/, /\$NaN/, /Invalid Date/i, /\bundefined\b/, /\bInfinity\b/, /\[object Object\]/];

(async () => {
  // fresh zero-donor org (structural seed only: chart of accounts + a fund)
  const bcrypt = require("bcryptjs");
  for (const t of ["notification_sends", "digest_sends", "workflow_runs", "workflows", "tasks", "interactions",
    "fin_transactions", "fin_funds", "fin_accounts", "accounts", "funds", "financials", "fundraising_goals",
    "impact_metrics", "metric_snapshots", "gifts", "grants", "campaigns", "giving_pages", "households", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status)
           VALUES ($1,'Empty Sweep Org','empty-sweep',1,'team','active')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_emptysweep',$1,$2,$3,'Empty Admin','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  const token = await login(ADMIN);
  await api("POST", "/onboarding/complete", token, {});
  // BUILD-76 follow-up: give the EMPTY org a goal so the goal banner (and its
  // "At risk" tile) renders — the tile reading "AT RISK —" on a zero-data org
  // was the defect: a healthy file and a silently failed import were
  // indistinguishable. The sweep below asserts words, never an em dash.
  const today = new Date().toISOString().slice(0, 10);
  const yearEnd = today.slice(0, 4) + "-12-31";
  await api("POST", "/goals", token, { label: "Empty-org goal", goalAmount: 10000, goalType: "total_raised", periodStart: today.slice(0, 4) + "-01-01", periodEnd: yearEnd });
  // the REAL login payload — hand-built user/org objects miss fields the
  // route guards read and the app silently bounces to /login
  const lr = await fetch((process.env.BASE || "http://localhost:5601") + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: "loadtest1234" }),
  });
  const j = await lr.json();

  const { base: FRONT, srv } = await frontendBase();
  const browser = await chromium.launch();

  async function sweep(width, height, label) {
    const page = await browser.newPage({ viewport: { width, height } });
    const pageErrors = [];
    page.on("pageerror", e => {
      const msg = String(e);
      // the Vercel analytics stubs 404/HTML under any local serve — noise, not product errors
      if (/Unexpected token '<'/.test(msg)) return;
      pageErrors.push(msg.slice(0, 120));
    });
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [j.token, JSON.stringify(j.user), JSON.stringify(j.org)]);
    await page.goto(`${FRONT}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // every reachable top-level surface, by visible nav button text
    const tabs = width >= 1000
      ? ["Home", "Donors", "Pipeline", "Fundraising", "Grants", "Communications", "Tasks", "Workflows", "Reports", "Finance", "Settings"]
      : ["Home", "Donors", "Grants", "Settings", "More"]; // mobile bottom bar (+ drawer peek)
    const found = {};
    for (const t of tabs) {
      const clicked = await page.evaluate(name => {
        // nav labels carry monochrome icon glyphs ("◈\nHome") — match contains,
        // shortest visible button wins (avoids content buttons that mention the word)
        const btns = [...document.querySelectorAll("button")]
          .filter(b => b.offsetParent && b.innerText.toLowerCase().includes(name.toLowerCase()))
          .sort((a, b) => a.innerText.length - b.innerText.length);
        if (!btns.length) return false;
        btns[0].click();
        return true;
      }, t);
      if (!clicked) { found[t] = "nav button not found"; continue; }
      await page.waitForTimeout(1100);
      const text = await page.evaluate(() => document.body.innerText);
      const hits = BAD.filter(re => re.test(text)).map(re => String(re) + " :: " + (text.match(re) || [])[0]);
      // context excerpt for any hit
      if (hits.length) {
        const m = text.match(BAD.find(re => re.test(text)));
        const i = text.indexOf(m[0]);
        hits.push("context: …" + text.slice(Math.max(0, i - 60), i + 60).replace(/\n/g, " ") + "…");
      }
      found[t] = hits;
      if (t === "More") { // close the drawer again
        await page.keyboard.press("Escape").catch(() => {});
      }
      // Home retention probe (once per width)
      if (t === "Home") {
        found.__retention = await page.evaluate(() => {
          const el = [...document.querySelectorAll("*")].find(e => e.children.length < 3 && /retention/i.test(e.innerText || "") && (e.innerText || "").length < 80);
          if (!el) return "no retention element rendered (acceptable for an empty org)";
          let card = el; for (let i = 0; i < 4 && card.parentElement; i++) card = card.parentElement;
          return card.innerText.replace(/\n/g, " | ").slice(0, 200);
        });
        // BUILD-76 follow-up — the Drifting section must RENDER on an empty
        // org, with an empty state that shows its work; and the goal banner's
        // At-risk tile must answer in words, never an em dash.
        found.__driftEmpty = await page.evaluate(() =>
          document.querySelector('[data-testid="drift-empty-state"]')?.innerText.replace(/\n/g, " | ") || "");
        found.__atRiskTile = await page.evaluate(() => {
          const label = [...document.querySelectorAll("div")].find(e => e.children.length === 0 && /^at risk$/i.test((e.innerText || "").trim()));
          return label && label.parentElement ? label.parentElement.innerText.replace(/\n/g, " | ") : "no at-risk tile rendered";
        });
      }
    }
    await page.close();
    return { found, pageErrors };
  }

  for (const [w, h, label] of [[1440, 900, "desktop"], [390, 844, "mobile"]]) {
    const { found, pageErrors } = await sweep(w, h, label);
    for (const [tab, hits] of Object.entries(found)) {
      if (tab.startsWith("__")) continue;   // probe payloads, asserted separately below
      if (hits === "nav button not found") { ok(`${label} ${tab}: navigable`, false, hits); continue; }
      ok(`${label} ${tab}: no NaN / Invalid Date / undefined / Infinity`, hits.length === 0, hits);
    }
    ok(`${label}: zero uncaught page errors across the sweep`, pageErrors.length === 0, pageErrors.slice(0, 4));
    // the retention card must not CLAIM a rate for an org with no history
    const ret = found.__retention || "";
    ok(`${label}: retention shows no fabricated rate for an empty org`, !/\b(100|0)\s*%/.test(ret) || /not enough|insufficient|no history|—/i.test(ret), ret);
    // BUILD-76 follow-up: the zero that shows its work (both defects were
    // "regardless of the data" — an absent section reads as a broken feature,
    // and a bare dash can't distinguish a healthy file from a failed import).
    const de = found.__driftEmpty || "";
    ok(`${label}: the Drifting section RENDERS on an empty org, and its empty state names what it checked`,
       /No donors/i.test(de) && /import|evaluate|checked/i.test(de), de.slice(0, 160) || "SECTION ABSENT");
    const at = found.__atRiskTile || "";
    ok(`${label}: the At-risk tile answers in words ("No donors drifting"), never an em dash`,
       /No donors drifting/i.test(at) && !at.includes("—"), at.slice(0, 120));
  }

  await browser.close();
  if (srv) srv.close();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
