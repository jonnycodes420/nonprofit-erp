// shared/emailMoreBlocks.js · BUILDER-2A items 1 to 3. COLUMNS, BOX, SOCIAL AND CODE.
//
// Pure: no DB, no network, no clock. The four blocks the full builder adds to
// an email, drawn inside renderEmail (shared/emailBlocks.js) with its own
// helpers (`ctx`), so they keep the same contract: a 600 px centred table,
// every style inline, no flexbox or grid, a plain-text version, and every
// problem refusing a send.
//
//   columns  2 or 3 columns side by side, each holding text, an image or a
//            button (up to four of them, top to bottom). Real table cells, so
//            Outlook lays them out with no MSO conditional: the cells carry
//            their own widths, and Outlook never stacks them (it is a desktop
//            client). Under 620 px each cell becomes a full-width row through
//            PHONE_MEDIA's .st-col, unless "stack on phones" is off. The
//            plain-text version reads column by column.
//   box      a container for other blocks: background, border, rounded
//            corners and padding come from its style (shared/emailBlockStyle.js,
//            BUILDER-1's one style model), a cream section when it is added. Nested tables. One level: a
//            Box inside a Box is refused. Its children count toward MAX_BLOCKS.
//   social   the org's social links, read from Brand at render time, as icons
//            with alt text ("Harborlight on Instagram"). A network with no
//            link is left out, never drawn broken.
//   code     a small piece of pasted HTML, cleaned to the email allowlist
//            (shared/emailCodeSanitize.js). Whatever was taken out is a
//            problem, so a send with it is refused. Admin-only in the block
//            model (pageWidgets.js `roles`); the screen enforces it.

import { sanitizeEmailCode } from "./emailCodeSanitize.js";
import { SOCIAL_NETWORKS } from "./socialNetworks.js";

export const COLUMN_ITEM_TYPES = ["text", "image", "button"];
export const MAX_COLUMN_ITEMS = 4;
export const COLUMN_VALIGN = ["top", "middle", "bottom"];
export { SOCIAL_NETWORKS };   // its one home is shared/socialNetworks.js
export const SOCIAL_SIZES = [24, 32, 40];
// The icon files are Steward's own, served with the app (client/public/email-icons/).
export const socialIconPath = (key, light) => `/email-icons/${key}-${light ? "light" : "dark"}.png`;
export const CODE_MAX = 20000;
// Blocks a Box may hold: everything an email takes but the frame and another Box.
export const NOT_IN_BOX = new Set(["header", "footer", "box"]);

