// server/finance/fundMerge.js · TRUTH-3 item 5. FUNDS ARE A MANAGED LIST.
//
// The fleet (W-1107-Fundraising-09) found "General" beside "General
// Operating" and "Building" beside "Building Fund" as separate lines on every
// screen. The rule (the way established CRMs keep a designation list): an
// admin merges near-duplicate funds. She picks the fund to keep, sees what
// will move (gifts, gift lines, ledger rows, giving pages, recurring gifts,
// grants and the rest), and confirms. The retired funds keep their rows in
// fin_funds (retired_at), their names become the keeper's aliases, and every
// moved row is remembered in fund_merges, so Undo puts each one back exactly.
// The audit row is the middleware's (middleware/auditTrail.js); this module
// only says what it was (req.audit.*).
//
//   GET  /finance/funds/near-duplicates             pairs whose names are one fund in different words
//   POST /finance/funds/merge/preview  { keeperId, mergeIds }   what will move, counted
//   POST /finance/funds/merge          { keeperId, mergeIds }   do it; returns { mergeId }
//   POST /finance/funds/merge/:id/undo                          put everything back
//
// fundKey() is the rule for "the same fund in other words" (case, spacing,
// punctuation, and the words "fund" and "operating"); imports ask before
// creating a fund whose key matches an existing one (closeFund()).
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");

const routers = { r1: express.Router() };

// Every place a fund is named, and the id column that names the row.
const REFS = [
  { table: "gifts", col: "fund_id", key: "id", word: "gifts" },
  { table: "gift_fund_lines", col: "fund_id", key: "id", word: "gift lines" },
  { table: "fin_transactions", col: "fund_id", key: "id", word: "ledger rows" },
  { table: "giving_pages", col: "fund_id", key: "id", word: "giving pages" },
  { table: "recurring_subscriptions", col: "fund_id", key: "id", word: "recurring gifts" },
  { table: "grants", col: "fund_id", key: "id", word: "grants" },
  { table: "opportunities", col: "fund_id", key: "id", word: "asks" },
  { table: "budgets", col: "fund_id", key: "id", word: "budget lines" },
  { table: "giving_sources", col: "default_fund_id", key: "id", word: "giving sources" },
  { table: "recurring_proposals", col: "proposed_fund_id", key: "id", word: "recurring proposals" },
  { table: "old_report_fund_maps", col: "fund_id", key: "id", word: "report mappings" },
  { table: "qbo_read_lines", col: "fund_id", key: "id", word: "QuickBooks lines" },
  { table: "capture_fund_words", col: "fund_id", key: "phrase", word: "memo words" },
];

// "General Operating Fund", "general", "General  Operating" → "general".
function fundKey(name) {
  return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(fund|funds|operating|operations|the)\b/g, " ").replace(/\s+/g, " ").trim();
}

// The live (not retired) fund whose name is this one in other words, or null.
async function closeFund(query, orgId, name) {
  const k = fundKey(name);
  if (!k) return null;
  const rows = await query("SELECT id, name FROM fin_funds WHERE org_id = ? AND retired_at IS NULL", [orgId]);
  return rows.find(r => fundKey(r.name) === k && String(r.name).trim().toLowerCase() !== String(name).trim().toLowerCase()) || null;
}

async function liveFunds(query, orgId, ids) {
  return query("SELECT * FROM fin_funds WHERE org_id = ? AND id = ANY(?::text[]) AND retired_at IS NULL", [orgId, ids]);
}

