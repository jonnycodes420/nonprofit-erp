// shared/emailBlocks.js · EMAIL-1. AN EMAIL FROM THE SAME BLOCKS AS A PAGE.
//
// Pure: no DB, no network, no clock. The server and the browser render the
// same HTML from the same blocks.
//
// THE CONTRACT:
//   renderEmail({ blocks, brand, fields, preheader, subject, links, mode })
//     blocks   widget blocks whose type is in typesForSurface("email")
//     brand    { band, bandFg, accent, accentFg, buttonColor, typePairing, logoUrl, displayName }
//              from the org's one brand (portal_settings), read at render time
//              (buttonFg is read too when present; it defaults to bandFg)
//     fields   { first_name, last_gift_amount, last_gift_date, campaign, give_link, org_name, ... }
//     links    { assetBase, videoPage(provider, videoId) -> url, event(id) -> {name,date,url}, givingPage(id) -> {title,url,image} }
//              (optional: videoThumb(provider, videoId) -> url, for Vimeo when the block carries no thumbUrl)
//     mode     "send" | "preview"
//   returns { html, text, images: [{ src, alt }], problems: [string] }
//   The footer (address and unsubscribe) is a placeholder the send path fills
//   with unsubscribeEmailFooterHtml; it is always present, whatever the blocks.
//
// WHO REFUSES A SEND WITH PROBLEMS: THE RENDERER. In mode "send", any problem
// (a photo with no alt text, an empty photo, a .webp, an unknown merge field,
// a blank left to fill, a button with nowhere to go) makes renderEmail THROW an
// Error with code "EMAIL_NOT_READY" and `.problems` set. A caller cannot forget
// to check, because there is no html to send. In mode "preview" the same
// problems come back in `problems` and the email still renders, with a neutral
// placeholder where a photo is missing, so the person can see what to fix.
//
// EMAIL-CLIENT SAFETY: a 600px centred table, every style inline, no flexbox,
// no grid, no web font required (each stack ends in a system family), buttons
// are table cells with bgcolor (bulletproof), images carry width, border 0,
// display block and alt. The only <style> block holds the two media queries an
// inbox may ignore without harm: the phone stack and the dark scheme.

export const FOOTER_SLOT = "<!--steward:footer-->";

// The fields a person may type into an email. Every one is filled per donor
// at send time; anything else in {{ }} is reported, never sent as braces.
export const EMAIL_MERGE_FIELDS = [
  { key: "first_name",       token: "{{first_name}}",       label: "First name",        sample: "Margaret", fallback: "friend" },
  { key: "last_gift_amount", token: "{{last_gift_amount}}", label: "Their last gift",   sample: "$250",     fallback: "your gift" },
  { key: "last_gift_date",   token: "{{last_gift_date}}",   label: "Last gift date",    sample: "March 3, 2026", fallback: "recently" },
  { key: "campaign",         token: "{{campaign}}",         label: "Campaign",          sample: "Spring Appeal", fallback: "our work" },
  { key: "give_link",        token: "{{give_link}}",        label: "Giving link",       sample: "https://www.stewardapp.dev/give/sample", fallback: "" },
  { key: "org_name",         token: "{{org_name}}",         label: "Your organisation", sample: "your organisation", fallback: "our organisation" },
];
const MERGE_KEYS = new Set(EMAIL_MERGE_FIELDS.map(f => f.key));
const MERGE_ALIASES = { first: "first_name", org: "org_name" };

// The dark block is named so the preview can force it on (it rewrites this
// one media line to `@media all`).
export const DARK_MEDIA = "@media (prefers-color-scheme: dark)";
export const PHONE_MEDIA = "@media only screen and (max-width:620px)";

