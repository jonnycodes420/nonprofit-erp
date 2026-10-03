// scripts/seed/parity2-events.js: PARITY-2 Part 3. THE TWO PUBLIC EVENT PAGES.
//
// Called with one line from scripts/seed-demo.js main(), after the gala and
// the 5K are written. It only ever writes org_b72demo, through the `q` the
// seed hands it, and only seed-demo calls it.
//
//   The gala (/e/harbor-lights-gala) is OVER, so its page shows what a page
//   looks like the morning after: the choir as its picture, the evening's
//   times, and a gallery of three photographs. Its sponsor levels carry their
//   benefits for the staff screen, and the page itself no longer sells them.
//
//   The 5K (/e/harbor-run) is AHEAD, so its page is the selling page: a
//   picture, a start and finish time, tickets, and the Mile sponsor as a card
//   with what it comes with.
//
// The photographs are real ones already in the repo (scripts/demo-assets/ and
// client/public/landing/, provenance in their READMEs). They are stored the
// way the asset store's Postgres fallback stores them, with the id
// assetStore.assetIdFor would mint, the same way the demo's video thank-you is.
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
  const id = "pa_" + sha(org + "|event|" + ct + "|").slice(0, 8) + sha(buf).slice(0, 16);
  await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,width,height,storage,data)
           VALUES ($1,$2,'event',$3,$4,$5,$6,'db',$7) ON CONFLICT (id) DO UPDATE SET deleted_at = NULL`,
    [id, org, ct, buf.length, w, h, buf.toString("base64")]);
  return `/portal-assets/${id}`;
}

async function seedParity2Events(q, ORG) {
  // ── THE GALA, THE MORNING AFTER ──────────────────────────────────────
  const galaHero = await storePhoto(q, ORG, "scripts/demo-assets/demo-hero-choir.jpg");
  const galaGallery = [
    { path: await storePhoto(q, ORG, "scripts/demo-assets/demo-impact-exhibition.jpg"), caption: "The student art show at the door" },
    { path: await storePhoto(q, ORG, "scripts/demo-assets/demo-impact-studio.jpg"), caption: "A bowl thrown live, then sold in the paddle raise" },
    { path: await storePhoto(q, ORG, "client/public/landing/two-young-volunteers-smiling-as-they-pack-food.jpg"), caption: "Students packing the gift bags" },
  ];
  await q(`UPDATE events SET start_time='18:30', end_time='22:30', hero_image_url=$1, gallery=$2::jsonb
            WHERE id='ev_b72_gala' AND org_id=$3`, [galaHero, JSON.stringify(galaGallery), ORG]);
  const BENEFITS = {
    evl_b72_presenting: ["A table for ten at the front of the room", "Your name on the invitation and the stage screen",
                         "Two minutes on stage to welcome the room", "A full page in the programme"],
    evl_b72_lighthouse: ["A table for six", "Your name on the stage screen", "A half page in the programme"],
    evl_b72_harbor: ["Two dinner places", "Your name in the programme"],
    evl_b72_run_sponsor: ["Your name on a mile marker along the course", "Two race entries", "A thank-you from the start line"],
  };
  for (const [id, list] of Object.entries(BENEFITS))
    await q(`UPDATE event_levels SET benefits=$1::jsonb WHERE id=$2 AND org_id=$3`, [JSON.stringify(list), id, ORG]);

  // ── THE 5K, AHEAD ────────────────────────────────────────────────────
  const runHero = await storePhoto(q, ORG, "client/public/landing/three-smiling-volunteers-working-together-outd.jpg");
  await q(`UPDATE events SET start_time='08:00', end_time='11:00', hero_image_url=$1
            WHERE id='ev_b72_5k' AND org_id=$2`, [runHero, ORG]);
  console.log(`[seed] event pages: the gala 6:30 to 10:30 pm with a picture and ${galaGallery.length} photographs (it is over, so they show); the 5K 8 to 11 am with a picture and the Mile sponsor's benefits`);
}

module.exports = { seedParity2Events };
