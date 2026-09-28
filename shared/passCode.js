// shared/passCode.js — MEMBERS-2. THE ONE CODE A DOOR SCANNER READS.
//
// A member card and (EVENTS-2) a ticket both have to answer one question at a
// door held open by somebody with a phone in their hand: who is this, and is
// it real? Two formats would mean two scanners, and the second one is always
// the one that is out of date on the night.
//
// So there is one string:
//
//     STW1.<kind>.<orgId>.<id>.<exp>.<sig>
//
//   kind  — "m" a membership, "t" an event attendee (EVENTS-2)
//   orgId — the org it belongs to, so a code from another org cannot open
//           this door even if the signing secret were somehow the same
//   id    — the membership id or the attendee id
//   exp   — civil seconds; 0 means it does not expire (a lifetime membership)
//   sig   — HMAC-SHA256 over everything before it, base64url, truncated to 24
//           characters. 144 bits: a door code is checked online against a row
//           that must also exist, so the signature's job is to stop a guess,
//           not to stand alone.
//
// Pure: no DB, no clock of its own (the caller passes `now`), no network. The
// verifier returns a REASON, never a boolean, because the door screen has to
// tell somebody standing in front of it what went wrong.

import crypto from "node:crypto";

export const PASS_KINDS = { membership: "m", ticket: "t" };
const SEP = ".";
const PREFIX = "STW1";
const SIG_LEN = 24;

const safe = s => String(s == null ? "" : s).replace(/[^A-Za-z0-9_-]/g, "");

function sign(body, secret) {
  return crypto.createHmac("sha256", String(secret || "")).update(body).digest("base64url").slice(0, SIG_LEN);
}

// `expiresOn` is a civil date (YYYY-MM-DD) or null. A card is readable through
// the whole of its last day, so the cut-off is the END of that day, taken in
// UTC: a door in any timezone would otherwise turn somebody away at a minute
// past midnight in a zone they are not standing in.
export function expSeconds(expiresOn) {
  const d = String(expiresOn || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return 0;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59) / 1000);
}

export function makePassCode({ kind, orgId, id, expiresOn = null, secret }) {
  const k = PASS_KINDS[kind] || safe(kind);
  const body = [PREFIX, k, safe(orgId), safe(id), String(expSeconds(expiresOn))].join(SEP);
  return body + SEP + sign(body, secret);
}

// Returns { ok:true, kind, orgId, id, exp } or { ok:false, reason }.
// Reasons: "unreadable" (not our format), "tampered" (signature), "expired".
export function readPassCode(code, { secret, now = Date.now(), orgId = null } = {}) {
  const parts = String(code || "").trim().split(SEP);
  if (parts.length !== 6 || parts[0] !== PREFIX) return { ok: false, reason: "unreadable" };
  const [, k, org, id, expRaw, sig] = parts;
  if (!k || !org || !id || !/^\d+$/.test(expRaw)) return { ok: false, reason: "unreadable" };
  const body = parts.slice(0, 5).join(SEP);
  const want = sign(body, secret);
  if (want.length !== String(sig).length) return { ok: false, reason: "tampered" };
  if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(sig)))) return { ok: false, reason: "tampered" };
  const exp = Number(expRaw);
  if (exp > 0 && exp * 1000 < now) return { ok: false, reason: "expired" };
  // An org that was named by the caller must match. A code is scoped to one
  // door: the same signature on another org's screen is not a valid code,
  // it is somebody else's.
  if (orgId && org !== safe(orgId)) return { ok: false, reason: "tampered" };
  const kind = Object.keys(PASS_KINDS).find(n => PASS_KINDS[n] === k) || k;
  return { ok: true, kind, orgId: org, id, exp };
}

export const PASS_REASON_WORDS = {
  unreadable: "That is not a Steward code.",
  tampered: "That code does not check out. Look the person up by name instead.",
  expired: "That code has expired.",
};
