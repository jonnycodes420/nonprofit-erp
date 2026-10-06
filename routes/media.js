// routes/media.js · EMAIL-1. THE MEDIA LIBRARY.
//
//   GET  /media?kind=photo|video   the library, newest first (removed items left out)
//   POST /media/photos             add a photo { file: data URI, title, alt }; alt is required
//   POST /media/videos             add a video { url, title }: a YouTube or Vimeo link
//   PUT  /media/:id                { title, alt }
//   POST /media/:id/remove         take one out of the library (Undo puts it back)
//   POST /media/:id/restore
//
// One library for giving pages and emails. A photo is stored as a JPEG (a PNG
// only when it really has transparency), because inboxes such as Outlook do
// not show WebP, which is what the page uploads re-encode to. Its long edge is
// at most 1600px, the widest an email or a page column shows it, and its
// metadata (camera, place) is stripped. A video is an allowlisted YouTube or
// Vimeo id (parseVideoRef, the one parser), never pasted embed code.
//
// Every write is recorded by the one audit write; nothing here writes one.
"use strict";
const express = require("express");

const routers = { r0: express.Router() };
const MEDIA_ASSET_KIND = "media";
const PHOTO_IN = ["image/png", "image/jpeg", "image/webp", "image/gif"];
// Decoded bytes; with the 22mb body parser in server.js: move both or neither.
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_LONG_EDGE = 1600;
const VIMEO_TIMEOUT_MS = 4000;
const TITLE_CAP = 200, ALT_CAP = 300;
const ALT_SENTENCE = "Describe the photo in a few words. People who use a screen reader hear this, and inboxes that block images show it instead.";

let C = null;

const clean = (v, cap) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, cap);
const assetUrl = id => (id ? `/portal-assets/${id}` : null);
function videoPage(provider, videoId) {
  return provider === "vimeo" ? `https://vimeo.com/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`;
}

function itemOut(r) {
  const photo = r.kind === "photo";
  let thumbUrl = null;
  if (photo) thumbUrl = assetUrl(r.asset_id);
  else if (r.provider === "youtube") thumbUrl = `https://img.youtube.com/vi/${r.video_id}/hqdefault.jpg`;
  else if (r.thumb_asset_id) thumbUrl = assetUrl(r.thumb_asset_id);
  return {
    id: r.id, kind: r.kind, title: r.title || "", alt: r.alt || "",
    url: photo ? assetUrl(r.asset_id) : videoPage(r.provider, r.video_id),
    width: r.width || null, height: r.height || null,
    provider: photo ? null : r.provider, videoId: photo ? null : r.video_id,
    thumbUrl, createdAt: r.created_at, createdByName: r.created_by_name || "", removed: !!r.removed_at,
  };
}

// The one photo pipeline: any of the four input types in, JPEG (or PNG with
// real transparency) out, long edge <= 1600, EXIF orientation applied and then
// every piece of metadata dropped (sharp writes none unless asked).
async function encodeEmailSafe(buffer) {
  const sharp = require("sharp");
  let meta;
  try { meta = await sharp(buffer, { failOn: "error" }).metadata(); } catch { meta = null; }
  if (!meta || !meta.width || !meta.height) return { error: "That file does not open as a photo. Save it again as a JPEG or PNG and try once more." };
  if (meta.width > 12000 || meta.height > 12000) return { error: "That photo is unusually large. Please use one under about 12,000 pixels on a side." };
  let keepPng = false;
  if (meta.hasAlpha) {
    try { keepPng = !(await sharp(buffer).stats()).isOpaque; } catch { keepPng = false; }
  }
  const base = sharp(buffer, { failOn: "none" }).rotate()
    .resize({ width: PHOTO_LONG_EDGE, height: PHOTO_LONG_EDGE, fit: "inside", withoutEnlargement: true });
  const out = keepPng
    ? await base.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await base.flatten({ background: "#ffffff" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { buffer: out.data, contentType: keepPng ? "image/png" : "image/jpeg", width: out.info.width, height: out.info.height };
}

async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, redirect: "follow" }); } finally { clearTimeout(t); }
}

