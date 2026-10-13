// routes/readouts.js · LIVE-1. "What this told us", and what Steward learned.
//
//   GET  /readouts                          every readout, newest first, with
//                                           What worked and the learned rules
//   GET  /readouts/latest                   the newest readout of the last 7
//                                           days, for the Thread row
//   GET  /readouts/:id                      one readout
//   POST /readouts/:id/lines/:kind/act      the line's one action: tasks, thank-
//                                           you drafts, or the group / Data
//                                           health to open. Recorded so What
//                                           worked can count gifts after it.
//   POST /readouts/:id/lines/:kind/dismiss  hide the line on this readout
//   POST /readout-kinds/:kind/restore       put a moved-down kind back
//   POST /import-shapes/match               files map themselves: the saved
//                                           answer for these headers, and the
//                                           headers it does not cover
//   POST /import-shapes                     save this file's answers
//   GET  /import-values                     saved value answers ("CHK" = Check)
//   POST /import-values                     save value answers
//
// Every write here is a POST from a page the person sees, logged by the one
// audit write. Nothing here reaches a donor: an action makes a task or a
// draft, and a draft waits for her.
const express = require("express");
const RO = require("../readout");

const routers = { r0: express.Router() };

// The header shape: the file's columns, normalised and sorted, so the same
// export with its columns in another order is the same file.
function normHeader(h) { return String(h || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function shapeKey(headers) { return [...new Set((headers || []).map(normHeader).filter(Boolean))].sort().join("|"); }
const VALUE_FIELDS = new Set(["paymentMethod", "fund", "campaign", "type"]);

function mount(ctx) {
const { actor, checkWriteAccess, orgToday, orgTz, query, queueThankYouDraft, requireAuth, run, testMode, uuid, wrap } = ctx;
const app = routers.r0;
RO.configure({ query });

async function readoutRow(orgId, id) {
  const [r] = await query(`SELECT * FROM readouts WHERE id=? AND org_id=? AND removed_at IS NULL`, [String(id), orgId]);
  return r || null;
}
function lineOf(row, kind) {
  const lines = typeof row.lines === "string" ? JSON.parse(row.lines) : (row.lines || []);
  return lines.find(l => l.kind === kind) || null;
}

// The learned rules, each with its one-sentence Why.
async function learned(orgId) {
  const shapes = await query(
    `SELECT id, headers, mapping, times_used, is_example, last_used_at FROM import_shape_mappings
      WHERE org_id=? ORDER BY last_used_at DESC LIMIT 50`, [orgId]);
  const values = await query(
    `SELECT id, field, raw, value, times_used FROM import_value_mappings WHERE org_id=? ORDER BY updated_at DESC LIMIT 100`, [orgId]);
  const demoted = [...await RO.demotedKinds(orgId)];
  return {
    fileMappings: shapes.map(s => {
      const headers = typeof s.headers === "string" ? JSON.parse(s.headers) : s.headers;
      return { id: s.id, columns: headers.length, timesUsed: s.times_used, isExample: !!s.is_example, lastUsedAt: s.last_used_at,
        sentence: `A file with these ${headers.length} columns (${headers.slice(0, 4).join(", ")}${headers.length > 4 ? ", …" : ""}) maps itself.`,
        why: `You mapped a file with exactly these column names, and the answers were saved against them; it has been used ${s.times_used} ${s.times_used === 1 ? "time" : "times"}.` };
    }),
    values: values.map(v => ({ id: v.id, field: v.field, raw: v.raw, value: v.value,
      sentence: `"${v.raw}" means ${v.value}.`,
      why: `You chose ${v.value} for "${v.raw}" in the ${v.field === "paymentMethod" ? "payment method" : v.field} column of an import, so the next file reads it the same way.` })),
    demoted: demoted.map(k => ({ kind: k, name: RO.KIND_NAMES[k],
      sentence: `"${RO.KIND_NAMES[k]}" lines show at the bottom.`,
      why: `You dismissed that kind of line ${RO.DISMISS_RUN} times running, with nothing done about it in between.` })),
  };
}

app.get("/readouts", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const lim = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const rows = await query(`SELECT * FROM readouts WHERE org_id=? AND removed_at IS NULL ORDER BY created_at DESC LIMIT ?`, [orgId, lim]);
  const demoted = await RO.demotedKinds(orgId);
  const readouts = [];
  for (const r of rows) readouts.push(await RO.shapeReadout(orgId, r, { demoted }));
  res.json({ readouts, whatWorked: await RO.whatWorked(orgId), learned: await learned(orgId) });
}));

// TEST_MODE only: the after-change step's recent runs for this org, so the
// LIVE-1 suite can prove each door called it. A 404 everywhere else.
app.get("/after-change-log", requireAuth, wrap(async (req, res) => {
  if (!testMode()) return res.status(404).json({ error: "Not found" });
  const AC = require("../afterChange");
  res.json({ doors: AC.DOORS, runs: AC.LOG.filter(r => r.orgId === req.user.orgId) });
}));

app.get("/readouts/latest", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [r] = await query(
    `SELECT * FROM readouts WHERE org_id=? AND removed_at IS NULL AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC LIMIT 1`, [orgId]);
  if (!r) return res.json({ readout: null });
  const shaped = await RO.shapeReadout(orgId, r);
  res.json({ readout: shaped.lines.length ? shaped : null });
}));

