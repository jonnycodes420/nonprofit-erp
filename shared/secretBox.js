// shared/secretBox.js — BUILD-89S 89a. THE ONE PLACE A THIRD-PARTY CREDENTIAL
// IS SEALED BEFORE IT TOUCHES A COLUMN.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
// 89a's brief said credentials use "the same encryption already used for
// secrets in the repo; if there is none, stop rather than storing a key in
// plain text". There was none. Everything secret this product holds in
// Postgres today sits readable: `gmail_connections.access_token` and
// `.refresh_token`, `users.mfa_secret`. That is a finding of its own and it is
// written up at the time — this file does NOT retroactively fix
// those columns, and pretending otherwise would be worse than the gap.
//
// What it does do is make the NEW gap impossible: a giving source's
// credentials are an API secret on the ORGANISATION'S OWN PayPal, Zeffy,
// Stripe or Givebutter account. That is a key to somebody else's money.
//
// ── THE RULE THAT MAKES THIS SAFE ──────────────────────────────────────────
// THERE IS NO PLAINTEXT PATH. `seal()` with no key configured THROWS, it does
// not fall back and it does not warn-and-continue. The connect route turns
// that throw into a typed 503 and writes nothing. A missing key means the
// feature is unavailable, never that the feature is available and insecure —
// the difference between those two is the entire point, and a fallback (to
// JWT_SECRET, say) would quietly re-create the plaintext path under a name
// that sounds encrypted.
//
// ── THE CONSTRUCTION ───────────────────────────────────────────────────────
//   AES-256-GCM. Per-envelope random salt (16B) and IV (12B).
//   Key = HKDF-SHA256(master, salt, info) — per envelope, so two sealings of
//   the same secret share no key material, and fast enough to open on every
//   sync (scrypt-per-open would put ~100ms on a path that runs per source per
//   six hours for no added strength once the master is already high-entropy).
//   AAD = the binding string the caller passes, which for a giving source is
//   its org id. THIS IS NOT DECORATION: it means a sealed blob copied from one
//   tenant's row into another's fails to open rather than handing org B's
//   PayPal key to org A. Authentication failure is indistinguishable from
//   corruption on purpose — both are "this did not come from here".
//
//   Envelope: v1.<salt>.<iv>.<tag>.<ciphertext>, each base64url.
//   The version prefix is what makes a future rotation a migration rather
//   than a guess: a v2 reader can still open v1.
//
// Pure and dependency-free by design — no DB, no env read at import time, no
// clock — so tests/build89s-sources.test.js can take it apart directly.

import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export const ENVELOPE_VERSION = "v1";
export const CREDENTIAL_KEY_ENV = "STEWARD_CREDENTIAL_KEY";
// 32 characters of a human-pasted value is the floor. Short enough to type,
// long enough that the master is not the weak link; `openssl rand -base64 32`
// is what MANUAL-STEPS.md tells the operator to run.
export const CREDENTIAL_KEY_MIN_LENGTH = 32;

const SALT_BYTES = 16, IV_BYTES = 12, TAG_BYTES = 16, KEY_BYTES = 32;
const HKDF_INFO = "steward:giving-source-credentials";

export class CredentialKeyMissing extends Error {
  constructor(msg) {
    super(msg || `${CREDENTIAL_KEY_ENV} is not set — a giving source cannot be connected until it is`);
    this.name = "CredentialKeyMissing";
    this.code = "CREDENTIAL_KEY_MISSING";
  }
}
export class SealedOpenFailed extends Error {
  constructor(msg) {
    super(msg || "sealed credentials did not open");
    this.name = "SealedOpenFailed";
    this.code = "SEALED_OPEN_FAILED";
  }
}

const b64u = buf => Buffer.from(buf).toString("base64url");
const unb64u = s => Buffer.from(String(s), "base64url");

