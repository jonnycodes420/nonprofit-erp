// server/outreach/thanks.js — acknowledgments, thank-yous, tribute notices and milestone drafts.
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
// EMAIL-1 — a template rendered for one person (the send, the test, drafts).
const emailCompose = require("../../emailCompose");
const DRAFT_RENDER = require("../../shared/numbers/draftRender");   // TRUTH-3: drafts store figure keys

const routers = {
  r0: express.Router(),
  r1: express.Router(),
};

function mount(ctx) {
const {
  ACK_READY, actor, checkWriteAccess, donorFacingOrgName, orgTime, orgToday, orgTz, query, requireAdmin,
  requireAuth, run, sendMilestoneDraft, uuid, wrap,
} = ctx;
// server.js loads these ESM modules at boot and sets its own binding when each
// arrives; the code below reads them only after awaiting the same promise, so
// this module keeps its own binding, set from that promise the same way.
let ACK = null;
ACK_READY.then(m => { ACK = m; });
let app = routers.r0;

// ── BUILD-88b B.3 — THE QUEUE, AND THE THREE THINGS SHE CAN DO WITH IT ────
// Copy, Mark sent, Skip. That is all, and "Mark all as sent" only after every
// draft has been OPENED — a bulk action over letters nobody read is the thing
// that makes a thank-you queue a lie.
app.get("/thank-yous", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const rows = await query(
    `SELECT t.id, t.donor_id, t.gift_id, t.body, t.voice, t.opened_at, t.created_at,
            d.name AS donor_name, d.email AS donor_email, d.salutation AS donor_salutation, d.spouse_name AS donor_spouse, d.kind AS donor_kind,
            g.amount::float AS amount, g.date AS gift_date, f.name AS fund_name
       FROM thank_you_drafts t
       JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
       JOIN gifts g ON g.id = t.gift_id AND g.org_id = t.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = t.org_id
      WHERE t.org_id = ? AND t.sent_at IS NULL AND t.skipped_at IS NULL
        AND d.deleted_at IS NULL AND d.deceased IS NOT TRUE   -- PEOPLE-1: kept, not offered (Undo brings them back)
      ORDER BY g.amount DESC, t.created_at ASC`, [orgId]);
  const [org] = await query("SELECT name, voice_samples FROM orgs WHERE id=?", [orgId]);
  const BKq = await import("../../shared/brandKit.js");
  const [me] = await query(`SELECT ${BKq.SIGN_COLUMNS} FROM users WHERE id=? AND org_id=?`, [req.user.userId, orgId]);
  const samples = Array.isArray(org?.voice_samples) ? org.voice_samples
    : (typeof org?.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
  const draftMod = await import("../../shared/draftNote.js");
  const voice = draftMod.voiceFrom(samples);
  // NUMBERS-9 item 6 (W-1125-Finance-T7): the card counted drafts and said nothing of the gifts
  // waiting behind them ("4 thank-yous ready" beside 7 gifts not yet thanked). The backlog is the
  // one definition (shared/numbers/thankBacklog.js); the card says it whenever it differs.
  const TB = require("../../shared/numbers/thankBacklog");
  const since = await require("../../routes/crm").reportHooks.thanksSince(orgId);
  const bl = await TB.backlog(query, orgId, since);
  const sinceWords = orgTime.formatCivil(since);
  const backlog = { ...bl, sinceWords, source: { key: "unthanked", params: { since } }, definition: TB.SENTENCE,
    sentence: bl.n !== rows.length || bl.drafted !== rows.length ? TB.backlogWords(bl, sinceWords) : null };
  res.json({
    count: rows.length,
    backlog,
    // The sentence Home shows. Numbers under ten spelled, BUILD-86 C.2's rule.
    headline: rows.length === 0 ? null
      : `${["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"][rows.length] || rows.length} thank-you${rows.length === 1 ? "" : "s"} ready.`,
    // "Mark all as sent" is offered only when every draft has been opened.
    allOpened: rows.length > 0 && rows.every(r => !!r.opened_at),
    voice: { ready: voice.ready, samples: voice.count, needs: Math.max(0, draftMod.VOICE_SAMPLE_MIN - voice.count) },
    drafts: rows.map(r => ({ id: r.id, donorId: r.donor_id, giftId: r.gift_id, donorName: r.donor_name,
      donorEmail: r.donor_email || null, amount: r.amount, giftDate: r.gift_date,
      fundName: r.fund_name || null, voiceUsed: r.voice, opened: !!r.opened_at,
      subject: "Thank you for your gift",   // COMMS-3: Open in my email's subject line
      // POLISH-2: signed by whoever is reading the queue, since she sends it.
      body: draftMod.signThankYou(r.body, { donorName: r.donor_name, senderName: (me && (BKq.personSignature(me) || me.name)), orgName: org && org.name, voiceUsed: r.voice,
        person: { salutation: r.donor_salutation, spouseName: r.donor_spouse, kind: r.donor_kind } }) })),
  });
}));