// Vimeo publishes no fixed thumbnail address, so its oEmbed answer is asked
// once, when the video is added, and the picture is kept in the asset store.
// Any failure (slow, private video, no network) leaves the video without one.
async function vimeoThumbnail(orgId, videoId) {
  if (C.testMode && C.testMode()) return { thumbAssetId: null, title: "" };
  try {
    const r = await fetchWithTimeout(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent("https://vimeo.com/" + videoId)}&width=1280`, VIMEO_TIMEOUT_MS);
    if (!r.ok) return { thumbAssetId: null, title: "" };
    const j = await r.json();
    const title = clean(j && j.title, TITLE_CAP);
    const tu = String((j && j.thumbnail_url) || "");
    if (!/^https:\/\/i\.vimeocdn\.com\//.test(tu)) return { thumbAssetId: null, title };
    const ir = await fetchWithTimeout(tu, VIMEO_TIMEOUT_MS);
    if (!ir.ok) return { thumbAssetId: null, title };
    const buf = Buffer.from(await ir.arrayBuffer());
    if (!buf.length || buf.length > PHOTO_MAX_BYTES) return { thumbAssetId: null, title };
    const enc = await encodeEmailSafe(buf);
    if (enc.error) return { thumbAssetId: null, title };
    const asset = await C.putThemeAsset({ orgId, kind: MEDIA_ASSET_KIND, buffer: enc.buffer, contentType: enc.contentType, width: enc.width, height: enc.height, isPublic: true });
    return { thumbAssetId: asset.id, title };
  } catch { return { thumbAssetId: null, title: "" }; }
}

function mount(ctx) {
C = ctx;
const { query, run, wrap, requireAuth, checkWriteAccess, actor, uuid, putThemeAsset } = ctx;
const app = routers.r0;

async function who(req) {
  const a = actor(req);
  const [u] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [a.id, req.user.orgId]);
  return { id: a.id, name: (u && u.name) || a.name };
}
async function rowFor(id, orgId) {
  const [r] = await query(`SELECT * FROM media_items WHERE id=? AND org_id=?`, [String(id || ""), orgId]);
  return r || null;
}

app.get("/media", requireAuth, wrap(async (req, res) => {
  const kind = req.query.kind === "video" ? "video" : req.query.kind === "photo" ? "photo" : null;
  const rows = await query(
    `SELECT * FROM media_items WHERE org_id=? AND removed_at IS NULL${kind ? " AND kind=?" : ""} ORDER BY created_at DESC, id DESC LIMIT 500`,
    kind ? [req.user.orgId, kind] : [req.user.orgId]);
  res.json({ items: rows.map(itemOut) });
}));

app.post("/media/photos", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const b = req.body || {};
  const alt = clean(b.alt, ALT_CAP);
  if (!alt) return res.status(400).json({ error: "alt_required", sentence: ALT_SENTENCE });
  const m = typeof b.file === "string" ? b.file.match(/^data:([^;,]+);base64,(.*)$/s) : null;
  if (!m || !PHOTO_IN.includes(m[1].toLowerCase())) {
    return res.status(400).json({ error: "bad_type", sentence: "Steward takes a JPEG, PNG, WebP or GIF photo." });
  }
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); } catch { buffer = null; }
  if (!buffer || !buffer.length) return res.status(400).json({ error: "bad_image", sentence: "That file does not open as a photo. Save it again as a JPEG or PNG and try once more." });
  if (buffer.length > PHOTO_MAX_BYTES) return res.status(400).json({ error: "too_large", sentence: "That photo is over 15 MB. A normal photo from a phone or camera is well within that." });
  const enc = await encodeEmailSafe(buffer);
  if (enc.error) return res.status(400).json({ error: "bad_image", sentence: enc.error });
  const asset = await putThemeAsset({ orgId, kind: MEDIA_ASSET_KIND, buffer: enc.buffer, contentType: enc.contentType, width: enc.width, height: enc.height, isPublic: true });
  const title = clean(b.title, TITLE_CAP) || alt.slice(0, TITLE_CAP);
  // The same bytes already in the library come back as the same item.
  const [dupe] = await query(`SELECT * FROM media_items WHERE org_id=? AND kind='photo' AND asset_id=? AND removed_at IS NULL`, [orgId, asset.id]);
  if (dupe) return res.json({ item: itemOut(dupe), existing: true, sentence: `This photo is already in your library as "${dupe.title}".` });
  const w = await who(req);
  const id = "med_" + uuid().replace(/-/g, "").slice(0, 16);
  await run(`INSERT INTO media_items (id, org_id, kind, title, alt, asset_id, width, height, created_by, created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, orgId, "photo", title, alt, asset.id, enc.width, enc.height, w.id, w.name]);
  const row = await rowFor(id, orgId);
  res.status(201).json({ item: itemOut(row), sentence: `Added "${title}" to your library.` });
}));