// Font stacks per brand type pairing. The first family is a nicety; each stack
// ends in families every inbox has, so nothing has to load.
export const EMAIL_FONT_STACKS = {
  dm:        { serif: "Georgia,'Times New Roman',serif", sans: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
  classic:   { serif: "Georgia,'Times New Roman',serif", sans: "Verdana,Geneva,sans-serif" },
  editorial: { serif: "'Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif", sans: "'Gill Sans','Gill Sans MT','Trebuchet MS',Arial,sans-serif" },
  literary:  { serif: "Baskerville,'Hoefler Text','Times New Roman',Georgia,serif", sans: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
  modern:    { serif: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", sans: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" },
};

export const BUTTON_ACTIONS = ["give", "rsvp", "volunteer", "readmore"];
export const BUTTON_ACTION_LABEL = { give: "Give", rsvp: "RSVP", volunteer: "Volunteer", readmore: "Read more" };
export const VIDEO_PROVIDERS = ["youtube", "vimeo"];

// Neutral email chrome. These are the email's own surface (like the portal),
// not Steward's app chrome.
const C = {
  page: "#f0ede6", card: "#ffffff", ink: "#0f1a12", body: "#3a3a35", muted: "#6b6b64",
  hair: "#e7e4dc", placeholder: "#e7e4dc", darkPage: "#121412", darkCard: "#1d201d", darkInk: "#f0ede6", darkMuted: "#b9b5ac",
};
const W = 600, PAD = 32, INNER = W - PAD * 2;

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const isHex = v => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
const color = (v, d) => (isHex(v) ? v : d);

export function youtubeThumb(videoId) {
  return `https://img.youtube.com/vi/${encodeURIComponent(String(videoId || ""))}/hqdefault.jpg`;
}

// ── Merge fields ───────────────────────────────────────────────────────────
// Text is escaped FIRST, then each known token is replaced by its escaped
// value, so neither the person's words nor a donor's name can carry markup.
function mergeText(raw, fields, problems, where) {
  const escaped = esc(raw);
  return escaped.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, name) => {
    const key = MERGE_ALIASES[name] || name;
    if (!MERGE_KEYS.has(key)) {
      problems.push(`${where}: {{${name}}} is not a field Steward can fill. Use one of ${EMAIL_MERGE_FIELDS.map(f => f.token).join(", ")}.`);
      return whole;
    }
    return esc(fieldValue(fields, key));
  });
}
function fieldValue(fields, key) {
  const v = fields && fields[key];
  if (v != null && String(v).trim() !== "") return String(v);
  const def = EMAIL_MERGE_FIELDS.find(f => f.key === key);
  return def ? def.fallback : "";
}
// A URL may be a merge token ({{give_link}}) or a typed http(s) link.
function mergeUrl(raw, fields) {
  let u = String(raw || "").trim();
  u = u.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (w, n) => {
    const k = MERGE_ALIASES[n] || n;
    return MERGE_KEYS.has(k) ? fieldValue(fields, k) : "";
  });
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : (/^mailto:[^\s"'<>]+$/i.test(u) ? u : "");
}
// Square-bracket blanks ("[number]", "[name of program]") are deliberate
// spaces the org fills; a send with one left in would print the brackets.
function blankCheck(raw, problems, where) {
  const m = String(raw || "").match(/\[[^\]\n]{1,60}\]/);
  if (m) problems.push(`${where}: fill in ${m[0]} before this is sent.`);
}

function resolveSrc(src, links) {
  const s = String(src || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) {
    const base = String((links && links.assetBase) || "").replace(/\/+$/, "");
    return base + s;
  }
  return "";
}

// The subject line as plain text with the fields filled (a subject is not
// HTML, so nothing is escaped). Unknown fields are left as typed; renderEmail
// reports them.
export function renderSubject(subject, fields) {
  return String(subject || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (w, n) => {
    const k = MERGE_ALIASES[n] || n;
    return MERGE_KEYS.has(k) ? fieldValue(fields || {}, k) : w;
  }).replace(/[\r\n]+/g, " ").trim();
}

