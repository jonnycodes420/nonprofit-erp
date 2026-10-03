// shared/roomToGive.js — PROSPECT-1. ROOM TO GIVE, IN ONE PLAIN WORD.
//
// "Who could give more?" answered from facts Steward already holds, with no
// vendor at all, and then sharpened by a screening file when one comes back.
// The answer is a WORD (Strong, Some, Not yet known) and the reasons behind it.
// Never a meter, never a score out of a hundred, never a made-up number: every
// figure in a reason is a sum or a count of the person's own rows, or a range a
// named screening provider returned.
//
// HOW THE WORD IS DECIDED (word for word in docs/decisions/major-gifts.md):
//   Their own file gives up to nine signals: a gift at least three times their
//   usual gift (with three or more gifts on file); giving up in each of the
//   last three twelve-month periods; generosity 80 or more; engagement Close
//   (67 or more); a monthly gift plus a one-time gift in the last twelve months;
//   gifts to two or more funds or campaigns; an event or volunteer hours on
//   file; a gift through a donor-advised fund; a matched gift.
//   Strong   three or more signals, one of them the large gift or the rising
//            trend; or a screening file whose capacity range starts at five
//            times or more what they gave in the last twelve months.
//   Some     at least one signal (and giving not down three years running
//            holds a Strong back to Some).
//   Not yet known  no gifts on file, or no signal at all.
//
// Pure: no DB, no network, no clock. The caller hands in `today`.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const spell = n => (n >= 0 && n < 10 ? WORDS[n] : String(n));

export const LABELS = { strong: "Strong", some: "Some", unknown: "Not yet known" };
export const RANK = { strong: 2, some: 1, unknown: 0 };
export const STRONG_CAPACITY_MULTIPLE = 5;
export const BIG_GIFT_MULTIPLE = 3;

