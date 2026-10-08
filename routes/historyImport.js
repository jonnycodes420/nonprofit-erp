// routes/historyImport.js: IMPORT-2. BRING THEIR WHOLE HISTORY.
//
//   POST /history-import/preview   reads the file and says what would happen. Writes nothing.
//   POST /history-import/commit    writes it, every row tagged with the run, so
//                                  POST /imports/:id/reverse undoes it in one step.
//
// The judgement (what a row is, its date, its kind, who it belongs to, what
// preference its words state) is shared/historyImport.js, so the preview a
// person reads and the write that follows walk one plan. Nothing here guesses:
// a row that matches nobody or more than one person waits for a person's pick;
// a preference found in a note is set only when a person confirmed it.
//
// History is history: no thread is opened, nothing is sent, no workflow fires.
// Open tasks become real tasks (on the Thread and the Calendar by their due
// date); everything else is a dated line on the person's timeline.
"use strict";
const express = require("express");

const routers = { r0: express.Router() };
const ROW_CAP = 50000;
const RUN_ID_RE = /^imp_[A-Za-z0-9_-]{4,40}$/;
const CHUNK = 400;

function mount(ctx) {
const { query, run, runTx, withTransaction, requireAuth, checkWriteAccess, wrap, uuid, recomputeScoresForOrg, orgToday, orgTz } = ctx;
const app = routers.r0;
const H = () => import("../shared/historyImport.js");

// The people this org has, once, for matching.
async function orgIndex(orgId, Hm) {
  const donors = await query(
    `SELECT id, name, email, address, external_donor_id, external_donor_ids, city,
            do_not_solicit, do_not_contact, do_not_mail, do_not_email, do_not_call
       FROM donors WHERE org_id=? AND deleted_at IS NULL`, [orgId]);
  return { donors, byId: new Map(donors.map(d => [d.id, d])), index: Hm.buildIndex(donors) };
}

function readBody(body) {
  const b = body || {};
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, ROW_CAP) : [];
  const headers = Array.isArray(b.headers) ? b.headers.map(String) : Object.keys(rows[0] || {});
  return { rows, headers, mapping: b.mapping && typeof b.mapping === "object" ? b.mapping : null,
           fileName: String(b.fileName || "").slice(0, 200) || null, picks: b.picks && typeof b.picks === "object" ? b.picks : {} };
}

// The preferences a plan proposes, one per person per flag, with every line
// that said it. `already` is true when the record already carries the flag.
function proposals(items, byId, Hm) {
  const out = new Map();
  for (const it of items) {
    if (it.refused || it.match.status !== "matched") continue;
    const d = byId.get(it.match.donorId);
    if (!d) continue;
    for (const p of it.prefs) {
      const k = `${d.id}|${p.flag}`;
      if (!out.has(k)) out.set(k, { donorId: d.id, name: d.name, flag: p.flag, label: Hm.PREFS[p.flag].label,
                                    phrase: p.phrase, lines: [], already: d[p.flag] === true });
      out.get(k).lines.push(it.line);
    }
  }
  return [...out.values()];
}

const identityLabel = id => [id.name, id.email, id.externalId ? `old id ${id.externalId}` : null].filter(Boolean).join(" · ") || "No name, email or id";

