// server/imports/undo.js · IMPORT-7. AN IMPORT'S ONE UNDO, MOVED HERE FROM
// server/imports/routes.js when the big Undo went on the queue (that file
// would have passed 1,500 lines). routes/crm.js mounts it straight after
// routes.js, so the routes keep their order, and routes.js hands it the
// shapes, windows and the two steps it shares (ctx.importUndoParts).
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
"use strict";
const express = require("express");
const JQ = require("../../jobQueue");

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  DEPOSIT_REVERSE_HOURS, UNDO_NOT_YOURS, actor, checkWriteAccess, mayUndoImport, query, recalcDonorSummary,
  recalcPledgePayment, recomputeScoresForOrg, requireAuth, run, withAdvisoryLock, wrap,
} = ctx;
const { cancelRecentWork, stopImportJourneys, WHOLE_IMPORT_SHAPES, SHAPE_REVERSE_HOURS } = ctx.importUndoParts;
const app = routers.r1;

// HARDEN-1: ONE UNDO. Two presses of "Yes, undo it" (a double-click, a retry
// after the answer was lost, a second tab) both read reversed_at as empty and
// both ran the whole undo, each answering "Undone. 40 gifts removed". The undo
// of one run now waits for any other undo of that run, then reads
// reversed_at again, so the second press is told it was already undone. Its
// own key, not `import:<org>`: the recent-gift work holds that one and the
// undo waits for that work (cancelRecentWork), which would wait forever.
//
// IMPORT-7 · A BIG UNDO FINISHES OR FAILS, NEVER HANGS. On 3 Nov a CI shard
// hung twice at perf-app's Undo of the 25,000-person workbook: one request,
// no limit, so a slow run held the request (and the shard) with nothing to
// say. Now an import of more than UNDO_INLINE_MAX rows (its gifts, its
// pledges and the people it made) is undone by the `importUndo` job on the
// queue, with its progress on `imports.undo_state`, and the answer is a 202
// the screen follows (GET /imports/:id/undo-status). Under that it runs in
// the request, with a time limit: past UNDO_INLINE_MS it stops at its next
// step and hands the rest to the same job. The undo is not one transaction,
// so before anything is removed the people and pledges it must recompute, and
// what it has removed so far, are written to undo_state: the job picks up
// from there and its sentence counts the whole undo, not the part it did.
const UNDO_INLINE_MAX = 5000;
const UNDO_INLINE_MS = () => Math.max(1, Number(process.env.IMPORT_UNDO_INLINE_MS) || 20000);
const UNDO_JOB_TIMEOUT_MS = 30 * 60 * 1000;
const UNDO_CHUNK = 2000;
class UndoHandOff extends Error {}
const stateOf = imp => (imp && imp.undo_state ? (typeof imp.undo_state === "string" ? JSON.parse(imp.undo_state) : imp.undo_state) : {});
const saveState = (orgId, id, patch) => run(`UPDATE imports SET undo_state = COALESCE(undo_state, '{}'::jsonb) || ?::jsonb WHERE id=? AND org_id=?`,
  [JSON.stringify(patch), id, orgId]);

