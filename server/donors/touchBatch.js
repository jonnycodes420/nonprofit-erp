// server/donors/touchBatch.js · EDIT-2 item 3. ONE TOUCH, LOGGED TO MANY PEOPLE AT ONCE.
//
// "I'd say log a touch, 'invited to awareness event xyz', click 20 people, and
// it logs that touch to those 20." A batch writes one touch per person, each on
// that person's timeline exactly as a single Log a touch would be, in ONE
// transaction (it can't half-finish), at most 2,000 people.
//
// A logged touch is a record of something already done. It sends nothing,
// closes no follow-up (a single log's "skip" rule, server/tasks/logClose.js)
// and makes no task unless she ticks "Also add a follow-up task".
//
//   POST /touch-batches/preview   { ids, title }  how many already have a touch with this title
//   POST /touch-batches           { ids, touchKind, title, note?, date?, skipHad?, followUp?: { due } }
//   POST /touch-batches/:id/undo  the whole batch, back out, in one step
//
// "Who's already had it" is the same title test (TITLE_MATCH) the Donors filter
// "Had a touch titled" reads (donorList.js), so the warning and the filter agree.
// A deleted touch leaves interactions (shared/trash.js), so it never counts.
"use strict";
const { newId } = require("../shared/newId");

const MAX_PEOPLE = 2000;
const TITLE_MAX = 120;
const NOTE_MAX = 4000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A touch "has this title" when the batch stored it as its title, or when its
// words (the first line, for one logged by hand) are those words. Case and the
// spaces around it don't matter. `?` is the title.
const TITLE_OF = a => `lower(btrim(COALESCE(NULLIF(${a}.metadata->>'touch_title', ''), split_part(COALESCE(${a}.note, ''), E'\\n', 1))))`;
const TITLE_MATCH = a => `${TITLE_OF(a)} = lower(btrim(?))`;
// For the Donors filter: this person has a touch with the title.
const HAD_TOUCH_SQL = (donors = "donors") =>
  `EXISTS (SELECT 1 FROM interactions ixt WHERE ixt.org_id = ${donors}.org_id AND ixt.donor_id = ${donors}.id AND ${TITLE_MATCH("ixt")})`;
const cleanTitle = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);

