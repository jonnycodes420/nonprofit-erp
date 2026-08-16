// BUILD-56 — asset retention & undo.
//
// VERIFY-FIRST: this suite was committed FAILING RED against the pre-BUILD-56
// server, proving the loss existed through the ORDINARY APPLICATION PATH (no
// script involved): replacing a theme banner / impact photo / campaign hero /
// widget image reference-count pruned the old object — DB row and S3 object
// gone, public URL 404, and NO row anywhere recorded what the previous hash
// was. Recovery was impossible by any means available to the application.
// The red/green states are recorded in audit/BUILD-56-FINDINGS.md.
//
// The contract this suite pins (BUILD-56):
//   1. POINTER HISTORY — every mutation of a row that points at a
//      content-addressed asset (portal_settings logo/header, impact_updates
//      photos, campaigns hero, portal_pages draft/published) appends an
//      asset_pointer_history row: entity, from → to, when, actor. Kept
//      indefinitely.
//   2. SOFT DELETE ON PRUNE — refcount-zero marks deleted_at and KEEPS the
//      bytes. The public URL still 404s (a removed image must disappear),
//      but the object is recoverable for ASSET_RETENTION_DAYS (90).
//   3. RESTORE — scripts/restore-asset.js un-deletes an asset and (--repoint)
//      re-points the pointer from history. Proven here by byte-equality and
//      the pointer being live on the portal again.
//   4. PURGE — only past the retention window, never a referenced object,
//      every destruction logged in asset_purge_log. 89 days survives, 91
//      purges, referenced-but-old is restored (self-heal), never purged.
//   5. ONE SEAM — the source battery below: destruction primitives exist
//      ONLY inside assetStore.js's marked destruction seam; every prune/put
//      call site is enumerated and an unclassified one fails this suite.
//
// Standard scratch stack (tests/README.md).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_ar_a", SLUG = "assetret-a";
const ORG_B = "org_ar_b", SLUG_B = "assetret-b";

function fakePng(w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([sig, ihdr]);
}
const pngUri = (w, h) => "data:image/png;base64," + fakePng(w, h).toString("base64");
const idOf = (p) => String(p || "").replace("/portal-assets/", "");

// History reads are guarded so the PRE-fix world fails on assertions (red),
// not on a missing-table crash.
const hist = (entity, entityId) => q(
  `SELECT * FROM asset_pointer_history WHERE org_id=$1 AND entity=$2 AND entity_id=$3 ORDER BY created_at, id`,
  [ORG, entity, entityId]).catch(() => []);
const assetRow = (id) => q(`SELECT * FROM portal_assets WHERE id=$1`, [id]).then(r => r[0] || null);