app.get("/readouts/:id", requireAuth, wrap(async (req, res) => {
  const r = await readoutRow(req.user.orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });
  res.json(await RO.shapeReadout(req.user.orgId, r));
}));

app.post("/readouts/:id/lines/:kind/act", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await readoutRow(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });
  const kind = String(req.params.kind);
  const line = lineOf(r, kind) || (kind === "data_problems" ? { kind, action: "open_data_health", rows: [] } : null);
  if (!line) return res.status(404).json({ error: "no_such_line" });
  const who = actor(req);
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const ids = [...new Set((line.rows || []).map(x => x.donorId))];
  const people = ids.length ? await query(
    `SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL
        AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE`, [orgId, ids]) : [];
  const nameOf = Object.fromEntries(people.map(p => [p.id, p.name]));
  const made = [];
  const record = (donorId, madeId) => run(
    `INSERT INTO readout_events (id, org_id, readout_id, line_kind, event, action_kind, donor_id, made_id, acted_on, created_by, created_by_name)
     VALUES (?,?,?,?,'acted',?,?,?,?,?,?)`,
    ["re_" + uuid().replace(/-/g, "").slice(0, 14), orgId, r.id, kind, line.action, donorId || null, madeId || null, today, who.id, who.name]);

  if (line.action === "task_thank" || line.action === "task_call" || line.action === "add_to_calls") {
    const verb = line.action === "task_thank" ? "Thank" : "Call";
    const why = { lapsed_returned: "gave again after more than a year", biggest_ever: "gave their biggest gift ever",
                  above_last_year: "has given more this year than all of last year", new_above_median: "a first gift above your median",
                  recurring_stopped: "their monthly gift stopped", now_late: "late for their own rhythm" }[kind] || "from a readout";
    for (const p of people) {
      const title = `${verb} ${p.name}${line.action === "task_thank" ? " personally" : ""}: ${why}`.slice(0, 200);
      const [open] = await query(
        `SELECT id FROM tasks WHERE org_id=? AND donor_id=? AND title=? AND COALESCE(done::text,'0') NOT IN ('1','true') AND voided_at IS NULL LIMIT 1`,
        [orgId, p.id, title]);
      if (open) { await record(p.id, open.id); made.push(open.id); continue; }
      const id = "t_" + uuid().slice(0, 8);
      await run(
        `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,created_by,created_by_name)
         VALUES (?,?,?,?,?,?,0,?,?,?,?,?)`,
        [id, orgId, title, today, "medium", "donor", p.id, req.user.userId, who.name || "", who.id, who.name]);
      await record(p.id, id);
      made.push(id);
    }
    return res.json({ ok: true, made: made.length, kind: "tasks",
      sentence: `${made.length} ${made.length === 1 ? "task" : "tasks"} added to Tasks for today.` });
  }
  if (line.action === "thank_you_draft") {
    // FIX-36's rule holds here too: a gift older than HISTORY_DAYS is history
    // and gets no thank-you, whoever presses the button.
    const HG = require("../historyGifts");
    let tooOld = 0;
    for (const row of line.rows || []) {
      if (!row.giftId || !nameOf[row.donorId]) continue;
      if (HG.isOldHistory(row.date, today)) { tooOld++; continue; }
      const d = await queueThankYouDraft(orgId, { giftId: row.giftId, donorId: row.donorId, cents: row.cents || 0 }).catch(() => null);
      const [t] = await query(`SELECT id FROM thank_you_drafts WHERE org_id=? AND gift_id=? LIMIT 1`, [orgId, row.giftId]);
      if (t || d) { await record(row.donorId, t ? t.id : null); made.push(t ? t.id : row.giftId); }
    }
    return res.json({ ok: true, made: made.length, kind: "drafts", tooOld,
      sentence: `${made.length} thank-you ${made.length === 1 ? "draft" : "drafts"} waiting for you in Thank-yous. Nothing was sent.`
        + (tooOld ? ` ${tooOld.toLocaleString("en-US")} ${tooOld === 1 ? "gift is" : "gifts are"} older than ${HG.HISTORY_DAYS} days and got none.` : "") });
  }
  if (line.action === "open_group") {
    const gid = (line.rows || []).map(x => x.groupId).find(Boolean) || null;
    await record(null, gid);
    return res.json({ ok: true, made: 0, kind: "open", open: { tab: "groups", groupId: gid } });
  }
  if (line.action === "open_data_health") {
    await record(null, null);
    return res.json({ ok: true, made: 0, kind: "open", open: { tab: "datahealth" } });
  }
  res.status(400).json({ error: "unknown_action" });
}));

