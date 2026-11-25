// server/effects/writeEffects.js · UNDO-1 item 1. EVERY SIDE EFFECT RECORDS HOW TO TAKE IT BACK.
//
// Writes fired side effects that only went forward: a refund voided and
// reissued a receipt, a ticked step finished a journey, a logged touch closed
// the open next step, a registration added to an invite. Nothing recorded what
// each one did, so nothing could reverse it. Now:
//
//   · `begin(db, parent)` writes the HEADER row of a write that has an Undo
//     (kind 'write'): who, the sentence Recent changes shows, and the Undo call.
//   · `record(db, parent, effect)` writes ONE side effect: its kind, the table,
//     the row and the row's value BEFORE the write (null when the write made
//     the row). The one place an effect is recorded.
//   · `reverse(db, orgId, where, who)` takes effects back, NEWEST FIRST, and
//     says per effect whether it went back or why it stayed. The one place an
//     effect is reversed.
//
// `db` is { query, run } with `?` placeholders: the pool's (db.js) or a
// transaction's (onClient). Kinds: receipt_voided, receipt_issued,
// plan_advanced, journey_completed, step_closed, step_opened, attendee_quantity.
// Only the columns below are ever written back, on the row's own org.
"use strict";

const { newId } = require("../shared/newId");

const KINDS = new Set(["receipt_voided", "receipt_issued", "plan_advanced", "journey_completed", "step_closed", "step_opened", "attendee_quantity"]);

// table → the columns a reverse may put back. Nothing else is ever written.
const RESTORABLE = {
  receipts: ["voided_at", "void_reason"],
  cultivation_plan_steps: ["status", "closed_at", "closed_by", "closed_by_name", "thread_id"],
  cultivation_plans: ["status", "closed_at"],
  threads: ["closed_at", "close_kind", "close_reason", "closing_interaction_id"],
  // POLISH-11: a touch that closes a person's next step when that step is a task.
  tasks: ["done", "completed_at", "completed_by_name"],
  event_attendees: ["status", "quantity", "level_id", "registration_gift_id", "sponsor_pledge_id", "recognition", "gift_amount"],
};

const UNDO_DAYS = 30;

const onClient = (client, queryTx, runTx) => ({
  query: (sql, args) => queryTx(client, sql, args),
  run: (sql, args) => runTx(client, sql, args),
});

const pick = (row, cols) => {
  if (!row) return null;
  const o = {};
  for (const c of cols) o[c] = row[c] === undefined ? null : row[c];
  return o;
};

// A header row: the write itself, as Recent changes reads it.
async function begin(db, { orgId, kind, id, donorId = null, sentence, undo = null, who }) {
  if (!who || !who.id) throw new Error("write_effects: an actor is required");
  const rowId = newId("wfx");
  await db.run(
    `INSERT INTO write_effects (id, org_id, parent_kind, parent_id, kind, donor_id, sentence, undo, created_by, created_by_name)
     VALUES (?, ?, ?, ?, 'write', ?, ?, ?::jsonb, ?, ?)`,
    [rowId, orgId, kind, String(id), donorId, String(sentence || "").slice(0, 400), undo ? JSON.stringify(undo) : null, who.id, who.name || null]);
  return rowId;
}

// One side effect. `before` is the row's restorable columns before the write
// (null: the write made the row). `after` is optional, for reading only.
async function record(db, { orgId, kind: parentKind, id: parentId, donorId = null, who },
                      { kind, table, rowId, before = null, after = null, causeThreadId = null }) {
  if (!KINDS.has(kind)) throw new Error(`write_effects: unknown kind ${kind}`);
  if (!RESTORABLE[table]) throw new Error(`write_effects: ${table} cannot be reversed`);
  await db.run(
    `INSERT INTO write_effects (id, org_id, parent_kind, parent_id, kind, table_name, row_id, before, after, cause_thread_id, donor_id, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?)`,
    [newId("wfx"), orgId, parentKind, String(parentId), kind, table, String(rowId),
     before ? JSON.stringify(pick(before, RESTORABLE[table])) : null, after ? JSON.stringify(after) : null,
     causeThreadId, donorId, (who && who.id) || "system:effects", (who && who.name) || null]);
}

