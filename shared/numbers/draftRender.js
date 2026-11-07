// shared/numbers/draftRender.js · TRUTH-3. A DRAFT STORES ITS FIGURE KEYS, NEVER ITS NUMBERS.
//
// TRUTH-2 made a new draft state the true lifetime and refused a stale Send,
// but a stored draft still read wrong when it was opened: "$12,500" for a
// person at $21,000, "$88,606" for one at $5,001, "$1,300" for one whose
// stated lifetime (an import's "before Steward" total) is $37,206. The words
// were rendered once and stored.
//
// The rule (the way established CRMs keep a merge letter): a draft stores its
// words with figure KEYS in them, and every open, preview and send fills the
// keys from shared/numbers (draftFigures.js). The keys are the merge fields
// the email templates already use:
//   {{total_giving}}      lifetime (lifetime.js LIFETIME: the stated before-
//                         Steward total plus every money row after it)
//   {{giving_this_year}}  this fiscal year to date (givingBetween.js)
//   {{last_gift_amount}}  the latest gift above zero (lastGift.js)
//   {{gift_count}}        gifts counted by the one rule (giftCount.js)
//
// templatize() turns words into a template: in a sentence that claims a TOTAL
// (figureCheck's TOTAL_WORDS), a figure becomes {{giving_this_year}} when the
// sentence is about this year and {{total_giving}} otherwise. A figure right
// after "crossed" is a threshold ("crossed $10,000"), not a claim, and stays.
// A figure in any other sentence ("your gift of $500 on May 3") is about one
// gift and stays as written. render() = fill(templatize(words)), so an old
// stored draft with a stale total reads true the moment it is opened.
"use strict";

const KEYS = {
  total_giving: F => dollars(F.lifetime),
  giving_this_year: F => dollars(F.thisYear),
  last_gift_amount: F => (F.lastGift ? dollars(F.lastGift.amount) : "your gift"),
  gift_count: F => String(F.giftCount || 0),
};
const TOKEN = /\{\{(total_giving|giving_this_year|last_gift_amount|gift_count)\}\}/g;

const TOTAL_WORDS = /\b(now given|have given|you've given|given (?:us )?(?:a total|in total|in all|altogether|so far|to date)|in total|in all|altogether|so far|to date|lifetime|cumulative|total(?:ling|ed)?|has (?:now )?(?:reached|passed|grown to)|now (?:reached|passed|stands at))\b/i;
const THIS_YEAR = /\bthis (?:fiscal )?year\b/i;
const MONEY = /\$\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g;
const THRESHOLD_BEFORE = /\b(crossed|cross|crossing|beyond|over|more than|surpassed)\s*$/i;

// "$21,000" / "$1,050.50": the way a draft writes a figure.
function dollars(v) {
  const n = Number(v || 0);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// Pure: the words with every total-claim figure as its key.
function templatize(text) {
  if (text == null) return text;
  return String(text).split(/((?<=[.!?])[ \t]+|\n+)/).map(part => {
    if (!TOTAL_WORDS.test(part)) return part;
    const key = THIS_YEAR.test(part) ? "{{giving_this_year}}" : "{{total_giving}}";
    return part.replace(MONEY, (m, offset) => (THRESHOLD_BEFORE.test(part.slice(0, offset)) ? m : key));
  }).join("");
}

// Pure: the keys filled from figures F (draftFigures.js). Without F, the words as stored.
function fill(text, F) {
  if (text == null || !F) return text;
  return String(text).replace(TOKEN, (_, k) => KEYS[k](F));
}

const render = (text, F) => fill(templatize(text), F);
const hasKeys = text => new RegExp(TOKEN.source).test(String(text || ""));

// The header line a draft card shows beside the person: the same lifetime key,
// and, when an import stated a total, that it is in it ("including $37,206
// before Steward").
function lifetimeHeader(F) {
  if (!F) return null;
  const before = F.beforeStewardCents > 0 ? `, including ${dollars(F.beforeStewardCents / 100)} before Steward` : "";
  return `${dollars(F.lifetime)} lifetime giving${before}`;
}

module.exports = { templatize, fill, render, hasKeys, lifetimeHeader, dollars, KEYS, TOTAL_WORDS };
