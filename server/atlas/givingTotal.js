// server/atlas/givingTotal.js · TRUTH-3. ATLAS DOES ARITHMETIC IN CODE, NEVER IN THE MODEL.
//
// The fleet (7 Nov) asked Atlas "how much did Marlowe and Renee give
// together" and heard "$0 in 0 gifts" (W-1107-Atlas-22): the question went to
// /ask as one name. It heard the right totals with the wrong gift counts
// (Atlas-01X: the stored donors.gift_count), and "Walter" summed several
// different Walters into one answer (Atlas-20X).
//
// The rule: every amount and count Atlas states is read from shared/numbers,
// the functions the profile reads (lifetime.js LIFETIME, giftCount.js). A
// question about several people resolves EACH name to one person (routes/
// atlas.js resolveAll asks "Which Walter?" with each match's lifetime and
// never merges them), and the sum is done here, in cents.
"use strict";
const { LIFETIME } = require("../../shared/numbers/lifetime");
const { GIFT_COUNT } = require("../../shared/numbers/giftCount");

// "how much did Marlowe and Renee give (together)", "how much has Walter
// given", "what did Ada, Bo and Cy give in total", "total giving for Ada and
// Bo", "how many gifts has Ada made". → { names: [...], count: bool } | null.
const PATTERNS = [
  /\bhow much (?:did|has|have|had)\s+(.+?)\s+(?:give|given|gave|donate|donated|contribute|contributed)\b/i,
  /\bwhat (?:did|has|have)\s+(.+?)\s+(?:give|given|gave|donate|donated)\b(?:\s+(?:in total|altogether|together|so far|overall|lifetime))?/i,
  /\b(?:total|lifetime|combined) giving (?:for|of|from)\s+(.+?)(?:[?.!]|$)/i,
  /\bhow many gifts (?:did|has|have)\s+(.+?)\s+(?:make|made|give|given|gave)\b/i,
];
function parseGivingQuestion(words) {
  const t = String(words || "").trim();
  for (const [i, re] of PATTERNS.entries()) {
    const m = t.match(re);
    if (!m) continue;
    const names = splitNames(m[1]);
    if (!names.length) continue;
    return { names, count: i === 3 };
  }
  return null;
}
const NOT_A_NAME = /^(?:they|them|we|you|he|she|it|everyone|everybody|people|donors|our donors|the board|all|anyone)$/i;
function splitNames(s) {
  return String(s || "")
    .replace(/\b(?:both|together|combined|altogether|in total|each|so far)\b/gi, " ")
    .split(/\s*(?:,|&|\band\b|\bplus\b)\s*/i)
    .map(x => x.replace(/^(?:the\s+)?/i, "").replace(/'s$/i, "").replace(/\s+/g, " ").trim())
    .filter(x => x && !NOT_A_NAME.test(x));
}

const usd = cents => {
  const n = Number(cents || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
const gifts = n => `${n.toLocaleString("en-US")} ${n === 1 ? "gift" : "gifts"}`;

// Each person's lifetime, before-Steward part and counted gifts, by the one rules.
async function figuresFor(query, orgId, ids) {
  if (!ids.length) return [];
  const rows = await query(
    `SELECT d.id, d.name, ROUND(${LIFETIME("d")} * 100)::bigint AS cents, ${GIFT_COUNT("d")} AS n,
            CASE WHEN d.imported_import_id IS NOT NULL THEN ROUND(COALESCE(d.imported_total, 0) * 100)::bigint ELSE 0 END AS before_cents
       FROM donors d WHERE d.org_id = ? AND d.id = ANY(?::text[]) AND d.deleted_at IS NULL`, [orgId, ids]);
  return ids.map(id => rows.find(r => r.id === id)).filter(Boolean)
    .map(r => ({ id: r.id, name: r.name, cents: Number(r.cents) || 0, giftCount: Number(r.n) || 0, beforeCents: Number(r.before_cents) || 0 }));
}

// The answer, every figure computed here: { sentence, totalCents, giftCount, people }.
function answerFor(people, { together = false } = {}) {
  const totalCents = people.reduce((s, p) => s + p.cents, 0);
  const giftCount = people.reduce((s, p) => s + p.giftCount, 0);
  const one = p => `${usd(p.cents)} across ${gifts(p.giftCount)}${p.beforeCents > 0 ? ` (including ${usd(p.beforeCents)} given before Steward)` : ""}`;
  let sentence;
  if (people.length === 1) {
    const p = people[0];
    sentence = p.cents || p.giftCount ? `${p.name} has given ${one(p)}.` : `${p.name} has no gifts on record yet.`;
  } else {
    const names = people.map(p => p.name);
    const list = names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    sentence = `${list} have given ${usd(totalCents)}${together || people.length > 1 ? " together" : ""} across ${gifts(giftCount)}: `
      + people.map(p => `${p.name} ${one(p)}`).join("; ") + ".";
  }
  return { sentence, totalCents, giftCount, people,
    definition: "Lifetime giving (any total stated by an import, plus every gift since), and gifts counted by the one rule: a hard-credit gift above $0." };
}

module.exports = { parseGivingQuestion, splitNames, figuresFor, answerFor, usd };
