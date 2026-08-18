// BUILD-65 — what the storage migration left behind.
//   Part 1: uploads accept a real camera photo (~4MB), resize+compress on
//           ingest across EVERY slot; error text is actionable (no "350KB").
//   Part 2: the receipt/year-end PDF renders a logo that lives in OBJECT
//           STORAGE (a modern org's logo is an asset URL, never base64).
//   Part 5: the "create your free giving account" CTA is gone from the PDF
//           (it stays in the email).
//   Part 6: /health.guardsOk + reconciliation counters null-when-unchecked +
//           the accountsWithStripe denominator.
//
// Standard scratch stack (DONOR_ACCOUNTS_ENABLED=1). Written to the POST-fix
// contract and committed RED first (audit/build65-verify-first-red.txt).
const bcrypt = require("bcryptjs");
const sharp = require("sharp");
const crypto = require("crypto");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");
const fs = require("fs");

const ORG = "org_b65", SLUG = "build65-arts";
const ORG_NOLOGO = "org_b65_nl", SLUG_NL = "build65-nologo";
const EMAIL = "admin@b65.test";

// A REAL ~4MB camera-sized JPEG: full-frame random noise is near-incompressible,
// so a 4000×3000 RGB frame encodes to several MB — the exact case every
// customer's first upload actually is (a phone photo), and the case that has
// never been tested.
async function cameraJpeg() {
  const w = 4000, h = 3000;
  const raw = crypto.randomBytes(w * h * 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}
const uri = (buf, mime) => `data:${mime};base64,` + buf.toString("base64");

async function fixture() {
  for (const org of [ORG, ORG_NOLOGO]) {
    for (const t of ["portal_assets", "portal_pages", "campaigns", "impact_updates", "receipts", "fin_transactions", "gifts", "interactions", "donors", "users", "accounts", "fin_funds", "portal_settings"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  // Receipts-enabled orgs with a full legal identity so gift/year-end receipts issue.
  for (const [org, slug, name] of [[ORG, SLUG, "Build65 Arts"], [ORG_NOLOGO, SLUG_NL, "Build65 NoLogo"]]) {
    await q(`INSERT INTO orgs (id,name,legal_name,ein,receipt_address,receipts_enabled,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,$2,$3,'12-3456789','1 Main St, Town, ST 00000',true,$4,1,'active','core')`, [org, name, name + " Inc", slug]);
    await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name) VALUES ($1,true,true,$2)`, [org, name]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`,
      ["u_" + org, org, org === ORG ? EMAIL : "admin@b65nl.test", hash]);
    // minimal chart of accounts so gift ledger stamps land
    await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype) VALUES ($1,$2,'4010','Contributions','revenue','contributions')`, ["acc_" + org, org]).catch(() => {});
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General',false)`, ["ff_" + org, org]).catch(() => {});
    // a donor + a gift so a receipt has something to issue against
    await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count) VALUES ($1,$2,'Dana Donor','dana@b65.test',500,1)`, ["d_" + org, org]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ($1,$2,$3,500,$4,'cash')`, ["g_" + org, org, "d_" + org, new Date().toISOString().slice(0, 10)]);
  }
}

