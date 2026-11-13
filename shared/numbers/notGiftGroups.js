// shared/numbers/notGiftGroups.js · ASKS-2 item 3. ROWS THAT MAY NOT BE GIFTS, IN GROUPS.
//
// A customer's "Rows that may not be gifts" listed 167 rows ($68,090), about
// 150 of them one kind: memos like "Posted: <name> Service Income - 2022 Fall
// Session", program fees. One decision took 150 clicks. Now the list is
// grouped by the reason and the memo's pattern (the person's own name, the
// year, the season and other numbers taken out), and a group of two or more
// is decided at once (server/insights/reviewGroup.js). Nothing is decided by
// itself: the group only gathers rows, and nothing changes until the click.
//
//   patternOf(memo, names)   the memo with the person's name, years, seasons,
//                            months and numbers taken out
//   groupKey(kind, pattern)  one group's key: the reason and the pattern
//   groupsOf(items)          the card's groups: [{ key, kind, reason, pattern,
//                            giftIds, count, cents, partly }], largest first
//   preview(query, orgId, giftIds, decision, valueCents)
//                            what the group's decision would change, read live:
//                            the org's Lifetime giving before and after, and the
//                            people left with no gift (who become contacts)
"use strict";
const { GIFT, MONEY } = require("./money");
const { LIFETIME, AFTER_IMPORT } = require("./lifetime");
const { EVERYONE } = require("./everyone");

const MIN_GROUP = 2;
const SEASON = /\b(spring|summer|fall|autumn|winter)\b/gi;
const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b\.?/gi;
const YEAR = /\b(19|20)\d{2}\b/g;
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function patternOf(memo, names = []) {
  let m = String(memo || "").trim().replace(/^(posted|payment|pmt|paid)\s*:\s*/i, "");
  const words = [...new Set((names || []).flatMap(n => String(n || "").split(/[\s,&]+/)).map(w => w.replace(/[^\p{L}'-]/gu, "")).filter(w => w.length >= 2))];
  for (const w of words) m = m.replace(new RegExp(`(^|[^\\p{L}])${escape(w)}(?=$|[^\\p{L}])`, "giu"), "$1");
  m = m.replace(YEAR, "<year>").replace(SEASON, "<season>").replace(MONTH, "<month>").replace(/\d+([.,/-]\d+)*/g, "#");
  return m.replace(/\s+/g, " ").replace(/^[\s,;:·-]+|[\s,;:·-]+$/g, "").trim();
}
const groupKey = (kind, pattern) => `${kind || "other"}|${String(pattern || "").toLowerCase()}`;

// items: the review card's rows ({ giftId, cents, reason, kind, pattern, partly }).
function groupsOf(items, { min = MIN_GROUP } = {}) {
  const by = new Map();
  for (const it of items || []) {
    if (!it.pattern) continue;
    const key = groupKey(it.kind, it.pattern);
    if (!by.has(key)) by.set(key, { key, kind: it.kind || "other", reason: it.reason, pattern: it.pattern, giftIds: [], count: 0, cents: 0, partly: true });
    const g = by.get(key);
    g.giftIds.push(it.giftId); g.count++; g.cents += it.cents || 0; g.partly = g.partly && it.partly !== false;
  }
  return [...by.values()].filter(g => g.count >= min).sort((a, b) => b.cents - a.cents || b.count - a.count);
}

// ── THE PREVIEW, READ LIVE ──────────────────────────────────────────────────
// Lifetime giving is the org's sum of every person's Lifetime (lifetime.js,
// the profile's figure: the imported total plus every gift since it). A row
// marked Not a gift leaves it whole; Partly a gift takes the value received
// off each row it is less than (a row it is not less than is refused, as on
// the row's own button); Keep changes nothing. A person whose every gift is in the
// group, and who has no imported total, would have given nothing: the
// donor role comes off and they become a contact (donorType.js), as an
// import does for a person with no gift.
async function preview(query, orgId, giftIds, decision, valueCents = 0) {
  const ids = [...new Set((giftIds || []).map(String))];
  const [tot] = await query(`SELECT ROUND(COALESCE(SUM(${LIFETIME("d")}), 0) * 100)::bigint AS cents FROM donors d WHERE d.org_id = ? AND ${EVERYONE("d")}`, [orgId]);
  // the group's rows that count in someone's Lifetime, in cents
  const [inLife] = await query(`SELECT COUNT(*)::int AS n, ROUND(COALESCE(SUM(g.amount), 0) * 100)::bigint AS cents,
                                       COALESCE(SUM(CASE WHEN g.amount > ?::numeric THEN ?::numeric ELSE 0 END), 0) AS value
                                  FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                                 WHERE g.org_id = ? AND g.id = ANY(?::text[]) AND ${EVERYONE("d")} AND ${MONEY("g")} AND ${AFTER_IMPORT("g", "d")}`,
    [Math.max(0, Number(valueCents) || 0) / 100, Math.max(0, Number(valueCents) || 0) / 100, orgId, ids]);
  const before = Number(tot.cents) || 0;
  const off = decision === "not_gift" ? Number(inLife.cents) || 0
    : decision === "partly" ? Math.round(Number(inLife.value) * 100) || 0 : 0;
  let contacts = 0;
  if (decision === "not_gift" && ids.length) {
    const [c] = await query(`SELECT COUNT(*)::int AS n FROM donors d
        WHERE d.org_id = ? AND ${EVERYONE("d")}
          AND d.id IN (SELECT donor_id FROM gifts WHERE org_id = ? AND id = ANY(?::text[]))
          AND (d.person_types IS NULL OR d.person_types @> '["donor"]'::jsonb)
          AND COALESCE(d.imported_total, 0) <= 0
          AND NOT EXISTS (SELECT 1 FROM gifts o WHERE o.org_id = d.org_id AND o.donor_id = d.id AND ${GIFT("o")} AND o.id <> ALL(?::text[]))`,
      [orgId, orgId, ids, ids]);
    contacts = c.n;
  }
  const after = before - off;
  const usd = c => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(c / 100));
  const people = n => `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;
  const sentence = off === 0 ? `Lifetime giving stays ${usd(before)}.`
    : `Lifetime giving goes from ${usd(before)} to ${usd(after)}${contacts ? `; ${people(contacts)} would have no gifts left and become ${contacts === 1 ? "a contact" : "contacts"}` : ""}.`;
  return { decision, rows: ids.length, lifetimeBeforeCents: before, lifetimeAfterCents: after, offCents: off, contacts, sentence };
}

module.exports = { MIN_GROUP, patternOf, groupKey, groupsOf, preview };