// ── The renderer ───────────────────────────────────────────────────────────
export function renderEmail({ blocks, brand, fields, preheader, subject, links, mode } = {}) {
  const problems = [];
  const images = [];
  const text = [];
  const L = links || {};
  const F = fields || {};
  const B = brand || {};
  const band = color(B.band, "#1a6b4a"), bandFg = color(B.bandFg, "#ffffff");
  const accent = color(B.accent, "#c9a84c");
  const btnBg = color(B.buttonColor, band), btnFg = color(B.buttonFg, bandFg);
  const fonts = EMAIL_FONT_STACKS[B.typePairing] || EMAIL_FONT_STACKS.dm;
  const orgName = String(B.displayName || F.org_name || "").trim();
  const list = Array.isArray(blocks) ? blocks : [];

  const T = (raw, where) => { blankCheck(raw, problems, where); return mergeText(raw, F, problems, where); };
  // The plain-text part gets the same fields, unescaped (it is not HTML).
  const plain = s => String(s == null ? "" : s).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (w, n) => {
    const k = MERGE_ALIASES[n] || n;
    return MERGE_KEYS.has(k) ? fieldValue(F, k) : w;
  });

  // One image, email-safe. A missing src renders a neutral placeholder in a
  // preview and is a problem; a missing alt is a problem in every mode.
  function img(src, alt, width, where, extraStyle = "") {
    const url = resolveSrc(src, L);
    const altTxt = String(alt || "").trim();
    if (!url) {
      problems.push(`${where}: choose a photo (it shows as a grey box until you do).`);
      return `<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:${width}px;max-width:100%;" class="st-img"><tr><td height="${Math.round(width * 0.5)}" bgcolor="${C.placeholder}" align="center" valign="middle" style="background:${C.placeholder};color:${C.muted};font-family:${fonts.sans};font-size:13px;height:${Math.round(width * 0.5)}px;">Photo to choose</td></tr></table>`;
    }
    if (/\.webp(\?|#|$)/i.test(url) || /^data:/i.test(String(src))) {
      problems.push(`${where}: ${/^data:/i.test(String(src)) ? "a pasted image cannot be sent; choose it from the media library" : "WebP photos do not show in some inboxes; use a JPEG or PNG"}.`);
    }
    if (!altTxt) problems.push(`${where}: add alt text (a few words saying what the photo shows).`);
    images.push({ src: url, alt: altTxt });
    return `<img src="${esc(url)}" width="${width}" alt="${esc(altTxt)}" class="st-img" style="display:block;width:${width}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;${extraStyle}">`;
  }

  // A bulletproof button: the colour is on the table cell, so it shows even
  // where images are off and padding on links is ignored.
  function button(label, href, where) {
    const url = mergeUrl(href, F);
    if (!url) problems.push(`${where}: the button needs a link.`);
    const lbl = T(label || "Read more", where);
    text.push(`${plain(label || "Read more")}: ${url || "(link to add)"}`);
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>
<td align="center" bgcolor="${btnBg}" style="background:${btnBg};border-radius:8px;mso-padding-alt:14px 28px;">
<a href="${esc(url || "#")}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${fonts.sans};font-size:16px;font-weight:bold;line-height:20px;color:${btnFg};text-decoration:none;border-radius:8px;">${lbl}</a>
</td></tr></table>`;
  }

  const row = (inner, pad = `16px ${PAD}px`, cls = "st-card") =>
    `<tr><td class="${cls}" bgcolor="${C.card}" style="background:${C.card};padding:${pad};">${inner}</td></tr>`;
  const P = (html, extra = "") => `<p class="st-text" style="margin:0 0 14px;font-family:${fonts.sans};font-size:16px;line-height:1.6;color:${C.body};${extra}">${html}</p>`;
  const H = (html, size = 24, extra = "") => `<h2 class="st-ink" style="margin:0 0 10px;font-family:${fonts.serif};font-size:${size}px;line-height:1.25;font-weight:normal;color:${C.ink};${extra}">${html}</h2>`;

  const rows = [];
  list.forEach((w, i) => {
    if (!w || typeof w !== "object") return;
    const where = `Block ${i + 1} (${w.type})`;
    switch (w.type) {
      case "header": {
        const logo = resolveSrc(B.logoUrl, L);
        let inner;
        if (logo) {
          images.push({ src: logo, alt: orgName || "Logo" });
          inner = `<img src="${esc(logo)}" height="40" alt="${esc(orgName || "Logo")}" style="display:block;height:40px;width:auto;max-width:240px;border:0;margin:0 auto;">`;
        } else {
          inner = `<span style="font-family:${fonts.serif};font-size:22px;color:${bandFg};">${esc(orgName)}</span>`;
        }
        rows.push(`<tr><td align="center" bgcolor="${band}" style="background:${band};padding:20px ${PAD}px;">${inner}</td></tr>`);
        text.push(orgName);
        break;
      }
      case "hero": {
        const parts = [];
        if (w.image !== undefined) {
          rows.push(`<tr><td class="st-card" bgcolor="${C.card}" style="background:${C.card};padding:0;">${img(w.image, w.alt, W, where)}</td></tr>`);
        }
        if (w.heading) { parts.push(H(T(w.heading, where), w.size === "tall" ? 34 : 28)); text.push(plain(w.heading).toUpperCase()); }
        if (w.sub) { parts.push(P(T(w.sub, where), "font-size:17px;")); text.push(plain(w.sub)); }
        if (parts.length) rows.push(row(parts.join(""), `28px ${PAD}px 8px`));
        break;
      }
      case "richtext": {
        const out = [];
        for (const b of (Array.isArray(w.blocks) ? w.blocks : [])) {
          if (!b) continue;
          if (b.type === "h2") { out.push(H(T(b.text, where), 20, "margin-top:8px;")); text.push(plain(b.text)); }
          else if (b.type === "ul") {
            const items = (Array.isArray(b.items) ? b.items : []).map(it => `<li class="st-text" style="margin:0 0 6px;font-family:${fonts.sans};font-size:16px;line-height:1.6;color:${C.body};">${T(it, where)}</li>`).join("");
            out.push(`<ul style="margin:0 0 14px;padding:0 0 0 22px;">${items}</ul>`);
            for (const it of (b.items || [])) text.push(`- ${plain(it)}`);
          } else { out.push(P(T(b.text, where))); text.push(plain(b.text)); }
        }
        if (out.length) rows.push(row(out.join(""), `12px ${PAD}px 4px`));
        break;
      }
      case "image": {
        const cap = w.caption ? `<p class="st-muted" style="margin:8px 0 0;font-family:${fonts.sans};font-size:13px;line-height:1.5;color:${C.muted};">${T(w.caption, where)}</p>` : "";
        rows.push(row(img(w.image, w.alt, INNER, where) + cap, `12px ${PAD}px`));
        if (w.caption) text.push(plain(w.caption));
        break;
      }
      case "photos2": {
        const ims = Array.isArray(w.images) ? w.images.slice(0, 2) : [];
        while (ims.length < 2) ims.push({ src: null, alt: "" });
        const half = (INNER - 12) / 2;
        const cell = (im, k) => `<td class="st-col" width="50%" valign="top" style="width:50%;padding:${k ? "0 0 0 6px" : "0 6px 0 0"};">${img(im && im.src, im && im.alt, half, `${where}, photo ${k + 1}`)}</td>`;
        rows.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${ims.map(cell).join("")}</tr></table>`, `12px ${PAD}px`));
        break;
      }
      case "stats": {
        const items = (Array.isArray(w.items) ? w.items : []).slice(0, 3);
        if (!items.length) break;
        const pct = Math.floor(100 / items.length);
        const cells = items.map((s, k) => {
          const val = String((s && s.value) || "").trim();
          if (!val) problems.push(`${where}: stat ${k + 1} has no number yet; add your own figure or remove it.`);
          text.push(`${val || "[number]"} ${plain(s && s.label)}`);
          return `<td class="st-col" width="${pct}%" align="center" valign="top" style="width:${pct}%;padding:8px 6px;">
<div class="st-ink" style="font-family:${fonts.serif};font-size:30px;line-height:1.2;color:${C.ink};">${val ? T(val, where) : "[number]"}</div>
<div class="st-muted" style="font-family:${fonts.sans};font-size:12px;line-height:1.4;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${T((s && s.label) || "", where)}</div></td>`;
        }).join("");
        rows.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`, `16px ${PAD}px`));
        break;
      }
      case "quote": {
        if (!w.text) { problems.push(`${where}: the quote is empty.`); break; }
        const attr = w.attribution ? `<p class="st-muted" style="margin:8px 0 0;font-family:${fonts.sans};font-size:14px;color:${C.muted};">${T(w.attribution, where)}</p>` : "";
        rows.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:4px solid ${accent};padding:4px 0 4px 18px;">
<p class="st-ink" style="margin:0;font-family:${fonts.serif};font-size:20px;line-height:1.5;color:${C.ink};">&ldquo;${T(w.text, where)}&rdquo;</p>${attr}</td></tr></table>`, `16px ${PAD}px`));
        text.push(`"${plain(w.text)}"${w.attribution ? ` ${plain(w.attribution)}` : ""}`);
        break;
      }
      case "video": {
        const provider = VIDEO_PROVIDERS.includes(w.provider) ? w.provider : null;
        const vid = String(w.videoId || "").trim();
        if (!provider || !vid) { problems.push(`${where}: add a YouTube or Vimeo link.`); break; }
        const href = typeof L.videoPage === "function" ? String(L.videoPage(provider, vid) || "") : "";
        if (!/^https?:\/\//i.test(href)) problems.push(`${where}: the video has no page to open.`);
        const thumb = provider === "youtube" ? youtubeThumb(vid)
          : resolveSrc(w.thumbUrl || (typeof L.videoThumb === "function" ? L.videoThumb(provider, vid) : ""), L);
        const alt = String(w.caption || "").trim() || "Play the video";
        const h = Math.round(W * 9 / 16);
        if (thumb) images.push({ src: thumb, alt });
        else problems.push(`${where}: the Vimeo thumbnail is missing; pick the video from the media library again.`);
        // The thumbnail is the cell's background; a centred circle sits on it.
        // Where background images are off, the dark cell and the circle remain.
        const bg = thumb ? ` background="${esc(thumb)}"` : "";
        const bgStyle = thumb ? `background-image:url('${esc(thumb)}');background-size:cover;background-position:center;` : "";
        rows.push(`<tr><td class="st-card" bgcolor="${C.card}" style="background:${C.card};padding:0;">
<a href="${esc(href || "#")}" target="_blank" style="text-decoration:none;display:block;" title="${esc(alt)}">
<table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0" class="st-img" style="width:${W}px;max-width:100%;"><tr>
<td${bg} bgcolor="${C.ink}" width="${W}" height="${h}" align="center" valign="middle" class="st-video" style="${bgStyle}background-color:${C.ink};height:${h}px;text-align:center;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td width="72" height="72" align="center" valign="middle" bgcolor="${band}" style="width:72px;height:72px;border-radius:36px;background:${band};color:${bandFg};font-family:Arial,sans-serif;font-size:30px;line-height:72px;text-align:center;">&#9654;</td></tr></table>
</td></tr></table></a>
${w.caption ? `<p class="st-muted" style="margin:0;padding:8px ${PAD}px 0;font-family:${fonts.sans};font-size:13px;color:${C.muted};">${T(w.caption, where)}</p>` : ""}</td></tr>`);
        text.push(`Watch the video: ${href || "(link to add)"}`);
        break;
      }
      case "button": {
        const action = BUTTON_ACTIONS.includes(w.action) ? w.action : "readmore";
        const raw = String(w.url || "").trim() || (action === "give" ? "{{give_link}}" : "");
        rows.push(row(button(w.label || BUTTON_ACTION_LABEL[action], raw, where), `12px ${PAD}px 20px`));
        break;
      }
      case "event": {
        const ev = typeof L.event === "function" && w.eventId ? L.event(w.eventId) : null;
        if (!ev) { problems.push(`${where}: choose one of your events.`); break; }
        const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.hair};border-radius:10px;"><tr><td style="padding:18px 20px;">
<div class="st-muted" style="font-family:${fonts.sans};font-size:12px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${esc(ev.date || "")}</div>
${H(esc(ev.name || "Our event"), 22, "margin:4px 0 14px;")}
${button("RSVP", ev.url || "", where)}</td></tr></table>`;
        rows.push(row(inner, `12px ${PAD}px`));
        text.push(`${plain(ev.name)} ${plain(ev.date)}`);
        break;
      }
      case "givingpage": {
        const gp = typeof L.givingPage === "function" && w.givingPageId ? L.givingPage(w.givingPageId) : null;
        if (!gp) { problems.push(`${where}: choose one of your giving pages.`); break; }
        const pic = gp.image ? img(gp.image, gp.title || "Giving page", INNER - 2, where) : "";
        const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.hair};border-radius:10px;"><tr><td style="padding:0;">${pic}</td></tr><tr><td style="padding:18px 20px;">
${H(esc(gp.title || "Give"), 22, "margin:0 0 14px;")}
${button("Give", gp.url || "", where)}</td></tr></table>`;
        rows.push(row(inner, `12px ${PAD}px`));
        text.push(plain(gp.title));
        break;
      }
      case "signature": {
        const name = String(w.name || "").trim();
        if (!name) problems.push(`${where}: add the name the email is signed with.`);
        const photo = w.photo ? `<td width="64" valign="middle" style="width:64px;padding:0 14px 0 0;">${img(w.photo, name || "Photo", 56, where, "border-radius:28px;")}</td>` : "";
        rows.push(row(`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${photo}<td valign="middle">
<div class="st-ink" style="font-family:${fonts.serif};font-size:18px;color:${C.ink};">${T(name || "[your name]", where)}</div>
${w.title ? `<div class="st-muted" style="font-family:${fonts.sans};font-size:14px;color:${C.muted};">${T(w.title, where)}</div>` : ""}</td></tr></table>`, `8px ${PAD}px 24px`));
        text.push(`${plain(name)}${w.title ? `\n${plain(w.title)}` : ""}`);
        break;
      }
      case "footer":
        // The footer is filled by the send path at FOOTER_SLOT, once, below.
        break;
      default:
        problems.push(`${where}: this block cannot go in an email.`);
    }
  });

  const subj = subject ? mergeText(subject, F, problems, "Subject") : "";
  if (subject) blankCheck(subject, problems, "Subject");
  const pre = preheader ? mergeText(preheader, F, problems, "Preview line") : "";
  if (preheader) blankCheck(preheader, problems, "Preview line");

  const style = `<style type="text/css">
body{margin:0;padding:0;}
table{border-collapse:collapse;}
img{-ms-interpolation-mode:bicubic;}
${PHONE_MEDIA}{
.st-wrap{width:100% !important;}
.st-col{display:block !important;width:100% !important;padding:0 0 12px 0 !important;}
.st-img{width:100% !important;height:auto !important;}
.st-video{height:200px !important;}
}
${DARK_MEDIA}{
.st-body,.st-page{background:${C.darkPage} !important;}
.st-card{background:${C.darkCard} !important;}
.st-ink{color:${C.darkInk} !important;}
.st-text{color:${C.darkInk} !important;}
.st-muted{color:${C.darkMuted} !important;}
}
[data-ogsc] .st-card{background:${C.darkCard} !important;}
[data-ogsc] .st-ink,[data-ogsc] .st-text{color:${C.darkInk} !important;}
</style>`;

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${subj}</title>
${style}
</head>
<body class="st-body" style="margin:0;padding:0;background:${C.page};">
<span style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${pre}${"&#847;&zwnj;&nbsp;".repeat(30)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="st-page" bgcolor="${C.page}" style="background:${C.page};">
<tr><td align="center" style="padding:24px 0;">
<table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0" class="st-wrap" style="width:${W}px;max-width:${W}px;margin:0 auto;">
${rows.join("\n")}
<tr><td class="st-card" bgcolor="${C.card}" style="background:${C.card};padding:8px ${PAD}px 24px;font-family:${fonts.sans};font-size:12px;line-height:1.5;color:${C.muted};">${FOOTER_SLOT}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const uniq = [...new Set(problems)];
  if (mode === "send" && uniq.length) {
    const err = new Error(`This email is not ready to send: ${uniq[0]}`);
    err.code = "EMAIL_NOT_READY";
    err.problems = uniq;
    throw err;
  }
  return { html, text: text.filter(Boolean).join("\n\n"), images, problems: uniq };
}

