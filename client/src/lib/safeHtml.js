// SECURE-1 · email HTML made safe to put on a Steward page.
//
// A campaign body, a template or an AI draft is HTML that someone other than
// the person looking at it may have written (a template from a colleague, a
// draft a model wrote from donor data). Before it is placed in the editor or
// the preview it is parsed in an inert document (DOMParser runs nothing) and
// everything that can run is removed: script-bearing elements, every on*
// handler, and any link or source that is not the web, an email address or an
// uploaded image. Inline styles and tables stay, because an email needs them.
// The server-side allowlist for public pages is shared/richText.js; this is the
// lighter one for email bodies, which only staff see.

const DROP = "script,iframe,frame,frameset,object,embed,applet,link,meta,base,form,input,button,textarea,select,noscript,template,svg,math";
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "background", "poster", "srcset"];

function safeUrl(name, v) {
  const t = String(v || "").trim().replace(/[\u0000-\u001f\s]+/g, "");
  if (!t) return true;
  if (/^(https?:|mailto:|tel:|#|\/|cid:)/i.test(t)) return true;
  if (/^{{[a-z_]+}}$/i.test(t)) return true;                       // a merge field the send fills
  if (name === "src" && /^data:image\/(png|jpe?g|gif|webp);/i.test(t)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(t);                          // relative: fine; any other scheme: no
}

export function safeHtml(html) {
  const s = String(html || "");
  if (!s || typeof DOMParser === "undefined") return s.replace(/</g, "&lt;");
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${s}`, "text/html");
  doc.body.querySelectorAll(DROP).forEach(n => n.remove());
  doc.body.querySelectorAll("*").forEach(el => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "srcdoc" || n === "formaction") el.removeAttribute(a.name);
      else if (URL_ATTRS.includes(n) && !safeUrl(n, a.value)) el.removeAttribute(a.name);
      else if (n === "style" && /expression\(|javascript:|url\(\s*['"]?\s*(?!https?:|data:image)/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}
