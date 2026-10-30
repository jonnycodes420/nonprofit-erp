// routes/stockPhotos.js · EDITOR-1. THERE IS ALWAYS A PHOTO.
//
//   GET  /stock-photos                 the bundled library, the org's own group first
//   GET  /stock-photos/thumb/:id       a small copy for the picker (public, like any bundled file)
//   POST /stock-photos/:id/use         the photo as THIS org's portal asset -> { url, alt, fx, fy, stock, id }
//
// The photos live in the repo (assets/stock, catalog in shared/stockPhotos.js,
// licenses in assets/stock/LICENSES.md). Using one stores its bytes through
// assetStore for the org, exactly as an upload is stored (S3 when a bucket is
// configured), so every picture path Steward already has (Picture, PhotoField,
// the event page's /portal-assets/pa_ rule, an email's image) takes it
// unchanged. Assets are content-addressed per org, so using the same photo
// twice is the same asset, and nothing is stored until somebody uses one.
//
// A picture that came from here carries `stock: true` in its meta until it is
// replaced. That is only ever believed of a url that IS one of the bundled
// photos for this org (isStockUrl), so a client cannot mark its own upload as
// stock or keep the mark on a photo it replaced.
//
// Nothing here runs at boot or deploy, and no existing row is rewritten: the
// two create routes (a new giving page, a new event) call stockPictureForOrg
// when they make a row, and only then.
"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const { putThemeAsset, assetIdFor, assetPath } = require("../assetStore");

const routers = { r0: express.Router() };
const STOCK_DIR = path.join(__dirname, "..", "assets", "stock");
const KIND = "picture";            // the kind every page picture is stored under (pictures.js)
const CONTENT_TYPE = "image/jpeg";

let SP = null;
const READY = import("../shared/stockPhotos.js").then(m => { SP = m; });
let C = null;   // the mounted context

// The bytes of one bundled photo, read once.
const bytesCache = new Map();
function stockBytes(p) {
  if (!bytesCache.has(p.id)) bytesCache.set(p.id, fs.readFileSync(path.join(STOCK_DIR, p.file)));
  return bytesCache.get(p.id);
}
// The asset id a bundled photo has for one org (assetStore's own rule).
function stockAssetId(orgId, p) { return assetIdFor(orgId, KIND, CONTENT_TYPE, stockBytes(p)); }

// Is this url one of the bundled photos, stored for this org? Returns the
// catalog entry or null.
async function isStockUrl(orgId, url) {
  await READY;
  const u = String(url || "");
  if (!u.startsWith("/portal-assets/")) return null;
  for (const p of SP.STOCK_PHOTOS) if (assetPath(stockAssetId(orgId, p)) === u) return p;
  return null;
}

// Store one bundled photo for an org (or find it stored) and hand back its picture.
async function useStockPhoto(orgId, id) {
  await READY;
  const p = SP.stockById(id);
  if (!p) return null;
  const buffer = stockBytes(p);
  let width = null, height = null;
  try { const meta = await require("sharp")(buffer).metadata(); width = meta.width || null; height = meta.height || null; } catch { /* sizes are a nicety */ }
  const asset = await putThemeAsset({ orgId, kind: KIND, buffer, contentType: CONTENT_TYPE, width, height, isPublic: true });
  return { url: asset.path, alt: p.alt, fx: 0.5, fy: 0.5, stock: true, id: p.id, group: p.group };
}

// The org's group, from its mission and website.
async function orgGroup(orgId) {
  await READY;
  const [o] = await C.query("SELECT mission, website FROM orgs WHERE id=?", [orgId]).catch(() => []);
  return SP.missionGroup(o && o.mission, o && o.website);
}

// The stock picture a NEW page or event starts with: the org's group, one
// photo of it chosen steadily by `seed` (the new row's id). Never throws: a
// row is made with or without its photo.
async function stockPictureForOrg(orgId, seed) {
  try {
    await READY;
    const group = await orgGroup(orgId);
    return await useStockPhoto(orgId, SP.pickStock(group, seed).id);
  } catch (e) {
    console.error("[stock-photos] no starting photo:", e.message);
    return null;
  }
}

function mount(ctx) {
  C = ctx;
  const { requireAuth, checkWriteAccess, wrap } = ctx;
  const app = routers.r0;

  app.get("/stock-photos", requireAuth, wrap(async (req, res) => {
    await READY;
    const suggested = await orgGroup(req.user.orgId);
    const order = [suggested, ...SP.GROUP_KEYS.filter(k => k !== suggested)];
    res.json({
      suggested,
      groups: order.map(key => ({
        key, label: SP.groupLabel(key),
        photos: SP.STOCK_PHOTOS.filter(p => p.group === key).map(p => ({
          id: p.id, alt: p.alt, group: p.group, photographer: p.photographer,
          thumb: `/stock-photos/thumb/${encodeURIComponent(p.id)}`,
        })),
      })),
    });
  }));

  // A bundled file, so public like the app's own images: no org, no person.
  app.get("/stock-photos/thumb/:id", wrap(async (req, res) => {
    await READY;
    const p = SP.stockById(req.params.id);
    if (!p) return res.status(404).json({ error: "not_found" });
    res.set("Content-Type", CONTENT_TYPE);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(fs.readFileSync(path.join(STOCK_DIR, SP.thumbFile(p))));
  }));

  // A POST because the first use stores the photo for the org.
  app.post("/stock-photos/:id/use", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const pic = await useStockPhoto(req.user.orgId, req.params.id);
    if (!pic) return res.status(404).json({ error: "not_found", message: "That photo is not one of Steward's." });
    res.json(pic);
  }));
}

module.exports = { mount, routers, useStockPhoto, stockPictureForOrg, isStockUrl, orgGroup, STOCK_DIR };
