// routes/emailsSent.js · FIX-40. EVERY EMAIL CAN BE READ, AND EVERY PERSON IT
// WENT TO OPENS.
//
// A campaign, a sequence step and a journey email each open one page: the
// email as it went (subject, sender, body for one example person), when it
// went, and who it went to, each name a link to the profile. A person's
// profile lists every email Steward knows they were sent, and each one opens
// as THEY got it.
//
// WHAT STEWARD KEEPS AND WHAT IT DOES NOT. A journey email is a draft a person
// sent, so its filled subject and body are stored and shown as they were. A
// campaign or a sequence step stores its template, not each person's copy, so
// the page renders the template for that person with the SAME code the send
// uses (emailCompose for block campaigns, legacyCampaignBody for the older
// ones, sequenceMergeValues + renderMerge for sequences) and says so in one
// line. A thank-you is written by Steward and sent by a person from her own
// email, so the page shows the words Steward drafted. The email tool's body is
// not read at all, and the page says that too.
//
// READ ONLY. Every route here is a GET and writes nothing. Tenant scope is the
// org on every query, and a volunteer coordinator never reaches these paths
// (auth.js allowlist: /donors, /campaigns, /sequences and /emails are not on it).
const express = require("express");

const routers = { r0: express.Router() };

function mount(ctx) {
const {
  query, requireAuth, wrap, emailCompose, legacyCampaignBody, sequenceMergeValues, seqReady,
  orgSendingIdentity, orgToday, orgTz,
} = ctx;
const app = routers.r0;

const REBUILT = "Steward keeps the template, not each person's copy, so this is the email filled in with this person's details as they are today.";
const THANKS = "Steward drafted these words. You sent them from your own email, so Steward has no copy of what left your outbox.";
const TOOL = "This went from your email tool. Steward reads who opened, clicked and asked to stop, not the email's body.";

const parseFrom = s => {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(s || ""));
  return m ? { name: m[1] || null, email: m[2] } : { name: null, email: String(s || "") || null };
};
const sender = async orgId => parseFrom((await orgSendingIdentity(orgId).catch(() => ({}))).from);
const bodyFrom = text => (String(text || "").includes("<") ? String(text || "")
  : `<p>${String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`);

