// BUILD-54 §2 — gifts wired to campaign impact (+ §3 engagement endpoint and
// the §6 uploader server-parity + button/anchor semantics checks).
//
// The contract under test:
//   • Campaigns carry ORG-AUTHORED donor-facing fields (name/description/
//     story/hero/goal-visibility), editable ONLY via the CRM campaign routes;
//     story is sanitized structured blocks — never HTML (bad shapes → 400,
//     hostile strings stored as inert TEXT).
//   • A campaign-attributed gift is labeled with the campaign's donor-facing
//     name in the donor's portal history.
//   • The donor's portal surfaces the campaign's story (same 24-month
//     window + campaign_id-OR-name rule as the impact matcher) ONLY when the
//     org authored content — never fabricated.
//   • Goal progress is OPT-IN per campaign, default OFF. When OFF a donor
//     payload carries NO goal data for that campaign; when ON it carries
//     goal/raised/percent and never donor counts.
//   • The receipt cover email carries the campaign's org-authored copy,
//     frozen into the snapshot; absent without content.
//   • §6 hard rule: the drop path is the SAME endpoint — a server-rejected
//     file is rejected regardless of how it arrived.
//
// Standard scratch stack (run-all boot env). Starts its own mail sink on
// :5602 for the receipt-email leg (per-suite sink convention).
const http = require("http");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_A = "org_ci54_a", SLUG_A = "campimpact-a";
const ORG_B = "org_ci54_b";
const DONOR_EMAIL = "harper@ci54.test";

function fakePng(w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([sig, ihdr]);
}
const pngUri = (w, h) => "data:image/png;base64," + fakePng(w, h).toString("base64");

async function raw(method, p, { cookie, body } = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { Cookie: `steward_portal=${encodeURIComponent(cookie)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null; try { parsed = await r.json(); } catch { /* non-json */ }
  const m = (r.headers.get("set-cookie") || "").match(/steward_portal=([^;]+)/);
  return { status: r.status, body: parsed, cookie: m ? decodeURIComponent(m[1]) : null };
}

const mails = [];
function startSink() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let b = "";
      req.on("data", c => b += c);
      req.on("end", () => {
        try { const m = JSON.parse(b); mails.push({ to: Array.isArray(m.to) ? m.to[0] : m.to, subject: m.subject, html: m.html }); } catch { /* ignore */ }
        res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"snk"}');
      });
    });
    s.listen(5602, () => resolve(s));
  });
}

async function fixture() {
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@ci54.test'`);
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["portal_assets", "portal_audit_log", "portal_sessions", "portal_magic_links", "impact_updates", "receipts", "interactions", "gifts", "campaigns", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipts_enabled,legal_name,ein,receipt_address)
           VALUES ($1,'Campaign Arts','${SLUG_A}',1,'active','core',true,'Campaign Arts Inc','12-3456789','1 Test Way, Testville AL')`, [ORG_A]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Other Org','campimpact-b',1,'active','core')`, [ORG_B]);
  // network_listed=true: an ACCOUNT session opens an org portal only for a
  // linked + listed org (requirePortalSession, BUILD-46) — the suite signs
  // the donor in via account password, the simplest committed-session path.
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name) VALUES ($1,true,true,'Campaign Arts')`, [ORG_A]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ci54_a',$1,'ci54-a@test.local',$2,'A Admin','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ci54_b',$1,'ci54-b@test.local',$2,'B Admin','admin')`, [ORG_B, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_ci54',$1,'Harper Voss',$2,25200,3,'major','steward')`, [ORG_A, DONOR_EMAIL]);
  // Verified donor account → account session opens the portal (BUILD-46).
  await q(`INSERT INTO donor_accounts (id,email,password_hash,email_verified_at) VALUES ('da_ci54',$1,$2,NOW())`, [DONOR_EMAIL, hash]);
}

