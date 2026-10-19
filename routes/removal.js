// routes/removal.js · FIX-41. THE ONE REMOVE, for every list that takes an add.
//
//   GET  /removals/:kind/:id          what removing it would do: the plan and
//                                     the confirm, in words (a GET; writes nothing)
//   POST /removals/:kind/plan         the same for several ids at once
//   POST /removals/:kind/:id          do it (retire, archive, delete or unassign)
//   POST /removals/:kind              several at once, ONE Undo
//   POST /removals/undo               put back exactly what was there
//
// The volunteer kinds answer under /volunteer-hub/removals too, because a
// volunteer coordinator reaches only the volunteer surfaces (auth.js).
//
// Every write goes through the one audit write like any route; this file only
// improves the row (req.audit.*). Every change is recorded in deleted_records,
// the trash Undo already reads: a delete keeps the whole row there, a retire,
// archive or unassign keeps what the columns were, so Undo is exact either way.
// No route here refunds, emails, charges or touches a payment.
const express = require("express");
const R = require("../removal");

const routers = { r0: express.Router() };
const VOLUNTEER_KINDS = new Set(["volunteer_role", "shift", "volunteer_signup"]);
// FIX-45: the toast offers Undo for a minute (the walk lost three Undos to ten
// seconds); Recent changes keeps it for as long as the row sits in the trash.
const UNDO_SECONDS = 60;
const BULK_MAX = 200;

// What a retire / archive / unassign writes, and the columns Undo restores.
const SOFT = {
  retire: K => K.table === "membership_levels"
    ? { cols: ["retired_at", "retired_by", "retired_by_name", "active"], set: who => ["NOW()", who.id, who.name, false] }
    : K.table === "volunteer_opportunities"
      ? { cols: ["archived_at", "retired_by", "retired_by_name"], set: who => ["NOW()", who.id, who.name] }
      // A shift is retired by the column every volunteer read already
      // honours. Unlike the old bulk Delete, its sign-ups are kept.
      : K.table === "volunteer_slots"
        ? { cols: ["cancelled_at", "retired_by", "retired_by_name"], set: who => ["NOW()", who.id, who.name] }
      : { cols: ["retired_at", "retired_by", "retired_by_name"], set: who => ["NOW()", who.id, who.name] },
  archive: K => K.table === "volunteer_opportunities"
    ? { cols: ["archived_at"], set: () => ["NOW()"] }
    : { cols: ["status"], set: () => ["archived"] },
  unassign: () => ({ cols: ["unassigned_at", "updated_at"], set: () => ["clock_timestamp()", "NOW()"] }),
};

// What goes with a deleted row, and how it comes back (the TRASH_WITH idea
// in routes/crm.js, for the tables this file deletes from).
const WITH = {
  event_tables: {
    take: async (tx, ctx, row, orgId) => {
      const moved = await ctx.queryTx(tx, `UPDATE event_attendees SET table_id=NULL, table_label=NULL, seat_no=NULL
                                            WHERE table_id=? AND org_id=? RETURNING id, seat_no`, [row.id, orgId]);
      return { seated: moved.map(m => m.id) };
    },
    give: async (tx, ctx, w, row, orgId) => {
      if (w && Array.isArray(w.seated) && w.seated.length)
        await ctx.runTx(tx, `UPDATE event_attendees SET table_id=?, table_label=? WHERE id = ANY(?) AND org_id=? AND table_id IS NULL`,
          [row.id, row.label, w.seated, orgId]);
    },
  },
  volunteer_opportunities: {
    take: async (tx, ctx, row, orgId) => ({
      slots: await ctx.queryTx(tx, `SELECT * FROM volunteer_slots WHERE opportunity_id=? AND org_id=?`, [row.id, orgId]),
      roles: await ctx.queryTx(tx, `SELECT r.* FROM volunteer_slot_roles r JOIN volunteer_slots s ON s.id=r.slot_id WHERE s.opportunity_id=? AND r.org_id=?`, [row.id, orgId]),
    }),
    give: async (tx, ctx, w) => {
      if (w?.slots?.length) await ctx.runTx(tx, `INSERT INTO volunteer_slots SELECT * FROM jsonb_populate_recordset(NULL::volunteer_slots, ?::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(w.slots)]);
      if (w?.roles?.length) await ctx.runTx(tx, `INSERT INTO volunteer_slot_roles SELECT * FROM jsonb_populate_recordset(NULL::volunteer_slot_roles, ?::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(w.roles)]);
    },
  },
  volunteer_slots: {
    take: async (tx, ctx, row, orgId) => ({
      roles: await ctx.queryTx(tx, `SELECT * FROM volunteer_slot_roles WHERE slot_id=? AND org_id=?`, [row.id, orgId]),
    }),
    give: async (tx, ctx, w) => {
      if (w?.roles?.length) await ctx.runTx(tx, `INSERT INTO volunteer_slot_roles SELECT * FROM jsonb_populate_recordset(NULL::volunteer_slot_roles, ?::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(w.roles)]);
    },
  },
  campaigns: {
    take: async (tx, ctx, row, orgId) => ({
      recipients: await ctx.queryTx(tx, `SELECT * FROM campaign_recipients WHERE campaign_id=? AND org_id=?`, [row.id, orgId]),
    }),
    give: async (tx, ctx, w) => {
      if (w?.recipients?.length) await ctx.runTx(tx, `INSERT INTO campaign_recipients SELECT * FROM jsonb_populate_recordset(NULL::campaign_recipients, ?::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(w.recipients)]);
    },
  },
};

