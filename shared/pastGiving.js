// shared/pastGiving.js · FLOWS-12 item 1 (W-1114-Fundraising-17).
// A LETTER THAT THANKS SOMEONE FOR GIVING, SENT TO SOMEONE WHO NEVER GAVE.
//
// As Ana Ruiz, who has never given, the Year-end appeal read "Your support
// gave us room to say yes when people came to our door. If you are able to
// give once more before December 31…". TRUST-1 already turns a sentence that
// names a gift FIELD ({{last_gift_amount}}) into a thank-you for a never-giver;
// these sentences name no field, so nothing caught them.
//
// What changes, and what does not:
//   · Steward finds the paragraphs that claim past giving (CLAIMS below) and
//     says so in the editor and the preview, with how many in the audience
//     have never given. It never rewrites her words.
//   · A text block may carry a first-gift version she writes (`firstGift`);
//     a person with no gift reads that version instead (shared/emailBlocks.js).
//   · With a claim and no version written, the preview flags it:
//     "This letter thanks them for giving. 212 people in this audience never have."
// Pure: no clock, no database. The editor, the preview route and the
// renderer all read this one list.

// Each: a pattern, and the words the editor quotes back to her.
export const CLAIMS = [
  /\byour (?:continued |ongoing |past |previous |last |recent |generous |faithful |loyal |steady )?(?:support|gifts?|giving|generosity|donations?|partnership)\b/i,
  /\bgive (?:once more|again)\b/i,
  /\b(?:another|a second|one more) gift\b/i,
  /\bthank(?:s| you) for (?:your|giving|supporting|being (?:a|one of our) (?:donors?|supporters?|givers?))\b/i,
  /(?<!\b(?:hours?|time|days?|evenings?|weekends?)\]? )\byou(?:['’]ve| have)? (?:given|donated|supported|gave)\b/i,   // the hours you gave are not money
  /\b(?:renew|increase) your (?:gift|support|giving)\b/i,
  /\bas (?:a|one of our) (?:loyal |faithful |longtime )?(?:donors?|supporters?)\b/i,
  /\byou were (?:a )?part of (?:it|this|that)\b/i,   // FLOWS-15 item 1: the Year-end hero, "This year, you were part of it"
];

// The words of one block a person reads (text blocks only: a heading, its
// paragraphs and list items).
function blockText(b) {
  // FLOWS-15 item 1: a hero's heading and line are copy too ("This year, you were part of it").
  if (b && b.type === "hero" && !b.locked) return [b.heading, b.sub].filter(x => x != null).map(String);
  if (!b || b.type !== "richtext" || b.locked) return [];
  const out = [];
  for (const p of Array.isArray(b.blocks) ? b.blocks : []) {
    if (!p) continue;
    if (p.type === "ul") for (const it of p.items || []) out.push(String(it || ""));
    else out.push(String(p.text || ""));
  }
  return out;
}

// A sentence that names a gift field is TRUST-1's (shared/giftSentence.js):
// a never-giver already reads a thank-you in its place, so it is not a claim here.
const GIFT_FIELD = /\{\{\s*(?:gift_amount|last_gift_amount|gift_date|last_gift_date|total_giving|lifetime_total)\s*\}\}/;

// The first words in `text` that claim past giving, or null.
export function claimIn(text) {
  const sentences = String(text || "").split(/(?<=[.!?])\s+/).filter(x => !GIFT_FIELD.test(x));
  for (const sentence of sentences) for (const re of CLAIMS) { const m = re.exec(sentence); if (m) return m[0]; }
  return null;
}

// Every text block that claims past giving: [{ index, phrase, hasVersion }].
export function claimsOf(blocks) {
  const out = [];
  (Array.isArray(blocks) ? blocks : []).forEach((b, index) => {
    for (const t of blockText(b)) {
      const phrase = claimIn(t);
      if (phrase) { out.push({ index, phrase, hasVersion: hasFirstGiftVersion(b) }); return; }
    }
  });
  return out;
}

// A text block's version is `firstGift`; a hero's is its own heading, `firstGiftHeading` (and an optional `firstGiftSub`).
export const hasFirstGiftVersion = b => !!(b && (b.type === "hero" ? typeof b.firstGiftHeading === "string" && b.firstGiftHeading.trim()
  : typeof b.firstGift === "string" && b.firstGift.trim()));

// The first-gift version as paragraphs (a blank line starts the next one).
export function firstGiftParagraphs(b) {
  return hasFirstGiftVersion(b) ? b.firstGift.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean) : [];
}

