// BUILD-61 Part 2 — NON-DESTRUCTIVE CROP (banner slot).
//
//   (1) the crop math (client/src/lib/portalCrop.js) is correct and the render
//       and the editor use the SAME function → preview == render by reuse;
//   (2) the crop stores/round-trips as a normalized rect, validates, clears;
//   (3) it is NON-DESTRUCTIVE — cropping never touches the underlying asset
//       pointer, so the org can re-crop tomorrow from the full picture.
//
// Standard scratch stack.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb } = require("./helpers");

const ORG = "org_crop61", SLUG = "crop-demo", ADMIN = "crop-a@test.local";
const HEADER_URL = "/portal-assets/pa_crop000000000000000000ab";

async function fixture() {
  for (const t of ["fin_transactions", "budgets", "accounts", "fin_funds", "users", "portal_settings"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,'Crop Demo',$2,1,'active','core','acct_crop')`, [ORG, SLUG]);
  await q(`INSERT INTO portal_settings (org_id,enabled,display_name,primary_color,header_image_url) VALUES ($1,true,'Crop Demo','#33538a',$2)`, [ORG, HEADER_URL]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_crop',$1,$2,$3,'A','admin')`, [ORG, ADMIN, hash]);
}

const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

async function run() {
  await fixture();

  // ── (1) crop math ────────────────────────────────────────────────────────
  const { ratioValue, cropFor, zoomCenterFromCrop, cropImgStyle } = await import("../client/src/lib/portalCrop.js");
  ok("ratioValue parses the slot aspect", approx(ratioValue("1200 / 300"), 4) && approx(ratioValue("1/1"), 1));

  const slotAR = 4;
  for (const natAR of [1, 1.5, 3, 4, 6]) {
    for (const zoom of [1, 1.5, 2.5, 5]) {
      const c = cropFor(zoom, { cx: 0.5, cy: 0.5 }, natAR, slotAR);
      // the rect always matches the slot aspect in image space, and stays in bounds.
      ok(`crop matches slot aspect (natAR=${natAR}, zoom=${zoom})`, approx((c.w / c.h), slotAR / natAR, 1e-4), { c });
      ok(`crop in bounds (natAR=${natAR}, zoom=${zoom})`, c.x >= -1e-9 && c.y >= -1e-9 && c.x + c.w <= 1 + 1e-6 && c.y + c.h <= 1 + 1e-6, { c });
    }
  }
  // zoom shrinks the rect.
  const z1 = cropFor(1, { cx: 0.5, cy: 0.5 }, 3, slotAR), z2 = cropFor(2, { cx: 0.5, cy: 0.5 }, 3, slotAR);
  ok("higher zoom → smaller crop", z2.w < z1.w && z2.h < z1.h);
  // center clamps to the edges.
  const left = cropFor(2, { cx: 0, cy: 0 }, 3, slotAR);
  ok("center clamps to the top-left edge", approx(left.x, 0) && approx(left.y, 0));
  // zoom/center round-trips.
  const c0 = cropFor(2.5, { cx: 0.4, cy: 0.6 }, 3, slotAR);
  const zc = zoomCenterFromCrop(c0, 3, slotAR);
  ok("zoomCenterFromCrop recovers the zoom", approx(zc.zoom, 2.5, 1e-4), zc);
  ok("zoomCenterFromCrop recovers the center", approx(zc.center.cx, 0.4, 1e-4) && approx(zc.center.cy, 0.6, 1e-4), zc);
  // render style: width = 100/w, translate = -x,-y (%).
  const st = cropImgStyle({ x: 0.1, y: 0.2, w: 0.5, h: 0.125 });
  ok("cropImgStyle scales width by 1/w", st.width === "200.0000%" && st.height === "auto" && st.maxWidth === "none");
  ok("cropImgStyle translates by -x,-y", st.transform === "translate(-10.0000%, -20.0000%)", st.transform);

  // ── (2) preview == render, by reuse (source) ─────────────────────────────
  const banner = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "PortalBanner.jsx"), "utf8");
  const editorSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", "PortalEditor.jsx"), "utf8");
  const portalSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", "Portal.jsx"), "utf8");
  ok("the crop math lives in ONE place (imported, not redefined in PortalBanner)", !/function cropImgStyle\b/.test(banner) && /from "\.\.\/lib\/portalCrop"/.test(banner));
  ok("the banner render applies the crop over the focal fallback", /if \(crop && crop\.w > 0 && crop\.h > 0\) return cropImgStyle\(crop\)/.test(banner));
  ok("the crop EDITOR renders through the same cropImgStyle (preview==render)", /cur \? cropImgStyle\(cur\)/.test(banner));
  ok("the editor wires the crop control (drag + zoom, non-destructive rect)", /PortalBannerCrop/.test(editorSrc) && /onChange=\{\(c\) => onSet\("header_crop", c\)\}/.test(editorSrc));
  ok("the portal banner passes the crop", /crop=\{theme\.headerCrop\}/.test(portalSrc));

  // BUILD-65 Part 3 — the SAME library extended to the campaign hero:
  // preview == render by reuse (bannerImgStyle in the render, PortalBannerCrop
  // in the editor, one shared ratio).
  const widgetsSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "PortalWidgets.jsx"), "utf8");
  const fundSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "Fundraising.jsx"), "utf8");
  ok("campaign hero renders through bannerImgStyle(focal, crop) in the widget", /bannerImgStyle\(c\.heroFocal, c\.heroCrop\)/.test(widgetsSrc));
  ok("campaign hero renders through bannerImgStyle(focal, crop) in the portal spotlight", /bannerImgStyle\(c\.heroFocal, c\.heroCrop\)/.test(portalSrc));
  ok("campaign hero render + editor share PORTAL_CAMPAIGN_HERO_RATIO", /PORTAL_CAMPAIGN_HERO_RATIO/.test(widgetsSrc) && /PORTAL_CAMPAIGN_HERO_RATIO/.test(portalSrc) && /PORTAL_CAMPAIGN_HERO_RATIO/.test(fundSrc));
  ok("campaign editor wires the same PortalBannerCrop control (non-destructive rect)", /PortalBannerCrop/.test(fundSrc) && /setDfHeroCrop\(c\)/.test(fundSrc));

  // ── (3) round-trip + validation + non-destructive ────────────────────────
  const tok = (await api("POST", "/auth/login", null, { email: ADMIN, password: "loadtest1234" })).body.token;
  const before = (await q(`SELECT header_image_url, header_crop FROM portal_settings WHERE org_id=$1`, [ORG]))[0];
  ok("asset pointer present before crop", before.header_image_url === HEADER_URL && before.header_crop == null);

  const good = await api("PUT", "/portal-settings", tok, { headerCrop: { x: 0.1, y: 0.05, w: 0.5, h: 0.125 } });
  ok("PUT valid crop → 200", good.status === 200, good.status);
  const themeAfter = (await api("GET", `/org/${SLUG}/public`, null)).body.org.theme;
  ok("crop round-trips to the give/theme payload", JSON.stringify(themeAfter.headerCrop) === JSON.stringify({ x: 0.1, y: 0.05, w: 0.5, h: 0.125 }), themeAfter.headerCrop);
  const afterRow = (await q(`SELECT header_image_url, header_crop FROM portal_settings WHERE org_id=$1`, [ORG]))[0];
  ok("cropping NEVER touched the asset pointer (non-destructive)", afterRow.header_image_url === HEADER_URL);

  ok("PUT out-of-bounds crop → 400", (await api("PUT", "/portal-settings", tok, { headerCrop: { x: 0.8, y: 0, w: 0.5, h: 0.125 } })).status === 400);
  ok("PUT zero-size crop → 400", (await api("PUT", "/portal-settings", tok, { headerCrop: { x: 0, y: 0, w: 0, h: 0 } })).status === 400);
  ok("PUT non-object crop → 400", (await api("PUT", "/portal-settings", tok, { headerCrop: "nope" })).status === 400);

  const clear = await api("PUT", "/portal-settings", tok, { headerCrop: null });
  ok("PUT null clears the crop → 200", clear.status === 200);
  const cleared = (await api("GET", `/org/${SLUG}/public`, null)).body.org.theme;
  ok("cleared crop falls back to focal (headerCrop null)", cleared.headerCrop === null, cleared.headerCrop);
  const clearedRow = (await q(`SELECT header_image_url FROM portal_settings WHERE org_id=$1`, [ORG]))[0];
  ok("asset pointer STILL intact after clear (re-croppable from the full picture)", clearedRow.header_image_url === HEADER_URL);

  await closeDb();
  summary();
}
run().catch(e => { console.error(e); process.exit(1); });
