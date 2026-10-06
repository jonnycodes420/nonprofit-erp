// routes/grantMail.js · GRANTS-1. EMAIL TO AND FROM A FUNDER LANDS ON THE GRANT.
//
//   GET /grants/email-path      which way this org's funder email arrives, in one sentence
//
// and `routeToFunderGrant`, THE ONE FUNCTION both mail paths call:
//   · the staff mailbox sync (server.js syncMailbox, Gmail and Outlook), and
//   · the BCC address (POST /inbound-email in routes/webhooks.js).
//
// THE RULE. A message is a funder message when somebody on it (not staff, not
// the mailbox owner) is a funder contact: a person row linked to a funder by
// donor_relationships ('program_officer' or 'funder_contact', donor_id_a = the
// funder, donor_id_b = the person), or the funder organisation's own address.
// Then, and only then, for each funder on the message:
//   1. the funder's own row gets the email on its timeline (metadata carries
//      grant_id), or the row the caller already wrote is stamped with it;
//   2. the funder's open grant is picked: the most recently updated grant
//      whose status is open or holds an award (researching, loi, invited,
//      submitted, awarded, reporting); with none open, the most recent grant;
//   3. a grant_sends row records it (what 'email', direction out when the
//      staff member sent it, in when the funder side did);
//   4. every attachment the path can hand over is stored as a grant document
//      through the same asset store and the same type sniff as the upload
//      route (grantDocs.js): PDF yes, html and svg never, 20 MB cap.
// Anybody else on a message writes NOTHING on any grant. The ordinary donor
// logging is the caller's and is unchanged.
//
// Idempotent: grant_sends on (org, grant, message_id) and grant_documents on
// (grant, message_id, file_name), so a second sync of the same message adds
// nothing. Every insert carries the caller's system actor. Nothing here writes
// an audit row (the one audit write is middleware/auditTrail.js).
"use strict";
const express = require("express");
const crypto = require("crypto");
const grantDocs = require("../grantDocs");

// r0 is mounted with the other grant modules; r1 is mounted AHEAD of
// routes/crm.js, because crm's GET /grants/:id answers 404 for any id and a
// fixed path like /grants/email-path would never reach a later router.
const routers = { r0: express.Router(), r1: express.Router() };

const CONTACT_TYPES = ["program_officer", "funder_contact"];
// The grant an email is about: one still being pursued or still being reported on.
const LIVE_STATUSES = ["researching", "loi", "invited", "submitted", "awarded", "reporting"];

let C = null;   // the mounted context; routeToFunderGrant needs query/run/uuid/the asset store

const norm = e => String(e || "").trim().toLowerCase();

// The filename is the only honest signal about what a funder attachment is.
// Nothing reads the file: Steward stores it, types it, dates it.
function docTypeFromFilename(name) {
  const s = String(name || "").toLowerCase().replace(/[_\-.]+/g, " ");
  if (/\bloi\b|letter of (inquiry|intent)/.test(s)) return "loi";
  if (/\baward\b|\bgrant agreement\b/.test(s)) return "award_letter";
  if (/\bbudget\b/.test(s)) return "budget";
  if (/\breport\b/.test(s)) return "report";
  if (/\bproposal\b|\bapplication\b/.test(s)) return "proposal";
  return "correspondence";
}