const fmt = n => Number(n || 0).toLocaleString("en-US");

// The editor's line: how many in the audience have never given.
export function audienceNeverGivenSentence(n) {
  const k = Number(n) || 0;
  if (!k) return "Everyone in this audience has given before.";
  return `${fmt(k)} ${k === 1 ? "person" : "people"} in this audience ${k === 1 ? "has" : "have"} never given.`;
}

// The preview's flag, or null when there is nothing to flag. claims: claimsOf's
// output; neverGiven: the audience's count; shownName: the person previewed,
// when they have never given.
export function pastGivingFlag({ claims = [], neverGiven = 0, shownName = null } = {}) {
  const open = (claims || []).filter(c => !c.hasVersion);
  if (!open.length) return null;
  const k = Number(neverGiven) || 0;
  if (k > 0) return `This letter thanks them for giving. ${fmt(k)} ${k === 1 ? "person" : "people"} in this audience never ${k === 1 ? "has" : "have"}.`;
  if (shownName) return `This letter thanks them for giving. ${shownName} never has.`;
  return null;
}

// The hint beside a block that claims it.
export function blockHint(phrase) {
  return `"${phrase}" thanks them for giving. Write a version for people who have never given, and they read it instead.`;
}

// ── FLOWS-15 item 1 (W-1114-Fundraising-17, second repeat). WHAT A NEVER-GIVER RECEIVES. ──
// FLOWS-12 flagged the letter and left the outcome alone, so Ana still got "you were part of it".
// Now a never-giver never receives donor-only copy:
//   · every block that thanks them has her first-gift version → they read her versions ("version")
//   · any such block without one → they are left out of the send ("left_out"), and the editor
//     says how many ("212 people who have never given won't get this until you write a
//     first-gift version")
//   · she ticks "Send it to them anyway" (segment.includeNeverGiven) → they read the letter as it
//     is, knowingly ("included")
//   · nothing in it thanks anyone for giving → it goes as written ("no_claim")
// Steward never writes the version: in a real org it is her words or nothing.
export const openClaims = blocks => claimsOf(blocks).filter(c => !c.hasVersion);
export const donorOnlyCopy = blocks => openClaims(blocks).length > 0;
export function neverGiverOutcome({ blocks, includeNeverGiven = false } = {}) {
  const claims = claimsOf(blocks);
  if (!claims.length) return "no_claim";
  if (claims.every(c => c.hasVersion)) return "version";
  return includeNeverGiven ? "included" : "left_out";
}
export const LEFT_OUT_REASON = "no_first_gift_version";
export function leftOutSentence(n) {
  const k = Number(n) || 0;
  if (!k) return "";
  return `${fmt(k)} ${k === 1 ? "person who has" : "people who have"} never given won't get this until you write a first-gift version.`;
}
export function includedSentence(n) {
  const k = Number(n) || 0;
  if (!k) return "";
  return `${fmt(k)} ${k === 1 ? "person who has" : "people who have"} never given will get this letter as it is, the one that thanks them for giving.`;
}
export const INCLUDE_LABEL = "Send it to them anyway, as it is";
export const notSentSentence = name => `Not sent to ${name || "them"}: no first-gift version.`;

export default { CLAIMS, claimIn, claimsOf, hasFirstGiftVersion, firstGiftParagraphs, audienceNeverGivenSentence, pastGivingFlag, blockHint, openClaims, donorOnlyCopy, neverGiverOutcome, LEFT_OUT_REASON, leftOutSentence, includedSentence, INCLUDE_LABEL, notSentSentence };
