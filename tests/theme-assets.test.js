// BUILD-51 — theme-asset storage: base64 theme images (portal header, logo)
// move OUT of the portal_settings row and out of every payload.
//
//   • an upload through PUT /portal-settings is validated (type + size +
//     DIMENSIONS — a portrait header is rejected outright: it can only crop
//     badly as a banner), stored through assetStore, and the row keeps only
//     a content-addressed /portal-assets/<id> URL — the *_data column is NULL;
//   • GET /portal-assets/:id serves the bytes with immutable cache headers;
//   • every payload (portal config, donor dashboard, directory) carries the
//     URL — never image base64;
//   • identical bytes are a no-op (same id); new bytes mint a NEW URL and the
//     stale asset is pruned — immutable caching can never serve a stale image;
//   • the legacy *_data path still renders (COALESCE read sites) so an
//     unmigrated org is byte-identical until its next save migrates it.
//
// Standard scratch stack + DONOR_ACCOUNTS_ENABLED=1.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");
const { assetIdFor, ASSET_ID_RE, _signedS3Request } = require("../assetStore");

const ORG_A = "org_ta_a", SLUG_A = "themeassets-a";
const ORG_B = "org_ta_b", SLUG_B = "themeassets-b";
const EMAIL = "quinn@ta51.test";

// A structurally-valid PNG header (signature + IHDR) — image-size reads only
// the header, so this is a real "raster with these dimensions" as far as
// server-side validation is concerned.
function fakePng(w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([sig, ihdr]);
}
const pngUri = (w, h) => "data:image/png;base64," + fakePng(w, h).toString("base64");
const SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><rect width="1200" height="300" fill="#8a4a2c"/></svg>`);
const svgUri = "data:image/svg+xml;base64," + SVG.toString("base64");

function cookieOf(res) {
  const m = (res.headers?.get("set-cookie") || "").match(/steward_portal=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
async function raw(method, p, { cookie, body } = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { Cookie: `steward_portal=${encodeURIComponent(cookie)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null; try { parsed = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body: parsed, headers: r.headers };
}

async function fixture() {
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@ta51.test'`);
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["portal_assets", "portal_audit_log", "portal_sessions", "portal_magic_links", "impact_updates", "gifts", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Asset Arts','${SLUG_A}',1,'active','core')`, [ORG_A]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Legacy Lane','${SLUG_B}',1,'active','core')`, [ORG_B]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name) VALUES ($1,true,true,'Asset Arts')`, [ORG_A]);
  // Org B is the LEGACY generation: base64 in the row, never re-saved.
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name,header_image_data,logo_data) VALUES ($1,true,true,'Legacy Lane',$2,$3)`,
    [ORG_B, svgUri, svgUri]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ta_a',$1,'ta-a@test.local',$2,'A Admin','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ta_b',$1,'ta-b@test.local',$2,'B Admin','admin')`, [ORG_B, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_ta_a',$1,'Quinn Vale',$2,300,1,'mid','steward')`, [ORG_A, EMAIL]);
  const y = new Date().getFullYear();
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_ta_a',$1,'d_ta_a',300,'${y}-02-01','cash','')`, [ORG_A]);
  await q(`INSERT INTO donor_accounts (id,email,password_hash,email_verified_at) VALUES ('da_ta51',$1,$2,NOW())`, [EMAIL, hash]);
}