app.post("/readouts/:id/lines/:kind/dismiss", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await readoutRow(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "not_found" });
  const kind = String(req.params.kind);
  if (!RO.KINDS[kind]) return res.status(400).json({ error: "unknown_kind" });
  const who = actor(req);
  await run(
    `INSERT INTO readout_events (id, org_id, readout_id, line_kind, event, created_by, created_by_name)
     VALUES (?,?,?,?,'dismissed',?,?)`, ["re_" + uuid().replace(/-/g, "").slice(0, 14), orgId, r.id, kind, who.id, who.name]);
  const demoted = await RO.demotedKinds(orgId);
  res.json({ ok: true, demoted: demoted.has(kind),
    sentence: demoted.has(kind) ? `"${RO.KIND_NAMES[kind]}" lines will show at the bottom from now on. You can put them back.` : null });
}));

app.post("/readout-kinds/:kind/restore", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const kind = String(req.params.kind);
  if (!RO.KINDS[kind]) return res.status(400).json({ error: "unknown_kind" });
  const who = actor(req);
  await run(
    `INSERT INTO readout_events (id, org_id, line_kind, event, created_by, created_by_name) VALUES (?,?,?,'restored',?,?)`,
    ["re_" + uuid().replace(/-/g, "").slice(0, 14), orgId, kind, who.id, who.name]);
  res.json({ ok: true, demoted: (await RO.demotedKinds(orgId)).has(kind) });
}));

// BEFORE ANYONE SAVES: how many thank-you drafts this file will create. A
// gift dated in the last 30 days of the org's calendar is new to the donor
// and gets a draft (historyGifts.js, the FIX-36 rule); an older one does not.
// "Up to", because a deceased or do-not-contact donor gets none.
app.post("/imports/thank-you-preview", requireAuth, wrap(async (req, res) => {
  const HG = require("../historyGifts");
  const today = orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK
  const dates = Array.isArray(req.body?.dates) ? req.body.dates.slice(0, 200000) : [];
  const n = dates.filter(d => !HG.isOldHistory(d, today)).length;
  res.json({ thankYous: n, days: HG.HISTORY_DAYS,
    sentence: n
      ? `This import will draft up to ${n.toLocaleString("en-US")} thank-you ${n === 1 ? "note" : "notes"}, one for each gift from the last ${HG.HISTORY_DAYS} days. Nothing is sent; they wait for you.`
      : `This import drafts no thank-you notes: every gift in it is more than ${HG.HISTORY_DAYS} days old.` });
}));

