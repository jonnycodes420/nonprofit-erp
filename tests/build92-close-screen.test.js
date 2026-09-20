// BUILD-92 B1 — THE CLOSE LINK SCREEN. Run: node tests/build92-close-screen.test.js
//
// BUILD-90 shipped POST/GET /admin/close-links and no way to reach them: the
// close was still a curl in a terminal, in a room, in front of a customer.
// This suite holds the screen that fixes that to the two things it must do.
//
//   §1  THE SOURCE. The screen exists on the super-admin console, it reads the
//       plans from the server rather than hardcoding three prices a second
//       time, and nothing it renders carries an em dash.
//   §2  NOT READY NAMES THE MISSING PIECE. A close link refuses to mint
//       without a Stripe price that is configured AND correct — BUILD-90
//       proved "configured" is not "correct". The screen must say which env
//       var, and which two numbers disagree, BEFORE the button is pressed.
//   §3  READY CREATES AND SHOWS A COPYABLE LINK, with the first charge date
//       written in words.
//
// §2 and §3 run in a real browser against the local dist (the same skip
// convention every browser suite here uses: no Playwright, no dist built
// against this API, or nothing serving the app port → SKIP, never a false
// pass). The app origin is APP_URL (default :4173) because the API's CORS
// allowlist must contain whatever origin the preview is on.
//
// Prereqs: the run-all.sh server recipe. This suite binds BILLING_MOCK_PORT
// itself (like close-link.test.js) and MOVES the price Stripe reports, which
// is how the not-ready state is made reachable at all.

const fs = require("fs");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, q, closeDb, BILLING_MOCK_PORT } = require("./helpers");

const root = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const ORG = "org_b92_close", SUPER = "b92super@example.org";
const NEW_ED = "ed-b92close@example.org";

