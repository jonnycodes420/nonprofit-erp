// redactEvent.js — SECURE-2 item 1, the browser's half. The server's redact.js
// is the one redactor for logs and server Sentry; this is the same shape list,
// cut to what a browser error can carry, for the client's Sentry beforeSend.
// A browser event keeps the page, the release and the stack; never an email,
// a phone, a token, a cookie or the person's name.
const SHAPES = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, (_m, k) => `${k} [token]`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[token]"],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, "[secret]"],
  [/([?&;](?:token|code|key|secret|sig|signature|state|access_token|refresh_token|t)=)[^&#\s"'<>]+/gi, (_m, p) => p + "[token]"],
  [/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, "[phone]"],
];
export function redactString(s) {
  if (typeof s !== "string" || !s) return s;
  let out = s;
  for (const [re, rep] of SHAPES) out = out.replace(re, rep);
  return out;
}
function deep(v, d = 0) {
  if (typeof v === "string") return redactString(v);
  if (!v || typeof v !== "object" || d > 5) return v;
  if (Array.isArray(v)) return v.map(x => deep(x, d + 1));
  const o = {};
  for (const k of Object.keys(v)) o[k] = /^(name|email|phone|address|body|data|password|token|cookie|authorization)$/i.test(k) ? "[redacted]" : deep(v[k], d + 1);
  return o;
}
export function redactEvent(event) {
  try {
    if (event.request) event.request = { url: redactString(event.request.url || "") };
    if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : {};
    if (event.message) event.message = redactString(event.message);
    for (const ex of (event.exception && event.exception.values) || []) if (ex.value) ex.value = redactString(ex.value);
    if (event.extra) event.extra = deep(event.extra);
    if (event.contexts) event.contexts = deep(event.contexts);
    if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = event.breadcrumbs.map(redactBreadcrumb);
    return event;
  } catch { return null; }
}
export function redactBreadcrumb(b) {
  if (!b) return b;
  return { ...b, message: b.message ? redactString(b.message) : b.message, data: b.data ? deep(b.data) : b.data };
}