// ── The lint ───────────────────────────────────────────────────────────────
// Read the finished HTML the way a strict inbox would. It does not trust the
// renderer: it is the check that the renderer kept its promises.
export function lintEmailHtml(html) {
  const s = String(html || "");
  const problems = [];
  if (/<iframe\b/i.test(s)) problems.push("Contains an <iframe>, which no inbox shows.");
  if (/<script\b/i.test(s)) problems.push("Contains a <script>, which inboxes strip or reject.");
  if (/<video\b|<audio\b|<form\b|<object\b|<embed\b/i.test(s)) problems.push("Contains media or a form element inboxes do not support.");
  if (/display\s*:\s*(inline-)?flex|display\s*:\s*(inline-)?grid|\bflex-direction\b|\bgrid-template/i.test(s)) problems.push("Uses flexbox or grid, which many inboxes ignore.");
  if (/\.webp\b/i.test(s)) problems.push("References a WebP image, which some inboxes cannot show.");
  if (/src\s*=\s*["']data:/i.test(s)) problems.push("Embeds an image as a data URI.");
  for (const m of s.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\salt\s*=\s*"[^"]*\S[^"]*"/i.test(m[0])) problems.push(`An image has no alt text: ${m[0].slice(0, 80)}`);
  }
  const slots = s.split(FOOTER_SLOT).length - 1;
  if (slots === 0) problems.push("The footer (address and unsubscribe) slot is missing.");
  if (slots > 1) problems.push("The footer slot appears more than once.");
  if (/\u2014/.test(s)) problems.push("Contains an em dash.");
  return problems;
}

// ── The block validator ────────────────────────────────────────────────────
// The server saves only what passes this. Images must be our own asset paths
// (/portal-assets/...) or media URLs (http(s)); never a data URI. A video must
// already be a parsed {provider, videoId}. Returns { ok, blocks, error }.
const MAX_BLOCKS = 40;
const str = (v, max) => (v == null ? "" : String(v)).slice(0, max);
function imageRef(v) {
  if (v == null || v === "") return { ok: true, v: null };
  const s = String(v).trim();
  if (/^data:/i.test(s)) return { ok: false };
  if (/^\/portal-assets\/[A-Za-z0-9_.-]+$/.test(s)) return { ok: true, v: s };
  if (/^\/media\/[A-Za-z0-9_./-]+$/.test(s)) return { ok: true, v: s };
  if (/^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 1000) return { ok: true, v: s };
  return { ok: false };
}
export function validateEmailBlocks(blocks, allowedTypes) {
  if (!Array.isArray(blocks)) return { ok: false, error: "blocks must be a list." };
  if (blocks.length > MAX_BLOCKS) return { ok: false, error: `An email holds at most ${MAX_BLOCKS} blocks.` };
  const allowed = new Set(allowedTypes || []);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const w = blocks[i];
    const at = `Block ${i + 1}`;
    if (!w || typeof w !== "object" || !allowed.has(w.type)) return { ok: false, error: `${at}: ${w && w.type ? `"${w.type}"` : "this"} is not an email block.` };
    const img1 = (v, label) => { const r = imageRef(v); if (!r.ok) throw new Error(`${at}: ${label} must be a photo from your media library, not a pasted image or another kind of link.`); return r.v; };
    try {
      switch (w.type) {
        case "header": case "footer": out.push({ type: w.type }); break;
        case "hero": out.push({ type: "hero", heading: str(w.heading, 200), sub: str(w.sub, 600), image: img1(w.image, "the hero photo"), alt: str(w.alt, 200), size: w.size === "tall" ? "tall" : "standard" }); break;
        case "richtext": {
          const bl = (Array.isArray(w.blocks) ? w.blocks : []).slice(0, 40).map(b => {
            if (b && b.type === "ul") return { type: "ul", items: (Array.isArray(b.items) ? b.items : []).slice(0, 30).map(x => str(x, 600)) };
            return { type: b && b.type === "h2" ? "h2" : "p", text: str(b && b.text, 4000) };
          });
          out.push({ type: "richtext", blocks: bl }); break;
        }
        case "image": out.push({ type: "image", image: img1(w.image, "the photo"), alt: str(w.alt, 200), caption: str(w.caption, 300) }); break;
        case "photos2": {
          const ims = (Array.isArray(w.images) ? w.images : []).slice(0, 2).map((im, k) => ({ src: img1(im && im.src, `photo ${k + 1}`), alt: str(im && im.alt, 200) }));
          while (ims.length < 2) ims.push({ src: null, alt: "" });
          out.push({ type: "photos2", images: ims }); break;
        }
        case "stats": out.push({ type: "stats", items: (Array.isArray(w.items) ? w.items : []).slice(0, 3).map(s => ({ value: str(s && s.value, 40), label: str(s && s.label, 80) })) }); break;
        case "quote": out.push({ type: "quote", text: str(w.text, 1000), attribution: str(w.attribution, 200) }); break;
        case "video": {
          if (!VIDEO_PROVIDERS.includes(w.provider) || !/^[A-Za-z0-9_-]{1,64}$/.test(String(w.videoId || ""))) throw new Error(`${at}: the video must be a YouTube or Vimeo link.`);
          const th = w.thumbUrl ? img1(w.thumbUrl, "the video thumbnail") : null;
          out.push({ type: "video", provider: w.provider, videoId: String(w.videoId), caption: str(w.caption, 300), ...(th ? { thumbUrl: th } : {}) }); break;
        }
        case "button": {
          const url = str(w.url, 1000).trim();
          if (url && !/^https?:\/\/[^\s"'<>]+$/i.test(url) && !/^\{\{\s*give_link\s*\}\}$/.test(url)) throw new Error(`${at}: the button link must start with https://.`);
          out.push({ type: "button", action: BUTTON_ACTIONS.includes(w.action) ? w.action : "readmore", label: str(w.label, 60), url }); break;
        }
        case "event": out.push({ type: "event", eventId: str(w.eventId, 80) }); break;
        case "givingpage": out.push({ type: "givingpage", givingPageId: str(w.givingPageId, 80) }); break;
        case "signature": out.push({ type: "signature", name: str(w.name, 120), title: str(w.title, 120), photo: img1(w.photo, "the signature photo") }); break;
        default: return { ok: false, error: `${at}: "${w.type}" is not an email block.` };
      }
    } catch (e) { return { ok: false, error: e.message }; }
  }
  return { ok: true, blocks: out };
}
