// server/receipts/letters.js · LETTERS-1. HER OWN LETTER, HER OWN SIGNATURE,
// TO EVERYONE WHO GAVE TO ONE EVENT, AS A PDF OR A WORD FILE.
//
// "If I can upload a template and then I can say, I want everyone who donated
// to this event to get a tax letter. And then you can download a PDF and edit
// the PDF... or download it as a Word document." (a pilot customer, 24 Nov)
//
//   POST /acknowledgments/templates/docx          read a .docx into a layout (saves nothing)
//   POST /acknowledgments/templates/docx/preview  that layout as a one-page PDF for a made-up donor
//   GET  /letters/signatures                      the org's receipt signer's signature and mine
//   PUT  /letters/signatures/org                  Settings → Tax receipts (an administrator)
//   PUT  /letters/signatures/mine                 my profile
//   GET  /letters/giving/sources                  the events and campaigns to pick from
//   POST /letters/giving/preview                  who gets a letter, each letter, who is left out and why
//   POST /letters/giving/pdf                      one PDF, a page a letter (sends nothing, marks nothing)
//   POST /letters/giving/docx                     the same letters as one Word file
//   POST /letters/giving/mark                     "Mark these as sent": an acknowledgment on each gift,
//                                                 and "thanked" only when she says it was the thank-you
//
// The people are every gift to the event or campaign dated in the range that
// is money (shared/numbers/givingBetween.js IN_SPAN, money.js GIFT: above zero,
// not refunded in full, not a credit), from a person not deleted, not sample.
// The letters themselves are BUILD-98's batch (letterSet.js): one per person,
// the amount summed in cents, the deductible part as the receipt has it.
"use strict";
const express = require("express");
const routers = { r1: express.Router() };

const MAX_SIGNATURE_CHARS = 600 * 1024;
const SIGNATURE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The made-up donor the upload preview fills a letter with. Never a real name.
const SAMPLE = {
  donor: { donor_id: "sample", name: "Jordan Sample", kind: "individual", address: "100 Example Lane", city: "Springfield", state: "KY", zip: "40069" },
  gifts: [{ id: "sample", amount: 150, date: null, fund: "General Fund", qpqValue: 40, event: "Spring Benefit", campaign: "Annual Fund" }],
};