(async () => {
  await fixture();
  const tokA = await login("ta-a@test.local", "loadtest1234");
  const tokB = await login("ta-b@test.local", "loadtest1234");

  // ── 1) upload → asset URL in the row, base64 OUT of the row ──────────────
  console.log("— upload → URL, row stays light —");
  const put = await api("PUT", "/portal-settings", tokA, { headerImageData: pngUri(1200, 300), logoData: svgUri });
  ok("upload accepted", put.status === 200, put.body);
  ok("row carries a content-addressed URL path", /^\/portal-assets\/pa_[a-f0-9]{24}$/.test(put.body.header_image_url || ""), put.body.header_image_url);
  ok("legacy data column is NULL after upload", put.body.header_image_data === null && put.body.logo_data === null);
  ok("logo stored as an asset too", /^\/portal-assets\/pa_/.test(put.body.logo_url || ""));
  const headerUrl = put.body.header_image_url, logoUrl = put.body.logo_url;
  const assets = await q(`SELECT * FROM portal_assets WHERE org_id=$1 ORDER BY kind`, [ORG_A]);
  ok("one asset row per kind, dimensions recorded", assets.length === 2
    && assets.find(a => a.kind === "header")?.width === 1200
    && assets.find(a => a.kind === "header")?.height === 300, assets.map(a => [a.kind, a.width, a.height]));

  // ── 2) the serve route ────────────────────────────────────────────────────
  console.log("\n— serve route —");
  const got = await fetch(BASE + headerUrl);
  ok("asset serves 200 with its content type", got.status === 200 && got.headers.get("content-type").startsWith("image/png"));
  ok("immutable cache headers (content-addressed, safe forever)",
    (got.headers.get("cache-control") || "").includes("immutable") && !!got.headers.get("etag"));
  ok("bytes roundtrip exactly", Buffer.compare(Buffer.from(await got.arrayBuffer()), fakePng(1200, 300)) === 0);
  ok("unknown asset id → 404", (await fetch(BASE + "/portal-assets/pa_000000000000000000000000")).status === 404);
  ok("malformed asset id → 404 (no lookup)", (await fetch(BASE + "/portal-assets/../../etc/passwd")).status === 404);

  // ── 3) payloads carry URLs, never image base64 ────────────────────────────
  console.log("\n— payloads —");
  const cfg = await (await fetch(BASE + `/portal/${SLUG_A}/config`)).json();
  ok("portal config theme carries the URL", cfg.theme.headerImage === headerUrl && cfg.theme.logo === logoUrl, [cfg.theme.headerImage, cfg.theme.logo]);
  ok("portal config theme carries zero base64 image bytes", !JSON.stringify(cfg.theme).includes(";base64,"));
  const acct = await raw("POST", "/account/login", { body: { email: EMAIL, password: "loadtest1234" } });
  const cookie = cookieOf(acct);
  const dash = await raw("GET", "/account/dashboard", { cookie });
  ok("dashboard org theme carries the URL", dash.body.orgs?.[0]?.theme?.headerImage === headerUrl
    && dash.body.orgs?.[0]?.theme?.logo === logoUrl, dash.body.orgs?.[0]?.theme?.headerImage);
  ok("whole dashboard payload carries zero image base64", !JSON.stringify(dash.body).includes(";base64,"));
  const dir = await raw("GET", "/network/directory?q=asset arts", { cookie });
  ok("directory row logo is the URL", dir.body.results?.[0]?.logo === logoUrl, dir.body.results?.[0]?.logo);

  // ── 4) content addressing: same bytes no-op, new bytes new URL + prune ────
  console.log("\n— content addressing —");
  const again = await api("PUT", "/portal-settings", tokA, { headerImageData: pngUri(1200, 300) });
  ok("identical bytes → identical URL (no new asset)", again.body.header_image_url === headerUrl);
  const c1 = await q(`SELECT COUNT(*)::int n FROM portal_assets WHERE org_id=$1 AND kind='header'`, [ORG_A]);
  ok("still exactly one header asset", c1[0].n === 1);
  const put2 = await api("PUT", "/portal-settings", tokA, { headerImageData: pngUri(1600, 400) });
  ok("new bytes → NEW URL (immutable caching stays truthful)", put2.body.header_image_url !== headerUrl && /^\/portal-assets\/pa_/.test(put2.body.header_image_url));
  const c2 = await q(`SELECT COUNT(*)::int n FROM portal_assets WHERE org_id=$1 AND kind='header'`, [ORG_A]);
  ok("stale header asset pruned on replace", c2[0].n === 1);
  ok("old URL now 404s", (await fetch(BASE + headerUrl)).status === 404);
  const echo = await api("PUT", "/portal-settings", tokA, { headerImageData: put2.body.header_image_url, displayName: "Asset Arts" });
  ok("client echoing the stored URL on an unrelated save is a NO-OP", echo.body.header_image_url === put2.body.header_image_url && echo.body.header_image_data === null);

  // ── 5) clearing removes the asset ─────────────────────────────────────────
  console.log("\n— clear —");
  const cleared = await api("PUT", "/portal-settings", tokA, { headerImageData: "" });
  ok("clear nulls both columns", cleared.body.header_image_url === null && cleared.body.header_image_data === null);
  const c3 = await q(`SELECT COUNT(*)::int n FROM portal_assets WHERE org_id=$1 AND kind='header'`, [ORG_A]);
  ok("cleared asset row deleted", c3[0].n === 0);
  ok("cleared URL 404s", (await fetch(BASE + put2.body.header_image_url)).status === 404);

  // ── 6) validation: type + size + DIMENSIONS ───────────────────────────────
  console.log("\n— validation —");
  const portrait = await api("PUT", "/portal-settings", tokA, { headerImageData: pngUri(300, 800) });
  ok("portrait header REJECTED (would decapitate as a banner)", portrait.status === 400 && portrait.body.error === "bad_image_dimensions", portrait.body);
  const square = await api("PUT", "/portal-settings", tokA, { headerImageData: pngUri(500, 500) });
  ok("square header rejected too (height >= width)", square.status === 400 && square.body.error === "bad_image_dimensions");
  const narrow = await api("PUT", "/portal-settings", tokA, { headerImageData: pngUri(400, 100) });
  ok("sub-600px-wide header rejected", narrow.status === 400 && narrow.body.error === "bad_image_dimensions");
  const huge = await api("PUT", "/portal-settings", tokA, { headerImageData: pngUri(7000, 1000) });
  ok("absurd pixel dimensions rejected", huge.status === 400 && huge.body.error === "bad_image_dimensions");
  const garbage = await api("PUT", "/portal-settings", tokA, { headerImageData: "data:image/png;base64," + Buffer.from("not a png at all").toString("base64") });
  ok("bytes that don't parse as an image rejected", garbage.status === 400 && garbage.body.error === "bad_image_dimensions");
  const badMime = await api("PUT", "/portal-settings", tokA, { headerImageData: "data:text/html;base64," + Buffer.from("<html>").toString("base64") });
  ok("non-image mime rejected", badMime.status === 400 && badMime.body.error === "bad_image");
  const big = await api("PUT", "/portal-settings", tokA, { headerImageData: "data:image/png;base64," + "A".repeat(500001) });
  ok("size cap enforced", big.status === 400 && big.body.error === "bad_image");
  const svgOk = await api("PUT", "/portal-settings", tokA, { headerImageData: svgUri });
  ok("SVG header accepted (vector — no raster dimension rule)", svgOk.status === 200 && /^\/portal-assets\/pa_/.test(svgOk.body.header_image_url));
  const logoPortrait = await api("PUT", "/portal-settings", tokA, { logoData: pngUri(200, 400) });
  ok("portrait LOGO accepted (only headers carry the banner rule)", logoPortrait.status === 200 && /^\/portal-assets\/pa_/.test(logoPortrait.body.logo_url));

  // ── 7) legacy compat + migration-by-resave ────────────────────────────────
  console.log("\n— legacy compat + migration —");
  const cfgB = await (await fetch(BASE + `/portal/${SLUG_B}/config`)).json();
  ok("unmigrated org still renders its base64 (COALESCE compat)", cfgB.theme.headerImage === svgUri && cfgB.theme.logo === svgUri);
  const mig = await api("PUT", "/portal-settings", tokB, { headerImageData: svgUri, logoData: svgUri });
  ok("re-saving the same base64 MIGRATES the row to asset URLs",
    /^\/portal-assets\/pa_/.test(mig.body.header_image_url) && mig.body.header_image_data === null
    && /^\/portal-assets\/pa_/.test(mig.body.logo_url) && mig.body.logo_data === null);
  const cfgB2 = await (await fetch(BASE + `/portal/${SLUG_B}/config`)).json();
  ok("migrated org serves the URL, bytes unchanged", cfgB2.theme.headerImage === mig.body.header_image_url
    && Buffer.compare(Buffer.from(await (await fetch(BASE + mig.body.header_image_url)).arrayBuffer()), SVG) === 0);

  // ── 8) ids are org-salted + the store's pure pieces ───────────────────────
  console.log("\n— store invariants —");
  ok("same bytes in different orgs mint different ids (org-salted)",
    mig.body.header_image_url !== svgOk.body.header_image_url);
  ok("assetIdFor is deterministic and matches the pinned format",
    assetIdFor("o1", "image/png", Buffer.from("x")) === assetIdFor("o1", "image/png", Buffer.from("x"))
    && ASSET_ID_RE.test(assetIdFor("o1", "image/png", Buffer.from("x"))));
  const sig = _signedS3Request({ endpoint: "https://s.example.com", bucket: "b", key: "AK", secret: "SK", region: "auto", urlStyle: "path" }, "PUT", "k/1", Buffer.from("hi"));
  ok("SigV4 request shape (credentialed, signed host+date+payload-hash)",
    sig.url === "https://s.example.com/b/k/1"
    && /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/.test(sig.headers.Authorization));
  const sigV = _signedS3Request({ endpoint: "https://s.example.com", bucket: "b", key: "AK", secret: "SK", region: "auto", urlStyle: "virtual-host" }, "GET", "k/1", "");
  ok("virtual-host style puts the bucket in the (signed) hostname",
    sigV.url === "https://b.s.example.com/k/1" && sigV.headers.host === "b.s.example.com");

  // ── 9) BUILD-51b — impact-update photos ride the same seam ────────────────
  console.log("\n— impact photos —");
  // Content-photo rules: ANY orientation (portrait allowed — the 5:1 banner
  // rule is a header rule), must parse, 6000px cap, 4-photo cap.
  const mk = await api("POST", "/impact-updates", tokA, {
    title: "Photo update", body: "Two photos.", orgWide: true,
    photos: [pngUri(400, 800), svgUri],
  });
  ok("update created; photos stored as asset paths (portrait photo ACCEPTED)",
    mk.status === 201 && Array.isArray(mk.body.photos) && mk.body.photos.length === 2
    && mk.body.photos.every(p => /^\/portal-assets\/pa_[a-f0-9]{24}$/.test(p)), mk.body.photos);
  const upId = mk.body.id, [ph0, ph1] = mk.body.photos;
  const ic = await q(`SELECT * FROM portal_assets WHERE org_id=$1 AND kind='impact'`, [ORG_A]);
  ok("impact asset rows recorded with dimensions", ic.length === 2 && ic.some(a => a.width === 400 && a.height === 800));
  ok("photo asset serves", (await fetch(BASE + ph0)).status === 200);
  const dash2 = await raw("GET", "/account/dashboard", { cookie });
  const upRow = (dash2.body.impact || []).find(u => u.id === upId);
  ok("dashboard impact carries the photo PATHS", upRow && upRow.photos.length === 2 && upRow.photos[0] === ph0, upRow?.photos);
  ok("FULL dashboard payload: zero image base64 (theme + photos)", !JSON.stringify(dash2.body).includes(";base64,"));

  // echo, add, remove, cross-update refs
  const echo2 = await api("PUT", `/impact-updates/${upId}`, tokA, { photos: [ph0, ph1] });
  ok("echoing stored paths on edit is a no-op", echo2.status === 200 && echo2.body.photos.join() === [ph0, ph1].join());
  const add3 = await api("PUT", `/impact-updates/${upId}`, tokA, { photos: [ph0, ph1, pngUri(900, 600)] });
  ok("adding a third photo stores one more asset", add3.body.photos.length === 3
    && (await q(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE org_id=$1 AND kind='impact'`, [ORG_A]))[0].n === 3);
  const rm = await api("PUT", `/impact-updates/${upId}`, tokA, { photos: [ph0] });
  ok("removing photos PRUNES their assets", rm.body.photos.join() === ph0
    && (await q(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE org_id=$1 AND kind='impact'`, [ORG_A]))[0].n === 1);
  ok("removed photo URL 404s", (await fetch(BASE + ph1)).status === 404);
  const mk2 = await api("POST", "/impact-updates", tokA, { title: "Shares a photo", orgWide: true, photos: [ph0] });
  ok("a second update can reference the same stored photo", mk2.status === 201 && mk2.body.photos[0] === ph0);
  await api("DELETE", `/impact-updates/${upId}`, tokA);
  ok("deleting update 1 KEEPS the photo update 2 still references", (await fetch(BASE + ph0)).status === 200);
  await api("DELETE", `/impact-updates/${mk2.body.id}`, tokA);
  ok("deleting the last referencing update prunes the photo", (await fetch(BASE + ph0)).status === 404
    && (await q(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE org_id=$1 AND kind='impact'`, [ORG_A]))[0].n === 0);

  // caps + validation
  const six = await api("POST", "/impact-updates", tokA, {
    title: "Six photos", orgWide: true,
    photos: [1, 2, 3, 4, 5, 6].map(i => pngUri(600 + i, 400)),
  });
  ok("photos capped at 4 per update", six.status === 201 && six.body.photos.length === 4, six.body.photos?.length);
  await api("DELETE", `/impact-updates/${six.body.id}`, tokA);
  const badPhoto = await api("POST", "/impact-updates", tokA, { title: "x", orgWide: true, photos: ["data:image/png;base64," + Buffer.from("junk").toString("base64")] });
  ok("unparseable photo rejected", badPhoto.status === 400 && badPhoto.body.error === "bad_image_dimensions");
  const badMimeP = await api("POST", "/impact-updates", tokA, { title: "x", orgWide: true, photos: ["data:text/html;base64," + Buffer.from("<x>").toString("base64")] });
  ok("non-image photo mime rejected", badMimeP.status === 400 && badMimeP.body.error === "bad_image");

  // legacy compat + migration-by-resave (photos generation)
  await q(`INSERT INTO impact_updates (id,org_id,title,photos,targets,org_wide,status) VALUES ('imp_ta_leg',$1,'Legacy photos',$2,'[]',true,'published')`,
    [ORG_A, JSON.stringify([svgUri])]);
  const dash3 = await raw("GET", "/account/dashboard", { cookie });
  const legRow = (dash3.body.impact || []).find(u => u.id === "imp_ta_leg");
  ok("legacy data-URI photos still render (compat passthrough)", legRow && legRow.photos[0] === svgUri);
  const migP = await api("PUT", "/impact-updates/imp_ta_leg", tokA, { photos: [svgUri] });
  ok("re-saving migrates legacy photos to asset paths", /^\/portal-assets\/pa_/.test(migP.body.photos[0]));
  const dash4 = await raw("GET", "/account/dashboard", { cookie });
  ok("post-migration: FULL dashboard payload zero base64 again", !JSON.stringify(dash4.body).includes(";base64,"));
  await api("DELETE", "/impact-updates/imp_ta_leg", tokA);

  // health surfacing for the S3-fallback alarm
  const health = await (await fetch(BASE + "/health")).json();
  ok("health surfaces the theme-asset driver + fallback count",
    health.themeAssets && typeof health.themeAssets.s3 === "boolean"
    && "dbFallbackRows" in health.themeAssets && "dbFallbackSinceBoot" in health.themeAssets, health.themeAssets);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
