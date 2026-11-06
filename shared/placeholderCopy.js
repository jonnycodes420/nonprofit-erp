// shared/placeholderCopy.js — WALKB-1 item 1. A HINT IS NEVER PUBLISHED.
//
// Muse's Walk B found the live GivingTuesday page reading "Write two or three
// sentences here about what this year made possible…", and an EIN of
// 47-1234567 in its footer. Both were words Steward wrote as a prompt for the
// organisation, and both reached a stranger as if the organisation had said
// them. The rule now: a hint lives in the editor; a public page and a receipt
// never print one.
//
// One module, read by the server (the public payload, every receipt snapshot)
// and by the client (the editor's "Fill this in before you share" note, the
// Settings EIN warning), so the two sides cannot disagree about what counts.

// ── STORY HINTS ──────────────────────────────────────────────────────────
// Every prompt Steward has ever written into a starter story or block. A
// paragraph that STARTS with one is a hint, whatever follows it (the campaign
// templates added a second sentence of advice after the first).
const HINT_STARTS = [
  "Write two or three sentences here",
  "Say what this page is for, in your own words.",
  "Tell the story of your work here, in your own words.",
  "Introduce your current campaign here",
  "Write something in your own words.",
];

const norm = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();
const STARTS = HINT_STARTS.map(norm);

export function isHintText(text) {
  const t = norm(text);
  return !!t && STARTS.some(h => t.startsWith(h));
}

// The story with every hint paragraph taken out. Paragraphs are split on a
// blank line, the convention the editor and the template both write.
export function storyWithoutHints(story) {
  const paras = String(story == null ? "" : story).replace(/\r\n/g, "\n").split(/\n{2,}/);
  return paras.filter(p => p.trim() && !isHintText(p)).join("\n\n");
}

// The widgets a public page renders, with hint paragraphs removed from every
// rich-text block, and a block left with nothing in it removed altogether
// ("publishes without that section").
export function widgetsWithoutHints(widgets) {
  if (!Array.isArray(widgets)) return widgets;
  const out = [];
  for (const w of widgets) {
    if (!w || w.type !== "richtext") { out.push(w); continue; }
    const blocks = (Array.isArray(w.blocks) ? w.blocks : []).filter(b => !(b && b.type !== "ul" && isHintText(b.text)));
    if (!blocks.length) continue;
    const { hint, ...rest } = w;                       // the editor's hint never travels to the public
    out.push({ ...rest, blocks });
  }
  return out;
}

// What the editor should tell her is still a hint: the story paragraphs and
// block paragraphs that are still Steward's words, plus any block that carries
// its hint beside its words (the campaign templates' way).
export function hintsLeft({ story, widgets } = {}) {
  const found = [];
  for (const p of String(story || "").split(/\n{2,}/)) if (isHintText(p)) found.push(p.trim());
  for (const w of Array.isArray(widgets) ? widgets : []) {
    if (!w || w.type !== "richtext") continue;
    if (w.hint) found.push(String(w.hint));
    for (const b of Array.isArray(w.blocks) ? w.blocks : []) if (b && b.type !== "ul" && isHintText(b.text)) found.push(String(b.text).trim());
  }
  return [...new Set(found)];
}

export const FILL_IN_NOTE = "Fill this in before you share. Until you do, the public page leaves this part out.";

// ── PLACEHOLDER EINs ─────────────────────────────────────────────────────
// The numbers people type when they mean "I'll put the real one in later",
// and the ones Steward's own examples have shown. Nine identical digits,
// either run of 1-to-9 or 9-to-1, and the two the walk saw.
const PLACEHOLDER_EINS = new Set(["123456789", "471234567", "987654321", "012345678"]);

export function isPlaceholderEin(ein) {
  const d = String(ein == null ? "" : ein).replace(/\D/g, "");
  if (!d) return false;
  if (d.length !== 9) return false;
  if (/^(\d)\1{8}$/.test(d)) return true;               // 00-0000000, 11-1111111, 99-9999999
  return PLACEHOLDER_EINS.has(d);
}

// The EIN a stranger may read: the org's own, or nothing while it is still a
// placeholder. Every public page and every receipt reads it through here.
export function publicEin(ein) {
  const s = String(ein == null ? "" : ein).trim();
  return s && !isPlaceholderEin(s) ? s : "";
}

export const PLACEHOLDER_EIN_WARNING =
  "This EIN looks like an example number, not your organization's. Until you change it, Steward leaves it off your public pages and your receipts.";
