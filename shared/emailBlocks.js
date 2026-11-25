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

import { greetMerge } from "./greeting.js";
import { withoutMissingGift, hasValue } from "./giftSentence.js";
import { hasFirstGiftVersion, firstGiftParagraphs, claimIn } from "./pastGiving.js";   // FLOWS-12 item 1
import { cleanStyle, cleanOptions, styledRow, spacerRow, hideRow, HIDE_CSS_PHONE } from "./emailBlockStyle.js";   // BUILDER-1
import { drawMore, validateMore, countBlocks } from "./emailMoreBlocks.js";   // BUILDER-2A: Columns, Box, Social, Code
import { styleForRender } from "./emailStyle.js";   // BUILDER-3: the house style, read at render time

export const FOOTER_SLOT = "<!--steward:footer-->";

// The fields a person may type into an email. Every one is filled per donor
// at send time; anything else in {{ }} is reported, never sent as braces.
export const EMAIL_MERGE_FIELDS = [
  { key: "first_name",       token: "{{first_name}}",       label: "First name",        sample: "Margaret", fallback: "friend" },
  { key: "last_gift_amount", token: "{{last_gift_amount}}", label: "Their last gift",   sample: "$250",     fallback: "your gift" },
  { key: "last_gift_date",   token: "{{last_gift_date}}",   label: "Last gift date",    sample: "March 3, 2026", fallback: "recently" },
  { key: "campaign",         token: "{{campaign}}",         label: "Campaign",          sample: "Spring Appeal", fallback: "our work" },
  { key: "give_link",        token: "{{give_link}}",        label: "Giving link",       sample: "https://www.stewardapp.dev/give/sample", fallback: "" },
  { key: "org_name",         token: "{{org_name}}",         label: "Your organization", sample: "your organization", fallback: "our organization" },
];
const MERGE_KEYS = new Set(EMAIL_MERGE_FIELDS.map(f => f.key));
// FLOWS-18: drafts saved from the old Thank-you starter hold {{gift_amount}}, the older engine's
// name for the same gift; it reads as {{last_gift_amount}} (the last real gift), so they show an
// amount, not the tag. A starter never uses the old name (tests/flows18.test.js §2).
const MERGE_ALIASES = { first: "first_name", org: "org_name", gift_amount: "last_gift_amount" };