const peopleWords = n => `${Number(n).toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;

function register(app, ctx) {
  const { query, queryTx, runTx, withTransaction, wrap, requireAuth, requireCrm, checkWriteAccess, actor, orgToday, orgTz, resolveTouch } = ctx;
  const kindsMod = () => import("../../shared/touchKinds.js");

  // The people picked who are in this org, not in the trash, and visible to
  // this user (ACCESS-2). Nobody else is ever written to.
  async function pickable(req, rawIds) {
    const ids = [...new Set((Array.isArray(rawIds) ? rawIds : []).map(String).filter(Boolean))];
    if (!ids.length) return { error: { status: 400, body: { error: "no_people", sentence: "Pick at least one person." } } };
    if (ids.length > MAX_PEOPLE) return { error: { status: 400, body: { error: "too_many", sentence: `A batch is at most ${MAX_PEOPLE.toLocaleString("en-US")} people. Pick fewer, or log it in two batches.` } } };
    const v = require("../auth/portfolio").visibleSql(req, "d");
    const rows = await query(`SELECT d.id FROM donors d WHERE d.org_id = ? AND d.id = ANY(?::text[]) AND d.deleted_at IS NULL${v.sql}`,
      [req.user.orgId, ids, ...v.args]);
    const found = new Set(rows.map(r => r.id));
    return { ids: ids.filter(id => found.has(id)), missing: ids.length - found.size };
  }

  async function alreadyHad(q, orgId, ids, title) {
    if (!ids.length || !title) return [];
    const rows = await q(`SELECT DISTINCT donor_id FROM interactions ixt WHERE ixt.org_id = ? AND ixt.donor_id = ANY(?::text[]) AND ${TITLE_MATCH("ixt")}`,
      [orgId, ids, title]);
    return rows.map(r => r.donor_id);
  }

  app.post("/touch-batches/preview", requireAuth, requireCrm, wrap(async (req, res) => {
    const p = await pickable(req, req.body && req.body.ids);
    if (p.error) return res.status(p.error.status).json(p.error.body);
    const title = cleanTitle(req.body && req.body.title);
    const had = await alreadyHad(query, req.user.orgId, p.ids, title);
    res.json({ people: p.ids.length, missing: p.missing, already: had.length,
      sentence: had.length ? `${had.length.toLocaleString("en-US")} of these ${p.ids.length.toLocaleString("en-US")} already have a touch titled "${title}".` : null });
  }));

  app.post("/touch-batches", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const b = req.body || {};
    const K = await kindsMod();
    const kind = await resolveTouch(orgId, b.touchKind);
    if (!kind) return res.status(400).json({ error: "bad_kind", sentence: "Pick what you did." });
    const title = cleanTitle(b.title);
    if (!title) return res.status(400).json({ error: "title_required", sentence: "Give the touch a short title, like \"Invited to Spring awareness night\"." });
    const note = typeof b.note === "string" ? b.note.trim().slice(0, NOTE_MAX) : "";
    const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    const date = DAY.test(String(b.date || "")) ? String(b.date) : today;
    if (date > today) return res.status(400).json({ error: "future_touch", sentence: "A touch is something already done: pick today or an earlier day." });
    const fu = b.followUp && typeof b.followUp === "object" ? b.followUp : null;
    if (fu && !DAY.test(String(fu.due || ""))) return res.status(400).json({ error: "bad_follow_up", sentence: "Pick the day the follow-up is due." });

    const p = await pickable(req, b.ids);
    if (p.error) return res.status(p.error.status).json(p.error.body);
    const had = b.skipHad === true ? new Set(await alreadyHad(query, orgId, p.ids, title)) : new Set();
    const ids = p.ids.filter(id => !had.has(id));
    if (!ids.length) return res.status(400).json({ error: "nobody_left", sentence: had.size ? "Everyone picked already has this touch. Nothing was logged." : "None of those people can be found. Nothing was logged." });

    const who = actor(req);
    const batchId = newId("tb");
    const words = note ? `${title}\n\n${note}` : title;
    const meta = JSON.stringify({ via: "touch_batch", touch: K.legacyKeyFor ? (K.legacyKeyFor(kind.key, null) || kind.key) : kind.key,
      touch_kind: kind.key, touch_label: kind.label, touch_title: title, next_step: "skipped", batch: batchId });
    const intIds = ids.map(() => newId("int"));
    const taskIds = fu ? ids.map(() => newId("t")) : [];
    await withTransaction(async client => {
      await runTx(client,
        `INSERT INTO touch_batches (id, org_id, touch_kind, title, note, date, people, skipped, follow_up_due, created_by, created_by_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [batchId, orgId, kind.key, title, note || null, date, ids.length, had.size, fu ? fu.due : null, who.id, who.name]);
      await runTx(client,
        `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name, metadata, touch_batch_id)
         SELECT u.id, ?, u.donor_id, ?, ?, ?, ?, ?, ?::jsonb, ? FROM UNNEST(?::text[], ?::text[]) AS u(id, donor_id)`,
        [orgId, kind.interactionType, words, date, who.id, who.name, meta, batchId, intIds, ids]);
      if (fu) {
        // One follow-up per person, hers, only because she ticked the box.
        await runTx(client,
          `INSERT INTO tasks (id, org_id, title, due, priority, type, done, donor_id, assigned_to, assigned_to_name, updated_at,
                              created_by, created_by_name, kind, touch_batch_id)
           SELECT u.id, ?, ?, ?, 'medium', 'donor', 0, u.donor_id, ?, ?, NOW(), ?, ?, 'other', ? FROM UNNEST(?::text[], ?::text[]) AS u(id, donor_id)`,
          [orgId, `Follow up: ${title}`.slice(0, 200), fu.due, who.id, who.name, who.id, who.name, batchId, taskIds, ids]);
      }
      // The batch, checked inside the transaction: every row is on a picked person.
      const [c] = await queryTx(client, `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE NOT (donor_id = ANY(?::text[])))::int AS stray
        FROM interactions WHERE org_id = ? AND touch_batch_id = ?`, [ids, orgId, batchId]);
      if (c.n !== ids.length || c.stray) throw new Error("touch batch did not write one touch per person");
    });
    await require("../../afterChange").afterChange(orgId, ids, { door: "logged_touch", recalc: false });
    const sentence = `Logged "${title}" to ${peopleWords(ids.length)}.${had.size ? ` Skipped ${had.size.toLocaleString("en-US")} who already had it.` : ""}`;
    if (req.audit) {
      req.audit.entity("touch_batch", batchId, title);
      req.audit.summary(sentence, { count: ids.length });
    }
    res.json({ ok: true, batchId, people: ids.length, skipped: had.size, missing: p.missing, followUps: taskIds.length,
      sentence, undo: `/touch-batches/${batchId}/undo` });
  }));

  app.post("/touch-batches/:id/undo", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const who = actor(req);
    const out = await withTransaction(async client => {
      const [bt] = await queryTx(client, `SELECT * FROM touch_batches WHERE id = ? AND org_id = ? FOR UPDATE`, [req.params.id, orgId]);
      if (!bt) return { status: 404, body: { error: "not_found", sentence: "That batch isn't here." } };
      if (bt.undone_at) return { status: 409, body: { error: "already_undone", sentence: "That batch was already undone." } };
      const gone = await queryTx(client, `DELETE FROM interactions WHERE org_id = ? AND touch_batch_id = ? RETURNING donor_id`, [orgId, bt.id]);
      await runTx(client, `UPDATE tasks SET voided_at = NOW(), voided_reason = 'The touch it followed was undone', updated_at = NOW()
                            WHERE org_id = ? AND touch_batch_id = ? AND voided_at IS NULL`, [orgId, bt.id]);
      await runTx(client, `UPDATE touch_batches SET undone_at = NOW(), undone_by = ?, undone_by_name = ? WHERE id = ? AND org_id = ?`,
        [who.id, who.name, bt.id, orgId]);
      return { status: 200, bt, donorIds: [...new Set(gone.map(r => r.donor_id))] };
    });
    if (out.status !== 200) return res.status(out.status).json(out.body);
    if (out.donorIds.length) await require("../../afterChange").afterChange(orgId, out.donorIds, { door: "logged_touch", recalc: false });
    const sentence = `Took back "${out.bt.title}" from ${peopleWords(out.donorIds.length)}.`;
    if (req.audit) { req.audit.entity("touch_batch", out.bt.id, out.bt.title); req.audit.summary(sentence, { count: out.donorIds.length }); }
    res.json({ ok: true, undone: out.donorIds.length, sentence });
  }));
}

module.exports = { register, MAX_PEOPLE, TITLE_MATCH, HAD_TOUCH_SQL };
