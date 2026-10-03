// shared/richText.js · PARITY-3 Part 2. THE RECRUITMENT PAGE'S WORDS, MADE SAFE.
//
// A coordinator writes the volunteer page in a rich-text editor: headings,
// paragraphs, bold and italic, lists, links, images she uploaded and a video
// from YouTube or Vimeo. What she writes is shown to the public on the org's
// own page, so it is stored only after it has been rebuilt from an ALLOWLIST:
// every tag not named here is dropped, every attribute not named here is
// dropped, and the few attributes kept are checked one by one. Nothing is
// "escaped and hoped"; anything not understood is not there.
//
//   sanitizeRichText(html) -> the html that may be stored and shown
//   embedFor(url)          -> the player address for a YouTube or Vimeo link, or null
//
// The same function runs in the browser (to preview exactly what will be
// kept) and on the server (which is the one that decides).

const ALLOWED = new Set(["h2", "h3", "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "img", "figure", "figcaption", "blockquote", "iframe"]);
const VOID = new Set(["br", "img"]);
const DROP_WITH_CONTENT = /<(script|style|noscript|template|object|embed|svg|math|textarea|select|button|form)\b[\s\S]*?<\/\1\s*>/gi;

const escText = s => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = s => String(s).replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A link goes to the web or to an email address, and nowhere else.
function safeHref(v) {
  const t = String(v || "").trim();
  if (/^https?:\/\/[^\s"<>]+$/i.test(t)) return t;
  if (/^mailto:[^\s"<>@]+@[^\s"<>]+$/i.test(t)) return t;
  return null;
}
// An image is one the org uploaded to Steward (its /portal-assets/ path, kept
// relative so it serves from wherever the page is), or an https image.
const ASSET = /(?:^|\/)portal-assets\/(pa_[0-9a-f]{8,40})$/i;
function safeSrc(v) {
  const t = String(v || "").trim();
  const m = ASSET.exec(t);
  if (m) return `/portal-assets/${m[1]}`;
  if (/^https:\/\/[^\s"<>]+$/i.test(t)) return t;
  return null;
}

// A video is a YouTube or Vimeo player, never any other frame.
export function embedFor(url) {
  const t = String(url || "").trim();
  let m;
  if ((m = /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube(?:-nocookie)?\.com\/embed\/)([A-Za-z0-9_-]{6,20})/i.exec(t)))
    return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  if ((m = /^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{5,12})/i.exec(t)))
    return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

function attrsOf(raw) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

function rebuild(tag, raw) {
  const a = attrsOf(raw);
  if (tag === "a") {
    const href = safeHref(a.href);
    return href ? `<a href="${escAttr(href)}" rel="noopener nofollow" target="_blank">` : "<a>";
  }
  if (tag === "img") {
    const src = safeSrc(a.src);
    if (!src) return "";
    const alt = String(a.alt || "").slice(0, 200);
    return `<img src="${escAttr(src)}" alt="${escAttr(alt)}">`;
  }
  if (tag === "iframe") {
    const src = embedFor(a.src);
    return src ? `<iframe src="${escAttr(src)}" title="Video" allowfullscreen loading="lazy"></iframe>` : "";
  }
  return `<${tag}>`;
}

export const RICH_MAX = 40000;

export function sanitizeRichText(html) {
  let s = String(html || "").slice(0, RICH_MAX * 2).replace(/<!--[\s\S]*?-->/g, "").replace(DROP_WITH_CONTENT, "");
  const out = [];
  const open = [];
  const re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    out.push(escText(s.slice(last, m.index)));
    last = re.lastIndex;
    const closing = m[1] === "/", tag = m[2].toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    if (tag === "iframe") { if (!closing) out.push(rebuild(tag, m[3])); continue; }   // the frame closes itself
    if (closing) {
      if (VOID.has(tag)) continue;
      const i = open.lastIndexOf(tag);
      if (i === -1) continue;
      while (open.length > i) out.push(`</${open.pop()}>`);
      continue;
    }
    const built = rebuild(tag, m[3]);
    if (!built) continue;
    out.push(built);
    if (!VOID.has(tag)) open.push(tag);
  }
  out.push(escText(s.slice(last)));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join("").slice(0, RICH_MAX);
}