// What a merge would move: { counts: { table: n }, words: "12 gifts, 2 giving pages", total }.
async function preview(query, orgId, mergeIds) {
  const counts = {};
  for (const r of REFS) {
    const [c] = await query(`SELECT COUNT(*)::int AS n FROM ${r.table} WHERE org_id = ? AND ${r.col} = ANY(?::text[])`, [orgId, mergeIds]).catch(() => [{ n: 0 }]);
    counts[r.table] = Number(c && c.n) || 0;
  }
  const [o] = await query("SELECT COUNT(*)::int AS n FROM orgs WHERE id = ? AND default_fund_id = ANY(?::text[])", [orgId, mergeIds]).catch(() => [{ n: 0 }]);
  counts.orgs = Number(o && o.n) || 0;
  const [money] = await query(`SELECT COALESCE(SUM(amount), 0)::text AS s FROM gifts WHERE org_id = ? AND fund_id = ANY(?::text[])`, [orgId, mergeIds]);
  const parts = REFS.filter(r => counts[r.table]).map(r => `${counts[r.table].toLocaleString("en-US")} ${r.word}`);
  if (counts.orgs) parts.push("the default fund");
  return { counts, giftCents: Math.round(Number(money.s) * 100), words: parts.length ? parts.join(", ") : "nothing", total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

function check(body) {
  const keeperId = String((body && body.keeperId) || "");
  const mergeIds = [...new Set((Array.isArray(body && body.mergeIds) ? body.mergeIds : []).map(String))].filter(id => id && id !== keeperId).slice(0, 20);
  return { keeperId, mergeIds };
}

function mount(ctx) {
  const { query, requireAuth, requireAdmin, checkWriteAccess, wrap, actor } = ctx;
  const { withTransaction, runTx, queryTx } = require("../../db");
  const app = routers.r1;
  const admin = requireAdmin || ((req, res, next) => next());
  const gate = checkWriteAccess || ((req, res, next) => next());

  async function load(req, res) {
    const orgId = req.user.orgId;
    const { keeperId, mergeIds } = check(req.body);
    if (!keeperId || !mergeIds.length) { res.status(400).json({ error: "pick_funds", sentence: "Pick the fund to keep and at least one fund to merge into it." }); return null; }
    const [keeper] = await liveFunds(query, orgId, [keeperId]);
    const merged = await liveFunds(query, orgId, mergeIds);
    if (!keeper || merged.length !== mergeIds.length) { res.status(404).json({ error: "fund_not_found", sentence: "One of those funds is not one of yours, or was already merged." }); return null; }
    if (merged.some(f => !!f.restricted !== !!keeper.restricted)) {
      res.status(409).json({ error: "restriction_differs", sentence: `${keeper.name} is ${keeper.restricted ? "restricted" : "unrestricted"}, and ${merged.find(f => !!f.restricted !== !!keeper.restricted).name} is not. Restricted and unrestricted money are never merged.` });
      return null;
    }
    return { orgId, keeper, merged, keeperId, mergeIds };
  }

  // Pairs of live funds whose names are one fund in other words.
  app.get("/finance/funds/near-duplicates", requireAuth, wrap(async (req, res) => {
    const rows = await query("SELECT id, name, restricted FROM fin_funds WHERE org_id = ? AND retired_at IS NULL ORDER BY created_at, id", [req.user.orgId]);
    const by = new Map();
    for (const r of rows) { const k = fundKey(r.name); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    const groups = [...by.values()].filter(g => g.length > 1).map(g => ({ funds: g, sentence: `${[...new Set(g.map(f => `"${f.name}"`))].join(" and ")} look like one fund${new Set(g.map(f => f.name)).size < g.length ? " (two of them share a name)" : ""}.` }));
    res.json({ groups, definition: "Two funds are one fund in other words when their names match after case, spacing, punctuation and the words \"Fund\" and \"Operating\" are set aside." });
  }));

  app.post("/finance/funds/merge/preview", requireAuth, admin, wrap(async (req, res) => {
    const L = await load(req, res); if (!L) return;
    const p = await preview(query, L.orgId, L.mergeIds);
    res.json({ keeper: { id: L.keeper.id, name: L.keeper.name }, merging: L.merged.map(f => ({ id: f.id, name: f.name })), ...p,
      sentence: `${L.merged.map(f => f.name).join(" and ")} will merge into ${L.keeper.name}: ${p.words} will move. You can undo it.` });
  }));

  app.post("/finance/funds/merge", requireAuth, admin, gate, wrap(async (req, res) => {
    const L = await load(req, res); if (!L) return;
    const who = actor(req);
    const id = newId("fm");
    const moved = {};
    const p = await preview(query, L.orgId, L.mergeIds);
    const split = {};
    await withTransaction(async client => {
      for (const r of REFS) {
        // Which merged fund each row named, read inside the transaction, so Undo puts each back on its own fund.
        let rows;
        try {
          rows = await queryTx(client, `SELECT ${r.key}::text AS k, ${r.col} AS f FROM ${r.table} WHERE org_id = ? AND ${r.col} = ANY(?::text[]) FOR UPDATE`, [L.orgId, L.mergeIds]);
        } catch (e) { if (e.code === "42P01" || e.code === "42703") continue; throw e; }
        if (!rows.length) continue;
        split[r.table] = {};
        for (const x of rows) (split[r.table][x.f] = split[r.table][x.f] || []).push(x.k);
        moved[r.table] = rows.length;
        await runTx(client, `UPDATE ${r.table} SET ${r.col} = ? WHERE org_id = ? AND ${r.col} = ANY(?::text[])`, [L.keeperId, L.orgId, L.mergeIds]);
      }
      const [o] = await queryTx(client, "SELECT default_fund_id FROM orgs WHERE id = ?", [L.orgId]);
      if (o && L.mergeIds.includes(o.default_fund_id)) {
        moved.orgs = [o.default_fund_id];
        await runTx(client, "UPDATE orgs SET default_fund_id = ? WHERE id = ?", [L.keeperId, L.orgId]);
      }
      const prior = Array.isArray(L.keeper.aliases) ? L.keeper.aliases : [];
      const aliases = [...new Set([...prior, ...L.merged.map(f => f.name)])].slice(0, 25);
      await runTx(client, "UPDATE fin_funds SET aliases = ?::jsonb WHERE id = ? AND org_id = ?", [JSON.stringify(aliases), L.keeperId, L.orgId]);
      await runTx(client, "UPDATE fin_funds SET retired_at = NOW(), retired_by = ?, retired_by_name = ? WHERE org_id = ? AND id = ANY(?::text[])",
        [who.id, who.name, L.orgId, L.mergeIds]);
      await runTx(client, `INSERT INTO fund_merges (id, org_id, keeper_id, merged_ids, funds, moved, created_by, created_by_name)
                           VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?)`,
        [id, L.orgId, L.keeperId, JSON.stringify(L.mergeIds), JSON.stringify({ keeper: L.keeper, merged: L.merged, split }), JSON.stringify(moved), who.id, who.name]);
    });
    req.audit && req.audit.entity("fund", L.keeperId, L.keeper.name);
    req.audit && req.audit.action(`merged ${L.merged.map(f => f.name).join(", ")} into ${L.keeper.name}`);
    req.audit && req.audit.before({ funds: L.merged.map(f => ({ id: f.id, name: f.name })), counts: p.counts });
    req.audit && req.audit.after({ keeper: L.keeper.id, mergeId: id });
    res.json({ ok: true, mergeId: id, moved: p.counts, sentence: `Merged ${L.merged.map(f => f.name).join(" and ")} into ${L.keeper.name}: ${p.words} moved.`, undo: `/finance/funds/merge/${id}/undo` });
  }));

  app.post("/finance/funds/merge/:id/undo", requireAuth, admin, gate, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const [m] = await query("SELECT * FROM fund_merges WHERE id = ? AND org_id = ?", [String(req.params.id), orgId]);
    if (!m) return res.status(404).json({ error: "not_found", sentence: "That merge is not one of yours." });
    if (m.undone_at) return res.status(409).json({ error: "already_undone", sentence: "That merge was already undone." });
    const funds = typeof m.funds === "string" ? JSON.parse(m.funds) : m.funds;
    const moved = typeof m.moved === "string" ? JSON.parse(m.moved) : m.moved;
    const split = (funds && funds.split) || {};
    const who = actor(req);
    await withTransaction(async client => {
      for (const r of REFS) {
        const s = split[r.table] || {};
        for (const [fundId, keys] of Object.entries(s)) {
          if (keys.length) await runTx(client, `UPDATE ${r.table} SET ${r.col} = ? WHERE org_id = ? AND ${r.key} = ANY(?::text[]) AND ${r.col} = ?`, [fundId, orgId, keys, m.keeper_id]);
        }
      }
      if (moved.orgs && moved.orgs.length) await runTx(client, "UPDATE orgs SET default_fund_id = ? WHERE id = ? AND default_fund_id = ?", [moved.orgs[0], orgId, m.keeper_id]);
      const keeper = funds.keeper || {};
      await runTx(client, "UPDATE fin_funds SET aliases = ?::jsonb WHERE id = ? AND org_id = ?",
        [Array.isArray(keeper.aliases) && keeper.aliases.length ? JSON.stringify(keeper.aliases) : null, m.keeper_id, orgId]);
      const ids = typeof m.merged_ids === "string" ? JSON.parse(m.merged_ids) : m.merged_ids;
      await runTx(client, "UPDATE fin_funds SET retired_at = NULL, retired_by = NULL, retired_by_name = NULL WHERE org_id = ? AND id = ANY(?::text[])", [orgId, ids]);
      await runTx(client, "UPDATE fund_merges SET undone_at = NOW(), undone_by = ?, undone_by_name = ? WHERE id = ? AND org_id = ?", [who.id, who.name, m.id, orgId]);
    });
    req.audit && req.audit.entity("fund", m.keeper_id, (funds.keeper && funds.keeper.name) || "a fund");
    req.audit && req.audit.action("undid a fund merge");
    res.json({ ok: true, sentence: `Undone: ${((funds.merged || []).map(f => f.name)).join(" and ")} ${((funds.merged || []).length === 1) ? "is" : "are"} back, with every row that moved.` });
  }));

  return { fundKey, closeFund: (orgId, name) => closeFund(query, orgId, name) };
}

module.exports = { routers, mount, fundKey, closeFund, preview, REFS };
