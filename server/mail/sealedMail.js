// server/mail/sealedMail.js — SECURE-3 item 2. SYNCED MAIL IS SEALED AT REST.
//
// A Gmail or Outlook read (syncMailboxRun, server.js) keeps the text of a
// conversation with somebody the organisation knows, and, for a funder or a
// pledge form, the attachment. Before this file both sat readable in Postgres
// (interactions.note, portal_assets.data): anyone with a database dump, a
// leaked backup or a read-only SQL session read the mail. Now:
//
//   interactions.note         the one unsealed line ("Replied to Dana: Re: the
//                             gala (1 attachment, in the mailbox)"), so lists,
//                             the timeline, search on people and the Thread work
//   interactions.body_sealed  the message text, sealed (the envelope below)
//   interactions.body_key_id  which master key wrapped it ("k1"), for rotation
//   portal_assets.sealed_header / sealed_key_id
//                             the same for a stored attachment: the bytes in
//                             `data` (or the S3 object) are the ciphertext
//
// ── ENVELOPE ENCRYPTION ────────────────────────────────────────────────────
// Each row gets its own random 256-bit data key (DEK). The DEK seals the
// content (AES-256-GCM). The DEK is itself sealed ("wrapped") by a master key
// from the environment (the KEK, derived by HKDF from the env string and the
// key id). The row stores the wrapped DEK and the key id. Rotating the master
// is then a rewrap of 32 bytes per row, never a re-encryption of the mail.
//
//   envelope: m1.<keyId>.<wrapIv>.<wrapTag>.<wrappedDek>.<iv>.<tag>[.<ct>]
//   (base64url parts; an attachment's header has no <ct>, its bytes are the ct)
//
// AAD binds the ciphertext to its organisation and its row: the content and
// the wrap both authenticate `mail:<orgId>:<interactionId>` (or
// `mailasset:<orgId>:<assetId>`). A sealed body copied into another tenant's
// row, or onto another row of the same tenant, does not open. The donor is NOT
// in the AAD on purpose: a merge moves the row to another person and must keep
// it readable.
//
// ── THE KEYRING ────────────────────────────────────────────────────────────
//   STEWARD_MAIL_KEYS   optional, "k2:<secret>,k1:<secret>". The FIRST entry
//                       seals; every entry opens. When set it is the whole ring.
//   unset               the ring is { k1: STEWARD_CREDENTIAL_KEY }, the key that
//                       already seals the mailbox tokens (shared/secretBox.js).
// A secret shorter than 32 characters is not a key (secretBox's floor).
//
// ── THE STANCE (secretBox's, unchanged) ────────────────────────────────────
// THERE IS NO PLAINTEXT PATH. Sealing with no key THROWS MailKeyMissing: the
// sync run records the failure and logs nothing, it never stores the body in
// the clear. Opening with a wrong or missing key THROWS MailOpenFailed: never
// garbage, never a silent empty. Nothing here reads the env at import time, so
// a server with no key boots; only a seal or an open asks.
"use strict";

const crypto = require("crypto");

const VERSION = "m1";
const MAIL_KEYS_ENV = "STEWARD_MAIL_KEYS";
const CREDENTIAL_KEY_ENV = "STEWARD_CREDENTIAL_KEY";
const KEY_MIN_LENGTH = 32;
const DEFAULT_KEY_ID = "k1";
const IV_BYTES = 12, TAG_BYTES = 16, DEK_BYTES = 32;
const KEY_ID_RE = /^[a-z0-9]{1,16}$/;

class MailKeyMissing extends Error {
  constructor(msg) {
    super(msg || `No mail key: set ${CREDENTIAL_KEY_ENV} (or ${MAIL_KEYS_ENV}). Synced mail is never stored unsealed.`);
    this.name = "MailKeyMissing"; this.code = "MAIL_KEY_MISSING";
  }
}
class MailOpenFailed extends Error {
  constructor(msg) {
    super(msg || "sealed mail did not open");
    this.name = "MailOpenFailed"; this.code = "MAIL_OPEN_FAILED";
  }
}

const b64u = buf => Buffer.from(buf).toString("base64url");
const unb64u = s => Buffer.from(String(s), "base64url");