(async () => {
  const sink = await startSink();
  await fixture();
  const tokA = await login("ci54-a@test.local", "loadtest1234");
  const tokB = await login("ci54-b@test.local", "loadtest1234");
  const today = new Date().toISOString().slice(0, 10);
  const yearAgoPlus = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10);

  // ── 1) CRM create/edit carries the donor-facing fields ───────────────────
  console.log("— §2 donor-facing fields on the CRM campaign routes —");
  const created = await api("POST", "/fundraising/campaigns", tokA, {
    name: "Steeples Internal FY26", goalAmount: 50000,
    donorFacingName: "Steeples and Studios Campaign",
    donorDescription: "Restoring the chapel and opening three new studios.",
    donorStory: [{ type: "h2", text: "Why this matters" }, { type: "p", text: "The chapel roof is failing." }, { type: "ul", items: ["New roof", "Three studios"] }],
    heroImageData: pngUri(1200, 700),
  });
  ok("create 201 with fields round-tripped", created.status === 201
    && created.body.donorFacingName === "Steeples and Studios Campaign"
    && created.body.donorDescription.includes("chapel")
    && Array.isArray(created.body.donorStory) && created.body.donorStory.length === 3, created.body);
  ok("hero stored on the asset seam (URL, not base64)", /^\/portal-assets\/pa_[a-f0-9]{24}$/.test(created.body.heroImageUrl || ""), created.body.heroImageUrl);
  ok("goal progress defaults OFF (opt-in)", created.body.goalProgressPublic === false);
  const CID = created.body.id;
  const heroUrl = created.body.heroImageUrl;

  const edited = await api("PUT", `/fundraising/campaigns/${CID}`, tokA, { donorDescription: "Updated: the studios open this fall." });
  ok("PUT edits one field, others keep", edited.status === 200
    && edited.body.donorDescription.startsWith("Updated:")
    && edited.body.donorFacingName === "Steeples and Studios Campaign"
    && edited.body.heroImageUrl === heroUrl, edited.body);

  // ── 2) story sanitization — typed blocks only, hostile strings inert ─────
  console.log("\n— story sanitization —");
  for (const [label, bad] of [
    ["unknown block type", [{ type: "iframe", text: "x" }]],
    ["raw string payload", "<script>alert(1)</script>"],
    ["object not array", { type: "p", text: "x" }],
    ["ul without items", [{ type: "ul" }]],
    ["41 blocks", Array.from({ length: 41 }, () => ({ type: "p", text: "x" }))],
  ]) {
    const r = await api("PUT", `/fundraising/campaigns/${CID}`, tokA, { donorStory: bad });
    ok(`rejected: ${label}`, r.status === 400, r.status);
  }
  const hostile = await api("PUT", `/fundraising/campaigns/${CID}`, tokA, {
    donorStory: [{ type: "p", text: "<img src=x onerror=alert(1)> & <b>bold</b>" }],
  });
  ok("hostile STRING stored as inert text (data, not markup)", hostile.status === 200
    && hostile.body.donorStory[0].text.includes("<img src=x onerror="), hostile.body.donorStory);
  await api("PUT", `/fundraising/campaigns/${CID}`, tokA, {
    donorStory: [{ type: "h2", text: "Why this matters" }, { type: "p", text: "The chapel roof is failing." }],
  });

  // ── 3) §6 server-parity — the drop path is the same endpoint ─────────────
  console.log("\n— §6 uploader server parity —");
  const badType = await api("PUT", `/fundraising/campaigns/${CID}`, tokA, { heroImageData: "data:text/html;base64," + Buffer.from("<html>").toString("base64") });
  ok("server rejects a non-image dropped file (400)", badType.status === 400, badType.status);
  const badBytes = await api("PUT", `/fundraising/campaigns/${CID}`, tokA, { heroImageData: "data:image/png;base64,AAAA" });
  ok("server rejects junk image bytes (400)", badBytes.status === 400, badBytes.status);
  const keep = await api("GET", "/fundraising/campaigns", tokA);
  ok("rejected uploads left the stored hero untouched", keep.body.find(c => c.id === CID)?.heroImageUrl === heroUrl);

  // ── 4) BUILD-65 Part 3 — non-destructive hero crop (the banner-crop library
  // extended to this slot): crop round-trips, validates, focal is the fallback ─
  console.log("\n— hero crop (BUILD-65 Part 3) —");
  const cropSet = await api("PUT", `/fundraising/campaigns/${CID}`, tokA, { heroCrop: { x: 0.1, y: 0.05, w: 0.6, h: 0.4 } });
  ok("hero crop persisted + returned (normalized rect)", cropSet.status === 200
    && cropSet.body.heroCrop && Math.abs(cropSet.body.heroCrop.w - 0.6) < 1e-6 && Math.abs(cropSet.body.heroCrop.x - 0.1) < 1e-6, cropSet.body.heroCrop);
  const badCrop = await api("PUT", `/fundraising/campaigns/${CID}`, tokA, { heroCrop: { x: 0.5, y: 0.5, w: 0.9, h: 0.9 } }); // x+w > 1
  ok("out-of-bounds crop rejected (400), bytes never touched", badCrop.status === 400, badCrop.status);
  const keep2 = await api("GET", "/fundraising/campaigns", tokA);
  ok("rejected crop left the stored crop untouched", Math.abs((keep2.body.find(c => c.id === CID)?.heroCrop?.w ?? 0) - 0.6) < 1e-6);
  const cleared = await api("PUT", `/fundraising/campaigns/${CID}`, tokA, { heroCrop: "" });
  ok("crop cleared → null (falls back to focal)", cleared.status === 200 && cleared.body.heroCrop == null, cleared.body.heroCrop);
  ok("hero focal defaults to center when unset (the fallback)", cleared.body.heroFocal && cleared.body.heroFocal.x === 0.5 && cleared.body.heroFocal.y === 0.5, cleared.body.heroFocal);
  const focalSet = await api("PUT", `/fundraising/campaigns/${CID}`, tokA, { heroFocalX: 0.7, heroFocalY: 0.3 });
  ok("hero focal persists", focalSet.status === 200 && Math.abs(focalSet.body.heroFocal.x - 0.7) < 1e-6 && Math.abs(focalSet.body.heroFocal.y - 0.3) < 1e-6, focalSet.body.heroFocal);

  // ── 4) attribution + labeling + spotlight on the donor portal ────────────
  console.log("\n— donor portal: labeling, spotlight, opt-in goal —");
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,campaign_id) VALUES
    ('g_ci54_1',$1,'d_ci54',25000,$2,'cash','Steeples Internal FY26',$3)`, [ORG_A, today, CID]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES
    ('g_ci54_2',$1,'d_ci54',200,$2,'cash','')`, [ORG_A, yearAgoPlus]);
  const sess = await raw("POST", "/account/login", { body: { email: DONOR_EMAIL, password: "loadtest1234" } });
  ok("donor session minted", sess.status === 200 && !!sess.cookie);
  // The dashboard read runs the idempotent link pass (account → this org's
  // donor records) that an account session's portal access rides on.
  await raw("GET", "/account/dashboard", { cookie: sess.cookie });
  let me = (await raw("GET", `/portal/${SLUG_A}/me`, { cookie: sess.cookie })).body;
  const bigGift = (me.gifts || []).find(g => g.amount === 25000);
  ok("gift labeled with the DONOR-FACING campaign name", bigGift?.campaign === "Steeples and Studios Campaign", bigGift);
  ok("spotlight present with org-authored content", me.campaigns?.length === 1
    && me.campaigns[0].name === "Steeples and Studios Campaign"
    && me.campaigns[0].description.startsWith("Updated:")
    && me.campaigns[0].story?.[0]?.type === "h2"
    && me.campaigns[0].heroImage === heroUrl, me.campaigns);
  ok("goal OFF → NO goal data anywhere in the donor payload", me.campaigns[0].goal === null
    && !JSON.stringify(me.campaigns).match(/"raised"|"goalAmount"|50000/), me.campaigns[0]);
  ok("thank-you state present for the recent attributed gift", me.thankYou
    && me.thankYou.amount === 25000
    && me.thankYou.campaignName === "Steeples and Studios Campaign"
    && me.thankYou.description.startsWith("Updated:"), me.thankYou);

  // Opt the thermometer public → goal/raised/percent, never donor counts.
  await api("PUT", `/fundraising/campaigns/${CID}`, tokA, { goalProgressPublic: true });
  me = (await raw("GET", `/portal/${SLUG_A}/me`, { cookie: sess.cookie })).body;
  ok("goal ON → goal/raised/percent", me.campaigns[0].goal
    && me.campaigns[0].goal.amount === 50000
    && me.campaigns[0].goal.raised === 25000
    && me.campaigns[0].goal.percent === 50, me.campaigns[0].goal);
  ok("goal payload carries NO donor counts", !("donorCount" in (me.campaigns[0].goal || {}))
    && !JSON.stringify(me.campaigns[0]).includes("donorCount"));

  // ── 5) never fabricate — a content-less campaign is name-only ────────────
  console.log("\n— never fabricate —");
  const bare = await api("POST", "/fundraising/campaigns", tokA, { name: "Quiet Fund Drive", goalAmount: 9000 });
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,campaign_id) VALUES
    ('g_ci54_3',$1,'d_ci54',150,$2,'cash','Quiet Fund Drive',$3)`, [ORG_A, today, bare.body.id]);
  me = (await raw("GET", `/portal/${SLUG_A}/me`, { cookie: sess.cookie })).body;
  ok("content-less campaign: gift shows its name…", (me.gifts || []).some(g => g.campaign === "Quiet Fund Drive"));
  ok("…and NOTHING more (no spotlight, no filler)", !(me.campaigns || []).some(c => c.name === "Quiet Fund Drive"), me.campaigns.map(c => c.name));
  ok("thank-you never invents copy for a content-less campaign — it stays on the authored one",
    me.thankYou && me.thankYou.campaignName === "Steeples and Studios Campaign", me.thankYou);

  // ── 6) impact matcher: campaign-targeted update reaches the donor ────────
  console.log("\n— matcher extension (campaign target) —");
  const upd = await api("POST", "/impact-updates", tokA, { title: "The roof is on", body: "Thanks to you.", targets: [{ kind: "campaign", id: CID }] });
  ok("campaign-targeted update created", upd.status === 201, upd.body);
  me = (await raw("GET", `/portal/${SLUG_A}/me`, { cookie: sess.cookie })).body;
  ok("update matched via the gift's campaign attribution", (me.impact || []).some(u => u.title === "The roof is on"), me.impact);

  // ── 6b) BUILD-65 Part 3 — per-photo non-destructive crop, index-aligned ──
  console.log("\n— impact photo crop (BUILD-65 Part 3) —");
  const withPhotos = await api("POST", "/impact-updates", tokA, {
    title: "Photos with crops", body: "b", orgWide: true,
    photos: [pngUri(1200, 800), pngUri(1000, 700)],
    photoCrops: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.3333 }, null],
  });
  ok("impact update with photos + aligned crops created", withPhotos.status === 201, withPhotos.body);
  const iid = withPhotos.body.id;
  const findRow = async () => (await api("GET", "/impact-updates", tokA)).body.find(u => u.id === iid);
  let irow = await findRow();
  const cropsOf = (u) => (typeof u.photo_crops === "string" ? JSON.parse(u.photo_crops) : u.photo_crops) || [];
  ok("photo_crops stored index-aligned with photos", Array.isArray(irow.photos) && irow.photos.length === 2 && cropsOf(irow).length === 2, { photos: irow.photos?.length, crops: cropsOf(irow) });
  ok("photo 0 crop persisted (normalized), photo 1 null (center fallback)", cropsOf(irow)[0] && Math.abs(cropsOf(irow)[0].w - 0.5) < 1e-6 && cropsOf(irow)[1] == null, cropsOf(irow));
  // Removing the first photo keeps the crop array aligned with the survivors.
  const removed = await api("PUT", `/impact-updates/${iid}`, tokA, { photos: [irow.photos[1]], photoCrops: [null] });
  ok("PUT drops a photo → 200", removed.status === 200, removed.status);
  irow = await findRow();
  ok("after remove, photos + crops stay aligned (1 each)", irow.photos.length === 1 && cropsOf(irow).length === 1 && cropsOf(irow)[0] == null, { photos: irow.photos, crops: cropsOf(irow) });
  // An out-of-bounds crop falls back to null (center), never a stored bad rect.
  const badc = await api("PUT", `/impact-updates/${iid}`, tokA, { photos: irow.photos, photoCrops: [{ x: 0.9, y: 0, w: 0.5, h: 0.3 }] });
  ok("out-of-bounds crop stored as null (center fallback), never a bad rect", badc.status === 200 && cropsOf(await findRow())[0] == null);
  await api("PUT", `/impact-updates/${iid}`, tokA, { photos: [], photoCrops: [] }); // cleanup this update's photos

  // ── 7) receipt email carries the org-authored campaign copy ──────────────
  console.log("\n— receipt email content —");
  mails.length = 0;
  const rc = await api("POST", "/gifts/g_ci54_1/receipt", tokA, {});
  ok("receipt issued", rc.status === 200 || rc.status === 201, rc.body);
  await new Promise(r => setTimeout(r, 700));
  const rmail = mails.find(m => m.to === DONOR_EMAIL);
  ok("cover email captured", !!rmail);
  ok("email carries 'Your gift supports <name>' + the description", !!rmail
    && rmail.html.includes("Your gift supports")
    && rmail.html.includes("Steeples and Studios Campaign")
    && rmail.html.includes("Updated: the studios open this fall."), rmail && rmail.html.slice(0, 400));
  mails.length = 0;
  const rc2 = await api("POST", "/gifts/g_ci54_2/receipt", tokA, {});
  ok("unattributed gift receipt issued", rc2.status === 200 || rc2.status === 201, rc2.body);
  await new Promise(r => setTimeout(r, 700));
  const rmail2 = mails.find(m => m.to === DONOR_EMAIL);
  ok("no campaign paragraph without attribution/content", !!rmail2 && !rmail2.html.includes("Your gift supports"));

  // ── 8) org isolation ─────────────────────────────────────────────────────
  console.log("\n— org isolation —");
  const foreign = await api("PUT", `/fundraising/campaigns/${CID}`, tokB, { donorDescription: "hijack" });
  ok("foreign org PUT → 404, no change", foreign.status === 404
    && (await api("GET", "/fundraising/campaigns", tokA)).body.find(c => c.id === CID).donorDescription.startsWith("Updated:"));

  // ── 9) §3 engagement endpoint (existing quiet signals, org-scoped) ───────
  console.log("\n— §3 portal engagement —");
  const engA = await api("GET", "/portal-engagement", tokA);
  ok("engagement counts include this donor's views", engA.status === 200 && (engA.body.counts.dashboard_viewed || 0) >= 1, engA.body);
  ok("recent rows name only THIS org's donors", (engA.body.recent || []).every(r => r.donorName === "Harper Voss"), engA.body.recent);
  const engB = await api("GET", "/portal-engagement", tokB);
  ok("other org sees none of it", engB.status === 200 && Object.keys(engB.body.counts).length === 0 && engB.body.recent.length === 0, engB.body);

  // ── 10) §6 button/anchor semantics — source check ────────────────────────
  console.log("\n— §6 anchor semantics (source) —");
  const srcDir = path.join(__dirname, "..", "client", "src");
  let badAnchors = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.jsx?$/.test(f)) {
        const s = fs.readFileSync(p, "utf8");
        if (/href=["']#["']/.test(s)) badAnchors.push(f + ": href=\"#\"");
        // An <a … onClick> must also carry a real href (navigation semantics).
        const re = /<a\s[^>]*onClick[^>]*>/g;
        let m;
        while ((m = re.exec(s))) { if (!/href=/.test(m[0])) badAnchors.push(f + ": " + m[0].slice(0, 60)); }
      }
    }
  })(srcDir);
  ok("no href=\"#\" and no href-less <a onClick> anywhere in client source", badAnchors.length === 0, badAnchors);

  sink.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
