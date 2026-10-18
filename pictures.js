// FIX-41 Part 2 · EVERY PAGE AND ITEM CAN HAVE A PICTURE.
//
// One shape for a picture wherever it sits: { url, alt, fx, fy }. `url` is a
// /portal-assets/ path (or, for a legacy row, an https address); `alt` is the
// words a screen reader says, defaulted to the item's name; `fx`/`fy` are the
// focal point, 0..1 from the left and top, so a crop on a phone keeps the
// subject (CSS object-position). A legacy bare URL string reads as a picture
// with no alt and a centred focus, so no old row has to be rewritten.
//
// One upload door for every slot (POST /pictures/upload): the bytes go
// through the same validation, HEIC conversion, resize and compression, and
// come back as a path the slot then saves with its own words. One save door
// for the slots that are a single picture on a row (PUT /pictures/:kind/:id).
// Every save records who made it in asset_pointer_history.

const ASSET_PATH_RE = /^\/portal-assets\/pa_[a-f0-9]{24}$/;
const HTTPS_RE = /^https:\/\/\S{1,1990}$/;
const ALT_MAX = 200;
const PHOTOS_MAX = 5;   // an auction item: the first is the main one
const MAX_UPLOAD_MB = 15;

const clamp01 = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, Math.round(n * 1000) / 1000));
};

// A picture as stored, from anything a row may hold: an object, a bare URL,
// or nothing. Returns null for nothing usable.
function readPicture(v) {
  if (!v) return null;
  if (typeof v === "string") {
    const u = v.trim();
    return u ? { url: u, alt: "", fx: 0.5, fy: 0.5 } : null;
  }
  if (typeof v !== "object") return null;
  const url = String(v.url || v.src || "").trim();
  if (!url) return null;
  return { url, alt: String(v.alt || "").slice(0, ALT_MAX), fx: clamp01(v.fx ?? 0.5), fy: clamp01(v.fy ?? 0.5) };
}

// A picture as a person sent it. The url must already be stored (an asset
// path this org owns is checked by the caller) or a full https address.
// Returns { picture } (null clears) or { error }.
function cleanPicture(v, { fallbackAlt = "" } = {}) {
  if (v === null || v === "" || v === undefined) return { picture: null };
  const p = readPicture(v);
  if (!p) return { picture: null };
  if (!ASSET_PATH_RE.test(p.url) && !HTTPS_RE.test(p.url)) return { error: "Add the photo again: that picture could not be read." };
  if (!p.alt) p.alt = String(fallbackAlt || "").slice(0, ALT_MAX);
  return { picture: p };
}

function readPhotos(list) {
  return (Array.isArray(list) ? list : []).map(readPicture).filter(Boolean).slice(0, PHOTOS_MAX);
}

const pct = n => Math.round(clamp01(n) * 100) + "%";
// CSS object-position for a picture's focal point.
function focusCss(p) {
  const x = p ? pct(p.fx) : "50%", y = p ? pct(p.fy) : "50%";
  return `${x} ${y}`;
}

const escHtml = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A picture in server-rendered HTML: a fixed aspect-ratio box, the image
// covering it from its focal point, so a tall or wide photo never moves the
// page around it. `ratio` is a CSS aspect-ratio ("16 / 9").
function pictureHtml(p, { ratio = "16 / 9", radius = 12, maxWidth = "", sizes = "", className = "" } = {}) {
  const pic = readPicture(p);
  if (!pic) return "";
  const src = escHtml(pic.url);
  const asset = ASSET_PATH_RE.test(pic.url);
  const srcset = asset ? ` srcset="${src}?w=640 640w, ${src}?w=1280 1280w, ${src}?w=1920 1920w" sizes="${escHtml(sizes || "(max-width: 760px) 100vw, 720px")}"` : "";
  return `<div class="${escHtml(className)}" data-picture style="position:relative;width:100%;${maxWidth ? `max-width:${maxWidth};` : ""}aspect-ratio:${ratio};overflow:hidden;border-radius:${radius}px;background:#F0EDE6">`
    + `<img src="${src}${asset ? "?w=1280" : ""}"${srcset} alt="${escHtml(pic.alt)}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${focusCss(pic)};display:block"></div>`;
}

