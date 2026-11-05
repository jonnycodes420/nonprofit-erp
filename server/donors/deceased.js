// server/donors/deceased.js · PEOPLE-1. MARK SOMEONE DECEASED, WITH CARE.
//
// The one rule is the flag the importer already writes: `donors.deceased`.
// Every list, gate and suggestion reads it (`LIVING(d)` below for the ones
// this build added); marking it here writes that flag and its date, and in
// the same transaction:
//   · their active journeys end, end_reason 'deceased' (none start: journeyStart refuses)
//   · their active sequences stop, stop_reason 'deceased'
//   · their open next step (the Thread) closes, and so does an open task to
//     ask or solicit them: "Closed: marked deceased". Other tasks stay.
//   · if she ticked it, a yearly task to the relationship owner on the
//     anniversary: "Anniversary of <name>'s passing: a note to <partner>".
//     A task, never a send.
// Their gifts, totals, receipts, tributes and household are not touched.
// One row in deceased_marks remembers what closed, so "Undo: they're not
// deceased" reopens it; journeys already ended stay ended, and it says so.
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");

const routers = { r1: express.Router() };

// The SQL every list this build touched reads: a person who is not deceased.
const LIVING = (d = "d") => `${d}.deceased IS NOT TRUE`;

// The asks a death closes: a task whose words are an ask.
const ASK_WORDS = /\b(ask|asks|asking|solicit\w*|request (a|the|their) gift|appeal|pledge|renew\w*|upgrade|proposal|year[- ]end gift|major gift)\b/i;
const isAskTask = t => ASK_WORDS.test(`${t.title || ""} ${t.notes || ""}`);
const CLOSED_REASON = "Closed: marked deceased";

// A date of death: a whole date, a month and year, or a year. Never after today.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function parseDiedOn(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return { ok: true, value: null };
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s);
  if (!m) return { ok: false };
  const y = +m[1], mo = m[2] ? +m[2] : null, d = m[3] ? +m[3] : null;
  if (y < 1900 || (mo && (mo < 1 || mo > 12))) return { ok: false };
  if (d) { const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); if (d < 1 || d > last) return { ok: false }; }
  return { ok: true, value: s };
}
// "March 3, 2026", "March 2026", "2026".
function diedWords(v) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(v || ""));
  if (!m) return null;
  if (!m[2]) return m[1];
  if (!m[3]) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}
// The banner: "In memory · died March 2026".
const bannerText = diedOn => diedOn ? `In memory · died ${diedWords(diedOn)}` : "In memory";
// The next anniversary on or after today: the month and day of death (the
// 1st when only the month is known), or the day she marked it when no month.
function nextAnniversary(diedOn, today) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(diedOn || ""));
  const t = String(today).slice(0, 10);
  const month = m ? +m[2] : +t.slice(5, 7), day = m ? (m[3] ? +m[3] : 1) : +t.slice(8, 10);
  const on = y => { const last = new Date(Date.UTC(y, month, 0)).getUTCDate(); return `${y}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`; };
  const y = +t.slice(0, 4);
  return on(y) > t ? on(y) : on(y + 1);
}

// The people they share a life with: a spouse or partner link, else the others in their household.
async function partnersOf(query, orgId, donorId) {
  return query(
    `SELECT p.id, p.name, 0 AS rank FROM donor_relationships r
       JOIN donors p ON p.org_id = r.org_id AND p.id = CASE WHEN r.donor_id_a = ? THEN r.donor_id_b ELSE r.donor_id_a END
      WHERE r.org_id = ? AND (r.donor_id_a = ? OR r.donor_id_b = ?) AND r.relationship_type IN ('spouse', 'partner') AND p.deleted_at IS NULL
     UNION
     SELECT p.id, p.name, 1 FROM donors me JOIN donors p ON p.org_id = me.org_id AND p.household_id = me.household_id AND p.id <> me.id
      WHERE me.org_id = ? AND me.id = ? AND me.household_id IS NOT NULL AND p.deleted_at IS NULL AND p.deceased IS NOT TRUE
     ORDER BY rank, name`,
    [donorId, orgId, donorId, donorId, orgId, donorId]);
}

