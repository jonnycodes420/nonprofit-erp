// server/atlas/moreRows.js · ATLAS-11 item 3. TELL ME MORE ADDS SOMETHING.
//
// Jarvis (25 Nov): "Tell me more adds nothing." After a number it said "There's
// nothing more behind my last answer", and after a list it drew the same ten
// people again. Now it goes on from the answer:
//   a goal's figure   the gifts behind "raised", by giver, largest first: the
//                     figure's own rows (figureSources.js allRows, the rows the
//                     figure opens on Home), footing to the cent to what it said.
//   a long list       the next ten people of it, each with their lifetime
//                     (periodAmounts.lifetimeCents, the profile's rule).
// null when there is nothing more of either; the caller says so.
"use strict";

const SHOWN = 10;
const usd = cents => require("../../money").formatCentsPlain(Math.round(Number(cents) || 0));

async function moreRows(prior, { query, orgId }) {
  if (!prior) return null;
  if (prior.type === "figure" && prior.sources && prior.sources.raised) {
    const rows = await require("../../figureSources").allRows(orgId, prior.sources.raised, {}).catch(() => null);
    if (!rows) return null;
    const by = new Map();
    for (const r of rows) {
      const cents = Math.round(Number(r.amount) * 100) || 0;
      const k = r.donorId || `name:${r.name || r.detail || "other"}`;
      const x = by.get(k) || { donorId: r.donorId || null, name: r.name || r.detail || "Other", cents: 0, n: 0 };
      x.cents += cents; if (cents > 0) x.n++;
      by.set(k, x);
    }
    const all = [...by.values()].filter(x => x.cents !== 0).sort((a, b) => b.cents - a.cents || String(a.name).localeCompare(String(b.name)));
    if (!all.length) return { line: "No gift is counted toward it yet, so there are no rows behind that figure." };
    const shown = all.slice(0, SHOWN);
    const totalCents = all.reduce((t, x) => t + x.cents, 0);
    const shownCents = shown.reduce((t, x) => t + x.cents, 0);
    const gifts = all.reduce((t, x) => t + x.n, 0);
    const people = shown.filter(x => x.donorId).map(x => ({ donorId: x.donorId, name: x.name, cents: x.cents, atStake: usd(x.cents), reason: `${x.n} ${x.n === 1 ? "gift" : "gifts"} to it.` }));
    return {
      line: `Behind that ${usd(totalCents)}: ${gifts.toLocaleString("en-US")} ${gifts === 1 ? "gift" : "gifts"} from ${all.length.toLocaleString("en-US")} ${all.length === 1 ? "giver" : "givers"}. `
        + (all.length > shown.length ? `The ${shown.length} largest gave ${usd(shownCents)} of it.` : "Each of them, largest first."),
      answer: { type: "why", key: "figure_rows", count: all.length, more: Math.max(0, all.length - shown.length), people, totalCents: shownCents, total: usd(shownCents),
        ids: all.filter(x => x.donorId).map(x => x.donorId), stakeWord: "given to it",
        definition: "The gifts the figure counts (its own rows), added by giver. The total is the sum of the givers shown." },
    };
  }
  if (prior.type === "list" && Array.isArray(prior.ids) && prior.ids.length > (prior.offset || 0) + (prior.people || []).length) {
    const from = (prior.offset || 0) + (prior.people || []).length;
    const next = prior.ids.slice(from, from + SHOWN);
    const names = new Map((await query(`SELECT id, name FROM donors WHERE org_id = ? AND id = ANY(?::text[])`, [orgId, next])).map(r => [r.id, r.name]));
    const life = await require("../../shared/numbers/periodAmounts").lifetimeCents(query, orgId, next).catch(() => new Map());
    const people = next.filter(id => names.has(id)).map(id => ({ donorId: id, name: names.get(id), reason: `Lifetime ${usd(life.get(id) || 0)}`, lifetime: `Lifetime ${usd(life.get(id) || 0)}` }));
    const count = prior.count || prior.ids.length;
    return {
      line: `Here are the next ${people.length} of the ${count.toLocaleString("en-US")} (${from + 1} to ${from + people.length}). Open list has every one of them.`,
      answer: { ...prior, people, offset: from, more: Math.max(0, count - from - people.length) },
    };
  }
  return null;
}

module.exports = { moreRows };
