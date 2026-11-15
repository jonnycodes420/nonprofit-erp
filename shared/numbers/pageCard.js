// shared/numbers/pageCard.js · FLOWS-12 item 3 (W-1114-Fundraising-35X).
// A GIVING PAGE'S CARD COUNTS ONE THING: THE PAGE.
//
// A page linked to the Year-end campaign showed "Raised $11,579.22" (the
// campaign's total, every channel) beside "Gifts 0" (gifts made through the
// page), and nothing said the two counted different things. Now Raised and
// Gifts are both the page's own (figure sources `page-raised` and
// `page-gifts`, so each opens its rows), said in one sentence, and a linked
// campaign's total is a line of its own that names what it counts.
"use strict";
const money = require("../../money");

const giftsWord = n => (Number(n) === 1 ? "gift" : "gifts");

// "Through this page: $0 from 0 gifts."
function throughPageSentence(cents, gifts) {
  const n = Number(gifts) || 0;
  return `Through this page: ${money.formatCentsPlain(Number(cents) || 0)} from ${n.toLocaleString("en-US")} ${giftsWord(n)}.`;
}

// "The whole Year-end campaign: $11,579.22, from every way it came in, this page included."
function campaignLineSentence(name, cents) {
  return `The whole ${String(name || "campaign").trim()} campaign: ${money.formatCentsPlain(Number(cents) || 0)}, from every way it came in, this page included.`
    .replace(/ campaign campaign:/i, " campaign:");
}

// The admin list's card row (routes/give.js GET /giving-pages), after its
// figures are read: the sentence, and a linked campaign's own line.
function sayCard(r) {
  r.through_page_sentence = throughPageSentence(money.toCents(r.raised_amount) || 0, r.gifts_count);
  if (r.campaign_id) r.campaign_line_sentence = campaignLineSentence(r.campaign_name, money.toCents(r.campaign_raised) || 0);
  return r;
}

module.exports = { throughPageSentence, campaignLineSentence, giftsWord, sayCard };