// Brand's social links, cleaned: only https links on known networks.
export function cleanSocialLinks(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const n of SOCIAL_NETWORKS) {
    const v = String(raw[n.key] || "").trim();
    if (v && /^https:\/\/[^\s"'<>]+$/i.test(v) && v.length <= 500) out[n.key] = v;
  }
  return out;
}

// ── Render ─────────────────────────────────────────────────────────────────
// ctx: { T, plain, img, button, P, H, row, esc, C, fonts, text, problems,
//        images, ED, mode, B, L, frame(), style(), withFrame(patch, fn), draw }
export function drawMore(w, i, where, rows, ctx) {
  switch (w.type) {
    case "columns": return drawColumns(w, i, where, rows, ctx);
    case "box": return drawBox(w, i, where, rows, ctx);
    case "social": return drawSocial(w, i, where, rows, ctx);
    case "code": return drawCode(w, i, where, rows, ctx);
    default: return false;
  }
}

function drawColumns(w, i, where, rows, ctx) {
  const { T, plain, img, button, P, H, esc, fonts, C, text, frame } = ctx;
  const n = w.count === 3 ? 3 : 2;
  const cols = (Array.isArray(w.columns) ? w.columns : []).slice(0, n);
  while (cols.length < n) cols.push({ items: [] });
  const gap = Number.isFinite(w.gap) ? w.gap : 16;
  const valign = COLUMN_VALIGN.includes(w.valign) ? w.valign : "top";
  const stack = w.stack !== false;
  const { IN, HP } = frame();
  const colW = Math.floor((IN - gap * (n - 1)) / n);
  const pct = Math.floor(100 / n);
  const cells = cols.map((col, c) => {
    const at = `${where}, column ${c + 1}`;
    const items = (Array.isArray(col && col.items) ? col.items : []).slice(0, MAX_COLUMN_ITEMS);
    if (!items.length) ctx.problems.push(`${at} is empty; add text, a photo or a button, or use fewer columns.`);
    const inner = items.map((it, k) => {
      const path = `${i}.columns.${c}.items.${k}`;
      if (!it || typeof it !== "object") return "";
      if (it.type === "image") {
        const pic = img(it.image, it.alt, colW, at);
        const href = String(it.href || "").trim();
        return `<div style="margin:0 0 12px;">${href ? `<a href="${esc(href)}" target="_blank" style="text-decoration:none;">${pic}</a>` : pic}</div>`;
      }
      if (it.type === "button") {
        const raw = String(it.url || "").trim() || (it.action === "give" ? "{{give_link}}" : "");
        return `<div style="margin:0 0 12px;">${button(it.label || "Read more", raw, at, `${path}.label`)}</div>`;
      }
      // text
      const parts = [];
      if (ctx.ED || it.heading) { parts.push(H(T(it.heading || "", at, `${path}.heading`), 20, "margin:0 0 6px;")); if (it.heading) text.push(plain(it.heading)); }
      if (ctx.ED || it.text) {
        parts.push(P(T(it.text || "", at, `${path}.text`).replace(/\n/g, "<br>"), "font-size:15px;"));
        if (it.text) text.push(plain(it.text));
      }
      return parts.join("");
    }).join("");
    const padL = c === 0 ? 0 : Math.ceil(gap / 2), padR = c === n - 1 ? 0 : Math.floor(gap / 2);
    return `<td${stack ? ` class="st-col"` : ""} width="${pct}%" valign="${valign}" style="width:${pct}%;padding:0 ${padR}px 0 ${padL}px;vertical-align:${valign};font-family:${fonts.sans};color:${C.body};">${inner}</td>`;
  }).join("");
  rows.push(ctx.row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`, `12px ${HP}px`));
  return true;
}

function drawBox(w, i, where, rows, ctx) {
  const kids = [];
  const list = Array.isArray(w.children) ? w.children : [];
  // Its look is its style (BUILDER-1's shape: bg, pad [t,r,b,l], border, radius,
  // width). The children line up inside the box's own padding: no side inset of
  // their own, and no card of their own, so the box's ground shows through.
  const { IN: outerIn, FW, HP } = ctx.frame();
  const S = ctx.style() || {};
  const padL = S.pad ? S.pad[3] : HP, padR = S.pad ? S.pad[1] : HP;
  let inner = S.border ? FW - 2 * HP - (S.pad ? padL + padR : 40) - 2 : FW - padL - padR;
  if (S.width) inner = Math.min(inner, S.width - (S.pad ? padL + padR : 0));
  inner = Math.max(80, Math.min(inner, outerIn + 2 * HP));
  ctx.withFrame({ HP: 0, BARE: true, IN: inner, FW: inner }, () => {
    list.forEach((c, k) => {
      if (!c || typeof c !== "object") return;
      if (NOT_IN_BOX.has(c.type)) { ctx.problems.push(`${where}, part ${k + 1}: a ${c.type === "box" ? "box cannot hold another box" : `${c.type} cannot go inside a box`}.`); return; }
      ctx.draw(c, `${i}.children.${k}`, `${where}, part ${k + 1} (${c.type})`, kids);
    });
  });
  if (!kids.length) {
    if (ctx.mode !== "preview") return true;
    kids.push(`<tr><td style="padding:8px 0;font-family:${ctx.fonts.sans};font-size:13px;color:${ctx.C.muted};">An empty box. Add blocks inside it.</td></tr>`);
  }
  rows.push(ctx.row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">\n${kids.join("\n")}\n</table>`, `16px ${HP}px`));
  return true;
}

