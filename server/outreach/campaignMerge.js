// server/outreach/campaignMerge.js · LETTERS-1 item 4. EACH CAMPAIGN ONCE, BY NAME.
//
// A pilot customer saw one campaign on the Campaigns page and two in Add a
// gift's picker, one of them "ANNU". Reproduced on staging (356dc03): typing
// "ANNU" beside an existing "Annual Fund" offered "+ New campaign: 'ANNU'", one
// click made it, and a campaign made from a gift has no goal, so the Campaigns
// page (goal above zero only) never showed it while the picker (every row not
// archived) always did. Nothing on the page could finish, delete or merge it.
//
//   GET  /campaign-tidy/drafts                 campaigns with no goal yet: Draft on the page, Finish or Delete
//   GET  /campaign-tidy/duplicates             groups of campaigns that share a name (case and spacing ignored)
//   POST /campaign-tidy/merge  { keepId, mergeIds }   gifts and everything else move to the one kept
//   POST /campaign-tidy/merge/:id/undo         put every row back and the merged campaigns with them
//
// A merged campaign is retired the way removal.js retires a campaign (the
// retire columns, kept on every past report), so nothing is lost and Undo is
// one press. Every moved row is remembered in campaign_merges.
// campaignKey() is the rule for "one name": case and spacing ignored.
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");
const routers = { r1: express.Router() };

// Every place a campaign is named.
const REFS = [
  { table: "gifts", word: "gifts" },
  { table: "pledges", word: "pledges" },
  { table: "recurring_subscriptions", word: "recurring gifts" },
  { table: "giving_pages", word: "giving pages" },
  { table: "grants", word: "grants" },
  { table: "events", word: "events" },
  { table: "tasks", word: "tasks" },
  { table: "appeals", word: "appeals" },
];
const campaignKey = name => String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
// SQL: the same rule, for a column.
const KEY_SQL = c => `LOWER(BTRIM(REGEXP_REPLACE(${c}, '\\s+', ' ', 'g')))`;
// A campaign that is only an email (Communications) is not offered for gifts:
// it was sent or is going, and it has no goal.
const EMAIL_ONLY = c => `(COALESCE(${c}.goal_amount, 0) <= 0 AND COALESCE(${c}.status, '') IN ('sent', 'sending', 'scheduled'))`;
// A draft: a campaign with no goal yet. Its goal and dates are set on Fundraising.
const DRAFT = c => `(COALESCE(${c}.goal_amount, 0) <= 0)`;

async function giftCounts(query, orgId, ids) {
  if (!ids.length) return new Map();
  const { GIFT } = require("../../shared/numbers/money");
  const rows = await query(`SELECT g.campaign_id AS id, COUNT(*)::int AS n FROM gifts g WHERE g.org_id = ? AND g.campaign_id = ANY(?::text[]) AND ${GIFT("g")} GROUP BY g.campaign_id`, [orgId, ids]);
  return new Map(rows.map(r => [r.id, Number(r.n) || 0]));
}

