// shared/numbers/statedAsk.js · MOPUP-3 item 2. AN IMPORTED HISTORY IS THE ASK'S BASE.
//
// The suggested ask (shared/numbers/ask.js) reads gifts Steward can date. An
// organization whose file stated a $37,206 lifetime and has one $244 gift in
// Steward was asked "$250: largest gift $244". Its history is the stated total,
// so when a file stated it (imported_import_id set; FEEL-1), the stated history
// is the ask's base and the words say so: "based on $37,206 given before
// Steward".
//
// The stated level, from what the file said, most specific first:
//   · a gift count: the stated average gift (total ÷ count), or the stated
//     last gift if that is larger;
//   · no count, a last gift: the stated last gift;
//   · no count, first and last dates: a year's giving (total ÷ the years);
//   · the total alone: the total.
// The ask is the larger of that level (rounded the one way, naturalAskCents)
// and the ask from gifts in Steward, so a donor who has since given more is
// never asked for less. Pure; `natural` is the ask rule's rounding.
"use strict";

const fmt = c => {
  const v = Math.round(Number(c) || 0);
  const s = (v % 100 ? (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (v / 100).toLocaleString("en-US", { maximumFractionDigits: 0 }));
  return `$${s}`;
};
const whole = c => fmt(Math.round((Number(c) || 0) / 100) * 100);   // "about" is whole dollars
const DAY = 86400000;

// stated: { cents, count, lastCents, firstDate, lastDate } (from the donors row
// or a giving unit's people, summed). Returns { levelCents, detail } or null.
function statedLevel(stated) {
  const t = Math.round(Number(stated && stated.cents) || 0);
  if (t <= 0) return null;
  const n = Math.round(Number(stated.count) || 0);
  const last = Math.round(Number(stated.lastCents) || 0);
  if (n > 0) {
    const avg = Math.round(t / n);
    if (last > avg) return { levelCents: last, detail: `${n.toLocaleString("en-US")} ${n === 1 ? "gift" : "gifts"}, the last ${fmt(last)}` };
    return { levelCents: avg, detail: n === 1 ? "one gift" : `${n.toLocaleString("en-US")} gifts, about ${whole(avg)} each` };
  }
  if (last > 0) return { levelCents: last, detail: `the last ${fmt(last)}` };
  const a = Date.parse(String(stated.firstDate || "").slice(0, 10)), b = Date.parse(String(stated.lastDate || "").slice(0, 10));
  if (!isNaN(a) && !isNaN(b) && b > a) {
    const years = Math.max(1, Math.ceil((b - a + DAY) / (365.25 * DAY)));
    if (years > 1) { const per = Math.round(t / years); return { levelCents: per, detail: `about ${whole(per)} a year over ${years} years` }; }
  }
  return { levelCents: t, detail: null };
}

// own: the ask from gifts in Steward (ask.askFor / smartAmounts.suggestedAskCents,
// or null). Returns the ask with the stated base, or `own` unchanged when
// nothing was stated or Steward's own gifts already ask more.
function withStated(own, stated, natural) {
  const lvl = statedLevel(stated);
  if (!lvl) return own;
  const base = natural(lvl.levelCents);
  if (own && own.askCents >= base) return own;
  const since = own && own.largestCents > 0 ? `, and a largest gift of ${fmt(own.largestCents)} since` : "";
  return {
    ...(own || {}),
    askCents: base, rising: false, held: false, stated: true, statedCents: Math.round(Number(stated.cents)),
    sentence: `Based on ${fmt(stated.cents)} given before Steward${lvl.detail ? ` (${lvl.detail})` : ""}${since}: ask ${fmt(base)}.`,
  };
}

module.exports = { statedLevel, withStated };
