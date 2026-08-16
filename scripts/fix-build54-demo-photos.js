// BUILD-54 follow-up (2026-08-15) — replace placeholder impact "photos" with
// real photographs on an EXISTING org.
//
// Why: the BUILD-45 demo seed used flat-color <rect> SVGs as impact photos;
// on the donor page objectFit:cover crops the caption away and the "photo"
// renders as a solid brand-green/terracotta block (found live on prod
// org_creo). The seeds now use real committed photos (scripts/demo-assets/,
// provenance in its README.md), but seed-build45 is idempotent BY TITLE and
// never touches an existing update — this script repairs rows already seeded.
//
// What it does: for every impact update whose photos resolve to a single-rect
// SVG placeholder, re-PUT the update with the matching real photo. Dry-run by
// default; --apply to execute. Idempotent (real photos are never touched;
// re-running after apply finds nothing to do).
//
// Usage:
//   local : BASE=http://localhost:5601 node scripts/fix-build54-demo-photos.js --apply
//   prod  : BASE=https://nonprofit-erp-production.up.railway.app \
//           DEMO_EMAIL=admin@creoarts.org DEMO_PASSWORD=… \
//           node scripts/fix-build54-demo-photos.js --apply

const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE || "http://localhost:5601";
const EMAIL = process.env.DEMO_EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.DEMO_PASSWORD || "demo1234";
const APPLY = process.argv.includes("--apply");

const demoPhoto = (file) => "data:image/jpeg;base64," +
  fs.readFileSync(path.join(__dirname, "demo-assets", file)).toString("base64");

// Title keyword → committed real photo. Anything unmatched gets the studio shot.
const PHOTO_FOR = (title) =>
  /exhibition|scholar|student/i.test(title) ? "demo-impact-exhibition.jpg" : "demo-impact-studio.jpg";

async function api(method, p, token, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* raw */ }
  return { status: r.status, body: j };
}

// A placeholder is a tiny SVG whose content is just a <rect> fill (+ caption).
async function isPlaceholder(photoRef) {
  if (typeof photoRef !== "string") return false;
  if (photoRef.startsWith("data:image/svg+xml")) {
    const svg = Buffer.from(photoRef.split(",")[1] || "", "base64").toString("utf8");
    return svg.includes("<rect");
  }
  if (photoRef.startsWith("/portal-assets/")) {
    const r = await fetch(BASE + photoRef);
    if (!r.ok || !(r.headers.get("content-type") || "").includes("svg")) return false;
    const svg = await r.text();
    return svg.length < 2000 && svg.includes("<rect");
  }
  return false;
}

(async () => {
  console.log(`fix-build54-demo-photos → ${BASE}  ${APPLY ? "(APPLY)" : "(dry run — pass --apply to execute)"}\n`);
  const login = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  if (!login.body?.token) { console.error("login failed", login.body); process.exit(1); }
  const tok = login.body.token;

  const updates = (await api("GET", "/impact-updates", tok)).body || [];
  // A rebuilt scratch DB can leave an update pointing at a fund/campaign that
  // no longer exists — the PUT validator rejects dangling targets, so filter
  // them against the live sets (an update left with no valid target becomes
  // org-wide: this is demo repair, visibility > precision).
  const liveFunds = new Set(((await api("GET", "/finance/funds", tok)).body || []).map(f => f.id));
  const liveCamps = new Set(((await api("GET", "/fundraising/campaigns", tok)).body || []).map(c => c.id));
  const validTargets = (ts) => (Array.isArray(ts) ? ts : []).filter(t =>
    t && (t.kind === "fund" ? liveFunds.has(t.id) : t.kind === "campaign" ? liveCamps.has(t.id) : false));
  let fixed = 0, clean = 0;
  for (const u of updates) {
    const photos = Array.isArray(u.photos) ? u.photos : [];
    const flags = await Promise.all(photos.map(isPlaceholder));
    if (!flags.some(Boolean)) { clean++; continue; }
    const replacement = PHOTO_FOR(u.title || "");
    console.log(`placeholder photo: "${u.title}" → ${replacement}`);
    if (APPLY) {
      const targets = validTargets(u.targets);
      const dropped = (Array.isArray(u.targets) ? u.targets.length : 0) - targets.length;
      if (dropped) console.log(`  (dropping ${dropped} dangling target(s)${targets.length ? "" : " — now org-wide"})`);
      const put = await api("PUT", `/impact-updates/${u.id}`, tok, {
        title: u.title, body: u.body,
        photos: photos.map((p, i) => (flags[i] ? demoPhoto(replacement) : p)),
        targets, orgWide: !!u.org_wide || !!u.orgWide || targets.length === 0,
      });
      console.log(`  PUT /impact-updates/${u.id} → ${put.status}`);
      if (put.status !== 200) { console.error("  FAILED", put.body); process.exit(1); }
    }
    fixed++;
  }
  console.log(`\n${fixed} update(s) ${APPLY ? "fixed" : "would be fixed"}, ${clean} already clean.`);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