// The rendered strings of a JSX chunk: what a human would actually read.
// Comments are stripped first — a comment is not a screen.
function renderedText(src) {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out = [];
  for (const m of noComments.matchAll(/>([^<>{}]{4,})</g)) out.push(m[1]);
  for (const m of noComments.matchAll(/["'`]([^"'`\n]{12,})["'`]/g)) out.push(m[1]);
  return out.map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}
function chunk(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) return "";
  const b = endMarker ? src.indexOf(endMarker, a) : -1;
  return b > a ? src.slice(a, b) : src.slice(a);
}

// ── the platform-billing Stripe mock (same seam as close-link.test.js) ─────
// PRICES is deliberately mutable: §2 needs Stripe to hold an amount that
// disagrees with the plan, which is exactly the production condition BUILD-90
// found, and the only way the not-ready state is reachable.
let PRICES = {
  price_test_founding: { unit_amount: 19900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
  price_test_core:     { unit_amount: 24900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
  price_test_team:     { unit_amount: 49900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
};
let sessions = 0;
function startBillingMock(port = BILLING_MOCK_PORT) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.method === "POST" && req.url.startsWith("/v1/checkout/sessions")) {
          const id = "cs_test_b92_" + (++sessions);
          return res.end(JSON.stringify({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id }));
        }
        const price = req.url.match(/^\/v1\/prices\/([^/?]+)/);
        if (req.method === "GET" && price) {
          const p = PRICES[price[1]];
          if (!p) { res.statusCode = 404; return res.end(JSON.stringify({ error: { code: "resource_missing", message: "No such price: " + price[1], param: "price" } })); }
          return res.end(JSON.stringify({ id: price[1], object: "price", ...p }));
        }
        if (req.method === "POST" && req.url.startsWith("/v1/customers")) return res.end(JSON.stringify({ id: "cus_b92", object: "customer" }));
        res.statusCode = 404; res.end(JSON.stringify({ error: { message: "mock: " + req.method + " " + req.url } }));
      });
    });
    srv.on("error", reject);
    srv.listen(port, () => resolve(srv));
  });
}

async function reset() {
  const made = await q(`SELECT org_id FROM close_links WHERE contact_email LIKE '%b92close@example.org'`).catch(() => []);
  for (const r of made) if (r.org_id) {
    await q(`DELETE FROM users WHERE org_id=$1`, [r.org_id]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [r.org_id]).catch(() => {});
  }
  await q(`DELETE FROM close_links WHERE contact_email LIKE '%b92close@example.org'`).catch(() => {});
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  // ══ §1 · THE SCREEN IS THERE, AND IT DOES NOT RESTATE THE PRICES ═════════
  console.log("— §1 · the screen, in source —");
  const admin = read("client/src/pages/AdminDashboard.jsx");
  const section = chunk(admin, "// ── BUILD-92 B1 · THE CLOSE LINK SCREEN", "export default function AdminDashboard()");
  ok("the close-link screen exists on the super-admin console", section.length > 1500, section.length);
  ok("it is reachable from the console's navigation",
     /id:\s*"close"/.test(admin) && /page === "close"\s*&&\s*<CloseDeal/.test(admin));
  ok("it calls both BUILD-90 routes", /closeFetch\("\/admin\/close-links"\)/.test(section) && /"\/admin\/close-links",\s*\{\s*\n?\s*method: "POST"/.test(section));

  const text = renderedText(section);
  ok("there is copy to read", text.length > 6, text.length);
  ok("no em dash reaches the screen", text.filter(t => t.includes("—")).length === 0,
     text.filter(t => t.includes("—")));
  // THE PRICES ARE THE SERVER'S. closeLink.js is the source of truth for
  // 199/249/499; a screen that writes them again is a fourth place to be wrong.
  ok("the three prices are not restated in the client",
     !/\b(199|249|499)\b/.test(section.replace(/^\s*\/\/.*$/gm, "")), (section.match(/\b(199|249|499)\b/g) || []).slice(0, 4));

  // ══ the fixture ══════════════════════════════════════════════════════════
  const mockSrv = await startBillingMock().catch(e => { console.log("  note  billing mock could not bind :" + BILLING_MOCK_PORT + " (" + e.code + ")"); return null; });
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'B92 HQ','b92-hq',1,'active','team')`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_b92_super',$1,$2,$3,'Jonathan','admin',true)`, [ORG, SUPER, hash]);
  const token = await login(SUPER);
  const auth = { token, user: { id: "u_b92_super", email: SUPER, name: "Jonathan", role: "admin", isSuperAdmin: true }, org: { id: ORG, name: "B92 HQ", plan: "team" } };

  // ══ §2 + §3 · IN A BROWSER ═══════════════════════════════════════════════
  console.log("\n— §2 · not ready names the missing piece; §3 · ready mints a link —");
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
    catch { return note(`nothing serving ${APP} (set APP_URL; the API's CORS allowlist must contain that origin)`); }
    if (!mockSrv) return note("the billing mock port was already bound");

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errs = [];
      page.on("pageerror", e => errs.push("pageerror: " + e.message));

      const openScreen = async () => {
        await page.goto(APP + "/", { waitUntil: "domcontentloaded" });
        await page.evaluate(a => {
          localStorage.setItem("npe_token", a.token);
          localStorage.setItem("npe_user", JSON.stringify(a.user));
          localStorage.setItem("npe_org", JSON.stringify(a.org));
        }, auth);
        await page.goto(APP + "/admin", { waitUntil: "networkidle" });
        await page.click('button:has-text("Close a deal")');
        await page.waitForSelector('[data-testid="cl-create"]', { timeout: 8000 });
        await page.waitForTimeout(400);
      };

      // ── §2 · Stripe holds an amount that is NOT the plan's ───────────────
      PRICES.price_test_founding = { unit_amount: 9900, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
      await openScreen();
      await page.click('[data-testid="cl-plan-founding"]');
      await page.waitForTimeout(250);
      const notReady = await page.evaluate(() => ({
        blocker: document.querySelector('[data-testid="cl-blocker"]')?.innerText || "",
        createDisabled: !!document.querySelector('[data-testid="cl-create"]')?.disabled,
        boundary: /Something went wrong|Try reloading/i.test(document.body.innerText),
      }));
      ok("the screen renders rather than landing in an error boundary", notReady.boundary === false);
      ok("a plan Stripe disagrees with is shown as NOT ready, with a sentence", notReady.blocker.length > 30, notReady.blocker.slice(0, 160));
      ok("...and the sentence names the env var that has to change",
         /STRIPE_PRICE_FOUNDING/.test(notReady.blocker), notReady.blocker.slice(0, 160));
      ok("...and names BOTH numbers, what Stripe holds and what the plan is",
         /\$99\.00/.test(notReady.blocker) && /\$199/.test(notReady.blocker), notReady.blocker.slice(0, 200));
      ok("...and the button cannot be pressed while it is not ready", notReady.createDisabled === true);

      // A plan Stripe has never heard of: configured, unreadable, still named.
      PRICES = { ...PRICES }; delete PRICES.price_test_core;
      await openScreen();
      await page.click('[data-testid="cl-plan-core"]');
      await page.waitForTimeout(250);
      const unreadable = await page.evaluate(() => document.querySelector('[data-testid="cl-blocker"]')?.innerText || "");
      ok("an unreadable price id is named too, by its env var",
         /STRIPE_PRICE_CORE/.test(unreadable), unreadable.slice(0, 160));

      // ── §3 · every price correct: it mints, and shows a copyable link ────
      PRICES = {
        price_test_founding: { unit_amount: 19900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
        price_test_core:     { unit_amount: 24900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
        price_test_team:     { unit_amount: 49900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
      };
      await openScreen();
      const noBlocker = await page.evaluate(() => !document.querySelector('[data-testid="cl-blocker"]'));
      ok("with Stripe and the plan agreeing there is nothing in the way", noBlocker === true);

      await page.fill('[data-testid="cl-orgname"]', "Sparrow House");
      await page.fill('[data-testid="cl-email"]', NEW_ED);
      await page.click('[data-testid="cl-plan-core"]');
      await page.waitForTimeout(150);
      await page.click('[data-testid="cl-create"]');
      await page.waitForSelector('[data-testid="cl-link"]', { timeout: 10000 });

      const made = await page.evaluate(() => ({
        url: document.querySelector('[data-testid="cl-link"]')?.value || "",
        charge: document.querySelector('[data-testid="cl-first-charge"]')?.innerText || "",
        copy: document.querySelector('[data-testid="cl-copy"]')?.innerText || "",
      }));
      ok("a Checkout link is on the screen", /^https:\/\/checkout\.stripe\.test\/cs_test_b92_/.test(made.url), made.url);
      ok("it is in a field that can be copied, with a Copy button", made.copy.trim() === "Copy", made.copy);
      // THE DATE IN WORDS. "October 20, 2026", never 2026-10-20, and the plan's
      // money beside it — the sentence closeLink.js composes for Checkout.
      ok("the first charge is written in words, with the amount",
         /first charge is \$249 on [A-Z][a-z]+ \d{1,2}, \d{4}\./.test(made.charge), made.charge);
      ok("...and it says nothing is charged today",
         /Cancel any time before then and you pay nothing/.test(made.charge), made.charge);

      await page.click('[data-testid="cl-copy"]');
      await page.waitForTimeout(200);
      const copied = await page.evaluate(() => document.querySelector('[data-testid="cl-copy"]')?.innerText || "");
      ok("pressing Copy says so", copied.trim() === "Copied", copied);

      const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="cl-row"]')].map(r => r.innerText));
      ok("the link joins the list of what has been handed out",
         rows.some(r => /Sparrow House/.test(r)), rows.slice(0, 2));

      ok("no page error anywhere in the flow", errs.length === 0, errs.slice(0, 3));

      // The row really exists server-side, not only on the screen.
      const row = await q(`SELECT org_name, plan, status FROM close_links WHERE contact_email=$1`, [NEW_ED]);
      ok("and the server holds it", row.length === 1 && row[0].org_name === "Sparrow House" && row[0].plan === "core", row);
    } finally { await browser.close(); }
  })();

  if (mockSrv) mockSrv.close();
  await reset();
  await closeDb();
  summary();
})();
