// interactionFiles.js — PARITY-1 Part B. A FILE ON A CONVERSATION OR A NOTE.
//
// The office attaches the thing the conversation was about: the pledge form a
// donor signed at the table, the photo of the cheque memo, the spreadsheet of
// the family foundation's giving history. The bytes ride the BUILD-51 asset
// seam (assetStore.js: the S3-compatible bucket when PORTAL_ASSETS_S3_* is set,
// Postgres otherwise) under their own kind, and come back out through their
// OWN signed, expiring, private door, the grantDocs.js pattern.
//
// Why its own signer rather than grantDocs': the kind is inside the HMAC, so a
// link to a donor's attachment is useless as a link to a grant agreement and
// the other way round. Same thirty-minute life, for the same reason: a file
// link is clicked once, deliberately, from a screen somebody is looking at.
//
// NO VIRUS SCANNING. Railway offers none and Steward runs none. What is done
// instead: a closed type list, the first bytes must match the declared type,
// nothing that can carry a script (no SVG, no HTML), every download is served
// as an attachment with nosniff, never rendered inline in our origin.
// docs/decisions/people-and-records.md says what would add a scan.
//
// NOTHING HERE IS READ BY A MODEL. Steward stores the file, names it, dates it
// and hands it back.

const crypto = require("crypto");

const FILE_ASSET_KIND = "ixfile";
const FILE_URL_TTL_MS = 30 * 60 * 1000;

// 10 MB of DECODED file. THIS NUMBER AND THE BODY-PARSER LIMIT ON
// `/interactions/:id/attachments` (server.js, 16mb: 10 MB is ~13.7 MB of base64
// plus the JSON around it) ARE ONE DECISION IN TWO PLACES. Raising either alone
// gives a PayloadTooLargeError that surfaces as a bare 500. Move both or neither.
const FILE_MAX_BYTES = 10 * 1024 * 1024;

const FILE_MIME = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
};
// A browser on Windows often types a .csv as application/vnd.ms-excel, and an
// iPhone hands over HEIC with an empty type. The extension is used ONLY to pick
// the declared type when the browser gave none; the bytes still decide.
const EXT_MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", heic: "image/heic", heif: "image/heif", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain",
};
function extensionFor(mime) { return FILE_MIME[String(mime || "").toLowerCase()] || null; }
function mimeAllowed(mime) { return Object.prototype.hasOwnProperty.call(FILE_MIME, String(mime || "").toLowerCase()); }
function mimeFromName(name) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(name || ""));
  return m ? EXT_MIME[m[1].toLowerCase()] || null : null;
}
// A csv typed as Excel by the browser: the name says csv and the bytes are
// text, so it is stored as the csv it is.
function resolveMime(declared, fileName) {
  const d = String(declared || "").toLowerCase();
  const byName = mimeFromName(fileName);
  if (byName === "text/csv" && (d === "application/vnd.ms-excel" || d === "application/octet-stream" || !d)) return "text/csv";
  if ((!d || d === "application/octet-stream") && byName) return byName;
  return d;
}

const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
function looksLikeText(b) {
  const head = b.slice(0, 512).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml")
      || head.startsWith("<svg") || head.startsWith("<script")) return false;
  return !b.slice(0, 4096).includes(0);
}
// THE FIRST BYTES DECIDE, where the type has a signature. Text has none, so a
// .txt or .csv must at least not open like markup and carry no NUL byte. A
// .docx/.xlsx is a zip: "PK" is necessary, not sufficient, which is the honest
// claim (it refuses obvious mislabels; it does not validate Office internals).
function bytesMatchMime(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  const m = String(mime || "").toLowerCase();
  const b = buffer;
  if (m === "application/pdf") return b.slice(0, 5).toString("latin1") === "%PDF-";
  if (m === "image/png") return b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (m === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (m === "image/gif") { const h = b.slice(0, 6).toString("latin1"); return h === "GIF87a" || h === "GIF89a"; }
  if (m === "image/webp") return b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP";
  if (m === "image/heic" || m === "image/heif") {
    return b.length >= 12 && b.slice(4, 8).toString("latin1") === "ftyp" && HEIC_BRANDS.has(b.slice(8, 12).toString("latin1"));
  }
  if (m === "application/msword" || m === "application/vnd.ms-excel") return b.slice(0, 8).equals(OLE2);
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      || m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return b[0] === 0x50 && b[1] === 0x4b;
  if (m === "text/plain" || m === "text/csv") return looksLikeText(b);
  return false;
}

// ── THE SIGNED DOOR ───────────────────────────────────────────────────────
function fileSecret(env = process.env) {
  return crypto.createHmac("sha256", String(env.JWT_SECRET || "")).update("interaction-file-url-v1").digest();
}
function fileSignature(orgId, assetId, exp, env) {
  return crypto.createHmac("sha256", fileSecret(env))
    .update(FILE_ASSET_KIND + "|" + orgId + "|" + assetId + "|" + exp).digest("hex").slice(0, 32);
}
function signFileUrl({ orgId, assetId, now = Date.now(), ttlMs = FILE_URL_TTL_MS, env } = {}) {
  if (!orgId || !assetId) return null;
  const exp = now + ttlMs;
  return "/interaction-files/" + assetId + "?e=" + exp + "&s=" + fileSignature(orgId, assetId, exp, env);
}
// Verified against the org on the STORED ROW. Expired and wrong-org answer
// alike, so a probe cannot tell "this exists in another tenant" from "old link".
function verifyFileUrl({ orgId, assetId, e, s, now = Date.now(), env } = {}) {
  const exp = Number(e);
  if (!Number.isFinite(exp) || !s || !orgId || !assetId) return { ok: false, reason: "malformed" };
  if (exp <= now) return { ok: false, reason: "expired" };
  const want = Buffer.from(fileSignature(orgId, assetId, exp, env));
  const got = Buffer.from(String(s));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { ok: false, reason: "signature" };
  return { ok: true, expiresAt: exp };
}

const FILENAME_MAX = 200;
function sanitizeFilename(raw, mime) {
  let s = String(raw == null ? "" : raw)
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\\/]+/g, "-")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, FILENAME_MAX);
  if (!s) s = "file";
  const ext = extensionFor(mime);
  if (ext && !new RegExp("\\.(" + ext + (ext === "jpg" ? "|jpeg" : "") + ")$", "i").test(s)) s += "." + ext;
  return s;
}

// The plain words a refusal uses, so the form can say them as they are.
const TYPES_SENTENCE = "PDFs, images (PNG, JPEG, GIF, WebP, HEIC), Word and Excel files, CSV and plain text";

module.exports = {
  FILE_ASSET_KIND, FILE_URL_TTL_MS, FILE_MAX_BYTES, FILE_MIME, TYPES_SENTENCE,
  extensionFor, mimeAllowed, resolveMime, bytesMatchMime,
  signFileUrl, verifyFileUrl, sanitizeFilename,
};
