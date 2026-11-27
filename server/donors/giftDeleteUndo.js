// server/donors/giftDeleteUndo.js · THANKS-1 item 3. A REMOVED GIFT IS A CHANGE TO THE RECORD, WITH AN UNDO.
//
// "Deleting a gift leaves a permanent 'Gift removed, thank-you cancelled' note on the donor
// timeline. Totals restore; the timeline never returns to baseline." (fleet, 23 Nov)
//
// Jonathan's call: a removed gift is a change to the record, not something that happened with
// the donor. So DELETE /gifts/:id writes nothing on the timeline. It writes one Recent changes
// line (write_effects header, UNDO-1) and the audit row says the same sentence; the line's Undo
// (POST /gifts/:id/restore, 30 days) puts the gift back as it was:
//   · the gift row, its ledger line, and every row that went with it by a cascading foreign
//     key (its fund lines, soft credits, tribute notice, thank-you draft), from the snapshot
//     taken inside the delete's own transaction (to_jsonb of each row);
//   · the receipts and pledge rows the delete detached point at it again (a receipt stays void;
//     the delete refused while one was live);
//   · the tasks the delete voided for it, the next step it dismissed and the journey it stopped
//     are live again, each only if it still carries the delete's own reason;
//   · then the donor's totals, the pledge's paid and the one after-change step run, as on any
//     gift write. A guest-list change the delete reversed stays as it is, and the answer says so.
// A delete that also removed the gift's refunds has no Undo (its line is in the audit).
// NUMBERS-10 item 6 (the brief's call, over THANKS-1's): when the delete cancels a thank-you, the timeline
// gets one "Thank-you cancelled: …" line (giftThanks.js cancelLine), and this Undo takes it away again.
"use strict";

const WE = require("../effects/writeEffects");
const { STARTED_BY, SKIPPED } = require("./giftThanks");

const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const toC = v => Math.round((Number(v) || 0) * 100);
// "Nov 23, 2026": a civil day read as a person reads it (shared/displayDate.js's words).
const dayWords = d => /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
const KIND = "gift_delete";

// Foreign keys onto gifts(id), read from the schema once: { table, col, del: 'c' | 'n' | 'a' | 'r' }.
let REFS = null;
async function giftRefs(db) {
  if (REFS) return REFS;
  REFS = await db.query(
    `SELECT cl.relname AS "table", a.attname AS col, c.confdeltype AS del
       FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'gifts'::regclass AND array_length(c.conkey, 1) = 1
      ORDER BY cl.relname`, []);
  return REFS;
}
const IDENT = /^[a-z_][a-z0-9_]*$/;

// Inside the delete's transaction, BEFORE anything is detached or voided.
async function snapshot(db, orgId, giftId) {
  const [g] = await db.query("SELECT to_jsonb(g) AS row FROM gifts g WHERE g.id = ? AND g.org_id = ?", [giftId, orgId]);
  if (!g) return null;
  const snap = { gift: g.row, ledger: [], cascade: [], repoint: [], tasks: [], threads: [], steps: [], plans: [] };
  snap.ledger = (await db.query("SELECT to_jsonb(f) AS row FROM fin_transactions f WHERE f.gift_id = ? AND f.org_id = ?", [giftId, orgId])).map(r => r.row);
  for (const ref of await giftRefs(db)) {
    if (!IDENT.test(ref.table) || !IDENT.test(ref.col)) continue;
    if (ref.del === "c") {
      const rows = await db.query(`SELECT to_jsonb(t) AS row FROM ${ref.table} t WHERE t.${ref.col} = ?`, [giftId]);
      const mine = rows.map(r => r.row).filter(r => !("org_id" in r) || r.org_id === orgId);
      if (mine.length) snap.cascade.push({ table: ref.table, rows: mine });
    } else {
      const rows = await db.query(`SELECT id FROM ${ref.table} t WHERE t.${ref.col} = ?`, [giftId]).catch(() => []);
      if (rows.length) snap.repoint.push({ table: ref.table, col: ref.col, ids: rows.map(r => r.id) });
    }
  }
  snap.tasks = (await db.query("SELECT id FROM tasks WHERE org_id = ? AND source_gift_id = ? AND voided_at IS NULL", [orgId, giftId])).map(r => r.id);
  snap.threads = (await db.query("SELECT id FROM threads WHERE org_id = ? AND opening_gift_id = ? AND closed_at IS NULL", [orgId, giftId])).map(r => r.id);
  const donorId = g.row.donor_id;
  if (donorId) {
    const plans = await db.query(STARTED_BY, [orgId, donorId, giftId, giftId, giftId]);
    snap.plans = plans.map(p => p.id);
    if (plans.length) {
      const steps = await db.query(`SELECT id, status, thread_id FROM cultivation_plan_steps
                                     WHERE org_id = ? AND plan_id = ANY(?::text[]) AND status IN ('open','pending')`, [orgId, snap.plans]);
      snap.steps = steps.map(s => ({ id: s.id, status: s.status }));
      const th = steps.filter(s => s.status === "open" && s.thread_id).map(s => s.thread_id);
      if (th.length) {
        snap.threads.push(...th);
        snap.tasks.push(...(await db.query(`SELECT id FROM tasks WHERE org_id = ? AND thread_id = ANY(?::text[]) AND voided_at IS NULL AND COALESCE(done, 0) = 0`,
          [orgId, th])).map(r => r.id));
      }
    }
  }
  snap.tasks = [...new Set(snap.tasks)]; snap.threads = [...new Set(snap.threads)];
  // POLISH-13 item 2 (W-1126-Finance-03): the gift's own timeline line (interactions.type 'gift', its
  // gift_id this gift) is what the gift write MADE (UNDO-1's effects rule), so the delete takes it
  // (TIMELINE_SQL below) and the Undo puts it back as it was.
  snap.timeline = (await db.query(`SELECT to_jsonb(i) AS row FROM interactions i WHERE i.org_id = ? AND i.gift_id = ? AND i.type = 'gift'`, [orgId, giftId])).map(r => r.row);
  return snap;
}