// The dark block is named so the preview can force it on (it rewrites this
// one media line to `@media all`).
export const DARK_MEDIA = "@media (prefers-color-scheme: dark)";
// BUILDER-2B: a PREVIEW shows the scheme the editor asks for, never the
// viewer's own computer's. With Dark mode pressed the dark block always
// applies; otherwise it never does and the page says it is light, so the
// preview is white on a computer in dark mode too. A SEND never goes through
// this: real inboxes still get both, and choose.
export function previewScheme(html, dark) {
  const s = String(html || "");
  if (dark === true) return s.split(DARK_MEDIA).join("@media all");
  return s.split(DARK_MEDIA).join("@media not all")
    .replace('<meta name="color-scheme" content="light dark">', '<meta name="color-scheme" content="light">')
    .replace('<meta name="supported-color-schemes" content="light dark">', '<meta name="supported-color-schemes" content="light">');
}
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
// FIX-30: a template may bring its own personal fields (a one-person email's
// gift date, year total or tax lines); `extra` is that list, [{ key, fallback }].
const fieldDefs = extra => (extra && extra.length ? [...EMAIL_MERGE_FIELDS, ...extra.filter(f => f && f.key && !MERGE_KEYS.has(f.key))] : EMAIL_MERGE_FIELDS);
const keysOf = defs => (defs === EMAIL_MERGE_FIELDS ? MERGE_KEYS : new Set(defs.map(f => f.key)));
// EDITOR-1: `chips` draws each field as a chip the editor keeps as a field
// (data-st-token holds it exactly as typed), filled with this person's value,
// so typing around it never turns a field into somebody's name. The greeting
// is a chip too: "Dear {{donor_name}}" shows the greeting and saves as typed.
export const CHIP_STYLE = "background:#edf3ee;color:#0d5c3a;border-radius:4px;padding:0 3px;";
function chip(name, value) {
  return `<span class="st-chip" data-st-token="${esc(name)}" contenteditable="false" style="${CHIP_STYLE}">${esc(value)}</span>`;
}
function mergeText(raw, fields, problems, where, defs = EMAIL_MERGE_FIELDS, chips = false) {
  // FIX-46: a name field after "Dear" is the greeting (fields.greeting).
  // TRUST-1: for a person with no gift, a sentence naming one is a thank-you instead.
  // SENDS-1: the editor's preview (chips) goes through giftSentence too; a swapped
  // sentence is a locked span that reads back as her own words (data-st-keep).
  const kept = [];
  const gifts = giftFacts(fields);
  const source = chips
    ? withoutMissingGift(raw == null ? "" : raw, { ...gifts, mark: (orig, variant) => { kept.push({ orig, variant }); return `\u0001${kept.length - 1}\u0002`; } })
    : greetMerge(withoutMissingGift(raw == null ? "" : raw, gifts), fields && fields.greeting);
  const escaped = esc(source);
  const unmark = s => kept.length ? s.replace(/\u0001(\d+)\u0002/g, (w, i) => {
    const k = kept[Number(i)];
    const shown = k.variant.replace(/\{\{\s*org_name\s*\}\}/g, String((fields && fields.org_name) || ""));
    return `<span class="st-keep" data-st-keep="${esc(k.orig)}" contenteditable="false" title="A never-giver reads this sentence" style="${CHIP_STYLE}">${esc(shown)}</span>`;
  }) : s;
  const keys = keysOf(defs);
  return unmark(escaped.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, name, at) => {
    const key = MERGE_ALIASES[name] || name;
    if (chips && ["donor_name", "full_name", "name"].includes(key) && fields && fields.greeting && /\b(dear|hi|hello|hey|greetings|good (?:morning|afternoon|evening)),?[ \t]+$/i.test(escaped.slice(0, at))) {
      return chip(name, fields.greeting);
    }
    if (!keys.has(key)) {
      problems.push(`${where}: {{${name}}} is not a field Steward can fill. Use one of ${defs.map(f => f.token || `{{${f.key}}}`).join(", ")}.`);
      return chips ? chip(name, `{{${name}}}`) : whole;
    }
    return chips ? chip(name, fieldValue(fields, key, defs)) : esc(fieldValue(fields, key, defs));
  }));
}
// TRUST-1/SENDS-1: whether this person has a gift and a lifetime total, for giftSentence.
function giftFacts(fields) {
  return {
    hasGift: hasValue(fields && (fields.last_gift_amount || fields.gift_amount)),
    hasTotal: !(fields && ("lifetime_total" in fields || "total_giving" in fields)) || hasValue(fields.lifetime_total || fields.total_giving),
    audienceNoGift: !!(fields && fields.audience_no_gift === true),   // POLISH-9
  };
}
function fieldValue(fields, key, defs = EMAIL_MERGE_FIELDS) {
  const v = fields && fields[key];
  if (v != null && String(v).trim() !== "") return String(v);
  const def = defs.find(f => f.key === key);
  return def ? (def.fallback || "") : "";
}
// BUILDER-1: a text block's size and line spacing, inline after the defaults.
function textLook(w) {
  const size = Number(w && w.size), lh = Number(w && w.lineHeight);
  return `${size >= 13 && size <= 24 ? `font-size:${Math.round(size)}px;` : ""}${lh >= 1.2 && lh <= 2.2 ? `line-height:${Math.round(lh * 10) / 10};` : ""}`;
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
export function renderSubject(subject, fields, extraFields) {
  const defs = fieldDefs(extraFields), keys = keysOf(defs);
  return greetMerge(withoutMissingGift(String(subject || ""), giftFacts(fields)), fields && fields.greeting).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (w, n) => {
    const k = MERGE_ALIASES[n] || n;
    return keys.has(k) ? fieldValue(fields || {}, k, defs) : w;
  }).replace(/[\r\n]+/g, " ").trim();
}

