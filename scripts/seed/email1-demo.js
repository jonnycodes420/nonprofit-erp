// scripts/seed/email1-demo.js · EMAIL-1. THE DEMO SHOWS ALL OF IT.
//
// Harborlight's one brand (logo, colours, type) in portal_settings, read by
// its giving pages and its emails alike; a media library of sixteen photos
// (JPEG, each with alt text) and three videos; every template from the
// library saved with Harborlight's words, photos and two videos; the year-end
// giving page showing the same photo and video; a spring appeal sent from a
// template with its results; a year-end appeal scheduled and waiting for
// approval; and a journey whose three steps start from templates.
//
// The videos are open films (Blender Foundation, CC BY) standing in for the
// org's own, and are titled as samples so nobody mistakes them for footage.
// Demo orgs send nothing; the sent appeal's recipients and opens are seeded
// rows, never a send.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const S = "u_b72demo", SN = "Dana Reyes";

const PHOTOS = [
  ["scripts/demo-assets/demo-hero-choir.jpg", "The youth choir at the spring concert", "Young singers in a row on stage, mid-song"],
  ["scripts/demo-assets/demo-impact-exhibition.jpg", "Student art show", "Visitors looking at student paintings on a gallery wall"],
  ["scripts/demo-assets/demo-impact-studio.jpg", "In the pottery studio", "A student shaping a clay bowl on a wheel"],
  ["scripts/demo-assets/demo-campaign-chapel.jpg", "The old chapel hall", "A sunlit hall with tall windows and wooden benches"],
  ["client/public/landing/two-young-volunteers-smiling-as-they-pack-food.jpg", "Packing the gift bags", "Two young volunteers smiling as they pack food"],
  ["client/public/landing/four-volunteers-preparing-aid-boxes-and-helpin.jpg", "Saturday crew", "Four volunteers preparing boxes together"],
  ["client/public/landing/three-smiling-volunteers-working-together-outd.jpg", "Out on the dock", "Three volunteers smiling while working outdoors"],
  ["client/public/landing/three-volunteers-packing-food-aid-boxes-beside.jpg", "Getting ready for the run", "Three volunteers packing boxes beside a table"],
  ["client/public/landing/volunteers-and-community-members-gathered-arou.jpg", "Community supper", "Volunteers and neighbours gathered around a long table"],
  ["client/public/landing/volunteers-handing-supplies-to-people-at-a-com.jpg", "Handing out supplies", "Volunteers handing supplies to families at a community table"],
  ["client/public/landing/volunteers-unloading-aid-boxes-from-a-van-and-.jpg", "Unloading the van", "Volunteers unloading boxes from a van"],
  ["client/public/landing/smiling-volunteers-sorting-clothes-and-supplie.jpg", "Sorting the donations", "Smiling volunteers sorting clothes and supplies"],
  ["client/public/landing/smiling-volunteers-sorting-clothes-and-toiletr.jpg", "The winter drive", "Volunteers sorting clothes and toiletries into bins"],
  ["client/public/landing/a-nonprofit-team-gathering-around-a-table-to-r.jpg", "The staff meeting", "The Harborlight team around a table, planning the season"],
  ["client/public/photos/potter-2x.webp", "Hands in the clay", "Close-up of hands centring clay on a potter's wheel"],
  ["client/public/photos/shelter-2x.webp", "The boathouse", "A wooden boathouse at the water's edge"],
];
const VIDEOS = [
  ["youtube", "aqz-KE-bpKQ", "Sample video: an open film (Big Buck Bunny, Blender Foundation)"],
  ["youtube", "eRsGyueVLvQ", "Sample video: an open film (Sintel, Blender Foundation)"],
  ["youtube", "R6MlUcmOul8", "Sample video: an open film (Tears of Steel, Blender Foundation)"],
];