export function dollars(cents) {
  const c = Math.abs(Math.round(Number(cents) || 0));
  return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
export function rangeText(lo, hi) {
  if (lo == null && hi == null) return null;
  if (lo != null && hi != null && lo !== hi) return `${dollars(lo)} to ${dollars(hi)}`;
  if (lo != null && hi == null) return `${dollars(lo)} or more`;
  if (lo == null) return `up to ${dollars(hi)}`;
  return dollars(lo);
}
const dayNum = d => Date.parse(String(d).slice(0, 10) + "T00:00:00Z") / 86400000;
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
// The three trailing twelve-month periods ending today, newest first.
export function trailingYears(gifts, today) {
  const t = dayNum(today);
  const out = [0, 0, 0];
  for (const g of gifts) {
    const age = t - dayNum(g.date);
    if (!(age >= 0)) continue;
    const i = Math.floor(age / 365);
    if (i < 3) out[i] += g.cents;
  }
  return out;
}

// facts = { today, gifts:[{id,date,cents,fund,campaign,method,matched,recurring}], engagement, generosity,
//           monthly:{cents}|null, events, hours, screening:{provider,screenedOn,capacityLowCents,...}|null }
export function assess(facts) {
  const f = facts || {};
  const gifts = (f.gifts || []).filter(g => g && g.cents > 0 && g.date);
  const reasons = [];
  const signals = [];
  const add = (key, text, signal = true) => { reasons.push({ key, text }); if (signal) signals.push(key); };
  const [y0, y1, y2] = trailingYears(gifts, f.today);
  const annualCents = y0;

  if (gifts.length >= 3) {
    const usual = median(gifts.map(g => g.cents));
    const largest = gifts.reduce((a, b) => (b.cents > a.cents || (b.cents === a.cents && b.date > a.date) ? b : a));
    if (usual > 0 && largest.cents >= BIG_GIFT_MULTIPLE * usual) {
      const times = gifts.filter(g => g.cents === largest.cents).length;
      add("bigGift", `Gave ${dollars(largest.cents)} ${times === 1 ? "once" : `${spell(times)} times`} in ${String(largest.date).slice(0, 4)}, usually gives ${dollars(usual)}`);
    }
  }
  let falling = false;
  if (y2 > 0 && y1 > y2 && y0 > y1) add("rising", `Giving up three years running (${dollars(y2)}, then ${dollars(y1)}, then ${dollars(y0)} in the last twelve months)`);
  else if (y2 > 0 && y1 < y2 && y0 < y1) { falling = true; add("falling", `Giving down three years running (${dollars(y2)}, then ${dollars(y1)}, then ${dollars(y0)} in the last twelve months)`, false); }

  if (Number(f.generosity) >= 80) add("generosity", `Generosity ${Number(f.generosity)} of 100, among your most generous`);
  if (Number(f.engagement) >= 67) add("close", `Engagement ${Number(f.engagement)} of 100, Close`);

  if (f.monthly && f.monthly.cents > 0) {
    const t = dayNum(f.today);
    const extra = gifts.filter(g => !g.recurring && t - dayNum(g.date) >= 0 && t - dayNum(g.date) < 365);
    if (extra.length) add("monthlyPlus", `Gives ${dollars(f.monthly.cents)} a month and gave ${dollars(extra.reduce((s, g) => s + g.cents, 0))} more in one-time gifts in the last twelve months`);
  }
  const places = new Set(gifts.map(g => g.fund ? `f:${g.fund}` : g.campaign ? `c:${g.campaign}` : null).filter(Boolean));
  if (places.size >= 2) add("spread", `Gave to ${spell(places.size)} different funds or campaigns`);
  const ev = Number(f.events) || 0, hrs = Math.round((Number(f.hours) || 0) * 100) / 100;
  if (ev > 0 || hrs > 0) {
    const bits = [];
    if (ev > 0) bits.push(`came to ${ev === 1 ? "an event" : `${spell(ev)} events`}`);
    if (hrs > 0) bits.push(`volunteered ${hrs} ${hrs === 1 ? "hour" : "hours"}`);
    add("involved", bits.join(" and ").replace(/^./, c => c.toUpperCase()));
  }
  if (gifts.some(g => /\bdaf\b|donor.advised/i.test(String(g.method || "")))) add("daf", "Has given through a donor-advised fund");
  if (gifts.some(g => g.matched)) add("matched", "Has a gift matched by an employer on file");

  // Their own file first; then what a screening file brought.
  let word;
  if (!gifts.length) word = signals.length ? "some" : "unknown";
  else if (signals.length >= 3 && (signals.includes("bigGift") || signals.includes("rising"))) word = "strong";
  else word = signals.length ? "some" : "unknown";
  if (falling && word === "strong") word = "some";
  if (!gifts.length && !signals.length) reasons.unshift({ key: "noGifts", text: "No gifts on file yet" });
  else if (!signals.length) reasons.push({ key: "nothingYet", text: "Nothing on their own file points to more room yet" });

  const s = f.screening;
  let screeningMoved = false;
  if (s) {
    const cap = rangeText(s.capacityLowCents, s.capacityHighCents);
    if (cap) reasons.push({ key: "capacity", text: `Capacity range from the screening file: ${cap}; currently gives ${dollars(annualCents)} a year`, screening: true });
    const re = rangeText(s.realEstateLowCents, s.realEstateHighCents);
    if (re) reasons.push({ key: "realEstate", text: `Real estate value range from the screening file: ${re}`, screening: true });
    if (s.otherGifts) reasons.push({ key: "otherGifts", text: `Known gifts to other charities, from the screening file: ${s.otherGifts}`, screening: true });
    if (s.foundationTies) reasons.push({ key: "foundation", text: `Foundation or donor-advised fund ties, from the screening file: ${s.foundationTies}`, screening: true });
    if (s.businessAffiliations) reasons.push({ key: "business", text: `Business affiliations, from the screening file: ${s.businessAffiliations}`, screening: true });
    const lo = s.capacityLowCents;
    if (lo != null && lo > 0 && lo >= STRONG_CAPACITY_MULTIPLE * annualCents && word !== "strong") { word = "strong"; screeningMoved = true; }
  }
  return { word, label: LABELS[word], rank: RANK[word], reasons, signals, annualCents, trailing: [y0, y1, y2], screeningMoved };
}

// The one-line summary Who could give more uses: the first two reasons.
export function summary(a) {
  const own = (a.reasons || []).filter(r => r.key !== "nothingYet" && r.key !== "noGifts");
  return own.slice(0, 2).map(r => r.text).join("; ") + (own.length ? "." : "");
}

export function monthYear(date) {
  const d = String(date || "");
  return d.length >= 7 ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : d;
}