async function personDonor(orgId, donorId) {
  const [d] = await query(
    `SELECT id, name, email, total_giving, gift_count, last_gift_amount, last_gift_date, custom_fields
       FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
  return d || null;
}

// ── ONE CAMPAIGN, FILLED FOR ONE PERSON ─────────────────────────────────────
async function campaignFor(orgId, c, donor) {
  if (emailCompose.hasBlocks(c)) {
    const rctx = await emailCompose.orgRenderContext(orgId);
    const fields = await emailCompose.personFields(rctx, donor, { campaignName: c.name || "" });
    const r = await emailCompose.render(rctx, { blocks: c.email_blocks, subject: c.subject, preheader: c.preheader, fields, mode: "send" });
    return { subject: await emailCompose.subjectFor(c.subject, fields), body: r.html || "" };
  }
  const [org] = await query("SELECT name FROM orgs WHERE id=?", [orgId]);
  const year = orgToday(await orgTz(orgId)).slice(0, 4); // ORG_TZ_SEAM_OK the {{year}} token is the org's civil year, as the send reads it
  return { subject: c.subject || "", body: await legacyCampaignBody(c.body, donor, org ? org.name : "", year) };
}

async function sequenceFor(orgId, step, donor) {
  const SEQ = await seqReady;
  const values = await sequenceMergeValues(donor, orgId);
  return { subject: SEQ.renderMerge(step.subject, values).text, body: bodyFrom(SEQ.renderMerge(step.body, values).text) };
}

async function suppressedSet(orgId) {
  const rows = await query("SELECT LOWER(email) AS e FROM email_suppressions WHERE org_id=?", [orgId]);
  return new Set(rows.map(r => r.e));
}
const statusOf = r => (r.sent_at ? "delivered" : r.failure_reason && !/^suppressed:/i.test(r.failure_reason) ? "bounced" : "not sent");
const countsOf = recips => ({
  sent: recips.length,
  delivered: recips.filter(r => r.status === "delivered").length,
  bounced: recips.filter(r => r.status === "bounced").length,
  unsubscribed: recips.filter(r => r.unsubscribed).length,
});

async function campaignRecipients(orgId, campaignId) {
  const sup = await suppressedSet(orgId);
  const rows = await query(
    `SELECT cr.donor_id, cr.email, cr.sent_at, cr.failure_reason, d.name
       FROM campaign_recipients cr
       LEFT JOIN donors d ON d.id = cr.donor_id AND d.org_id = cr.org_id AND d.deleted_at IS NULL
      WHERE cr.org_id=? AND cr.campaign_id=?
      ORDER BY d.name NULLS LAST, cr.email`, [orgId, campaignId]);
  return rows.map(r => ({
    donorId: r.name ? r.donor_id : null, name: r.name || r.email, email: r.email, sentAt: r.sent_at,
    status: statusOf(r), reason: r.failure_reason || null, unsubscribed: sup.has(String(r.email || "").toLowerCase()),
  }));
}

// GET /campaigns/:id/as-sent
app.get("/campaigns/:id/as-sent", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [c] = await query("SELECT * FROM campaigns WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  const recipients = await campaignRecipients(orgId, c.id);
  const first = recipients.find(r => r.status === "delivered" && r.donorId) || recipients.find(r => r.donorId);
  let example = null;
  if (first) {
    const d = await personDonor(orgId, first.donorId);
    if (d) example = { donorId: d.id, name: d.name, ...(await campaignFor(orgId, c, d)), note: REBUILT };
  }
  res.json({
    kind: "campaign", id: c.id, name: c.name, subject: c.subject || "", body: c.body || "",
    from: await sender(orgId), sentAt: c.sent_at || null, example, recipients, counts: countsOf(recipients),
  });
}));

// GET /sequences/:id/steps/:order/as-sent
app.get("/sequences/:id/steps/:order/as-sent", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const order = Number(req.params.order);
  const [s] = await query("SELECT id, name FROM sequences WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!s || !Number.isFinite(order)) return res.status(404).json({ error: "Sequence step not found" });
  const [step] = await query("SELECT * FROM sequence_steps WHERE sequence_id=? AND step_order=? ORDER BY id LIMIT 1", [s.id, order]);
  if (!step) return res.status(404).json({ error: "Sequence step not found" });
  const sup = await suppressedSet(orgId);
  const rows = await query(
    `SELECT ss.donor_id, ss.status, ss.error, ss.sent_at, d.name, d.email
       FROM sequence_sends ss
       LEFT JOIN donors d ON d.id = ss.donor_id AND d.org_id = ss.org_id AND d.deleted_at IS NULL
      WHERE ss.org_id=? AND ss.sequence_id=? AND ss.step_order=?
      ORDER BY d.name NULLS LAST`, [orgId, s.id, order]);
  const recipients = rows.map(r => ({
    donorId: r.name ? r.donor_id : null, name: r.name || "Someone no longer on file", email: r.email || null, sentAt: r.sent_at,
    status: r.status === "sent" ? "delivered" : r.status === "failed" ? "bounced" : "not sent", reason: r.error || null,
    unsubscribed: sup.has(String(r.email || "").toLowerCase()),
  }));
  const first = recipients.find(r => r.status === "delivered" && r.donorId);
  let example = null;
  if (first) {
    const d = await personDonor(orgId, first.donorId);
    if (d) example = { donorId: d.id, name: d.name, ...(await sequenceFor(orgId, step, d)), note: REBUILT };
  }
  const sentAt = recipients.map(r => r.sentAt).filter(Boolean).sort().pop() || null;
  res.json({
    kind: "sequence", id: `${s.id}:${order}`, name: `${s.name}, step ${order}`, subject: step.subject || "", body: step.body || "",
    from: await sender(orgId), sentAt, example, recipients, counts: countsOf(recipients),
  });
}));

// GET /emails/journey/:draftId/as-sent
async function draftAsSent(orgId, draftId) {
  const [m] = await query(
    `SELECT m.*, d.name, d.email FROM milestone_drafts m
       LEFT JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id AND d.deleted_at IS NULL
      WHERE m.id=? AND m.org_id=? AND m.status='sent'`, [draftId, orgId]);
  if (!m) return null;
  const sup = await suppressedSet(orgId);
  const recipients = [{ donorId: m.name ? m.donor_id : null, name: m.name || "Someone no longer on file", email: m.email || null,
    sentAt: m.sent_at, status: m.send_error ? "bounced" : "delivered", reason: m.send_error || null,
    unsubscribed: sup.has(String(m.email || "").toLowerCase()) }];
  return {
    kind: "journey", id: m.id, name: m.subject || "An email", subject: m.subject || "", body: m.body || "",
    from: await sender(orgId), sentAt: m.sent_at || null,
    example: m.name ? { donorId: m.donor_id, name: m.name, subject: m.subject || "", body: bodyFrom(m.body), note: null } : null,
    recipients, counts: countsOf(recipients),
  };
}
app.get("/emails/journey/:draftId/as-sent", requireAuth, wrap(async (req, res) => {
  const out = await draftAsSent(req.user.orgId, req.params.draftId);
  if (!out) return res.status(404).json({ error: "Email not found" });
  res.json(out);
}));

// ── EVERY EMAIL ONE PERSON WAS SENT ─────────────────────────────────────────
const base = (kind, donorId, ref) => `/donors/${encodeURIComponent(donorId)}/emails-received/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}`;

app.get("/donors/:id/emails-received", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const d = await personDonor(orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const id = d.id;
  const [camps, seqs, drafts, thanks, tool] = await Promise.all([
    query(`SELECT c.id, c.name, c.subject, cr.sent_at FROM campaign_recipients cr
             JOIN campaigns c ON c.id = cr.campaign_id AND c.org_id = cr.org_id
            WHERE cr.org_id=? AND cr.donor_id=? AND cr.sent_at IS NOT NULL`, [orgId, id]),
    query(`SELECT ss.sequence_id, ss.step_order, ss.subject, ss.sent_at, s.name FROM sequence_sends ss
             JOIN sequences s ON s.id = ss.sequence_id AND s.org_id = ss.org_id
            WHERE ss.org_id=? AND ss.donor_id=? AND ss.status='sent'`, [orgId, id]),
    query(`SELECT id, subject, sent_at, source FROM milestone_drafts
            WHERE org_id=? AND donor_id=? AND status='sent'`, [orgId, id]),
    query(`SELECT t.id, t.sent_at, g.amount, g.date FROM thank_you_drafts t
             LEFT JOIN gifts g ON g.id = t.gift_id AND g.org_id = t.org_id
            WHERE t.org_id=? AND t.donor_id=? AND t.sent_at IS NOT NULL`, [orgId, id]),
    query(`SELECT c.id, c.name, c.subject, c.sent_at, c.provider FROM email_marketing_activity a
             JOIN email_marketing_campaigns c ON c.id = a.campaign_id AND c.org_id = a.org_id
            WHERE a.org_id=? AND a.donor_id=?`, [orgId, id]),
  ]);
  const toolName = p => ({ mailchimp: "Mailchimp", constantcontact: "Constant Contact", constant_contact: "Constant Contact" }[String(p || "").toLowerCase()] || "your email tool");
  const money = n => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  // The subject as this person read it, filled the way the send filled it.
  const campSubject = async r => {
    const [c] = await query("SELECT * FROM campaigns WHERE id=? AND org_id=?", [r.id, orgId]);
    return c ? (await campaignFor(orgId, c, d)).subject : r.subject || "";
  };
  const seqSubject = async r => {
    const [step] = await query("SELECT * FROM sequence_steps WHERE sequence_id=? AND step_order=? ORDER BY id LIMIT 1", [r.sequence_id, r.step_order]);
    return step ? (await sequenceFor(orgId, step, d)).subject : r.subject || "";
  };
  const emails = [
    ...await Promise.all(camps.map(async r => ({ kind: "campaign", ref: r.id, title: r.name, subject: await campSubject(r), sentAt: r.sent_at }))),
    ...await Promise.all(seqs.map(async r => ({ kind: "sequence", ref: `${r.sequence_id}:${r.step_order}`, title: `${r.name}, step ${r.step_order}`, subject: await seqSubject(r), sentAt: r.sent_at }))),
    ...drafts.map(r => ({ kind: "journey", ref: r.id, title: r.source === "journey" ? "Journey email" : "Email from your review queue", subject: r.subject || "", sentAt: r.sent_at })),
    ...thanks.map(r => ({ kind: "thank-you", ref: r.id, title: r.amount != null ? `Thank-you for the ${money(r.amount)} gift` : "Thank-you", subject: "", sentAt: r.sent_at })),
    ...tool.map(r => ({ kind: "email tool", ref: r.id, title: `${r.name || "A campaign"} (${toolName(r.provider)})`, subject: r.subject || "", sentAt: r.sent_at })),
  ].map(e => ({ ...e, open: { path: base(e.kind, id, e.ref) } }))
   .sort((a, b) => String(b.sentAt || "").localeCompare(String(a.sentAt || "")));
  res.json({ emails });
}));

// GET /donors/:id/emails-received/:kind/:ref  · one email as THIS person got it
app.get("/donors/:id/emails-received/:kind/:ref", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const d = await personDonor(orgId, req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const { kind, ref } = req.params;
  const sup = await suppressedSet(orgId);
  const one = (sentAt, status, reason) => [{ donorId: d.id, name: d.name, email: d.email || null, sentAt, status,
    reason: reason || null, unsubscribed: sup.has(String(d.email || "").toLowerCase()) }];
  const shape = (o, recipients) => ({ ...o, recipients, counts: countsOf(recipients) });
  const from = await sender(orgId);

  if (kind === "campaign") {
    const [c] = await query("SELECT * FROM campaigns WHERE id=? AND org_id=?", [ref, orgId]);
    const [cr] = c ? await query("SELECT sent_at, failure_reason FROM campaign_recipients WHERE org_id=? AND campaign_id=? AND donor_id=? ORDER BY sent_at DESC NULLS LAST LIMIT 1", [orgId, c.id, d.id]) : [];
    if (!c || !cr) return res.status(404).json({ error: "Email not found" });
    const filled = await campaignFor(orgId, c, d);
    return res.json(shape({ kind, id: c.id, name: c.name, subject: c.subject || "", body: c.body || "", from, sentAt: cr.sent_at,
      example: { donorId: d.id, name: d.name, ...filled, note: REBUILT } }, one(cr.sent_at, statusOf(cr), cr.failure_reason)));
  }
  if (kind === "sequence") {
    const [seqId, orderS] = String(ref).split(":");
    const [s] = await query("SELECT id, name FROM sequences WHERE id=? AND org_id=?", [seqId, orgId]);
    const [ss] = s ? await query("SELECT * FROM sequence_sends WHERE org_id=? AND sequence_id=? AND donor_id=? AND step_order=?", [orgId, s.id, d.id, Number(orderS)]) : [];
    const [step] = ss ? await query("SELECT * FROM sequence_steps WHERE sequence_id=? AND step_order=? ORDER BY id LIMIT 1", [s.id, ss.step_order]) : [];
    if (!s || !ss || !step) return res.status(404).json({ error: "Email not found" });
    return res.json(shape({ kind, id: ref, name: `${s.name}, step ${ss.step_order}`, subject: step.subject || "", body: step.body || "", from, sentAt: ss.sent_at,
      example: { donorId: d.id, name: d.name, ...(await sequenceFor(orgId, step, d)), note: REBUILT } },
      one(ss.sent_at, ss.status === "sent" ? "delivered" : ss.status === "failed" ? "bounced" : "not sent", ss.error)));
  }
  if (kind === "journey") {
    const out = await draftAsSent(orgId, ref);
    if (!out || !out.recipients[0] || out.recipients[0].donorId !== d.id) return res.status(404).json({ error: "Email not found" });
    return res.json(out);
  }
  if (kind === "thank-you") {
    const [t] = await query("SELECT * FROM thank_you_drafts WHERE id=? AND org_id=? AND donor_id=? AND sent_at IS NOT NULL", [ref, orgId, d.id]);
    if (!t) return res.status(404).json({ error: "Email not found" });
    return res.json(shape({ kind, id: t.id, name: "Thank-you", subject: "", body: t.body || "", from: null, sentAt: t.sent_at,
      example: { donorId: d.id, name: d.name, subject: "", body: bodyFrom(t.body), note: THANKS } }, one(t.sent_at, "delivered")));
  }
  if (kind === "email tool") {
    const [c] = await query(
      `SELECT c.* FROM email_marketing_campaigns c JOIN email_marketing_activity a ON a.campaign_id = c.id AND a.org_id = c.org_id
        WHERE c.id=? AND c.org_id=? AND a.donor_id=?`, [ref, orgId, d.id]);
    if (!c) return res.status(404).json({ error: "Email not found" });
    return res.json(shape({ kind, id: c.id, name: c.name || "A campaign", subject: c.subject || "", body: "", from: null, sentAt: c.sent_at,
      example: { donorId: d.id, name: d.name, subject: c.subject || "", body: "", note: TOOL } }, one(c.sent_at, "delivered")));
  }
  res.status(404).json({ error: "Email not found" });
}));
}

module.exports = { routers, mount };