// ── HEIC ─────────────────────────────────────────────────────────────────
// An iPhone photo arrives as HEIC. The prebuilt sharp here decodes AVIF but
// not HEVC, so a HEIC data URI is converted to JPEG (heic-convert, pure JS)
// before the ordinary image path sees it.
const HEIC_MIMES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];
function isHeicDataUri(v) {
  const m = /^data:([^;]+);base64,/.exec(String(v || ""));
  if (m && HEIC_MIMES.includes(m[1].toLowerCase())) return true;
  // Some browsers send an iPhone photo with no type; sniff the ftyp box.
  if (m && (m[1] === "application/octet-stream" || m[1] === "")) {
    try {
      const head = Buffer.from(String(v).slice(m[0].length, m[0].length + 64), "base64");
      const brand = head.slice(4, 12).toString("latin1");
      return /^ftyp(heic|heix|hevc|hevx|mif1|msf1)/.test(brand);
    } catch { return false; }
  }
  return false;
}
async function heicToJpegDataUri(v) {
  const m = /^data:([^;]*);base64,(.*)$/s.exec(String(v));
  if (!m) return null;
  const convert = require("heic-convert");
  const out = await convert({ buffer: Buffer.from(m[2], "base64"), format: "JPEG", quality: 0.88 });
  return "data:image/jpeg;base64," + Buffer.from(out).toString("base64");
}

// ── Single-picture slots, saved through one door ─────────────────────────
// kind → where the picture lives and how the row is found. `org` slots are
// one per organisation (id is ignored). Every one is tenant-scoped by org_id.
const SLOTS = {
  event_level:      { table: "event_levels",          col: "picture",       label: "name" },
  membership_level: { table: "membership_levels",     col: "picture",       label: "name" },
  volunteer_role:   { table: "volunteer_slot_roles",  col: "picture",       label: "name" },
  // A cover kept as a url column plus its words and focus beside it.
  event_cover:      { table: "events",                col: "hero_image_url", meta: "hero_meta", label: "name" },
  p2p_cover:        { table: "peer_fundraisers",      col: "image_url",     meta: "image_meta", label: "name" },
  membership_cover: { table: "portal_settings",       col: "membership_cover", label: null, byOrg: true },
};

const express = require("express");
// Mounted with the other route modules (server.js app.use(routers.r0)), above
// the app's final 404; mount() fills it once server.js has its helpers.
const routers = { r0: express.Router() };