// ── FILES MAP THEMSELVES ─────────────────────────────────────────────────
// The answer saved for a file is matched by its header shape. A file whose
// headers are a superset of a saved shape maps every column the shape knew,
// and asks only about the columns it did not.
app.post("/import-shapes/match", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const headers = Array.isArray(req.body?.headers) ? req.body.headers.map(String) : [];
  const norm = headers.map(normHeader);
  const have = new Set(norm.filter(Boolean));
  const rows = await query(`SELECT * FROM import_shape_mappings WHERE org_id=? ORDER BY last_used_at DESC`, [orgId]);
  let best = null;
  for (const r of rows) {
    const hs = (typeof r.headers === "string" ? JSON.parse(r.headers) : r.headers).map(normHeader);
    const covered = hs.filter(h => have.has(h)).length;
    // Every column the saved file had must still be here (an export that lost
    // a column is a different file); the more columns it covers, the better.
    if (covered !== hs.length) continue;
    if (!best || covered > best.covered) best = { row: r, covered };
  }
  if (!best) return res.json({ matched: false, mapping: null, newHeaders: headers });
  const mapping = typeof best.row.mapping === "string" ? JSON.parse(best.row.mapping) : best.row.mapping;
  const knownNorm = new Set(Object.keys(mapping).map(normHeader));
  const out = {};
  for (const h of headers) { const k = Object.keys(mapping).find(m => normHeader(m) === normHeader(h)); if (k) out[h] = mapping[k]; }
  await run(`UPDATE import_shape_mappings SET times_used = times_used + 1, last_used_at = NOW() WHERE id=? AND org_id=?`, [best.row.id, orgId]);
  res.json({ matched: true, id: best.row.id, mapping: out,
    newHeaders: headers.filter(h => normHeader(h) && !knownNorm.has(normHeader(h))),
    why: `You mapped a file with these same columns before, so Steward used your answers. It asks only about columns that file did not have.` });
}));

app.post("/import-shapes", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const headers = Array.isArray(req.body?.headers) ? req.body.headers.map(String).slice(0, 300) : [];
  const raw = req.body?.mapping && typeof req.body.mapping === "object" ? req.body.mapping : {};
  const mapping = {};
  for (const h of headers) if (raw[h] != null && String(raw[h]).length <= 120) mapping[h] = String(raw[h]);
  const key = shapeKey(headers);
  if (!key || !Object.keys(mapping).length) return res.status(400).json({ error: "nothing_to_save" });
  const who = actor(req);
  const rows = await query(
    `INSERT INTO import_shape_mappings (id, org_id, shape_key, headers, mapping, created_by, created_by_name)
     VALUES (?,?,?,?::jsonb,?::jsonb,?,?)
     ON CONFLICT (org_id, shape_key) DO UPDATE SET mapping = EXCLUDED.mapping, last_used_at = NOW()
     RETURNING id`,
    ["ism_" + uuid().replace(/-/g, "").slice(0, 12), orgId, key, JSON.stringify(headers), JSON.stringify(mapping), who.id, who.name]);
  res.json({ ok: true, id: rows[0].id });
}));

app.get("/import-values", requireAuth, wrap(async (req, res) => {
  const rows = await query(`SELECT field, raw, value FROM import_value_mappings WHERE org_id=?`, [req.user.orgId]);
  res.json({ values: rows });
}));

app.post("/import-values", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const list = Array.isArray(req.body?.values) ? req.body.values.slice(0, 200) : [];
  const who = actor(req);
  let saved = 0;
  for (const v of list) {
    const field = String(v?.field || ""), rawV = String(v?.raw || "").trim().slice(0, 120), value = String(v?.value || "").trim().slice(0, 120);
    if (!VALUE_FIELDS.has(field) || !rawV || !value || normHeader(rawV) === normHeader(value)) continue;
    await run(
      `INSERT INTO import_value_mappings (id, org_id, field, raw_norm, raw, value, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (org_id, field, raw_norm) DO UPDATE SET value = EXCLUDED.value, raw = EXCLUDED.raw,
         times_used = import_value_mappings.times_used + 1, updated_at = NOW()`,
      ["ivm_" + uuid().replace(/-/g, "").slice(0, 12), orgId, field, normHeader(rawV), rawV, value, who.id, who.name]);
    saved++;
  }
  res.json({ ok: true, saved });
}));
}

module.exports = { routers, mount, shapeKey, normHeader };
