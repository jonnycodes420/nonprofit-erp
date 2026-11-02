// server/shared/chequeImage.js — storing a cheque's image.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).

function mount(ctx) {
const {
  imageBytesMatchMime, personPhoto, putThemeAsset,
} = ctx;

const CHEQUE_LONG_EDGE = 1600;
async function storeChequeImage({ orgId, dataUri }) {
  const m = typeof dataUri === "string" ? dataUri.match(/^data:([^;]+);base64,(.*)$/s) : null;
  if (!m) return { error: "That file isn't an image we can use. Please use a PNG or JPEG photo." };
  if (dataUri.length > personPhoto.PHOTO_MAX_STR) return { error: "That photo is larger than 10 MB." };
  const declared = m[1];
  let buffer; try { buffer = Buffer.from(m[2], "base64"); } catch { buffer = null; }
  if (!buffer || !buffer.length) return { error: "That file isn't an image we can use." };
  if (buffer.length > personPhoto.PHOTO_MAX_BYTES) return { error: "That photo is larger than 10 MB." };
  if (!["image/png", "image/jpeg", "image/webp"].includes(declared) || !imageBytesMatchMime(declared, buffer)) {
    return { error: "That file isn't an image we can use. Please use a PNG or JPEG photo." };
  }
  try {
    const sharp = require("sharp");
    const out = await sharp(buffer, { failOn: "none" }).rotate()
      .resize({ width: CHEQUE_LONG_EDGE, height: CHEQUE_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86 })                       // higher than a headshot: this has to stay READABLE
      .toBuffer({ resolveWithObject: true });
    const asset = await putThemeAsset({
      orgId, kind: personPhoto.PHOTO_ASSET_KIND, buffer: out.data,
      contentType: "image/webp", width: out.info.width, height: out.info.height,
    });
    return { assetId: asset.id };
  } catch (e) {
    console.error("[check] resize failed:", e.message);
    return { error: "We couldn't process that photo. Try taking it again in better light." };
  }
}
return { storeChequeImage };
}

module.exports = { mount };
