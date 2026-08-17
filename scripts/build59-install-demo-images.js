// BUILD-59 — install the cleaned hero banners into the EXISTING prod demo orgs
// (not fresh orgs — build59-capture does that). GUARDED: loopback default; a
// prod run needs BASE=<prod> AND --i-know-this-is-prod. Every overwrite is
// backed up first (prodGuard.logOverwrite → docs/prod-write-backups/), and the
// replaced banner also lands in BUILD-56's 90-day soft-delete window with a
// pointer-history row — so this is fully reversible.
//
//   installation → CREO Arts (Demo)  — an arts org; students in a gallery, the
//                                      strongest image, focal on the group.
//   gallery      → Harbor Music (Demo) — a cultural interior, focal on the
//                                        large framed portrait (right).
//   church       → NOT installed: card/thumbnail-only + soft (upscaled), and
//                  the demo portals have no natural card slot; left as an
//                  available asset rather than forced into an odd content slot.
//
// Usage (prod):
//   BASE=https://nonprofit-erp-production.up.railway.app \
//   node scripts/build59-install-demo-images.js --i-know-this-is-prod
const fs = require("fs");
const path = require("path");
const { writerBase, isRemote, logOverwrite } = require("./lib/prodGuard");
const BASE = writerBase("http://localhost:5601");
const IMG_DIR = path.join(__dirname, "..", "tests", "fixtures", "portal-images");

function dataUri(file) {
  return `data:image/jpeg;base64,${fs.readFileSync(path.join(IMG_DIR, file)).toString("base64")}`;
}
async function api(method, p, token, body) {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = text; try { j = JSON.parse(text); } catch {}
  return { status: r.status, body: j };
}
async function login(email, password) {
  const r = await api("POST", "/auth/login", null, { email, password });
  if (!r.body?.token) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.token;
}

const TARGETS = [
  { name: "CREO Arts (Demo)", email: process.env.CREO_EMAIL || "admin@creoarts.org", password: process.env.CREO_PASSWORD || "demo1234", image: "installation-banner-3x1.jpg", focal: { x: 0.62, y: 0.68 } },
  { name: "Harbor Music School (Demo)", email: process.env.HARBOR_EMAIL || "xjca2006+b50demo@gmail.com", password: process.env.HARBOR_PASSWORD || "harbor-demo-2026", image: "gallery-banner-3x1.jpg", focal: { x: 0.78, y: 0.45 } },
];

(async () => {
  console.log(`Installing BUILD-59 demo banners → ${BASE}${isRemote(BASE) ? " (REMOTE)" : " (local)"}\n`);
  for (const t of TARGETS) {
    let token;
    try { token = await login(t.email, t.password); }
    catch (e) { console.error(`  SKIP ${t.name}: ${e.message}`); continue; }
    // back up current portal settings (header pointer + focal) before overwrite
    const before = (await api("GET", "/portal-settings", token)).body;
    logOverwrite(`portal-header-${t.name.replace(/\W+/g, "_")}`, {
      display_name: before?.display_name, header_image_url: before?.header_image_url,
      header_focal_x: before?.header_focal_x, header_focal_y: before?.header_focal_y,
    });
    const put = await api("PUT", "/portal-settings", token, {
      headerImageData: dataUri(t.image), headerFocalX: t.focal.x, headerFocalY: t.focal.y,
    });
    if (put.status !== 200) { console.error(`  FAIL ${t.name}: PUT ${put.status} ${JSON.stringify(put.body).slice(0, 200)}`); continue; }
    const after = (await api("GET", "/portal-settings", token)).body;
    console.log(`  OK   ${t.name}: header → ${after.header_image_url}  focal (${after.header_focal_x}, ${after.header_focal_y})`);
  }
  console.log("\nDone. Old banners are in the 90-day soft-delete window (scripts/restore-asset.js to undo).");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
