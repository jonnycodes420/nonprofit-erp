// BUILD-94 Part 1 — A FACE ON EVERY PROFILE.
//
// One test, five properties, the ones named in the brief:
//   1. upload → the bytes are resized to a 512 square WebP and the original is
//      discarded (nothing anywhere holds the master);
//   2. the payload URL is SIGNED and EXPIRING — it works, and the same URL
//      with a past expiry or a tampered signature does not;
//   3. org A cannot fetch org B's photo by path, however it asks;
//   4. a row with a dead photo URL imports, is left with a note ON THE ROW,
//      and has no photo — and the import itself is untouched;
//   5. the SSRF guard refuses every private/metadata/non-https address the
//      BUILD-37 G5 rule names, before a request is made.
//
// Standard scratch stack.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");
const { ASSET_ID_RE } = require("../assetStore");
const personPhoto = require("../personPhoto");

const ORG_A = "org_b94_a", ORG_B = "org_b94_b";

// A REAL png — sharp has to decode it, so a hand-built IHDR header is not
// enough here (the theme suites can get away with one; a resize cannot).
async function realPng(w, h, rgb) {
  const sharp = require("sharp");
  return sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).png().toBuffer();
}
const uriOf = (buf, mime = "image/png") => `data:${mime};base64,${buf.toString("base64")}`;