function mount(ctx) {
  const app = routers.r0;
  const { query, run, requireAuth, checkWriteAccess, wrap, putThemeAsset, normalizeUploadImage,
          checkThemeImageDimensions, uploadImageError, recordAssetPointerHistory, ASSET_ID_RE } = ctx;

  // Store one image and hand back its path. Nothing points at it until a
  // slot saves it; an unreferenced upload ages out with the 90-day window.
  async function storePicture(orgId, v) {
    let s = String(v || "");
    if (isHeicDataUri(s)) {
      try { s = await heicToJpegDataUri(s); }
      catch { return { error: "That iPhone photo could not be converted. Try saving it as a JPEG first." }; }
    }
    if (s.startsWith("/portal-assets/")) {
      const id = s.slice("/portal-assets/".length);
      if (!ASSET_ID_RE.test(id)) return { error: "That photo could not be read." };
      const [own] = await query(`SELECT id FROM portal_assets WHERE id=? AND org_id=?`, [id, orgId]);
      return own ? { url: s } : { error: "That photo could not be read." };
    }
    const uerr = uploadImageError(s);
    if (uerr) return { error: uerr };
    const m = s.match(/^data:([^;]+);base64,(.*)$/s);
    let buffer;
    try { buffer = Buffer.from(m[2], "base64"); } catch { return { error: "That photo could not be read." }; }
    const dims = checkThemeImageDimensions("campaign", m[1], buffer);
    if (!dims.ok) return { error: dims.message };
    const norm = await normalizeUploadImage("campaign", m[1], buffer);
    if (norm.error) return { error: norm.message || "That photo could not be read." };
    const asset = await putThemeAsset({ orgId, kind: "picture", isPublic: true, buffer: norm.buffer, contentType: norm.contentType,
      width: norm.width ?? dims.width, height: norm.height ?? dims.height });
    return { url: asset.path, width: norm.width ?? dims.width, height: norm.height ?? dims.height };
  }

  // A picture someone sent may name an asset; it must be this org's.
  async function ownPicture(orgId, v, fallbackAlt) {
    const c = cleanPicture(v, { fallbackAlt });
    if (c.error || !c.picture) return c;
    if (ASSET_PATH_RE.test(c.picture.url)) {
      const id = c.picture.url.slice("/portal-assets/".length);
      const [own] = await query(`SELECT id FROM portal_assets WHERE id=? AND org_id=?`, [id, orgId]);
      if (!own) return { error: "That photo could not be read." };
    }
    return c;
  }

  app.post("/pictures/upload", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const r = await storePicture(req.user.orgId, req.body && req.body.image);
    if (r.error) return res.status(400).json({ error: "bad_image", message: r.error });
    res.json({ url: r.url, width: r.width || null, height: r.height || null });
  }));

  app.get("/pictures/:kind/:id", requireAuth, wrap(async (req, res) => {
    const s = SLOTS[req.params.kind];
    if (!s) return res.status(404).json({ error: "not_found" });
    const where = s.byOrg ? "org_id = ?" : "id = ? AND org_id = ?";
    const args = s.byOrg ? [req.user.orgId] : [req.params.id, req.user.orgId];
    const [row] = await query(`SELECT ${s.col} AS v${s.meta ? `, ${s.meta} AS m` : ""} FROM ${s.table} WHERE ${where}`, args);
    if (!row && !s.byOrg) return res.status(404).json({ error: "not_found" });
    const pic = row ? readPicture(s.meta ? (row.v ? { url: row.v, ...(row.m || {}) } : null) : row.v) : null;
    res.json({ picture: pic });
  }));

  app.put("/pictures/:kind/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const s = SLOTS[req.params.kind];
    if (!s) return res.status(404).json({ error: "not_found" });
    const orgId = req.user.orgId;
    const where = s.byOrg ? "org_id = ?" : "id = ? AND org_id = ?";
    const args = s.byOrg ? [orgId] : [req.params.id, orgId];
    const [row] = await query(`SELECT ${s.col} AS v${s.meta ? `, ${s.meta} AS m` : ""}${s.label ? `, ${s.label} AS label` : ""} FROM ${s.table} WHERE ${where}`, args);
    if (!row && !s.byOrg) return res.status(404).json({ error: "not_found" });
    const c = await ownPicture(orgId, req.body && req.body.picture, row && row.label);
    if (c.error) return res.status(400).json({ error: "bad_image", message: c.error });
    const before = row ? (s.meta ? (row.v || null) : (readPicture(row.v) || {}).url || null) : null;
    const p = c.picture;
    if (s.byOrg) {
      if (!row) await run(`INSERT INTO portal_settings (org_id) VALUES (?) ON CONFLICT (org_id) DO NOTHING`, [orgId]);
      await run(`UPDATE portal_settings SET ${s.col} = ?::jsonb WHERE org_id = ?`, [p ? JSON.stringify(p) : null, orgId]);
    } else if (s.meta) {
      await run(`UPDATE ${s.table} SET ${s.col} = ?, ${s.meta} = ?::jsonb WHERE id = ? AND org_id = ?`,
        [p ? p.url : null, p ? JSON.stringify({ alt: p.alt, fx: p.fx, fy: p.fy }) : null, req.params.id, orgId]);
    } else {
      await run(`UPDATE ${s.table} SET ${s.col} = ?::jsonb WHERE id = ? AND org_id = ?`, [p ? JSON.stringify(p) : null, req.params.id, orgId]);
    }
    await recordAssetPointerHistory(orgId, `${req.params.kind}.picture`, s.byOrg ? orgId : req.params.id, before, p ? p.url : null, req.user);
    if (req.audit && req.audit.entity) req.audit.entity(s.table, s.byOrg ? orgId : req.params.id);
    res.json({ ok: true, picture: p });
  }));

  return { storePicture, ownPicture };
}

module.exports = {
  mount, routers, readPicture, cleanPicture, readPhotos, pictureHtml, focusCss, isHeicDataUri, heicToJpegDataUri,
  PHOTOS_MAX, MAX_UPLOAD_MB, SLOTS, ASSET_PATH_RE,
};