async function mergeInTx(client, L, who, id, { queryTx, runTx }) {
  const split = {}, moved = {};
  for (const r of REFS) {
    let rows;
    await runTx(client, "SAVEPOINT cmp_ref");
    try {
      rows = await queryTx(client, `SELECT id::text AS k, campaign_id AS c FROM ${r.table} WHERE org_id = ? AND campaign_id = ANY(?::text[]) FOR UPDATE`, [L.orgId, L.mergeIds]);
      await runTx(client, "RELEASE SAVEPOINT cmp_ref");
    } catch (e) { await runTx(client, "ROLLBACK TO SAVEPOINT cmp_ref"); if (e.code === "42P01" || e.code === "42703") continue; throw e; }
    if (!rows.length) continue;
    split[r.table] = {};
    for (const x of rows) (split[r.table][x.c] = split[r.table][x.c] || []).push(x.k);
    moved[r.table] = rows.length;
    await runTx(client, `UPDATE ${r.table} SET campaign_id = ? WHERE org_id = ? AND campaign_id = ANY(?::text[])`, [L.keepId, L.orgId, L.mergeIds]);
  }
  // The gift's campaign name travels with it where a row keeps one.
  await runTx(client, "SAVEPOINT cmp_name");
  try { await runTx(client, `UPDATE gifts SET campaign = ? WHERE org_id = ? AND campaign_id = ? AND campaign IS DISTINCT FROM ?`, [L.keep.name, L.orgId, L.keepId, L.keep.name]); await runTx(client, "RELEASE SAVEPOINT cmp_name"); }
  catch { await runTx(client, "ROLLBACK TO SAVEPOINT cmp_name"); }
  // Retired as removal.js retires a campaign: kept on every past report, never offered again.
  await runTx(client, "UPDATE campaigns SET retired_at = NOW(), retired_by = ?, retired_by_name = ? WHERE org_id = ? AND id = ANY(?::text[]) AND retired_at IS NULL",
    [who.id, who.name, L.orgId, L.mergeIds]);
  await runTx(client, `INSERT INTO campaign_merges (id, org_id, keep_id, merged_ids, detail, moved, created_by, created_by_name)
                       VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?)`,
    [id, L.orgId, L.keepId, JSON.stringify(L.mergeIds), JSON.stringify({ keep: { id: L.keep.id, name: L.keep.name }, merged: L.merged.map(c => ({ id: c.id, name: c.name })), split }),
     JSON.stringify(moved), who.id, who.name]);
  return { moved };
}

async function undoInTx(client, orgId, m, who, { runTx }) {
  const detail = typeof m.detail === "string" ? JSON.parse(m.detail) : m.detail;
  const split = (detail && detail.split) || {};
  for (const r of REFS) {
    for (const [cid, keys] of Object.entries(split[r.table] || {})) {
      if (keys.length) await runTx(client, `UPDATE ${r.table} SET campaign_id = ? WHERE org_id = ? AND id::text = ANY(?::text[]) AND campaign_id = ?`, [cid, orgId, keys, m.keep_id]);
    }
  }
  for (const c of (detail && detail.merged) || []) {
    const keys = (split.gifts || {})[c.id] || [];
    if (keys.length) await runTx(client, "UPDATE gifts SET campaign = ? WHERE org_id = ? AND id = ANY(?::text[])", [c.name, orgId, keys]).catch(() => {});
  }
  const ids = typeof m.merged_ids === "string" ? JSON.parse(m.merged_ids) : m.merged_ids;
  await runTx(client, "UPDATE campaigns SET retired_at = NULL, retired_by = NULL, retired_by_name = NULL WHERE org_id = ? AND id = ANY(?::text[])", [orgId, ids]);
  await runTx(client, "UPDATE campaign_merges SET undone_at = NOW(), undone_by = ?, undone_by_name = ? WHERE id = ? AND org_id = ?", [who.id, who.name, m.id, orgId]);
}

// Merge, for the route and for scripts/ops/campaign-duplicates.js: one path.
async function mergeCampaigns({ query, withTransaction, queryTx, runTx }, orgId, keepId, mergeIds, who) {
  const ids = [...new Set(mergeIds.map(String))].filter(x => x && x !== keepId).slice(0, 20);
  if (!keepId || !ids.length) return { status: 400, body: { error: "pick_campaigns", sentence: "Pick the campaign to keep and at least one to merge into it." } };
  const rows = await query("SELECT id, name, goal_amount, created_at FROM campaigns WHERE org_id = ? AND id = ANY(?::text[]) AND retired_at IS NULL", [orgId, [keepId, ...ids]]);
  const keep = rows.find(r => r.id === keepId), merged = rows.filter(r => ids.includes(r.id));
  if (!keep || merged.length !== ids.length) return { status: 404, body: { error: "not_found", sentence: "One of those campaigns is not one of yours, or was already merged." } };
  const id = newId("cmg");
  const { moved } = await withTransaction(client => mergeInTx(client, { orgId, keep, merged, keepId, mergeIds: ids }, who, id, { queryTx, runTx }));
  const giftsMoved = moved.gifts || 0;
  return { status: 200, body: { mergeId: id, keep: { id: keep.id, name: keep.name }, merged: merged.map(c => ({ id: c.id, name: c.name })), moved,
    sentence: `Merged ${merged.map(c => `"${c.name}"`).join(", ")} into "${keep.name}". ${giftsMoved} ${giftsMoved === 1 ? "gift" : "gifts"} moved; the merged ${merged.length === 1 ? "campaign is" : "campaigns are"} retired, kept on past reports.`,
    undo: { method: "POST", path: `/campaign-tidy/merge/${id}/undo` } } };
}

