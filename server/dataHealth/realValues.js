// server/dataHealth/realValues.js · HOTFIX-RHYTHM. ONLY A REAL VALUE MATCHES.
//
// A 6,400-person import "left 4093 possible duplicates". The pair rules
// (dataHealth.js judgePair) matched two people on any email or phone they had
// in common, and a real export is full of values that are not a person's:
// "n/a", "none", "no@email.com" where a form required an email, 000-000-0000
// where it required a phone, and one office line or one family inbox on many
// records. Two people with a common name who both had "n/a" were "same email,
// same name": high confidence. Pure; nothing here reads or writes rows.
//
//   realEmail(v)   the address, lower-cased and trimmed, or null when it is
//                  blank, not an address, or a placeholder
//   realPhone(v)   the ten digits, or null when blank, short, or a placeholder
//                  (one digit repeated, 1234567890, a 0/1 area code, 555-5555)
//   sharedValues(rows)  the real emails and phones that more than SHARED_NAMES
//                  different names carry: an office line, an org's own inbox.
//                  A value many people share says nothing about who is who.
//   contradicts(a, b)   both have a real email and none is the same, or a real
//                  phone, or an address: two people, whatever the names say.
"use strict";

const SHARED_NAMES = 3;

const PLACEHOLDER_LOCAL = new Set(["n/a", "na", "n.a", "none", "no", "noemail", "no-email", "no_email", "nomail", "no.email",
  "noreply", "no-reply", "donotreply", "donotemail", "do-not-email", "unknown", "test", "null", "nil", "x", "xx", "xxx",
  "email", "mail", "dummy", "fake", "notprovided", "not.provided", "declined", "refused"]);
const PLACEHOLDER_DOMAIN = new Set(["none.com", "noemail.com", "nomail.com", "na.com", "no.com", "unknown.com", "email.com",
  "test.com", "fake.com", "noemail.org", "none.org", "donotemail.com", "invalid", "invalid.com"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function realEmail(v) {
  const e = String(v == null ? "" : v).trim().toLowerCase();
  if (!e || !EMAIL_RE.test(e)) return null;
  const [local, domain] = [e.slice(0, e.lastIndexOf("@")), e.slice(e.lastIndexOf("@") + 1)];
  if (PLACEHOLDER_LOCAL.has(local) || PLACEHOLDER_DOMAIN.has(domain)) return null;
  return e;
}

function realPhone(v) {
  const d = String(v == null ? "" : v).replace(/\D+/g, "");
  const t = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
  if (t.length !== 10) return null;
  if (/^(\d)\1{9}$/.test(t)) return null;                       // 000-000-0000, 999-999-9999
  if (t === "1234567890" || t === "0123456789" || t === "9876543210") return null;
  if (/^[01]/.test(t) || /^\d{3}[01]/.test(t)) return null;     // no US number starts its area code or exchange with 0 or 1
  if (/^\d{3}5555555$/.test(t) || /(\d)\1{6}$/.test(t)) return null;   // 555-5555, 000-0000
  return t;
}

const nameKey = s => String(s || "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

function sharedValues(rows) {
  const names = new Map();
  const note = (k, d) => { if (!k) return; if (!names.has(k)) names.set(k, new Set()); names.get(k).add(nameKey(d.name)); };
  for (const d of rows) {
    for (const e of [d.email, d.email2]) note(realEmail(e) && "e:" + realEmail(e), d);
    for (const p of [d.phone, d.mobile]) note(realPhone(p) && "p:" + realPhone(p), d);
  }
  const shared = new Set();
  for (const [k, set] of names) if (set.size > SHARED_NAMES) shared.add(k);
  return shared;
}

// The person's own emails and phones: real, and not one many people share.
function ownEmails(d, shared) { return [d.email, d.email2].map(realEmail).filter(e => e && !(shared && shared.has("e:" + e))); }
function ownPhones(d, shared) { return [d.phone, d.mobile].map(realPhone).filter(p => p && !(shared && shared.has("p:" + p))); }

function contradicts(a, b, { shared = null, addressKey = null } = {}) {
  const differ = (x, y) => x.length > 0 && y.length > 0 && !x.some(v => y.includes(v));
  if (differ(ownEmails(a, shared), ownEmails(b, shared))) return true;
  if (differ(ownPhones(a, shared), ownPhones(b, shared))) return true;
  if (addressKey) { const ka = addressKey(a), kb = addressKey(b); if (ka && kb && ka !== kb) return true; }
  return false;
}

module.exports = { realEmail, realPhone, sharedValues, ownEmails, ownPhones, contradicts, SHARED_NAMES };
