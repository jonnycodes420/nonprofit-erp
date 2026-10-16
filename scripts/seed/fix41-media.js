// scripts/seed/fix41-media.js: FIX-41 Part 2. THE DEMO SHOWS PICTURES.
//
// Called with one line from scripts/seed-demo.js main(), after the auction,
// the event pages and the volunteer page are written. It only ever writes
// org_b72demo, through the `q` the seed hands it, and only seed-demo calls it.
//
//   · Ten of the twelve auction items get a photo (the jersey and the golf are
//     left without, so the demo also shows "Add a photo" where one belongs).
//   · Every giving page without a cover gets one, and the volunteer page too.
//   · The event pages' existing pictures get their words for a screen reader.
//
// The photographs are real ones in the repo (scripts/demo-assets/README.md and
// client/public/ASSETS.md say where each came from and its licence). They are
// stored the way the asset store's Postgres fallback stores them, with the id
// assetStore.assetIdFor would mint for kind "picture".
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const ROOT = path.join(__dirname, "..", "..");

async function storePhoto(q, org, file) {
  const raw = fs.readFileSync(path.join(ROOT, file));
  let buf = raw, ct = "image/jpeg", w = null, h = null;
  try {
    const sharp = require("sharp");
    const out = await sharp(raw).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    buf = out.data; ct = "image/webp"; w = out.info.width; h = out.info.height;
  } catch { /* the original JPEG is a fine photograph too */ }
  const id = "pa_" + sha(org + "|picture|" + ct + "|").slice(0, 8) + sha(buf).slice(0, 16);
  await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,width,height,storage,data,is_public)
           VALUES ($1,$2,'picture',$3,$4,$5,$6,'db',$7,TRUE) ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, is_public = TRUE`,
    [id, org, ct, buf.length, w, h, buf.toString("base64")]);
  return `/portal-assets/${id}`;
}

const A = f => `scripts/demo-assets/${f}`;
const L = f => `client/public/landing/${f}`;
// item id → [file, words for a screen reader, focal x, focal y]
const AUCTION = {
  aui_b72_01: [A("auction-lake-canoe.jpg"), "A woman paddling a canoe on a still lake under pine trees", 0.45, 0.6],
  aui_b72_02: [A("auction-chef-table.jpg"), "Onions, greens and peppercorns on a wooden board", 0.5, 0.5],
  aui_b72_03: [A("auction-harbor-boats.jpg"), "Sailing boats moored in a harbor", 0.5, 0.5],
  aui_b72_05: [A("demo-impact-exhibition.jpg"), "Paintings hung on a gallery wall", 0.5, 0.45],
  aui_b72_06: [A("auction-aquarium.jpg"), "An orange jellyfish drifting in blue water", 0.4, 0.5],
  aui_b72_07: [A("auction-wine-grapes.jpg"), "Dark grapes on the vine", 0.5, 0.5],
  aui_b72_08: [A("auction-ski-snow.jpg"), "Snowy mountains above a valley", 0.5, 0.5],
  aui_b72_09: [A("auction-camera.jpg"), "A vintage camera resting on piano keys", 0.5, 0.5],
  aui_b72_10: [A("demo-impact-studio.jpg"), "Hands shaping clay on a potter's wheel", 0.5, 0.5],
  aui_b72_12: [A("auction-cooking.jpg"), "A bright salad in a bowl on a wooden board", 0.5, 0.5],
};
// The giving pages without a cover, in order, take these in turn.
const PAGE_PHOTOS = [
  [A("demo-hero-choir.jpg"), "Young singers on stage, mid-song", 0.5, 0.4],
  [L("two-young-volunteers-smiling-as-they-pack-food.jpg"), "Two young people smiling as they pack food", 0.5, 0.4],
  [A("demo-campaign-chapel.jpg"), "A sunlit hall with tall windows", 0.5, 0.45],
  [L("a-nonprofit-team-gathering-around-a-table-to-r.jpg"), "A team gathered around a table", 0.5, 0.45],
  [A("demo-impact-studio.jpg"), "Hands shaping clay on a potter's wheel", 0.5, 0.5],
];

async function seedFix41Media(q, ORG) {
  let items = 0;
  for (const [id, [file, alt, fx, fy]] of Object.entries(AUCTION)) {
    const url = await storePhoto(q, ORG, file);
    const r = await q(`UPDATE auction_items SET photos=$1::jsonb WHERE id=$2 AND org_id=$3 RETURNING id`,
      [JSON.stringify([{ url, alt, fx, fy }]), id, ORG]);
    items += r.length;
  }
  const pages = await q(`SELECT id, title FROM giving_pages WHERE org_id=$1 AND status='active' AND COALESCE(image_url,'')=''
                          AND COALESCE(page_kind,'give')='give' ORDER BY created_at, id`, [ORG]);
  for (let i = 0; i < pages.length; i++) {
    const [file, alt, fx, fy] = PAGE_PHOTOS[i % PAGE_PHOTOS.length];
    const url = await storePhoto(q, ORG, file);
    await q(`UPDATE giving_pages SET image_url=$1, image_meta=$2::jsonb WHERE id=$3 AND org_id=$4`,
      [url, JSON.stringify({ alt, fx, fy }), pages[i].id, ORG]);
  }
  const volUrl = await storePhoto(q, ORG, L("volunteers-handing-supplies-to-people-at-a-com.jpg"));
  const vol = await q(`UPDATE giving_pages SET image_url=$1, image_meta=$2::jsonb WHERE org_id=$3 AND page_kind='volunteer' RETURNING id`,
    [volUrl, JSON.stringify({ alt: "Volunteers handing out supplies at a community table", fx: 0.5, fy: 0.45 }), ORG]);
  await q(`UPDATE events SET hero_meta=$1::jsonb WHERE id='ev_b72_gala' AND org_id=$2 AND hero_image_url IS NOT NULL`,
    [JSON.stringify({ alt: "Young singers on stage at the gala", fx: 0.5, fy: 0.4 }), ORG]);
  await q(`UPDATE events SET hero_meta=$1::jsonb WHERE id='ev_b72_5k' AND org_id=$2 AND hero_image_url IS NOT NULL`,
    [JSON.stringify({ alt: "Three volunteers working together outdoors", fx: 0.5, fy: 0.45 }), ORG]);
  console.log(`[seed] pictures: ${items} auction items with a photo (two left without, to show "Add a photo"), ${pages.length} giving page covers, ${vol.length} volunteer page cover`);
}

module.exports = { seedFix41Media };