function mount(ctx) {
  const { query, requireAuth, requireAdmin, checkWriteAccess, wrap, actor } = ctx;
  const { withTransaction, runTx, queryTx } = require("../../db");
  const app = routers.r1;
  const who = req => ({ id: actor(req).id, name: actor(req).name });

  app.get("/campaign-tidy/drafts", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const rows = await query(
      `SELECT c.id, c.name, c.created_at, c.created_by_name FROM campaigns c
        WHERE c.org_id = ? AND c.retired_at IS NULL AND ${DRAFT("c")} AND NOT ${EMAIL_ONLY("c")}
          AND COALESCE(c.subject, '') = '' AND c.is_sample IS NOT TRUE
        ORDER BY c.created_at DESC LIMIT 200`, [orgId]);
    const counts = await giftCounts(query, orgId, rows.map(r => r.id));
    res.json({
      drafts: rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at, createdBy: r.created_by_name || null, gifts: counts.get(r.id) || 0 })),
      sentence: "A draft is a campaign with no goal yet, often one made from Add a gift. Finish it by giving it a goal, merge it into the campaign it meant, or delete it.",
    });
  }));

  app.get("/campaign-tidy/duplicates", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const rows = await query(
      `SELECT c.id, c.name, c.created_at, ${DRAFT("c")} AS draft, ${KEY_SQL("c.name")} AS k FROM campaigns c
        WHERE c.org_id = ? AND c.retired_at IS NULL AND NOT ${EMAIL_ONLY("c")}
          AND ${KEY_SQL("c.name")} IN (SELECT ${KEY_SQL("x.name")} FROM campaigns x WHERE x.org_id = ? AND x.retired_at IS NULL GROUP BY 1 HAVING COUNT(*) > 1)
        ORDER BY k, draft, c.created_at`, [orgId, orgId]);
    const counts = await giftCounts(query, orgId, rows.map(r => r.id));
    const groups = new Map();
    for (const r of rows) (groups.get(r.k) || groups.set(r.k, []).get(r.k)).push({ id: r.id, name: r.name, draft: !!r.draft, createdAt: r.created_at, gifts: counts.get(r.id) || 0 });
    res.json({ groups: [...groups.values()].map(list => ({ keep: list[0].id, campaigns: list })) });
  }));

  app.post("/campaign-tidy/merge", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
    const keepId = String(req.body?.keepId || "");
    const mergeIds = Array.isArray(req.body?.mergeIds) ? req.body.mergeIds : [];
    const r = await mergeCampaigns({ query, withTransaction, queryTx, runTx }, req.user.orgId, keepId, mergeIds, who(req));
    if (r.status === 200 && req.audit) {
      req.audit.entity("campaign", r.body.keep.id, r.body.keep.name);
      req.audit.action(`merged ${r.body.merged.map(c => c.name).join(", ")} into ${r.body.keep.name}`);
      req.audit.after({ mergeId: r.body.mergeId, moved: r.body.moved });
    }
    res.status(r.status).json(r.body);
  }));

  app.post("/campaign-tidy/merge/:id/undo", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const [m] = await query("SELECT * FROM campaign_merges WHERE id = ? AND org_id = ?", [req.params.id, orgId]);
    if (!m) return res.status(404).json({ error: "not_found", sentence: "That merge is not on file." });
    if (m.undone_at) return res.status(409).json({ error: "already_undone", sentence: "That merge was already undone." });
    await withTransaction(client => undoInTx(client, orgId, m, who(req), { queryTx, runTx }));
    if (req.audit) { req.audit.entity("campaign", m.keep_id, "a campaign"); req.audit.action("undid a campaign merge"); }
    res.json({ ok: true, sentence: "The merge is undone: every row is back on its own campaign." });
  }));
}

module.exports = { routers, mount, mergeCampaigns, campaignKey, KEY_SQL, EMAIL_ONLY, DRAFT, REFS };