async function fixture() {
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["portal_assets", "asset_pointer_history", "gifts", "interactions", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Face Arts','b94-a',1,'active','core')`, [ORG_A]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Other Arts','b94-b',1,'active','core')`, [ORG_B]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b94_a',$1,'b94-a@test.local',$2,'Allie Barnett','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b94_b',$1,'b94-b@test.local',$2,'Other Admin','admin')`, [ORG_B, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_b94_a',$1,'Renee Castillo','renee@b94.test',2500,3,'mid','steward')`, [ORG_A]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_b94_b',$1,'Bill Harmon','bill@b94.test',400,1,'mid','steward')`, [ORG_B]);
}

const rawGet = (p, token) => fetch(BASE + p, { headers: token ? { Authorization: "Bearer " + token } : {} });

(async () => {
  await fixture();
  const tokA = await login("b94-a@test.local", "loadtest1234");
  const tokB = await login("b94-b@test.local", "loadtest1234");

  // ── 1) upload → 512 square WebP, original discarded ──────────────────────
  console.log("— the upload —");
  const big = await realPng(1400, 900, { r: 20, g: 92, b: 58 });
  const up = await api("POST", "/donors/d_b94_a/photo", tokA, { image: uriOf(big) });
  ok("upload accepted", up.status === 200, up.body);
  ok("the payload carries a photo URL", /^\/person-photos\/pa_[a-f0-9]{24}\?e=\d+&s=[a-f0-9]{32}$/.test(up.body.photoUrl || ""), up.body.photoUrl);

  const [drow] = await q(`SELECT photo_asset_id FROM donors WHERE id='d_b94_a'`);
  ok("the row keeps an asset id, not a path and not bytes", ASSET_ID_RE.test(drow.photo_asset_id || ""), drow.photo_asset_id);
  const [arow] = await q(`SELECT * FROM portal_assets WHERE id=$1`, [drow.photo_asset_id]);
  ok("stored under the person kind, scoped to the org", arow && arow.kind === "person" && arow.org_id === ORG_A, arow && [arow.kind, arow.org_id]);
  ok("stored as WebP at 512 square", arow.content_type === "image/webp" && arow.width === 512 && arow.height === 512,
    [arow.content_type, arow.width, arow.height]);
  ok("the original is discarded — nothing holds 1400x900",
    arow.bytes < big.length && arow.width === 512, [arow.bytes, big.length]);

  // ── 2) the signed URL works, and only while it is signed and current ─────
  console.log("— the signed, expiring URL —");
  const served = await rawGet(up.body.photoUrl);
  ok("the signed URL serves the bytes", served.status === 200 && served.headers.get("content-type") === "image/webp",
    [served.status, served.headers.get("content-type")]);
  ok("it is cached PRIVATE, never in a shared cache", /private/.test(served.headers.get("cache-control") || ""),
    served.headers.get("cache-control"));

  const assetId = drow.photo_asset_id;
  const past = personPhoto.signPhotoUrl({ orgId: ORG_A, assetId, now: Date.now() - 60_000, ttlMs: 1000 });
  ok("an expired signature is refused", (await rawGet(past)).status === 403);
  const tampered = up.body.photoUrl.replace(/s=([a-f0-9])/, (m, c) => "s=" + (c === "a" ? "b" : "a"));
  ok("a tampered signature is refused", (await rawGet(tampered)).status === 403);
  ok("no signature at all is refused", (await rawGet(`/person-photos/${assetId}`)).status === 403);

  // ── 3) org A cannot fetch org B's photo by path ──────────────────────────
  console.log("— one tenant's face is not another's —");
  const upB = await api("POST", "/donors/d_b94_b/photo", tokB, { image: uriOf(await realPng(600, 600, { r: 201, g: 168, b: 76 })) });
  ok("org B can photograph its own donor", upB.status === 200, upB.body);
  const [drowB] = await q(`SELECT photo_asset_id FROM donors WHERE id='d_b94_b'`);
  const bId = drowB.photo_asset_id;

  // The realistic attack: org A holds a valid signature of its OWN and swaps
  // the asset id for org B's. The signature is over the org on the STORED row,
  // so it recomputes to a different digest.
  const swapped = up.body.photoUrl.replace(assetId, bId);
  ok("org A's signature does not open org B's photo", (await rawGet(swapped)).status === 403);
  // And a signature org A could mint for ITSELF over B's id is equally dead.
  const forged = personPhoto.signPhotoUrl({ orgId: ORG_A, assetId: bId });
  ok("a signature naming the wrong org is refused", (await rawGet(forged)).status === 403);
  ok("org B's own URL still works", (await rawGet(upB.body.photoUrl)).status === 200);

  // The org-wide map is org-scoped too.
  const mapA = await api("GET", "/people/photos", tokA);
  ok("the photo map carries only this org's people",
    mapA.status === 200 && !!mapA.body.photos["d_b94_a"] && mapA.body.photos["d_b94_b"] === undefined,
    Object.keys(mapA.body.photos || {}));
  const mapB = await api("GET", "/people/photos", tokB);
  ok("and the other org sees only its own", !!mapB.body.photos["d_b94_b"] && mapB.body.photos["d_b94_a"] === undefined);

  // ── 4) a row with a dead photo URL imports, with a note and no photo ─────
  console.log("— a dead photo URL on an import row —");
  const before = (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG_A]))[0].n;
  const imp = await api("POST", "/donors/import", tokA, {
    donors: [
      { name: "Photo Fine", email: "fine@b94.test", photo: "https://this-host-does-not-resolve-b94.invalid/a.jpg" },
      { name: "Photo Private", email: "priv@b94.test", photo: "https://169.254.169.254/latest/meta-data/" },
      { name: "No Photo At All", email: "none@b94.test" },
    ],
  });
  ok("the import succeeded", imp.status === 200 && imp.body.created === 3, imp.body);
  ok("it reported how many photos it queued", imp.body.photosQueued === 2, imp.body.photosQueued);
  ok("the rows are in the org", (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG_A]))[0].n === before + 3);

  const drain = await api("POST", "/photos/run", tokA, {});
  ok("the queue drained", drain.status === 200 && drain.body.scanned === 2, drain.body);
  ok("neither dead URL produced a photo", drain.body.fetched === 0 && drain.body.failed === 2, drain.body);
  const rows = await q(`SELECT name, photo_asset_id, photo_fetch_status, photo_fetch_error FROM donors WHERE org_id=$1 AND email LIKE '%@b94.test' ORDER BY name`, [ORG_A]);
  const byName = Object.fromEntries(rows.map(r => [r.name, r]));
  ok("the unreachable host left a note and no photo",
    byName["Photo Fine"].photo_asset_id === null && byName["Photo Fine"].photo_fetch_status === "failed"
    && !!byName["Photo Fine"].photo_fetch_error, byName["Photo Fine"]);
  // https on purpose. An http:// metadata URL is refused by the protocol check
  // one step earlier, which is correct but would mean this row never exercised
  // the rule it is here to exercise.
  ok("the metadata endpoint was refused BEFORE any request",
    byName["Photo Private"].photo_fetch_status === "failed"
    && /metadata endpoint/.test(byName["Photo Private"].photo_fetch_error || ""), byName["Photo Private"]);
  ok("a row with no photo column is never queued",
    byName["No Photo At All"].photo_fetch_status === null, byName["No Photo At All"]);
  ok("nothing else on the import moved — Renee still has her photo",
    (await q(`SELECT photo_asset_id FROM donors WHERE id='d_b94_a'`))[0].photo_asset_id === assetId);

  // ── 5) the G5 guard, exhaustively, as a unit ────────────────────────────
  console.log("— what the fetcher will not fetch —");
  const refused = [
    "http://example.org/a.jpg", "https://127.0.0.1/a.jpg", "https://10.0.0.5/a.jpg",
    "https://192.168.1.1/a.jpg", "https://172.16.0.1/a.jpg", "https://169.254.169.254/x",
    "https://metadata.google.internal/x", "https://localhost/a.jpg", "https://[::1]/a.jpg",
    "https://user:pw@example.org/a.jpg", "https://example.org:8080/a.jpg",
    "file:///etc/passwd", "data:image/png;base64,AAAA", "https://box.internal/a.jpg",
  ];
  const leaked = refused.filter(u => personPhoto.checkRemoteImageUrl(u).ok);
  ok("every private, non-https and metadata address is refused", leaked.length === 0, leaked);
  ok("an ordinary https photo URL is allowed", personPhoto.checkRemoteImageUrl("https://images.example.org/p/1.jpg").ok);

  // ── 6) remove ────────────────────────────────────────────────────────────
  console.log("— remove —");
  const del = await api("DELETE", "/donors/d_b94_a/photo", tokA);
  ok("remove accepted", del.status === 200 && del.body.photoUrl === null, del.body);
  ok("the row has no photo", (await q(`SELECT photo_asset_id FROM donors WHERE id='d_b94_a'`))[0].photo_asset_id === null);
  ok("and the URL minted a moment ago stops serving", (await rawGet(up.body.photoUrl)).status === 404);
  // The bytes are RETAINED, not destroyed — a mis-click is recoverable for 90
  // days, exactly like every other asset in the product.
  const [after] = await q(`SELECT deleted_at FROM portal_assets WHERE id=$1`, [assetId]);
  ok("the bytes went into the retention window, not the bin", after && after.deleted_at !== null, after);
  const hist = await q(`SELECT * FROM asset_pointer_history WHERE entity='donor.photo' AND entity_id='d_b94_a' ORDER BY created_at`);
  ok("both the set and the clear are in pointer history", hist.length === 2, hist.length);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