// The Recent changes sentence.
function sentence(g, donorName, cancelled) {
  const day = String(g.date || "").slice(0, 10);
  return `Removed ${donorName || "a donor"}'s ${usd(toC(g.amount))} gift${dayWords(day) ? ` of ${dayWords(day)}` : ""}.${cancelled ? " " + cancelled : ""}`;
}

// Inside the delete's transaction, AFTER the gift row is gone: the header line, with the snapshot.
async function recordDelete(db, { orgId, g, donorName, snap, who, cancelled, withRefunds, guestListChanged }) {
  if (!snap) return null;
  snap.guestListChanged = !!guestListChanged;
  const text = sentence(g, donorName, cancelled);
  const id = await WE.begin(db, { orgId, kind: KIND, id: g.id, donorId: g.donor_id, who, sentence: text,
    undo: withRefunds ? null : { label: "Undo", path: `/gifts/${encodeURIComponent(g.id)}/restore` } });
  await db.run("UPDATE write_effects SET after = ?::jsonb WHERE id = ? AND org_id = ?", [JSON.stringify(snap), id, orgId]);
  return text;
}

// The task, thread, step and plan lines the delete wrote, put back where they still carry its reason.
async function reopenWhatItStopped(db, orgId, s) {
  if (s.tasks.length) await db.run(`UPDATE tasks SET voided_at = NULL, voided_reason = NULL, updated_at = NOW()
                                     WHERE org_id = ? AND id = ANY(?::text[]) AND voided_reason = 'gift_deleted'`, [orgId, s.tasks]);
  let kept = 0;
  for (const t of s.threads) {
    try {
      await db.run(`UPDATE threads SET closed_at = NULL, close_kind = NULL, close_reason = NULL
                     WHERE org_id = ? AND id = ? AND close_reason = 'gift_deleted'`, [orgId, t]);
    } catch (e) { if (/threads_one_open|unique/i.test(e.message)) kept++; else throw e; }
  }
  for (const st of s.steps) await db.run(`UPDATE cultivation_plan_steps SET status = ?, closed_at = NULL, closed_by = NULL, closed_by_name = NULL, skip_reason = NULL
                                           WHERE org_id = ? AND id = ? AND skip_reason = ?`, [st.status, orgId, st.id, SKIPPED]);
  if (s.plans.length) await db.run(`UPDATE cultivation_plans SET status = 'active', closed_at = NULL, end_reason = NULL
                                     WHERE org_id = ? AND id = ANY(?::text[]) AND end_reason = 'gift_deleted'`, [orgId, s.plans]);
  return kept;
}