app.post("/history-import/preview", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const Hm = await H();
  const orgId = req.user.orgId;
  const { rows, headers, mapping: given, fileName, picks } = readBody(req.body);
  if (!rows.length) return res.status(400).json({ error: "empty", sentence: "That file has no rows to read." });
  const preset = Hm.detectPreset(headers);
  const mapping = given || Hm.guessMapping(headers);
  const unmappedHeaders = headers.filter(h => !Object.values(mapping).includes(h));
  if (!mapping.note && !mapping.subject && !mapping.kind)
    return res.json({ preset, mapping, unmappedHeaders, fields: Object.keys(Hm.FIELDS), needsMapping: true,
      sentence: "Steward could not find a note, subject or type column. Choose which column holds what people wrote." });
  if (!mapping.date && !mapping.due)
    return res.json({ preset, mapping, unmappedHeaders, fields: Object.keys(Hm.FIELDS), needsMapping: true,
      sentence: "Steward could not find a date column. Every line of history needs its original date." });
  const { byId, index } = await orgIndex(orgId, Hm);
  const { items, counts } = Hm.planHistory(rows, mapping, index, { picks });
  const tz = await orgTz(orgId);
  const today = orgToday(tz);
  counts.openTasksOverdue = items.filter(it => !it.refused && it.kind === "task" && it.taskOpen && it.due && it.due < today).length;

  const sample = items.filter(it => !it.refused && it.match.status === "matched").slice(0, 10).map(it => ({
    line: it.line, donorId: it.match.donorId, donorName: byId.get(it.match.donorId)?.name || "",
    kind: it.kind, kindLabel: Hm.KINDS[it.kind].label, date: it.date, author: it.author,
    text: Hm.timelineNote(it).slice(0, 400), due: it.due, taskOpen: it.taskOpen, matchedBy: it.match.method,
  }));
  const cand = id => { const d = byId.get(id); return d ? { id, name: d.name, email: d.email || null, city: d.city || null } : { id }; };
  const ambiguous = items.filter(it => !it.refused && it.match.status === "ambiguous").map(it => ({
    line: it.line, index: it.index, who: identityLabel(it.identity), method: it.match.method, candidates: it.match.candidates.map(cand) }));
  // Unmatched rows, grouped by who they name, so "create this person" is one
  // decision per person rather than one per line.
  const groups = new Map();
  for (const it of items) {
    if (it.refused || it.match.status !== "unmatched") continue;
    const key = (it.identity.email || Hm.nameKey(it.identity.name) || it.identity.externalId || `line${it.line}`).toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, who: identityLabel(it.identity), canCreate: !!(it.identity.name || it.identity.email), lines: [], indexes: [] });
    groups.get(key).lines.push(it.line); groups.get(key).indexes.push(it.index);
  }
  res.json({
    fileName, preset, mapping, unmappedHeaders, fields: Object.keys(Hm.FIELDS),
    counts, sample,
    ambiguous, unmatched: [...groups.values()],
    refused: items.filter(it => it.refused).map(it => ({ line: it.line, reason: it.refused })),
    dayFirst: items.filter(it => it.dayFirst).map(it => ({ line: it.line, raw: String(rows[it.index][mapping.date] ?? rows[it.index][mapping.due] ?? ""), read: it.date })),
    prefs: proposals(items, byId, Hm),
    definition: "Every row of the file: matched to a person by the old system's id, then email, then name. Rows that match nobody or more than one person wait for you. Nothing is saved until you press Bring it in.",
    dateRule: "Dates are read month first. A date that cannot be month first, like 20/10/2023, is read day first, and those rows are listed here.",
  });
}));