// Opening a draft is recorded, because "Mark all as sent" depends on it.
// COMMS-3 item 1: it is a note that she looked, not a change any screen
// re-reads for. It announced the "draft" topic, so Drafts to review re-read
// under her click and the draft she had just opened closed again (staging,
// 26 Nov: the list went to 0 rows twice and came back with nothing open).
app.post("/thank-yous/:id/opened", requireAuth, wrap(async (req, res) => {
  const r = await run("UPDATE thank_you_drafts SET opened_at=COALESCE(opened_at,NOW()) WHERE id=? AND org_id=?",
    [req.params.id, req.user.orgId]);
  if (!r.changes) return res.status(404).json({ error: "Draft not found" });
  res.setHeader("X-Steward-Changed", "none");
  res.json({ ok: true });
}));

// MARK SENT logs a conversation, which is what runs the Thread cycle: closing
// one conversation opens the next (BUILD-81's spine). Steward did not send it —
// she did — so the timeline says so in her name.
app.post("/thank-yous/:id/sent", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT * FROM thank_you_drafts WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Draft not found" });
  if (d.sent_at) return res.json({ ok: true, alreadySent: true });
  const org = await orgTz(orgId);
  const today = orgToday(org);                                     // ORG_TZ_SEAM_OK
  const act = actor(req);
  // SHE sent it, so the timeline says her NAME. `actor(req).name` falls back to
  // the email (it is the identifier that is always present); a colleague on a
  // record is a person, and BUILD-87 F.3.7's rule is that a row reads as one.
  const [me] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [req.user.userId, orgId]);
  const actorName = (me && me.name) || act.name;
  const intId = newId("int");
  // COMMS-3: what the gift said before, so Undo puts back only what this changed (thankYouUnsend.js).
  const [prevGift] = await query("SELECT acknowledgement_sent, acknowledgement_sent_at, thanked_at FROM gifts WHERE id=? AND org_id=?", [d.gift_id, orgId]);   // ACK-READ-OK: kept only so Undo can put the mark back exactly as it was
  await run(
    `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id,metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [intId, orgId, d.donor_id, "stewardship", "Thank-you sent.", today, act.id, actorName, d.gift_id,
     JSON.stringify({ via: "thank_you_queue", draftId: d.id, previousGift: prevGift || null })]);
  await run("UPDATE thank_you_drafts SET sent_at=NOW(), opened_at=COALESCE(opened_at,NOW()) WHERE id=? AND org_id=?", [d.id, orgId]);
  await run("UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=COALESCE(acknowledgement_sent_at, NOW()), thanked_at=COALESCE(thanked_at, NOW()) WHERE id=? AND org_id=?", [d.gift_id, orgId]);
  // The thread cycle: a thank-you thread this closes closes as an OUTCOME.
  const closed = await query(
    `UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=?
      WHERE org_id=? AND donor_id=? AND closed_at IS NULL
        AND next_step_type IN ('thank','thank_you_note') RETURNING id`,
    [intId, orgId, d.donor_id]);
  res.json({ ok: true, interactionId: intId, threadClosed: closed[0]?.id || null });
}));

// COMMS-3 item 1: Undo on "I sent it" (server/outreach/thankYouUnsend.js).
const unsendThankYou = require("./thankYouUnsend").makeUnsend({ query, run });
app.post("/thank-yous/:id/unsent", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const r = await unsendThankYou(req.user.orgId, req.params.id);
  res.status(r.status).json(r.body);
}));

// SKIP, with no reason asked. Sometimes a gift does not need a letter and
// making her justify that is how a queue stops being used.
app.post("/thank-yous/:id/skip", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const r = await run("UPDATE thank_you_drafts SET skipped_at=NOW() WHERE id=? AND org_id=? AND sent_at IS NULL",
    [req.params.id, req.user.orgId]);
  if (!r.changes) return res.status(404).json({ error: "Draft not found" });
  res.json({ ok: true });
}));

app.post("/thank-yous/mark-all-sent", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const open = await query(
    "SELECT id, opened_at FROM thank_you_drafts WHERE org_id=? AND sent_at IS NULL AND skipped_at IS NULL", [orgId]);
  if (!open.length) return res.json({ marked: 0 });
  const unopened = open.filter(d => !d.opened_at).length;
  if (unopened) {
    return res.status(409).json({ error: "unopened_drafts", unopened,
      message: `${unopened} draft${unopened === 1 ? " has" : "s have"} not been opened. Marking a letter sent that nobody read is how this queue stops meaning anything.` });
  }
  const org = await orgTz(orgId);
  const today = orgToday(org);                                     // ORG_TZ_SEAM_OK
  const act = actor(req);
  const [meAll] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [req.user.userId, orgId]);
  const actorNameAll = (meAll && meAll.name) || act.name;
  let marked = 0;
  for (const d of open) {
    const [full] = await query("SELECT donor_id, gift_id FROM thank_you_drafts WHERE id=?", [d.id]);
    await run(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id,metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [newId("int"), orgId, full.donor_id, "stewardship", "Thank-you sent.", today, act.id, actorNameAll,
       full.gift_id, JSON.stringify({ via: "thank_you_queue_all", draftId: d.id })]);
    await run("UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=COALESCE(acknowledgement_sent_at, NOW()), thanked_at=COALESCE(thanked_at, NOW()) WHERE id=? AND org_id=?", [full.gift_id, orgId]);
    marked++;
  }
  await run("UPDATE thank_you_drafts SET sent_at=NOW() WHERE org_id=? AND sent_at IS NULL AND skipped_at IS NULL", [orgId]);
  res.json({ marked });
}));
app = routers.r1;

// The notices waiting to go to families. Steward never sends one: she prints
// or copies it, and marks it sent.
app.get("/tribute-notices", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT t.id, t.gift_id, t.tribute_type, t.honouree_name, t.notify_name, t.notify_email, t.notify_address, t.body, t.status, t.created_at,
            d.id AS donor_id, d.name AS donor_name
       FROM tribute_notices t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id=? AND t.status='waiting' AND d.deleted_at IS NULL ORDER BY t.created_at DESC LIMIT 200`, [req.user.orgId]);
  res.json({ notices: rows });
}));
app.post("/tribute-notices/:id/sent", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { changes } = await run("UPDATE tribute_notices SET status='sent', sent_at=NOW(), sent_by=?, sent_by_name=? WHERE id=? AND org_id=? AND status='waiting'",
    [actor(req).id, actor(req).name, req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));
app.post("/tribute-notices/:id/skip", requireAuth, wrap(async (req, res) => {
  const { changes } = await run("UPDATE tribute_notices SET status='skipped' WHERE id=? AND org_id=? AND status='waiting'", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

// LETTERS-1: the letter batch and its PDF live in server/receipts/ (letterSet.js,
// letterPdf.js), shared with the letters for an event or a campaign.
const { ackOrg, ackLetterSet } = require("../receipts/letterSet").makeLetterSet({ query, ACK_READY, donorFacingOrgName });
const { renderLettersPdf } = require("../receipts/letterPdf");

function renderLabelsPdf(addresses) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: false });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    let page = -1;
    addresses.forEach((lines, i) => {
      const o = ACK.labelOrigin(i);
      if (o.page !== page) { doc.addPage(); page = o.page; }
      doc.font("Helvetica").fontSize(10).fillColor("#0f1a12")
        .text(lines.join("\n"), o.x + 12, o.y + 10, { width: ACK.LABELS_5160.w - 24, height: ACK.LABELS_5160.h - 14, lineGap: 0, ellipsis: true });
    });
    doc.end();
  });
}