// What the screen reads while a queued undo runs. A GET, and it writes nothing.
async function undoStatus(orgId, imp) {
  const st = stateOf(imp);
  const [job] = st.jobId ? await query("SELECT status, attempts, last_error FROM job_queue WHERE id=?", [st.jobId]) : [];
  // FLAKE-2: "done" only once the result is written with it. A run that set
  // reversed_at and was still finishing read as done with no count.
  const status = imp.reversed_at && st.status !== "running" ? "done" : st.status === "failed" || (job && job.status === "dead") ? "failed" : st.status === "running" ? "running" : "none";
  const done = Number(st.done) || 0, total = Number(st.total) || 0;
  return {
    status, job: !!st.jobId, phase: st.phase || null, done, total, reversedAt: imp.reversed_at || null,
    result: status === "done" ? st.result || { reversed: true, sentence: "Undone. The whole import was removed." } : null,
    error: status === "failed" ? (st.error || (job && job.last_error) || "The undo stopped.") : null,
    sentence: status === "running" ? `Undoing: ${st.phase || "waiting for its turn"}${total ? `, ${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}` : ""}.`
      : status === "failed" ? `The undo stopped before it finished: ${st.error || (job && job.last_error) || "no reason was given"}. Press Undo again to finish it; nothing is removed twice.`
      : status === "done" ? ((st.result && st.result.sentence) || "Undone. The whole import was removed.") : null,
  };
}
app.get("/imports/:id/undo-status", requireAuth, wrap(async (req, res) => {
  const [imp] = await query("SELECT id, reversed_at, undo_state FROM imports WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!imp) return res.status(404).json({ error: "not_found", message: "That import is not on this organization." });
  res.json(await undoStatus(req.user.orgId, imp));
}));

// The rows an undo removes, counted before it starts.
async function undoSize(orgId, id) {
  const [r] = await query(`SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=? AND import_id=?)::int
                                + (SELECT COUNT(*) FROM pledges WHERE org_id=? AND import_id=?)::int
                                + (SELECT COUNT(*) FROM donors WHERE org_id=? AND created_import_id=?)::int AS n`, [orgId, id, orgId, id, orgId, id]);
  return Number(r && r.n) || 0;
}
async function handOff(orgId, id, who, size, alsoMove = false) {
  const jobId = await JQ.enqueue({ name: "importUndo", orgId, key: `importUndo:${id}`, payload: { orgId, importId: id, who: { id: who.id, name: who.name }, alsoMove: !!alsoMove }, priority: 2 });
  const [w] = jobId ? [{ id: jobId }] : await query(`SELECT id FROM job_queue WHERE key=? AND status IN ('waiting','running') ORDER BY created_at DESC LIMIT 1`, [`importUndo:${id}`]);
  await saveState(orgId, id, { status: "running", jobId: (w && w.id) || null, phase: "waiting for its turn", done: 0, total: size, error: null, queuedAt: new Date().toISOString() });
  const [imp] = await query("SELECT id, reversed_at, undo_state FROM imports WHERE id=? AND org_id=?", [id, orgId]);
  return { status: 202, body: { ...(await undoStatus(orgId, imp)), queued: true } };
}

app.post("/imports/:id/reverse", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, id = req.params.id;
  const moved = [];   // INTEGRITY-3: everyone this request moved, one audit row each
  const onMoved = async m => { moved.push(...m); };
  const out = await withAdvisoryLock(`import-undo:${orgId}:${id}`, async () => {
    const [imp] = await query("SELECT * FROM imports WHERE id=? AND org_id=?", [id, orgId]);
    const refused = await undoRefusal(req, imp);
    if (refused) return refused;
    const st = stateOf(imp);
    // already on the queue: the same undo, followed by the screen
    if (st.status === "running" && st.jobId) {
      const [j] = await query("SELECT status FROM job_queue WHERE id=?", [st.jobId]);
      if (j && (j.status === "waiting" || j.status === "running")) return { status: 202, body: { ...(await undoStatus(orgId, imp)), queued: true } };
    }
    const size = await undoSize(orgId, id);
    const alsoMove = !!(req.body && req.body.alsoMove === true);   // INTEGRITY-2: her choice in the confirm
    if (size > UNDO_INLINE_MAX) return handOff(orgId, id, actor(req), size, alsoMove);
    try { return await undoImport(orgId, imp, actor(req), { deadline: Date.now() + UNDO_INLINE_MS(), alsoMove, onMoved }); }
    catch (e) {
      if (e instanceof UndoHandOff) return handOff(orgId, id, actor(req), size, alsoMove);
      await saveState(orgId, id, { status: "failed", error: String(e.message || e).slice(0, 300) }).catch(() => {});
      throw e;
    }
  });
  if (out.status === 200) require("../../routes/dataHealth").recheckSoon(orgId, "undo");   // FIX-59: Data health is current
  if (moved.length && req.audit) req.audit.perRecord(require("./undoMoves").rowsFor(id, moved));
  res.status(out.status).json(out.body);
}));
JQ.handle("importUndo", async (payload) => {
  const { orgId, importId: id, who, alsoMove } = payload || {};
  if (!orgId || !id) return { skipped: true };
  return withAdvisoryLock(`import-undo:${orgId}:${id}`, async () => {
    const [imp] = await query("SELECT * FROM imports WHERE id=? AND org_id=?", [id, orgId]);
    if (!imp || imp.reversed_at) return { skipped: true };
    let last = 0;
    const onProgress = async (phase, done, total) => {
      if (Date.now() - last < 500) return;
      last = Date.now();
      await saveState(orgId, id, { phase, done, total });
    };
    try {
      const actorOf = who || { id: "system:import-undo", name: "Steward (undo)" };
      // INTEGRITY-3: on the queue the job writes each person's row as they move
      const onMoved = m => require("./undoMoves").writeRows(orgId, actorOf, id, m);
      const out = await undoImport(orgId, imp, actorOf, { onProgress, alsoMove: !!alsoMove, onMoved });
      if (out.status !== 200) await saveState(orgId, id, { status: "failed", error: out.body.message || out.body.error });
      else require("../../routes/dataHealth").recheckSoon(orgId, "undo");
      return { status: out.status };
    } catch (e) {
      await saveState(orgId, id, { error: String(e.message || e).slice(0, 300) }).catch(() => {});
      throw e;   // the queue tries again; Undo picks up where it stopped
    }
  });
}, { timeoutMs: UNDO_JOB_TIMEOUT_MS });