// A declared type Steward will not store can still be a PDF Gmail labelled
// application/octet-stream; the extension proposes, the first bytes decide.
const EXT_MIME = { pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", txt: "text/plain" };
function mimeFor(declared, fileName) {
  const d = norm(declared).split(";")[0];
  if (grantDocs.mimeAllowed(d)) return d;
  const ext = (String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
  return EXT_MIME[ext] || d;
}

// The funders on a message, each with the contact who was on it.
async function fundersOnMessage(orgId, addresses) {
  if (!addresses.length) return [];
  const rows = await C.query(
    `SELECT r.donor_id_a AS funder_id, f.name AS funder_name, p.id AS contact_id, p.name AS contact_name,
            LOWER(TRIM(p.email)) AS contact_email, 1 AS rank
       FROM donor_relationships r
       JOIN donors p ON p.id = r.donor_id_b AND p.org_id = r.org_id AND p.deleted_at IS NULL
       JOIN donors f ON f.id = r.donor_id_a AND f.org_id = r.org_id AND f.deleted_at IS NULL
      WHERE r.org_id = ? AND r.relationship_type = ANY(?::text[]) AND LOWER(TRIM(p.email)) = ANY(?::text[])
     UNION ALL
     SELECT f.id, f.name, f.id, f.name, LOWER(TRIM(f.email)), 2
       FROM donors f
      WHERE f.org_id = ? AND f.deleted_at IS NULL AND LOWER(TRIM(f.email)) = ANY(?::text[])
        AND (EXISTS (SELECT 1 FROM grants g WHERE g.org_id = f.org_id AND g.funder_donor_id = f.id)
             OR EXISTS (SELECT 1 FROM donor_relationships r2 WHERE r2.org_id = f.org_id AND r2.donor_id_a = f.id
                          AND r2.relationship_type = ANY(?::text[])))
      ORDER BY rank`,
    [orgId, CONTACT_TYPES, addresses, orgId, addresses, CONTACT_TYPES]);
  // One entry per funder; a named contact beats the funder's general address.
  const byFunder = new Map();
  for (const r of rows) if (!byFunder.has(r.funder_id)) byFunder.set(r.funder_id, r);
  return [...byFunder.values()];
}

async function pickGrant(orgId, funderId) {
  const S = await import("../shared/grantShape.js");
  const grants = await C.query(
    `SELECT id, status, updated_at, created_at FROM grants WHERE org_id = ? AND funder_donor_id = ?
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`, [orgId, funderId]);
  return grants.find(g => LIVE_STATUSES.includes(S.normalizeStatus(g.status))) || grants[0] || null;
}

/**
 * Route one message to its funder's grant. Returns null when nobody on the
 * message is a funder contact (and then nothing was written), else
 * { funders: [{ funderId, grantId, contactId, sendId, documents, refused, attachmentsUnavailable }] }.
 *
 * @param o.orgId
 * @param o.message      { id, from, to[], cc[], subject, sentOn (org civil date), receivedAt }
 * @param o.ownerAddress the staff mailbox (or BCC sender) address: from it = direction out
 * @param o.staffEmails  the org's users' addresses, never a funder contact
 * @param o.source       'mailbox' | 'bcc'
 * @param o.provider     'google' | 'microsoft' | 'resend' | ...
 * @param o.actorId      `system:mailbox/<provider>/<userId>` or `system:inbound-email`
 * @param o.actorName    the staff member whose mail it was
 * @param o.note         the timeline line already written for the donor side
 * @param o.attachmentCount how many attachments the message says it has
 * @param o.loadAttachments async () => [{ fileName, contentType, buffer?, size? }] or null (not available)
 */
async function routeToFunderGrant(o) {
  if (!C) throw new Error("routeToFunderGrant called before routes/grantMail mount()");
  const { orgId, message: m } = o;
  const messageId = String(m.id || "");
  if (!orgId || !messageId) return null;
  const owner = norm(o.ownerAddress);
  const staff = new Set([...(o.staffEmails || []).map(norm), owner].filter(Boolean));
  const from = norm(m.from);
  const addresses = [...new Set([from, ...(m.to || []), ...(m.cc || [])].map(norm).filter(a => a && !staff.has(a)))];
  const funders = await fundersOnMessage(orgId, addresses);
  if (!funders.length) return null;

  const direction = from && staff.has(from) ? "out" : "in";
  const subject = String(m.subject || "").trim() || "(no subject)";
  const sentOn = String(m.sentOn || "").slice(0, 10);
  let loaded;            // attachments are fetched once, however many funders share the message
  const out = [];

  for (const f of funders) {
    const grant = await pickGrant(orgId, f.funder_id);
    const grantId = grant ? grant.id : null;
    const result = { funderId: f.funder_id, grantId, contactId: f.contact_id, sendId: null,
                     documents: 0, refused: [], attachmentsUnavailable: false };

    // 1 · the funder's own timeline. When the caller already wrote this
    //     message on the funder row (the funder's own address was on it), that
    //     row is stamped with the grant instead of a second line.
    const meta = { grant_id: grantId, funder_contact_id: f.contact_id };
    const upd = await C.query(
      `UPDATE interactions SET metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb
        WHERE org_id = ? AND donor_id = ? AND metadata->>'message_id' = ? RETURNING id`,
      [JSON.stringify(meta), orgId, f.funder_id, messageId]);
    if (!upd.length) {
      const note = o.note || subject;
      await C.run(
        `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_at, created_by, logged_by_name, metadata)
         VALUES (?,?,?,'email',?,?,?,?,?,?)`,
        ["int_" + C.uuid().slice(0, 8), orgId, f.funder_id, note, sentOn || null,
         m.receivedAt || new Date().toISOString(), o.actorId, o.actorName || null,
         JSON.stringify({ message_id: messageId, provider: o.provider || null, via: o.source,
                          direction: direction === "out" ? "outbound" : "inbound", subject,
                          attachments: Number(o.attachmentCount) || 0, ...meta })]);
    }
    if (!grantId) { out.push(result); continue; }

    // 2 · what went to (or came from) the funder, on the grant.
    const sendId = "gsend_" + C.uuid().slice(0, 10);
    const ins = await C.query(
      `INSERT INTO grant_sends (id, org_id, grant_id, funder_donor_id, what, subject, sent_on, sent_to_name, sent_to_email,
                                direction, source, message_id, created_by, created_by_name)
       VALUES (?,?,?,?,'email',?,?,?,?,?,?,?,?,?)
       ON CONFLICT (org_id, grant_id, message_id) WHERE message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [sendId, orgId, grantId, f.funder_id, subject, sentOn, f.contact_name || null, f.contact_email || null,
       direction, o.source, messageId, o.actorId, o.actorName || null]);
    result.sendId = ins.length ? ins[0].id
      : ((await C.query(`SELECT id FROM grant_sends WHERE org_id=? AND grant_id=? AND message_id=?`,
          [orgId, grantId, messageId]))[0] || {}).id || null;

    // 3 · the attachments, as grant documents.
    if (Number(o.attachmentCount) > 0 && o.loadAttachments) {
      if (loaded === undefined) loaded = await o.loadAttachments().catch(e => {
        console.error("[grant-mail] attachments:", e.message); return null; });
      if (!loaded) { result.attachmentsUnavailable = true; out.push(result); continue; }
      for (const a of loaded) {
        const stored = await storeAttachment({ orgId, grantId, messageId, attachment: a, contact: f, sentOn, subject,
          direction, actorId: o.actorId, actorName: o.actorName, source: o.source });
        if (stored.ok) result.documents++;
        else if (stored.reason) result.refused.push({ fileName: a.fileName || "", reason: stored.reason });
      }
    } else if (Number(o.attachmentCount) > 0) {
      result.attachmentsUnavailable = true;
    }
    out.push(result);
  }
  return { funders: out };
}

async function storeAttachment({ orgId, grantId, messageId, attachment: a, contact, sentOn, subject, direction, actorId, actorName, source }) {
  const mime = mimeFor(a.contentType, a.fileName);
  if (!grantDocs.mimeAllowed(mime)) return { ok: false, reason: "type_not_stored" };
  const fileName = grantDocs.sanitizeFilename(a.fileName, mime);
  const [dupe] = await C.query(
    `SELECT id FROM grant_documents WHERE grant_id=? AND message_id=? AND file_name=?`, [grantId, messageId, fileName]);
  if (dupe) return { ok: false, reason: null };
  if (Number(a.size) > grantDocs.DOC_MAX_BYTES) return { ok: false, reason: "too_large" };
  const buffer = Buffer.isBuffer(a.buffer) ? a.buffer : null;
  if (!buffer || !buffer.length) return { ok: false, reason: "not_available" };
  if (buffer.length > grantDocs.DOC_MAX_BYTES) return { ok: false, reason: "too_large" };
  // THE BYTES DECIDE, exactly as on the upload route: a "PDF" that opens as
  // HTML is refused before anything is stored.
  if (!grantDocs.bytesMatchMime(buffer, mime)) return { ok: false, reason: "type_mismatch" };

  const asset = await C.putThemeAsset({ orgId, kind: grantDocs.DOC_ASSET_KIND, buffer, contentType: mime });
  const id = "gdoc_" + C.uuid().slice(0, 10);
  const way = direction === "out" ? "Sent to" : "Received from";
  const ins = await C.query(
    `INSERT INTO grant_documents (id,org_id,grant_id,doc_type,asset_id,file_name,content_type,bytes,notes,uploaded_by,uploaded_by_name,
                                  source,sent_on,sent_to_name,sent_to_email,message_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT DO NOTHING RETURNING id`,
    [id, orgId, grantId, docTypeFromFilename(fileName), asset.id, fileName, mime, buffer.length,
     `${way} ${contact.contact_name || contact.contact_email || "the funder"} by email: ${subject}`.slice(0, 2000),
     actorId, actorName || null, source, sentOn || null, contact.contact_name || null, contact.contact_email || null, messageId]);
  if (!ins.length) return { ok: false, reason: null };
  await C.recordAssetPointerHistory(orgId, "grant.document", id, null, asset.id, { userId: actorId, email: null });
  return { ok: true, id };
}

// A stable id for a BCC message with no provider id, so a redelivered
// webhook does not record the same send twice.
function bccMessageId(payload) {
  const p = payload || {};
  const given = p.messageId || p.message_id || p.providerEmailId;
  if (given) return String(given);
  const h = crypto.createHash("sha256")
    .update([p.from, JSON.stringify(p.to || ""), p.subject, p.date].map(x => String(x || "")).join("|")).digest("hex");
  return "bcc_" + h.slice(0, 24);
}

// The BCC path's attachments: in the payload with their bytes, behind a
// download URL, or listed by Resend's receiving API. Anything else is null,
// and the send is recorded with the attachments said to be unavailable.
function bccAttachmentLoader(payload, { receivingBase, apiKey } = {}) {
  const list = Array.isArray(payload && payload.attachments) ? payload.attachments : [];
  const allowedUrl = u => {
    try {
      const url = new URL(String(u));
      if (url.protocol === "https:") return true;
      return !!receivingBase && url.origin === new URL(receivingBase).origin;
    } catch { return false; }
  };
  const fromList = async items => {
    const out = [];
    let usable = 0;
    for (const a of items) {
      const fileName = a.filename || a.fileName || a.name || "";
      const contentType = a.content_type || a.contentType || a.type || "";
      const size = Number(a.size) || null;
      if (typeof a.content === "string" && a.content) {
        usable++;
        out.push({ fileName, contentType, size, buffer: Buffer.from(a.content, "base64") });
      } else if (a.download_url && allowedUrl(a.download_url)) {
        usable++;
        if (size && size > grantDocs.DOC_MAX_BYTES) { out.push({ fileName, contentType, size }); continue; }
        const r = await fetch(a.download_url).catch(() => null);
        out.push({ fileName, contentType, size, buffer: r && r.ok ? Buffer.from(await r.arrayBuffer()) : null });
      }
    }
    return usable ? out : null;
  };
  return async () => {
    const direct = await fromList(list);
    if (direct) return direct;
    if (!payload || !payload.providerEmailId || !apiKey) return null;
    const root = String(receivingBase || "https://api.resend.com").replace(/\/+$/, "");
    const r = await fetch(`${root}/emails/receiving/${encodeURIComponent(payload.providerEmailId)}/attachments`,
      { headers: { Authorization: `Bearer ${apiKey}` } }).catch(() => null);
    if (!r || !r.ok) return null;
    const body = await r.json().catch(() => null);
    return fromList(Array.isArray(body && body.data) ? body.data : []);
  };
}

function mount(ctx) {
  C = ctx;
  const { query, wrap, requireAuth } = ctx;

  // GET /grants/email-path: which way funder email reaches this org's grants.
  // mailbox: at least one staff mailbox connection is live with sealed
  // credentials. bcc: the inbound address is switched on for the deployment and
  // the org. none: neither, said as the step that fixes it.
  routers.r1.get("/grants/email-path", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const conns = await query(
      `SELECT m.provider, m.user_id, u.name FROM mailbox_connections m LEFT JOIN users u ON u.id = m.user_id AND u.org_id = m.org_id
        WHERE m.org_id = ? AND m.status = 'active' AND m.credentials_sealed IS NOT NULL
        ORDER BY m.created_at`, [orgId]);
    const [org] = await query(`SELECT org_slug, inbound_email_enabled FROM orgs WHERE id = ?`, [orgId]);
    const IE = await import("../shared/inboundEmail.js");
    const domain = (process.env.INBOUND_EMAIL_DOMAIN || "").trim().toLowerCase();
    const bccOn = process.env.INBOUND_EMAIL_ENABLED === "1" && !!domain && org && org.inbound_email_enabled !== false;
    const bccAddress = bccOn ? IE.loggingAddress(org.org_slug || "", domain) : "";
    const people = [...new Set(conns.map(c => c.user_id))];
    const label = p => (p === "microsoft" ? "Outlook" : "Gmail");
    const first = s => String(s || "").trim().split(/\s+/)[0] || "";
    let path = "none", provider = null, sentence;
    if (conns.length) {
      path = "mailbox";
      provider = conns[0].provider;
      const who = first(conns[0].name);
      sentence = people.length === 1
        ? `Email to funders arrives from ${who ? who + "'s" : "a staff"} ${label(provider)}.`
        : `Email to funders arrives from ${people.length} staff mailboxes.`;
    } else if (bccOn) {
      path = "bcc";
      sentence = `Email arrives through your BCC address, ${bccAddress}, until Google approves Gmail access.`;
    } else {
      sentence = "No email reaches your grants yet. Connect a mailbox in Settings, or switch on the BCC address.";
    }
    res.json({ path, provider, connectedPeople: people.length, bccAddress: bccAddress || null, sentence });
  }));
}

module.exports = { routers, mount, routeToFunderGrant, bccMessageId, bccAttachmentLoader, docTypeFromFilename };
