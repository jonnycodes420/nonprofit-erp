// BUILD-59 — portal visual pass: seed two themed local orgs with the cleaned
// images (installation → hero, gallery → hero, church → card only), set focal
// points, and capture every portal surface at 390/1440/2560 into docs/build59/.
// LOOPBACK ONLY (guarded): writes go to the local scratch stack via the app's
// own API; --i-know-this-is-prod would be required for a non-loopback BASE.
const path = require("path");
const fs = require("fs");
const { writerBase } = require("./lib/prodGuard");
const BASE = writerBase("http://localhost:5601");
const APP = process.env.APP || "http://localhost:4173";
const IMG_DIR = process.env.IMG_DIR || "/Users/jonathanatkinson/Downloads/steward-portal-images-cleaned";
const OUT = path.join(__dirname, "..", "docs", "build59");
const PHASE = process.env.PHASE || "after"; // "before" | "after"

const uniq = () => Math.random().toString(36).slice(2, 7);
function dataUri(file) {
  const b = fs.readFileSync(path.join(IMG_DIR, file));
  return `data:image/jpeg;base64,${b.toString("base64")}`;
}
async function api(method, p, token, body) {
  const r = await fetch(BASE + p, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text(); let j = text; try { j = JSON.parse(text); } catch {}
  return { status: r.status, body: j };
}

// The two demo orgs — terracotta (CREO-like arts) + blue (Harbor-like music) —
// so the white-label theming is visible in both directions.
const ORGS = [
  { key: "arts",  name: "Creekside Arts Collective", primary: "#b8593f", accent: "#c9a84c", header: "installation-banner-3x1.jpg", focal: { x: 0.62, y: 0.68 }, card: "church-card-16x9.jpg" },
  { key: "music", name: "Harbor Music School",       primary: "#33538a", accent: "#c9a84c", header: "gallery-banner-3x1.jpg",       focal: { x: 0.78, y: 0.45 }, card: "installation-card-16x9.jpg" },
];

async function seedOrg(o) {
  const email = `b59-${o.key}-${uniq()}@test.local`;
  const reg = await api("POST", "/auth/register-org", null, { orgName: o.name, userName: "Admin", email, password: "loadtest1234" });
  const tok = reg.body.token, orgId = reg.body.org.id;
  await api("POST", "/onboarding/complete", tok, {});
  // enable portal + theme + header image + focal
  const put = await api("PUT", "/portal-settings", tok, {
    enabled: true,
    displayName: o.name,
    primaryColor: o.primary,
    accentColor: o.accent,
    footerText: `${o.name} is a registered 501(c)(3). Your gift is tax-deductible.`,
    einLine: "EIN 00-0000000",
    contactEmail: `hello@${o.key}.org`,
    headerImageData: PHASE === "after" ? dataUri(o.header) : dataUri(o.header),
    headerFocalX: PHASE === "after" ? o.focal.x : 0.5,
    headerFocalY: PHASE === "after" ? o.focal.y : 0.5,
  });
  if (put.status !== 200) throw new Error(`portal-settings PUT failed for ${o.key}: ${JSON.stringify(put.body).slice(0, 200)}`);
  const [ps] = (await api("GET", "/portal-settings", tok)).body ? [ (await api("GET", "/portal-settings", tok)).body ] : [null];
  const slug = ps?.org_slug;
  return { orgId, tok, slug, o };
}

(async () => {
  const { chromium } = require(path.join(process.env.HOME, "steward-qa", "node_modules", "playwright"));
  fs.mkdirSync(path.join(OUT, PHASE), { recursive: true });
  const seeded = [];
  for (const o of ORGS) seeded.push(await seedOrg(o));
  console.log("seeded:", seeded.map(s => `${s.o.key}=${s.slug}`).join("  "));

  const browser = await chromium.launch();
  const widths = [390, 1440, 2560];
  let shots = 0;
  for (const s of seeded) {
    for (const w of widths) {
      const page = await browser.newPage({ viewport: { width: w, height: Math.round(w * 0.7) }, deviceScaleFactor: w === 390 ? 2 : 1 });
      await page.goto(`${APP}/portal/${s.slug}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1200);
      const f = path.join(OUT, PHASE, `${s.o.key}-${w}.png`);
      await page.screenshot({ path: f, fullPage: false });
      shots++;
      await page.close();
    }
  }
  await browser.close();
  console.log(`${PHASE}: ${shots} screenshots → ${path.join(OUT, PHASE)}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
