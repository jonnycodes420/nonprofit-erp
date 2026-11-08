// TRUST-1 · A SENTENCE ABOUT A GIFT, FOR SOMEONE WITH NO GIFT.
//
// A campaign merge used to fill {{gift_amount}} with "your previous gift" for a
// person who had never given, so the Thank-you starter read "Thank you for your
// gift of your previous gift". A fallback word can't fix that: the sentence is
// about a gift that isn't there. So the sentence changes. Every renderer (the
// legacy campaign send, the shared preview, the block renderer) calls this
// BEFORE filling fields: when the person has no gift, each sentence that names
// one of the gift fields becomes NO_GIFT_SENTENCE, and a sentence that names
// their lifetime total does the same when it is nothing.
//
// A "sentence" is a run of text up to . ! or ?, never crossing a tag or a line
// break, so HTML and the block editor's plain lines both keep their shape.
// Pure: no clock, no database.

export const NO_GIFT_SENTENCE = "Thank you for being part of this.";

const GIFT_KEYS = ["gift_amount", "last_gift_amount", "gift_date", "last_gift_date"];
const TOTAL_KEYS = ["total_giving", "lifetime_total"];

const tokenRe = keys => `\\{\\{\\s*(?:${keys.join("|")})\\s*\\}\\}`;

// LIST-3: sentences that say who she is asking. They name no merge field, so
// the rule above cannot see them; for a person with no gift each is swapped
// for its no-gift variant. {{org_name}} is filled after, by the renderer.
// ATLAS-4: every wording of it (we are / we're, people / those / supporters,
// have / 've), and withoutGivenBefore for the paths that fill their own fields
// (a tracked sequence's or journey's step, the older sequence send), so a
// send, a draft and a preview all say the same thing to a never-giver.
const GIVEN_BEFORE = [
  [/\bwe(?: are|['\u2019]re) asking (?:the )?(?:people|those|friends|supporters|donors) who(?: have|['\u2019]ve) given before to go first\b/gi, "we're asking friends of {{org_name}} to join us"],
  // SENDS-1: the starter's older wording, kept in templates copied before it changed.
  [/\bI will not ask again this year\b/g, "I will not ask a second time this year"],
];
// SENDS-1: "We are asking…" at a sentence's start stays capitalised as "We're asking…".
const sameCase = (orig, v) => (/^[A-Z]/.test(orig) ? v.charAt(0).toUpperCase() + v.slice(1) : v);
export function withoutGivenBefore(text, { hasGift = true, orgName = null } = {}) {
  let out = String(text == null ? "" : text);
  if (hasGift) return out;
  for (const [re, variant] of GIVEN_BEFORE) out = out.replace(re, m => sameCase(m, orgName == null ? variant : variant.replace("{{org_name}}", orgName)));
  return out;
}
export const GIVEN_BEFORE_RE = /\bgiven before\b/i;

// SENDS-1: `mark(original, variant)` is what a swapped sentence becomes. A send,
// a draft and a test use the variant; the editor's own preview (EDITOR-1, chips)
// marks it so the words read back as she typed them and the template never changes.
export function withoutMissingGift(text, { hasGift = true, hasTotal = true, mark = null } = {}) {
  let out = String(text == null ? "" : text);
  const put = (orig, variant) => (mark ? mark(orig, variant) : variant);
  if (!hasGift) for (const [re, variant] of GIVEN_BEFORE) out = out.replace(re, m => put(m, sameCase(m, variant)));
  const keys = [...(hasGift ? [] : GIFT_KEYS), ...(hasTotal ? [] : TOTAL_KEYS)];
  if (!keys.length) return out;
  // The leading space (after the sentence before it) is kept as it was.
  const re = new RegExp(`(\\s*)[^.!?<>\\n]*${tokenRe(keys)}[^.!?<>\\n]*[.!?]?`, "g");
  out = out.replace(re, (whole, gap) => `${gap}${put(whole.slice(gap.length), NO_GIFT_SENTENCE)}`);
  if (mark) return out;
  // Two gift sentences in a row become one thank-you, not two.
  const dup = NO_GIFT_SENTENCE.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  return out.replace(new RegExp(`(${dup})(\\s*${dup})+`, "g"), "$1");
}

// Is there a gift in these values? Empty, missing or zero all mean no.
// A value still in braces (a template's own preview) counts as a gift.
export function hasValue(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return false;
  if (/^\$?0(?:\.0+)?$/.test(s)) return false;
  return true;
}
