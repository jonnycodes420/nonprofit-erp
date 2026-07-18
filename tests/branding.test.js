// BUILD-13 Part 2 — Org branding suite.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// Covers: contrast math + accent normalization (a bad/illegible color is
// CONSTRAINED into the accessible range, never shipped raw — WCAG AA on both
// text-on-accent and accent-on-cream), the write route's org-scoping +
// requireAdmin + checkWriteAccess gating, logo validation + storage/retrieval,
// and org isolation.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { normalizeAccent, contrast, accentPasses, CREAM, WHITE, INK } = require("../branding");

const A = "org_brand_a", B = "org_brand_b", RO = "org_brand_ro";
// A 1x1 transparent PNG data-URI (valid image, tiny).
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

async function reset() {
  for (const org of [A, B, RO]) {
    await q(`DELETE FROM users WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag, { role = "admin", sub = "active" } = {}) {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,'growth')`,
    [o, `Brand ${tag}`, `brand-${tag}`, sub]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
    [`u_${o}`, o, `${tag}@brand.local`, hash, `User ${tag}`, role]);
}

(async () => {
  await reset();
  await seedOrg(A, "a");
  await seedOrg(B, "b");
  await seedOrg(RO, "ro", { sub: "trial_expired" });
  // A second, staff (non-admin) user in org A to prove requireAdmin.
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_brand_a_staff',$1,'staff@brand.local',$2,'Staff A','staff')`, [A, hash]);

  // ── Pure contrast / normalization (no server) ─────────────────────────────
  ok("contrast(white, black) ≈ 21", Math.round(contrast(WHITE, "#000000")) === 21);
  ok("contrast is symmetric", contrast("#1a6b4a", CREAM).toFixed(3) === contrast(CREAM, "#1a6b4a").toFixed(3));
  ok("malformed hex → null", normalizeAccent("not-a-color") === null && normalizeAccent("#12") === null);
  ok("#xyz invalid → null", normalizeAccent("#gggggg") === null);

  // A good, already-accessible brand green passes untouched.
  const green = normalizeAccent("#1a6b4a");
  ok("good green accepted unadjusted", green && !green.adjusted && green.accent === "#1a6b4a");
  ok("good green: white fg passes AA on accent", contrast(green.fg, green.accent) >= 4.5);
  ok("good green: accent passes ≥3:1 on cream", contrast(green.accent, CREAM) >= 3.0);

  // A too-light color (bright yellow) would be illegible — must be CONSTRAINED.
  const yellow = normalizeAccent("#ffe600");
  ok("bright yellow is adjusted (constrained), not shipped raw", yellow && yellow.adjusted && yellow.accent !== "#ffe600");
  ok("adjusted yellow: text-on-accent passes AA", contrast(yellow.fg, yellow.accent) >= 4.5);
  ok("adjusted yellow: accent-on-cream passes ≥3:1", contrast(yellow.accent, CREAM) >= 3.0);
  ok("adjusted yellow: accentPasses() true", accentPasses(yellow.accent));

  // Another failing case: pale sky blue.
  const sky = normalizeAccent("#9ad0ff");
  ok("pale sky is constrained + legible", sky.adjusted && accentPasses(sky.accent));

  // #fff (white) — the worst case; must end legible (fg ink or darkened).
  const white = normalizeAccent("#ffffff");
  ok("white input constrained to a legible accent", accentPasses(white.accent));

  // ── Route: access control ─────────────────────────────────────────────────
  const tokenA = await login("a@brand.local");
  const tokenStaff = await login("staff@brand.local");
  const tokenB = await login("b@brand.local");
  const tokenRO = await login("ro@brand.local");

  ok("no-token PUT /orgs/branding → 401", (await api("PUT", "/orgs/branding", null, { brandAccent: "#1a6b4a" })).status === 401);
  ok("staff (non-admin) PUT /orgs/branding → 403", (await api("PUT", "/orgs/branding", tokenStaff, { brandAccent: "#1a6b4a" })).status === 403);
  ok("read_only org PUT /orgs/branding → 402 (checkWriteAccess)", (await api("PUT", "/orgs/branding", tokenRO, { brandAccent: "#1a6b4a" })).status === 402);

  // ── Route: set + read branding ────────────────────────────────────────────
  const set = await api("PUT", "/orgs/branding", tokenA, { brandAccent: "#b8593f", logoData: PNG });
  ok("admin PUT branding → 200", set.status === 200, set.status);
  ok("stored accent normalized + fg present", set.body.brand_accent && set.body.brand_accent_fg, set.body);
  ok("stored accent passes contrast", accentPasses(set.body.brand_accent));
  ok("logo stored", set.body.logo_data === PNG);

  // reflected on GET /org
  const org = (await api("GET", "/org", tokenA)).body;
  ok("GET /org returns brand_accent", org.brand_accent === set.body.brand_accent);
  ok("GET /org returns logo_data", org.logo_data === PNG);

  // bad accent rejected with guidance
  ok("PUT bad accent → 400", (await api("PUT", "/orgs/branding", tokenA, { brandAccent: "purple" })).status === 400);
  // too-light accent is constrained (200, adjusted flag), not rejected
  const light = await api("PUT", "/orgs/branding", tokenA, { brandAccent: "#ffe600" });
  ok("too-light accent constrained (200 + adjusted)", light.status === 200 && light.body.adjusted === true);
  ok("constrained accent is legible", accentPasses(light.body.brand_accent));

  // bad logo mime rejected
  ok("PUT non-image logo → 400", (await api("PUT", "/orgs/branding", tokenA, { logoData: "data:text/plain;base64,aGk=" })).status === 400);

  // remove logo + revert accent
  const rm = await api("PUT", "/orgs/branding", tokenA, { removeLogo: true, brandAccent: "" });
  ok("removeLogo + blank accent → nulled", rm.status === 200 && !rm.body.logo_data && !rm.body.brand_accent);

  // ── Org isolation ─────────────────────────────────────────────────────────
  await api("PUT", "/orgs/branding", tokenB, { brandAccent: "#0d5c3a" });
  const orgA2 = (await q(`SELECT brand_accent FROM orgs WHERE id=$1`, [A]))[0];
  const orgB2 = (await q(`SELECT brand_accent FROM orgs WHERE id=$1`, [B]))[0];
  ok("A's branding write never touched B (and vice-versa)", orgA2.brand_accent === null && orgB2.brand_accent === "#0d5c3a");
  ok("B's GET /org shows only B's accent", (await api("GET", "/org", tokenB)).body.brand_accent === "#0d5c3a");

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