// ── ACKNOWLEDGMENT ROUTES ──────────────────────────────────────────────────
app.get("/acknowledgments/templates", requireAuth, wrap(async (req, res) => {
  await ACK_READY;
  const rows = await query(`SELECT id, name, body, is_default, created_by_name, updated_at, (layout IS NOT NULL) AS from_word, source_name, not_carried
                                FROM ack_letter_templates WHERE org_id=? ORDER BY is_default DESC, name`, [req.user.orgId]);
  res.json({
    templates: rows.length ? rows : [{ id: null, name: "Standard thank-you", body: ACK.DEFAULT_ACK_TEMPLATE, is_default: true, builtIn: true }],
    mergeFields: ACK.ACK_MERGE_FIELDS,
  });
}));

app.post("/acknowledgments/templates", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await ACK_READY;
  const name = String(req.body?.name || "").trim().slice(0, 120);
  // LETTERS-1: a letter uploaded from Word keeps its layout; its words (the
  // fields the check reads) are the layout's own, never what the browser says.
  const word = require("../receipts/letterDoc").fromRequest(req.body);
  if (word.error) return res.status(400).json({ error: word.error });
  const body = word.layout ? word.body : String(req.body?.body || "");
  if (!name) return res.status(400).json({ error: "Give the letter a name." });
  const v = ACK.validateTemplate(body);
  if (!v.ok) return res.status(400).json({ error: v.errors.join(" ") });
  const id = newId("alt");
  const makeDefault = req.body?.isDefault === true;
  if (makeDefault) await run("UPDATE ack_letter_templates SET is_default=false WHERE org_id=?", [req.user.orgId]);
  await run(`INSERT INTO ack_letter_templates (id,org_id,name,body,is_default,created_by,created_by_name,layout,source_name,not_carried) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, name, body, makeDefault, actor(req).id, actor(req).name,
     word.layout ? JSON.stringify(word.layout) : null, word.sourceName, word.notCarried ? JSON.stringify(word.notCarried) : null]);
  res.status(201).json({ id });
}));

app.put("/acknowledgments/templates/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await ACK_READY;
  const [t] = await query("SELECT id, body, (layout IS NOT NULL) AS from_word FROM ack_letter_templates WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  const name = String(req.body?.name || "").trim().slice(0, 120);
  // LETTERS-1: a Word letter's words are its layout's; renaming it or making
  // it the default keeps them. To change the words she uploads it again.
  const body = t.from_word ? t.body : String(req.body?.body || "");
  const v = ACK.validateTemplate(body);
  if (!name) return res.status(400).json({ error: "Give the letter a name." });
  if (!v.ok) return res.status(400).json({ error: v.errors.join(" ") });
  if (req.body?.isDefault === true) await run("UPDATE ack_letter_templates SET is_default=false WHERE org_id=?", [req.user.orgId]);
  await run("UPDATE ack_letter_templates SET name=?, body=?, is_default=COALESCE(?, is_default), updated_at=NOW() WHERE id=? AND org_id=?",
    [name, body, req.body?.isDefault === true ? true : null, t.id, req.user.orgId]);
  res.json({ ok: true });
}));

app.delete("/acknowledgments/templates/:id", requireAuth, wrap(async (req, res) => {
  const { changes } = await run("DELETE FROM ack_letter_templates WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

// The backlog: gifts nobody has thanked, older than the org's own N days.
app.get("/acknowledgments/backlog", requireAuth, wrap(async (req, res) => {
  await ACK_READY;
  const orgId = req.user.orgId;
  const org = await ackOrg(orgId);
  const days = Number.isInteger(org?.ack_backlog_days) && org.ack_backlog_days >= 0 ? org.ack_backlog_days : ACK.DEFAULT_ACK_BACKLOG_DAYS;
  const today = orgToday(await orgTz(orgId));                 // ORG_TZ_SEAM_OK
  const cutoff = orgTime.addDays(today, -days);
  // NUMBERS-9 item 6: the backlog is the waiting-to-be-thanked gifts (shared/numbers/thankBacklog.js
  // WAITING, from the day she started with Steward; it was its own 730 days) older than her N days.
  const TB = require("../../shared/numbers/thankBacklog");
  const since = await require("../../routes/crm").reportHooks.thanksSince(orgId);
  const rows = await query(
    `SELECT g.id, g.amount, g.date, g.donor_id, d.name, d.address, d.city, d.state, d.zip, d.deceased, f.name AS fund
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id
      WHERE g.org_id=? AND ${TB.WAITING("g", "d")}   -- the one rule (a receipt is not a thank-you; a draft still waits)
        AND g.date <= ?
      ORDER BY g.date ASC, d.name LIMIT 500`, [orgId, since, cutoff]);
  const all = await TB.backlog(query, orgId, since);
  const sinceWords = orgTime.formatCivil(since);
  const older = rows.length < 500 ? rows.length : (await query(
    `SELECT COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id=? AND ${TB.WAITING("g", "d")} AND g.date <= ?`, [orgId, since, cutoff]))[0].n;
  res.json({
    days, cutoff, since, waiting: { n: all.n, cents: all.cents, drafted: all.drafted }, older,
    // The one sentence under the count, per BUILD-97 Part 2, and how it differs from Home's count.
    sentence: `${older.toLocaleString("en-US")} of the ${all.n.toLocaleString("en-US")} ${all.n === 1 ? "gift" : "gifts"} waiting to be thanked since ${sinceWords} arrived more than ${days === 1 ? "a day" : days + " days"} ago. An administrator can change the number of days here.`,
    definition: TB.SENTENCE,
    gifts: rows.map(r => ({ id: r.id, amount: Number(r.amount), date: r.date, donorId: r.donor_id, name: r.name, fund: r.fund,
      hasAddress: !!ACK.addressLines(r), deceased: !!r.deceased })),
  });
}));

app.put("/acknowledgments/settings", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const n = Number(req.body?.backlogDays);
  if (!Number.isInteger(n) || n < 0 || n > 365) return res.status(400).json({ error: "backlogDays is a whole number of days, 0 to 365." });
  await run("UPDATE orgs SET ack_backlog_days=? WHERE id=?", [n, req.user.orgId]);
  res.json({ backlogDays: n });
}));

// What the batch WOULD print, and who it would leave out and why. Read-only.
app.post("/acknowledgments/letters/preview", requireAuth, wrap(async (req, res) => {
  const set = await ackLetterSet(req.user.orgId, req.body?.giftIds, req.body?.templateId || null, { userId: req.user.userId });
  if (set.error) return res.status(400).json({ error: set.error });
  if (set.notFound === true) return res.status(404).json({ error: "Template not found" });
  res.json({ template: set.template, letters: set.letters.map(l => ({ donorId: l.donorId, name: l.name, address: l.address, text: l.text, giftIds: l.giftIds, total: l.totalCents / 100 })),
             skipped: set.skipped, giftsNotFound: set.notFound });
}));

// The PDF. One page per donor. A POST, because it carries a selection — and a
// print changes nothing: marking the letters sent is its own request.
app.post("/acknowledgments/letters/pdf", requireAuth, wrap(async (req, res) => {
  const today = orgToday(await orgTz(req.user.orgId));           // ORG_TZ_SEAM_OK
  const set = await ackLetterSet(req.user.orgId, req.body?.giftIds, req.body?.templateId || null, { userId: req.user.userId, today });
  if (set.error) return res.status(400).json({ error: set.error });
  if (set.notFound === true) return res.status(404).json({ error: "Template not found" });
  if (!set.letters.length) return res.status(409).json({ error: "no_letters", skipped: set.skipped,
    message: "None of these gifts can be printed yet. The reason is beside each name." });
  if (await require("../../exportGuard").largeExportRefused(req, res, set.letters.length)) return;   // SECURE-2 item 8
  const pdf = await renderLettersPdf(set.org, set.letters, { dateLine: ACK.formatLetterDate(today), signature: set.signer.image });
  res.setHeader("Content-Type", "application/pdf");
  if (req.audit) req.audit.rows(set.letters.length);   // SECURE-2 item 8: one letter per person
  res.setHeader("Content-Disposition", `attachment; filename="thank-you-letters-${today}.pdf"`);
  res.setHeader("X-Letters-Printed", String(set.letters.length));
  res.setHeader("X-Letters-Skipped", String(set.skipped.length));
  res.setHeader("Access-Control-Expose-Headers", "X-Letters-Printed, X-Letters-Skipped");
  res.end(pdf);
}));

// Mailing labels, Avery 5160: one per donor, never one per gift.
app.post("/acknowledgments/labels/pdf", requireAuth, wrap(async (req, res) => {
  await ACK_READY;
  const set = await ackLetterSet(req.user.orgId, req.body?.giftIds, null, { addressesOnly: true });
  if (set.error) return res.status(400).json({ error: set.error });
  const addresses = set.letters.map(l => l.address);
  if (!addresses.length) return res.status(409).json({ error: "no_addresses", skipped: set.skipped });
  if (await require("../../exportGuard").largeExportRefused(req, res, addresses.length)) return;   // SECURE-2 item 8
  const pdf = await renderLabelsPdf(addresses);
  res.setHeader("Content-Type", "application/pdf");
  if (req.audit) req.audit.rows(addresses.length);   // SECURE-2 item 8
  res.setHeader("Content-Disposition", `attachment; filename="mailing-labels.pdf"`);
  res.setHeader("X-Labels", String(addresses.length));
  res.setHeader("Access-Control-Expose-Headers", "X-Labels");
  res.end(pdf);
}));

// Who thanked them, when, and how. Idempotent: a gift already marked keeps its
// first stamp, because "who thanked them first" is the fact worth keeping.
app.post("/acknowledgments/mark", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await ACK_READY;
  const ids = [...new Set((Array.isArray(req.body?.giftIds) ? req.body.giftIds : []).map(String))].slice(0, 1000);
  const via = String(req.body?.via || "");
  if (!ids.length) return res.status(400).json({ error: "Choose the gifts that were thanked." });
  if (!ACK.ACK_VIA.includes(via)) return res.status(400).json({ error: `How were they thanked? One of: ${ACK.ACK_VIA.join(", ")}.` });
  // "Who thanked them" is read by a person, so it is their NAME — actor()'s
  // name is the login email, which is an audit stamp, not a signature.
  const [u] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const who = u?.name || actor(req).name;
  const rows = await query(
    `UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=COALESCE(acknowledgement_sent_at, NOW()), thanked_at=COALESCE(thanked_at, NOW()),
                      acknowledged_by=COALESCE(acknowledged_by, ?), acknowledged_by_name=COALESCE(acknowledged_by_name, ?),
                      acknowledged_via=COALESCE(acknowledged_via, ?)
      WHERE org_id=? AND id = ANY(?) RETURNING id`, [actor(req).id, who, via, req.user.orgId, ids]);
  // The drafted thank-you (88b) for these gifts is done too; leaving it in the
  // queue would ask her to thank somebody twice.
  await run("UPDATE thank_you_drafts SET sent_at=COALESCE(sent_at, NOW()) WHERE org_id=? AND gift_id = ANY(?) AND sent_at IS NULL AND skipped_at IS NULL", [req.user.orgId, ids]).catch(() => {});
  res.json({ marked: rows.length });
}));

// ── Milestone drafts (AI-drafted, staff-reviewed before sending — see
// processSequences()'s 'milestone' branch for why this isn't auto-sent) ────
app.get("/milestone-drafts", requireAuth, wrap(async (req, res) => {
  const status = req.query.status || "pending_review";
  const rows = await query(
    // TRUTH-2: the person's lifetime is the one rule (shared/numbers/lifetime), never the stored column.
    `SELECT md.*, d.name AS donor_name, d.email AS donor_email, ${require("../../shared/numbers/lifetime").LIFETIME("d")} AS donor_total_giving
     FROM milestone_drafts md
     JOIN donors d ON d.id = md.donor_id AND d.org_id = md.org_id
     WHERE md.org_id = ? AND md.status = ?
     ORDER BY md.created_at DESC`,
    [req.user.orgId, status]
  );
  // TRUTH-3: the words are filled from the person's figures today (server/drafts/render.js).
  // FLOWS-7: every link checked and any video claim backed, before she reads it (server/drafts/linkCheck.js).
  res.json(status === "pending_review"
    ? await require("../drafts/linkCheck").checkDrafts(req.user.orgId, await require("../drafts/render").renderDrafts(req.user.orgId, rows))
    : rows);
}));

app.put("/milestone-drafts/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { subject, body } = req.body;
  if (!subject || !body) return res.status(400).json({ error: "subject and body required" });
  const affected = await run(
    // Saving her own edit is reviewing it: she has just read every word.
    "UPDATE milestone_drafts SET subject=?, body=?, reviewed_at=NOW(), reviewed_by=?, reviewed_by_name=? WHERE id=? AND org_id=? AND status='pending_review'",
    // TRUTH-3: a total she leaves in the words is stored as its key, so it stays true.
    [DRAFT_RENDER.templatize(subject), DRAFT_RENDER.templatize(body), actor(req).id, actor(req).name, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found or already sent" });
  const rows = await query("SELECT * FROM milestone_drafts WHERE id=?", [req.params.id]);
  res.json(await require("../drafts/render").renderDraft(req.user.orgId, rows[0]));
}));

// EMAIL-1 — START FROM A TEMPLATE. The draft's subject and words become the
// template's, rendered as text with this person's name and last gift in it,
// and the draft remembers the template. It is still a draft: a person reads
// it and presses Send. Undo is /restore with the words it had before.
app.post("/milestone-drafts/:id/from-template", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT * FROM milestone_drafts WHERE id=? AND org_id=? AND status='pending_review'", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Not found or already sent" });
  const t = await emailCompose.templateFor(orgId, req.body && req.body.templateId);
  if (!t) return res.status(404).json({ error: "template_not_found", message: "That template is not one of yours." });
  const [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [d.donor_id, orgId]);
  const words = await emailCompose.templateTextFor(orgId, t, donor || null);
  if (!words.body) return res.status(400).json({ error: "template_empty", message: "That template has no words in it yet." });
  await run("UPDATE milestone_drafts SET subject=?, body=?, template_id=? WHERE id=? AND org_id=? AND status='pending_review'",
    [words.subject || d.subject, words.body, t.id, d.id, orgId]);
  const [row] = await query("SELECT * FROM milestone_drafts WHERE id=?", [d.id]);
  res.json({ draft: row, previous: { subject: d.subject, body: d.body, templateId: d.template_id || null },
    sentence: `The draft now starts from ${t.name}. Read it before you send it.` });
}));

app.post("/milestone-drafts/:id/restore", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { subject, body, templateId } = req.body || {};
  if (!subject || !body) return res.status(400).json({ error: "subject and body required" });
  const { changes } = await run(
    "UPDATE milestone_drafts SET subject=?, body=?, template_id=? WHERE id=? AND org_id=? AND status='pending_review'",
    [String(subject), String(body), templateId ? ((await emailCompose.templateFor(req.user.orgId, templateId)) || {}).id || null : null,
     req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found or already sent" });
  const [row] = await query("SELECT * FROM milestone_drafts WHERE id=?", [req.params.id]);
  res.json({ draft: row });
}));

app.post("/milestone-drafts/:id/dismiss", requireAuth, wrap(async (req, res) => {
  const affected = await run(
    "UPDATE milestone_drafts SET status='dismissed' WHERE id=? AND org_id=? AND status='pending_review'",
    [req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found or already sent" });
  res.json({ success: true });
}));

app.post("/milestone-drafts/:id/send", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const drafts = await query(
    "SELECT * FROM milestone_drafts WHERE id=? AND org_id=? AND status='pending_review'",
    [req.params.id, req.user.orgId]
  );
  if (!drafts.length) return res.status(404).json({ error: "Not found or already sent" });
  const r = await sendMilestoneDraft(req, drafts[0]);
  if (r.status !== 200) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code, stale: r.stale, sentence: r.error } : {}) });   // TRUTH-2: a stale figure says which
  res.json({ success: true });
}));

// She read it and the words are right. Not sent: that is still her press.
app.post("/milestone-drafts/:id/reviewed", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const who = actor(req);
  const { changes } = await run(
    "UPDATE milestone_drafts SET reviewed_at=NOW(), reviewed_by=?, reviewed_by_name=? WHERE id=? AND org_id=? AND status='pending_review'",
    [who.id, who.name, req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found or already sent" });
  res.json({ success: true });
}));

// "Send all reviewed": SENDS-2 moved it to a send plan (kind "milestone_reviewed",
// server/outreach/draftPlans.js), so she sees every name before anything goes.
// This door stays for an old tab or a saved link, and sends nothing.
app.post("/milestone-drafts/send-reviewed", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  res.status(409).json(require("../mail/sendPlan").PLAN_REQUIRED);
}));
}

module.exports = { routers, mount };