function drawSocial(w, i, where, rows, ctx) {
  const { esc, B, L, text, problems, images, frame } = ctx;
  const links = cleanSocialLinks(B.socialLinks);
  const size = SOCIAL_SIZES.includes(w.size) ? w.size : 32;
  const light = w.color === "light";
  const org = String(B.displayName || "").trim() || "Us";
  const shown = SOCIAL_NETWORKS.filter(n => links[n.key] && (!Array.isArray(w.networks) || w.networks.includes(n.key)));
  if (!shown.length) {
    problems.push(`${where}: there are no social links in Brand yet. Add them in Settings, Brand, or remove this block.`);
    if (ctx.mode === "preview") rows.push(ctx.row(`<p style="margin:0;font-family:${ctx.fonts.sans};font-size:13px;color:${ctx.C.muted};text-align:center;">Your social links show here once they are in Settings, Brand.</p>`, `12px ${frame().HP}px`));
    return true;
  }
  const base = String((L && L.assetBase) || "").replace(/\/+$/, "");
  const cells = shown.map(n => {
    const src = base + socialIconPath(n.key, light);
    const alt = n.key === "website" ? `${org}'s website` : `${org} on ${n.label}`;
    images.push({ src, alt });
    text.push(`${n.key === "website" ? "Website" : n.label}: ${links[n.key]}`);
    return `<td style="padding:0 6px;"><a href="${esc(links[n.key])}" target="_blank" style="text-decoration:none;"><img src="${esc(src)}" width="${size}" height="${size}" alt="${esc(alt)}" style="display:block;width:${size}px;height:${size}px;border:0;outline:none;text-decoration:none;"></a></td>`;
  }).join("");
  const align = frame().AL || "center";
  rows.push(ctx.row(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:${align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0"};"><tr>${cells}</tr></table>`, `12px ${frame().HP}px`));
  return true;
}

function drawCode(w, i, where, rows, ctx) {
  const { problems, images, text } = ctx;
  const raw = String(w.html || "");
  if (!raw.trim()) { problems.push(`${where}: the code block is empty.`); if (ctx.mode !== "preview") return true; }
  const clean = sanitizeEmailCode(raw);
  for (const r of clean.removed) problems.push(`${where}: Steward took out ${r}. Fix the code so nothing needs taking out.`);
  for (const im of clean.images) {
    if (!im.alt) problems.push(`${where}: an image has no alt text (a few words saying what it shows).`);
    images.push(im);
  }
  // The plain-text part: tags out (until none are left), then each entity decoded once, in one pass.
  let flat = clean.html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n");
  for (let prev = null; prev !== flat;) { prev = flat; flat = flat.replace(/<[^<>]*>/g, ""); }
  const ENT = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" };
  const words = flat.replace(/[<>]/g, "").replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, m => ENT[m])
    .split("\n").map(s => s.trim()).filter(Boolean).join("\n");
  if (words) text.push(words);
  rows.push(ctx.row(clean.html || "&nbsp;", `12px ${ctx.frame().HP}px`));
  return true;
}

// ── Validate ───────────────────────────────────────────────────────────────
// h: { str, img1, url1, at, child(block, at) } from validateEmailBlocks.
export function validateMore(w, h) {
  const { str, img1, url1, at } = h;
  switch (w.type) {
    case "columns": {
      const count = w.count === 3 ? 3 : 2;
      const columns = (Array.isArray(w.columns) ? w.columns : []).slice(0, count).map((col, c) => ({
        items: (Array.isArray(col && col.items) ? col.items : []).slice(0, MAX_COLUMN_ITEMS).map((it, k) => {
          const where = `column ${c + 1}, part ${k + 1}`;
          if (!it || !COLUMN_ITEM_TYPES.includes(it.type)) throw new Error(`${at}: ${where} must be text, a photo or a button.`);
          if (it.type === "image") {
            const href = url1(it.href, `${where}'s link`);
            return { type: "image", image: img1(it.image, `the photo in ${where}`), alt: str(it.alt, 200), ...(href ? { href } : {}) };
          }
          if (it.type === "button") {
            const url = str(it.url, 1000).trim();
            if (url && !/^https?:\/\/[^\s"'<>]+$/i.test(url) && !/^\{\{\s*give_link\s*\}\}$/.test(url)) throw new Error(`${at}: the button in ${where} must link to an address starting with https://.`);
            return { type: "button", action: ["give", "rsvp", "volunteer", "readmore"].includes(it.action) ? it.action : "readmore", label: str(it.label, 60), url };
          }
          return { type: "text", heading: str(it.heading, 200), text: str(it.text, 2000) };
        }),
      }));
      while (columns.length < count) columns.push({ items: [] });
      const gap = Math.round(Number(w.gap));
      return { type: "columns", count, stack: w.stack !== false, gap: Number.isFinite(gap) ? Math.min(40, Math.max(0, gap)) : 16,
        valign: COLUMN_VALIGN.includes(w.valign) ? w.valign : "top", columns };
    }
    case "box": {
      const kids = Array.isArray(w.children) ? w.children : [];
      const children = kids.map((c, k) => {
        if (c && c.type === "box") throw new Error(`${at}: a box cannot hold another box.`);
        if (c && NOT_IN_BOX.has(c.type)) throw new Error(`${at}: the ${c.type} cannot go inside a box.`);
        return h.child(c, `${at}, part ${k + 1}`);
      });
      return { type: "box", children };
    }
    case "social": {
      const nets = Array.isArray(w.networks) ? w.networks.filter(k => SOCIAL_NETWORKS.some(n => n.key === k)) : null;
      return { type: "social", size: SOCIAL_SIZES.includes(w.size) ? w.size : 32, color: w.color === "light" ? "light" : "dark", ...(nets ? { networks: nets } : {}) };
    }
    case "code": {
      const html = w.html == null ? "" : String(w.html);
      if (html.length > CODE_MAX) throw new Error(`${at}: the code is longer than ${CODE_MAX.toLocaleString("en-US")} characters.`);
      return { type: "code", html };
    }
    default: return null;
  }
}

// How many blocks a list holds, a Box's children counted (MAX_BLOCKS reads it).
export function countBlocks(blocks) {
  let n = 0;
  for (const b of Array.isArray(blocks) ? blocks : []) {
    n += 1;
    if (b && b.type === "box" && Array.isArray(b.children)) n += b.children.length;
  }
  return n;
}
