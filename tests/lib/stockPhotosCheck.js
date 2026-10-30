// tests/lib/stockPhotosCheck.js · EDITOR-1. THERE IS ALWAYS A PHOTO, AND
// EVERY PHOTO IS LICENSED.
//
//   const S = require("./lib/stockPhotosCheck");
//   await S.checkLicenses();                         // folder <-> LICENSES.md, both ways
//   await S.checkMissionGroups();                    // the mission words pick the right group
//   await S.checkNewRowsGetStock({ base, token });   // a new giving page and a new event start with one
//
// Each throws one Error listing everything wrong, and returns a short summary
// when all is well. How each can fail (plant it to see red): delete a row from
// assets/stock/LICENSES.md, or drop a .jpg in assets/stock/<group>/ without a
// row (checkLicenses); remove "riding" from the animals words in
// shared/stockPhotos.js (checkMissionGroups); take the stockPictureForOrg call
// out of POST /giving-pages in routes/give.js or POST /events in routes/crm.js
// (checkNewRowsGetStock).
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const STOCK = path.join(ROOT, "assets", "stock");
const shared = () => import(path.join(ROOT, "shared", "stockPhotos.js"));

// Every photo file (thumbnails excluded: they are the same photos, small).
function photoFiles() {
  const out = [];
  for (const g of fs.readdirSync(STOCK, { withFileTypes: true })) {
    if (!g.isDirectory() || g.name === "thumbs") continue;
    for (const f of fs.readdirSync(path.join(STOCK, g.name))) if (!f.startsWith(".")) out.push(`${g.name}/${f}`);
  }
  return out.sort();
}
function licenseRows() {
  const md = fs.readFileSync(path.join(STOCK, "LICENSES.md"), "utf8");
  return md.split("\n").filter(l => /^\|\s*[a-z]+\/[^|]+\.jpg\s*\|/.test(l)).map(l => {
    const c = l.split("|").slice(1, -1).map(x => x.trim());
    return { file: c[0], group: c[1], photographer: c[2], source: c[3], license: c[4], alt: c[5] };
  });
}