// Put ONE effect back. Returns { ok } or { ok:false, why }.
async function reverseOne(db, e, who) {
  const t = e.table_name;
  const before = typeof e.before === "string" ? JSON.parse(e.before) : e.before;
  if (!before) {
    // The write MADE this row. A next step it opened goes while still open;
    // a receipt it issued is voided (a receipt is never deleted); a guest row
    // it added is cancelled.
    if (t === "threads") {
      const r = await db.run("DELETE FROM threads WHERE id=? AND org_id=? AND closed_at IS NULL", [e.row_id, e.org_id]);
      return r && r.changes ? { ok: true } : { ok: false, why: "that next step was finished since" };
    }
    if (t === "receipts") {
      const r = await db.run("UPDATE receipts SET voided_at=NOW(), void_reason=? WHERE id=? AND org_id=? AND voided_at IS NULL",
        [`Undone by ${who.name || "staff"}.`, e.row_id, e.org_id]);
      return r && r.changes ? { ok: true } : { ok: false, why: "that receipt was already void" };
    }
    if (t === "event_attendees") {
      await db.run("UPDATE event_attendees SET status='cancelled', quantity=0, registration_gift_id=NULL WHERE id=? AND org_id=?", [e.row_id, e.org_id]);
      return { ok: true };
    }
    return { ok: false, why: "nothing to put back" };
  }
  const cols = RESTORABLE[t].filter(c => Object.prototype.hasOwnProperty.call(before, c));
  if (!cols.length) return { ok: false, why: "nothing to put back" };
  const sets = cols.map(c => `${c} = ?`).join(", ");
  try {
    const r = await db.run(`UPDATE ${t} SET ${sets} WHERE id = ? AND org_id = ?`, [...cols.map(c => before[c]), e.row_id, e.org_id]);
    return r && r.changes ? { ok: true } : { ok: false, why: "the row is gone" };
  } catch (err) {
    // threads_one_open: a newer next step is open, so this one stays closed.
    if (/threads_one_open|unique/i.test(err.message)) return { ok: false, why: "a newer next step is already open" };
    throw err;
  }
}

// Take back every not-yet-undone effect matching `where`, newest first.
//   where: { parentKind, parentId } or { causeThreadId }; `kinds` narrows it.
async function reverse(db, orgId, where, who, { kinds = null, reason = null } = {}) {
  const conds = ["org_id = ?", "kind <> 'write'", "undone_at IS NULL"], args = [orgId];
  if (where.causeThreadId) { conds.push("cause_thread_id = ?"); args.push(where.causeThreadId); }
  else { conds.push("parent_kind = ?", "parent_id = ?"); args.push(where.parentKind, String(where.parentId)); }
  if (kinds) { conds.push("kind = ANY(?::text[])"); args.push(kinds); }
  const rows = await db.query(`SELECT * FROM write_effects WHERE ${conds.join(" AND ")} ORDER BY created_at DESC, id DESC`, args);
  const out = [];
  for (const e of rows) {
    const r = await reverseOne(db, e, who);
    out.push({ kind: e.kind, table: e.table_name, rowId: e.row_id, ...r });
    await db.run(`UPDATE write_effects SET undone_at = NOW(), undone_by = ?, undone_by_name = ?, undo_reason = ? WHERE id = ? AND org_id = ?`,
      [who.id, who.name || null, r.ok ? reason : `kept: ${r.why}`, e.id, orgId]);
  }
  return out;
}

// The header is done with: its Undo leaves Recent changes.
async function finish(db, orgId, parentKind, parentId, who, reason = null) {
  await db.run(`UPDATE write_effects SET undone_at = NOW(), undone_by = ?, undone_by_name = ?, undo_reason = ?
                 WHERE org_id = ? AND parent_kind = ? AND parent_id = ? AND kind = 'write' AND undone_at IS NULL`,
    [who.id, who.name || null, reason, orgId, parentKind, String(parentId)]);
}

// Recent changes: this person's writes with an Undo, last 30 days.
async function recentRows(query, orgId, userId) {
  const rows = await query(
    `SELECT id, parent_kind, parent_id, sentence, undo, created_at FROM write_effects
      WHERE org_id = ? AND created_by = ? AND kind = 'write' AND undone_at IS NULL AND undo IS NOT NULL
        AND created_at > NOW() - INTERVAL '${UNDO_DAYS} days'
      ORDER BY created_at DESC LIMIT 50`, [orgId, userId]);
  const plus = at => new Date(new Date(at).getTime() + UNDO_DAYS * 864e5).toISOString();
  return rows.map(r => {
    const u = typeof r.undo === "string" ? JSON.parse(r.undo) : r.undo;
    return { id: r.id, kind: `effect_${r.parent_kind}`, sentence: r.sentence, at: r.created_at, until: plus(r.created_at),
      undoLabel: u.label || "Undo", ...(u.ask ? { ask: u.ask } : {}), undo: { method: u.method || "POST", path: u.path, body: u.body || {} } };
  });
}

// What a reverse did, in one sentence ("" when everything went back).
function keptSentence(results) {
  const kept = results.filter(r => !r.ok);
  if (!kept.length) return "";
  const WORD = { receipt_voided: "the voided receipt", receipt_issued: "the new receipt", plan_advanced: "a journey step",
    journey_completed: "the journey", step_closed: "the next step", step_opened: "the next step it opened", attendee_quantity: "the guest list" };
  return kept.map(r => `${(WORD[r.kind] || "One change").replace(/^./, c => c.toUpperCase())} stayed as it is: ${r.why}.`).join(" ");
}

module.exports = { begin, record, reverse, finish, recentRows, keptSentence, onClient, pick, RESTORABLE, KINDS, UNDO_DAYS };
