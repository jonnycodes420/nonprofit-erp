// tests/lib/numbers8Checks.js · NUMBERS-8. TWO PAIRS FOR THE TRUTH CHECK.
//
//   · a fund's card and the dialog it opens (shared/numbers/fundCard.js): Balance = the dialog's
//     balance, transactions = its row count, waiting = its waiting gifts, to the cent (W-1122-Finance-F7);
//   · Gives through (shared/numbers/softThrough.js): for every person an organisation's gifts
//     credit, the person's Gives through line for that organisation = the organisation's Given
//     through row for them, and both = the rows the figure opens (W-1125-Finance-37).
"use strict";

const ORG = "(LOWER(COALESCE(o.kind, '')) IN ('organisation', 'organization') OR jsonb_exists(COALESCE(o.person_types, '[]'::jsonb), 'organization'))";

async function numbers8Checks({ orgId, get, q, agree, skip }) {
  if (skip && skip.has("numbers8")) return;
  const money = c => `$${(Number(c) / 100).toFixed(2)}`;
  const cents = v => Math.round(Number(v || 0) * 100);
  const fd = await get("/finance/funds-detail").catch(() => null);
  for (const f of (fd && fd.funds) || []) {
    const d = await get(`/finance/funds-detail/rows?fund=${encodeURIComponent(f.id)}`).catch(() => null);
    if (!d) continue;
    agree(`numbers8 fund ${f.name}: balance`, [["the fund card", f.balanceCents], ["its dialog", d.balanceCents]], money);
    agree(`numbers8 fund ${f.name}: transactions`, [["the fund card", f.transactions], ["its dialog", d.count]], String);
    if (f.waiting) agree(`numbers8 fund ${f.name}: waiting to post`, [["the fund card", f.waiting.cents], ["its dialog", d.waitingCents]], money);
  }
  const pairs = await q(
    `SELECT DISTINCT g.donor_id AS through, sc.donor_id AS person
       FROM gift_soft_credits sc JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
       JOIN donors o ON o.id = g.donor_id AND o.org_id = g.org_id AND o.deleted_at IS NULL
      WHERE sc.org_id = $1 AND g.amount > 0 AND sc.donor_id <> g.donor_id AND ${ORG}
      ORDER BY 1, 2 LIMIT 12`, [orgId]).catch(() => []);
  const rel = new Map();
  const relOf = async id => { if (!rel.has(id)) rel.set(id, await get(`/donors/${encodeURIComponent(id)}/relationships`).catch(() => null)); return rel.get(id); };
  for (const p of pairs) {
    const [mine, theirs] = [await relOf(p.person), await relOf(p.through)];
    if (!mine || !theirs) continue;
    const a = (mine.givesThrough || []).find(x => x.id === p.through);
    const b = (theirs.throughPeople || []).find(x => x.id === p.person);
    const open = await get(`/figures/gives-through/rows?donor=${encodeURIComponent(p.person)}&through=${encodeURIComponent(p.through)}&pageSize=1`).catch(() => null);
    agree(`numbers8 gives through ${p.person} via ${p.through}`, [["the person's Gives through", a ? a.cents : 0],
      ["the organisation's Given through row", b ? b.cents : 0], ["the figure's rows", open ? cents(open.value) : undefined]], money);
  }
}

module.exports = { numbers8Checks };
