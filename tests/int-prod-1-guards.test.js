// INT-PROD-1 · guardsOk counts failed S3 puts, not the rows Steward keeps in
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
//   §2  a put whose S3 upload fails is refused with a 503 and stores nothing (FIX-58)
//   §3  guardFailures names the failing guard and nothing else
//   §4  /health carries guardsFailed, and it agrees with guardsOk
//
// What turns it red: counting storage='db' without s3_fallback (main before
// this build) turns §1 red; writing a failed put to Postgres again (main before
// FIX-58) turns §2 red.
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
  console.log("INT-PROD-1 · guardsOk counts failed S3 puts only, and /health names the failing guard\n");
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

  // ── §2 · FIX-58: A FAILED S3 PUT IS REFUSED, NEVER KEPT IN POSTGRES ───
  // Prod read themeAssets.dbFallbackRows FALSE: with S3 configured, a put that
  // failed every try was written to Postgres (s3_fallback). Now the upload
  // fails loudly and nothing is stored. Red on main: the put resolved and a
  // Postgres row appeared.
  const failed0 = assetStore.assetHealth().s3PutFailedSinceBoot || 0;
  const rows0 = (await q(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE org_id=$1`, [ORG]))[0].n;
  let thrown = null;
  try {
    await assetStore.putThemeAsset({ orgId: ORG, kind: "media", contentType: "image/png", buffer: crypto.randomBytes(64) });
  } catch (e) { thrown = e; }
  ok("§2 a put whose S3 upload fails every try is refused, loudly", !!thrown && thrown.code === "asset_store_unavailable" && thrown.status === 503, thrown && thrown.message);
  const rows1 = (await q(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE org_id=$1`, [ORG]))[0].n;
  ok("§2 …and nothing is written to Postgres", rows1 === rows0, { rows0, rows1 });
  const afterFail = await assetStore.refreshAssetFallbackCount();
  ok("§2 …so the fallback count does not move", afterFail === before, { before, afterFail });
  ok("§2 …and /health's since-boot counter of refused puts saw it", assetStore.assetHealth().s3PutFailedSinceBoot === failed0 + 1, assetStore.assetHealth());
  // The same refusal through a real upload route answers 503 with its sentence.
  // (The server under test has no bucket; this module's env does, so the route
  // half is the error handler's mapping, checked on its source.)
  const srvSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");
  ok("§2 the error handler answers an asset-store refusal with a 503", /asset_store_unavailable[\s\S]{0,200}status\(503\)/.test(srvSrc));

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

  // ── §5 · FIX-47 · A STALE MAILBOX IS ITS OWN LINE, THE SMOKE STAYS GREEN ──
  // scripts/status.js against a local stand-in for prod: every smoke route
  // answers 200 and one Gmail mailbox has not read in two hours. The smoke used
  // to read FAILING here. No address is on /health, so none is printed.
  const http = require("http");
  const { testNow } = require("./clock");
  const lastRead = new Date(testNow() - 2.2 * 3600e3).toISOString();
  const stub = http.createServer((req, res) => {
    const send = (code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (req.url === "/health") return send(200, { buildSha: "f47f47f", guardsOk: true, guardsFailed: [],
      mailboxSync: { connections: 2, stale: 1, checkedAt: new Date(testNow()).toISOString(), staleList: [{ provider: "google", lastReadAt: lastRead, refused: false }] } });
    if (req.url === "/auth/login") return send(200, { token: "stub" });
    if (req.url.startsWith("/donors/export/csv")) return send(200, "Name,Email\nA,a@example.org\n", "text/csv");
    if (req.url.startsWith("/custom-fields")) return send(200, []);
    if (req.url === "/public/checkout-signin") return send(200, { route: "checkout-signin" });
    if (req.url === "/signed-up") return send(200, "<html></html>", "text/html");
    return send(200, '<html><head><meta name="build-sha" content="f47f47f"></head></html>', "text/html");
  });
  await new Promise(r => stub.listen(0, r));
  const url = `http://localhost:${stub.address().port}`;
  const out = await new Promise(resolve => {
    const c = require("child_process").spawn(process.execPath, ["scripts/status.js"], { cwd: require("path").join(__dirname, ".."),
      env: { ...process.env, STATUS_BACKEND_URL: url, STATUS_FRONTEND_URL: url, STATUS_SKIP_AI: "1", NO_COLOR: "1" } });
    let o = ""; c.stdout.on("data", d => { o += d; }); c.stderr.on("data", d => { o += d; }); c.on("close", () => resolve(o.replace(/\x1b\[[0-9;]*m/g, "")));
  });
  stub.close();
  const smokeRow = (out.split("\n").find(l => /^\s*prod smoke/.test(l)) || "");
  ok("§5 every route answered 200, so the smoke is ok, not FAILING", /prod smoke\s+ok\b/.test(smokeRow) && !/PROD SMOKE FAILING/.test(out), smokeRow || out.slice(0, 600));
  ok("§5 the stale mailbox is its own line, with no address", /Gmail mailbox last read 2h ago, reconnect in Connections/.test(out) && !/@/.test(out.split("\n").filter(l => /mailbox/i.test(l)).join(" ")), out.slice(0, 900));

  await clear();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await clear(); await closeDb(); } catch {} process.exit(1); });