async function fixture() {
  for (const org of [ORG, ORG_B]) {
    for (const t of ["portal_assets", "asset_pointer_history", "asset_purge_log", "impact_updates", "campaigns", "gifts", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_pages WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Retention Arts','${SLUG}',1,'active','core')`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Bystander Org','${SLUG_B}',1,'active','core')`, [ORG_B]);
  await q(`INSERT INTO portal_settings (org_id,enabled,display_name) VALUES ($1,true,'Retention Arts')`, [ORG]);
  await q(`INSERT INTO portal_settings (org_id,enabled,display_name) VALUES ($1,true,'Bystander')`, [ORG_B]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ar_a',$1,'ar-a@test.local',$2,'A Admin','admin')`, [ORG, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ar_b',$1,'ar-b@test.local',$2,'B Admin','admin')`, [ORG_B, hash]);
}

(async () => {
  await fixture();
  const tok = await login("ar-a@test.local", "loadtest1234");
  const tokB = await login("ar-b@test.local", "loadtest1234");

  // ═══ 1) VERIFY-FIRST PROBE — theme banner through the ordinary app path ═══
  console.log("— the verify-first probe: theme banner replaced via PUT /portal-settings —");
  const v1 = await api("PUT", "/portal-settings", tok, { headerImageData: pngUri(1200, 300) });
  const url1 = v1.body.header_image_url, id1 = idOf(url1);
  ok("banner v1 stored", v1.status === 200 && /^\/portal-assets\/pa_/.test(url1 || ""), v1.body);
  const bytes1 = Buffer.from(await (await fetch(BASE + url1)).arrayBuffer());
  ok("banner v1 serves its bytes", Buffer.compare(bytes1, fakePng(1200, 300)) === 0);

  // The ordinary application path an org admin's browser hits:
  const v2 = await api("PUT", "/portal-settings", tok, { headerImageData: pngUri(1600, 400) });
  const url2 = v2.body.header_image_url;
  ok("banner v2 replaces the pointer", v2.status === 200 && url2 !== url1 && /^\/portal-assets\/pa_/.test(url2 || ""));

  ok("old public URL 404s (a replaced image disappears from the portal)", (await fetch(BASE + url1)).status === 404);
  const row1 = await assetRow(id1);
  ok("RETENTION: the old object's row SURVIVES, soft-deleted (bytes kept)",
    !!row1 && row1.deleted_at != null, row1 ? "row exists, deleted_at=" + row1.deleted_at : "ROW IS GONE — bytes destroyed");
  ok("RETENTION: the old bytes are recoverable byte-identically",
    !!row1 && row1.data && Buffer.compare(Buffer.from(row1.data, "base64"), bytes1) === 0);
  const h1 = await hist("portal_settings.header_image", ORG);
  ok("HISTORY: a row records which hash WAS the banner (from v1 → to v2, with actor)",
    h1.length >= 2 && h1.some(r => r.from_value === url1 && r.to_value === url2 && r.actor_user_id === "u_ar_a"),
    h1.map(r => [r.from_value, r.to_value]));
  ok("HISTORY: the original upload is recorded too (null → v1)",
    h1.some(r => r.from_value === null && r.to_value === url1));

  // Re-uploading the identical old bytes RESURRECTS the same content address.
  const back = await api("PUT", "/portal-settings", tok, { headerImageData: pngUri(1200, 300) });
  ok("re-upload of identical bytes resurrects the same asset id", back.body.header_image_url === url1);
  ok("resurrected asset serves again", (await fetch(BASE + url1)).status === 200);
  const row2now = await assetRow(idOf(url2));
  ok("…and v2 is now the soft-deleted one", !!row2now && row2now.deleted_at != null);

  // Clearing destroys nothing either.
  await api("PUT", "/portal-settings", tok, { headerImageData: "" });
  const row1cleared = await assetRow(id1);
  ok("CLEAR keeps the bytes too (soft-deleted, not destroyed)", !!row1cleared && row1cleared.deleted_at != null);
  const hClear = await hist("portal_settings.header_image", ORG);
  ok("clear is in the history (v1 → null)", hClear.some(r => r.from_value === url1 && r.to_value === null));

  // ═══ 2) the same probe — impact-update photos ═══════════════════════════
  console.log("\n— probe: impact-update photos —");
  const mk = await api("POST", "/impact-updates", tok, { title: "Probe", orgWide: true, photos: [pngUri(800, 600)] });
  const p1 = mk.body.photos?.[0];
  ok("impact photo stored", mk.status === 201 && /^\/portal-assets\/pa_/.test(p1 || ""));
  const p1bytes = Buffer.from(await (await fetch(BASE + p1)).arrayBuffer());
  const ed = await api("PUT", `/impact-updates/${mk.body.id}`, tok, { photos: [pngUri(900, 700)] });
  const p2 = ed.body.photos?.[0];
  ok("photo replaced via the ordinary edit path", ed.status === 200 && p2 !== p1);
  ok("old photo URL 404s", (await fetch(BASE + p1)).status === 404);
  const pRow = await assetRow(idOf(p1));
  ok("RETENTION: replaced impact photo survives soft-deleted, bytes intact",
    !!pRow && pRow.deleted_at != null && pRow.data && Buffer.compare(Buffer.from(pRow.data, "base64"), p1bytes) === 0,
    pRow ? "kept" : "ROW IS GONE");
  const hImp = await hist("impact_update.photos", mk.body.id);
  ok("HISTORY: impact photo pointer changes recorded (create + edit)",
    hImp.length >= 2
    && hImp.some(r => JSON.stringify(r.to_value) === JSON.stringify([p1]))
    && hImp.some(r => JSON.stringify(r.from_value) === JSON.stringify([p1]) && JSON.stringify(r.to_value) === JSON.stringify([p2])),
    hImp.map(r => [r.from_value, r.to_value]));
  // Deleting the update keeps the bytes and records the pointer removal.
  await api("DELETE", `/impact-updates/${mk.body.id}`, tok);
  const p2Row = await assetRow(idOf(p2));
  ok("deleting the update soft-deletes (not destroys) its photo", !!p2Row && p2Row.deleted_at != null);
  const hImpDel = await hist("impact_update.photos", mk.body.id);
  ok("delete is in the history (photos → null)", hImpDel.some(r => r.to_value === null));

  // ═══ 3) the same probe — campaign hero ══════════════════════════════════
  console.log("\n— probe: campaign hero —");
  const cmp = await api("POST", "/fundraising/campaigns", tok, { name: "Hero Probe", goalAmount: 1000, heroImageData: pngUri(1000, 500) });
  const cid = cmp.body.id;
  const [cRow0] = await q(`SELECT hero_image_url FROM campaigns WHERE id=$1`, [cid]);
  const hUrl1 = cRow0?.hero_image_url;
  ok("campaign hero stored", cmp.status === 201 && /^\/portal-assets\/pa_/.test(hUrl1 || ""), cmp.body);
  const hBytes = Buffer.from(await (await fetch(BASE + hUrl1)).arrayBuffer());
  await api("PUT", `/fundraising/campaigns/${cid}`, tok, { heroImageData: pngUri(1100, 550) });
  const [cRow1] = await q(`SELECT hero_image_url FROM campaigns WHERE id=$1`, [cid]);
  ok("hero replaced", cRow1.hero_image_url !== hUrl1);
  const hRowOld = await assetRow(idOf(hUrl1));
  ok("RETENTION: replaced hero survives soft-deleted, bytes intact",
    !!hRowOld && hRowOld.deleted_at != null && hRowOld.data && Buffer.compare(Buffer.from(hRowOld.data, "base64"), hBytes) === 0,
    hRowOld ? "kept" : "ROW IS GONE");
  const hCmp = await hist("campaign.hero", cid);
  ok("HISTORY: hero changes recorded (create + replace)",
    hCmp.some(r => r.from_value === null && r.to_value === hUrl1)
    && hCmp.some(r => r.from_value === hUrl1 && r.to_value === cRow1.hero_image_url),
    hCmp.map(r => [r.from_value, r.to_value]));

  // ═══ 4) the same probe — portal-page widget images ═══════════════════════
  console.log("\n— probe: portal-page widget images —");
  const d1 = await api("PUT", "/portal-page/draft", tok, { widgets: [{ type: "image", image: pngUri(700, 500), caption: "w1" }] });
  const w1 = d1.body.draft?.[0]?.image;
  ok("widget image stored in draft", d1.status === 200 && /^\/portal-assets\/pa_/.test(w1 || ""));
  const w1bytes = Buffer.from(await (await fetch(BASE + w1)).arrayBuffer());
  const d2 = await api("PUT", "/portal-page/draft", tok, { widgets: [{ type: "image", image: pngUri(750, 500), caption: "w2" }] });
  const w2 = d2.body.draft?.[0]?.image;
  ok("widget image replaced via draft autosave path", w2 && w2 !== w1);
  const wRow = await assetRow(idOf(w1));
  ok("RETENTION: replaced widget image survives soft-deleted, bytes intact",
    !!wRow && wRow.deleted_at != null && wRow.data && Buffer.compare(Buffer.from(wRow.data, "base64"), w1bytes) === 0,
    wRow ? "kept" : "ROW IS GONE");
  const hPage = await hist("portal_page.draft", ORG);
  ok("HISTORY: draft asset-path changes recorded ([w1] → [w2])",
    hPage.some(r => JSON.stringify(r.from_value) === JSON.stringify([w1]) && JSON.stringify(r.to_value) === JSON.stringify([w2])),
    hPage.map(r => [r.from_value, r.to_value]));
  const pub = await api("POST", "/portal-page/publish", tok, {});
  ok("publish recorded in history (published null → [w2])", pub.status === 200
    && (await hist("portal_page.published", ORG)).some(r => JSON.stringify(r.to_value) === JSON.stringify([w2])));

  // ═══ 5) RESTORE — retained bytes you can actually get back ══════════════
  console.log("\n— restore: soft-delete a banner, restore it, pointer live again —");
  const rA = await api("PUT", "/portal-settings", tok, { headerImageData: pngUri(1300, 320) });
  const urlA = rA.body.header_image_url, idA = idOf(urlA);
  const bytesA = Buffer.from(await (await fetch(BASE + urlA)).arrayBuffer());
  const rB = await api("PUT", "/portal-settings", tok, { headerImageData: pngUri(1400, 340) });
  ok("banner A soft-deleted by the replacement", (await assetRow(idA))?.deleted_at != null);
  let scriptOut = "";
  try {
    scriptOut = execFileSync("node", [path.join(__dirname, "..", "scripts", "restore-asset.js"), "restore", idA, "--repoint"], {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest", DB_SSL: "disable" },
      encoding: "utf8",
    });
  } catch (e) { scriptOut = String(e.stdout || "") + String(e.stderr || e.message); }
  const rowA = await assetRow(idA);
  ok("restore-asset.js un-deletes the object", !!rowA && rowA.deleted_at == null, scriptOut.slice(0, 300));
  const served = await fetch(BASE + urlA);
  ok("restored bytes serve BYTE-IDENTICALLY", served.status === 200
    && Buffer.compare(Buffer.from(await served.arrayBuffer()), bytesA) === 0);
  const cfg = await (await fetch(BASE + `/portal/${SLUG}/config`)).json();
  ok("--repoint makes the pointer LIVE on the portal again", cfg.theme?.headerImage === urlA, cfg.theme?.headerImage);
  ok("the restore itself is history-logged", (await hist("portal_settings.header_image", ORG))
    .some(r => r.from_value === rB.body.header_image_url && r.to_value === urlA));

  // ═══ 6) PURGE — the retention boundary in both directions ═══════════════
  console.log("\n— purge: 89 days survives, 91 purges, referenced-but-old never purges —");
  // Manufacture three soft-deleted objects via the ordinary app path.
  const mkP = async (w) => {
    const u = await api("POST", "/impact-updates", tok, { title: "purge fixture", orgWide: true, photos: [pngUri(w, 400)] });
    const p = u.body.photos[0];
    await api("DELETE", `/impact-updates/${u.body.id}`, tok);
    return idOf(p);
  };
  const idX = await mkP(601), idY = await mkP(602), idZ = await mkP(603);
  // An org-B soft-deleted object must be untouched by org A's purge run.
  const uB = await api("POST", "/impact-updates", tokB, { title: "b fixture", orgWide: true, photos: [pngUri(604, 400)] });
  const idB = idOf(uB.body.photos[0]);
  await api("DELETE", `/impact-updates/${uB.body.id}`, tokB);
  await q(`UPDATE portal_assets SET deleted_at = NOW() - INTERVAL '89 days' WHERE id=$1`, [idX]);
  await q(`UPDATE portal_assets SET deleted_at = NOW() - INTERVAL '91 days' WHERE id=$1`, [idY]);
  await q(`UPDATE portal_assets SET deleted_at = NOW() - INTERVAL '95 days' WHERE id=$1`, [idB]);
  // Z: soft-deleted long ago but STILL REFERENCED by a live pointer (the
  // inconsistent state the purge must never destroy).
  await q(`UPDATE portal_assets SET deleted_at = NOW() - INTERVAL '91 days' WHERE id=$1`, [idZ]);
  await q(`UPDATE portal_settings SET logo_url = $1 WHERE org_id=$2`, ["/portal-assets/" + idZ, ORG]);

  const purge = await api("POST", "/assets/run-purge", tok, {});
  ok("purge ops route runs (admin, caller's org)", purge.status === 200, purge.body);
  ok("89-day object SURVIVES (inside the window)", (await assetRow(idX)) != null && (await assetRow(idX)).deleted_at != null);
  ok("91-day object is PURGED (row + bytes gone)", (await assetRow(idY)) == null);
  const purgeLog = await q(`SELECT * FROM asset_purge_log WHERE org_id=$1`, [ORG]).catch(() => []);
  ok("the purge is itself logged (asset id, kind, bytes recorded)",
    purgeLog.some(r => r.asset_id === idY && r.kind === "impact" && r.bytes > 0), purgeLog.map(r => r.asset_id));
  const zRow = await assetRow(idZ);
  ok("referenced-but-old is NEVER purged — it is self-healed back to live", !!zRow && zRow.deleted_at == null, zRow ? "deleted_at=" + zRow.deleted_at : "PURGED — the guard failed");
  ok("self-healed asset serves again (the pointer was live; 404 was the bug)", (await fetch(BASE + "/portal-assets/" + idZ)).status === 200);
  ok("another org's soft-deleted object is untouched by this org's run", (await assetRow(idB)) != null);
  const purgeAgain = await api("POST", "/assets/run-purge", tok, {});
  ok("purge is idempotent (second run destroys nothing new)", purgeAgain.status === 200 && purgeAgain.body.purged === 0, purgeAgain.body);

  // ═══ 7) /health visibility ══════════════════════════════════════════════
  console.log("\n— health —");
  const health = await (await fetch(BASE + "/health")).json();
  ok("health surfaces the soft-deleted count (there is something to restore)",
    typeof health.themeAssets?.softDeleted === "number" && health.themeAssets.softDeleted > 0, health.themeAssets);

  // ═══ 8) THE BATTERY — one destruction seam, every call site classified ══
  console.log("\n— battery: destruction primitives live ONLY in the seam; call sites are enumerated —");
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const SRC = ["server.js", "db.js", "auth.js", "branding.js", "assetStore.js"];
  for (const d of ["routes", "scripts", "scripts/lib"]) {
    const dir = path.join(__dirname, "..", d);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith(".js")) SRC.push(path.join(d, f));
  }
  const store = read("assetStore.js");
  const seamStart = store.indexOf("── DESTRUCTION SEAM"), seamEnd = store.indexOf("── END DESTRUCTION SEAM");
  ok("assetStore.js carries a marked destruction seam", seamStart > -1 && seamEnd > seamStart);
  const seam = seamStart > -1 ? store.slice(seamStart, seamEnd) : "";
  ok("the seam contains the ONE hard delete + the ONE S3 delete call",
    (seam.match(/DELETE\s+FROM\s+portal_assets/gi) || []).length === 1
    && (seam.match(/\bs3Delete\s*\(/g) || []).length === 1);

  // Property 1: destruction primitives appear NOWHERE outside the seam.
  const offenders = [];
  for (const f of SRC) {
    let text; try { text = read(f); } catch { continue; }
    if (f === "assetStore.js") text = text.slice(0, seamStart) + text.slice(seamEnd); // seam excluded
    for (const re of [/DELETE\s+FROM\s+portal_assets/gi, /\bs3Delete\s*\(/g, /DROP\s+TABLE\s+portal_assets/gi, /TRUNCATE[^;\n]*portal_assets/gi]) {
      // The s3Delete DEFINITION (and its recursive naming) lives in assetStore.
      const hits = (text.match(re) || []).filter(h => !(f === "assetStore.js" && /^async function/.test(h)));
      if (f === "assetStore.js" && re.source.includes("s3Delete")) {
        // outside the seam, only the function DEFINITION may mention s3Delete(
        const defs = (text.match(/async function s3Delete\s*\(/g) || []).length;
        if (hits.length > defs) offenders.push(f + " calls s3Delete outside the seam");
        continue;
      }
      if (hits.length) offenders.push(`${f}: ${re} × ${hits.length}`);
    }
  }
  ok("NO file destroys portal_assets rows or S3 objects outside the seam — a bypassing call site fails here",
    offenders.length === 0, offenders);

  // Property 2: soft-delete writes live only in assetStore.js.
  const softDeleteOffenders = SRC.filter(f => f !== "assetStore.js")
    .filter(f => { try { return /UPDATE\s+portal_assets\s+SET\s+deleted_at\s*=\s*NOW\(\)/i.test(read(f)); } catch { return false; } });
  ok("soft-delete stamping is the store's job alone", softDeleteOffenders.length === 0, softDeleteOffenders);

  // Property 3: every refcount-affecting call site is CLASSIFIED. A new
  // prune/put call site (even a well-behaved one) fails until it is added
  // here — the same total-classification discipline as script-guards.
  const CLASSIFIED = {
    // file → { fnName: expectedCallCount }  (definitions excluded)
    "server.js": {
      putThemeAsset: 4,            // theme upload, impact photos, campaign hero, widget image
      pruneThemeAssets: 1,         // PUT /portal-settings (replace/clear)
      pruneUnreferencedAssets: 3,  // pruneImpactAssets / pruneCampaignAssets / pruneWidgetAssets bodies
      pruneImpactAssets: 3,        // impact PUT, impact DELETE, (helper def excluded)
      pruneCampaignAssets: 2,      // campaign PUT (hero change), campaign DELETE
      pruneWidgetAssets: 2,        // draft PUT, revert
      rescueLegacyImageValue: 3,   // portal-settings legacy *_data, impact legacy photos (PUT+DELETE)
    },
    "assetStore.js": { putThemeAsset: 0, pruneUnreferencedAssets: 0, pruneThemeAssets: 1 /* alias def calls through */ },
  };
  const callCount = (text, name) => {
    const all = (text.match(new RegExp(`\\b${name}\\s*\\(`, "g")) || []).length;
    const defs = (text.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(|const\\s+${name}\\s*=`, "g")) || []).length;
    return all - defs;
  };
  const misclassified = [];
  for (const [file, fns] of Object.entries(CLASSIFIED)) {
    const text = read(file);
    for (const [fn, expected] of Object.entries(fns)) {
      const got = callCount(text, fn);
      if (got !== expected) misclassified.push(`${file}: ${fn} has ${got} call sites, ${expected} classified`);
    }
  }
  // …and no OTHER product file calls into the store's mutation surface at all.
  for (const f of SRC) {
    if (f === "server.js" || f === "assetStore.js") continue;
    let text; try { text = read(f); } catch { continue; }
    for (const fn of ["putThemeAsset", "pruneThemeAssets", "pruneUnreferencedAssets", "purgeExpiredAssets", "restoreAsset"]) {
      if (f.startsWith("scripts") && f.endsWith("restore-asset.js")) continue; // the classified restore script
      if (callCount(text, fn) > 0) misclassified.push(`${f} calls ${fn} — classify it in asset-retention.test.js`);
    }
  }
  ok("every prune/put call site is classified — an unclassified one fails the battery", misclassified.length === 0, misclassified);

  // Property 4: the retention window is ONE named constant.
  ok("ASSET_RETENTION_DAYS = 90 is defined once, in assetStore.js",
    (store.match(/ASSET_RETENTION_DAYS\s*=\s*90\b/g) || []).length === 1
    && !/ASSET_RETENTION_DAYS\s*=\s*\d/.test(read("server.js")));
  ok("the purge SQL uses the constant, not a scattered literal",
    /INTERVAL '\$\{ASSET_RETENTION_DAYS\}|ASSET_RETENTION_DAYS/.test(seam) || /ASSET_RETENTION_DAYS/.test(store.replace(/ASSET_RETENTION_DAYS\s*=\s*90/, "")));

  // Property 5: the purge's live-reference collector must know every pointer
  // table that putThemeAsset kinds are stored into (drift here = purge could
  // destroy a referenced object).
  for (const t of ["portal_settings", "impact_updates", "campaigns", "portal_pages"]) {
    ok(`collectLiveAssetRefs reads ${t}`, new RegExp(`collectLiveAssetRefs[\\s\\S]*?FROM ${t}`).test(store));
  }
  // dbFallback interaction (BUILD-51b alarm): soft-deleted rows are retained
  // BY DESIGN and must not count as failed-S3-put alarm rows.
  ok("dbFallbackRows excludes soft-deleted rows", /storage = 'db' AND deleted_at IS NULL/.test(store));
  // getThemeAsset never serves a soft-deleted object (a removed image stays
  // removed from the public URL; restore is the way back).
  ok("getThemeAsset filters deleted_at", /getThemeAsset[\s\S]*?deleted_at IS NULL/.test(store));

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