function signatureOk(v) {
  if (v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string" || !SIGNATURE_RE.test(v)) return { ok: false, error: "A signature is a PNG or JPEG picture." };
  if (v.length > MAX_SIGNATURE_CHARS) return { ok: false, error: "That signature picture is too large. Crop it close to the signature and try again." };
  return { ok: true, value: v };
}

function mount(ctx) {
  const { query, run, requireAuth, requireAdmin, checkWriteAccess, wrap, actor, orgToday, orgTz, ACK_READY, donorFacingOrgName } = ctx;
  const L = require("./letterDoc");
  const { renderLettersPdf } = require("./letterPdf");
  const { renderLettersDocx } = require("./letterWord");
  const { ackLetterSet, ackOrg, signerOf } = require("./letterSet").makeLetterSet({ query, ACK_READY, donorFacingOrgName });
  const { IN_SPAN } = require("../../shared/numbers/givingBetween");
  const { GIFT } = require("../../shared/numbers/money");
  const app = routers.r1;
  const todayOf = async orgId => orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK

  // ── item 1: a Word letter in ────────────────────────────────────────────
  app.post("/acknowledgments/templates/docx", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const b64 = String(req.body?.file || "").replace(/^data:[^,]*,/, "");
    if (!b64) return res.status(400).json({ error: "Choose a Word (.docx) file." });
    let parsed;
    try { parsed = await L.parseDocx(Buffer.from(b64, "base64")); }
    catch (e) { return res.status(e.status || 400).json({ error: e.status ? e.message : "That Word file could not be read. In Word, choose File, Save As, Word Document (.docx), and upload again." }); }
    const ACK = await ACK_READY;
    const known = new Set(ACK.ACK_MERGE_KEYS);
    res.json({
      layout: parsed.layout,
      text: parsed.text,
      // Each place a name or amount goes, with the Steward field it looks like.
      // A {{token}} Steward does not know is named now and refused at save.
      candidates: parsed.candidates.map(c => ({ ...c, known: c.token ? known.has(c.suggest) : undefined })),
      notCarried: parsed.notCarried,
      mergeFields: ACK.ACK_MERGE_FIELDS,
    });
  }));

  app.post("/acknowledgments/templates/docx/preview", requireAuth, wrap(async (req, res) => {
    const word = L.fromRequest(req.body);
    if (word.error || !word.layout) return res.status(400).json({ error: word.error || "Upload a Word file first." });
    const ACK = await ACK_READY;
    const org = await ackOrg(req.user.orgId);
    const signer = await signerOf(org, req.user.userId);
    const today = await todayOf(req.user.orgId);
    const gifts = SAMPLE.gifts.map(g => ({ ...g, date: today }));
    const fields = ACK.letterFields({ donor: SAMPLE.donor, gifts, org: { name: org.display, signer: signer.name || "Your name", signerTitle: signer.title }, today });
    const letter = { address: ACK.addressLines(SAMPLE.donor), text: "", signer: signer.name, goodsServices: fields._goodsServices, layout: L.fillLayout(word.layout, fields) };
    const pdf = await renderLettersPdf(org, [letter], { dateLine: ACK.formatLetterDate(today), signature: signer.image });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="letter-preview.pdf"`);
    res.end(pdf);
  }));

  // ── item 2: the signature ───────────────────────────────────────────────
  app.get("/letters/signatures", requireAuth, wrap(async (req, res) => {
    const [o] = await query("SELECT receipt_signature_name, receipt_signature_title, receipt_signature_image FROM orgs WHERE id=?", [req.user.orgId]);
    const [u] = await query("SELECT name, signature_image FROM users WHERE id=?", [req.user.userId]);
    res.json({
      org: { signerName: o?.receipt_signature_name || "", signerTitle: o?.receipt_signature_title || "", image: o?.receipt_signature_image || null },
      mine: { name: u?.name || "", image: u?.signature_image || null },
      // The one sentence that says whose signature a letter carries.
      rule: o?.receipt_signature_name
        ? `Letters are signed by ${o.receipt_signature_name}, the receipt signer in Settings → Tax receipts, with that signature.`
        : "No receipt signer is set, so each letter is signed by the person who prints it, with their own signature.",
    });
  }));
  app.put("/letters/signatures/org", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
    const v = signatureOk(req.body?.image);
    if (!v.ok) return res.status(400).json({ error: v.error });
    await run("UPDATE orgs SET receipt_signature_image=? WHERE id=?", [v.value, req.user.orgId]);
    res.json({ ok: true, image: v.value });
  }));
  app.put("/letters/signatures/mine", requireAuth, wrap(async (req, res) => {
    const v = signatureOk(req.body?.image);
    if (!v.ok) return res.status(400).json({ error: v.error });
    await run("UPDATE users SET signature_image=? WHERE id=?", [v.value, req.user.userId]);
    res.json({ ok: true, image: v.value });
  }));

  // ── item 3: everyone who gave to an event or a campaign ─────────────────
  app.get("/letters/giving/sources", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const events = await query(
      `SELECT e.id, e.name, to_char(e.date, 'YYYY-MM-DD') AS date FROM events e WHERE e.org_id=?
          AND EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = e.org_id AND g.event_id = e.id AND ${GIFT("g")})
        ORDER BY e.date DESC NULLS LAST, e.name LIMIT 300`, [orgId]);
    const campaigns = await query(
      `SELECT c.id, c.name, c.start_date, c.end_date FROM campaigns c WHERE c.org_id=? AND c.retired_at IS NULL
          AND EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = c.org_id AND g.campaign_id = c.id AND ${GIFT("g")})
        ORDER BY c.created_at DESC LIMIT 300`, [orgId]);
    const ACK = await ACK_READY;
    res.json({ events: events.map(e => ({ id: e.id, name: e.name, date: e.date || null, dateWords: ACK.formatLetterDate(e.date) || null })),
               campaigns: campaigns.map(c => ({ id: c.id, name: c.name, startDate: c.start_date || null, endDate: c.end_date || null })) });
  }));

  // The gifts behind one choice: { eventId | campaignId, from, to }.
  async function givingGifts(orgId, b) {
    const eventId = b?.eventId ? String(b.eventId) : null, campaignId = b?.campaignId ? String(b.campaignId) : null;
    // COMMS-3: Audience's "Send them a printed letter" chooses the mail-only donors (shared/numbers/reach.js).
    const group = b?.group === "mail_only" ? "mail_only" : null;
    if ([eventId, campaignId, group].filter(Boolean).length !== 1) return { error: "Choose one event or one campaign." };
    const today = await todayOf(orgId);
    const from = DAY.test(b?.from || "") ? b.from : "0001-01-01";
    const to = DAY.test(b?.to || "") ? b.to : today;
    if (from > to) return { error: "The range starts after it ends." };
    if (group) {
      const R = require("../../shared/numbers/reach");
      const rows = await query(
        `SELECT g.id FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
          WHERE g.org_id=? AND ${GIFT("g")} AND ${IN_SPAN("g")} AND g.is_sample IS NOT TRUE AND d.is_sample IS NOT TRUE
            AND ${require("../../shared/numbers/everyone").EVERYONE("d")} AND ${require("../../shared/numbers/isDonor").IS_DONOR("d")} AND ${R.PART_SQL("d")} = 'mail'
          ORDER BY g.date, g.id LIMIT 5001`, [orgId, from, to]);
      if (rows.length > 5000) return { error: "That is more than 5,000 gifts. Choose a shorter date range." };
      return { what: { kind: "group", id: group, name: "your mail-only donors" }, from: b?.from && DAY.test(b.from) ? from : null, to, today, giftIds: rows.map(r => r.id) };
    }
    const [what] = eventId
      ? await query("SELECT id, name FROM events WHERE id=? AND org_id=?", [eventId, orgId])
      : await query("SELECT id, name FROM campaigns WHERE id=? AND org_id=?", [campaignId, orgId]);
    if (!what) return { notFound: true };
    const rows = await query(
      `SELECT g.id FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id=? AND ${eventId ? "g.event_id" : "g.campaign_id"} = ? AND ${GIFT("g")} AND ${IN_SPAN("g")}
          AND g.is_sample IS NOT TRUE AND d.is_sample IS NOT TRUE AND d.deleted_at IS NULL
        ORDER BY g.date, g.id LIMIT 5001`, [orgId, what.id, from, to]);
    if (rows.length > 5000) return { error: "That is more than 5,000 gifts. Choose a shorter date range." };
    return { what: { kind: eventId ? "event" : "campaign", id: what.id, name: what.name }, from: b?.from && DAY.test(b.from) ? from : null, to, today, giftIds: rows.map(r => r.id) };
  }

  async function lettersFor(req) {
    const g = await givingGifts(req.user.orgId, req.body);
    if (g.error || g.notFound) return g;
    if (!g.giftIds.length) return { ...g, empty: true };
    const set = await ackLetterSet(req.user.orgId, g.giftIds, req.body?.templateId || null, { userId: req.user.userId, excludeDoNotContact: true, today: g.today });
    return { ...g, set };
  }
  const refuse = (res, r) => {
    if (r.notFound) return res.status(404).json({ error: "That event or campaign is not on file." }), true;
    if (r.error) return res.status(400).json({ error: r.error }), true;
    if (r.set && r.set.error) return res.status(400).json({ error: r.set.error }), true;
    if (r.set && r.set.notFound === true) return res.status(404).json({ error: "Template not found" }), true;
    return false;
  };

  app.post("/letters/giving/preview", requireAuth, wrap(async (req, res) => {
    const r = await lettersFor(req);
    if (refuse(res, r)) return;
    const ACK = await ACK_READY;
    if (r.empty) return res.json({ what: r.what, from: r.from, to: r.to, letters: [], skipped: [], giftCount: 0,
      sentence: r.what.kind === "group" ? "None of your mail-only donors gave in that range." : `Nobody gave to ${r.what.name} in that range.` });
    const set = r.set;
    const giftCount = set.letters.reduce((n, l) => n + l.giftIds.length, 0);
    const totalCents = set.letters.reduce((n, l) => n + l.totalCents, 0);
    const deductibleCents = set.letters.reduce((n, l) => n + l.deductibleCents, 0);
    res.json({
      what: r.what, from: r.from, to: r.to, template: set.template, signer: { name: set.signer.name, hasImage: !!set.signer.image },
      giftCount, total: totalCents / 100, deductible: deductibleCents / 100,
      // The sentences that define the numbers above them.
      sentence: `${set.letters.length} ${set.letters.length === 1 ? "letter" : "letters"}, ${r.what.kind === "group" ? "one for each of your mail-only donors who gave" : `one for each person who gave to ${r.what.name}`} ${r.from ? `from ${ACK.formatLetterDate(r.from)} to ${ACK.formatLetterDate(r.to)}` : `up to ${ACK.formatLetterDate(r.to)}`}, covering ${giftCount} ${giftCount === 1 ? "gift" : "gifts"} of ${ACK.formatCents(totalCents)}. Refunded gifts and soft credits are not counted.`,
      deductibleSentence: `Deductible is what each person paid less the fair market value of what they received (a ticket, a dinner, an auction item), as their receipts say: ${ACK.formatCents(deductibleCents)} in all.`,
      letters: set.letters.map(l => ({ donorId: l.donorId, name: l.name, address: l.address, text: l.text, giftIds: l.giftIds,
        total: l.totalCents / 100, deductible: l.deductibleCents / 100 })),
      skipped: set.skipped,
    });
  }));

  const sendFile = async (req, res, kind) => {
    const r = await lettersFor(req);
    if (refuse(res, r)) return;
    if (r.empty || !r.set.letters.length) return res.status(409).json({ error: "no_letters", skipped: r.set ? r.set.skipped : [],
      message: r.empty ? (r.what.kind === "group" ? "None of your mail-only donors gave in that range." : `Nobody gave to ${r.what.name} in that range.`) : "None of these letters can be printed yet. The reason is beside each name." });
    if (await require("../../exportGuard").largeExportRefused(req, res, r.set.letters.length)) return;   // SECURE-2 item 8
    const ACK = await ACK_READY;
    const opts = { dateLine: ACK.formatLetterDate(r.today), signature: r.set.signer.image };
    const file = kind === "pdf" ? await renderLettersPdf(r.set.org, r.set.letters, opts) : await renderLettersDocx(r.set.org, r.set.letters, opts);
    const slug = String(r.what.name || "letters").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "letters";
    if (req.audit) req.audit.rows(r.set.letters.length);   // SECURE-2 item 8: one letter per person
    res.setHeader("Content-Type", kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="letters-${slug}-${r.today}.${kind}"`);
    res.setHeader("X-Letters-Printed", String(r.set.letters.length));
    res.setHeader("X-Letters-Skipped", String(r.set.skipped.length));
    res.setHeader("Access-Control-Expose-Headers", "X-Letters-Printed, X-Letters-Skipped");
    res.end(file);
  };
  // Downloading sends nothing and marks nothing.
  app.post("/letters/giving/pdf", requireAuth, wrap((req, res) => sendFile(req, res, "pdf")));
  app.post("/letters/giving/docx", requireAuth, wrap((req, res) => sendFile(req, res, "docx")));

  // "Mark these as sent": its own press. Every gift in a printed letter gets
  // its acknowledgment (who, when, by letter), first stamp kept. It is a
  // thank-you only when she says so (THANKS-1): a tax letter is not one.
  app.post("/letters/giving/mark", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const r = await lettersFor(req);
    if (refuse(res, r)) return;
    const asked = new Set((Array.isArray(req.body?.giftIds) ? req.body.giftIds : []).map(String));
    // Only gifts in a letter that prints are marked; a left-out person's are not.
    const ids = r.empty ? [] : r.set.letters.flatMap(l => l.giftIds).filter(id => !asked.size || asked.has(id));
    if (!ids.length) return res.status(400).json({ error: "There are no printed letters to mark." });
    const thankYou = req.body?.thankYou === true;
    const [u] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
    const who = u?.name || actor(req).name;
    const rows = await query(
      `UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=COALESCE(acknowledgement_sent_at, NOW()),
                        ${thankYou ? "thanked_at=COALESCE(thanked_at, NOW())," : ""}
                        acknowledged_by=COALESCE(acknowledged_by, ?), acknowledged_by_name=COALESCE(acknowledged_by_name, ?),
                        acknowledged_via=COALESCE(acknowledged_via, 'letter')
        WHERE org_id=? AND id = ANY(?) RETURNING id`, [actor(req).id, who, req.user.orgId, ids]);
    if (thankYou) await run("UPDATE thank_you_drafts SET sent_at=COALESCE(sent_at, NOW()) WHERE org_id=? AND (gift_id = ANY(?) OR also_gift_ids && ?::text[]) AND sent_at IS NULL AND skipped_at IS NULL", [req.user.orgId, ids, ids]).catch(() => {});
    res.json({ marked: rows.length, thankYou,
      sentence: `${rows.length} ${rows.length === 1 ? "gift" : "gifts"} now show a letter was sent${thankYou ? " and the gift was thanked" : ""}.` });
  }));
}

module.exports = { routers, mount, signatureOk };