async function undoRefusal(req, imp) {
  if (!imp) return { status: 404, body: { error: "not_found", message: "That import is not on this organization." } };
  if (!WHOLE_IMPORT_SHAPES.has(imp.shape)) {
    return { status: 400, body: { error: "shape_not_reversible",
      message: "A deposit, a gift file, and a file with one row per gift reverse as a whole. Any other import is undone gift by gift, on the record." } };
  }
  if (!(await mayUndoImport(req, imp.actor_user_id))) return { status: 403, body: { error: "not_yours", message: UNDO_NOT_YOURS } };
  if (imp.reversed_at) return { status: 409, body: { error: "already_reversed", reversedAt: imp.reversed_at } };
  const st = stateOf(imp);
  const windowHours = SHAPE_REVERSE_HOURS[imp.shape] || DEPOSIT_REVERSE_HOURS;
  const ageHours = (Date.now() - new Date(imp.committed_at).getTime()) / 3600e3;
  // an undo already begun is finished, whatever the clock says now
  if (ageHours > windowHours && !st.status) {
    const what = imp.shape === "deposit" ? "deposit" : "import";
    return { status: 409, body: { error: "window_closed",
      message: `This ${what} was recorded ${Math.round(ageHours)} hours ago. It reverses as a whole for ${Math.round(windowHours)} hours; after that, correct it gift by gift so the correction is visible on the record.` } };
  }
  return null;
}