// ── The renderer ───────────────────────────────────────────────────────────
// EDITOR-1: `editable` (preview only) marks every typed field of a block with
// data-st-edit="<block>.<field>" and draws fields as chips, so the editor can
// be typed in where the words show and read them back. A send never carries it.
export function renderEmail({ blocks, brand, fields, preheader, subject, links, mode, extraFields, editable } = {}) {
  const defs = fieldDefs(extraFields), keys = keysOf(defs);
  const ED = mode === "preview" && editable === true;
  const problems = [];
  const images = [];
  const text = [];
  const L = links || {};
  const F = fields || {};
  const B = brand || {};
  const band = color(B.band, "#1a6b4a"), bandFg = color(B.bandFg, "#ffffff");
  const accent = color(B.accent, "#c9a84c");
  const btnBg = color(B.buttonColor, band), btnFg = color(B.buttonFg, bandFg);
  // BUILDER-3 item 6: the house style (brand.emailStyle) under every block's own settings.
  const HS = styleForRender(B.emailStyle, EMAIL_FONT_STACKS[B.typePairing] || EMAIL_FONT_STACKS.dm, EMAIL_FONT_STACKS);
  const fonts = { serif: HS.serif, sans: HS.sans };
  const linkColor = HS.linkColor === "accent" ? accent : HS.linkColor === "button" ? btnBg : HS.linkColor === "ink" ? "#0f1a12" : band;
  const orgName = String(B.displayName || F.org_name || "").trim();
  const list = Array.isArray(blocks) ? blocks : [];
  // BUILDER-2A: the frame a block draws in. At the top it is the 600 px sheet
  // with 32 px sides, so every block renders exactly as before; a Box's
  // children draw in a narrower, bare frame (no card of their own: the box's
  // ground shows through), lined up by the box's own padding.
  let IN = INNER, FW = W, HP = PAD, BARE = false;

  const T = (raw, where, path) => {
    blankCheck(raw, problems, where);
    const out = mergeText(raw, F, problems, where, defs, ED);
    return ED && path ? `<span data-st-edit="${path}">${out}</span>` : out;
  };
  // An empty field still has a place to type when editing.
  const has = v => ED || (v != null && String(v) !== "");
  // The plain-text part gets the same fields, unescaped (it is not HTML).
  // SENDS-1: the text part (what a draft is made from) says the same to a never-giver as the HTML.
  const plain = s => greetMerge(withoutMissingGift(String(s == null ? "" : s), giftFacts(F)), F.greeting).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (w, n) => {
    const k = MERGE_ALIASES[n] || n;
    return keys.has(k) ? fieldValue(F, k, defs) : w;
  });

  // One image, email-safe. A missing src renders a neutral placeholder in a
  // preview and is a problem; a missing alt is a problem in every mode.
  function img(src, alt, width, where, extraStyle = "", height = 0) {
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
    // BUILDER-2A: a height with no width sets the size; the width follows, so the shape is kept.
    if (height) return `<img src="${esc(url)}" height="${height}" alt="${esc(altTxt)}" style="display:block;height:${height}px;width:auto;max-width:100%;border:0;outline:none;text-decoration:none;${extraStyle}">`;
    return `<img src="${esc(url)}" width="${width}" alt="${esc(altTxt)}" class="st-img" style="display:block;width:${width}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;${extraStyle}">`;
  }

  // A bulletproof button: the colour is on the table cell, so it shows even
  // where images are off and padding on links is ignored.
  // BUILDER-1: `o` is the button block's own look: its colour from the brand
  // (button, band or accent), its alignment, a set width, full width on phones.
  function button(label, href, where, path, o = {}) {
    const url = mergeUrl(href, F);
    if (!url) problems.push(`${where}: the button needs a link.`);
    const lbl = T(label || "Read more", where, path);
    text.push(`${plain(label || "Read more")}: ${url || "(link to add)"}`);
    const bg = o.color === "band" ? band : o.color === "accent" ? accent : btnBg;
    const fg = o.color === "band" ? bandFg : o.color === "accent" ? color(B.accentFg, C.ink) : btnFg;
    const al = o.align || "center";
    const m = al === "left" ? "margin:0;" : al === "right" ? "margin:0 0 0 auto;" : "margin:0 auto;";
    const w = o.width ? ` width="${o.width}"` : "";
    const ws = o.width ? `width:${o.width}px;max-width:100%;` : "";
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${al}"${w}${o.fullPhone ? ` class="st-btn-full"` : ""} style="${m}${ws}"><tr>
<td align="center" bgcolor="${bg}" style="background:${bg};border-radius:${HS.radius}px;mso-padding-alt:14px 28px;">
<a href="${esc(url || "#")}" target="_blank" style="display:${o.width ? "block" : "inline-block"};padding:14px 28px;font-family:${fonts.sans};font-size:16px;font-weight:bold;line-height:20px;color:${fg};text-decoration:none;border-radius:${HS.radius}px;">${lbl}</a>
</td></tr></table>`;
  }

  // BUILDER-1: the block being drawn's style (S), read by row(); unstyled is
  // exactly the row it always was.
  const colors = { card: C.card, page: C.page, band, bandFg, accent, hair: C.hair, body: C.body, ink: C.ink, muted: C.muted };
  let S = null;
  const row = (inner, pad = `16px ${HP}px`, cls = "st-card") => (BARE
    ? `<tr><td${S && S.align ? ` align="${S.align}"` : ""} style="padding:${S && S.pad ? S.pad.map(n => `${n}px`).join(" ") : pad};${S && S.align ? `text-align:${S.align};` : ""}">${inner}</td></tr>`
    : S
    ? styledRow(S, inner, pad, cls, colors, HP)
    : `<tr><td class="${cls}" bgcolor="${C.card}" style="background:${C.card};padding:${pad};">${inner}</td></tr>`);
  // A full-bleed cell (a hero photo, a video): the card at the top, bare inside a Box.
  const td0 = () => BARE ? `<td style="padding:0;">` : `<td class="st-card" bgcolor="${C.card}" style="background:${C.card};padding:0;">`;
  const P = (html, extra = "") => `<p class="st-text" style="margin:0 0 14px;font-family:${fonts.sans};font-size:${HS.bodySize}px;line-height:1.6;color:${C.body};${extra}">${html}</p>`;
  const H = (html, size = HS.headingSize, extra = "") => `<h2 class="st-ink" style="margin:0 0 10px;font-family:${fonts.serif};font-size:${size}px;line-height:1.25;font-weight:normal;color:${C.ink};${extra}">${html}</h2>`;

  // BUILDER-1: in a preview, a block still waiting for its event, giving page
  // or video is a box saying so, so it can be seen and clicked. A send has none.
  const waiting = msg => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${C.placeholder}" style="background:${C.placeholder};padding:22px 16px;font-family:${fonts.sans};font-size:13px;color:${C.muted};border-radius:8px;">${esc(msg)}</td></tr></table>`;
  const rows = [];
  // BUILDER-2A: what the new blocks (shared/emailMoreBlocks.js) draw with.
  const ctx = {
    T, plain, img, button, P, H, esc, C, fonts, text, problems, images, ED, mode, B, L,
    row: (...a) => row(...a),
    frame: () => ({ IN, FW, HP, AL: S && S.align }),
    style: () => S,
    // Draw `fn` in a narrower frame; the frame and the block's style come back after.
    withFrame(patch, fn) {
      const save = { IN, FW, HP, BARE, S };
      if ("IN" in patch) IN = patch.IN;
      if ("FW" in patch) FW = patch.FW;
      if ("HP" in patch) HP = patch.HP;
      if ("BARE" in patch) BARE = patch.BARE;
      try { fn(); } finally { ({ IN, FW, HP, BARE, S } = save); }
    },
    draw: (...a) => draw(...a),
  };
  // One block into `rows`. `i` is its place ("3", or "3.children.0" inside a
  // Box), which the editor's paths and the preview's data-st-block carry.
  function draw(w, i, where, rows) {
    if (!w || typeof w !== "object") return;
    const firstRow = rows.length;
    S = cleanStyle(w.style, w.type);
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
        rows.push(`<tr><td align="center" bgcolor="${band}" style="background:${band};padding:20px ${HP}px;">${inner}</td></tr>`);
        text.push(orgName);
        break;
      }
      case "hero": {
        const parts = [];
        if (w.image !== undefined) {
          rows.push(`<tr>${td0()}${img(w.image, w.alt, FW, where)}</td></tr>`);
        }
        // FLOWS-15 item 1: a never-giver reads the hero's first-gift heading she wrote, never "you were part of it".
        if (!w.locked && !giftFacts(F).hasGift && hasFirstGiftVersion(w)) {
          const fg = { heading: String(w.firstGiftHeading).trim(), sub: String(w.firstGiftSub || "").trim() };
          const inner = H(T(fg.heading, where), w.size === "tall" ? 34 : 28) + (fg.sub ? P(T(fg.sub, where), "font-size:17px;") : "");
          parts.push(ED ? `<div data-st-first-gift="${i}" title="Their first-gift version. Change it in this block's settings." style="outline:1px dashed #c9a84c;outline-offset:4px;">${inner}</div>` : inner);
          text.push(plain(fg.heading).toUpperCase()); if (fg.sub) text.push(plain(fg.sub));
          if (parts.length) rows.push(row(parts.join(""), `28px ${HP}px 8px`));
          break;
        }
        if (has(w.heading)) { parts.push(H(T(w.heading || "", where, `${i}.heading`), w.size === "tall" ? 34 : 28)); if (w.heading) text.push(plain(w.heading).toUpperCase()); }
        if (has(w.sub)) { parts.push(P(T(w.sub || "", where, `${i}.sub`), "font-size:17px;")); if (w.sub) text.push(plain(w.sub)); }
        if (parts.length) rows.push(row(parts.join(""), `28px ${HP}px 8px`));
        break;
      }
      case "richtext": {
        const out = [];
        // FLOWS-12 item 1 (W-1114-Fundraising-17): a person who has never given
        // reads the first-gift version she wrote for this block, never a thank-you
        // for giving they did not do. Her own words either way; Steward writes neither.
        const firstGift = !w.locked && !giftFacts(F).hasGift && hasFirstGiftVersion(w);
        // Her version takes the place of the paragraphs that thank them for giving; the
        // rest of the block ("Hi {{first_name}},") stays. With no such paragraph, the whole block.
        const own = Array.isArray(w.blocks) ? w.blocks : [];
        const version = firstGift ? firstGiftParagraphs(w).map(text => ({ type: "p", text })) : [];
        const claims = p => p && p.type !== "ul" && !!claimIn(p.text);
        const paras = !firstGift ? own : !own.some(claims) ? version
          : own.flatMap((p, k) => (!claims(p) ? [p] : own.findIndex(claims) === k ? version : []));
        const ts = textLook(w);   // BUILDER-1: her size and line spacing
        for (const b of paras) {
          if (!b) continue;
          if (b.type === "h2") { out.push(H(T(b.text, where), 20, "margin-top:8px;")); text.push(plain(b.text)); }
          else if (b.type === "ul") {
            const items = (Array.isArray(b.items) ? b.items : []).map(it => `<li class="st-text" style="margin:0 0 6px;font-family:${fonts.sans};font-size:${HS.bodySize}px;line-height:1.6;color:${C.body};${ts}">${T(it, where)}</li>`).join("");
            out.push(`<ul style="margin:0 0 14px;padding:0 0 0 22px;">${items}</ul>`);
            for (const it of (b.items || [])) text.push(`- ${plain(it)}`);
          } else { out.push(P(T(b.text, where).replace(/\n/g, "<br>"), ts)); text.push(plain(b.text)); }
        }
        // EDITOR-1: the whole block is one place to type, paragraph by paragraph
        // (Enter starts the next one). A locked block (a receipt's tax lines) is not.
        if (ED && firstGift) {
          rows.push(row(`<div data-st-first-gift="${i}" title="Their first-gift version. Change it in this block's settings." style="outline:1px dashed #c9a84c;outline-offset:4px;">${out.join("")}</div>`, `12px ${HP}px 4px`));
        } else if (ED && !w.locked) {
          if (!out.length) out.push(P(""));
          rows.push(row(`<div data-st-edit="${i}.blocks" data-st-rich="1">${out.join("")}</div>`, `12px ${HP}px 4px`));
        } else if (out.length) rows.push(row(out.join(""), `12px ${HP}px 4px`));
        break;
      }
      case "image": {
        const cap = has(w.caption) ? `<p class="st-muted" style="margin:8px 0 0;font-family:${fonts.sans};font-size:13px;line-height:1.5;color:${C.muted};">${T(w.caption || "", where, `${i}.caption`)}</p>` : "";
        const iw = (S && S.width) || IN;
        let pic = img(w.image, w.alt, iw, where, S && S.radius ? `border-radius:${S.radius}px;` : "", S && !S.width && S.height ? S.height : 0);
        const href = w.link ? mergeUrl(w.link, F) : "";
        if (href) pic = `<a href="${esc(href)}" target="_blank" style="text-decoration:none;">${pic}</a>`;
        rows.push(row(pic + cap, `12px ${HP}px`));
        if (w.caption) text.push(plain(w.caption));
        break;
      }
      case "photos2": {
        const ims = Array.isArray(w.images) ? w.images.slice(0, 2) : [];
        while (ims.length < 2) ims.push({ src: null, alt: "" });
        const half = (IN - 12) / 2;
        const cell = (im, k) => `<td class="st-col" width="50%" valign="top" style="width:50%;padding:${k ? "0 0 0 6px" : "0 6px 0 0"};">${img(im && im.src, im && im.alt, half, `${where}, photo ${k + 1}`)}</td>`;
        rows.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${ims.map(cell).join("")}</tr></table>`, `12px ${HP}px`));
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
<div class="st-ink" style="font-family:${fonts.serif};font-size:30px;line-height:1.2;color:${C.ink};">${ED ? T(val, where, `${i}.items.${k}.value`) : val ? T(val, where) : "[number]"}</div>
<div class="st-muted" style="font-family:${fonts.sans};font-size:12px;line-height:1.4;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${T((s && s.label) || "", where, `${i}.items.${k}.label`)}</div></td>`;
        }).join("");
        rows.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`, `16px ${HP}px`));
        break;
      }
      case "quote": {
        if (!w.text) { problems.push(`${where}: the quote is empty.`); if (!ED) break; }
        const attr = has(w.attribution) ? `<p class="st-muted" style="margin:8px 0 0;font-family:${fonts.sans};font-size:14px;color:${C.muted};">${T(w.attribution || "", where, `${i}.attribution`)}</p>` : "";
        rows.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:4px solid ${accent};padding:4px 0 4px 18px;">
<p class="st-ink" style="margin:0;font-family:${fonts.serif};font-size:20px;line-height:1.5;color:${C.ink};">&ldquo;${T(w.text || "", where, `${i}.text`)}&rdquo;</p>${attr}</td></tr></table>`, `16px ${HP}px`));
        text.push(`"${plain(w.text)}"${w.attribution ? ` ${plain(w.attribution)}` : ""}`);
        break;
      }
      case "video": {
        const provider = VIDEO_PROVIDERS.includes(w.provider) ? w.provider : null;
        const vid = String(w.videoId || "").trim();
        if (!provider || !vid) { problems.push(`${where}: add a YouTube or Vimeo link.`); if (mode === "preview") rows.push(row(waiting("A video to choose: pick one in this block's settings."), `12px ${HP}px`)); break; }
        const href = typeof L.videoPage === "function" ? String(L.videoPage(provider, vid) || "") : "";
        if (!/^https?:\/\//i.test(href)) problems.push(`${where}: the video has no page to open.`);
        const thumb = provider === "youtube" ? youtubeThumb(vid)
          : resolveSrc(w.thumbUrl || (typeof L.videoThumb === "function" ? L.videoThumb(provider, vid) : ""), L);
        const alt = String(w.caption || "").trim() || "Play the video";
        const h = Math.round(FW * 9 / 16);
        if (thumb) images.push({ src: thumb, alt });
        else problems.push(`${where}: the Vimeo thumbnail is missing; pick the video from the media library again.`);
        // The thumbnail is the cell's background; a centred circle sits on it.
        // Where background images are off, the dark cell and the circle remain.
        const bg = thumb ? ` background="${esc(thumb)}"` : "";
        const bgStyle = thumb ? `background-image:url('${esc(thumb)}');background-size:cover;background-position:center;` : "";
        rows.push(`<tr>${td0()}
<a href="${esc(href || "#")}" target="_blank" style="text-decoration:none;display:block;" title="${esc(alt)}">
<table role="presentation" width="${FW}" cellpadding="0" cellspacing="0" border="0" class="st-img" style="width:${FW}px;max-width:100%;"><tr>
<td${bg} bgcolor="${C.ink}" width="${FW}" height="${h}" align="center" valign="middle" class="st-video" style="${bgStyle}background-color:${C.ink};height:${h}px;text-align:center;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td width="72" height="72" align="center" valign="middle" bgcolor="${band}" style="width:72px;height:72px;border-radius:36px;background:${band};color:${bandFg};font-family:Arial,sans-serif;font-size:30px;line-height:72px;text-align:center;">&#9654;</td></tr></table>
</td></tr></table></a>
${has(w.caption) ? `<p class="st-muted" style="margin:0;padding:8px ${HP}px 0;font-family:${fonts.sans};font-size:13px;color:${C.muted};">${T(w.caption || "", where, `${i}.caption`)}</p>` : ""}</td></tr>`);
        text.push(`Watch the video: ${href || "(link to add)"}`);
        break;
      }
      case "button": {
        const action = BUTTON_ACTIONS.includes(w.action) ? w.action : "readmore";
        const raw = String(w.url || "").trim() || (action === "give" ? "{{give_link}}" : "");
        const look = { color: w.color, fullPhone: w.fullPhone === true, align: S && S.align, width: S && S.width };
        const S0 = S; if (S) S = { ...S, width: undefined, align: undefined };   // the button carries its own width and alignment
        rows.push(row(button(w.label || BUTTON_ACTION_LABEL[action], raw, where, `${i}.label`, look), `12px ${HP}px 20px`));
        S = S0;
        break;
      }
      case "event": {
        const ev = typeof L.event === "function" && w.eventId ? L.event(w.eventId) : null;
        if (!ev) { problems.push(`${where}: choose one of your events.`); if (mode === "preview") rows.push(row(waiting("An event to choose: pick one of yours in this block's settings."), `12px ${HP}px`)); break; }
        const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.hair};border-radius:10px;"><tr><td style="padding:18px 20px;">
<div class="st-muted" style="font-family:${fonts.sans};font-size:12px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${esc(ev.date || "")}</div>
${H(esc(ev.name || "Our event"), 22, "margin:4px 0 14px;")}
${button("RSVP", ev.url || "", where)}</td></tr></table>`;
        rows.push(row(inner, `12px ${HP}px`));
        text.push(`${plain(ev.name)} ${plain(ev.date)}`);
        break;
      }
      case "givingpage": {
        const gp = typeof L.givingPage === "function" && w.givingPageId ? L.givingPage(w.givingPageId) : null;
        if (!gp) { problems.push(`${where}: choose one of your giving pages.`); if (mode === "preview") rows.push(row(waiting("A giving page to choose: pick one of yours in this block's settings."), `12px ${HP}px`)); break; }
        const pic = gp.image ? img(gp.image, gp.title || "Giving page", IN - 2, where) : "";
        const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.hair};border-radius:10px;"><tr><td style="padding:0;">${pic}</td></tr><tr><td style="padding:18px 20px;">
${H(esc(gp.title || "Give"), 22, "margin:0 0 14px;")}
${button("Give", gp.url || "", where)}</td></tr></table>`;
        rows.push(row(inner, `12px ${HP}px`));
        text.push(plain(gp.title));
        break;
      }
      case "divider":
      {
        const th = Number(w.thickness) >= 1 && Number(w.thickness) <= 8 ? Math.round(Number(w.thickness)) : 1;
        const sp = Number.isFinite(Number(w.spacing)) && w.spacing != null ? Math.max(0, Math.min(48, Math.round(Number(w.spacing)))) : 8;
        rows.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:${th}px solid ${C.hair};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>`, `${sp}px ${HP}px`));
      }
        break;
      case "giftsummary": {
        // The person's own gift, as the fields hold it. Nothing is invented: a
        // person with no gift gets no box (a preview says what would show).
        const amount = F.gift_amount || F.last_gift_amount || "";
        const day = F.gift_date || F.last_gift_date || "";
        const fund = F.fund || "";
        if (!String(amount).trim()) {
          if (mode === "preview") rows.push(row(`<p class="st-muted" style="margin:0;font-family:${fonts.sans};font-size:13px;color:${C.muted};">Their gift shows here: amount, date and fund. Somebody with no gift sees nothing here.</p>`, `8px ${HP}px`));
          break;
        }
        const meta = [day, fund].filter(Boolean).map(esc).join(" &middot; ");
        rows.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.hair};border-radius:10px;"><tr><td style="padding:16px 20px;">
<div class="st-muted" style="font-family:${fonts.sans};font-size:12px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${T(w.heading || "Your gift", where, `${i}.heading`)}</div>
<div class="st-ink" style="font-family:${fonts.serif};font-size:28px;line-height:1.3;color:${C.ink};">${esc(amount)}</div>
${meta ? `<div class="st-muted" style="font-family:${fonts.sans};font-size:14px;color:${C.muted};">${meta}</div>` : ""}</td></tr></table>`, `12px ${HP}px`));
        text.push(`${plain(w.heading || "Your gift")}: ${amount}${day ? `, ${day}` : ""}${fund ? `, ${fund}` : ""}`);
        break;
      }
      case "signature": {
        const name = String(w.name || "").trim();
        if (!name) problems.push(`${where}: add the name the email is signed with.`);
        const photo = w.photo ? `<td width="64" valign="middle" style="width:64px;padding:0 14px 0 0;">${img(w.photo, name || "Photo", 56, where, "border-radius:28px;")}</td>` : "";
        // BUILDER-1: her signature picture (LETTERS-1), in its own ink, above the name.
        const sig = w.signatureImage ? `<div style="margin:0 0 4px;">${img(w.signatureImage, `Signature of ${name || "the sender"}`, 180, where, "width:auto;max-width:180px;max-height:70px;")}</div>` : "";
        rows.push(row(`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${photo}<td valign="middle">
${sig}<div class="st-ink" style="font-family:${fonts.serif};font-size:18px;color:${C.ink};">${ED ? T(name, where, `${i}.name`) : T(name || "[your name]", where)}</div>
${has(w.title) ? `<div class="st-muted" style="font-family:${fonts.sans};font-size:14px;color:${C.muted};">${T(w.title || "", where, `${i}.title`)}</div>` : ""}</td></tr></table>`, `8px ${HP}px 24px`));
        text.push(`${plain(name)}${w.title ? `\n${plain(w.title)}` : ""}`);
        break;
      }
      case "footer":
        // The footer is filled by the send path at FOOTER_SLOT, once, below.
        break;
      default:
        if (!drawMore(w, i, where, rows, ctx)) problems.push(`${where}: this block cannot go in an email.`);
    }
    // POLISH-3: in a preview each block's rows carry its index, so the editor
    // can join a block in the preview to its fields. A send never carries it.
    // BUILDER-1: space above and below, and hidden on phones or on desktop.
    if (S && rows.length > firstRow) {
      const gap = px => (BARE ? `<tr><td height="${px}" style="height:${px}px;font-size:0;line-height:0;">&nbsp;</td></tr>` : spacerRow(px, colors));
      if (S.mt) rows.splice(firstRow, 0, gap(S.mt));
      if (S.mb) rows.push(gap(S.mb));
      if (S.hide) for (let k = firstRow; k < rows.length; k++) rows[k] = hideRow(rows[k], S.hide, ED);
    }
    S = null;
    if (mode === "preview") for (let k = firstRow; k < rows.length; k++) rows[k] = rows[k].replace(/^<tr\b/, `<tr data-st-block="${i}" data-st-type="${esc(w.type)}"${w.locked ? ` data-st-locked="1"` : ""}`);
  }
  list.forEach((w, i) => { if (w && typeof w === "object") draw(w, i, `Block ${i + 1} (${w.type})`, rows); });
  // BUILDER-1: the email's own background, kept on its footer block.
  const foot = list.find(b => b && b.type === "footer");
  const pageBg = foot && foot.page === "white" ? C.card : foot && foot.page === "band" ? band : C.page;

  const subj = subject ? mergeText(subject, F, problems, "Subject") : "";
  if (subject) blankCheck(subject, problems, "Subject");
  const pre = preheader ? mergeText(preheader, F, problems, "Preview line") : "";
  if (preheader) blankCheck(preheader, problems, "Preview line");

  const style = `<style type="text/css">
body{margin:0;padding:0;}
table{border-collapse:collapse;}
img{-ms-interpolation-mode:bicubic;}
.st-card a:not([style*="color"]){color:${linkColor};}
${PHONE_MEDIA}{
.st-wrap{width:100% !important;}
.st-col{display:block !important;width:100% !important;padding:0 0 12px 0 !important;}
.st-img{width:100% !important;height:auto !important;}
.st-video{height:200px !important;}
${HIDE_CSS_PHONE}
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
<body class="st-body" style="margin:0;padding:0;background:${pageBg};">
<span style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${pre}${"&#847;&zwnj;&nbsp;".repeat(30)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="st-page" bgcolor="${pageBg}" style="background:${pageBg};">
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
export const MAX_BLOCKS = 40;   // BUILDER-2A: a Box's children count toward it
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
// BUILDER-2A: a block may carry an `id` (the editor's handle on it; a saved
// block used again gets fresh ones); it is kept, never added. A Box's
// children are validated the same way, one level down.
const BLOCK_ID = /^[A-Za-z0-9_-]{1,40}$/;
export function validateEmailBlocks(blocks, allowedTypes) {
  if (!Array.isArray(blocks)) return { ok: false, error: "blocks must be a list." };
  if (countBlocks(blocks) > MAX_BLOCKS) return { ok: false, error: `An email holds at most ${MAX_BLOCKS} blocks${blocks.length <= MAX_BLOCKS ? ", counting the blocks inside a box" : ""}.` };
  const allowed = new Set(allowedTypes || []);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    try { out.push(validateOne(blocks[i], `Block ${i + 1}`, allowed)); }
    catch (e) { return { ok: false, error: e.message }; }
  }
  return { ok: true, blocks: out };
}
function validateOne(w, at, allowed) {
    if (!w || typeof w !== "object" || !allowed.has(w.type)) throw new Error(`${at}: ${w && w.type ? `"${w.type}"` : "this"} is not an email block.`);
    // Each case below hands its one cleaned block to out.push (the shape the
    // loop had before BUILDER-2A, kept so the cases read as they always did).
    const out = { push(v) { this.v = v; } };
    const img1 = (v, label) => { const r = imageRef(v); if (!r.ok) throw new Error(`${at}: ${label} must be a photo from your media library, not a pasted image or another kind of link.`); return r.v; };
    {
      switch (w.type) {
        case "header": case "footer": out.push({ type: w.type }); break;
        case "hero": out.push({ type: "hero", heading: str(w.heading, 200), sub: str(w.sub, 600), image: img1(w.image, "the hero photo"), alt: str(w.alt, 200), size: w.size === "tall" ? "tall" : "standard",
            ...(typeof w.firstGiftHeading === "string" && w.firstGiftHeading.trim() ? { firstGiftHeading: str(w.firstGiftHeading, 200), ...(typeof w.firstGiftSub === "string" && w.firstGiftSub.trim() ? { firstGiftSub: str(w.firstGiftSub, 600) } : {}) } : {}) }); break;   // FLOWS-15
        case "richtext": {
          const bl = (Array.isArray(w.blocks) ? w.blocks : []).slice(0, 40).map(b => {
            if (b && b.type === "ul") return { type: "ul", items: (Array.isArray(b.items) ? b.items : []).slice(0, 30).map(x => str(x, 600)) };
            return { type: b && b.type === "h2" ? "h2" : "p", text: str(b && b.text, 4000) };
          });
          out.push({ type: "richtext", blocks: bl, ...(w.locked === true ? { locked: true } : {}),
            ...(w.locked !== true && typeof w.firstGift === "string" && w.firstGift.trim() ? { firstGift: str(w.firstGift, 4000) } : {}) }); break;   // FLOWS-12
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
          // BUILDER-1: a video just added has no link yet; it saves and previews as a problem
          // ("add a YouTube or Vimeo link"), and a send refuses it. A link that is there must be one.
          if (!w.provider && !w.videoId) { out.push({ type: "video", caption: str(w.caption, 300) }); break; }
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
        case "divider": out.push({ type: "divider" }); break;
        case "giftsummary": out.push({ type: "giftsummary", heading: str(w.heading, 80) }); break;
        default: {
          const url1 = (v, label) => { const u = str(v, 1000).trim(); if (u && !/^https?:\/\/[^\s"'<>]+$/i.test(u)) throw new Error(`${at}: ${label} must start with https://.`); return u || null; };
          const more = validateMore(w, { str, img1, url1, at, child: (c, cat) => validateOne(c, cat, allowed) });
          if (!more) throw new Error(`${at}: "${w.type}" is not an email block.`);
          out.push(more);
        }
      }
    }
    // BUILDER-1: its look (style) and its own settings, clamped to what the renderer draws.
    const id = typeof w.id === "string" && BLOCK_ID.test(w.id) ? w.id : null;
    return { ...(id ? { id } : {}), ...out.v, ...cleanOptions(w, at, imageRef) };
}
