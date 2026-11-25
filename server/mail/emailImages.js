// server/mail/emailImages.js · SENDS-3 item 7. EVERY IMAGE AN EMAIL REFERENCES COMES OUT AS JPEG.
//
// The email rules say a photo goes as a JPEG (a PNG only when it needs
// transparency): older Outlook shows nothing for WebP. The media library
// already stores JPEG (routes/media.js encodeEmailSafe), but a page image, a
// Vimeo thumbnail or an older upload is stored as WebP, and an email that
// pointed at one sent a WebP. Now:
//   · emailSafeHtml(html, orgId) finds every /portal-assets/<id> in an email
//     whose stored type is not JPEG, PNG or GIF and points it at that asset's
//     JPEG rendition (?fmt=jpeg). emailCompose.render runs it on every
//     rendered email, and the wrapped Resend client runs it on every send, so
//     no door can send one without it.
//   · jpegRendition(asset, width) is that rendition: flattened on white,
//     quality 85, metadata dropped, resized only down. GET
//     /portal-assets/:id?fmt=jpeg serves it (routes/give.js), cached in
//     memory and immutable at the CDN like the asset itself.
// The stored bytes never change, so nothing needs repairing.
"use strict";

const EMAIL_SAFE = new Set(["image/jpeg", "image/png", "image/gif"]);
const REF = /\/portal-assets\/(pa_[a-f0-9]{24})(\?[^"'\s)<>]*)?/g;   // assetStore ASSET_ID_RE

// WebP, an SVG stored before SECURE-1, anything an inbox may not draw.
const needsJpeg = contentType => !EMAIL_SAFE.has(String(contentType || "").toLowerCase());

function idsIn(html) {
  const out = new Set();
  for (const m of String(html || "").matchAll(REF)) out.add(m[1]);
  return [...out];
}

// The URL with ?fmt=jpeg (kept once, beside any width already asked for).
// In HTML an ampersand is written &amp;; in a plain URL (an images list) it is not.
function withJpeg(id, qs, html) {
  const params = new URLSearchParams((qs || "").replace(/^\?/, "").replace(/&amp;/g, "&"));
  params.set("fmt", "jpeg");
  const q = params.toString();
  return `/portal-assets/${id}?${html ? q.replace(/&/g, "&amp;") : q}`;
}

// -> html with every non-JPEG/PNG/GIF asset pointed at its JPEG. Never throws: a
// failure to look the types up leaves the html as it was (the send goes on).
async function emailSafeHtml(html, orgId, query = require("../../db").query, { asHtml = true } = {}) {
  const s = String(html || "");
  const ids = idsIn(s);
  if (!ids.length) return s;
  let rows;
  try {
    rows = await query(`SELECT id, content_type FROM portal_assets WHERE id = ANY(?) ${orgId ? "AND org_id = ?" : ""}`, orgId ? [ids, orgId] : [ids]);
  } catch (e) { console.error("[email-images] type lookup failed:", e.message); return s; }
  const convert = new Set(rows.filter(r => needsJpeg(r.content_type)).map(r => r.id));
  if (!convert.size) return s;
  return s.replace(REF, (whole, id, qs) => (convert.has(id) ? withJpeg(id, qs, asHtml) : whole));
}

// The JPEG rendition of one stored asset, optionally at a width (never upscaled).
const CACHE_MAX = 64;
const cache = new Map();
async function jpegRendition(asset, width = null) {
  const key = `${asset.id}:${width || ""}`;
  if (cache.has(key)) { const b = cache.get(key); cache.delete(key); cache.set(key, b); return b; }
  const sharp = require("sharp");
  let pipe = sharp(asset.buffer, { failOn: "error" }).rotate();
  if (width) pipe = pipe.resize({ width, withoutEnlargement: true });
  const out = await pipe.flatten({ background: "#ffffff" }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  cache.set(key, out);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return out;
}

module.exports = { emailSafeHtml, jpegRendition, needsJpeg, idsIn, EMAIL_SAFE };
