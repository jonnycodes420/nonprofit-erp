// shared/emailCodeSanitize.js · BUILDER-2A item 3. THE CODE BLOCK'S ALLOWLIST.
//
// Pure: no DB, no DOM, no network. A Code block is a small piece of pasted
// HTML. What an inbox shows safely is kept: tables, inline styles, links,
// images with alt text and the basic text tags. Everything else is taken out
// and named, one line each, in `removed`. The renderer turns each removal into
// a problem, so a preview shows the cleaned HTML and says what went, and a
// send with anything removed is refused (EMAIL_NOT_READY). A person fixes
// their paste; Steward never sends something other than what they see.
//
// This is a tokenizer, not a browser parser: whatever it cannot read as an
// allowed tag is text, and text is escaped. So a trick that confuses it comes
// out as visible characters, never as markup.

const KEEP = new Set([
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "p", "br", "hr", "div", "span", "center", "font", "blockquote",
  "a", "img",
  "strong", "b", "em", "i", "u", "s", "small", "sup", "sub",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
]);
const VOID = new Set(["br", "hr", "img", "col"]);
// Taken out with everything inside them: what they hold is not words a person reads.
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "template",
  "svg", "math", "form", "textarea", "select", "button", "title", "head", "video", "audio", "canvas", "xml",
]);
const ATTRS = new Set([
  "style", "href", "src", "alt", "title", "width", "height", "align", "valign", "bgcolor", "border",
  "cellpadding", "cellspacing", "role", "colspan", "rowspan", "target", "color", "face", "size", "dir", "lang", "class",
]);
// A style declaration an inbox may not honour, or one that can reach outside the email.
const BAD_STYLE_VALUE = /expression\s*\(|javascript:|vbscript:|url\s*\(|behavior\s*:|-moz-binding|@import|<|>/i;
const BAD_STYLE_PROP = /^(position|behavior|-moz-binding|flex|flex-.*|grid|grid-.*|z-index|content)$/i;
const BAD_DISPLAY = /^(inline-)?(flex|grid)$/i;

const escText = s => String(s).replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cleanStyle(value, removed, tag) {
  const keep = [];
  for (const decl of String(value).split(";")) {
    const at = decl.indexOf(":");
    if (at < 0) { if (decl.trim()) removed.push(`a style "${decl.trim().slice(0, 40)}" on <${tag}>`); continue; }
    const prop = decl.slice(0, at).trim().toLowerCase();
    const val = decl.slice(at + 1).trim();
    if (!/^-?[a-z][a-z-]*$/.test(prop) || BAD_STYLE_PROP.test(prop) || BAD_STYLE_VALUE.test(val) || (prop === "display" && BAD_DISPLAY.test(val))) {
      removed.push(`the style "${prop}: ${val.slice(0, 40)}" on <${tag}>`);
      continue;
    }
    keep.push(`${prop}:${val}`);
  }
  return keep.join(";");
}

function cleanUrl(v, kind) {
  const s = String(v || "").trim();
  if (kind === "href") return /^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(s) ? s : null;
  return /^https:\/\/[^\s"'<>]+$/i.test(s) && !/\.webp(\?|#|$)/i.test(s) ? s : null;
}

const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

// Clean one tag's attributes. Returns the attribute string (with a leading space) or "".
function cleanAttrs(tag, raw, removed) {
  const out = [];
  let alt = null;
  for (const m of String(raw || "").matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    const value = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : "";
    if (name.startsWith("on")) { removed.push(`the ${name} handler on <${tag}>`); continue; }
    if (!ATTRS.has(name)) { removed.push(`the ${name} attribute on <${tag}>`); continue; }
    if (name === "href" || name === "src") {
      if (name === "src" && tag !== "img") { removed.push(`the src on <${tag}>`); continue; }
      const u = cleanUrl(value, name);
      if (!u) { removed.push(`the ${name} "${value.slice(0, 60)}" on <${tag}> (only ${name === "href" ? "https, http or mailto links" : "https images that are not WebP"})`); continue; }
      out.push(` ${name}="${escAttr(u)}"`);
      continue;
    }
    if (name === "style") {
      const s = cleanStyle(value, removed, tag);
      if (s) out.push(` style="${escAttr(s)}"`);
      continue;
    }
    if (name === "alt") alt = value;
    out.push(` ${name}="${escAttr(value)}"`);
  }
  if (tag === "a" && !out.some(a => a.startsWith(" target="))) out.push(` target="_blank"`);
  return { attrs: out.join(""), alt };
}

// sanitizeEmailCode(html) -> { html, removed: [string], images: [{ src, alt }] }
export function sanitizeEmailCode(input) {
  const src = String(input == null ? "" : input);
  const removed = [];
  const images = [];
  const out = [];
  const open = [];
  const TOKEN = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<!(?:doctype)?[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<|[^<]+/gi;
  let m;
  while ((m = TOKEN.exec(src))) {
    const t = m[0];
    if (t.startsWith("<!--") || t.startsWith("<![CDATA[") || /^<!/.test(t)) {
      if (t.startsWith("<![CDATA[")) removed.push("a CDATA section");
      continue;
    }
    if (!m[1]) { out.push(escText(t)); continue; }
    const tag = m[1].toLowerCase();
    const closing = t[1] === "/";
    if (DROP_WITH_CONTENT.has(tag)) {
      if (closing) continue;
      removed.push(`<${tag}> and what it held`);
      // Skip to its end tag (or the end of the paste).
      const end = new RegExp(`</${tag}\\s*>`, "ig");
      end.lastIndex = TOKEN.lastIndex;
      const e = end.exec(src);
      TOKEN.lastIndex = e ? end.lastIndex : src.length;
      continue;
    }
    if (!KEEP.has(tag)) { if (!closing) removed.push(`<${tag}> (its words are kept)`); continue; }
    if (closing) {
      if (VOID.has(tag)) continue;
      const at = open.lastIndexOf(tag);
      if (at < 0) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    const { attrs, alt } = cleanAttrs(tag, m[2], removed);
    if (tag === "img") {
      const s = (attrs.match(/ src="([^"]*)"/) || [])[1];
      if (!s) { removed.push("an image with no https link"); continue; }
      images.push({ src: s.replace(/&amp;/g, "&"), alt: String(alt || "").trim() });
    }
    out.push(`<${tag}${attrs}>`);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[2] || "")) open.push(tag);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return { html: out.join(""), removed: [...new Set(removed)], images };
}