// The master key, read from the environment and validated. Returns null rather
// than throwing so a READ path (e.g. "is this feature available?") can ask
// without handling an exception; every WRITE path goes through seal(), which
// throws. Deliberately NOT cached: an operator who sets the variable and
// restarts gets it, and nothing in this process should be holding key material
// longer than a call.
export function credentialKey(env = process.env) {
  const raw = env && env[CREDENTIAL_KEY_ENV];
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (key.length < CREDENTIAL_KEY_MIN_LENGTH) return null;
  return key;
}

export function credentialsConfigured(env = process.env) {
  return credentialKey(env) !== null;
}

// A master that is present but too short is its own message: an operator who
// set the variable to "changeme" should be told that, not told it is unset.
export function credentialKeyProblem(env = process.env) {
  const raw = env && env[CREDENTIAL_KEY_ENV];
  if (typeof raw !== "string" || !raw.trim()) return "unset";
  if (raw.trim().length < CREDENTIAL_KEY_MIN_LENGTH) return "too_short";
  return null;
}

function deriveKey(master, salt) {
  return Buffer.from(hkdfSync("sha256", Buffer.from(master, "utf8"), salt, Buffer.from(HKDF_INFO, "utf8"), KEY_BYTES));
}

// seal(plaintext, { aad }) → envelope string. THROWS CredentialKeyMissing when
// no master is configured. `aad` binds the envelope to its row's tenant.
export function seal(plaintext, { aad = "", env = process.env, key = null } = {}) {
  const master = key || credentialKey(env);
  if (!master) throw new CredentialKeyMissing();
  if (typeof plaintext !== "string") throw new TypeError("seal() takes a string");
  const salt = randomBytes(SALT_BYTES), iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(master, salt), iv);
  if (aad) cipher.setAAD(Buffer.from(String(aad), "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [ENVELOPE_VERSION, b64u(salt), b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join(".");
}

// open(envelope, { aad }) → plaintext. Throws SealedOpenFailed on a wrong key,
// a wrong aad (i.e. another tenant's row), or any tampering. Never returns a
// partial or a best guess.
export function open(envelope, { aad = "", env = process.env, key = null } = {}) {
  const master = key || credentialKey(env);
  if (!master) throw new CredentialKeyMissing();
  const parts = String(envelope || "").split(".");
  if (parts.length !== 5 || parts[0] !== ENVELOPE_VERSION) throw new SealedOpenFailed("not a v1 envelope");
  try {
    const [, s, i, t, c] = parts;
    const tag = unb64u(t);
    if (tag.length !== TAG_BYTES) throw new Error("tag length");
    const d = createDecipheriv("aes-256-gcm", deriveKey(master, unb64u(s)), unb64u(i));
    if (aad) d.setAAD(Buffer.from(String(aad), "utf8"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(unb64u(c)), d.final()]).toString("utf8");
  } catch {
    // One message for every failure mode on purpose — a caller learning WHICH
    // check failed learns something about the key it was not entitled to.
    throw new SealedOpenFailed();
  }
}

export function isSealed(s) {
  return typeof s === "string" && s.split(".").length === 5 && s.startsWith(ENVELOPE_VERSION + ".");
}

// A credentials BAG — {clientId, secret} etc. — sealed as one JSON envelope,
// because the fields of one connection are one secret and splitting them into
// separate columns invites half of them being logged.
export function sealBag(bag, opts = {}) {
  return seal(JSON.stringify(bag || {}), opts);
}
export function openBag(envelope, opts = {}) {
  const s = open(envelope, opts);
  try { return JSON.parse(s); } catch { throw new SealedOpenFailed("sealed bag was not JSON"); }
}

// What a screen is allowed to show of a stored credential: never the value,
// only enough for a human to recognise WHICH key they pasted. Four characters
// of a key of at least twelve; anything shorter shows nothing at all rather
// than most of itself.
export function hint(secret) {
  const s = String(secret || "");
  if (s.length < 12) return "••••";
  return "••••" + s.slice(-4);
}
