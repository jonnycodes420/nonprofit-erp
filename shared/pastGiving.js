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
];

// The words of one block a person reads (text blocks only: a heading, its
// paragraphs and list items).
function blockText(b) {
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

export const hasFirstGiftVersion = b => !!(b && typeof b.firstGift === "string" && b.firstGift.trim());

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

export default { CLAIMS, claimIn, claimsOf, hasFirstGiftVersion, firstGiftParagraphs, audienceNeverGivenSentence, pastGivingFlag, blockHint };
