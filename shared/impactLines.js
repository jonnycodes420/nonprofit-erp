// shared/impactLines.js · FLOWS-13 item 5 (W-1114-Fundraising-34X). EACH AMOUNT SAYS ITS OWN THING.
//
// "All four amounts, $25, $50, $100, and $250, carry the identical line "buys a
// week of art supplies for 10 kids"." The live page shows exactly what is saved
// per amount (givingPageDesign.impactFor), and Harborlight's seed saves five
// different lines on Spring Paddle only. The line the fleet read four times was
// the editor's example, printed as the placeholder in every amount's box, so a
// page with no lines at all read as one line claimed by every amount. The boxes
// now ask "What does $25 do?" and stay empty until she writes one.
//
// And when the same line IS saved on two or more amounts (typed or pasted), the
// editor says so beside the boxes, and Publish asks before the page goes out:
// a $25 gift and a $250 gift do not buy the same thing.

const clean = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const dollars = c => "$" + (Math.round(Number(c) || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

// The box's prompt for one amount, in cents. Never an example impact.
export function impactPlaceholder(cents) {
  return `What does ${dollars(cents)} do? (optional)`;
}

// impact: { "2500": "line", ... }; amountsCents: the page's amounts.
// null when every saved line is its own; otherwise the repeated line, the
// amounts that carry it, and the sentence the editor and Publish say.
export function repeatedImpact(impact, amountsCents) {
  const map = impact && typeof impact === "object" ? impact : {};
  const groups = new Map();
  for (const c of amountsCents || []) {
    const line = map[String(Math.round(Number(c) || 0))];
    const k = clean(line);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, { line: String(line).trim(), cents: [] });
    groups.get(k).cents.push(Math.round(Number(c) || 0));
  }
  const worst = [...groups.values()].filter(g => g.cents.length >= 2).sort((a, b) => b.cents.length - a.cents.length)[0];
  if (!worst) return null;
  const names = worst.cents.map(dollars);
  const list = names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return { line: worst.line, cents: worst.cents,
    sentence: `${list} all say "${worst.line}". Each amount's line should say what that amount does, or be left blank.` };
}
