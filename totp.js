// totp.js — BUILD-98 (switch) Part 8. TWO-STEP SIGN-IN CODES (RFC 6238).
//
// The six-digit code an authenticator app shows: HMAC-SHA1 over a 30-second
// counter. Written on Node's crypto rather than a dependency because it is
// thirty lines and every line is checkable against the RFC's own test vectors
// (tests/build98-security.test.js runs them).
//
// A code is accepted one step either side of now, the RFC's recommended drift
// allowance, and never twice: the caller stores the last counter used and
// refuses a code at or below it, so a code read over someone's shoulder is
// dead once it has been typed.
"use strict";
const crypto = require("crypto");

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s) {
  const clean = String(s || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function newSecret() { return base32Encode(crypto.randomBytes(20)); }

function hotp(secretB32, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

const counterAt = (ms = Date.now()) => Math.floor(ms / 1000 / 30);

// Returns the counter the code matched (to be stored as last-used), or null.
function verify(secretB32, code, { now = Date.now(), window = 1, lastCounter = -1 } = {}) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const at = counterAt(now);
  for (let d = -window; d <= window; d++) {
    const ctr = at + d;
    if (ctr <= lastCounter) continue;
    const want = hotp(secretB32, ctr);
    if (want.length === c.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return ctr;
  }
  return null;
}

function otpauthUrl(secretB32, { account, issuer = "Steward" }) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
         `?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { base32Encode, base32Decode, newSecret, hotp, verify, counterAt, otpauthUrl };