let C = null;
function mount(ctx) {
  const { requireAuth, checkWriteAccess, wrap, query, orgOwns } = ctx;
  C = Object.assign({ queryTx: require("../../db").queryTx }, ctx);
  const app = routers.r1;

  // What the dialog needs: their partner (for the reminder's words) and, when
  // marked, what was closed and the banner's words.
  app.get("/donors/:id/deceased", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    if (!(await orgOwns("donors", req.params.id, orgId))) return res.status(404).json({ error: "Donor not found" });
    const [d] = await query(`SELECT id, name, deceased, deceased_date, deceased_note, deceased_remind FROM donors WHERE id = ? AND org_id = ?`, [req.params.id, orgId]);
    const partners = await partnersOf(query, orgId, d.id);
    res.json({ deceased: d.deceased === true, diedOn: d.deceased_date || null, diedWords: diedWords(d.deceased_date),
      note: d.deceased_note || null, remind: d.deceased_remind === true,
      banner: d.deceased === true ? bannerText(d.deceased_date) : null,
      partners: partners.map(p => ({ id: p.id, name: p.name })) });
  }));

  app.post("/donors/:id/deceased", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const out = await markDeceased(req.user.orgId, req.params.id, req.body || {}, C.actor(req), req);
    res.status(out.status || 200).json(out.body);
  }));

  app.post("/donors/:id/not-deceased", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const out = await unmarkDeceased(req.user.orgId, req.params.id, C.actor(req), req);
    res.status(out.status || 200).json(out.body);
  }));
}

