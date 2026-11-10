// server/imports/gifts.js — gift history, cheques and deposits, statement mappings, the move from an old system, import merges and saved field mappings.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// FIX-12 Part 3: the one door to a model (asks the org's AI switch on every call).
const { anthropicFor, requireAi, transcribeAudio, AiOffError, AI_OFF_MESSAGE, recordAiFallback } = require("../../aiClient");
const NUMBERS = require("../../shared/numbers");   // NUMBERS-3 — one home for every giving number
const EG = require("../events/eventGifts");   // GIFTS-1: a gift's event, by id or by its exact name
const lapseRule = require("../../lapseRule");   // FIX-49: the one lapse rule

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  CF_ENTITIES, DEPOSIT_REVERSE_HOURS, IMPORT_GIFT_BATCH, IMPORT_RUN_ID_RE, IT, UNDO_NOT_YOURS, actor, aiGate,
  campaignIdResolver, checkWriteAccess, duplicateGroupsFrom, ensureOrgLedger, imageBytesMatchMime, importId,
  importLedger, importValueMapper, kickRecentWork, markImportInFlight, mayUndoImport, money, moveMod,
  normalizeGiftDate, orgFiscalYearStart, orgToday, orgTz, query, queryTx, queueRecentWork,
  recalcDonorSummaryBatch, recalcPledgePayment, recordGift, requireAdmin, requireAuth, round2, run, runTx,
  storeChequeImage, toCents, toDollars, uniqueImportName, uuid, withSavepoint, withTransaction, wrap,
  wrapImport,
} = ctx;



// ── BUILD-92 A4 — ANY STATEMENT, REMEMBERED ────────────────────────────────
//
// "A bank or other statement" is ONE generic preset on the EXISTING mapper -
// not a second importer, not a vendor list. The brief's rule is kept: no named
// preset for Givelify, Tithe.ly or anyone else without a real exported file in
// the repo to build it against, and there is none for any of them.
//
// What is stored here is the ANSWER she gave the mapper once: which columns
// are the date, the amount and the name, what the source is called, and
// whether negative rows are dropped. Next month the same columns arrive and
// there is nothing to click.
//
// Nothing here has credentials, syncs, or reaches a provider.
const STATEMENT_MAPPING_FIELDS = ["date", "amount", "donorName", "donorEmail", "notes", "externalId"];

function statementMappingPayload(r) {
  return {
    id: r.id, name: r.name, presetKey: r.preset_key,
    mapping: typeof r.mapping === "string" ? JSON.parse(r.mapping) : r.mapping,
    dropNegative: r.drop_negative !== false,
    paymentMethod: r.payment_method || null,
    timesUsed: Number(r.times_used) || 0,
    lastUsedAt: r.last_used_at, createdAt: r.created_at,
  };
}
let app = routers.r1;

