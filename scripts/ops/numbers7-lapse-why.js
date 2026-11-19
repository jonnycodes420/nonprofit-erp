#!/usr/bin/env node
// NUMBERS-7 · WHY THE NIGHTLY CHECK AND THE TAGS DISAGREED ON "LAPSED", PER ORG.
//
// Nothing about Lapsed or Lapsing is stored: the tags, the Donors filters and
// Communications' "Lapsing or lapsed" segment are worked out on every read
// (donorStatus.statusSql). So there is nothing to rewrite. What changed:
//   · the nightly check (scripts/ci/check-numbers.js) now reads the tags' rule:
//     a gift refunded in full is not a last gift (FLOWS-11), and a person is
//     held by their giving unit's gifts and pledges (POLISH-4, PEOPLE-1);
//   · the tags no longer let a linked person's gift dated after today hold
//     their partner (shared/numbers/lapse.js LINK_LAST).
// This lists, for one org or every org, the people each change moves, by
// shape: ids and counts only, never a name or an amount. Run it before Ship:
// Justin's Place's two should be listed under one of the first three shapes,
// and after Ship, /ops → Check now should read 0 for them.
//
// READ ONLY: one READ ONLY session, no --apply, it writes nothing.
//
//   DATABASE_URL=… node scripts/ops/numbers7-lapse-why.js org_x     # one org
//   DATABASE_URL=… node scripts/ops/numbers7-lapse-why.js           # every org
"use strict";
const { Pool } = require("pg");
const lapseRule = require("../../lapseRule");
const L = require("../../shared/numbers/lapse");
const orgTime = require("../../orgTime");
const { isGift } = require("../../shared/numbers/money");
const { isCredit } = require("../../creditTypes");

const SHAPES = {
  refund: "the check counted a gift refunded in full as their last gift (the tags did not)",
  unitGift: "the check left out a gift from someone they give with (spouse, partner, owner, works at)",
  unitPledge: "the check left out a pledge from someone they give with",
  linkedAhead: "the tags let a linked person's gift dated after today hold them (now: it does not)",
};

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
  const only = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : null;
  const pool = new Pool({ connectionString: url, max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  // lapse.js writes `?` placeholders (db.js's form); this numbers them for pg.
  const query = (sql, args = []) => { let n = 0; return pool.query(sql.replace(/\?/g, () => `$${++n}`), args).then(r => r.rows); };
  try {
    await pool.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const orgs = await query(`SELECT id, timezone FROM orgs WHERE (?::text IS NULL OR id = ?) ORDER BY id`, [only, only]);
    let total = 0;
    for (const org of orgs) {
      const today = orgTime.orgToday(org);
      const gifts = await query(`SELECT g.donor_id, g.date, g.amount::text AS amount, g.type, g.refunded_in_full FROM gifts g
                                   JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL AND d.imported_total IS NULL
                                  WHERE g.org_id = ?`, [org.id]);
      const by = new Map();
      for (const g of gifts) (by.get(g.donor_id) || by.set(g.donor_id, []).get(g.donor_id)).push(g);
      const inputs = await L.inputsFor(query, org.id, today);
      const ownPledges = new Map([...inputs.pledges].map(([id, rs]) => [id, rs.filter(r => r.donor_id === id)]));
      const found = Object.fromEntries(Object.keys(SHAPES).map(k => [k, []]));
      const quiet = s => s === "lapsed" || s === "lapsing";
      const d10 = v => (v == null ? "" : String(v).slice(0, 10));
      for (const [id, gs] of by) {
        const dated = gs.filter(g => d10(g.date) && d10(g.date) <= today);
        const last = dated.filter(isGift).map(g => d10(g.date)).sort().pop();
        if (!last) continue;
        const now = L.stateOf(id, last, inputs);
        // The old check: any row above zero that is not a credit (a refund in full counted), own pledges only, no unit.
        const oldLast = dated.filter(g => Number(g.amount) > 0 && !isCredit(g.type)).map(g => d10(g.date)).sort().pop();
        const old = lapseRule.lapseState(oldLast, today, inputs.rhythms.get(id) || null, ownPledges.get(id) || null);
        if (quiet(old) === quiet(now) && old === now) continue;
        if (oldLast !== last) found.refund.push(id);
        else if (lapseRule.unitLast(last, inputs.linkedLast.get(id)) !== last) found.unitGift.push(id);
        else found.unitPledge.push(id);
      }
      // The tags: a linked last gift read without today (before) and with it (now).
      const linked = await query(`SELECT d.id, to_char(${L.linkedLastSql("d.id")}::date, 'YYYY-MM-DD') AS before, to_char(${L.linkedLastSql("d.id", today)}::date, 'YYYY-MM-DD') AS now
                                    FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.last_gift_date IS NOT NULL
                                     AND EXISTS (SELECT 1 FROM donor_relationships lr WHERE (lr.donor_id_a = d.id OR lr.donor_id_b = d.id)
                                                   AND lr.relationship_type IN (${L.UNIT_LINK_TYPES.map(t => `'${t}'`).join(",")}))`, [org.id]);
      for (const r of linked) if ((r.before || "") > today && r.before !== r.now) found.linkedAhead.push(r.id);
      const n = Object.values(found).reduce((s, l) => s + l.length, 0);
      if (!n && only == null) continue;
      total += n;
      console.log(`\n${org.id} (today ${today}): ${n} ${n === 1 ? "person" : "people"}`);
      for (const [k, ids] of Object.entries(found)) if (ids.length) console.log(`  ${ids.length}  ${SHAPES[k]}\n     ${ids.join(" ")}`);
    }
    console.log(`\n${total} in all (read only: nothing was changed, and nothing about Lapsed is stored to repair).`);
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
