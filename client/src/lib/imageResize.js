// FIX-41 · a camera photo made small before it travels. The browser decodes
// the file, draws it no larger than 2560 pixels on its long edge and encodes it
// as WebP (JPEG where WebP cannot be written) at 0.85. The server still checks
// every byte and compresses again; this only keeps a 5 MB phone photo from
// taking 5 MB of upload. A file the browser cannot decode (HEIC on most
// browsers) is sent as it is, and the server converts it.
export const LONG_EDGE = 2560;
export const QUALITY = 0.85;

const readAsDataUrl = file => new Promise(resolve => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => resolve(null);
  r.readAsDataURL(file);
});

export function isHeicFile(file) {
  const t = String((file && file.type) || "").toLowerCase();
  const n = String((file && file.name) || "").toLowerCase();
  return t === "image/heic" || t === "image/heif" || n.endsWith(".heic") || n.endsWith(".heif");
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

// SECURE-1 · an SVG can carry script, so Steward stores none: the browser
// draws it once as a PNG (an <img> never runs an SVG's script) and the PNG is
// what travels. The server refuses a raw SVG.
export const SVG_LONG_EDGE = 1600;
export async function svgToPng(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const w = img.naturalWidth || 800, h = img.naturalHeight || 800;
    const scale = SVG_LONG_EDGE / Math.max(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

// Returns a data URI ready for POST /pictures/upload.
export async function shrinkImage(file) {
  const type = String(file.type || "").toLowerCase();
  if (type === "image/svg+xml") return svgToPng(file);
  // GIF passes through: it may move.
  if (type === "image/gif" || isHeicFile(file)) {
    const raw = await readAsDataUrl(file);
    if (raw && isHeicFile(file) && !/^data:image\/hei[cf]/.test(raw)) return raw.replace(/^data:[^;]*;/, "data:image/heic;");
    return raw;
  }
  let bmp;
  try { bmp = await decode(file); } catch { return readAsDataUrl(file); }
  const w = bmp.width, h = bmp.height;
  if (!w || !h) return readAsDataUrl(file);
  const scale = Math.min(1, LONG_EDGE / Math.max(w, h));
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return readAsDataUrl(file);
  ctx.drawImage(bmp, 0, 0, cw, ch);
  if (bmp.close) bmp.close();
  let out = canvas.toDataURL("image/webp", QUALITY);
  if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/jpeg", QUALITY);
  // A small PNG with flat colour can be larger re-encoded; keep the smaller.
  if (file.size && out.length * 0.75 > file.size && scale === 1) return readAsDataUrl(file);
  return out;
}