(async () => {
  console.log("build65 (uploads · PDF logo from storage · CTA out of PDF · guardsOk)");
  await fixture();
  const token = await login(EMAIL);
  const big = await cameraJpeg();
  ok("test JPEG is genuinely camera-sized (>3.5MB)", big.length > 3_500_000, big.length);
  const bigUri = uri(big, "image/jpeg");

  // ── PART 1 — every slot accepts the photo, resizes+compresses on ingest ──
  const r1 = await api("PUT", "/portal-settings", token, { headerImageData: bigUri });
  ok("Part1 banner: 4MB JPEG accepted (200)", r1.status === 200, { s: r1.status, b: r1.body?.error });
  ok("Part1 banner: stored as an asset URL", typeof r1.body?.header_image_url === "string" && r1.body.header_image_url.startsWith("/portal-assets/"), r1.body?.header_image_url);

  const r2 = await api("PUT", "/portal-settings", token, { logoData: bigUri });
  ok("Part1 logo: 4MB JPEG accepted (200)", r2.status === 200, { s: r2.status, b: r2.body?.error });

  const r3 = await api("POST", "/impact-updates", token, { title: "Spring", body: "b", photos: [bigUri], status: "published" });
  ok("Part1 impact photo: 4MB JPEG accepted (201)", r3.status === 201, { s: r3.status, b: r3.body?.error });

  const r4 = await api("POST", "/fundraising/campaigns", token, { name: "Cap Campaign", goalAmount: 10000, heroImageData: bigUri });
  ok("Part1 campaign hero: 4MB JPEG accepted", r4.status === 200 || r4.status === 201, { s: r4.status, b: r4.body?.error });

  const r5 = await api("PUT", "/portal-page/draft", token, { widgets: [{ type: "image", image: bigUri }] });
  ok("Part1 widget image: 4MB JPEG accepted (200)", r5.status === 200, { s: r5.status, b: r5.body?.error });

  // Every stored raster asset must have been resized+compressed on ingest —
  // never the 15MB-capable original sitting in the store.
  const assets = await q(`SELECT id,kind,bytes,width,content_type FROM portal_assets WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
  ok("Part1: uploads landed as ≥4 stored assets", assets.length >= 4, assets.map(a => a.kind));
  // The stored master must be SMALLER than the uploaded original — proof it was
  // resized/re-encoded on ingest, never the 15MB-capable source. (A real photo
  // compresses to a few hundred KB; this test's worst-case is pure noise, which
  // is near-incompressible, so we assert "smaller than the original" not an
  // absolute size — the ≤2560 width cap below is the real resize proof.)
  const tooBig = assets.filter(a => a.content_type !== "image/svg+xml" && a.bytes >= big.length);
  ok("Part1: stored master is smaller than the uploaded original (resized on ingest)", tooBig.length === 0, tooBig.map(a => [a.kind, a.bytes]));
  const overWide = assets.filter(a => a.width != null && a.width > 2560);
  ok("Part1: long edge capped at ≤2560 on ingest", overWide.length === 0, overWide.map(a => [a.kind, a.width]));

  // Error text: a non-image is rejected with words a nonprofit staffer can act
  // on — never "keep it under 350KB".
  const rBad = await api("PUT", "/portal-settings", token, { logoData: "data:application/pdf;base64,JVBERi0=" });
  ok("Part1: non-image rejected (400)", rBad.status === 400, rBad.status);
  const msg = (rBad.body?.message || "") + "";
  ok("Part1: error names a usable format, not bytes", /png|jpe?g|image/i.test(msg) && !/350\s*KB/i.test(msg), msg);

  // ── PART 2 — the receipt PDF renders a logo that lives in object storage ──
  // The org's logo is now an ASSET URL (uploaded above), never base64.
  const [ps] = await q(`SELECT logo_url, logo_data FROM portal_settings WHERE org_id=$1`, [ORG]);
  ok("Part2 precondition: logo is an object-storage URL (not base64)", ps.logo_url && ps.logo_url.startsWith("/portal-assets/") && !ps.logo_data, ps);
  const iss = await api("POST", `/gifts/g_${ORG}/receipt`, token, { send: false });
  const issRcpt = iss.body?.id || iss.body?.receipt?.id;   // route returns the receipt object directly
  ok("Part2: gift receipt issued", (iss.status === 200 || iss.status === 201) && issRcpt, { s: iss.status, b: iss.body?.error });
  const rcptId = issRcpt;
  // Fetch the raw PDF and confirm it embeds an image XObject (the logo).
  const pdfRes = await fetch(BASE + `/receipts/${rcptId}/pdf`, { headers: { Authorization: "Bearer " + token } });
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  ok("Part2: PDF is a real PDF", pdfBuf.slice(0, 4).toString() === "%PDF", pdfBuf.slice(0, 8).toString());
  const hasImage = /\/Subtype\s*\/Image/.test(pdfBuf.toString("latin1"));
  ok("Part2: PDF embeds the object-storage logo (image XObject present)", hasImage);
  // Control: an org with NO logo must NOT embed an image (the assertion means something).
  const tokenNl = await login("admin@b65nl.test");
  const issNl = await api("POST", `/gifts/g_${ORG_NOLOGO}/receipt`, tokenNl, { send: false });
  const pdfResNl = await fetch(BASE + `/receipts/${issNl.body?.id || issNl.body?.receipt?.id}/pdf`, { headers: { Authorization: "Bearer " + tokenNl } });
  const pdfNl = Buffer.from(await (await pdfResNl).arrayBuffer()).toString("latin1");
  ok("Part2 control: no-logo org PDF embeds no image", !/\/Subtype\s*\/Image/.test(pdfNl));

  // ── PART 5 — the account CTA has left the PDF (still in the email) ────────
  const ye = await api("POST", `/donors/d_${ORG}/year-end-statement`, token, { year: new Date().getFullYear(), send: false });
  ok("Part5: year-end statement issued", ye.status === 200 || ye.status === 201, { s: ye.status, b: ye.body?.error });
  const [yeRow] = await q(`SELECT snapshot FROM receipts WHERE org_id=$1 AND type='year_end' ORDER BY created_at DESC LIMIT 1`, [ORG]);
  const snap = typeof yeRow?.snapshot === "string" ? JSON.parse(yeRow.snapshot) : (yeRow?.snapshot || {});
  ok("Part5: PDF snapshot carries NO giving-account CTA", snap.givingAccountUrl == null, snap.givingAccountUrl);
  // The email CTA must survive (kept, per Part 5) — pinned as a source guard.
  const src = fs.readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");
  ok("Part5: the account CTA is still in the receipt EMAIL", /create your free giving account/.test(src));

  // ── PART 6 — guardsOk + null-when-unchecked + accountsWithStripe ─────────
  const h = await api("GET", "/health", null);
  const rec = h.body?.reconciliation || {};
  ok("Part6: unrecordedCharges is NULL before any reconcile run", rec.unrecordedCharges === null, rec.unrecordedCharges);
  ok("Part6: orphanGifts is NULL before any reconcile run", rec.orphanGifts === null, rec.orphanGifts);
  ok("Part6: accountsWithStripe denominator is surfaced (a number)", typeof rec.accountsWithStripe === "number", rec.accountsWithStripe);
  ok("Part6: guardsOk is a boolean", typeof h.body?.guardsOk === "boolean", h.body?.guardsOk);
  ok("Part6: guardsOk is FALSE when reconciliation has never run (a zero that means 'didn't look')", h.body?.guardsOk === false, h.body?.guardsOk);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