async function undoImport(orgId, imp, who, { deadline = null, onProgress = null, alsoMove = false, onMoved = async () => {} } = {}) {
  const id = imp.id;
  const st = stateOf(imp);
  const removed = { gifts: 0, pledges: 0, interactions: 0, tasks: 0, journeys: 0, people: 0, alreadyDeleted: 0, backToTrash: 0, movedToo: 0, discarded: 0, ...(st.removed || {}) };
  // a step boundary: past the request's limit, the rest goes to the queue
  const step = async (phase, done = 0, total = 0) => {
    if (deadline && Date.now() > deadline) throw new UndoHandOff();
    if (onProgress) await onProgress(phase, done, total);
  };
  const keep = async (patch = {}) => saveState(orgId, id, { removed, ...patch });
  if (!st.status) await saveState(orgId, id, { status: "running", startedAt: new Date().toISOString() });

  // FIX-37: undo while the recent-gift work runs: stop it first, so nothing
  // is written after the undo has read what to remove.
  await cancelRecentWork(orgId, id);
  const gifts = await query("SELECT id, donor_id, pledge_id FROM gifts WHERE org_id=? AND import_id=?", [orgId, id]);
  const giftIds = gifts.map(g => g.id);
  // LIVE-1 — the journeys this import's gifts started are stopped and taken
  // away (an undo is as if the file never came), their open step closed; and
  // the readout it wrote is removed.
  removed.journeys += await stopImportJourneys(orgId, id, who);
  await run(`UPDATE readouts SET removed_at=NOW() WHERE org_id=? AND source_kind='import' AND source_id=? AND removed_at IS NULL`,
    [orgId, id]);
  // IMPORT-7: who to recompute is kept before anything goes, so a run that
  // picks this up later still recomputes the people whose gifts are gone
  const pledgeIds = [...new Set([...(st.pledgeIds || []), ...gifts.map(g => g.pledge_id).filter(Boolean)])];
  const donorIds = [...new Set([...(st.donorIds || []), ...gifts.map(g => g.donor_id)])];
  await keep({ donorIds, pledgeIds });
  for (let k = 0; k < giftIds.length; k += UNDO_CHUNK) {
    await step("removing gifts", k, giftIds.length);
    const chunk = giftIds.slice(k, k + UNDO_CHUNK);
    await run("UPDATE pledge_installments SET paid_gift_id=NULL, paid_at=NULL WHERE org_id=? AND paid_gift_id = ANY(?)", [orgId, chunk]);
    await run("DELETE FROM thank_you_drafts WHERE org_id=? AND gift_id = ANY(?)", [orgId, chunk]).catch(() => {});
    await run("DELETE FROM fin_transactions WHERE org_id=? AND gift_id = ANY(?)", [orgId, chunk]);
    await run("DELETE FROM interactions WHERE org_id=? AND gift_id = ANY(?)", [orgId, chunk]);
    await run("DELETE FROM gifts WHERE org_id=? AND id = ANY(?)", [orgId, chunk]);
    removed.gifts += chunk.length;
    await keep();
  }
  await step("removing the rest of the file");
  // The not-a-gift payments the deposit recorded, and the people it created —
  // a person created by a reversed deposit has no gift and no history, so
  // leaving them behind is leaving a record nobody asked for.
  await run("DELETE FROM interactions WHERE org_id=? AND import_id=? AND type='payment'", [orgId, id]);
  // IMPORT-2: everything else the run wrote and tagged. The notes a donor file
  // brought in (its Notes column) and a history file's whole timeline, its
  // tasks, its relationships, and the attachments put on its lines.
  const ixIds = (await query("SELECT id, donor_id FROM interactions WHERE org_id=? AND import_id=?", [orgId, id]));
  if (ixIds.length) {
    for (const i of ixIds) if (i.donor_id && !donorIds.includes(i.donor_id)) donorIds.push(i.donor_id);
    await keep({ donorIds });
    await run("UPDATE interaction_attachments SET deleted_at=NOW(), deleted_by=? WHERE org_id=? AND interaction_id = ANY(?) AND deleted_at IS NULL",
      [who.name || who.id, orgId, ixIds.map(i => i.id)]).catch(() => {});
    await run("DELETE FROM interactions WHERE org_id=? AND import_id=?", [orgId, id]);
    removed.interactions += ixIds.length;
    await keep();
  }
  // HARDEN-1: the "Review N possible duplicates from the import" task its Data
  // health run opened is the run's too, while nobody has done it
  removed.tasks += (await query(`DELETE FROM tasks WHERE org_id=? AND (import_id=? OR (created_by=? AND COALESCE(done,0)::int = 0)) RETURNING id`,
    [orgId, id, `system:data-health/import/${id}`])).length;
  await run("DELETE FROM donor_relationships WHERE org_id=? AND import_id=?", [orgId, id]).catch(() => {});
  // Flags and tags are reverted only where this run turned them on and they
  // are still on: a flag somebody set by hand afterwards is not this run's.
  const sj = imp.summary_json ? (typeof imp.summary_json === "string" ? JSON.parse(imp.summary_json) : imp.summary_json) : {};
  const HISTORY_FLAGS = new Set(["do_not_solicit", "do_not_contact", "do_not_mail", "do_not_email", "do_not_call"]);
  for (const f of (sj.flagsSet || [])) {
    if (!HISTORY_FLAGS.has(f.flag)) continue;
    await run(`UPDATE donors SET ${f.flag}=false WHERE org_id=? AND id=?`, [orgId, f.donorId]);
  }
  for (const t of (sj.tagsAdded || [])) {
    const [d] = await query("SELECT tags FROM donors WHERE org_id=? AND id=?", [orgId, t.donorId]);
    if (!d) continue;
    let tags = []; try { tags = JSON.parse(d.tags || "[]"); } catch { tags = []; }
    const drop = new Set((t.tags || []).map(x => String(x).toLowerCase()));
    await run("UPDATE donors SET tags=? WHERE org_id=? AND id=?", [JSON.stringify(tags.filter(x => !drop.has(String(x).toLowerCase()))), orgId, t.donorId]);
  }
  // IMPORT-3: a spreadsheet import also made pledges, households and perhaps
  // the event its gifts were given at. Each goes, and what it changed on a
  // person who was already here (a household, the monthly-giver flag) is put back.
  // FIX-60: a history file's pledges (import-semantics) carry the run too, so
  // every shape takes the pledges its run wrote, and their installments go
  // with them (ON DELETE CASCADE): nothing is left scheduled for a pledge that
  // no longer exists, and a payment it linked that stays is unlinked.
  {
    const pl = await query("SELECT id, donor_id FROM pledges WHERE org_id=? AND import_id=?", [orgId, id]);
    if (pl.length) {
      for (const p of pl) if (!donorIds.includes(p.donor_id)) donorIds.push(p.donor_id);
      await keep({ donorIds });
      await run("UPDATE gifts SET pledge_id=NULL WHERE org_id=? AND pledge_id = ANY(?)", [orgId, pl.map(p => p.id)]);
      await run("DELETE FROM pledge_installments WHERE org_id=? AND pledge_id = ANY(?)", [orgId, pl.map(p => p.id)]);
      await run("DELETE FROM pledges WHERE org_id=? AND id = ANY(?)", [orgId, pl.map(p => p.id)]);
      removed.pledges += pl.length;
      await keep();
    }
  }
  if (imp.shape === "sheet") {
    for (const d of (sj.householdAssigned || [])) await run("UPDATE donors SET household_id=NULL WHERE org_id=? AND id=?", [orgId, d]);
    for (const d of (sj.sustainerFlagged || [])) await run("UPDATE donors SET imported_sustainer=false, imported_sustainer_amount=NULL WHERE org_id=? AND id=?", [orgId, d]);
    // IMPORT-4: attendance, communication choices, kept columns and the
    // timeline lines that said where they came from go too, and a person who
    // was already here is put back exactly as they were.
    await run("DELETE FROM event_attendees WHERE org_id=? AND import_id=?", [orgId, id]);
    await run("DELETE FROM interactions WHERE org_id=? AND import_id=?", [orgId, id]);
    // FIX-59: the tables the seating chart made, once nobody sits at them
    if ((sj.tablesCreated || []).length) await run(`DELETE FROM event_tables t WHERE t.org_id=? AND t.id = ANY(?)
                                                      AND NOT EXISTS (SELECT 1 FROM event_attendees a WHERE a.table_id = t.id)`, [orgId, sj.tablesCreated]);
    if ((sj.suppressions || []).length) await run("DELETE FROM email_suppressions WHERE org_id=? AND id = ANY(?)", [orgId, sj.suppressions]);
    const SAFE_COLS = new Set(["email", "phone", "address", "address2", "city", "state", "zip", "external_donor_id", "person_types", "about_them",
      "do_not_email", "do_not_contact", "do_not_mail", "do_not_call", "deceased",
      "phone_unreachable", "phone_unreachable_reason", "address_unmailable", "address_unmailable_reason", "address_unmailable_at"]);
    for (const pc of (sj.personChanges || [])) {
      const cols = Object.keys(pc.before || {}).filter(k => SAFE_COLS.has(k));
      if (!cols.length) continue;
      await run(`UPDATE donors SET ${cols.map(k => k === "person_types" ? `${k}=?::jsonb` : `${k}=?`).join(", ")} WHERE org_id=? AND id=?`,
        [...cols.map(k => k === "person_types" ? JSON.stringify(pc.before[k]) : pc.before[k]), orgId, pc.id]);
    }
    for (const cv of (sj.customValuesSet || [])) {
      for (const k of cv.keys || []) await run("UPDATE donors SET custom_fields = custom_fields - ? WHERE org_id=? AND id=?", [k, orgId, cv.donorId]);
      if (cv.wasNull) await run("UPDATE donors SET custom_fields = NULL WHERE org_id=? AND id=? AND custom_fields = '{}'::jsonb", [orgId, cv.donorId]);
    }
  }
  // INTEGRITY-2: a line Steward wrote by itself (created_by system:…) is not
  // activity; it goes with the person (undoPeople.js).
  // INTEGRITY-3: someone this undo already moved (a run picked up from the
  // queue) is not counted twice.
  const orphans = await query(
    `SELECT d.id, (d.deleted_at IS NOT NULL AND d.staged_import_id IS NULL) AS was_deleted, (d.staged_import_id IS NOT NULL) AS staged
       FROM donors d WHERE d.org_id=? AND d.created_import_id=?
       AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id)
       AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.donor_id=d.id AND COALESCE(i.created_by, '') NOT LIKE 'system:%')
       AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.donor_id=d.id AND COALESCE(t.created_by, '') NOT LIKE 'system:%')
       AND NOT EXISTS (SELECT 1 FROM deleted_records r WHERE r.org_id=d.org_id AND r.table_name='donors' AND r.record_id=d.id
                         AND r.restored_at IS NULL AND (r.row_data ->> '__importUndo') = ?)`, [orgId, id, id]);
  // INTEGRITY-3 (W-Fiona): the people this file created go to the TRASH,
  // restorable for 30 days, never deleted outright; anyone of them already in
  // the trash stays there as they are, trash row and all (undoMoves.js).
  // FIX-52's count of the ones already deleted is kept.
  await step("moving the people this file created to the trash", 0, orphans.length);
  const made = await require("./undoMoves").trashCreated(require("../../db"), orgId, imp, orphans, who);
  await onMoved([...made.moved, ...made.discarded]);
  removed.discarded = (Number((st.removed || {}).discarded) || 0) + made.discarded.length;
  removed.people = (Number((st.removed || {}).people) || 0) + made.moved.length + made.alreadyInTrash.length + made.discarded.length;
  removed.alreadyDeleted = (Number((st.removed || {}).alreadyDeleted) || 0) + made.alreadyInTrash.length;
  await keep();
  const goneIds = new Set([...made.moved.map(m => m.id), ...made.alreadyInTrash, ...made.discarded.map(m => m.id)]);
  // IMPORT-8 · UNDO NEVER QUIETLY KEEPS PEOPLE. Someone this file made who
  // has a gift, note, call or task added since (or whom another record holds)
  // stays; the result names each one and why, and the receipt offers to
  // remove them too (the ordinary delete, to the trash).
  // INTEGRITY-2: who stayed, and why, by the one definition (undoPeople.js).
  // A record holding gifts from before the import was here first: it stays,
  // named, and is never offered to move.
  const UP = require("./undoPeople");
  const active = (await UP.peopleWithActivity(query, orgId, imp)).filter(r => !goneIds.has(r.id));
  const held = (await query(`SELECT id, name FROM donors WHERE org_id=? AND created_import_id=? AND deleted_at IS NULL ORDER BY name, id`, [orgId, id]))
    .filter(r => !goneIds.has(r.id) && !active.some(a => a.id === r.id))
    .map(r => ({ id: r.id, name: r.name, why: "another record holds them", movable: true }));
  const stayed = [...active, ...held];
  // IMPORT-9: the people this run brought back from the trash go back to it
  // (restoredPeople.js), unless something was added to them since
  {
    await step("putting back the people it brought back from the trash");
    const back = await require("./restoredPeople").sendBackToTrash(require("../../db"), orgId, imp, sj, who);
    await onMoved(back.moved);
    removed.backToTrash = (Number((st.removed || {}).backToTrash) || 0) + back.trashed.length;
    stayed.push(...back.stayed.map(p => ({ ...p, movable: true })));
    await keep();
  }
  // INTEGRITY-2 (W-1107-Finance-17): she chose in Undo's confirm to move the
  // people with activity since too. Only the ones this run created or
  // restored (movable), through the one door out, in this same undo.
  if (alsoMove && stayed.some(p => p.movable)) {
    await step("moving the people with activity since to the trash");
    const moved = await require("../../personTrash").trashPeople(orgId, stayed.filter(p => p.movable).map(p => p.id), who,
      { why: { kind: "undo_moved_too", importId: id } });
    await onMoved(moved.map(m => ({ id: m.id, from: "active", to: "trash", how: "moved_too" })));
    const movedIds = new Set(moved.map(m => m.id));
    removed.movedToo = (Number((st.removed || {}).movedToo) || 0) + moved.length;
    for (let k = stayed.length - 1; k >= 0; k--) if (movedIds.has(stayed[k].id)) stayed.splice(k, 1);
    await keep();
  }
  if (imp.shape === "sheet") {
    await run(`DELETE FROM households h WHERE h.org_id=? AND h.import_id=? AND NOT EXISTS (SELECT 1 FROM donors d WHERE d.household_id=h.id)`, [orgId, id]);
    await run(`DELETE FROM events e WHERE e.org_id=? AND e.import_id=? AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.event_id=e.id)
                 AND NOT EXISTS (SELECT 1 FROM pledges p WHERE p.event_id=e.id)
                 AND NOT EXISTS (SELECT 1 FROM event_attendees a WHERE a.event_id=e.id)`, [orgId, id]);
    // a custom field this import made, once no one holds a value in it
    for (const fid of (sj.customFieldsCreated || [])) {
      const [def] = await query("SELECT key FROM custom_field_defs WHERE org_id=? AND id=?", [orgId, fid]);
      if (!def) continue;
      const [held] = await query("SELECT 1 FROM donors WHERE org_id=? AND (custom_fields ->> ?) IS NOT NULL LIMIT 1", [orgId, def.key]);
      if (!held) await run("DELETE FROM custom_field_defs WHERE org_id=? AND id=?", [orgId, fid]);
    }
    for (const fid of (sj.fundsCreated || [])) {
      await run(`DELETE FROM fin_funds f WHERE f.org_id=? AND f.id=? AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.fund_id=f.id)
                   AND NOT EXISTS (SELECT 1 FROM fin_transactions t WHERE t.fund_id=f.id)`, [orgId, fid]).catch(() => {});
    }
  }
  // Totals RECOMPUTED from what remains, never decremented. A person this
  // undo removed (now, or in the run it picks up from) has nothing to recompute.
  const left = new Set((await query("SELECT id FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, donorIds])).map(r => r.id));
  const recompute = donorIds.filter(d => left.has(d) && !goneIds.has(d));
  // INTEGRITY-3: a person moved to the trash keeps their row, so their totals
  // are recomputed too (a Restore shows what is really theirs)
  for (const d of donorIds.filter(x => left.has(x) && goneIds.has(x))) await recalcDonorSummary(d, orgId).catch(() => {});
  for (let k = 0; k < recompute.length; k++) {
    if (k % 250 === 0) await step("recomputing totals", k, recompute.length);
    await recalcDonorSummary(recompute[k], orgId).catch(() => {});
  }
  for (const pid of pledgeIds) await recalcPledgePayment(pid, orgId).catch(() => {});
  await step("finishing");
  // FLAKE-2 (import7 §4): the import is marked undone in the SAME statement
  // that writes its sentence. reversed_at used to be written here, before the
  // after-change step, so a screen polling while a long undo finished read
  // "done" with the stand-in sentence and no count.
  const n = (k, one, many) => `${k.toLocaleString("en-US")} ${k === 1 ? one : many}`;
  const done = async body => {
    await run(`UPDATE imports SET reversed_at=COALESCE(reversed_at, NOW()), reversed_by=COALESCE(reversed_by, ?),
                 undo_state = COALESCE(undo_state, '{}'::jsonb) || ?::jsonb WHERE id=? AND org_id=?`,
      [who.name || who.id, JSON.stringify({ status: "done", phase: null, error: null, result: body }), id, orgId]);
    return { status: 200, body };
  };
  if (imp.shape === "history") {
    await recomputeScoresForOrg(orgId).catch(() => {});
    return done({ reversed: true, gifts: 0, interactions: removed.interactions, tasks: removed.tasks, donorsRemoved: removed.people,
      sentence: `Undone. ${removed.interactions.toLocaleString()} history ${removed.interactions === 1 ? "line" : "lines"}, ${removed.tasks} ${removed.tasks === 1 ? "task" : "tasks"}`
        + " removed"
        + (removed.people ? `; ${removed.people} ${removed.people === 1 ? "person" : "people"} this file created ${removed.people === 1 ? "is" : "are"} in the trash, restorable for 30 days` : "")   // INTEGRITY-3
        + "; and the preferences it set turned back off. Nothing else was touched." });
  }
  // LIVE-1 — the people it touched are recomputed by the one after-change step.
  await require("../../afterChange").afterChange(orgId, recompute, { door: "csv_import", history: true });
  // what was there leads (a file of people only says its people, never "0 gifts removed")
  const money = [removed.gifts && n(removed.gifts, "gift", "gifts"), removed.pledges && n(removed.pledges, "pledge", "pledges")].filter(Boolean).join(" and ");
  // INTEGRITY-3: the people it created go to the trash, and the sentence says so
  const ppl = removed.people ? `${n(removed.people, "person", "people")} this file created`
    + (removed.alreadyDeleted ? ` (${removed.alreadyDeleted.toLocaleString("en-US")} of them already deleted)` : "") : "";
  const pplTo = !removed.people ? "" : removed.discarded >= removed.people ? " removed (the import was staged, so they were never shown)"
    : ` ${removed.people === 1 ? "is" : "are"} in the trash, restorable for 30 days`;
  const movedSaid = removed.movedToo ? `; ${n(removed.movedToo, "person", "people")} with activity since moved to the trash too, as you chose` : "";
  const backSaid = removed.backToTrash ? `${n(removed.backToTrash, "person", "people")} it brought back from the trash ${removed.backToTrash === 1 ? "is" : "are"} back in the trash` : "";
  const what = (money ? ` ${money} removed${ppl ? `; ${ppl}${pplTo}` : ""}` : ppl ? ` ${ppl}${pplTo}` : backSaid ? "" : " Nothing it wrote was left to remove")
    + (backSaid ? `${money || ppl ? ";" : ""} ${backSaid}` : "");   // IMPORT-9
  const list = (xs, k) => xs.slice(0, k).map(x => `${x.name} (${x.why})`).join("; ") + (xs.length > k ? `; and ${(xs.length - k).toLocaleString("en-US")} more` : "");
  const lead = stayed.length ? `Undone, except for ${n(stayed.length, "person", "people")}.` : "Undone.";
  return done({ reversed: true, gifts: removed.gifts, donorsRemoved: removed.people, journeysStopped: removed.journeys,
    pledgesRemoved: removed.pledges, alreadyDeleted: removed.alreadyDeleted, backToTrash: removed.backToTrash, movedToo: removed.movedToo,
    stayed: stayed.slice(0, 500), stayedCount: stayed.length,
    sentence: lead
      + what
      + (removed.journeys ? `, ${n(removed.journeys, "journey", "journeys")} it started stopped` : "") + movedSaid + "."
      // INTEGRITY-2: a record that was here before the import is named apart; it never moves
      + ((a => a.length ? ` ${n(a.length, "person", "people")} stayed because they have activity since the import: ${list(a, 20)}.` : "")(stayed.filter(p => p.movable !== false)))
      + ((h => h.length ? ` ${n(h.length, "record", "records")} stayed because ${h.length === 1 ? "it was" : "they were"} here before the import: ${list(h, 20)}.` : "")(stayed.filter(p => p.movable === false)))
      + ` Nothing was sent.${stayed.length ? "" : " Nothing else was touched."}` });
}
}

module.exports = { routers, mount };