async function checkLicenses() {
  const SP = await shared();
  const problems = [];
  const files = photoFiles(), rows = licenseRows();
  const rowFiles = new Set(rows.map(r => r.file));
  for (const f of files) if (!rowFiles.has(f)) problems.push(`${f} has no row in LICENSES.md`);
  for (const r of rows) {
    if (!files.includes(r.file)) problems.push(`LICENSES.md names ${r.file}, which is not in assets/stock`);
    if (!SP.STOCK_LICENSES.includes(r.license)) problems.push(`${r.file}: license "${r.license}" is not Unsplash or Pexels`);
    if (!r.photographer || !/^https:\/\/(unsplash\.com|www\.pexels\.com)\//.test(r.source)) problems.push(`${r.file}: photographer or source missing`);
    if (!r.alt) problems.push(`${r.file}: no alt text`);
    if (r.group !== r.file.split("/")[0]) problems.push(`${r.file}: group "${r.group}" is not its folder`);
  }
  const catFiles = new Set(SP.STOCK_PHOTOS.map(p => p.file));
  for (const f of files) if (!catFiles.has(f)) problems.push(`${f} is not in shared/stockPhotos.js`);
  for (const p of SP.STOCK_PHOTOS) {
    if (!files.includes(p.file)) problems.push(`the catalog names ${p.file}, which is not in assets/stock`);
    if (!fs.existsSync(path.join(STOCK, SP.thumbFile(p)))) problems.push(`${p.file} has no thumbnail`);
  }
  for (const g of SP.GROUP_KEYS) if (SP.stockFor(g, 99).length < 3) problems.push(`group ${g} has fewer than 3 photos`);
  if (problems.length) throw new Error("Stock photos and their licenses disagree:\n  " + problems.join("\n  "));
  return { files: files.length, rows: rows.length };
}

// The mapping, decided: riding means horses, so "therapeutic riding for kids
// with disabilities" is Animals and horses (riding, therap and kids score one
// each; the tie goes to the group listed first).
const MISSIONS = [
  ["Therapeutic riding for kids with disabilities", null, "animals"],
  ["A community food pantry for the north side", null, "food"],
  ["Our church feeds the spirit", null, "faith"],
  ["", null, "community"],
  [null, null, "community"],
  ["Transformative arts education for underserved NYC youth", null, "arts"],
  ["After-school mentoring for teens", null, "kids"],
  ["Free clinic care for every patient", null, "health"],
  ["Protecting the river and its watershed", null, "outdoors"],
  ["", "https://www.northshorehumane.org", "animals"],
];
async function checkMissionGroups() {
  const SP = await shared();
  const wrong = MISSIONS.map(([m, w, want]) => [m, w, want, SP.missionGroup(m, w)]).filter(r => r[2] !== r[3]);
  if (wrong.length) throw new Error("missionGroup chose wrong:\n  " + wrong.map(([m, w, want, got]) => `"${m || ""}"${w ? " " + w : ""}: wanted ${want}, got ${got}`).join("\n  "));
  return { checked: MISSIONS.length };
}

// A new giving page and a new event, made through the API as an admin of an
// org, come back with a stock cover: a /portal-assets/ path, meta.stock true,
// alt text, and a photo from the group the org's own mission picks.
async function checkNewRowsGetStock({ base, token, mission, website, q } = {}) {
  const SP = await shared();
  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  const api = async (m, p, b) => {
    const r = await fetch(base + p, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  if (mission === undefined && q) {
    const me = await api("GET", "/me");
    const orgId = me.body && (me.body.org ? me.body.org.id : me.body.orgId);
    const [o] = await q("SELECT mission, website FROM orgs WHERE id=$1", [orgId]);
    mission = o && o.mission; website = o && o.website;
  }
  const group = SP.missionGroup(mission, website);
  const groupAlts = new Set(SP.stockFor(group, 99).map(p => p.alt));
  const problems = [];
  const stamp = Date.now().toString(36);

  const gp = await api("POST", "/giving-pages", { title: "Stock check " + stamp });
  if (gp.status !== 201) problems.push(`POST /giving-pages answered ${gp.status}`);
  else {
    const pg = gp.body, meta = pg.image_meta || {};
    if (!/^\/portal-assets\/pa_[a-f0-9]{24}$/.test(pg.image_url || "")) problems.push(`the new giving page has no stored photo (${pg.image_url})`);
    if (meta.stock !== true) problems.push("the new giving page's photo is not marked stock");
    if (!groupAlts.has(meta.alt)) problems.push(`the new giving page's photo is not from ${group} ("${meta.alt}")`);
    const settings = await api("GET", `/giving-pages/${pg.id}/page`);
    const ds = settings.body && (settings.body.draftSettings || settings.body.settings);
    if (!ds || ds.imageUrl !== pg.image_url || !ds.imageMeta || ds.imageMeta.stock !== true) problems.push("the editor's settings do not carry the stock photo and its mark");
  }

  const ev = await api("POST", "/events", { name: "Stock check " + stamp, eventType: "gala", date: "2027-03-14" });
  if (ev.status !== 200) problems.push(`POST /events answered ${ev.status}`);
  else {
    const e = ev.body, meta = e.hero_meta || {};
    if (!/^\/portal-assets\/pa_[a-f0-9]{24}$/.test(e.hero_image_url || "")) problems.push(`the new event has no stored photo (${e.hero_image_url})`);
    if (meta.stock !== true) problems.push("the new event's photo is not marked stock");
    if (!groupAlts.has(meta.alt)) problems.push(`the new event's photo is not from ${group} ("${meta.alt}")`);
    const pic = await api("GET", `/pictures/event_cover/${e.id}`);
    if (!pic.body.picture || pic.body.picture.stock !== true) problems.push("GET /pictures/event_cover does not say the photo is stock");
    // Replacing it with the org's own photo takes the mark away; a client
    // cannot keep "stock" on a photo that is not one.
    const own = await api("POST", "/pictures/upload", { image: await tinyJpeg() });
    if (own.status === 200) {
      await api("PUT", `/pictures/event_cover/${e.id}`, { picture: { url: own.body.url, alt: "Our own", stock: true } });
      const after = await api("GET", `/pictures/event_cover/${e.id}`);
      if (after.body.picture && after.body.picture.stock) problems.push("an uploaded photo kept the stock mark");
    }
  }

  const lib = await api("GET", "/stock-photos");
  if (lib.status !== 200 || lib.body.suggested !== group || !lib.body.groups || lib.body.groups[0].key !== group) problems.push(`GET /stock-photos did not lead with ${group}`);
  else {
    const t = await fetch(base + lib.body.groups[0].photos[0].thumb);
    if (t.status !== 200 || !/image\/jpeg/.test(t.headers.get("content-type") || "")) problems.push("a stock thumbnail did not load");
  }

  if (problems.length) throw new Error("New rows and their stock photos:\n  " + problems.join("\n  "));
  return { group, giving: gp.body && gp.body.id, event: ev.body && ev.body.id };
}

// A small real photo for the upload door (made, not checked in).
async function tinyJpeg() {
  const buf = await require("sharp")({ create: { width: 800, height: 500, channels: 3, background: { r: 13, g: 92, b: 58 } } }).jpeg().toBuffer();
  return "data:image/jpeg;base64," + buf.toString("base64");
}

module.exports = { checkLicenses, checkMissionGroups, checkNewRowsGetStock, photoFiles, licenseRows };
