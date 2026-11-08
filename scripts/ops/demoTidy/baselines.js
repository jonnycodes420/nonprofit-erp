// scripts/ops/demoTidy/baselines.js · DEMO-TIDY-1 item 6. THE NUMBERS MUSE CHECKS AGAINST.
//
// Each is the product's own figure, read through shared/numbers, so what this
// prints is what the screen says: Everyone (everyone.js), this fiscal year's
// giving and gift count to today (givingBetween + fiscalYearToDate), and the
// lifetime (lifetime.js) of the people Muse names.
"use strict";
const { everyoneCount } = require("../../../shared/numbers/everyone");
const { givingBetween } = require("../../../shared/numbers/givingBetween");
const { fiscalYearToDate } = require("../../../shared/numbers/fiscalYear");
const { lifetimeCents } = require("../../../shared/numbers/lifetime");

const NAMED = ["Marlowe", "Renee", "Wendell"];
const pg = sql => { let i = 0; return sql.replace(/\?/g, () => "$" + (++i)); };
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function baselines(c, orgId) {
  const q = async (s, a) => (await c.query(pg(s), a)).rows;
  const [org] = await q("SELECT * FROM orgs WHERE id = ?", [orgId]);
  const everyone = await everyoneCount(q, orgId);
  const fy = fiscalYearToDate(org);
  const g = await givingBetween(q, orgId, { from: fy.from, to: fy.to, today: fy.today });
  const people = [];
  for (const word of NAMED) {
    const rows = await q(`SELECT id, name FROM donors WHERE org_id = ? AND deleted_at IS NULL AND name ~ ? ORDER BY name, id`, [orgId, `\\m${word}\\M`]);
    const life = await lifetimeCents(q, orgId, rows.map(r => r.id));
    for (const r of rows) people.push({ word, id: r.id, name: r.name, cents: life.get(r.id) || 0 });
    if (!rows.length) people.push({ word, id: null, name: null, cents: null });
  }
  return { everyone, fy: { from: fy.from, to: fy.to, cents: g.cents, gifts: g.gifts }, people };
}

async function printBaselines(c, org, log = console.log) {
  const b = await baselines(c, org.id);
  log(`\nBaselines for Muse (${org.name})`);
  log(`  · Everyone: ${b.everyone.toLocaleString("en-US")}`);
  log(`  · This fiscal year (${b.fy.from} to ${b.fy.to}): ${usd(b.fy.cents)} in ${b.fy.gifts.toLocaleString("en-US")} gifts`);
  for (const p of b.people) log(p.id ? `  · ${p.name} (${p.id}): lifetime ${usd(p.cents)}` : `  · ${p.word}: no one by that name here`);
  return b;
}

module.exports = { baselines, printBaselines, NAMED };
