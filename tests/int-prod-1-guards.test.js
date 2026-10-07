// INT-PROD-1 — guardsOk counts failed S3 puts, not the rows Steward keeps in
// Postgres on purpose, and /health names the guard that failed.
//
// On prod (7 Oct 2026) /health read guardsOk:false with every guard clean but
// one: themeAssets.dbFallbackRows was 28 while dbFallbackSinceBoot was 0. The
// demo seed writes exactly 28 assets with storage='db' (event 5, logo 1,
// media 16, sheetfile 3, video_thanks 1, volpage 2), and the count read every
// storage='db' row as a failed S3 put. So each re-seed of the demo held the
// one paging field false, and nothing said which guard.
//
//   §1  a row written to Postgres BY DESIGN (the seed's shape) does not count
//   §2  a put whose S3 upload fails DOES count (the alarm still fires)
//   §3  guardFailures names the failing guard and nothing else
//   §4  /health carries guardsFailed, and it agrees with guardsOk
//
// What turns it red: counting storage='db' without s3_fallback (main before
// this build) turns §1 red; dropping the s3_fallback flag from the catch in
// assetStore.putThemeAsset turns §2 red.
//
// Standard scratch stack (tests/README.md).

// S3 "configured" at a port nothing listens on, so a put genuinely fails and
// takes the fallback path. Set before assetStore reads it.
process.env.PORTAL_ASSETS_S3_ENDPOINT = "http://127.0.0.1:9";
process.env.PORTAL_ASSETS_S3_KEY = "int-prod-1";
process.env.PORTAL_ASSETS_S3_SECRET = "int-prod-1";
process.env.PORTAL_ASSETS_S3_BUCKET = "int-prod-1";
process.env.PORTAL_ASSETS_S3_URL_STYLE = "path";

const crypto = require("crypto");
const { BASE, ok, summary, q, closeDb } = require("./helpers");
const assetStore = require("../assetStore");
const { guardFailures, computeGuardsOk } = require("../guards");

const ORG = "org_intprod1g";

async function clear() { await q(`DELETE FROM portal_assets WHERE org_id=$1`, [ORG]); }

(async () => {
  console.log("INT-PROD-1 — guardsOk counts failed S3 puts only, and /health names the failing guard\n");
  await clear();

  // ── §1 · A ROW IN POSTGRES BY DESIGN DOES NOT COUNT ─────────────────────
  const before = await assetStore.refreshAssetFallbackCount();
  ok("§1 the fallback count reads a number while S3 is configured", typeof before === "number", before);
  // Exactly the INSERT scripts/seed-demo.js makes for a volunteer-page image.
  await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,storage,data,is_public)
           VALUES ($1,$2,'volpage','image/webp',4,'db',$3,TRUE)`,
          ["pa_intprod1seed" + crypto.randomBytes(4).toString("hex"), ORG, Buffer.from("seed").toString("base64")]);
  const afterSeed = await assetStore.refreshAssetFallbackCount();
  ok("§1 a seeded Postgres asset is not counted as a failed S3 put", afterSeed === before, { before, afterSeed });

  // ── §2 · A FAILED S3 PUT STILL COUNTS ──────────────────────────────────
  const sinceBoot0 = assetStore.assetHealth().dbFallbackSinceBoot;
  const put = await assetStore.putThemeAsset({ orgId: ORG, kind: "media", contentType: "image/png",
    buffer: crypto.randomBytes(64) });
  const [row] = await q(`SELECT storage, s3_fallback FROM portal_assets WHERE id=$1`, [put.id]);
  ok("§2 a put whose S3 upload fails lands in Postgres marked as a fallback",
     row && row.storage === "db" && row.s3_fallback === true, row);
  const afterFail = await assetStore.refreshAssetFallbackCount();
  ok("§2 …and the fallback count goes up by exactly one", afterFail === before + 1, { before, afterFail });
  ok("§2 …and the since-boot counter saw it", assetStore.assetHealth().dbFallbackSinceBoot === sinceBoot0 + 1);

  // ── §3 · THE FAILING GUARD BY NAME ─────────────────────────────────────
  const now = Date.now();
  const clean = {
    bootAt: now - 60 * 60 * 1000,
    reconciliation: { checkedAt: new Date(now - 60000).toISOString(), unrecordedCharges: 0, orphanGifts: 0, accountsErrored: 0 },
    webhook: { checked: true, missingCount: 0 },
    chartSelfHeals: 0, dbFallbackRows: 0, failedPending: 0,
  };
  ok("§3 a clean state fails no guard", guardFailures(clean, now).length === 0 && computeGuardsOk(clean, now) === true);
  const prodDay = { ...clean, dbFallbackRows: 28 };
  ok("§3 the 7 Oct prod state names themeAssets.dbFallbackRows and only it",
     JSON.stringify(guardFailures(prodDay, now)) === JSON.stringify(["themeAssets.dbFallbackRows"]) && computeGuardsOk(prodDay, now) === false,
     guardFailures(prodDay, now));
  const stale = { ...clean, reconciliation: { ...clean.reconciliation, checkedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() } };
  ok("§3 a reconciliation that stopped running is named as stale",
     JSON.stringify(guardFailures(stale, now)) === JSON.stringify(["reconciliation.stale"]), guardFailures(stale, now));

  // ── §4 · /health SAYS WHICH ────────────────────────────────────────────
  const h = await fetch(BASE + "/health").then(r => r.json());
  ok("§4 /health carries guardsFailed as a list of names", Array.isArray(h.guardsFailed) && h.guardsFailed.every(n => typeof n === "string"), h.guardsFailed);
  ok("§4 …and guardsOk is true exactly when that list is empty", Array.isArray(h.guardsFailed) && h.guardsOk === (h.guardsFailed.length === 0),
     { guardsOk: h.guardsOk, guardsFailed: h.guardsFailed });

  await clear();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await clear(); await closeDb(); } catch {} process.exit(1); });
