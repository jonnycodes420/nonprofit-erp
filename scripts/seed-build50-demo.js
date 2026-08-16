#!/usr/bin/env node
// BUILD-50 Part C — demo data for the PRIMARY account (xjca2006@gmail.com),
// so both consumer-dashboard states are viewable signed in as Jonathan:
//
//   • org_creo (CREO Arts, the standing demo org): a realistic mid-level
//     donor record for xjca2006@gmail.com — five gifts across five years
//     through the NORMAL gift-create path with idempotency keys (never
//     direct DB writes), one designated to a fund carrying an impact
//     update, receipts issued on the two most recent gifts. Also seeds the
//     org's portal THEME assets (header image + logo + colors) if missing —
//     BUILD-50 made the header image load-bearing for the takeover banner.
//   • a SECOND demo org ("Harbor Music School (Demo)" staff-side; clean
//     display name donor-side per the org_creo demo convention) with a
//     distinct theme and 2–3 gifts under the same address — the only way to
//     actually see the multi-org neutral shell with real data.
//
// Everything stays inside demo orgs. The second org carries NO legal/tax
// identity (no EIN, no receipt address — receipts stay off there), and its
// directory description says "demo" out loud.
//
// Idempotent: donors are found-by-email before creating; every gift carries
// a stable idempotencyKey (a replay returns the original gift, zero side
// effects); receipts are one-per-gift by construction; portal-settings is
// PATCH-semantics.
//
// PROD is the default target (this seed exists so the live dashboard can be
// judged). The consumer-account signup+verify step is deliberately NOT here —
// it needs the email token from the inbox; run it once by hand (or via the
// operator) after this seed: sign up at https://www.stewardapp.dev/giving
// with xjca2006@gmail.com, click the verify link, and both orgs link
// automatically.
//
//   node scripts/seed-build50-demo.js                      # scratch stack
//   BASE=https://nonprofit-erp-production.up.railway.app \
//     node scripts/seed-build50-demo.js                    # prod (explicit opt-in)
//
// DEFAULT IS LOCALHOST — this script used to default to PROD, the only seed
// that did, and a bare run meant to seed the local capture fixture silently
// re-PUT the prod theme (overwrote the real banner with the SVG placeholder
// band, 2026-08-15 — restored from saved bytes). Prod is ALWAYS an explicit
// BASE=, on every seed. Pinned by tests/demo-content.test.js.
const BASE = process.env.BASE || "http://localhost:5601";
const CREO_EMAIL = process.env.CREO_EMAIL || "admin@creoarts.org";
const CREO_PASSWORD = process.env.CREO_PASSWORD || "demo1234";
const DEMO2_EMAIL = process.env.DEMO2_EMAIL || "xjca2006+b50demo@gmail.com";
const DEMO2_PASSWORD = process.env.DEMO2_PASSWORD || "harbor-demo-2026";
const DONOR_EMAIL = "xjca2006@gmail.com";
const DONOR_NAME = "Jonathan Atkinson";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  OK   " + n); } else { fail++; console.log("  FAIL " + n, d ?? ""); } };

const j = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null; try { parsed = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body: parsed };
};

const svgBand = (bg, fg) => "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><rect width="1200" height="300" fill="${bg}"/>` +
  `<circle cx="220" cy="150" r="90" fill="${fg}" opacity="0.35"/><circle cx="520" cy="90" r="55" fill="${fg}" opacity="0.25"/>` +
  `<circle cx="880" cy="200" r="120" fill="${fg}" opacity="0.3"/><circle cx="1120" cy="70" r="40" fill="${fg}" opacity="0.2"/></svg>`
).toString("base64");
const svgLogo = (bg, letter) => "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="18" fill="${bg}"/>` +
  `<text x="48" y="64" font-family="Georgia,serif" font-size="52" fill="#ffffff" text-anchor="middle">${letter}</text></svg>`
).toString("base64");
// Impact PHOTOS must be real photographs (scripts/demo-assets/, provenance in
// its README.md) — a flat SVG "photo" renders as a solid color block on the
// donor page (BUILD-54 follow-up, 2026-08-15). svgBand/svgLogo above stay:
// a designed band/monogram is a legitimate theme FALLBACK, not a photo.
const realPhoto = (file) => "data:image/jpeg;base64," +
  require("fs").readFileSync(require("path").join(__dirname, "demo-assets", file)).toString("base64");

