// shared/contactCheck.js — SECURE-2 item 3. IS THIS AN EMAIL ADDRESS, AND DID
// SHE MEAN GMAIL?
//
// One check, used by the server (sign-up, invites, donor forms, Tell Steward)
// and by the screens that show a hint while she types. No dependencies, so the
// browser bundle can carry it.
//   emailProblem("a@b")             → "That email address is missing its ending, like .org or .com."
//   emailSuggestion("x@gmial.com")  → "x@gmail.com"
// An import never refuses a row for this: it keeps the value and the profile
// and the preview say "Check this email".

// A real address: a local part, an @, a domain with at least one dot and a
// top-level part of two letters or more. Not the full RFC, which accepts
// things no mail provider delivers to.
const LOCAL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function emailProblem(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/\s/.test(s)) return "That email address has a space in it.";
  const at = s.lastIndexOf("@");
  if (at < 1 || s.indexOf("@") !== at) return "That email address needs exactly one @.";
  const local = s.slice(0, at), domain = s.slice(at + 1);
  if (local.length > 64 || s.length > 254) return "That email address is too long.";
  if (!LOCAL.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return "The part before the @ has a character an email address can't use.";
  const labels = domain.split(".");
  if (labels.length < 2) return "That email address is missing its ending, like .org or .com.";
  if (!labels.every(l => LABEL.test(l))) return "The part after the @ is not a web domain.";
  if (!/^[A-Za-z]{2,}$/.test(labels[labels.length - 1])) return "That email address is missing its ending, like .org or .com.";
  return null;
}

// Common slips on the domains most donors use.
const DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "comcast.net", "att.net",
  "msn.com", "live.com", "me.com", "verizon.net", "sbcglobal.net", "bellsouth.net", "charter.net", "cox.net", "protonmail.com"];
const KNOWN_SLIPS = { "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com",
  "gnail.com": "gmail.com", "gmaill.com": "gmail.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.co": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.co": "hotmail.com", "outlok.com": "outlook.com", "iclod.com": "icloud.com" };
function distance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
export function emailSuggestion(raw) {
  const s = String(raw ?? "").trim();
  const at = s.lastIndexOf("@");
  if (at < 1) return null;
  const typed = s.slice(at + 1).toLowerCase();
  if (!typed || DOMAINS.includes(typed)) return null;
  // A slip in the ending (.con, .cmo, .om) is mended first, so "gmial.con"
  // is one slip from gmail.com, not two.
  const domain = typed.replace(/\.(con|cmo|ocm|vom|xom|om|co)$/, ".com").replace(/\.(ent|nte|met)$/, ".net");
  const fix = KNOWN_SLIPS[typed] || (DOMAINS.includes(domain) ? domain : null) || KNOWN_SLIPS[domain] || DOMAINS.find(d => distance(domain, d) === 1);
  return fix ? s.slice(0, at + 1) + fix : null;
}
// The hint as one sentence: "gmial.com: did you mean gmail.com?"
export function emailHint(raw) {
  const sug = emailSuggestion(raw);
  if (!sug) return null;
  return `${String(raw).trim().slice(String(raw).trim().lastIndexOf("@") + 1)}: did you mean ${sug.slice(sug.lastIndexOf("@") + 1)}?`;
}
