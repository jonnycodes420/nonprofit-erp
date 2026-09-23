// BUILD-99 — A TOUCHPOINT YOU CANNOT READ IS NOT A RECORD.
//
// The grant profile's Activity Timeline rendered a logged meeting in ink on
// the rail's dark green. The note was on the screen the whole time and could
// not be read: "Meeting · Looks good!" was almost exactly the colour of the
// panel behind it.
//
// The cause is worth naming, because nothing in the suite could see it.
// TouchpointTimeline is the DONOR profile's component — it draws in T.ink for
// the note and T.ink3 for the date, which is correct on the light surface it
// was written for. Grants.jsx reused it, correctly, and dropped it onto a dark
// rail. Every server assertion about grant interactions was green; the rows
// were in the DOM with the right text; only a human looking at it could tell.
//
// So this suite measures CONTRAST in a browser, which is the only place the
// defect exists.

const fs = require("fs"), path = require("path");
const { BASE, ok, summary, q, closeDb } = require("./helpers");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(__dirname, "..", "client", "dist", "index.html");
const haveDeps = () => { try { require(path.join(PW, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };

const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
const parseRgb = s => (String(s).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

(async () => {
  console.log("build99-grant-timeline");

  // ── §1 · THE COMPONENT IS A LIGHT-SURFACE COMPONENT ──────────────────────
  const shared = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "shared.jsx"), "utf8");
  const tl = shared.slice(shared.indexOf("export function TouchpointTimeline("), shared.indexOf("export function", shared.indexOf("export function TouchpointTimeline(") + 40));
  ok("TouchpointTimeline draws its note in ink (so it NEEDS a light surface)",
    /color:T\.ink\b/.test(tl) && /color:T\.ink3/.test(tl), null);

  const grants = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "Grants.jsx"), "utf8");
  const idx = grants.indexOf("<TouchpointTimeline");
  ok("the grant profile renders the timeline", idx > -1, null);
  // The 400 characters before it must establish a light background.
  ok("…on an explicitly LIGHT surface, not the dark rail",
    /background:\s*T\.white/.test(grants.slice(Math.max(0, idx - 400), idx)), grants.slice(Math.max(0, idx - 200), idx).slice(-160));

  // ── §2 · MEASURED, IN A BROWSER ──────────────────────────────────────────
  if (!haveDeps()) {
    console.log("\n  SKIP — no Playwright or client/dist (browser leg)");
    await closeDb(); summary(); return;
  }
  console.log("\n— §2 · the logged meeting is legible where it is drawn —");
  const [g] = await q(`SELECT id FROM grants WHERE org_id='org_creo' ORDER BY id LIMIT 1`);
  await q(`INSERT INTO grant_interactions (id,org_id,grant_id,type,note,date)
           VALUES ('gi_b99','org_creo',$1,'meeting','Looks good! Sarah confirmed the final report format.',$2)
           ON CONFLICT (id) DO NOTHING`, [g.id, new Date().toISOString().slice(0, 10)]);

  const { chromium } = require(path.join(PW, "node_modules", "playwright"));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const lr = await page.request.post(BASE + "/auth/login", { data: { email: "admin@creoarts.org", password: "demo1234" } });
  const lj = await lr.json();
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.evaluate(d => { localStorage.setItem("npe_token", d.token); localStorage.setItem("npe_user", JSON.stringify(d.user)); localStorage.setItem("npe_org", JSON.stringify(d.org)); }, lj);
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const more = page.locator("text=MORE").first();
  if (await more.count()) { await more.click().catch(() => {}); await page.waitForTimeout(400); }
  await page.locator('button:has-text("Grants")').first().click();
  await page.waitForTimeout(1800);
  const card = page.locator("text=NEA").first();
  if (await card.count()) { await card.click(); await page.waitForTimeout(1600); }

  // Walk up from the text to the first ancestor that actually paints.
  const probe = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")]
      .find(d => d.children.length === 0 && /Looks good!/.test(d.textContent || ""));
    if (!el) return null;
    const painted = (n) => { for (let p = n; p; p = p.parentElement) {
      const bg = getComputedStyle(p).backgroundColor;
      if (bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg)) return bg; } return null; };
    return { fg: getComputedStyle(el).color, bg: painted(el), text: el.textContent.slice(0, 60) };
  });
  ok("the logged meeting is on the page", !!probe, probe);
  if (probe) {
    const cr = ratio(parseRgb(probe.fg), parseRgb(probe.bg));
    // 4.5:1 is AA for body text. The defect measured about 1.3:1.
    ok(`the meeting note clears AA against what is behind it (${cr.toFixed(2)}:1)`, cr >= 4.5,
      { fg: probe.fg, bg: probe.bg, ratio: Number(cr.toFixed(2)) });
  }
  await browser.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