async function findOrCreateDonor(token) {
  const list = await j("GET", `/donors?search=${encodeURIComponent(DONOR_EMAIL)}&limit=10`, null, token);
  const rows = Array.isArray(list.body) ? list.body : (list.body?.donors || []);
  const hit = rows.find(d => (d.email || "").toLowerCase() === DONOR_EMAIL);
  if (hit) { console.log(`  found existing donor ${hit.id}`); return hit.id; }
  const made = await j("POST", "/donors", { name: DONOR_NAME, email: DONOR_EMAIL, status: "mid", notes: "BUILD-50 demo seed — Jonathan's primary-address demo profile." }, token);
  ok("donor created", made.status === 200 || made.status === 201, made.body);
  return made.body?.id || made.body?.donor?.id;
}

async function seedGifts(token, donorId, gifts) {
  const out = [];
  for (const g of gifts) {
    const r = await j("POST", `/donors/${donorId}/gifts`, { ...g.body, idempotencyKey: g.key }, token);
    const gid = r.body?.id || r.body?.gift?.id;
    ok(`gift ${g.key} (${r.body?.duplicate ? "already seeded" : "created"})`, (r.status === 200 || r.status === 201) && !!gid, r.body);
    out.push(gid);
  }
  return out;
}

(async () => {
  console.log(`BUILD-50 demo seed → ${BASE}\n`);

  // ── 1. CREO Arts — theme assets + Jonathan's donor record ────────────────
  const creo = await j("POST", "/auth/login", { email: CREO_EMAIL, password: CREO_PASSWORD });
  ok("creo admin login", !!creo.body?.token, creo.body);
  const ct = creo.body.token;

  // Theme: the BUILD-50 takeover opens with the header image as a banner —
  // seed the demo assets when they're missing so the state is visible.
  const themePut = await j("PUT", "/portal-settings", {
    headerImageData: svgBand("#8a4a2c", "#e7cf91"),
    logoData: svgLogo("#8a4a2c", "C"),
    primaryColor: "#8a4a2c", accentColor: "#c9a84c", buttonColor: "#8a4a2c",
    backgroundTint: "#faf5ec", typePairing: "editorial", cardStyle: "soft-shadow",
  }, ct);
  ok("creo portal theme (banner + logo + colors) saved", themePut.status === 200, themePut.body);

  const donorId = await findOrCreateDonor(ct);
  ok("creo donor id resolved", !!donorId);

  // Fund designation: use a fund an impact update targets (creating the
  // update if the org has none), so the takeover shows a MATCHED update.
  const funds = await j("GET", "/finance/funds", null, ct);
  const fundRows = Array.isArray(funds.body) ? funds.body : (funds.body?.funds || []);
  ok("creo has funds", fundRows.length > 0, funds.body);
  const updates = await j("GET", "/impact-updates", null, ct);
  const upRows = Array.isArray(updates.body) ? updates.body : (updates.body?.updates || []);
  let targetFund = null;
  for (const u of upRows) {
    const t = (Array.isArray(u.targets) ? u.targets : []).find(x => x.kind === "fund");
    if (t && fundRows.some(f => f.id === t.id)) { targetFund = t.id; break; }
  }
  if (!targetFund) {
    targetFund = fundRows[0].id;
    const mk = await j("POST", "/impact-updates", {
      title: "Summer studio scholarships — 22 students",
      body: "Your giving covered a full summer of studio time, materials included, for twenty-two students who could not otherwise afford it.",
      photos: [realPhoto("demo-impact-studio.jpg"), realPhoto("demo-impact-exhibition.jpg")],
      targets: [{ kind: "fund", id: targetFund }],
      orgWide: false, status: "published",
    }, ct);
    ok("creo targeted impact update created", mk.status === 200 || mk.status === 201, mk.body);
  } else {
    console.log(`  reusing impact-update fund target ${targetFund}`);
  }

  const y = new Date().getFullYear();
  const giftIds = await seedGifts(ct, donorId, [
    { key: "b50-jon-creo-1", body: { amount: 150, date: `${y - 4}-11-15`, type: "cash", notes: "BUILD-50 demo seed" } },
    { key: "b50-jon-creo-2", body: { amount: 200, date: `${y - 3}-12-10`, type: "cash", notes: "BUILD-50 demo seed" } },
    { key: "b50-jon-creo-3", body: { amount: 250, date: `${y - 2}-06-20`, type: "cash", notes: "BUILD-50 demo seed" } },
    { key: "b50-jon-creo-4", body: { amount: 300, date: `${y - 1}-12-05`, type: "cash", fundId: targetFund, notes: "BUILD-50 demo seed — designated" } },
    { key: "b50-jon-creo-5", body: { amount: 400, date: `${y}-03-14`, type: "cash", notes: "BUILD-50 demo seed" } },
  ]);
  // Receipts on the two most recent gifts (idempotent — an active receipt per
  // gift is unique by construction; a rerun returns the existing one).
  for (const gid of giftIds.slice(-2).filter(Boolean)) {
    const r = await j("POST", `/gifts/${gid}/receipt`, {}, ct);
    ok(`receipt on ${gid}`, r.status === 200 || r.status === 201, r.body);
  }

  // ── 2. Second demo org — Harbor Music School (Demo) ──────────────────────
  let h = await j("POST", "/auth/login", { email: DEMO2_EMAIL, password: DEMO2_PASSWORD });
  if (h.status !== 200) {
    h = await j("POST", "/auth/register-org", { orgName: "Harbor Music School (Demo)", userName: DONOR_NAME, email: DEMO2_EMAIL, password: DEMO2_PASSWORD });
    ok("second demo org registered", !!h.body?.token, h.body);
  } else {
    console.log("  second demo org already exists — logging in");
  }
  const ht = h.body.token;
  await j("POST", "/onboarding/complete", {}, ht); // chart of accounts (gift→ledger stamp needs '4010')
  const hTheme = await j("PUT", "/portal-settings", {
    enabled: true, networkListed: true, displayName: "Harbor Music School",
    primaryColor: "#33538a", accentColor: "#33538a", buttonColor: "#33538a",
    typePairing: "classic", cardStyle: "square",
    headerImageData: svgBand("#33538a", "#dfe8e2"), logoData: svgLogo("#33538a", "H"),
    footerText: "Harbor Music School — a Steward product demo organization.",
    directoryDescription: "Demo organization — Steward product demo",
    directoryCity: "Fairhope", directoryState: "AL",
  }, ht);
  ok("harbor portal theme + listing saved", hTheme.status === 200, hTheme.body);
  const hUpdate = await j("POST", "/impact-updates", {
    title: "Spring recital — 60 students on stage",
    body: "Every scholarship student performed this spring. Thank you for keeping lessons within reach.",
    photos: [realPhoto("demo-hero-choir.jpg")],
    targets: [], orgWide: true, status: "published",
  }, ht);
  ok("harbor org-wide impact update", hUpdate.status === 200 || hUpdate.status === 201 || hUpdate.body?.error === undefined, hUpdate.body);
  const hDonor = await findOrCreateDonor(ht);
  ok("harbor donor id resolved", !!hDonor);
  await seedGifts(ht, hDonor, [
    { key: "b50-jon-harbor-1", body: { amount: 75, date: `${y - 1}-05-11`, type: "cash", notes: "BUILD-50 demo seed" } },
    { key: "b50-jon-harbor-2", body: { amount: 120, date: `${y - 1}-11-30`, type: "cash", notes: "BUILD-50 demo seed" } },
    { key: "b50-jon-harbor-3", body: { amount: 90, date: `${y}-04-18`, type: "cash", notes: "BUILD-50 demo seed" } },
  ]);

  console.log(`\n${pass} ok, ${fail} failed`);
  console.log(`
Next (one-time, needs the inbox):
  1. Go to https://www.stewardapp.dev/giving → Create your free account
     with ${DONOR_EMAIL}.
  2. Click the verification link in the email — both demo orgs link
     automatically (verified-email match).
  3. Two linked orgs → the MULTI-ORG neutral shell. To see the single-org
     TAKEOVER on this account: Account tab → Hide one org (Show again to
     return). Renee (xjca2006+demo@gmail.com) remains the standing
     single-org linked takeover.`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