async function storeJpeg(q, org, file, kind = "media") {
  const sharp = require("sharp");
  const raw = fs.readFileSync(path.join(ROOT, file));
  const out = await sharp(raw).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const ct = "image/jpeg";
  const id = "pa_" + sha(org + "|" + kind + "|" + ct + "|").slice(0, 8) + sha(out.data).slice(0, 16);
  await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,width,height,storage,data,is_public)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'db',$8,TRUE) ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, is_public = TRUE`,
    [id, org, kind, ct, out.data.length, out.info.width, out.info.height, out.data.toString("base64")]);
  return { id, path: `/portal-assets/${id}`, width: out.info.width, height: out.info.height };
}

// The logo: a small wordmark drawn here, so the demo needs no outside file.
async function storeLogo(q, org) {
  const sharp = require("sharp");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="180" viewBox="0 0 720 180">
    <circle cx="90" cy="90" r="70" fill="#1F4E5F"/><path d="M30 104 q30 -22 60 0 t60 0" stroke="#F2B544" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="M90 32 v52 M90 32 l26 40 h-26" stroke="#ffffff" stroke-width="8" fill="#ffffff" stroke-linejoin="round"/>
    <text x="185" y="112" font-family="Georgia, 'Times New Roman', serif" font-size="78" fill="#1F4E5F">Harborlight</text></svg>`;
  const out = await sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true });
  const ct = "image/png";
  const id = "pa_" + sha(org + "|logo|" + ct + "|").slice(0, 8) + sha(out.data).slice(0, 16);
  await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,width,height,storage,data,is_public)
           VALUES ($1,$2,'logo',$3,$4,$5,$6,'db',$7,TRUE) ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, is_public = TRUE`,
    [id, org, ct, out.data.length, out.info.width, out.info.height, out.data.toString("base64")]);
  return `/portal-assets/${id}`;
}

// Harborlight's own words over each starter's blocks: photos from the
// library, alt text from the photo, and two templates carrying a video.
const STATS = [["46", "young people on the water this season"], ["12", "first certificates earned"], ["212", "volunteer hours given"]];
const BRACKETS = { "[hours]": "212 hours" };
const fillBrackets = t => String(t || "").replace(/\[[^\]]+\]/g, m => BRACKETS[m]
  || "The second training boat goes in the water in May, with twelve new students on the spring roster.");

function harborlightBlocks(starter, media, i, refs) {
  const photo = n => media.photos[(i + n) % media.photos.length];
  return (starter.blocks || []).map((b, k) => {
    const x = JSON.parse(JSON.stringify(b));
    if (x.type === "richtext" && Array.isArray(x.blocks)) x.blocks = x.blocks.map(bl => ({ ...bl, ...(bl.text != null ? { text: fillBrackets(bl.text) } : {}),
      ...(Array.isArray(bl.items) ? { items: bl.items.map(fillBrackets) } : {}) }));
    if (x.type === "quote") { x.text = fillBrackets(x.text) || "I came for the boats. I stayed for the people who believed I could steer one."; x.attribution = x.attribution && !/\[/.test(x.attribution) ? x.attribution : "A Harbor Skills student"; }
    if (x.type === "stats" && Array.isArray(x.items)) x.items = x.items.map((it, n) => ({ value: it.value || STATS[n % 3][0], label: it.label && !/\[/.test(it.label) ? it.label : STATS[n % 3][1] }));
    if (x.type === "event" && !x.eventId && refs.eventId) x.eventId = refs.eventId;
    if (x.type === "givingpage" && !x.givingPageId && refs.givingPageId) x.givingPageId = refs.givingPageId;
    if (x.type === "button" && !x.url && x.action !== "give") x.url = x.action === "volunteer" ? "https://harborlight.example.org/volunteer" : "https://harborlight.example.org/stories";
    if (x.type === "hero") { const p = photo(0); x.image = p.url; x.alt = p.alt; }
    if (x.type === "image") { const p = photo(k + 1); x.image = p.url; x.alt = p.alt; }
    if (x.type === "photos2") x.images = [photo(k + 2), photo(k + 3)].map(p => ({ src: p.url, alt: p.alt }));
    if (x.type === "signature") { x.name = x.name || "Dana Reyes"; x.title = x.title || "Executive Director"; }
    if (x.type === "video") { const v = media.videos[i % media.videos.length]; x.provider = v.provider; x.videoId = v.videoId; x.url = `https://www.youtube.com/watch?v=${v.videoId}`; }
    return x;
  });
}

