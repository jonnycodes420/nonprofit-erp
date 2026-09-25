// grantDocs.js — BUILD-100 (grants) Part 3. THE FILES A GRANT CARRIES.
//
// A grant's documents are the LOI, the proposal, the award letter, the signed
// agreement, every report submitted, and correspondence. They ride the
// BUILD-51 asset seam under their own kind, behind their OWN signed, expiring,
// private door.
//
// ── WHY ITS OWN SIGNER RATHER THAN personPhoto's ──────────────────────────
// `personPhoto.signPhotoUrl` signs over (org, assetId, expiry) and the photo
// door then checks `kind = 'person'`. Reusing it for documents would make the
// KIND the only thing separating a headshot's link from a signed grant
// agreement's, and that separation would live in the route rather than in the
// signature. BUILD-56's kind-salted asset ids mean the two cannot collide
// today; relying on that coupling is exactly the quiet dependency that breaks
// two builds later. So the kind is INSIDE the HMAC here, and this module signs
// nothing but grant documents.
//
// ── AND WHY THE TTL IS SHORTER ────────────────────────────────────────────
// A photo URL lives 12 hours because it is embedded in row surfaces a browser
// re-renders all day. A document link is clicked once, deliberately, from a
// screen somebody is looking at. THIRTY MINUTES. A signed funder agreement
// carries bank details, an authorised signature and terms; a link that
// outlives the session it was minted in is a link that can be pasted into a
// chat and still work tomorrow.
//
// NOTHING HERE IS PARSED OR READ BY A MODEL. The brief says so and this build
// keeps it: no extraction, no summary, no classifier. Steward stores the file,
// types it, dates it, and hands it back.

const crypto = require("crypto");

const DOC_ASSET_KIND = "grantdoc";
const DOC_URL_TTL_MS = 30 * 60 * 1000;

// 20 MB of DECODED file. A scanned, signed agreement out of a foundation's own
// DocuSign is routinely 8-15 MB, so the image-sized theme-asset caps would
// refuse a real award letter.
//
// THIS NUMBER AND THE BODY-PARSER LIMIT ON `/grants/:id/documents` ARE ONE
// DECISION IN TWO PLACES (20 MB decoded is ~27.4 MB of base64 plus the JSON
// around it, hence a 30mb parser). BUILD-96 raised one without the other and
// got a PayloadTooLargeError surfacing as a bare 500 with nothing useful in
// it; raising either of these alone does the same. Move both or neither.
const DOC_MAX_BYTES = 20 * 1024 * 1024;

// ── THE FIXED LIST ────────────────────────────────────────────────────────
// Closed, for the reason every closed list in this product is closed: "which
// documents are we missing on this grant" is the question the screen exists to
// answer, and free text cannot be counted.
const DOC_TYPES = [
  { key: "loi",            label: "Letter of inquiry", repeatable: false },
  { key: "proposal",       label: "Proposal",          repeatable: true  },
  { key: "award_letter",   label: "Award letter",      repeatable: false },
  { key: "agreement",      label: "Signed agreement",  repeatable: false },
  { key: "report",         label: "Report submitted",  repeatable: true  },
  { key: "correspondence", label: "Correspondence",    repeatable: true  },
];
const DOC_TYPE_KEYS = DOC_TYPES.map(t => t.key);
function docType(key) { return DOC_TYPES.find(t => t.key === key) || null; }
function docTypeLabel(key) { const t = docType(key); return t ? t.label : ""; }

// ── WHAT MAY BE STORED ────────────────────────────────────────────────────
// PDF is the overwhelming majority; Word and plain images are what a small
// office actually has. NO SVG AND NO HTML — a script-bearing document served
// from our own origin is the one thing a document store must refuse (the
// BUILD-94 rule, and it matters more here because these are handed to a
// signed-in browser rather than decoded as an image).
const DOC_MIME = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/plain": "txt",
};
function extensionFor(mime) { return DOC_MIME[String(mime || "").toLowerCase()] || null; }
function mimeAllowed(mime) { return Object.prototype.hasOwnProperty.call(DOC_MIME, String(mime || "").toLowerCase()); }