// The ring: [{ id, secret }], the sealing key first. Not cached (secretBox's
// rule): a restart with a new env value takes it, nothing holds key material.
function keyring(env = process.env) {
  const raw = env && typeof env[MAIL_KEYS_ENV] === "string" ? env[MAIL_KEYS_ENV].trim() : "";
  if (raw) {
    const out = [];
    for (const part of raw.split(",")) {
      const i = part.indexOf(":");
      if (i < 1) continue;
      const id = part.slice(0, i).trim(), secret = part.slice(i + 1).trim();
      if (KEY_ID_RE.test(id) && secret.length >= KEY_MIN_LENGTH && !out.some(k => k.id === id)) out.push({ id, secret });
    }
    return out;
  }
  const cred = env && typeof env[CREDENTIAL_KEY_ENV] === "string" ? env[CREDENTIAL_KEY_ENV].trim() : "";
  return cred.length >= KEY_MIN_LENGTH ? [{ id: DEFAULT_KEY_ID, secret: cred }] : [];
}
const currentKey = env => keyring(env)[0] || null;
const currentKeyId = env => (currentKey(env) || {}).id || null;

// What is wrong with the ring, for /health or a boot line: null when sealing works.
function mailKeyProblem(env = process.env) {
  const raw = env && typeof env[MAIL_KEYS_ENV] === "string" ? env[MAIL_KEYS_ENV].trim() : "";
  if (raw && !keyring(env).length) return "mail_keys_unparsed";
  return keyring(env).length ? null : "unset";
}

