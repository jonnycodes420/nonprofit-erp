// BUILD-59 — the portal banner, measured in a real browser at every
// breakpoint. Covers the image-system contracts that only a render can prove:
//
//   • CLS 0 — the banner reserves its space (aspect-ratio), so a slow image
//     never reflows the page. Measured with PerformanceObserver.
//   • FOCAL honored — the banner img's computed object-position equals the
//     org's normalized focal point (the students stay in frame).
//   • PREVIEW == RENDER — the crop is object-fit:cover into a FIXED ratio, so
//     it is identical at 390/1440/2560 (ratio-invariant); the editor preview
//     reuses the SAME ratio + bannerImgStyle (source-pinned below), so what the
//     org sets is what donors see, at every breakpoint.
//   • RESPONSIVE + LAZY — srcset carries the width ladder; the hero is eager.
//
// Browser suite: skips cleanly without Playwright / a localhost-API dist, and
// drives the app from :4173 (the API's CORS allowlist) like empty-states.

const { ok, summary, BASE } = require("./helpers");
const fs = require("fs");
const path = require("path");

const APP = process.env.APP_ORIGIN || "http://localhost:4173";
const PW = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(__dirname, "..", "client", "dist", "index.html");
const uniq = () => Math.random().toString(36).slice(2, 7);

function haveDeps() {
  try { require(path.join(PW, "node_modules", "playwright")); } catch { return false; }
  return fs.existsSync(DIST);
}

async function api(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  console.log("portal-visual (BUILD-59)");
  // Browser-suite skip convention (empty-states/presentation-wiring): the last
  // line MUST contain "0 failed" so run-all counts a clean skip as a pass.
  if (!haveDeps()) { console.log("  SKIP — no Playwright or client/dist (browser suite)\n\n0 passed, 0 failed (suite skipped)"); process.exit(0); }
  const { chromium } = require(path.join(PW, "node_modules", "playwright"));

  // seed a portal org with the installation header + a right-of-center focal
  const email = `b59vis-${uniq()}@test.local`;
  const reg = await api("POST", "/auth/register-org", null, { orgName: "Visual Test Org", userName: "A", email, password: "loadtest1234" });
  const tok = reg.body.token;
  await api("POST", "/onboarding/complete", tok, {});
  const imgPath = path.join(__dirname, "fixtures", "portal-images", "installation-banner-3x1.jpg");
  const dataUri = `data:image/jpeg;base64,${fs.readFileSync(imgPath).toString("base64")}`;
  const FX = 0.62, FY = 0.68;
  const put = await api("PUT", "/portal-settings", tok, { enabled: true, displayName: "Visual Test Org", primaryColor: "#b8593f", accentColor: "#c9a84c", headerImageData: dataUri, headerFocalX: FX, headerFocalY: FY });
  if (put.status !== 200) { console.error("seed failed", put.body); process.exit(1); }
  const slug = (await api("GET", "/portal-settings", tok)).body.org_slug;

  const browser = await chromium.launch();
  for (const w of [390, 1440, 2560]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    // arm the CLS observer before navigation
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`${APP}/portal/${slug}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForSelector("header img", { timeout: 10000 });
    await page.waitForTimeout(800);

    const info = await page.evaluate(() => {
      const img = document.querySelector("header img");
      const container = img?.parentElement;
      const cs = img ? getComputedStyle(img) : {};
      return {
        cls: window.__cls,
        objectFit: cs.objectFit,
        objectPosition: cs.objectPosition,
        aspectRatio: container ? getComputedStyle(container).aspectRatio : null,
        hasSrcset: !!img?.getAttribute("srcset"),
        srcsetWidths: (img?.getAttribute("srcset") || "").match(/w=\d+/g) || [],
        loading: img?.getAttribute("loading"),
        docWider: document.documentElement.scrollWidth > window.innerWidth + 1,
        naturalOk: img?.naturalWidth > 0,
      };
    });

    ok(`${w}: CLS ≈ 0 (${info.cls.toFixed(4)})`, info.cls < 0.01, { cls: info.cls });
    ok(`${w}: banner image loaded (not broken)`, info.naturalOk, null);
    ok(`${w}: object-fit is cover`, info.objectFit === "cover", info.objectFit);
    // computed object-position resolves the focal % — "62% 68%"
    ok(`${w}: object-position honors the focal point`, /62(\.\d+)?%\s+68(\.\d+)?%/.test(info.objectPosition), info.objectPosition);
    ok(`${w}: container carries a fixed aspect-ratio (ratio-invariant crop → preview==render)`, info.aspectRatio && info.aspectRatio.replace(/\s/g, "") === "1200/300" || info.aspectRatio === "4 / 1" || info.aspectRatio === "4", info.aspectRatio);
    ok(`${w}: srcset carries the width ladder`, info.hasSrcset && info.srcsetWidths.length >= 4, info.srcsetWidths);
    ok(`${w}: hero image is eager (preloaded, not lazy)`, info.loading === "eager", info.loading);
    ok(`${w}: no horizontal page scroll`, !info.docWider, null);
    await page.close();
  }
  await browser.close();

  // PREVIEW == RENDER, structurally: the editor crop preview reuses the SAME
  // ratio + the SAME img-style function as the live banner, so the crop it
  // shows is the crop donors get (the runtime ratio-invariance above proves
  // the crop doesn't change across breakpoints).
  console.log("\npreview == render (shared render, source-pinned)");
  const banner = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "PortalBanner.jsx"), "utf8");
  const portal = fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", "Portal.jsx"), "utf8");
  const editor = fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", "PortalEditor.jsx"), "utf8");
  ok("bannerImgStyle is the ONE object-fit/object-position source", /export function bannerImgStyle/.test(banner) && /objectPosition: focalPosition/.test(banner), null);
  ok("live banner renders via PortalBanner (which uses bannerImgStyle)", /PortalBanner[\s\S]{0,400}ratio=\{PORTAL_HEADER_RATIO\}/.test(portal), null);
  ok("editor preview uses the SAME ratio (PORTAL_HEADER_RATIO)", /PortalBannerPreview[\s\S]{0,300}ratio=\{PORTAL_HEADER_RATIO\}/.test(editor), null);
  ok("PortalBannerPreview reuses bannerImgStyle (identical crop math)", /bannerImgStyle\(\{ x: fx, y: fy \}\)/.test(banner), null);

  summary();
})().catch(e => { console.error(e); process.exit(1); });
