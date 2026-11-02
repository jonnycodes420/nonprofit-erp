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
// EMAIL-1 — a template rendered for one person (the send, the test, drafts).
const emailCompose = require("../../emailCompose");

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
        AND d.deleted_at IS NULL
      ORDER BY g.amount DESC, t.created_at ASC`, [orgId]);
  const [org] = await query("SELECT name, voice_samples FROM orgs WHERE id=?", [orgId]);
  const BKq = await import("../../shared/brandKit.js");
  const [me] = await query(`SELECT ${BKq.SIGN_COLUMNS} FROM users WHERE id=? AND org_id=?`, [req.user.userId, orgId]);
  const samples = Array.isArray(org?.voice_samples) ? org.voice_samples
    : (typeof org?.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
  const draftMod = await import("../../shared/draftNote.js");
  const voice = draftMod.voiceFrom(samples);
  res.json({
    count: rows.length,
    // The sentence Home shows. Numbers under ten spelled, BUILD-86 C.2's rule.
    headline: rows.length === 0 ? null
      : `${["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"][rows.length] || rows.length} thank-you${rows.length === 1 ? "" : "s"} ready.`,
    // "Mark all as sent" is offered only when every draft has been opened.
    allOpened: rows.length > 0 && rows.every(r => !!r.opened_at),
    voice: { ready: voice.ready, samples: voice.count, needs: Math.max(0, draftMod.VOICE_SAMPLE_MIN - voice.count) },
    drafts: rows.map(r => ({ id: r.id, donorId: r.donor_id, giftId: r.gift_id, donorName: r.donor_name,
      donorEmail: r.donor_email || null, amount: r.amount, giftDate: r.gift_date,
      fundName: r.fund_name || null, voiceUsed: r.voice, opened: !!r.opened_at,
      // POLISH-2: signed by whoever is reading the queue, since she sends it.
      body: draftMod.signThankYou(r.body, { donorName: r.donor_name, senderName: (me && (BKq.personSignature(me) || me.name)), orgName: org && org.name, voiceUsed: r.voice,
        person: { salutation: r.donor_salutation, spouseName: r.donor_spouse, kind: r.donor_kind } }) })),
  });
}));

// Opening a draft is recorded, because "Mark all as sent" depends on it.
app.post("/thank-yous/:id/opened", requireAuth, wrap(async (req, res) => {
  const r = await run("UPDATE thank_you_drafts SET opened_at=COALESCE(opened_at,NOW()) WHERE id=? AND org_id=?",
    [req.params.id, req.user.orgId]);
  if (!r.changes) return res.status(404).json({ error: "Draft not found" });
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
  const intId = "int_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id,metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [intId, orgId, d.donor_id, "stewardship", "Thank-you sent.", today, act.id, actorName, d.gift_id,
     JSON.stringify({ via: "thank_you_queue", draftId: d.id })]);
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
      ["int_" + uuid().slice(0, 8), orgId, full.donor_id, "stewardship", "Thank-you sent.", today, act.id, actorNameAll,
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

async function ackOrg(orgId) {
  const [o] = await query(
    `SELECT id, name, legal_name, receipt_address, receipt_signature_name, receipt_signature_title,
            logo_data, brand_accent, brand_accent_fg, ack_backlog_days FROM orgs WHERE id=?`, [orgId]);
  if (!o) return null;
  const display = await donorFacingOrgName(orgId, o.name || "").catch(() => o.name || "");
  return { ...o, display };
}

async function ackTemplate(orgId, templateId) {
  await ACK_READY;
  if (templateId) {
    const [t] = await query("SELECT * FROM ack_letter_templates WHERE id=? AND org_id=?", [templateId, orgId]);
    return t || null;
  }
  // Only a template somebody MARKED default stands in for "no choice". Taking
  // whichever saved template came first would print the wrong letter.
  const [t] = await query("SELECT * FROM ack_letter_templates WHERE org_id=? AND is_default=true ORDER BY created_at ASC LIMIT 1", [orgId]);
  return t || { id: null, name: "Standard thank-you", body: ACK.DEFAULT_ACK_TEMPLATE, is_default: true, builtIn: true };
}

// The gifts, grouped into one letter per donor. Every id is checked against
// this org; a foreign id is simply not found.
async function ackLetterSet(orgId, giftIds, templateId, { addressesOnly = false, signerFallback = null } = {}) {
  await ACK_READY;
  const ids = [...new Set((Array.isArray(giftIds) ? giftIds : []).map(String).filter(Boolean))].slice(0, 1000);
  if (!ids.length) return { error: "Choose the gifts to write letters for." };
  const tpl = await ackTemplate(orgId, templateId);
  if (!tpl) return { notFound: true };
  const org = await ackOrg(orgId);
  const rows = await query(
    `SELECT g.id, g.donor_id, g.amount, g.date, g.tribute_type, g.tribute_name, f.name AS fund, g.quid_pro_quo_value, g.deductible_amount,
            d.name, d.kind, d.salutation, d.address, d.address2, d.city, d.state, d.zip, d.country, d.deceased
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id
      WHERE g.org_id=? AND g.id = ANY(?) AND d.deleted_at IS NULL
      ORDER BY d.name, g.date`, [orgId, ids]);
  const byDonor = new Map();
  for (const r of rows) {
    const e = byDonor.get(r.donor_id) || { donor: r, gifts: [] };
    e.gifts.push({ id: r.id, amount: r.amount, date: r.date, fund: r.fund, tributeType: r.tribute_type, tributeName: r.tribute_name,
                   qpqValue: r.quid_pro_quo_value, deductible: r.deductible_amount });
    byDonor.set(r.donor_id, e);
  }
  // The letter is signed by the org's receipt signer when one is set, and
  // otherwise by the person printing it — a letter she prints goes out over
  // her name, which is true. Never blank: an unsigned letter is not posted.
  const signer = org.receipt_signature_name || signerFallback || "";
  const orgFields = { name: org.display, signer, signerTitle: org.receipt_signature_name ? (org.receipt_signature_title || "") : "" };
  const letters = [], skipped = [];
  for (const { donor, gifts } of byDonor.values()) {
    const giftIdsHere = gifts.map(g => g.id);
    // A letter to somebody who has died is not a thank-you; it goes to the
    // family by hand, and the batch says so rather than printing it.
    if (donor.deceased) { skipped.push({ donorId: donor.donor_id, name: donor.name, giftIds: giftIdsHere, why: "marked deceased" }); continue; }
    const address = ACK.addressLines(donor);
    if (!address) { skipped.push({ donorId: donor.donor_id, name: donor.name, giftIds: giftIdsHere, why: "no postal address on file" }); continue; }
    // Labels need an address and nothing else; a template the gift cannot fill
    // must not cost somebody their envelope.
    if (addressesOnly) { letters.push({ donorId: donor.donor_id, name: donor.name, address, text: "", giftIds: giftIdsHere, totalCents: 0 }); continue; }
    const fields = ACK.letterFields({ donor, gifts, org: orgFields });
    const r = ACK.renderLetter(tpl.body, fields);
    if (r.missing.length) {
      const why = r.missing.includes("gift_date") && fields._undated
        ? `${fields._undated === 1 ? "a gift here has" : `${fields._undated} gifts here have`} no date; set the date on the gift first`
        : `nothing to put in ${r.missing.map(k => `{{${k}}}`).join(", ")}`;
      skipped.push({ donorId: donor.donor_id, name: donor.name, giftIds: giftIdsHere, why }); continue;
    }
    // HOME-3: what was received in exchange, and what is deductible, under every letter that needs it
    const text = fields._goodsServices ? `${r.text}\n\n${fields._goodsServices}` : r.text;
    letters.push({ donorId: donor.donor_id, name: donor.name, address, text, giftIds: giftIdsHere, totalCents: fields._totalCents });
  }
  const found = new Set(rows.map(r => r.id));
  return { template: { id: tpl.id, name: tpl.name, builtIn: !!tpl.builtIn }, org, letters, skipped,
           notFound: ids.filter(id => !found.has(id)).length };
}

function renderLettersPdf(org, letters, { dateLine }) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 50, bottom: 40, left: 72, right: 72 }, autoFirstPage: false });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const INK = "#0f1a12", SUB = "#5a554f";
    const accent = org.brand_accent || "#0d5c3a";
    let logo = null;
    if (org.logo_data && /^data:image\/(png|jpe?g);base64,/.test(org.logo_data)) {
      try { logo = Buffer.from(org.logo_data.split(",")[1], "base64"); } catch { logo = null; }
    }
    for (const L of letters) {
      doc.addPage();
      const PW = doc.page.width;
      // Letterhead: the org's name and return address, top left; the logo right.
      doc.rect(0, 0, PW, 6).fill(accent);
      if (logo) { try { doc.image(logo, PW - 72 - 60, 22, { fit: [60, 44] }); } catch { /* a logo that will not draw costs the logo, not the letter */ } }
      doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(org.display, 72, 26, { width: PW - 220, lineBreak: false });
      if (org.receipt_address) doc.font("Helvetica").fontSize(8.5).fillColor(SUB).text(org.receipt_address, 72, 44, { width: PW - 220 });
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(dateLine, 72, 100, { width: PW - 144, align: "right" });
      // The address, exactly where the window of a #10 envelope is.
      doc.font("Helvetica").fontSize(11).fillColor(INK)
        .text(L.address.join("\n"), ACK.WINDOW.x, ACK.WINDOW.y, { width: ACK.WINDOW.w, height: ACK.WINDOW.h, lineGap: 1 });
      // The body starts below the window and is held to the page: a long
      // letter is cut at the page, never allowed to spill onto a second.
      const top = ACK.WINDOW.y + ACK.WINDOW.h + 40;
      doc.font("Times-Roman").fontSize(11.5).fillColor(INK)
        .text(L.text, 72, top, { width: PW - 144, height: doc.page.height - top - 50, lineGap: 3, ellipsis: true });
    }
    doc.end();
  });
}

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
  const rows = await query("SELECT id, name, body, is_default, created_by_name, updated_at FROM ack_letter_templates WHERE org_id=? ORDER BY is_default DESC, name", [req.user.orgId]);
  res.json({
    templates: rows.length ? rows : [{ id: null, name: "Standard thank-you", body: ACK.DEFAULT_ACK_TEMPLATE, is_default: true, builtIn: true }],
    mergeFields: ACK.ACK_MERGE_FIELDS,
  });
}));

app.post("/acknowledgments/templates", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await ACK_READY;
  const name = String(req.body?.name || "").trim().slice(0, 120);
  const body = String(req.body?.body || "");
  if (!name) return res.status(400).json({ error: "Give the letter a name." });
  const v = ACK.validateTemplate(body);
  if (!v.ok) return res.status(400).json({ error: v.errors.join(" ") });
  const id = "alt_" + uuid().slice(0, 10);
  const makeDefault = req.body?.isDefault === true;
  if (makeDefault) await run("UPDATE ack_letter_templates SET is_default=false WHERE org_id=?", [req.user.orgId]);
  await run(`INSERT INTO ack_letter_templates (id,org_id,name,body,is_default,created_by,created_by_name) VALUES (?,?,?,?,?,?,?)`,
    [id, req.user.orgId, name, body, makeDefault, actor(req).id, actor(req).name]);
  res.status(201).json({ id });
}));

app.put("/acknowledgments/templates/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await ACK_READY;
  const [t] = await query("SELECT id FROM ack_letter_templates WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!t) return res.status(404).json({ error: "Not found" });
  const name = String(req.body?.name || "").trim().slice(0, 120);
  const body = String(req.body?.body || "");
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
  const rows = await query(
    `SELECT g.id, g.amount, g.date, g.donor_id, d.name, d.address, d.city, d.state, d.zip, d.deceased, f.name AS fund
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id
      WHERE g.org_id=? AND COALESCE(g.acknowledgement_sent,false) = false AND g.acknowledgement_sent_at IS NULL
        AND g.is_sample IS NOT TRUE AND d.is_sample IS NOT TRUE AND d.deleted_at IS NULL
        AND g.date <= ? AND g.date >= ?
      ORDER BY g.date ASC, d.name LIMIT 500`, [orgId, cutoff, orgTime.addDays(today, -730)]);
  res.json({
    days, cutoff,
    // The one sentence under the count, per BUILD-97 Part 2.
    sentence: `Gifts that arrived more than ${days === 1 ? "a day" : days + " days"} ago and nobody has marked as thanked. An administrator can change the number of days here.`,
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
  const [me] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const set = await ackLetterSet(req.user.orgId, req.body?.giftIds, req.body?.templateId || null, { signerFallback: me?.name || null });
  if (set.error) return res.status(400).json({ error: set.error });
  if (set.notFound === true) return res.status(404).json({ error: "Template not found" });
  res.json({ template: set.template, letters: set.letters.map(l => ({ donorId: l.donorId, name: l.name, address: l.address, text: l.text, giftIds: l.giftIds, total: l.totalCents / 100 })),
             skipped: set.skipped, giftsNotFound: set.notFound });
}));

// The PDF. One page per donor. A POST, because it carries a selection — and a
// print changes nothing: marking the letters sent is its own request.
app.post("/acknowledgments/letters/pdf", requireAuth, wrap(async (req, res) => {
  const [me] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const set = await ackLetterSet(req.user.orgId, req.body?.giftIds, req.body?.templateId || null, { signerFallback: me?.name || null });
  if (set.error) return res.status(400).json({ error: set.error });
  if (set.notFound === true) return res.status(404).json({ error: "Template not found" });
  if (!set.letters.length) return res.status(409).json({ error: "no_letters", skipped: set.skipped,
    message: "None of these gifts can be printed yet. The reason is beside each name." });
  const today = orgToday(await orgTz(req.user.orgId));           // ORG_TZ_SEAM_OK
  if (await require("../../exportGuard").largeExportRefused(req, res, set.letters.length)) return;   // SECURE-2 item 8
  const pdf = await renderLettersPdf(set.org, set.letters, { dateLine: ACK.formatLetterDate(today) });
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
    `SELECT md.*, d.name AS donor_name, d.email AS donor_email, d.total_giving AS donor_total_giving
     FROM milestone_drafts md
     JOIN donors d ON d.id = md.donor_id
     WHERE md.org_id = ? AND md.status = ?
     ORDER BY md.created_at DESC`,
    [req.user.orgId, status]
  );
  res.json(rows);
}));

app.put("/milestone-drafts/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { subject, body } = req.body;
  if (!subject || !body) return res.status(400).json({ error: "subject and body required" });
  const affected = await run(
    // Saving her own edit is reviewing it: she has just read every word.
    "UPDATE milestone_drafts SET subject=?, body=?, reviewed_at=NOW(), reviewed_by=?, reviewed_by_name=? WHERE id=? AND org_id=? AND status='pending_review'",
    [subject, body, actor(req).id, actor(req).name, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found or already sent" });
  const rows = await query("SELECT * FROM milestone_drafts WHERE id=?", [req.params.id]);
  res.json(rows[0]);
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
  if (r.status !== 200) return res.status(r.status).json({ error: r.error });
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

// "Send all reviewed": every draft somebody marked reviewed, and nothing else.
// One press by one person; each draft is still checked against the mail rules.
app.post("/milestone-drafts/send-reviewed", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const drafts = await query(
    "SELECT * FROM milestone_drafts WHERE org_id=? AND status='pending_review' AND reviewed_at IS NOT NULL ORDER BY created_at ASC LIMIT 200",
    [req.user.orgId]);
  let sent = 0; const failed = [];
  for (const d of drafts) {
    const r = await sendMilestoneDraft(req, d);
    if (r.status === 200) sent++; else failed.push({ id: d.id, error: r.error });
  }
  req.audit && req.audit.action(`sent ${sent} reviewed draft${sent === 1 ? "" : "s"}`);
  res.json({ sent, failed });
}));
}

module.exports = { routers, mount };