function kek(secret, keyId) {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0),
    Buffer.from("steward:mail-kek:" + keyId, "utf8"), 32));
}
function gcm(key, iv, aad, data) {
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(data), c.final()]);
  return { ct, tag: c.getAuthTag() };
}
function ungcm(key, iv, tag, aad, ct) {
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
function needAad(aad) {
  if (typeof aad !== "string" || !aad) throw new TypeError("sealed mail needs an aad (org and row)");
  return aad;
}

function wrapDek(dek, aad, key) {
  const wiv = crypto.randomBytes(IV_BYTES);
  const w = gcm(kek(key.secret, key.id), wiv, "dek:" + aad, dek);
  return [VERSION, key.id, b64u(wiv), b64u(w.tag), b64u(w.ct)];
}
function unwrapDek(parts, aad, env) {
  const [v, keyId, wiv, wtag, wct] = parts;
  if (v !== VERSION) throw new MailOpenFailed("not an m1 envelope");
  const key = keyring(env).find(k => k.id === keyId);
  if (!key) throw new MailOpenFailed(`sealed mail did not open: key ${KEY_ID_RE.test(keyId) ? keyId : "?"} is not in the keyring`);
  try {
    const t = unb64u(wtag);
    if (t.length !== TAG_BYTES) throw new Error("tag");
    const dek = ungcm(kek(key.secret, key.id), unb64u(wiv), t, "dek:" + aad, unb64u(wct));
    if (dek.length !== DEK_BYTES) throw new Error("dek");
    return dek;
  } catch { throw new MailOpenFailed(); }
}

// Bytes → { header, ct, keyId }. THROWS MailKeyMissing with no key.
function sealBytes(buffer, { aad, env = process.env } = {}) {
  needAad(aad);
  const key = currentKey(env);
  if (!key) throw new MailKeyMissing();
  if (!Buffer.isBuffer(buffer)) throw new TypeError("sealBytes takes a Buffer");
  const dek = crypto.randomBytes(DEK_BYTES), iv = crypto.randomBytes(IV_BYTES);
  const c = gcm(dek, iv, aad, buffer);
  return { header: [...wrapDek(dek, aad, key), b64u(iv), b64u(c.tag)].join("."), ct: c.ct, keyId: key.id };
}
function openBytes(header, ct, { aad, env = process.env } = {}) {
  needAad(aad);
  const parts = String(header || "").split(".");
  if (parts.length !== 7) throw new MailOpenFailed("not an m1 header");
  const dek = unwrapDek(parts, aad, env);
  try {
    const t = unb64u(parts[6]);
    if (t.length !== TAG_BYTES) throw new Error("tag");
    return ungcm(dek, unb64u(parts[5]), t, aad, Buffer.isBuffer(ct) ? ct : Buffer.from(ct || ""));
  } catch { throw new MailOpenFailed(); }
}

// Text → { envelope, keyId }; envelope → text.
function sealText(text, opts = {}) {
  if (typeof text !== "string") throw new TypeError("sealText takes a string");
  const s = sealBytes(Buffer.from(text, "utf8"), opts);
  return { envelope: s.header + "." + b64u(s.ct), keyId: s.keyId };
}
function openText(envelope, opts = {}) {
  const parts = String(envelope || "").split(".");
  if (parts.length !== 8) throw new MailOpenFailed("not an m1 envelope");
  return openBytes(parts.slice(0, 7).join("."), unb64u(parts[7]), opts).toString("utf8");
}

// ROTATION: the same content under the current key. Only the DEK is rewrapped.
function rewrap(sealed, { aad, env = process.env } = {}) {
  needAad(aad);
  const key = currentKey(env);
  if (!key) throw new MailKeyMissing();
  const parts = String(sealed || "").split(".");
  if (parts.length !== 7 && parts.length !== 8) throw new MailOpenFailed("not an m1 envelope");
  const dek = unwrapDek(parts, aad, env);
  return { sealed: [...wrapDek(dek, aad, key), ...parts.slice(5)].join("."), keyId: key.id };
}
const keyIdOf = sealed => String(sealed || "").split(".")[1] || null;

// ── THE INTERACTION ROW ─────────────────────────────────────────────────────
const interactionAad = (orgId, id) => `mail:${orgId}:${id}`;
const assetAad = (orgId, id) => `mailasset:${orgId}:${id}`;

// The columns a synced email is written with: `note` is the one line, the
// body is sealed. No body (AI off, metadata only) seals nothing.
function sealedEmailColumns(orgId, interactionId, line, body, opts = {}) {
  const text = String(body || "");
  if (!text.trim()) return { note: line, body_sealed: null, body_key_id: null };
  const s = sealText(text, { ...opts, aad: interactionAad(orgId, interactionId) });
  return { note: line, body_sealed: s.envelope, body_key_id: s.keyId };
}

const UNREADABLE = "Steward could not open the text of this email: the key it was sealed with is not available. Nothing has been changed; tell Steward support.";

// THE ONE READER. A row as a signed-in screen shows it: `note` is the line and
// the opened body, exactly what was written before sealing. The sealed columns
// never leave the server. A row that will not open says so in its note and in
// the log (CRITICAL); it is never shown as the line alone, as if that were all.
function openInteraction(row, opts = {}) {
  if (!row || typeof row !== "object") return row;
  const { body_sealed, body_key_id, ...out } = row;
  if (!body_sealed) return out;
  try {
    const body = openText(body_sealed, { ...opts, aad: interactionAad(row.org_id, row.id) });
    out.note = out.note ? `${out.note}\n\n${body}` : body;
  } catch (e) {
    console.error(`[sealed-mail] CRITICAL: interaction ${row.id} did not open (${e.code || e.name}, key ${body_key_id || "?"})`);
    out.note = out.note ? `${out.note}\n\n${UNREADABLE}` : UNREADABLE;
    out.body_unreadable = true;
  }
  return out;
}
const openInteractions = (rows, opts) => (rows || []).map(r => openInteraction(r, opts));
// A reader that deliberately gets the line: the sealed columns are dropped.
function stubInteraction(row) {
  if (!row || typeof row !== "object") return row;
  const { body_sealed, body_key_id, ...out } = row;
  return out;
}

// An edit to a sealed email (PUT /interactions/:id): what she typed is split
// at the first blank line into the line and the body, and the body is sealed
// again, so an edit never writes the text in the clear.
function resealEdited(orgId, interactionId, typed, opts = {}) {
  const s = String(typed || "");
  const at = s.indexOf("\n\n");
  const line = at < 0 ? s : s.slice(0, at), body = at < 0 ? "" : s.slice(at + 2);
  return sealedEmailColumns(orgId, interactionId, line, body, opts);
}

module.exports = {
  VERSION, MAIL_KEYS_ENV, CREDENTIAL_KEY_ENV, DEFAULT_KEY_ID, KEY_MIN_LENGTH,
  MailKeyMissing, MailOpenFailed, UNREADABLE,
  keyring, currentKeyId, mailKeyProblem,
  sealBytes, openBytes, sealText, openText, rewrap, keyIdOf,
  interactionAad, assetAad, sealedEmailColumns, openInteraction, openInteractions, stubInteraction, resealEdited,
};
