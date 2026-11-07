// TRUTH-3 (W-1107-Fundraising-23X): the Re-engage plan ranks people by a rule
// it names, and the rule is the sort. Each rule is a number read from the row
// (never text), highest first, ties by name. The rank is shown beside it.
export const RANK_RULES = {
  lifetime: { label: "Lifetime giving", value: d => Number(d.total) || 0 },
  last_gift: { label: "Last gift amount", value: d => Number(d.lastAmount) || 0 },
  longest: { label: "Longest since last gift", value: (d, today = new Date()) => {
    const s = d.lastGift || d.lastTouchpoint;
    if (!s) return -1;
    const t = Date.parse(String(s).slice(0, 10) + "T00:00:00Z");
    return Number.isFinite(t) ? Math.floor((today.getTime() - t) / 86400000) : -1;
  } },
};

export function rankBy(rows, rule = "lifetime", today = new Date()) {
  const r = RANK_RULES[rule] || RANK_RULES.lifetime;
  return [...(rows || [])].sort((a, b) => (r.value(b, today) - r.value(a, today)) || String(a.name || "").localeCompare(String(b.name || "")));
}
export const rankWords = (i, rule) => `#${i + 1} by ${(RANK_RULES[rule] || RANK_RULES.lifetime).label.toLowerCase()}`;
