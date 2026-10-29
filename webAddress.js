// SECURE-1 · a website someone typed, made safe to store and to link to.
//
// A stored website ends up as an href (the super admin's network review, an
// org's footer), and a link of "javascript:…" runs on the page that shows it.
// So a website is the web and nothing else: http(s) as typed, a bare domain
// ("harborlight.org") given https, and anything with any other scheme refused.
//   webAddress("harborlight.org")      -> "https://harborlight.org"
//   webAddress("javascript:alert(1)")  -> null
//   webAddress("")                     -> ""   (cleared)
function webAddress(v, max = 300) {
  const t = String(v == null ? "" : v).trim();
  if (!t) return "";
  if (t.length > max || /[\s<>"'`]/.test(t)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : "https://" + t.replace(/^\/+/, "");
  let u;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname) return null;
  return u.toString().replace(/\/$/, t.endsWith("/") ? "/" : "");
}
module.exports = { webAddress };