app.post("/history-import/commit", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const Hm = await H();
  const orgId = req.user.orgId;
  const actorId = req.user.userId;
  const [me] = await query("SELECT id, name FROM users WHERE id=? AND org_id=?", [actorId, orgId]);
  const actorName = me?.name || req.user.name || "Import";
  const runId = String(req.body?.importId || "");
  if (!RUN_ID_RE.test(runId)) return res.status(400).json({ error: "bad_import_id" });
  const [dupe] = await query("SELECT id FROM imports WHERE id=?", [runId]);
  if (dupe) return res.status(409).json({ error: "import_id_used", sentence: "That import has already been recorded." });
  const { rows, headers, mapping: given, fileName, picks } = readBody(req.body);
  if (!rows.length) return res.status(400).json({ error: "empty", sentence: "That file has no rows to read." });
  const mapping = given || Hm.guessMapping(headers);
  const create = new Set((Array.isArray(req.body?.create) ? req.body.create : []).map(Number).filter(Number.isInteger));
  const confirm = Array.isArray(req.body?.confirmFlags) ? req.body.confirmFlags : [];

  const { donors, byId, index } = await orgIndex(orgId, Hm);
  // Picks must be this org's people. An id off a request body is never trusted.
  const cleanPicks = {};
  for (const [k, v] of Object.entries(picks)) if (byId.has(String(v))) cleanPicks[Number(k)] = String(v);

  // People a person asked to create, one per identity they named.
  let { items } = Hm.planHistory(rows, mapping, index, { picks: cleanPicks });
  const created = new Map();
  for (const it of items) {
    if (it.refused || it.match.status !== "unmatched" || !create.has(it.index)) continue;
    const name = it.identity.name || it.identity.email;
    if (!name) continue;
    const key = (it.identity.email || Hm.nameKey(it.identity.name) || name).toLowerCase();
    if (!created.has(key)) created.set(key, { id: "d_" + uuid().slice(0, 10), name: name.replace(/^([^,]+),\s*(.+)$/, "$2 $1"),
      email: it.identity.email || "", externalId: it.identity.externalId || null });
    cleanPicks[it.index] = created.get(key).id;
  }
  if (created.size) {
    for (const c of created.values()) byId.set(c.id, { id: c.id, name: c.name, email: c.email });
    ({ items } = Hm.planHistory(rows, mapping, index, { picks: cleanPicks }));
  }

  // Confirmed preferences: only ones this plan actually proposed, on a record
  // that does not already carry them.
  const proposed = new Set(proposals(items, byId, Hm).filter(p => !p.already).map(p => `${p.donorId}|${p.flag}`));
  const flagsSet = [];
  for (const c of confirm) {
    const k = `${c?.donorId}|${c?.flag}`;
    if (proposed.has(k) && Hm.PREFS[c.flag]) { flagsSet.push({ donorId: String(c.donorId), flag: c.flag }); proposed.delete(k); }
  }

  // Task owners: a name in the file that is a person on this team, else the
  // person importing (the same default a task made by hand has).
  const users = await query("SELECT id, name FROM users WHERE org_id=? AND deactivated_at IS NULL", [orgId]).catch(() => []);
  const userByName = new Map(users.map(u => [String(u.name || "").trim().toLowerCase(), u]));
  const ownerFor = it => userByName.get(String(it.owner || it.author || "").trim().toLowerCase()) || { id: actorId, name: actorName };

  const tz = await orgTz(orgId);
  const today = orgToday(tz);
  const write = items.filter(it => !it.refused && it.match.status === "matched");
  const touched = [...new Set(write.map(it => it.match.donorId))];

  // Engagement before, for the before-and-after spread the report gives.
  const spread = async () => {
    if (!touched.length) return {};
    const r = await query(
      `SELECT COALESCE(s.band, 'none') AS band,
              EXISTS (SELECT 1 FROM interactions i WHERE i.org_id=? AND i.donor_id=d.id AND i.type NOT IN ('gift','payment','email_open')) AS has_history
         FROM donors d LEFT JOIN donor_scores s ON s.donor_id=d.id AND s.org_id=d.org_id
        WHERE d.org_id=? AND d.id = ANY(?)`, [orgId, orgId, touched]);
    const out = {};
    for (const x of r) { const k = x.has_history ? x.band : "no_history"; out[k] = (out[k] || 0) + 1; }
    return out;
  };
  const before = await spread();

  const ixWritten = [], attachments = [];
  let tasksCreated = 0, completedAsHistory = 0, relationships = 0;
  const tagsAdded = [];
  await withTransaction(async txc => {
    for (const c of created.values()) {
      await runTx(txc, `INSERT INTO donors (id,org_id,name,email,status,tags,notes,external_donor_id,created_import_id,created_by,created_by_name)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [c.id, orgId, c.name, c.email, "new", "[]", "", c.externalId, runId, actorId, actorName]);
    }
    const ixRows = [], taskRows = [];
    for (const it of write) {
      if (it.kind === "task" && it.taskOpen) {
        const owner = ownerFor(it);
        taskRows.push(["t_" + uuid().slice(0, 10), orgId, (it.subject || it.note || "Task from your old system").split("\n")[0].slice(0, 200),
          it.due || it.date, "medium", "other", it.match.donorId, owner.id, owner.name, actorId, actorName, runId,
          [it.note && it.note !== it.subject ? it.note : null, it.attachment ? `${it.attachment} was attached in your old system.` : null].filter(Boolean).join("\n") || null]);
        continue;
      }
      const isVisit = it.kind === "visit";
      const type = it.kind === "task" ? "note" : isVisit ? "meeting" : it.kind;
      let note = Hm.timelineNote(it);
      if (it.kind === "task") { note = `Task completed in your old system: ${note}`; completedAsHistory++; }
      const id = "int_" + uuid().slice(0, 10);
      ixRows.push([id, orgId, it.match.donorId, type, note, it.date, actorId, it.author, runId,
        JSON.stringify({ source: "history-import", kind: isVisit ? "visit" : it.kind, originalType: it.typeWord, author: it.author,
                         attachment: it.attachment, dayFirst: it.dayFirst || undefined, wasHtml: it.wasHtml || undefined, line: it.line })]);
      ixWritten.push(id);
      if (it.attachment) attachments.push({ line: it.line, interactionId: id, fileName: it.attachment, donorId: it.match.donorId });
    }
    for (let i = 0; i < ixRows.length; i += CHUNK) {
      const batch = ixRows.slice(i, i + CHUNK);
      await runTx(txc, `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,import_id,metadata)
                        VALUES ${batch.map(() => "(?,?,?,?,?,?,?,?,?,?::jsonb)").join(",")}`, batch.flat());
    }
    for (let i = 0; i < taskRows.length; i += CHUNK) {
      const batch = taskRows.slice(i, i + CHUNK);
      await runTx(txc, `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,created_by,created_by_name,import_id,notes,updated_at)
                        VALUES ${batch.map(() => "(?,?,?,?,?,?,0,?,?,?,?,?,?,?,NOW())").join(",")}`, batch.flat());
    }
    tasksCreated = taskRows.length;
    // Relationships the file names, where the other person is one Steward can
    // find by name without guessing.
    for (const it of write) {
      if (!it.relatedTo) continue;
      const m = Hm.matchRow({ name: it.relatedTo }, index);
      if (m.status !== "matched" || m.donorId === it.match.donorId) continue;
      const t = String(it.relationship || "knows").toLowerCase().replace(/[^a-z_ ]/g, "").trim().replace(/\s+/g, "_") || "knows";
      await runTx(txc, `INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type,notes,created_by,created_by_name,import_id)
                        VALUES (?,?,?,?,?,?,?,?,?)`,
        ["rel_" + uuid().slice(0, 10), orgId, it.match.donorId, m.donorId, t, "From your old system", actorId, actorName, runId]);
      relationships++;
    }
    // Tags, appended and remembered so the undo takes back only these.
    const tagMap = new Map();
    for (const it of write) for (const t of it.tags) {
      if (!tagMap.has(it.match.donorId)) tagMap.set(it.match.donorId, new Set());
      tagMap.get(it.match.donorId).add(t);
    }
    for (const [donorId, set] of tagMap) {
      const r = await txc.query("SELECT tags FROM donors WHERE org_id=$1 AND id=$2", [orgId, donorId]);
      let tags = []; try { tags = JSON.parse(r.rows[0]?.tags || "[]"); } catch { tags = []; }
      const have = new Set(tags.map(x => String(x).toLowerCase()));
      const add = [...set].filter(t => !have.has(t.toLowerCase()));
      if (!add.length) continue;
      await runTx(txc, "UPDATE donors SET tags=? WHERE org_id=? AND id=?", [JSON.stringify([...tags, ...add]), orgId, donorId]);
      tagsAdded.push({ donorId, tags: add });
    }
    for (const f of flagsSet)
      await runTx(txc, `UPDATE donors SET ${f.flag}=true WHERE org_id=? AND id=?`, [orgId, f.donorId]);
  });

  await recomputeScoresForOrg(orgId).catch(e => console.error("[history-import] scores", e.message));
  const after = await spread();
  const counts = Hm.countPlan(items);
  counts.openTasksOverdue = items.filter(it => !it.refused && it.kind === "task" && it.taskOpen && it.due && it.due < today).length;
  const summary = { preset: Hm.detectPreset(headers).key, counts, written: { interactions: ixWritten.length, tasks: tasksCreated,
    completedAsHistory, relationships, peopleCreated: created.size, flagsSet: flagsSet.length },
    flagsSet, tagsAdded, engagement: { before, after } };
  await run(
    `INSERT INTO imports (id,org_id,name,source_filename,shape,started_at,committed_at,rows_in,donors_created,rows_set_aside,
                          actor_user_id,actor_user_name,summary_json)
     VALUES (?,?,?,?,'history',NOW(),NOW(),?,?,?,?,?,?::jsonb)`,
    [runId, orgId, "Notes and history", fileName, rows.length, created.size, counts.refused + counts.ambiguous + counts.unmatched - [...create].length,
     actorId, actorName, JSON.stringify(summary)]);
  res.json({ ok: true, importId: runId, ...summary.written, attachments, engagement: summary.engagement, counts,
    sentence: `Brought in ${ixWritten.length.toLocaleString()} history ${ixWritten.length === 1 ? "line" : "lines"} and ${tasksCreated} open ${tasksCreated === 1 ? "task" : "tasks"} for ${touched.length.toLocaleString()} ${touched.length === 1 ? "person" : "people"}.`
      + (flagsSet.length ? ` ${flagsSet.length} ${flagsSet.length === 1 ? "preference" : "preferences"} set, as you confirmed.` : "")
      + " Undo takes all of it back in one step." });
}));
}

module.exports = { routers, mount };