app.post("/media/videos", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const b = req.body || {};
  const { parseVideoRef } = require("./give");
  const ref = parseVideoRef(b.url);
  if (!ref) return res.status(400).json({ error: "bad_video", sentence: "Paste a YouTube or Vimeo link, such as https://youtu.be/abc123 or https://vimeo.com/123456789." });
  const [dupe] = await query(`SELECT * FROM media_items WHERE org_id=? AND kind='video' AND provider=? AND video_id=? AND removed_at IS NULL`, [orgId, ref.provider, ref.videoId]);
  if (dupe) return res.json({ item: itemOut(dupe), existing: true, sentence: `This video is already in your library as "${dupe.title}".` });
  let thumbAssetId = null, fetchedTitle = "", noThumb = false;
  if (ref.provider === "vimeo") {
    const t = await vimeoThumbnail(orgId, ref.videoId);
    thumbAssetId = t.thumbAssetId; fetchedTitle = t.title; noThumb = !thumbAssetId;
  }
  const title = clean(b.title, TITLE_CAP) || fetchedTitle || (ref.provider === "vimeo" ? "Vimeo video" : "YouTube video");
  const w = await who(req);
  const id = "med_" + uuid().replace(/-/g, "").slice(0, 16);
  await run(`INSERT INTO media_items (id, org_id, kind, title, alt, provider, video_id, thumb_asset_id, created_by, created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, orgId, "video", title, "", ref.provider, ref.videoId, thumbAssetId, w.id, w.name]);
  const row = await rowFor(id, orgId);
  res.status(201).json({ item: itemOut(row), sentence: noThumb
    ? `Added "${title}". Vimeo did not send a picture for it, so in an email it shows as a plain panel with a play button and its title.`
    : `Added "${title}" to your library.` });
}));

app.put("/media/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await rowFor(req.params.id, orgId);
  if (!r) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  const sets = [], args = [];
  if (b.title !== undefined) {
    const title = clean(b.title, TITLE_CAP);
    if (!title) return res.status(400).json({ error: "title_required", sentence: "Give it a title, so you can find it again." });
    sets.push("title=?"); args.push(title);
  }
  if (b.alt !== undefined) {
    const alt = clean(b.alt, ALT_CAP);
    if (!alt && r.kind === "photo") return res.status(400).json({ error: "alt_required", sentence: ALT_SENTENCE });
    sets.push("alt=?"); args.push(alt);
  }
  if (sets.length) await run(`UPDATE media_items SET ${sets.join(", ")} WHERE id=? AND org_id=?`, [...args, r.id, orgId]);
  const row = await rowFor(r.id, orgId);
  res.json({ item: itemOut(row), previous: { title: r.title, alt: r.alt } });
}));

for (const [verb, val] of [["remove", "NOW()"], ["restore", "NULL"]]) {
  app.post(`/media/:id/${verb}`, requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const r = await rowFor(req.params.id, orgId);
    if (!r) return res.status(404).json({ error: "Not found" });
    await run(`UPDATE media_items SET removed_at=${val} WHERE id=? AND org_id=?`, [r.id, orgId]);
    const row = await rowFor(r.id, orgId);
    res.json({ ok: true, item: itemOut(row) });
  }));
}
}

module.exports = { routers, mount, encodeEmailSafe, vimeoThumbnail };