function mount(app, ctx) {
  const { query, requireAuth, checkWriteAccess, wrap, actor, withAdvisoryLock, withTransaction, queryTx, runTx,
    recalcDonorSummary, recalcPledgePayment } = ctx;

  app.post("/gifts/:id/restore", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId, who = actor(req), giftId = String(req.params.id);
    const header = async () => (await query(
      `SELECT * FROM write_effects WHERE org_id = ? AND parent_kind = ? AND parent_id = ? AND kind = 'write'
        ORDER BY created_at DESC LIMIT 1`, [orgId, KIND, giftId]))[0] || null;
    const h0 = await header();
    if (!h0) return res.status(404).json({ error: "not_found", sentence: "That removed gift is not on file." });
    if (h0.undone_at) return res.status(409).json({ error: "already_undone", sentence: "That gift was already put back." });
    if (!h0.undo) return res.status(409).json({ error: "no_undo", sentence: "That gift was removed with its refunds, so it can't be put back from here." });
    if (Date.now() - new Date(h0.created_at).getTime() > WE.UNDO_DAYS * 864e5)
      return res.status(409).json({ error: "too_old", sentence: `A removed gift can be put back for ${WE.UNDO_DAYS} days. This one is older.` });
    const out = await withAdvisoryLock(`gift:${giftId}`, () => withTransaction(async (client) => {
      const db = WE.onClient(client, queryTx, runTx);
      const [h] = await db.query("SELECT * FROM write_effects WHERE id = ? AND org_id = ? AND undone_at IS NULL FOR UPDATE", [h0.id, orgId]);
      if (!h) return { status: 409, body: { error: "already_undone", sentence: "That gift was already put back." } };
      const s = typeof h.after === "string" ? JSON.parse(h.after) : h.after;
      if (!s || !s.gift || s.gift.org_id !== orgId) return { status: 409, body: { error: "no_snapshot", sentence: "Steward has no copy of that gift to put back." } };
      const [still] = await db.query("SELECT 1 FROM gifts WHERE id = ?", [giftId]);
      if (still) return { status: 409, body: { error: "exists", sentence: "That gift is already on file." } };
      if (s.gift.donor_id) {
        const [d] = await db.query("SELECT deleted_at FROM donors WHERE id = ? AND org_id = ?", [s.gift.donor_id, orgId]);
        if (!d || d.deleted_at) return { status: 409, body: { error: "donor_gone", sentence: "The person this gift was from is in the trash. Restore them first." } };
      }
      await db.run("INSERT INTO gifts SELECT * FROM jsonb_populate_record(NULL::gifts, ?::jsonb)", [JSON.stringify(s.gift)]);
      for (const row of s.ledger || []) await db.run("INSERT INTO fin_transactions SELECT * FROM jsonb_populate_record(NULL::fin_transactions, ?::jsonb) ON CONFLICT DO NOTHING", [JSON.stringify(row)]);
      for (const c of s.cascade || []) {
        if (!IDENT.test(c.table)) continue;
        for (const row of c.rows) await db.run(`INSERT INTO ${c.table} SELECT * FROM jsonb_populate_record(NULL::${c.table}, ?::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(row)]);
      }
      for (const r of s.repoint || []) {
        if (!IDENT.test(r.table) || !IDENT.test(r.col)) continue;
        await db.run(`UPDATE ${r.table} SET ${r.col} = ? WHERE org_id = ? AND id = ANY(?::text[]) AND ${r.col} IS NULL`, [giftId, orgId, r.ids]);
      }
      for (const row of s.timeline || []) await db.run("INSERT INTO interactions SELECT * FROM jsonb_populate_record(NULL::interactions, ?::jsonb) ON CONFLICT DO NOTHING", [JSON.stringify(row)]);
      const keptThreads = await reopenWhatItStopped(db, orgId, s);
      // NUMBERS-10 item 6: the line that said its thank-you was cancelled goes, as the thank-you comes back.
      if (s.cancelLineId) await db.run("DELETE FROM interactions WHERE org_id = ? AND id = ?", [orgId, s.cancelLineId]);
      await WE.finish(db, orgId, KIND, giftId, who, "Undo");
      const kept = [keptThreads ? "A newer next step is open, so the one this gift started stays closed." : "",
        s.guestListChanged ? "The guest list stays as it is." : ""].filter(Boolean).join(" ");
      return { status: 200, body: { ok: true, giftId, donorId: s.gift.donor_id, pledgeId: s.gift.pledge_id || null,
        sentence: `The ${usd(toC(s.gift.amount))} gift is back.${kept ? " " + kept : ""}` } };
    }));
    if (out.status === 200) {
      const b = out.body;
      if (b.donorId) await recalcDonorSummary(b.donorId, orgId);
      if (b.pledgeId) await recalcPledgePayment(b.pledgeId, orgId);
      if (b.donorId) await require("../../afterChange").afterChange(orgId, [b.donorId], { door: "gift_form", recalc: false })
        .catch(e => console.error("[gift-restore] after-change:", e.message));
      if (req.audit) { req.audit.entity("gift", giftId); req.audit.summary(`Put back a removed gift. ${b.sentence}`); }
    }
    res.status(out.status).json(out.body);
  }));
}

// The delete's own statement for the timeline line (args: org, gift), inside its transaction.
const TIMELINE_SQL = "DELETE FROM interactions WHERE org_id = ? AND gift_id = ? AND type = 'gift'";

module.exports = { snapshot, recordDelete, mount, sentence, KIND, TIMELINE_SQL };