app.get("/statement-mappings", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT * FROM statement_mappings WHERE org_id=? ORDER BY COALESCE(last_used_at, created_at) DESC, name ASC`,
    [req.user.orgId]);
  res.json({ mappings: rows.map(statementMappingPayload) });
}));

// Save, or correct, a mapping under a NAME. Saving the same name twice
// corrects it rather than minting a second one she then has to choose between.
app.post("/statement-mappings", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "name_required", message: "Give this source a name, like \"Zelle at Central Bank\"." });
  const raw = req.body?.mapping || {};
  const mapping = {};
  for (const f of STATEMENT_MAPPING_FIELDS) {
    const v = String(raw[f] ?? "").trim();
    if (v) mapping[f] = v.slice(0, 120);
  }
  // The three she is asked for. Without a date and an amount there is no gift;
  // without a name there is nobody to put it on, and guessing a donor is the
  // one thing this product does not do.
  const missing = ["date", "amount", "donorName"].filter(f => !mapping[f]);
  if (missing.length) return res.status(400).json({ error: "missing_columns", missing });

  const a = actor(req);
  const id = newId("sm");
  const rows = await query(
    `INSERT INTO statement_mappings (id,org_id,name,preset_key,mapping,drop_negative,payment_method,created_by,created_by_name)
     VALUES (?,?,?,?,?::jsonb,?,?,?,?)
     ON CONFLICT (org_id, LOWER(name)) DO UPDATE
       SET mapping = EXCLUDED.mapping, drop_negative = EXCLUDED.drop_negative,
           payment_method = EXCLUDED.payment_method, preset_key = EXCLUDED.preset_key,
           updated_at = NOW()
     RETURNING *`,
    [id, orgId, name, String(req.body?.presetKey || "generic_statement"), JSON.stringify(mapping),
     req.body?.dropNegative !== false, String(req.body?.paymentMethod || "").trim().slice(0, 60) || null,
     a.id, a.name]);
  res.json({ ok: true, mapping: statementMappingPayload(rows[0]) });
}));

// ZERO CLICKS, THE SECOND TIME. The file's headers come in, and if one saved
// mapping names only columns this file has, it IS the answer - the mapper
// applies it and the review step opens already filled in.
//
// A read that records it was used (so ties break on recency), which is why it
// is a POST: the headers are the file's, and a GET could not carry them.
app.post("/statement-mappings/match", requireAuth, wrap(async (req, res) => {
  const { matchSavedMapping } = await import("../../shared/sourcePresets.js");
  const headers = Array.isArray(req.body?.headers) ? req.body.headers.map(h => String(h || "")) : [];
  const rows = await query(`SELECT * FROM statement_mappings WHERE org_id=?`, [req.user.orgId]);
  const saved = rows.map(statementMappingPayload);
  const hit = matchSavedMapping(headers, saved);
  if (!hit) return res.json({ matched: false, mapping: null, savedCount: saved.length });
  await run(`UPDATE statement_mappings SET times_used = times_used + 1, last_used_at = NOW() WHERE id=? AND org_id=?`,
            [hit.id, req.user.orgId]);
  res.json({ matched: true, mapping: { ...hit, timesUsed: hit.timesUsed + 1 }, savedCount: saved.length });
}));

app.delete("/statement-mappings/:id", requireAuth, wrap(async (req, res) => {
  const r = await query(`DELETE FROM statement_mappings WHERE id=? AND org_id=? RETURNING id`,
                        [req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "mapping not found" });
  res.json({ ok: true });
}));

// The state, plus the count of runs, in one read. `imports` carrying
// migration_source is what makes "3 imports" a fact rather than a guess.
async function moveState(orgId) {
  const [org] = await query(
    `SELECT migration_source, migration_started_at, migration_completed_at,
            migration_completed_by, migration_completed_by_name, migration_undo_until
       FROM orgs WHERE id=?`, [orgId]);
  if (!org) return null;
  const runs = await query(
    `SELECT id, name, committed_at, migration_source, gifts_created, donors_created, dollars_created
       FROM imports
      WHERE org_id=? AND reversed_at IS NULL AND migration_source IS NOT NULL
      ORDER BY committed_at ASC`, [orgId]);
  return {
    source: org.migration_source || null,
    startedAt: org.migration_started_at || null,
    completedAt: org.migration_completed_at || null,
    completedByName: org.migration_completed_by_name || null,
    undoUntil: org.migration_undo_until || null,
    imports: runs.length,
    // TRANS-1 Part 5 — what the move has actually brought, so Home can say
    // "this is your file" only once there is a file, and can tell her in one
    // sentence when the file carried people but no giving history.
    giftsImported: runs.reduce((a, r) => a + (Number(r.gifts_created) || 0), 0),
    peopleImported: runs.reduce((a, r) => a + (Number(r.donors_created) || 0), 0),
    runs: runs.map(r => ({
      id: r.id, name: r.name, at: r.committed_at, source: r.migration_source,
      gifts: Number(r.gifts_created) || 0, dollars: Number(r.dollars_created) || 0,
    })),
  };
}

// The Settings card, and what the import screen reads to know it is mid-move.
app.get("/move", requireAuth, wrap(async (req, res) => {
  const M = await moveMod();
  const st = await moveState(req.user.orgId);
  if (!st) return res.status(404).json({ error: "org not found" });
  const undoOpen = M.moveUndoOpen(st.undoUntil, new Date());
  // HARDEN-1 · HOME'S LINE READS THE FILE AS IT IS NOW. It summed the move's
  // runs (`donors_created`, `gifts_created`, written at commit), so one move
  // run of 40 people said "This is your file, 40 people, and no giving history
  // in it yet" above 1,208 donors whose gifts came in another way. These are
  // the onboarding card's own two counts (/org/setup-status).
  const [[livePeople], [liveGifts]] = await Promise.all([
    // NUMBERS-4: people, counted once (shared/numbers/households.js).
    NUMBERS.households.counts(query, req.user.orgId).then(c => [{ n: c.people }]),
    // NUMBERS-3 (D-7): a soft or matching credit row is not a gift on file.
    query(`SELECT COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
             WHERE g.org_id = ? AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE AND ${NUMBERS.money.MONEY("g")}`, [req.user.orgId]),
  ]);
  res.json({
    move: {
      ...st,
      label: st.source ? M.moveTileLabel(st.source) : null,
      isPreset: st.source ? M.moveTileIsPreset(st.source) : false,
      active: !!st.source && !st.completedAt,
      undoOpen,
      undoDays: M.MOVE_UNDO_DAYS,
      homeLine: M.moveHomeLine({
        active: !!st.source && !st.completedAt,
        imports: st.imports, giftsImported: Number(liveGifts && liveGifts.n) || 0, peopleImported: Number(livePeople && livePeople.n) || 0,
      }),
    },
  });
}));

// The tiles and their how-to pages, so the client's picker IS this list and
// cannot drift from the presets behind it. Public to a signed-in user: it is
// product copy, and onboarding reads it before an org has any data.
app.get("/move/sources", requireAuth, wrap(async (req, res) => {
  const M = await moveMod();
  res.json({
    tiles: M.MOVE_TILES.map(t => ({
      key: t.key, label: M.moveTileLabel(t.key), sub: t.sub || null,
      kind: t.kind, isPreset: M.moveTileIsPreset(t.key),
    })),
    howTo: Object.fromEntries(M.MOVE_TILE_KEYS.map(k => [k, M.moveHowTo(k)])),
  });
}));

// Picking a tile. Idempotent, and it never moves `started_at` backwards or
// forwards: the day she started is the day she started, and pressing a
// different tile later corrects the source without rewriting that.
app.post("/move/start", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const M = await moveMod();
  const source = String(req.body?.source || "").trim();
  if (!M.moveTile(source)) return res.status(400).json({ error: "unknown_source", message: "Pick one of the systems on the list." });
  await run(
    `UPDATE orgs SET migration_source=?,
       migration_started_at = COALESCE(migration_started_at, NOW())
     WHERE id=?`, [source, req.user.orgId]);
  const st = await moveState(req.user.orgId);
  res.json({ ok: true, move: { ...st, label: M.moveTileLabel(source), howTo: M.moveHowTo(source) } });
}));

// "We've moved." It ends the move: it stops prompting for re-imports, and it
// is DATED. Nothing is deleted, and it can be undone for 30 days.
app.post("/move/complete", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const M = await moveMod();
  const st = await moveState(req.user.orgId);
  if (!st || !st.source) return res.status(400).json({ error: "no_move", message: "There is no move to finish." });
  if (st.completedAt) return res.status(409).json({ error: "already_complete", message: "This move is already finished." });
  const a = actor(req);
  const [me] = a.id ? await query("SELECT name FROM users WHERE id=? AND org_id=?", [a.id, req.user.orgId]) : [];
  await run(
    `UPDATE orgs SET migration_completed_at = NOW(),
       migration_undo_until = NOW() + INTERVAL '${Number(M.MOVE_UNDO_DAYS)} days',
       migration_completed_by = ?, migration_completed_by_name = ?
     WHERE id=?`, [a.id || null, (me && me.name) || a.name || null, req.user.orgId]);
  const after = await moveState(req.user.orgId);
  res.json({ ok: true, move: { ...after, label: M.moveTileLabel(after.source), undoOpen: true, undoDays: M.MOVE_UNDO_DAYS } });
}));

// Undo, for 30 days. After that the button is simply history and this answers
// 409 rather than quietly doing nothing.
app.post("/move/undo", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const M = await moveMod();
  const st = await moveState(req.user.orgId);
  if (!st || !st.completedAt) return res.status(400).json({ error: "not_complete", message: "This move has not been finished." });
  if (!M.moveUndoOpen(st.undoUntil, new Date()))
    return res.status(409).json({ error: "undo_expired",
      message: `The ${M.MOVE_UNDO_DAYS}-day window to undo this has passed. Nothing was deleted; your Move Reports are all still here.` });
  await run(
    `UPDATE orgs SET migration_completed_at = NULL, migration_undo_until = NULL,
       migration_completed_by = NULL, migration_completed_by_name = NULL
     WHERE id=?`, [req.user.orgId]);
  const after = await moveState(req.user.orgId);
  res.json({ ok: true, move: { ...after, label: after.source ? M.moveTileLabel(after.source) : null, undoOpen: false } });
}));

// ── BUILD-88b B.1 — THE DEPOSIT SHEET ─────────────────────────────────────
// A treasurer's Monday: eleven lines on a bank slip, a name, an amount, and a
// memo somebody wrote on the back of a cheque. Eleven trips through the gift
// form, and nothing told her she had finished except adding it up herself.
//
// Two routes and no third: PLAN (reads, writes nothing, can be asked again as
// she answers each question) and COMMIT (one transaction, one `imports` row
// with shape='deposit', every gift through BUILD-88a's ONE gift path). The
// engine is shared/depositSheet.js — pure, and built on A.7's own matching
// rules, so a name the importer would fold and a name the deposit sheet would
// fold are the same name.
//
// NOTHING IS SENT. A deposit records money; the thank-yous it earns are drafts
// in B.3's queue, which she opens.
const depositMod = () => import("../../shared/depositSheet.js");

// The org's own data the plan is matched against, in ONE batch of reads.
async function depositContext(orgId) {
  const [donors, funds, installments, org] = await Promise.all([
    // Every person on file, once. A deposit is an explicit act on a small
    // slip, so one indexed read of (id, name, email) is the right cost — and it
    // means the name rule lives in shared/depositSheet.js rather than in SQL.
    query("SELECT id, name, email FROM donors WHERE org_id=? AND deleted_at IS NULL", [orgId]),
    query("SELECT id, name, restricted, aliases FROM fin_funds WHERE org_id=? ORDER BY restricted ASC, name ASC", [orgId]),
    query(`SELECT i.id, i.pledge_id, i.due_date, i.amount, p.donor_id
             FROM pledge_installments i
             JOIN pledges p ON p.id = i.pledge_id AND p.org_id = i.org_id
            WHERE i.org_id=? AND i.paid_gift_id IS NULL AND p.status='open'
            ORDER BY i.due_date ASC`, [orgId]),
    query("SELECT default_fund_id FROM orgs WHERE id=?", [orgId]),
  ]);
  return {
    donors: donors.map(d => ({ id: d.id, name: d.name, email: d.email })),
    funds: funds.map(f => ({ id: f.id, name: f.name, restricted: f.restricted,
                             aliases: Array.isArray(f.aliases) ? f.aliases : (typeof f.aliases === "string" ? JSON.parse(f.aliases || "[]") : []) })),
    installments: installments.map(i => ({ id: i.id, pledgeId: i.pledge_id, donorId: i.donor_id,
                                           dueDate: i.due_date, amountCents: money.toCents(i.amount) ?? 0 })),
    defaultFundId: org[0]?.default_fund_id || null,
  };
}

async function planDeposit(orgId, body) {
  const dep = await depositMod();
  const parsed = Array.isArray(body.rows) && body.rows.length
    ? { rows: body.rows.map((r, i) => ({ line: Number(r.line) || i + 1, raw: r.raw || "",
                                          name: String(r.name || ""), amount: r.amount,
                                          memo: String(r.memo || ""), check: String(r.check || "") })), refused: [] }
    : dep.parseDepositPaste(body.paste || "");
  const ctx = await depositContext(orgId);
  const plan = dep.buildDepositPlan({
    rows: parsed.rows, refused: parsed.refused,
    donors: ctx.donors, funds: ctx.funds, installments: ctx.installments,
    defaultFundId: ctx.defaultFundId,
    slipTotal: body.slipTotal, depositDate: body.depositDate || null,
    resolutions: body.resolutions && typeof body.resolutions === "object" ? body.resolutions : {},
  });
  return { ...plan, funds: ctx.funds.map(f => ({ id: f.id, name: f.name, restricted: f.restricted })) };
}

// POST /deposits/plan — read only. Called again after every answer she gives.
// ── BUILD-95 — READING THE CHEQUES ─────────────────────────────────────────
// It PROPOSES, and it cannot post. This route writes NOTHING: no gift, no
// donor, no image, no row of any kind. It hands back what it read, the deposit
// sheet places it under its own four-state rule, and a person commits it.
//
// The model TRANSCRIBES; `shared/chequeRead.js` does the arithmetic. A cheque
// carries its amount twice and Steward checks the two against each other — a
// real verification, unlike a model's own account of how sure it feels.
//
// checkWriteAccess, and the reason is not the convention's usual one: reads are
// never gated here, but this read is an outbound SPEND on somebody else's
// behalf, and a lapsed org cannot commit the deposit it would feed anyway.
app.post("/deposits/read-cheques", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const cr = await import("../../shared/chequeRead.js");
  const { normalizeMoney } = await import("../../shared/importShape.js");
  const items = Array.isArray(req.body?.cheques) ? req.body.cheques : [];
  if (!items.length) return res.status(400).json({ error: "no_cheques" });
  if (items.length > cr.CHEQUE_READ_MAX_IMAGES)
    return res.status(400).json({ error: "too_many", message: `Read at most ${cr.CHEQUE_READ_MAX_IMAGES} checks at a time.` });
  // BUILD-96 Part 3 — the same gate the agent uses. A photograph of a cheque
  // is the most sensitive image this product holds and it does not leave on a
  // different rule from the one the org read in Settings.
  const gate = await aiGate(req.user.orgId);
  if (!gate.ok) {
    return res.status(503).json({
      error: "reading_unavailable",
      reason: gate.reason,
      message: gate.reason === "ai_disabled"
        ? AI_OFF_MESSAGE + ". You can turn it back on in Settings, or type the checks in."
        : "Reading check photographs is not enabled yet.",
    });
  }

  const TOOL = {
    name: "record_cheque",
    description: "Record exactly what is written on this check.",
    strict: true,
    input_schema: cr.CHEQUE_READ_SCHEMA,
  };
  const client = anthropicFor(req.user.orgId);
  const money = c => "$" + (c / 100).toFixed(2);

  async function readOne(item) {
    const line = Number(item?.line) || 0;
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(String(item?.image || ""));
    if (!m) return { line, error: "not_an_image" };
    const bytes = Buffer.from(m[2], "base64");
    // Checked by CONTENT, not by what the caller called it (the BUILD-86 rule).
    if (!imageBytesMatchMime(bytes, m[1])) return { line, error: "not_an_image" };
    if (bytes.length > CHEQUE_MAX_BYTES) return { line, error: "too_large" };

    let out = null;
    try {
      const msg = await client.messages.create({
        model: cr.CHEQUE_READ_MODEL,
        max_tokens: 2048,
        system: cr.CHEQUE_READ_PROMPT,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "record_cheque" },
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
          { type: "text", text: "Transcribe this check." },
        ] }],
      });
      // Tool inputs are parsed, never string-matched (the 4.6+ escaping rule).
      const block = (msg.content || []).find(b => b.type === "tool_use" && b.name === "record_cheque");
      out = block ? block.input : null;
    } catch (e) {
      console.error("[cheque-read]", e?.message || e);
      return { line, error: "read_failed" };
    }
    if (!out) return { line, error: "read_failed" };

    const digitsCents = cr.chequeDigitsToCents(out.amountDigits || "", v => { const dm = normalizeMoney(v); return dm.value == null ? null : Math.round(dm.value * 100); });
    const wordsCents = cr.writtenAmountToCents(out.amountWords);
    const rec = cr.reconcileAmount(digitsCents, wordsCents);

    return {
      line,
      payer: out.payer || "",
      memo: out.memo || "",
      chequeNumber: out.chequeNumber || "",
      date: out.date || "",
      amountDigits: out.amountDigits || "",
      amountWords: out.amountWords || "",
      // The ONLY case an amount comes back filled: two independent readings
      // that agree to the cent.
      amountCents: rec.agreed ? rec.cents : null,
      settled: rec.agreed,
      // …and when they do not, the line says what it saw rather than picking.
      sentence: rec.agreed ? null : cr.unsettledSentence(rec, money),
      unreadable: Array.isArray(out.unreadable) ? out.unreadable : [],
    };
  }

  const reads = [];
  for (const item of items) reads.push(await readOne(item));
  res.json({
    reads,
    settled: reads.filter(r => r.settled).length,
    note: cr.CHEQUE_READ_NOTE,
  });
}));

app.post("/deposits/plan", requireAuth, wrap(async (req, res) => {
  const org = await orgTz(req.user.orgId);
  const today = orgToday(org);                                     // ORG_TZ_SEAM_OK
  const body = req.body || {};
  if (body.depositDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.depositDate)))
    return res.status(400).json({ error: "depositDate must be a date (YYYY-MM-DD)" });
  if (body.depositDate && String(body.depositDate) > today)
    return res.status(400).json({ error: "A deposit is a thing that happened, its date cannot be in the future." });
  const plan = await planDeposit(req.user.orgId, body);
  res.json({ ...plan, today });
}));

// POST /deposits/commit — one transaction, every gift through recordGift.
app.post("/deposits/commit", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const org = await orgTz(orgId);
  const today = orgToday(org);                                     // ORG_TZ_SEAM_OK
  const body = req.body || {};
  const depositDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.depositDate || "")) ? String(body.depositDate) : null;
  if (!depositDate) return res.status(400).json({ error: "A deposit needs the date it was deposited." });
  if (depositDate > today) return res.status(400).json({ error: "A deposit is a thing that happened, its date cannot be in the future." });

  // BUILD-95 — the cheque photographs, stored BEFORE any gift is written, so
  // a gift is never written pointing at bytes that failed to save. A photo
  // that will not store does NOT stop the deposit: the money is the point and
  // the picture is the evidence, so the line commits and the failure is
  // reported rather than losing eleven cheques to one bad JPEG.
  const chequeFailures = [];
  const chequeByLine = new Map();
  for (const l of (Array.isArray(body.lines) ? body.lines : [])) {
    if (!l || !l.chequeImage) continue;
    const r = await storeChequeImage({ orgId, dataUri: l.chequeImage });
    if (r.error) { chequeFailures.push({ line: Number(l.line), message: r.error }); continue; }
    chequeByLine.set(Number(l.line), r.assetId);
  }

  // GIFTS-1: the event each line's gift was given at, keyed by line like the
  // photograph; an event not in this org is refused before anything is written.
  const eventByLine = new Map();
  for (const l of (Array.isArray(body.lines) ? body.lines : [])) {
    if (!l || !l.eventId) continue;
    const ev = await EG.eventOf(query, orgId, l.eventId);
    if (!ev) return res.status(404).json({ error: "Event not found", line: Number(l.line) });
    eventByLine.set(Number(l.line), ev.id);
  }
  // QUICKADD-1: each line's campaign, appeal and fundraiser / giving page, and a
  // new person's email, phone and address, checked before anything is written.
  const attr = await require("../donors/giftAttribution").lineAttribution(query, orgId, body.lines, depositDate);
  if (attr.error) return res.status(attr.status).json({ error: attr.error, line: attr.line, ...(attr.code ? { code: attr.code } : {}) });
  const attrOf = line => attr.byLine.get(Number(line)) || {};

  // THE GATE, RE-EVALUATED HERE. The screen disables the button; the server
  // refuses the write. A client that has drifted from the plan (a stale tab, a
  // replayed request) cannot commit a slip that does not foot.
  const plan = await planDeposit(orgId, { ...body, depositDate });
  if (!plan.canCommit) {
    return res.status(409).json({
      error: "deposit_not_ready",
      message: plan.counts.needsYou > 0
        ? `${plan.counts.needsYou} line${plan.counts.needsYou === 1 ? "" : "s"} still need${plan.counts.needsYou === 1 ? "s" : ""} you.`
        : plan.totals.slipCents == null
          ? "Type the slip total so Steward can check its own arithmetic."
          : `The lines come to ${money.formatCents(plan.totals.accountedCents)} and the slip says ${money.formatCents(plan.totals.slipCents)}.`,
      counts: plan.counts, totals: plan.totals,
    });
  }

  const actorInfo = actor(req);
  const importId2 = newId("imp");
  const created = { gifts: 0, donors: 0, payments: 0, giftCents: 0, installments: 0 };
  const written = [];

  // Donors first, OUTSIDE the gift loop, so a name that appears twice on one
  // slip becomes one person with two gifts (a treasurer writes the same name
  // twice when two cheques arrive together).
  const newDonorIds = new Map();
  for (const l of plan.lines) {
    if (l.state !== "placed_new_donor") continue;
    const key = String(l.donorName || "").toLowerCase().trim();
    if (newDonorIds.has(key)) continue;
    const did = newId("d");
    const np = attrOf(l.line).person || {};   // QUICKADD-1: what she typed on the line, if anything
    await run(
      `INSERT INTO donors (id,org_id,name,stage,status,tags,notes,created_by,created_by_name,created_import_id,email,phone,address,city,state,zip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [did, orgId, l.donorName, "steward", "new", JSON.stringify([]),
       `Added from the deposit of ${depositDate}.`, actorInfo.id, actorInfo.name, importId2,
       np.email ? np.email.toLowerCase() : "", np.phone || "", np.address || null, np.city || null, np.state || null, np.zip || null]);
    newDonorIds.set(key, did);
    created.donors++;
  }

  for (const l of plan.lines) {
    if (l.state === "not_a_gift") {
      // MONEY ON THE SLIP THAT IS NOT A CONTRIBUTION. On a known person it is a
      // PAYMENT on their record — visible on the timeline, out of every giving
      // total, because a bookstore purchase is not a gift and counting it as
      // one overstates what the organisation raised.
      if (l.donorId) {
        await run(
          `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,import_id,metadata)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [newId("int"), orgId, l.donorId, "payment",
           `Payment, not a gift: ${money.formatCents(l.cents)}${l.memo ? ` ${l.memo}` : ""} (${l.reason.replace(/_/g, " ")})`,
           depositDate, actorInfo.id, actorInfo.name, importId2,
           JSON.stringify({ via: "deposit", kind: l.reason, cents: l.cents, check: l.check || null })]);
        created.payments++;
      }
      continue;
    }
    if (l.state !== "placed" && l.state !== "placed_new_donor") continue;
    const donorId = l.donorId || newDonorIds.get(String(l.donorName || "").toLowerCase().trim());
    if (!donorId) continue;
    const w = await recordGift({
      orgId, donorId, amount: money.toDollars(l.cents), date: depositDate,
      type: l.installmentId ? "pledge payment" : "cash",
      fundId: l.fundId || null,
      paymentMethod: l.check ? "Check" : (body.paymentMethod || "Check"),
      notes: [l.memo, l.check ? `Check ${l.check}` : ""].filter(Boolean).join(" · "),
      pledgeId: l.pledgeId || null,
      // B.2's auto-apply is for gifts that arrive with nobody to ask. The
      // deposit sheet ASKED (or matched exactly and said so on the line), so it
      // names the instalment — `installmentId` present, even as null, is what
      // tells recordGift this decision is already made.
      installmentId: l.installmentId || null,
      idempotencyKey: `deposit:${importId2}:${l.line}`, conflict: "idempotency",
      // BUILD-95 — the photograph of THIS cheque, taken as she entered the
      // line. Stored before the gift so the gift is never written referring
      // to bytes that failed to save.
      chequeAssetId: chequeByLine.get(Number(l.line)) || null,
      eventId: eventByLine.get(Number(l.line)) || null,
      campaignId: attrOf(l.line).campaignId || null, campaign: attrOf(l.line).campaignName || "",
      appealId: attrOf(l.line).appealId || null, givingPageId: attrOf(l.line).givingPageId || null,
      peerFundraiserId: attrOf(l.line).peerFundraiserId || null,
      actorId: actorInfo.id, actorName: actorInfo.name,
      timelineNote: l.memo || `Deposited ${depositDate}`,
      source: "deposit",
    });
    if (w.duplicate || !w.gift) continue;
    await run("UPDATE gifts SET import_id=? WHERE id=?", [importId2, w.gift.id]);
    await run("UPDATE interactions SET import_id=? WHERE gift_id=?", [importId2, w.gift.id]);
    created.gifts++; created.giftCents += l.cents;
    written.push({ line: l.line, giftId: w.gift.id, donorId, cents: l.cents });
    if (l.installmentId) {
      const upd = await query(
        `UPDATE pledge_installments SET paid_gift_id=?, paid_at=NOW()
          WHERE id=? AND org_id=? AND paid_gift_id IS NULL RETURNING id`,
        [w.gift.id, l.installmentId, orgId]);
      if (upd.length) created.installments++;
      if (l.pledgeId) await recalcPledgePayment(l.pledgeId, orgId).catch(e => console.error("[deposit] pledge recalc:", e.message));
    }
  }

  // THE DEPOSIT IS AN `imports` ROW. One act, one record, one thing to undo.
  const takenNames = (await query("SELECT name FROM imports WHERE org_id=?", [orgId])).map(r => r.name);
  const name = uniqueImportName(String(body.name || "").trim() || `Deposit ${depositDate}`, takenNames);
  const summary = {
    depositDate, slipCents: plan.totals.slipCents, giftCents: created.giftCents,
    notGiftCents: plan.totals.notGiftCents, counts: plan.counts,
    lines: plan.lines.map(l => ({ line: l.line, state: l.state, name: l.donorName || l.name, cents: l.cents,
                                  fund: l.fundName || null, reason: l.reason || null })),
    rowsIn: plan.counts.total, giftsCreated: created.gifts, donorsCreated: created.donors,
    rowsSetAside: plan.counts.notAGift, rowsErrored: 0,
    dollarsIn: money.toDollars(plan.totals.slipCents || 0), dollarsCreated: money.toDollars(created.giftCents),
  };
  await run(
    `INSERT INTO imports (id,org_id,name,source_filename,shape,started_at,rows_in,gifts_created,donors_created,
                          donors_merged,rows_set_aside,rows_errored,dollars_in,dollars_created,
                          actor_user_id,actor_user_name,summary_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [importId2, orgId, name, body.sourceFilename || null, "deposit", null,
     plan.counts.total, created.gifts, created.donors, 0, plan.counts.notAGift, 0,
     money.toDollars(plan.totals.slipCents || 0), money.toDollars(created.giftCents),
     actorInfo.id, actorInfo.name, JSON.stringify(summary)]);
  require("../../routes/dataHealth").afterImport(orgId, importId2);   // CLEAN-1

  // THE ARITHMETIC, READ BACK FROM THE DATABASE. The plan is a promise; this is
  // what landed. A disagreement is reported, never repaired.
  const [rb] = await query(
    "SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS cash FROM gifts WHERE org_id=? AND import_id=?",
    [orgId, importId2]);
  const writtenCents = money.toCents(rb?.cash) ?? 0;
  const footed = writtenCents === created.giftCents && Number(rb?.n || 0) === created.gifts;
  if (!footed) console.error(`[deposit] READ-BACK DISAGREES for ${importId2}: planned ${created.giftCents}c/${created.gifts} rows, database holds ${writtenCents}c/${rb?.n} rows`);

  res.status(201).json({
    id: importId2, name, depositDate,
    gifts: created.gifts, donorsCreated: created.donors, payments: created.payments,
    installmentsApplied: created.installments,
    giftCents: created.giftCents, slipCents: plan.totals.slipCents,
    notGiftCents: plan.totals.notGiftCents,
    written, footed,
    // BUILD-95 — never swallowed. A cheque whose photo would not store is a
    // committed gift with no evidence, and she has the cheque in her hand
    // right now — which is the only moment re-taking it is free.
    chequePhotos: chequeByLine.size,
    chequeFailures,
    reversibleUntil: new Date(Date.now() + DEPOSIT_REVERSE_HOURS * 3600e3).toISOString(),
  });
}));

// The merge review list — every fold the importer made, newest import first.
app.get("/import-merges", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, donor_id, surviving, folded, undone_at, created_at
       FROM import_merges WHERE org_id=? ORDER BY created_at DESC LIMIT 500`, [req.user.orgId]);
  res.json({ merges: rows.map(r => ({ ...r, folded: typeof r.folded === "string" ? JSON.parse(r.folded) : r.folded })) });
}));

// BUILD-80 Part 6.2 — UNDO a fold: re-create the folded identity as its own
// donor and move its gifts back (by the gift external ids the review row
// recorded). Reversible in the only sense that matters: the gifts follow.
app.post("/import-merges/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [m] = await query("SELECT * FROM import_merges WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!m) return res.status(404).json({ error: "merge not found" });
  // INT-BUILD-1 0e — the same wall as /imports/:id/reverse. A merge row
  // written before it carried an actor has no "whoever ran it", so only an
  // admin may split it.
  if (!(await mayUndoImport(req, m.created_by)))
    return res.status(403).json({ error: "not_yours", message: UNDO_NOT_YOURS });
  if (m.undone_at) return res.status(409).json({ error: "already undone" });
  const folded = typeof m.folded === "string" ? JSON.parse(m.folded) : m.folded;
  const label = String(req.body?.label || "").trim();
  const targets = label ? folded.filter(f => f.label === label) : folded;
  if (!targets.length) return res.status(400).json({ error: "no folded identity matches that label" });
  const createdDonors = [];
  for (const f of targets) {
    const id = importId("d_");
    await run(
      `INSERT INTO donors (id,org_id,name,email,stage,status,tags,notes,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, orgId, f.label, null, "prospect", "active", JSON.stringify(["split-from-merge"]), null, actor(req).id, actor(req).name]);
    const giftIds = (f.giftIds || []).filter(Boolean);
    if (giftIds.length) {
      await run(`UPDATE gifts SET donor_id=? WHERE org_id=? AND external_id = ANY(?)`, [id, orgId, giftIds]);
    }
    createdDonors.push({ id, name: f.label, giftsMoved: giftIds.length });
  }
  await run("UPDATE import_merges SET undone_at=NOW() WHERE id=?", [m.id]);
  const affected = [m.donor_id, ...createdDonors.map(d => d.id)].filter(Boolean);
  try { await recalcDonorSummaryBatch(affected, orgId); } catch (e) { console.error("[merge-undo] recalc failed:", e.message); }
  res.json({ ok: true, created: createdDonors });
}));

