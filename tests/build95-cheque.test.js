// BUILD-95 — A PICTURE OF THE CHEQUE.
//
// A treasurer photographs each cheque as she enters it, so that three months
// later "did Margaret really write $250?" has an answer that is the cheque
// rather than somebody's memory.
//
// The properties worth pinning are the ones where this could go wrong QUIETLY:
//   · the money is the point and the picture is the evidence — a photo that
//     will not store must NOT cost her the deposit;
//   · …and it must not be swallowed either, because she has the cheque in her
//     hand at that moment, which is the only time re-taking it is free;
//   · a cheque image is the most sensitive picture this product holds, so it
//     rides the SIGNED, EXPIRING, PRIVATE door — never a public URL;
//   · and the retention sweep must never destroy it.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");
const { ASSET_ID_RE } = require("../assetStore");

const ORG = "org_b95c";

async function realPng(w, h) {
  const sharp = require("sharp");
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 240, g: 240, b: 230 } } }).png().toBuffer();
}
const uri = (b) => "data:image/png;base64," + b.toString("base64");

async function fixture() {
  for (const t of ["fin_transactions", "interactions", "threads", "gifts", "imports", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Cheque Arts','b95c',1,'active','team','America/New_York')
           ON CONFLICT (id) DO UPDATE SET subscription_status='active', plan='team'`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b95c',$1,'b95c@test.local',$2,'Allie Barnett','admin')
           ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`DELETE FROM fin_funds WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO fin_funds (id,org_id,name,description,restricted)
           VALUES ('ff_b95c',$1,'General Operating','Unrestricted',false)
           ON CONFLICT (id) DO NOTHING`, [ORG]);
  await q(`UPDATE orgs SET default_fund_id='ff_b95c' WHERE id=$1`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage)
           VALUES ('d_b95c',$1,'Margaret Chen','margaret@b95c.test',500,2,'mid','steward')
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, total_giving=500, gift_count=2`, [ORG]);
}

(async () => {
  await fixture();
  const tok = await login("b95c@test.local", "loadtest1234");
  const cheque = await realPng(1200, 520);        // a cheque is WIDE

  console.log("— a cheque keeps its shape —");
  const gift = await api("POST", "/donors/d_b95c/gifts", tok, { amount: 250, date: "2026-09-20", type: "cash" });
  const giftId = gift.body?.gift?.id || gift.body?.id;
  ok("a gift exists to attach to", !!giftId, gift.body);
  const up = await api("POST", `/gifts/${giftId}/cheque`, tok, { image: uri(cheque) });
  ok("the photo attaches", up.status === 200, up.body);
  const [g] = await q(`SELECT cheque_asset_id FROM gifts WHERE id=$1`, [giftId]);
  ok("the gift keeps an asset id", ASSET_ID_RE.test(g.cheque_asset_id || ""), g.cheque_asset_id);
  const [a] = await q(`SELECT width, height, content_type FROM portal_assets WHERE id=$1`, [g.cheque_asset_id]);
  ok("it is NOT cropped square — a square cheque is a cheque you cannot read",
    a.width !== a.height && a.width > a.height, [a.width, a.height]);
  ok("…and it is stored as WebP", a.content_type === "image/webp", a.content_type);

  console.log("— the most sensitive image in the product rides the signed door —");
  ok("the URL is signed and expiring, never a public path",
    /^\/person-photos\/pa_[a-f0-9]{24}\?e=\d+&s=[a-f0-9]{32}$/.test(up.body.chequeUrl || ""), up.body.chequeUrl);
  const served = await fetch(BASE + up.body.chequeUrl);
  ok("it serves", served.status === 200);
  ok("…privately", /private/.test(served.headers.get("cache-control") || ""));
  ok("…and not without the signature", (await fetch(BASE + `/person-photos/${g.cheque_asset_id}`)).status === 403);

  console.log("— the retention sweep must never destroy evidence —");
  const { collectLiveAssetRefs } = require("../assetStore");
  const refs = await collectLiveAssetRefs(ORG);
  ok("a photographed cheque is a LIVE reference", refs.has(g.cheque_asset_id), [...refs].slice(0, 3));

  console.log("— a deposit sheet carries a photo per line —");
  const rows = [
    { line: 1, name: "Margaret Chen", amount: "250.00", memo: "" },
    { line: 2, name: "Margaret Chen", amount: "40.00",  memo: "" },
  ];
  const photos = { 1: uri(cheque), 2: uri(cheque) };
  const plan = await api("POST", "/deposits/plan", tok,
    { rows, depositDate: "2026-09-21", slipTotal: "290.00" });
  ok("the sheet plans", plan.status === 200, plan.body && plan.body.error);
  const commit = await api("POST", "/deposits/commit", tok,
    { lines: plan.body.lines.map(l => ({ ...l, chequeImage: photos[l.line] })),
      rows, slipTotal: "290.00", depositDate: "2026-09-21", name: "Sunday" });
  ok("it commits", commit.status === 201, commit.body);
  ok("both cheques were photographed", commit.body.chequePhotos === 2, commit.body.chequePhotos);
  const shot = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND cheque_asset_id IS NOT NULL`, [ORG]);
  ok("…and both gifts carry theirs", shot[0].n === 3, shot[0].n);   // 2 + the one attached above

  console.log("— A BAD PHOTO MUST NOT COST HER THE DEPOSIT —");
  const before = (await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]))[0].n;
  const rows2 = [{ line: 1, name: "Margaret Chen", amount: "75.00", memo: "" }];
  const BAD = "data:image/png;base64,bm90YW5pbWFnZQ==";
  const plan2 = await api("POST", "/deposits/plan", tok, { rows: rows2, depositDate: "2026-09-22", slipTotal: "75.00" });
  const commit2 = await api("POST", "/deposits/commit", tok,
    { lines: plan2.body.lines.map(l => ({ ...l, chequeImage: BAD })),
      rows: rows2, slipTotal: "75.00", depositDate: "2026-09-22", name: "Monday" });
  ok("the deposit still commits", commit2.status === 201, commit2.body);
  ok("the gift landed", (await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]))[0].n === before + 1);
  ok("…with no cheque on it", commit2.body.chequePhotos === 0);
  // …AND IT IS NOT SWALLOWED. She has the cheque in her hand right now.
  ok("the failure is REPORTED, naming the line",
    Array.isArray(commit2.body.chequeFailures) && commit2.body.chequeFailures.length === 1
    && commit2.body.chequeFailures[0].line === 1, commit2.body.chequeFailures);

  console.log("— and the ordinary refusals —");
  ok("a non-image is refused", (await api("POST", `/gifts/${giftId}/cheque`, tok, { image: "hello" })).status === 400);
  ok("another org's gift is a 404", (await api("POST", "/gifts/g_not_mine/cheque", tok, { image: uri(cheque) })).status === 404);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