// THE FIRST BYTES DECIDE, not the filename and not the declared type. A caller
// that says "application/pdf" over an HTML payload is the hole this closes;
// `imageBytesMatchMime` already does exactly this for images, and a document
// store without the same check is the same gap by another name.
function bytesMatchMime(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  const m = String(mime || "").toLowerCase();
  const b = buffer;
  if (m === "application/pdf") return b.slice(0, 5).toString("latin1") === "%PDF-";
  // A .doc is OLE2 with fixed magic. A .docx is a zip, so "PK" is NECESSARY,
  // not sufficient — which is the honest claim: this refuses obvious mislabels,
  // it does not validate Office internals.
  if (m === "application/msword") {
    return b.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return b[0] === 0x50 && b[1] === 0x4b;
  }
  if (m === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (m === "image/png") return b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (m === "image/webp") {
    return b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP";
  }
  if (m === "text/plain") {
    // Text has no magic number. Refuse anything that OPENS like markup — a .txt
    // that is really HTML is the same hole wearing a different extension.
    const head = b.slice(0, 512).toString("utf8").trimStart().toLowerCase();
    if (head.startsWith("<!doctype") || head.startsWith("<html")
        || head.startsWith("<?xml") || head.startsWith("<svg")) return false;
    return !b.slice(0, 512).includes(0);        // a NUL byte means it is not text
  }
  return false;
}

// ── THE SIGNED DOOR ───────────────────────────────────────────────────────
// Keyed off JWT_SECRET through its own label, so a grant-document signature is
// useless anywhere else in the product and rotating JWT_SECRET invalidates
// every outstanding link — the correct blast radius for a link that opens a
// signed agreement.
function docSecret(env = process.env) {
  return crypto.createHmac("sha256", String(env.JWT_SECRET || "")).update("grant-document-url-v1").digest();
}
function docSignature(orgId, assetId, exp, env) {
  return crypto.createHmac("sha256", docSecret(env))
    .update(DOC_ASSET_KIND + "|" + orgId + "|" + assetId + "|" + exp).digest("hex").slice(0, 32);
}
function signDocUrl({ orgId, assetId, now = Date.now(), ttlMs = DOC_URL_TTL_MS, env } = {}) {
  if (!orgId || !assetId) return null;
  const exp = now + ttlMs;
  return "/grant-documents/" + assetId + "?e=" + exp + "&s=" + docSignature(orgId, assetId, exp, env);
}
// Verify against the org on the STORED ROW, never anything the caller sent
// (BUILD-37 B9 applied to a GET). Expired and wrong-org answer alike, so a
// probe cannot tell "this document exists in another tenant" from "this link
// is old".
function verifyDocUrl({ orgId, assetId, e, s, now = Date.now(), env } = {}) {
  const exp = Number(e);
  if (!Number.isFinite(exp) || !s || !orgId || !assetId) return { ok: false, reason: "malformed" };
  if (exp <= now) return { ok: false, reason: "expired" };
  const want = Buffer.from(docSignature(orgId, assetId, exp, env));
  const got = Buffer.from(String(s));
  if (want.length !== got.length) return { ok: false, reason: "signature" };
  if (!crypto.timingSafeEqual(want, got)) return { ok: false, reason: "signature" };
  return { ok: true, expiresAt: exp };
}

// ── VERSIONED BY DATE, NOT OVERWRITTEN ────────────────────────────────────
// Two proposals to one funder are two files and the later does not replace the
// earlier: "what did we actually send them in March" is a question an audit
// asks. Version numbers are DERIVED from the order the files were stored,
// never a column somebody has to keep in step.
function withVersions(docs = []) {
  const seq = new Map();
  return docs
    .slice()
    .sort((a, b) => String(a.uploadedAt || "").localeCompare(String(b.uploadedAt || "")))
    .map(d => {
      const n = (seq.get(d.docType) || 0) + 1;
      seq.set(d.docType, n);
      return Object.assign({}, d, { version: n });
    });
}
// The sentence a list carries. A repeated type says how many; a single one just
// names itself.
function documentSentence(docs = []) {
  if (!docs.length) return "No documents on this grant yet.";
  const byType = new Map();
  for (const d of docs) byType.set(d.docType, (byType.get(d.docType) || 0) + 1);
  const parts = [...byType.entries()].map(([k, n]) => {
    const label = (docTypeLabel(k) || k).toLowerCase();
    return n === 1 ? label : n + " " + label + "s";
  });
  const n = docs.length;
  return n + " " + (n === 1 ? "document" : "documents") + ": " + parts.join(", ") + ".";
}

const FILENAME_MAX = 200;
function sanitizeFilename(raw, mime) {
  // Keep the name a human typed, minus anything that makes it a path or a
  // header. The name is a LABEL — the bytes are addressed by asset id — so
  // there is nothing to gain by being clever with it.
  let s = String(raw == null ? "" : raw)
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\\/]+/g, "-")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, FILENAME_MAX);
  if (!s) s = "document";
  const ext = extensionFor(mime);
  if (ext && !new RegExp("\\." + ext + "$", "i").test(s)) s += "." + ext;
  return s;
}

module.exports = {
  DOC_ASSET_KIND, DOC_URL_TTL_MS, DOC_MAX_BYTES,
  DOC_TYPES, DOC_TYPE_KEYS, docType, docTypeLabel,
  DOC_MIME, extensionFor, mimeAllowed, bytesMatchMime,
  signDocUrl, verifyDocUrl,
  withVersions, documentSentence, sanitizeFilename, FILENAME_MAX,
};