async function markDeceased(orgId, donorId, body, who, req = null) {
  const { query, withTransaction, queryTx, runTx, orgToday, orgTz } = C;
  const [d] = await query(`SELECT id, name, deceased, deceased_date, assigned_to, assigned_to_name FROM donors
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!d) return { status: 404, body: { error: "Donor not found" } };
  if (d.deceased === true) return { status: 409, body: { error: "already_deceased", sentence: `${d.name} is already marked deceased.` } };
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const died = parseDiedOn(body.diedOn);
  if (!died.ok) return { status: 400, body: { error: "bad_date", sentence: "The date of death is a year, a month and year, or a whole date." } };
  if (died.value && died.value.slice(0, died.value.length) > String(today).slice(0, died.value.length))
    return { status: 400, body: { error: "future_date", sentence: "The date of death can't be after today." } };
  const note = String(body.note || "").trim().slice(0, 2000) || null;
  const remind = body.remind === true;
  const partners = await partnersOf(query, orgId, donorId);
  if (req && req.audit) req.audit.before({ deceased: false, deceased_date: d.deceased_date || null });

  const result = await withTransaction(async client => {
    await runTx(client, `UPDATE donors SET deceased = true, deceased_date = ?, deceased_note = ?, deceased_remind = ?,
        deceased_marked_at = NOW(), deceased_marked_by = ?, deceased_marked_by_name = ?, updated_at = NOW() WHERE id = ? AND org_id = ?`,
      [died.value, note, remind, who.id, who.name, donorId, orgId]);

    // Journeys: every active one ends, its open step skipped, its thread closed.
    const plans = await queryTx(client, `SELECT id FROM cultivation_plans WHERE org_id = ? AND donor_id = ? AND status = 'active'`, [orgId, donorId]);
    const planIds = plans.map(p => p.id);
    const closedThreads = [];
    if (planIds.length) {
      const steps = await queryTx(client, `SELECT id, thread_id FROM cultivation_plan_steps WHERE org_id = ? AND plan_id = ANY(?::text[]) AND status = 'open'`, [orgId, planIds]);
      for (const s of steps) {
        if (s.thread_id) {
          const r = await runTx(client, `UPDATE threads SET closed_at = NOW(), close_kind = 'dismissed', close_reason = 'deceased' WHERE id = ? AND org_id = ? AND closed_at IS NULL`, [s.thread_id, orgId]);
          if (r.changes) closedThreads.push({ id: s.thread_id, plan: true });
        }
      }
      await runTx(client, `UPDATE cultivation_plan_steps SET status = 'skipped', closed_at = NOW(), closed_by = ?, closed_by_name = ?, skip_reason = ?
          WHERE org_id = ? AND plan_id = ANY(?::text[]) AND status IN ('open', 'pending')`, [who.id, who.name, "Marked deceased", orgId, planIds]);
      await runTx(client, `UPDATE cultivation_plans SET status = 'abandoned', closed_at = NOW(), end_reason = 'deceased', replaced_reason = ?
          WHERE org_id = ? AND id = ANY(?::text[]) AND status = 'active'`, [`Ended: ${d.name} was marked deceased.`, orgId, planIds]);
    }
    // Sequences stop.
    const enr = await queryTx(client, `UPDATE sequence_enrollments SET status = 'stopped', stop_reason = 'deceased', completed_at = NOW()
        WHERE org_id = ? AND donor_id = ? AND status = 'active' RETURNING id`, [orgId, donorId]);
    // Their open next step closes, whatever it is (a journey's was closed above):
    // a next step is a touch to them, and none is suggested now. Undo reopens it.
    const askThreads = await queryTx(client, `UPDATE threads SET closed_at = NOW(), close_kind = 'dismissed', close_reason = 'deceased'
        WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL RETURNING id`, [orgId, donorId]);
    for (const t of askThreads) closedThreads.push({ id: t.id });
    // Open tasks to ask or solicit them close; the rest stay.
    const open = await queryTx(client, `SELECT id, title, notes FROM tasks WHERE org_id = ? AND donor_id = ? AND done = 0 AND voided_at IS NULL
        AND COALESCE(link_kind, '') <> 'deadline'`, [orgId, donorId]);
    const askTaskIds = open.filter(isAskTask).map(t => t.id);
    if (askTaskIds.length) await runTx(client, `UPDATE tasks SET done = 1, completed_at = NOW(), completed_by_name = ?, closed_reason = ?, updated_at = NOW()
        WHERE org_id = ? AND id = ANY(?::text[]) AND done = 0`, [who.name, CLOSED_REASON, orgId, askTaskIds]);

    // The memorial reminder: a yearly task to the relationship owner (or whoever marked them).
    let memorialId = null;
    if (remind) {
      memorialId = newId("task");
      const p = partners[0];
      const title = `Anniversary of ${d.name}'s passing: a note to ${p ? p.name : "their family"}`;
      const due = nextAnniversary(died.value, today);
      const [mm, dd] = [+due.slice(5, 7), +due.slice(8, 10)];
      await runTx(client, `INSERT INTO tasks (id, org_id, title, due, priority, type, done, donor_id, assigned_to, assigned_to_name, kind, recur,
          notes, updated_at, created_by, created_by_name) VALUES (?, ?, ?, ?, 'medium', 'donor', 0, ?, ?, ?, 'write', ?::jsonb, ?, NOW(), ?, ?)`,
        [memorialId, orgId, title, due, p ? p.id : donorId, d.assigned_to || who.id, d.assigned_to ? d.assigned_to_name : who.name,
          JSON.stringify({ every: "year", month: mm, day: dd }),
          "A reminder to write to them yourself. Steward never sends this.", who.id, who.name]);
    }
    const markId = newId("dmark");
    await runTx(client, `INSERT INTO deceased_marks (id, org_id, donor_id, died_on, before_date, closed_task_ids, closed_thread_ids, ended_plan_ids,
        ended_enrollment_ids, memorial_task_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, ?)`,
      [markId, orgId, donorId, died.value, d.deceased_date || null, JSON.stringify(askTaskIds), JSON.stringify(closedThreads.map(t => t.id)),
        JSON.stringify(planIds), JSON.stringify(enr.map(e => e.id)), memorialId, who.id, who.name]);
    return { markId, planIds, enrollmentIds: enr.map(e => e.id), askTaskIds, closedThreads, memorialId };
  });

  if (req && req.audit) {
    req.audit.after({ deceased: true, deceased_date: died.value });
    req.audit.summary(`Marked ${d.name} deceased${died.value ? ` (died ${diedWords(died.value)})` : ""}.`,
      { journeysEnded: result.planIds.length, tasksClosed: result.askTaskIds.length, reminder: !!result.memorialId });
  }
  await require("../../afterChange").afterChange(orgId, [donorId], { door: "person_flag", recalc: false }).catch(e => console.error("[people-1] after change:", e.message));
  const parts = [];
  if (result.planIds.length) parts.push(`${result.planIds.length} journey${result.planIds.length === 1 ? "" : "s"} ended`);
  if (result.enrollmentIds.length) parts.push(`${result.enrollmentIds.length} sequence${result.enrollmentIds.length === 1 ? "" : "s"} stopped`);
  if (result.askTaskIds.length) parts.push(`${result.askTaskIds.length} ask${result.askTaskIds.length === 1 ? "" : "s"} closed`);
  const stepN = result.closedThreads.filter(t => !t.plan).length;
  if (stepN) parts.push("their next step closed");
  if (result.memorialId) parts.push("a yearly reminder added");
  return { body: { ok: true, deceased: true, diedOn: died.value, banner: bannerText(died.value),
    journeysEnded: result.planIds.length, sequencesStopped: result.enrollmentIds.length, tasksClosed: result.askTaskIds.length,
    memorialTaskId: result.memorialId,
    sentence: `${d.name} is marked deceased. They won't be asked, suggested or sent anything${parts.length ? `; ${parts.join(", ")}` : ""}. Their giving history stays.` } };
}

