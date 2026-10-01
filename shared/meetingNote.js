// shared/meetingNote.js — INT-BUILD-1 Part 5. WHAT STEWARD HEARD IN HER NOTE.
//
// After a meeting she types a few lines. This reads them for the things the
// record has a place for (a pledge, a gift, a fund, a next step) and offers
// each as a chip she confirms or removes. NOTHING HERE WRITES. A chip is a
// suggestion until she presses save, and then it goes through the ordinary
// gift and pledge routes like anything she typed into a form.
//
// It is a reader, not a model: it works with AI off, sends her note nowhere,
// and says nothing it cannot point to in her own words. A phrase it does not
// recognise produces no chip, which is the right failure: a missed chip costs
// her one field; an invented pledge would be a false record.
//
// Pure: no DB, no network, no clock.

const AMOUNT = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|K|thousand|m|M|million)?`;

export function parseAmount(num, unit) {
  const n = Number(String(num).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const u = String(unit || "").toLowerCase();
  const mult = u === "k" || u === "thousand" ? 1e3 : u === "m" || u === "million" ? 1e6 : 1;
  return Math.round(n * mult * 100) / 100;
}

const WORDS_TO_N = { two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12 };

/**
 * @param note   her text
 * @param ctx    { funds: [{id, name}], openAsk: {amount, fundId, fundName}|null }
 * @returns [{ kind: "pledge"|"gift"|"fund"|"next", label, amount?, payments?, fundId?, text?, quote }]
 */
export function suggestFromNote(note, ctx = {}) {
  const text = String(note || "");
  const low = text.toLowerCase();
  const out = [];
  if (!text.trim()) return out;

  // How many payments, if she said ("split", "half now and half in March",
  // "over three years", "in four payments").
  let payments = null;
  if (/\bhalf now\b|\bsplit\b.*\b(two|2)\b|\bsplit\b/.test(low)) payments = 2;
  const m1 = low.match(/\b(?:in|over)\s+(\d+|two|three|four|five|six|twelve)\s+(?:payments|installments|instalments|years|parts)\b/);
  if (m1) payments = Number(m1[1]) || WORDS_TO_N[m1[1]] || payments;

  // A PLEDGE: she committed to an amount, or "she's in" for the ask on file.
  const amounts = [...text.matchAll(new RegExp(AMOUNT, "g"))].map(m => ({ amount: parseAmount(m[1], m[2]), at: m.index, raw: m[0] }));
  const committed = /\b(she's in|he's in|they're in|is in for|are in for|committed|pledged?|will give|agreed to|yes to)\b/i.exec(text);
  const gave = /\b(gave|handed (?:me|us) a (?:check|cheque)|wrote a (?:check|cheque)|donated)\b/i.exec(text);
  const near = (m, list) => list.find(a => Math.abs(a.at - m.index) < 60) || list[0];
  if (committed && (amounts.length || ctx.openAsk?.amount)) {
    const a = amounts.length ? near(committed, amounts) : { amount: Number(ctx.openAsk.amount) };
    if (a && a.amount > 0) out.push({ kind: "pledge", amount: a.amount, payments: payments || 1,
      label: `Pledge $${a.amount.toLocaleString("en-US")}${payments && payments > 1 ? `, ${payments} payments` : ""}`,
      quote: committed[0] });
  } else if (gave && amounts.length) {
    const a = near(gave, amounts);
    out.push({ kind: "gift", amount: a.amount, label: `Gift $${a.amount.toLocaleString("en-US")}`, quote: gave[0] });
  }

  // A FUND: a fund on file named in the note, or the open ask's fund when
  // she committed to the ask.
  const named = (ctx.funds || []).filter(f => f.name && f.name.length > 3 && low.includes(f.name.toLowerCase()));
  const fund = named[0] || (out[0] && ctx.openAsk?.fundId ? { id: ctx.openAsk.fundId, name: ctx.openAsk.fundName } : null);
  if (fund && fund.name) out.push({ kind: "fund", fundId: fund.id, label: fund.name, quote: fund.name });

  // A NEXT STEP: the first sentence that asks for something to happen.
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const ask = sentences.find(s => /\b(follow up|send|invite|call|schedule|introduce|meet|visit|asked if|wants to|next)\b/i.test(s)
    && !/\bshe's in\b/i.test(s));
  if (ask) out.push({ kind: "next", text: ask.replace(/\.$/, ""), label: "Next step from your note", quote: ask });

  return out;
}

export default { suggestFromNote, parseAmount };