app.post("/gifts/import-history", requireAuth, checkWriteAccess, wrapImport(async (req, res) => {
  markImportInFlight(req.user.orgId, res);   // FIX-37: the background job waits for this request
  const { gifts } = req.body;
  if (!Array.isArray(gifts) || !gifts.length)
    return res.status(400).json({ error: "gifts array required" });

  const orgId = req.user.orgId;
  const valueAs = await importValueMapper(orgId);   // LIVE-1: saved value answers

  // Validate all provided donorIds belong to this org
  const donorIds = [...new Set(gifts.map(g => g.donorId).filter(Boolean))];
  if (!donorIds.length)
    return res.status(400).json({ error: "Every gift needs the donor it belongs to" });

  const orgDonors = await query(
    "SELECT id FROM donors WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL",
    [orgId, donorIds]
  );
  const validDonorIds = new Set(orgDonors.map(d => d.id));

  // §1.2 F-4 — (donor, amount, date) is NEVER a silent dedup key. The rules:
  //   · A row with an explicit external ID (source-system gift/transaction id)
  //     dedupes on THAT — within the file here, cross-run at the DB
  //     (uq_gifts_external, ON CONFLICT DO NOTHING below).
  //   · Same-(donor,amount,date) twins WITHIN the file are all inserted
  //     (forty $100 Sunday gifts are forty gifts).
  //
  // BUILD-72 Part 1 — THE DEFAULT FLIPPED. A no-external-ID row matching an
  // EXISTING gift on (donor, date, amount) used to be HELD and NOT inserted
  // unless the caller re-submitted with includeDuplicates:true. That made the
  // default SKIP, and the product cannot tell two gala tickets from a doubled
  // file — so a default of skip loses real money whenever it guesses wrong.
  // The default is now KEEP ALL: the row is imported and its group is surfaced
  // in duplicateGroups for review. Deselecting is the user's explicit act, by
  // rowKey, and is counted as `user_deselected`. The failure mode of this
  // design is a duplicate the user can delete, not a gift they never learn
  // about; those are not symmetrical and the code must not treat them as such.
  const skipRowKeys = new Set(Array.isArray(req.body.skipRowKeys) ? req.body.skipRowKeys : []);
  const existingRows = await query(
    "SELECT donor_id, amount, date FROM gifts WHERE org_id = ? AND donor_id = ANY(?)",
    [orgId, donorIds]
  );
  // BUILD-73 Part 2 — same representation as rowKey (see import-combined).
  const existingFps = new Set(existingRows.map(g => `${g.donor_id}|${g.date}|${parseFloat(g.amount)}`));

  // Importer identity — used in interaction logged_by_name, same pattern as single-gift route
  const importerRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const importerName = importerRow[0]?.name || "";
  const importerId   = req.user.userId;

  const ledger = importLedger("gifts");
  const importToday = orgToday(await orgTz(orgId));
  let roundingAdjustment = 0;
  let invalid = 0, externalIdDupes = 0;
  const seenExternalIds = new Set();
  const fileFpCounts = new Map();
  const matchesExisting = [];  // rows that look like an existing gift — imported, and flagged
  const toInsert = [];
  for (const g of gifts) {
    // BUILD-73 Part 2 — the money seam; was Math.round(rawAmt).
    const hCents = toCents(g.amount);
    const rawAmt = hCents === null ? (Number(g.amount) || 0) : toDollars(hCents);
    const amt = rawAmt;                       // cents preserved
    ledger.saw(amt, 1, rawAmt);
    roundingAdjustment += round2(rawAmt - amt);
    if (!g.donorId || !validDonorIds.has(g.donorId)) { invalid++; ledger.errored("donor_not_in_org", amt); continue; }
    if (amt === 0) { invalid++; ledger.skipped("zero_amount", amt); continue; }
    const date = normalizeGiftDate(g.date);
    if (!date) { invalid++; ledger.errored("unparseable_or_missing_date", amt); continue; }
    // BUILD-79 Part 4 — the future-date guard existed on import-combined but
    // not here; the two paths must refuse the same garbage.
    if (date > importToday) { invalid++; ledger.errored("future_date", amt); continue; }
    const externalId = (g.externalId || g.external_id || "").toString().trim().slice(0, 128) || null;
    const rowKey = `${g.donorId}|${date}|${amt}`;
    // The ONLY deliberate drop: the user deselected this row in the review.
    if (skipRowKeys.has(rowKey)) { ledger.skipped("user_deselected", amt); continue; }
    if (externalId) {
      if (seenExternalIds.has(externalId)) {
        externalIdDupes++; ledger.skipped("external_id_repeated_in_file", amt); continue;
      }
      seenExternalIds.add(externalId);
    } else {
      // Looks like a gift already on file. IMPORTED anyway (keep-all), and
      // flagged so the review can show it. Never held back by default.
      if (existingFps.has(rowKey)) {
        matchesExisting.push({ rowKey, donorId: g.donorId, amount: amt, date, type: g.type || "cash", notes: g.notes || "" });
      }
      fileFpCounts.set(rowKey, (fileFpCounts.get(rowKey) || 0) + 1);
    }
    toInsert.push({ donorId:g.donorId, amount:amt, date, type:g.type||"cash", campaign:g.campaign||"", fund_id:g.fund_id||null, notes:g.notes||"", externalId, rowKey,
      paymentMethod: valueAs("paymentMethod", String(g.paymentMethod || "").trim().slice(0, 60)) || null });
  }
  const duplicateCandidates = {
    withinFile: [...fileFpCounts.values()].filter(n => n > 1).reduce((s, n) => s + (n - 1), 0),
  };
  // Reviewable groups: twins within this file, PLUS rows that match a gift
  // already on file. Both surfaced, neither resolved automatically.
  const donorNamesForGroups = Object.fromEntries(
    (await query("SELECT id, name FROM donors WHERE org_id = ? AND id = ANY(?)", [orgId, donorIds])).map(d => [d.id, d.name])
  );
  const donorNameOf = id => donorNamesForGroups[id] || id;
  const duplicateGroups = [
    ...duplicateGroupsFrom(toInsert).map(gr => ({ ...gr, kind: "within_file", donor: donorNameOf(gr.donorId) })),
    ...matchesExisting.map(m => ({ key: m.rowKey, kind: "matches_existing", donorId: m.donorId,
                                   donor: donorNameOf(m.donorId), date: m.date, amount: m.amount, count: 1 })),
  ];

  // ── Finance sync setup (Gap 1) ───────────────────────────────────────────
  // fyStart mirrors /dashboard/my-stats exactly: July 1 fiscal year boundary.
  // ORG_TZ_SEAM_OK — one fiscal-year definition, in the org's timezone.
  const fyStart = orgFiscalYearStart(await orgTz(orgId));

  // Donor names needed for fin_transactions description / vendor_donor (bulk, one query)
  const dnRows = await query(
    "SELECT id, name FROM donors WHERE org_id = ? AND id = ANY(?)",
    [orgId, donorIds]
  );
  const donorNameMap = Object.fromEntries(dnRows.map(d => [d.id, d.name]));

  // Same account + fund the single-gift route uses — through the ONE ledger
  // helper (BUILD-58 W-3): a chartless org is provisioned loudly, never skipped.
  const ledgerH = await ensureOrgLedger(orgId, { heal: true });
  void ledgerH;   // BUILD-83 Part 6: chart provisioned, nothing posted by import

  // BUILD-83 FIX — same round-trip budget as /donors/import-combined: batches
  // are trips to the database, and 200 was costing four trips per 200 gifts.
  const BATCH = IMPORT_GIFT_BATCH;
  // WIRE-1: the run id the client minted (as /donors/import-combined takes
  // it), so Undo import reaches these gifts, and the campaign by id.
  const runId = IMPORT_RUN_ID_RE.test(String(req.body.importId || "")) ? String(req.body.importId) : null;
  const campaignIdOf = await campaignIdResolver(orgId);
  // GIFTS-1: an Event or Campaign column that names an event exactly links the gift.
  const eventIdOf = await EG.eventIdsByName(query, orgId);
  let inserted = 0, financeSynced = 0;
  const affectedDonorIds = new Set();
  const batchErrors = [];
  // LIVE-1 — the same split as /donors/import-combined: a gift from the last
  // 30 days goes through recordGift after commit; an older one is history.
  const HG = require("../../historyGifts");
  const histToday = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const recentToRecord = [];
  for (let i = toInsert.length - 1; i >= 0; i--) {
    if (!HG.isOldHistory(toInsert[i].date, histToday)) { recentToRecord.unshift(toInsert[i]); toInsert.splice(i, 1); }
  }
  let recentQueued = 0;
  const jobRunId = runId || importId("imp_");
  let thanksAnswer = IT.cleanAnswer(req.body.thanks);
  if (!thanksAnswer) thanksAnswer = { mode: IT.defaultAnswer({ firstImport: await IT.isFirstImport(query, orgId, runId),
    system: await IT.recognizeSystem(req.body.headers), count: recentToRecord.length }).mode };

  // BUILD-72 Part 1 — ONE transaction for the request, SAVEPOINT per batch, and
  // the reconciliation invariant asserted before it commits.
  await withTransaction(async (txc) => {
  for (const g of recentToRecord) ledger.created(g.amount);
  for (let bi = 0; bi < toInsert.length; bi += BATCH) {
    const batch = toInsert.slice(bi, bi + BATCH);
    const ftParams = [], ftTuples = []; // fin_transactions rows for current-FY gifts in this batch
    let keptInBatch = 0;
    const keptRows = [];
    {
      const bres = await withSavepoint(txc, `hbatch_${bi}`, async () => {
        const client = txc;
        for (const g of batch) {
          const id = importId("g_");
          // F-4: external-ID rows are cross-run idempotent at the DB — a
          // conflicted (already-imported) row inserts nothing, and its
          // interaction + ledger stamp are skipped with it.
          const kept = await queryTx(client,
            `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,campaign_id,fund_id,notes,external_id,payment_method,import_id,created_by,created_by_name,event_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT (org_id, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING id`,
            [id, orgId, g.donorId, g.amount, g.date, g.type, g.campaign, campaignIdOf(g.campaign), g.fund_id, g.notes, g.externalId || null,
             g.paymentMethod, runId, actor(req).id, actor(req).name, eventIdOf(g.campaign)]
          );
          if (!kept.length) { g._conflicted = true; continue; }
          keptInBatch++; keptRows.push(g);
          // BUILD-88a A.1 — linked, not copied (see /donors/import-combined).
          await runTx(client,
            "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id) VALUES (?,?,?,?,?,?,?,?,?)",
            [importId("int_"), orgId, g.donorId, "gift", g.notes || "", g.date, importerId, importerName, kept[0].id]
          );
          affectedDonorIds.add(g.donorId);
          // BUILD-83 Part 6 — IMPORT NEVER POSTS TO THE LEDGER. Gift history is
          // CRM data: it is what the org already raised, not money moving through
          // Steward. Ledger entries are created by the org, or by LIVE gifts
          // (Stripe webhook / a gift logged here), from an opening balance the
          // org sets. Posting an imported history made Finance open on FY revenue
          // $1,010,106.39, expenses $0, and a "Cash on hand, all-time" equal to
          // the FY figure — a set of books an accountant can disprove in a
          // minute. The gift rows are untouched; Reports still show every dollar,
          // and Finance's unledgered-giving explainer (BUILD-26 B1) says so.
        }
        // One bulk INSERT for all FY fin_transactions in this batch — same tx as gifts
        if (ftTuples.length) {
          await runTx(client,
            `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source,gift_id,created_by,created_by_name)
             VALUES ${ftTuples.join(",")} ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING`,
            ftParams
          );
        }
      });
      if (bres.ok) {
        inserted += keptInBatch;
        financeSynced += ftTuples.length;
        const keptSet = new Set(keptRows);
        for (const g of batch) {
          if (keptSet.has(g)) { ledger.created(g.amount); continue; }
          // Refused by the external-ID unique — already imported on an earlier
          // run. A skip, not a loss, and counted either way.
          externalIdDupes++;
          ledger.skipped("external_id_already_imported", g.amount);
        }
      } else {
        console.error(`[gift-import] batch ${bi}–${bi+batch.length} failed:`, bres.error.message);
        batchErrors.push({ rows: `${bi+1}–${bi+batch.length}`, error: bres.error.message });
        for (const g of batch) ledger.errored("gift_insert_failed", g.amount);
      }
    }
  }

  // FIX-37: the recent gifts, saved as the background job's work in this
  // same transaction (see import-combined).
  await queueRecentWork((sql, params) => queryTx(txc, sql, params), orgId, jobRunId,
    recentToRecord.map(g => ({ donorId: g.donorId, amount: g.amount, date: g.date, type: g.type, campaign: g.campaign,
      campaignId: campaignIdOf(g.campaign), eventId: eventIdOf(g.campaign), notes: g.notes, fundId: g.fund_id, paymentMethod: g.paymentMethod,
      externalId: g.externalId || null })),
    { actorId: importerId, actorName: importerName, thanks: thanksAnswer, touched: [...affectedDonorIds] });
  recentQueued = recentToRecord.length;

  // THE ASSERTION — before commit. A throw rolls the whole import back.
  ledger.assertBalanced();
  }); // end withTransaction

  // Recalc donor summaries — always full recalc from gifts table, never delta.
  // ONE set-based query (import hang fix), not a per-donor loop.
  if (affectedDonorIds.size) {
    try { await recalcDonorSummaryBatch([...affectedDonorIds], orgId); }
    catch (e) { console.error(`[gift-import] batch recalc failed:`, e.message); }
  }
  // FIX-37: the recent gifts and the after-change step run behind the
  // screen (runRecentWork), exactly as for /donors/import-combined.
  inserted += recentQueued;
  for (const g of recentToRecord) affectedDonorIds.add(g.donorId);
  kickRecentWork(orgId, jobRunId);

  // Gap 2: Promote donor status — same thresholds as single-gift route
  // (total_giving > 20000 → 'major', > 5000 → 'mid', ELSE keep existing)
  // Runs after recalcDonorSummary so total_giving is accurate before promotion.
  // FIX-49 decision 7: no second giving-level rule. donors.status is no
  // longer promoted to mid/major on lifetime totals; the level is the one
  // rule in donorStatus.js (the org's cut points, last 12 months).

  // Infer pipeline stage — same logic as combined import (see its comment
  // for the qualify/solicit reasoning), same guardrail.
  //
  // BUILD-84 P0-3 — the LAST path still writing `stage` as though an inference
  // were a decision. BUILD-83 Part 3.5 moved import-combined to
  // `suggested_stage`; this route kept writing `stage` and gating on
  // `stage = 'prospect'`, which meant that the moment /donors/import stopped
  // placing donors in 'prospect' (this build), gift history arriving later
  // re-inferred nothing at all — a donor with a fresh $400 gift stayed a
  // prospect forever. The guard is now the honest one: revise a SUGGESTION,
  // never a stage a human placed.
  const _giftStageToday = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  if (affectedDonorIds.size > 0) {
    try {
      await run(
        `UPDATE donors
         SET suggested_stage = CASE
           WHEN total_giving = 0 AND last_gift_date IS NULL
                AND (COALESCE(email,'') != '' OR COALESCE(phone,'') != '') THEN 'qualify'
           WHEN total_giving = 0 AND last_gift_date IS NULL            THEN 'prospect'
           WHEN last_gift_date IS NOT NULL
                AND (?::date - last_gift_date::date) >= ${lapseRule.LAPSED_DAYS}
                AND NOT ${require("../../shared/numbers/lapse").holdSql("donors.id", _giftStageToday).sql} THEN 'lapsed'
           WHEN last_gift_date IS NOT NULL
                AND (?::date - last_gift_date::date) < 90
                AND total_giving > 0                                   THEN 'steward'
           WHEN last_gift_date IS NOT NULL
                AND (?::date - last_gift_date::date) BETWEEN 90 AND 180
                AND total_giving >= 1000                                THEN 'solicit'
           WHEN total_giving > 0                                        THEN 'cultivate'
           ELSE 'prospect'
         END,
         updated_at = NOW()
         WHERE org_id = ? AND id = ANY(?)
           AND stage IS NULL
           AND deleted_at IS NULL`,
        // ORG_TZ_SEAM_OK — same civil-date arithmetic as import-combined.
        [_giftStageToday, ...require("../../shared/numbers/lapse").holdSql("donors.id", _giftStageToday).args, _giftStageToday, _giftStageToday, orgId, [...affectedDonorIds]]
      );
    } catch (e) { console.error(`[gift-import] stage inference failed:`, e.message); }
  }

  res.json({ inserted, duplicates: externalIdDupes, invalid, recentQueued, importId: jobRunId, thanks: thanksAnswer,
             donorsUpdated: affectedDonorIds.size, financeSynced, batchErrors,
             duplicateCandidates, externalIdDupes,
             // BUILD-72 Part 1 — the default is KEEP ALL. Nothing is held back;
             // these are surfaced for review, and `heldForReview` stays as an
             // always-empty field so an older client cannot misread the shape.
             heldForReview: [], duplicateGroups,
             matchesExistingCount: matchesExisting.length,
             reconciliation: ledger.report(),
             roundingAdjustment: round2(roundingAdjustment) });
}));

app.get("/import-field-mappings", requireAuth, wrap(async (req, res) => {
  const entity = String(req.query.entity || "").toLowerCase();
  const rows = await query(
    `SELECT m.entity, m.header_norm, m.field_id FROM import_field_mappings m
     JOIN custom_field_defs d ON d.id = m.field_id
     WHERE m.org_id=?${CF_ENTITIES.includes(entity) ? " AND m.entity=?" : ""} AND d.archived_at IS NULL`,
    CF_ENTITIES.includes(entity) ? [req.user.orgId, entity] : [req.user.orgId]
  );
  res.json(rows.map(r => ({ entity: r.entity, header: r.header_norm, fieldId: r.field_id })));
}));
// The same ceiling a headshot gets: a 10 MB master is not a cheque photograph,
// and it is what the cap exists to refuse.
const CHEQUE_MAX_BYTES = 10 * 1024 * 1024;
}

module.exports = { routers, mount };