// FIX-45: a removed row's photos come back with it. While the row sat in the
// trash nothing pointed at its pictures, so a prune of their kind may have put
// them into the 90-day retention window (deleted_at set, bytes kept). Undo
// clears that mark for every asset the restored row names, in this org only.
const ASSET_IDS = /pa_[a-f0-9]{24}/g;
async function bringBackAssets(tx, runTx, orgId, data) {
  const ids = [...new Set(JSON.stringify(data || {}).match(ASSET_IDS) || [])];
  if (!ids.length) return 0;
  return runTx(tx, `UPDATE portal_assets SET deleted_at = NULL WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NOT NULL`, [orgId, ids]);
}
function mount(ctx) {
  const { actor, checkWriteAccess, query, queryTx, requireAuth, run, runTx, uuid, withTransaction, wrap, itemStates } = ctx;
  const app = routers.r0;

  // A coordinator removes only what they can edit: the volunteer kinds, and
  // only under their own surface. An admin-only kind needs an admin, the same
  // as its edit route.
  async function mayRemove(req, K, kind) {
    if (req.user.role === "volunteer_coordinator" && !VOLUNTEER_KINDS.has(kind)) return false;
    if (K.admin) {
      const [u] = await query("SELECT role FROM users WHERE id=?", [req.user.userId]);
      if (!u || u.role !== "admin") return false;
    }
    return true;
  }

  // The winner's name, for "Remove the winner of …": read through the same
  // ordering every auction screen uses.
  async function extraFor(kind, orgId, id) {
    if (kind !== "auction_winner") return {};
    const [it] = await query("SELECT auction_id FROM auction_items WHERE id=? AND org_id=?", [id, orgId]);
    if (!it) return {};
    const st = (await itemStates(query, orgId, it.auction_id)).find(s => s.id === id);
    return { winner: st && st.bid_id ? st.bidder_name : null, hasWinner: !!(st && st.bid_id) };
  }

  async function planFor(req, kind, id) {
    const K = R.kindOf(kind);
    if (!K) return { status: 404, body: { error: "unknown_kind" } };
    if (!(await mayRemove(req, K, kind))) return { status: 403, body: { error: "not_allowed", message: `You can see this ${K.noun}, but removing it is for someone who can edit it.` } };
    const extra = await extraFor(kind, req.user.orgId, id);
    const p = await R.plan(query, kind, req.user.orgId, String(id), extra);
    if (p.error === "not_found") return { status: 404, body: { error: "not_found" } };
    if (kind === "auction_winner" && !extra.hasWinner && p.mode !== "refuse")
      return { status: 409, body: { error: "no_winner", message: "This item has no winner to remove." } };
    return { status: 200, plan: p, K };
  }
  const shape = p => ({ kind: p.kind, id: p.id, mode: p.mode, name: p.name, attached: p.attached, title: p.title, body: p.body, yes: p.yes });

  // ONE ROW OUT. Inside the caller's transaction. Returns the trash id.
  async function applyOne(tx, req, p, K) {
    const orgId = req.user.orgId, who = actor(req);
    const trashId = "del_" + uuid().slice(0, 12);
    const [row] = await queryTx(tx, `SELECT * FROM ${K.table} WHERE id=? AND org_id=? FOR UPDATE`, [p.id, orgId]);
    if (!row) return null;
    if (p.mode === "delete") {
      const w = WITH[K.table] ? await WITH[K.table].take(tx, ctx, row, orgId) : null;
      await runTx(tx, `INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name)
                       SELECT ?, ?, ?, ?, to_jsonb(t) || ?::jsonb, ?, ? FROM ${K.table} t WHERE t.id=? AND t.org_id=?`,
        [trashId, orgId, K.table, p.id, JSON.stringify({ __with: w, __removal: p.kind }), who.id, who.name, p.id, orgId]);
      await runTx(tx, `DELETE FROM ${K.table} WHERE id=? AND org_id=?`, [p.id, orgId]);
      return trashId;
    }
    const soft = SOFT[p.mode](K);
    const prev = {};
    for (const c of soft.cols) prev[c] = row[c] === undefined ? null : row[c];
    const vals = soft.set(who);
    const sets = soft.cols.map((c, i) => `${c} = ${vals[i] === "NOW()" || vals[i] === "clock_timestamp()" ? vals[i] : "?"}`);
    const args = vals.filter(v => v !== "NOW()" && v !== "clock_timestamp()");
    await runTx(tx, `UPDATE ${K.table} SET ${sets.join(", ")} WHERE id=? AND org_id=?`, [...args, p.id, orgId]);
    await runTx(tx, `INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name)
                     VALUES (?,?,?,?,?::jsonb,?,?)`,
      [trashId, orgId, "removal:" + p.mode, p.id, JSON.stringify({ table: K.table, kind: p.kind, prev, name: p.name }), who.id, who.name]);
    return trashId;
  }

  const DONE = { delete: "Deleted", retire: "Retired", archive: "Archived", unassign: "Removed the winner of" };
  const doneSentence = (p, K) => p.mode === "unassign" ? `Removed the winner of ${p.name}. The item is unassigned.`
    : K.people ? `Removed ${p.name}.` : `${DONE[p.mode]} the ${p.name} ${K.noun}.`;


  // FIX-45 · RECENT CHANGES. This person's last 50 changes that can still be
  // undone, newest first, each with the request that undoes it. Read from the
  // seams that already undo things (nothing new is recorded to make the list):
  //   · the trash (deleted_records): every Remove and every Delete that offered
  //     Undo, for as long as the row is still in the trash (30 days listed)
  //   · a card skipped in To confirm, until it is brought back (30 days)
  //   · a person added by hand in the last day who has no gift yet (an admin
  //     only, because taking a person out is an admin's delete)
  // A GET: it writes nothing.
  const LIST_DAYS = 30;
  const TABLE_NOUN = { interactions: "entry", threads: "next step", tasks: "task", pledges: "pledge", opportunities: "ask",
    households: "household", donor_relationships: "relationship", planned_gifts: "planned gift", donor_materials: "file",
    proposals: "ask", impact_metrics: "impact metric", gifts: "gift" };
  const rowName = d => {
    const v = d && (d.name || d.title || d.label || d.subject || d.next_step_label || d.note || "");
    return String(v || "").replace(/\s+/g, " ").trim().slice(0, 80);
  };
  app.get("/recent-changes", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId, userId = req.user.userId;
    const [me] = await query("SELECT role FROM users WHERE id=? AND org_id=?", [userId, orgId]);
    const isAdmin = !!(me && me.role === "admin");
    const [trash, skipped, added] = await Promise.all([
      query(`SELECT t.id, t.table_name, t.record_id, t.row_data, t.created_at, d.name AS donor_name
               FROM deleted_records t
               LEFT JOIN donors d ON t.table_name = 'donors' AND d.id = t.record_id AND d.org_id = t.org_id
              WHERE t.org_id=? AND t.created_by=? AND t.restored_at IS NULL AND t.created_at > NOW() - INTERVAL '${LIST_DAYS} days'
              ORDER BY t.created_at DESC LIMIT 50`, [orgId, userId]),
      query(`SELECT id, kind, headline, proposal, skip_reason, decided_at FROM capture_items
              WHERE org_id=? AND decided_by=? AND status='skipped' AND decided_at > NOW() - INTERVAL '${LIST_DAYS} days'
              ORDER BY decided_at DESC LIMIT 50`, [orgId, userId]),
      isAdmin ? query(`SELECT d.id, d.name, a.created_at FROM fin_audit_log a
                         JOIN donors d ON d.id = a.entity_id AND d.org_id = a.org_id
                        WHERE a.org_id=? AND a.user_id=? AND a.entity_type='donor' AND a.action='created'
                          AND a.created_at > NOW() - INTERVAL '1 day' AND d.deleted_at IS NULL AND COALESCE(d.gift_count,0) = 0
                          AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id)
                        ORDER BY a.created_at DESC LIMIT 50`, [orgId, userId]) : [],
    ]);
    const plus = (at, days) => new Date(new Date(at).getTime() + days * 864e5).toISOString();
    const rows = [];
    for (const t of trash) {
      const data = typeof t.row_data === "string" ? JSON.parse(t.row_data) : (t.row_data || {});
      const soft = String(t.table_name).startsWith("removal:");
      const kind = soft ? data.kind : data.__removal;
      const K = kind ? R.kindOf(kind) : null;
      const noun = K ? K.noun : t.table_name === "donors" ? "person" : (TABLE_NOUN[t.table_name] || "record");
      const name = t.table_name === "donors" ? (t.donor_name || "") : soft ? String(data.name || "") : rowName(data);
      const mode = soft ? t.table_name.slice("removal:".length) : "delete";
      const verb = t.table_name === "donors" ? "Moved to trash" : mode === "retire" ? "Retired" : mode === "archive" ? "Archived"
        : mode === "unassign" ? "Removed the winner of" : K && K.people ? "Removed" : "Deleted";
      const sentence = mode === "unassign" ? `${verb} ${name || "an auction item"}.`
        : t.table_name === "donors" ? `${verb}: ${name || "a person"}.`
        : `${verb} the ${noun}${name ? `: ${name}` : ""}.`;
      rows.push({ id: t.id, kind: soft || data.__removal ? "removal" : "trash", sentence, at: t.created_at, until: plus(t.created_at, LIST_DAYS),
        undo: soft || data.__removal ? { method: "POST", path: "/removals/undo", body: { undoIds: [t.id] } }
                                     : { method: "POST", path: `/deleted-records/${encodeURIComponent(t.id)}/restore` } });
    }
    const CARD_WORD = { check: "check", daf_grant: "DAF grant", stock_gift: "stock gift", matching_gift: "matching gift", pledge: "pledge", other: "item" };
    for (const c of skipped) {
      const p = c.proposal || {};
      const who = p.donor ? ((p.donor.choices || []).find(x => x.id === p.donor.selectedId) || p.donor.prefill || {}).name : null;
      const cents = p.amount && Number.isFinite(Number(p.amount.cents)) ? Number(p.amount.cents) : null;
      const amt = cents != null ? "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " : "";
      const sentence = who || amt
        ? `Skipped the ${amt}${CARD_WORD[c.kind] || "item"}${who ? ` from ${who}` : ""} in To confirm.`
        : `Skipped in To confirm: ${String(c.headline || CARD_WORD[c.kind] || "an item").replace(/[?.]+$/, "")}.`;
      rows.push({ id: "skip:" + c.id, kind: "capture_skip", sentence, at: c.decided_at,
        until: plus(c.decided_at, LIST_DAYS), undoLabel: "Bring back",
        undo: { method: "POST", path: `/capture/${encodeURIComponent(c.id)}/unskip` } });
    }
    for (const d of added) {
      rows.push({ id: "add:" + d.id, kind: "person_added", sentence: `Added ${d.name || "a person"}.`, at: d.created_at,
        until: plus(d.created_at, 1), undoLabel: "Take back out",
        undo: { method: "DELETE", path: `/donors/${encodeURIComponent(d.id)}` } });
    }
    rows.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ rows: rows.slice(0, 50), now: new Date().toISOString() });
  }));
  const PREFIXES = ["/removals", "/volunteer-hub/removals"];
  const kindOk = (req, kind) => !req.path.startsWith("/volunteer-hub/") || VOLUNTEER_KINDS.has(kind);

  for (const base of PREFIXES) {
    // Undo first, so "undo" is never read as a kind.
    app.post(`${base}/undo`, requireAuth, checkWriteAccess, wrap(async (req, res) => {
      const ids = (Array.isArray(req.body?.undoIds) ? req.body.undoIds : [req.body?.undoId]).filter(Boolean).map(String).slice(0, BULK_MAX);
      if (!ids.length) return res.status(400).json({ error: "nothing_to_undo" });
      const orgId = req.user.orgId;
      const back = [];
      try {
        await withTransaction(async tx => {
          for (const id of ids) {
            const [t] = await queryTx(tx, `SELECT * FROM deleted_records WHERE id=? AND org_id=? FOR UPDATE`, [id, orgId]);
            if (!t) { const e = new Error("not_found"); e.status = 404; throw e; }
            if (t.restored_at) { const e = new Error("already"); e.status = 409; throw e; }
            if (t.created_by !== req.user.userId) {
              const [u] = await queryTx(tx, "SELECT role FROM users WHERE id=?", [req.user.userId]);
              if (!u || u.role !== "admin") { const e = new Error("not_yours"); e.status = 403; throw e; }
            }
            const data = typeof t.row_data === "string" ? JSON.parse(t.row_data) : t.row_data;
            if (String(t.table_name).startsWith("removal:")) {
              const K = R.kindOf(data.kind);
              if (!K || K.table !== data.table) { const e = new Error("bad"); e.status = 400; throw e; }
              const cols = Object.keys(data.prev || {}).filter(c => /^[a-z_]+$/.test(c));
              await runTx(tx, `UPDATE ${K.table} SET ${cols.map(c => `${c} = ?`).join(", ")} WHERE id=? AND org_id=?`,
                [...cols.map(c => data.prev[c]), t.record_id, orgId]);
              back.push({ kind: data.kind, id: t.record_id });
            } else {
              const K = R.kindOf(data && data.__removal);
              if (!K || K.table !== t.table_name) { const e = new Error("bad"); e.status = 400; throw e; }
              await runTx(tx, `INSERT INTO ${K.table} SELECT * FROM jsonb_populate_record(NULL::${K.table}, ?::jsonb)`, [JSON.stringify(data)]);
              if (WITH[K.table]) await WITH[K.table].give(tx, ctx, data.__with, data, orgId);
              back.push({ kind: data.__removal, id: t.record_id });
            }
            await bringBackAssets(tx, runTx, orgId, data);
            await runTx(tx, `UPDATE deleted_records SET restored_at = NOW() WHERE id=?`, [t.id]);
          }
        });
      } catch (e) {
        if (e.status === 404) return res.status(404).json({ error: "not_found" });
        if (e.status === 409) return res.status(409).json({ error: "already_restored", sentence: "That is already back." });
        if (e.status === 403) return res.status(403).json({ error: "not_yours", sentence: "Only whoever removed it, or an admin, can put it back." });
        if (e.status === 400) return res.status(400).json({ error: "cannot_restore" });
        if (e.code === "23505") return res.status(409).json({ error: "conflict", sentence: "It could not come back, because something now stands in its place." });
        throw e;
      }
      if (req.audit) req.audit.summary(back.length === 1 ? `Put back a removed ${R.kindOf(back[0].kind).noun}` : `Put back ${back.length} removed records`,
        { count: back.length, entityType: back[0] && back[0].kind });
      res.json({ restored: back.length, records: back, sentence: back.length === 1 ? "It is back." : `All ${back.length} are back.` });
    }));

    // The plan for several, so a bulk confirm reads from the same sentences.
    app.post(`${base}/:kind/plan`, requireAuth, wrap(async (req, res) => {
      const kind = req.params.kind;
      if (!kindOk(req, kind)) return res.status(404).json({ error: "unknown_kind" });
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, BULK_MAX);
      if (!ids.length) return res.status(400).json({ error: "no_ids" });
      if (req.audit) req.audit.skip("a plan writes nothing");
      const plans = [];
      for (const id of ids) {
        const r = await planFor(req, kind, id);
        if (r.status === 403) return res.status(403).json(r.body);
        if (r.plan) plans.push(r.plan);
      }
      if (!plans.length) return res.status(404).json({ error: "not_found" });
      res.json({ kind, count: plans.length, plans: plans.map(shape), ...R.bulkSentence(kind, plans) });
    }));

    app.get(`${base}/:kind/:id`, requireAuth, wrap(async (req, res) => {
      if (!kindOk(req, req.params.kind)) return res.status(404).json({ error: "unknown_kind" });
      const r = await planFor(req, req.params.kind, req.params.id);
      if (!r.plan) return res.status(r.status).json(r.body);
      res.json(shape(r.plan));
    }));

    app.post(`${base}/:kind/:id`, requireAuth, checkWriteAccess, wrap(async (req, res) => {
      const kind = req.params.kind;
      if (!kindOk(req, kind)) return res.status(404).json({ error: "unknown_kind" });
      const r = await planFor(req, kind, req.params.id);
      if (!r.plan) return res.status(r.status).json(r.body);
      const p = r.plan, K = r.K;
      if (p.mode === "refuse") return res.status(409).json({ error: "refused", message: p.body });
      let undoId;
      try {
        undoId = await withTransaction(tx => applyOne(tx, req, p, K));
      } catch (e) {
        // A row something else still points at (a fund named by a page, say)
        // is retired instead of failing: the rule is "never lose a record".
        if (e.code === "23503" && K.retires) {
          const again = { ...p, mode: "retire" };
          undoId = await withTransaction(tx => applyOne(tx, req, again, K));
          p.mode = "retire";
        } else throw e;
      }
      if (!undoId) return res.status(404).json({ error: "not_found" });
      if (req.audit) {
        req.audit.entity(K.table, p.id, `${K.noun[0].toUpperCase() + K.noun.slice(1)}: ${p.name}`);
        req.audit.action(p.mode === "delete" ? "deleted" : p.mode === "unassign" ? "updated" : p.mode + "d");
        req.audit.summary(doneSentence(p, K), { count: 1, entityType: K.table });
      }
      res.json({ ok: true, mode: p.mode, undoIds: [undoId], undoSeconds: UNDO_SECONDS, sentence: doneSentence(p, K) });
    }));

    // SEVERAL AT ONCE. One transaction, one audit line, one Undo.
    app.post(`${base}/:kind`, requireAuth, checkWriteAccess, wrap(async (req, res) => {
      const kind = req.params.kind;
      if (!kindOk(req, kind)) return res.status(404).json({ error: "unknown_kind" });
      const K = R.kindOf(kind);
      if (!K) return res.status(404).json({ error: "unknown_kind" });
      const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String))].slice(0, BULK_MAX);
      if (!ids.length) return res.status(400).json({ error: "no_ids" });
      const plans = [];
      for (const id of ids) {
        const r = await planFor(req, kind, id);
        if (r.status === 403) return res.status(403).json(r.body);
        if (r.plan && r.plan.mode !== "refuse") plans.push(r.plan);
      }
      if (!plans.length) return res.status(409).json({ error: "nothing_removable", message: "None of those can be removed." });
      const undoIds = await withTransaction(async tx => {
        const out = [];
        for (const p of plans) { const t = await applyOne(tx, req, p, K); if (t) out.push(t); }
        return out;
      });
      const sentence = K.people ? `Removed ${undoIds.length} ${undoIds.length === 1 ? K.noun : K.noun + "s"}.`
        : `Removed ${undoIds.length} ${undoIds.length === 1 ? K.noun : K.noun + "s"}.`;
      if (req.audit) req.audit.summary(sentence, { count: undoIds.length, entityType: K.table, ids: plans.map(p => p.id) });
      res.json({ ok: true, removed: undoIds.length, undoIds, undoSeconds: UNDO_SECONDS, sentence });
    }));
  }
}

module.exports = { mount, routers, VOLUNTEER_KINDS };