async function seedEmail1(q, ORG, { TODAY, dAdd }) {
  // ── THE ONE BRAND ───────────────────────────────────────────────────────
  const logo = await storeLogo(q, ORG);
  await q(`INSERT INTO portal_settings (org_id,enabled,display_name,primary_color,accent_color,button_color,type_pairing,card_style,logo_url,footer_text)
           VALUES ($1,true,'Harborlight Youth Collective','#1F4E5F','#F2B544','#1F4E5F','editorial','rounded',$2,'Harborlight Youth Collective · 12 Wharf Street, Salem, MA 01970')
           ON CONFLICT (org_id) DO UPDATE SET display_name=EXCLUDED.display_name, primary_color=EXCLUDED.primary_color, accent_color=EXCLUDED.accent_color,
             button_color=EXCLUDED.button_color, type_pairing=EXCLUDED.type_pairing, card_style=EXCLUDED.card_style, logo_url=EXCLUDED.logo_url, updated_at=NOW()`,
    [ORG, logo]);

  // ── THE MEDIA LIBRARY ──────────────────────────────────────────────────
  const media = { photos: [], videos: [] };
  for (const [n, [file, title, alt]] of PHOTOS.entries()) {
    const a = await storeJpeg(q, ORG, file);
    const id = `med_b72_p${String(n + 1).padStart(2, "0")}`;
    await q(`INSERT INTO media_items (id,org_id,kind,title,alt,asset_id,width,height,created_by,created_by_name) VALUES ($1,$2,'photo',$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO NOTHING`, [id, ORG, title, alt, a.id, a.width, a.height, S, SN]);
    media.photos.push({ id, url: a.path, alt, title });
  }
  for (const [n, [provider, videoId, title]] of VIDEOS.entries()) {
    const id = `med_b72_v${n + 1}`;
    await q(`INSERT INTO media_items (id,org_id,kind,title,alt,provider,video_id,created_by,created_by_name) VALUES ($1,$2,'video',$3,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO NOTHING`, [id, ORG, title, provider, videoId, S, SN]);
    media.videos.push({ id, provider, videoId, title });
  }

  // ── EVERY TEMPLATE, IN HARBORLIGHT'S WORDS ─────────────────────────────
  const L = await import(path.join(ROOT, "shared", "emailTemplateLibrary.js"));
  const starters = L.STARTERS || L.EMAIL_STARTERS || L.default || [];
  const tplByKey = {};
  const [ev] = await q(`SELECT id FROM events WHERE org_id=$1 AND date >= $2::date AND public_slug IS NOT NULL ORDER BY date LIMIT 1`, [ORG, TODAY]);
  const [gp] = await q(`SELECT id FROM giving_pages WHERE org_id=$1 AND status='active' AND p2p_enabled IS TRUE ORDER BY id LIMIT 1`, [ORG]);
  const refs = { eventId: ev ? ev.id : null, givingPageId: gp ? gp.id : null };
  for (const [i, st] of starters.entries()) {
    const id = "et_" + sha("b72|" + st.key).slice(0, 12);
    const blocks = harborlightBlocks(st, media, i, refs);
    // At least two templates carry a video, whether or not the starter had one.
    if ((st.key === "year_end_appeal" || st.key === "impact_report") && !blocks.some(b => b.type === "video")) {
      const v = media.videos[st.key === "year_end_appeal" ? 0 : 1];
      const at = Math.max(1, blocks.findIndex(b => b.type === "button"));
      blocks.splice(at, 0, { type: "video", provider: v.provider, videoId: v.videoId, url: `https://www.youtube.com/watch?v=${v.videoId}`, caption: "Two minutes on the water with this year's crew." });
    }
    const subject = String(st.subject || st.name).replace(/\{\{org_name\}\}/g, "Harborlight");
    await q(`INSERT INTO email_templates (id,org_id,starter_key,name,purpose,subject,preheader,blocks,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [id, ORG, st.key, st.name, st.purpose || "appeal", subject, st.preheader || "", JSON.stringify(blocks), S, SN]);
    tplByKey[st.key] = { id, blocks, subject, preheader: st.preheader || "" };
  }

  // ── THE GIVING PAGE SHOWS THE SAME PHOTO AND VIDEO ─────────────────────
  for (const col of ["published", "draft"]) {
    const [gp] = await q(`SELECT id, ${col} AS w FROM giving_pages WHERE org_id=$1 AND id LIKE 'gp_b72%' AND is_campaign_page = TRUE ORDER BY id LIMIT 1`, [ORG]);
    if (!gp || !Array.isArray(gp.w)) continue;
    const w = gp.w.map(x => (x.type === "hero" ? { ...x, image: media.photos[0].url, alt: media.photos[0].alt } : x));
    if (!w.some(x => x.type === "video")) w.splice(2, 0, { type: "video", provider: media.videos[0].provider, videoId: media.videos[0].videoId, caption: "Two minutes on the water with this year's crew." });
    await q(`UPDATE giving_pages SET ${col}=$1::jsonb WHERE id=$2 AND org_id=$3`, [JSON.stringify(w), gp.id, ORG]);
  }

  // ── A SPRING APPEAL SENT, WITH ITS RESULTS (seeded rows, never a send) ─
  const spring = tplByKey.spring_appeal;
  if (spring) {
    const sentAt = `${dAdd(TODAY, -170)}T14:00:00Z`;
    await q(`INSERT INTO campaigns (id,org_id,name,type,subject,preheader,body,status,segment,sent_at,recipient_count,open_count,template_id,email_blocks,created_by,created_by_name)
             VALUES ('ecamp_b72_spring',$1,'Spring appeal','appeal',$2,$3,'','sent','{}',$4::timestamptz,0,0,$5,$6::jsonb,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [ORG, spring.subject, spring.preheader, sentAt, spring.id, JSON.stringify(spring.blocks), S, SN]);
    const people = await q(`SELECT id, email FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND email IS NOT NULL AND email <> ''
                              AND COALESCE(kind,'') <> 'organisation' ORDER BY total_giving DESC, id LIMIT 180`, [ORG]);
    let opened = 0;
    for (const [n, p] of people.entries()) {
      const open = n % 9 < 4;   // about four in nine, the same every run
      if (open) opened++;
      await q(`INSERT INTO campaign_recipients (id,org_id,campaign_id,donor_id,email,sent_at,opened_at) VALUES ($1,$2,'ecamp_b72_spring',$3,$4,$5::timestamptz,$6::timestamptz)
               ON CONFLICT (id) DO NOTHING`, [`crc_b72_s${n}`, ORG, p.id, p.email, sentAt, open ? `${dAdd(TODAY, -169)}T16:00:00Z` : null]);
    }
    await q(`UPDATE campaigns SET recipient_count=$2, open_count=$3 WHERE id='ecamp_b72_spring' AND org_id=$1`, [ORG, people.length, opened]);
  }
  // ── A YEAR-END APPEAL SCHEDULED AND WAITING FOR APPROVAL ───────────────
  const ye = tplByKey.year_end_appeal;
  if (ye) {
    const y = Number(TODAY.slice(0, 4)) + (TODAY.slice(5, 7) === "12" ? 1 : 0);
    await q(`INSERT INTO campaigns (id,org_id,name,type,subject,preheader,body,status,segment,scheduled_at,template_id,email_blocks,created_by,created_by_name)
             VALUES ('ecamp_b72_yearend',$1,'Year-end appeal','appeal',$2,$3,'','awaiting_approval','{}',$4::timestamptz,$5,$6::jsonb,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [ORG, ye.subject, ye.preheader, `${y}-12-02T14:00:00Z`, ye.id, JSON.stringify(ye.blocks), S, SN]);
  }

  // ── A JOURNEY WHOSE STEPS START FROM THREE TEMPLATES ───────────────────
  const tsteps = [["first_gift_welcome", "Send the welcome", 2], ["impact_report", "Send the spring impact report", 60], ["event_invitation", "Invite them to the supper", 120]]
    .filter(([k]) => tplByKey[k])
    .map(([k, label, offsetDays]) => ({ type: "send", label, offsetDays, draft: `template:${tplByKey[k].id}` }));
  if (tsteps.length === 3) {
    await q(`INSERT INTO cultivation_templates (id,org_id,name,description,steps,trigger_key,priority,journey_enabled,created_by,created_by_name)
             VALUES ('ct_b72_emails',$1,'First year, in three emails','A welcome, an impact report and an invitation, each from a template you can edit.',$2::jsonb,'by_hand',40,false,$3,$4)
             ON CONFLICT (id) DO NOTHING`, [ORG, JSON.stringify(tsteps), S, SN]);
  }
  return { photos: media.photos.length, videos: media.videos.length, templates: Object.keys(tplByKey).length };
}

module.exports = { seedEmail1 };