async function unmarkDeceased(orgId, donorId, who, req = null) {
  const { query, withTransaction, queryTx, runTx } = C;
  const [d] = await query(`SELECT id, name, deceased, deceased_date FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!d) return { status: 404, body: { error: "Donor not found" } };
  if (d.deceased !== true) return { status: 409, body: { error: "not_deceased", sentence: `${d.name} is not marked deceased.` } };
  if (req && req.audit) req.audit.before({ deceased: true, deceased_date: d.deceased_date || null });
  const out = await withTransaction(async client => {
    const [mark] = await queryTx(client, `SELECT * FROM deceased_marks WHERE org_id = ? AND donor_id = ? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1`, [orgId, donorId]);
    await runTx(client, `UPDATE donors SET deceased = false, deceased_date = ?, deceased_note = NULL, deceased_remind = false,
        deceased_marked_at = NULL, deceased_marked_by = NULL, deceased_marked_by_name = NULL, updated_at = NOW() WHERE id = ? AND org_id = ?`,
      [mark ? mark.before_date : null, donorId, orgId]);
    let reopened = 0, threadsBack = 0, ended = 0;
    if (mark) {
      const taskIds = mark.closed_task_ids || [];
      if (taskIds.length) reopened = (await runTx(client, `UPDATE tasks SET done = 0, completed_at = NULL, completed_by_name = NULL, closed_reason = NULL, updated_at = NOW()
          WHERE org_id = ? AND id = ANY(?::text[]) AND closed_reason = ?`, [orgId, taskIds, CLOSED_REASON])).changes;
      // A closed ask comes back unless another step has opened since (one open step per person).
      const [openNow] = await queryTx(client, `SELECT id FROM threads WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL`, [orgId, donorId]);
      const planThreads = new Set();
      if ((mark.ended_plan_ids || []).length) for (const s of await queryTx(client, `SELECT thread_id FROM cultivation_plan_steps WHERE org_id = ? AND plan_id = ANY(?::text[]) AND thread_id IS NOT NULL`, [orgId, mark.ended_plan_ids])) planThreads.add(s.thread_id);
      const askThread = (mark.closed_thread_ids || []).filter(id => !planThreads.has(id)).pop();
      if (askThread && !openNow) threadsBack = (await runTx(client, `UPDATE threads SET closed_at = NULL, close_kind = NULL, close_reason = NULL
          WHERE id = ? AND org_id = ? AND close_reason = 'deceased'`, [askThread, orgId])).changes;
      if (mark.memorial_task_id) await runTx(client, `UPDATE tasks SET voided_at = NOW(), voided_reason = ? WHERE id = ? AND org_id = ? AND voided_at IS NULL`,
        ["Undone: not deceased", mark.memorial_task_id, orgId]);
      ended = (mark.ended_plan_ids || []).length;
      await runTx(client, `UPDATE deceased_marks SET undone_at = NOW(), undone_by = ?, undone_by_name = ? WHERE id = ?`, [who.id, who.name, mark.id]);
    }
    return { reopened, threadsBack, ended };
  });
  if (req && req.audit) { req.audit.after({ deceased: false }); req.audit.summary(`Undid marking ${d.name} deceased.`, out); }
  await require("../../afterChange").afterChange(orgId, [donorId], { door: "person_flag", recalc: false }).catch(e => console.error("[people-1] after change:", e.message));
  return { body: { ok: true, deceased: false, journeysStillEnded: out.ended,
    sentence: `${d.name} is no longer marked deceased and is back in every list.`
      + (out.reopened ? ` ${out.reopened} ask${out.reopened === 1 ? "" : "s"} reopened.` : "") + (out.threadsBack ? " Their next step is open again." : "")
      + (out.ended ? ` ${out.ended === 1 ? "The journey" : `The ${out.ended} journeys`} that ended stay${out.ended === 1 ? "s" : ""} ended; start ${out.ended === 1 ? "it" : "them"} again if you want.` : "") } };
}

module.exports = { routers, mount, LIVING, isAskTask, parseDiedOn, diedWords, nextAnniversary, bannerText, markDeceased, unmarkDeceased };
