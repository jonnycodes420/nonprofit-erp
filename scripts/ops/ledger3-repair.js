#!/usr/bin/env node
// LEDGER-3 item 5 · THE ROWS WRITTEN BEFORE THERE WAS ONE DEFAULT FUND.
//
// LEDGER-3 stops new bad rows (shared/numbers/defaultFund.js is the only way
// code picks the org's unrestricted fund; the demo seed uses it). Rows already
// written keep the old state. For each org this lists:
//   1. gifts with no fund, which would take the org's default fund
//      (orgs.default_fund_id, else its oldest unrestricted fund), and
//   2. ledger rows for a gift whose fund differs from the gift's own fund
//      (the old seed wrote every row to General Operating while the gift sat on
//      Gala Reserve). A split gift's row names its largest line, as gifts.fund_id
//      does, so it is never listed here.
// It changes NOTHING without --apply. With --apply it sets those gifts' fund and
// those rows' fund, inside one transaction per org, and stamps the org's default
// (default_fund_by = 'system:defaultFund') the way the app does on a write,
// and writes one audit row per org with what it changed. --apply writes through
// scripts/lib/prodGuard's writerDbUrl (a remote database needs --i-know-this-is-prod).
// org_creo is never touched (the demo-tidy script owns it).
//
// Usage:
//   DATABASE_URL=… node scripts/ops/ledger3-repair.js                     # every org, a dry run
//   DATABASE_URL=… node scripts/ops/ledger3-repair.js --org=org_b72demo   # one org
//   DATABASE_URL=… node scripts/ops/ledger3-repair.js --apply [--i-know-this-is-prod]
"use strict";
const { Pool } = require("pg");
const { DEFAULT_FUND_SQL, SYSTEM } = require("../../shared/numbers/defaultFund");

const SKIP = new Set(["org_creo"]);
const ACTOR = { id: "system:ledger3-repair", name: "LEDGER-3 repair" };
const usd = c => "$" + (Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const apply = process.argv.includes("--apply");
  const one = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const url = apply ? require("../lib/prodGuard").writerDbUrl() : process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  const totals = { gifts: 0, giftCents: 0, rows: 0, rowCents: 0 };
  try {
    const orgs = (await pool.query(`SELECT id, name FROM orgs WHERE ($1::text IS NULL OR id = $1) ORDER BY id`, [one])).rows;
    for (const o of orgs) {
      if (SKIP.has(o.id)) { console.log(`${o.id}: skipped (org_creo is changed only by the demo-tidy script).`); continue; }
      const [def] = (await pool.query(`SELECT f.id, f.name FROM fin_funds f WHERE f.org_id = $1 AND f.id = ${DEFAULT_FUND_SQL("$1")}`, [o.id])).rows;
      const [nf] = (await pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS c FROM gifts g
          WHERE g.org_id = $1 AND g.fund_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM gift_fund_lines l WHERE l.gift_id = g.id AND l.org_id = g.org_id)`, [o.id])).rows;
      const off = (await pool.query(
        `SELECT ft.source, COUNT(*)::int AS n, COALESCE(SUM(ROUND(ft.amount * 100)), 0)::bigint AS c,
                string_agg(DISTINCT COALESCE(ff.name, '(no fund)') || ' → ' || COALESCE(gf.name, '(no fund)'), '; ') AS moves
           FROM fin_transactions ft JOIN gifts g ON g.id = ft.gift_id AND g.org_id = ft.org_id
           LEFT JOIN fin_funds ff ON ff.id = ft.fund_id AND ff.org_id = ft.org_id
           LEFT JOIN fin_funds gf ON gf.id = g.fund_id AND gf.org_id = g.org_id
          WHERE ft.org_id = $1 AND g.fund_id IS NOT NULL AND ft.fund_id IS DISTINCT FROM g.fund_id
            AND NOT EXISTS (SELECT 1 FROM gift_fund_lines l WHERE l.gift_id = g.id AND l.org_id = g.org_id)
          GROUP BY ft.source ORDER BY 2 DESC`, [o.id])).rows;
      const offN = off.reduce((a, r) => a + r.n, 0), offC = off.reduce((a, r) => a + Number(r.c), 0);
      if (!nf.n && !offN) continue;
      console.log(`${o.id} (${o.name}) · default fund: ${def ? `${def.name} (${def.id})` : "none (it has no unrestricted fund)"}`);
      if (nf.n) console.log(`  ${nf.n} gifts with no fund (${usd(nf.c)}) ${def ? `would take ${def.name}` : "have no default to take; left as they are"}.`);
      for (const r of off) console.log(`  ${r.n} ledger rows (source ${r.source || "none"}, ${usd(r.c)}) name another fund than their gift: ${r.moves}. Each would take its gift's fund.`);
      totals.gifts += def ? nf.n : 0; totals.giftCents += def ? Number(nf.c) : 0; totals.rows += offN; totals.rowCents += offC;
      if (!apply) continue;
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        let movedGifts = [];
        if (def) {
          await c.query(`UPDATE orgs SET default_fund_id = $2, default_fund_by = $3 WHERE id = $1 AND default_fund_id IS NULL`, [o.id, def.id, SYSTEM]);
          const g = await c.query(`UPDATE gifts g SET fund_id = $2 WHERE g.org_id = $1 AND g.fund_id IS NULL
                                     AND NOT EXISTS (SELECT 1 FROM gift_fund_lines l WHERE l.gift_id = g.id AND l.org_id = g.org_id) RETURNING g.id`, [o.id, def.id]);
          movedGifts = g.rows.map(r => r.id);
          console.log(`  applied: ${g.rowCount} gifts now on ${def.name}.`);
        }
        const r = await c.query(`UPDATE fin_transactions ft SET fund_id = g.fund_id FROM gifts g
                                  WHERE g.id = ft.gift_id AND g.org_id = ft.org_id AND ft.org_id = $1 AND g.fund_id IS NOT NULL
                                    AND ft.fund_id IS DISTINCT FROM g.fund_id
                                    AND NOT EXISTS (SELECT 1 FROM gift_fund_lines l WHERE l.gift_id = g.id AND l.org_id = g.org_id)
                                  RETURNING ft.id`, [o.id]);
        console.log(`  applied: ${r.rowCount} ledger rows now on their gift's fund.`);
        if (movedGifts.length + r.rowCount) await c.query(`INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id, changes, summary, record_count, request_method, request_path)
                       VALUES ($1,$2,$3,$4,'system','ledger3 repair','org',NULL,$5,$6,$7,'SCRIPT','scripts/ops/ledger3-repair.js')`,
          ["al_" + require("crypto").randomBytes(10).toString("hex"), o.id, ACTOR.id, ACTOR.name,
           JSON.stringify({ defaultFund: def ? def.id : null, gifts: movedGifts, ledgerRows: r.rows.map(x => x.id) }),
           `Put ${movedGifts.length} gift(s) with no fund on ${def ? def.name : "no fund"} and ${r.rowCount} ledger row(s) on their gift's fund`, movedGifts.length + r.rowCount]);
        await c.query("COMMIT");
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    }
    console.log(`\n${apply ? "Applied" : "Dry run, nothing written"}: ${totals.gifts} gifts with no fund (${usd(totals.giftCents)}), ${totals.rows} ledger rows on another fund than their gift (${usd(totals.rowCents)}).${apply ? "" : " Add --apply to change them."}`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
