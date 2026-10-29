// SEND-GATE-1 (27 Oct 2026) · THE ONE GATE FOR MAIL TO A DONOR.
//
// On 27 Oct a real import into Justin's Place partly landed through a page
// that timed out. Nothing went out, because Donor mail was off, but that one
// org switch was the only lock. Now the org decides, person by person, who
// gets automatic email: `donors.auto_email`, off for everyone until a person
// on staff turns it on (profile, or the Donors list in bulk). Nothing else
// can turn it on: no import, journey, form, webhook, boot job or AI step.
//
// WHERE IT SITS. `sendToDonor` is called by the wrapped Resend client in
// server.js (the only client that sends org mail; tests/send-gate.test.js
// scans for any other), for every send tagged with an org whose family is
// donor mail (mailPolicy.categoryOf). So every donor-bound send passes it by
// construction, including ones written later. The org switch (Donor mail) is
// asked just above it, by the same proxy, and refuses first.
//
// THE RULE, for one message:
//   1. The donor portal sign-in link the donor asked for (`express_link`) goes.
//   2. A message a person on staff sent by hand carries `_stewardConfirm`: the
//      id of a `send_confirms` row recorded by their click, for this
//      recipient, unused. It goes, and the row is used up (once, ever).
//   3. Everything else is automatic and goes only if every recipient is a
//      person in this org whose switch is on.
//   Otherwise nothing is sent and nothing is queued: one `mail_blocked` row
//   (the profile's "… not sent: automatic emails are off" line, with Send)
//   keeps the exact message, and the caller hears a permanent refusal
//   (`auto_email_off`, mailRefusal.js), so no sweep retries it.

const crypto = require("crypto");
const { query, run, uuid } = require("./db");
const TYPES = require("./mailTypes");   // SEND-GATE-2: which emails, and who turned each on

const EXEMPT_KINDS = new Set(["express_link"]);
const REFUSAL = "auto_email_off";

// The words for a blocked line when the caller did not say (`_stewardWhat`).
const KIND_WORDS = {
  receipt: "Receipt", year_end: "Year-end statement", dunning: "Failed-payment notice",
  recovered_thankyou: "Card-worked thank-you", recurring_change: "Recurring gift notice",
  card_expiring: "Card-expiring notice", sequence: "Sequence email", workflow: "Automatic email",
  campaign: "Campaign email", pledge_reminder: "Pledge reminder", milestone: "Email",
  volunteer_reminder: "Volunteer reminder", volunteer_link: "Volunteer page link",
  auction_winner: "Auction pay link", auction_signin: "Auction sign-in link",
  gift_unfinished: "Unfinished-gift note", event_ticket: "Event confirmation",
  event_waitlist_offer: "Event waitlist offer", reconnect: "Reconnect-your-gift note",
  your_page_link: "Your-page link", fundraiser_manage_link: "Fundraiser dashboard link",
  fundraiser_manage: "Fundraiser dashboard link", portal_change: "Portal change notice",
  supporter: "Email",
};

function addressesOf(v) {
  if (!v) return [];
  const list = Array.isArray(v) ? v : String(v).split(",");
  return list.map(a => {
    const s = String(a || "").trim();
    const m = s.match(/<([^>]+)>/);
    return (m ? m[1] : s).trim().toLowerCase();
  }).filter(Boolean);
}
function recipientsOf(opts) {
  return [...new Set([...addressesOf(opts.to), ...addressesOf(opts.cc), ...addressesOf(opts.bcc)])];
}

// The wire message, kept so Send can send exactly it. Buffers (a receipt's
// PDF) become base64, which the provider takes as attachment content.
function storablePayload(opts) {
  const out = {};
  for (const k of Object.keys(opts || {})) {
    if (k.startsWith("_steward")) continue;
    out[k] = opts[k];
  }
  if (Array.isArray(out.attachments)) {
    out.attachments = out.attachments.map(a => a && Buffer.isBuffer(a.content) ? { ...a, content: a.content.toString("base64") } : a);
  }
  return out;
}

// A staff click, recorded for one recipient. Returns the id the send carries.
async function recordStaffConfirm({ orgId, to, what = null, by }) {
  const id = "sc_" + uuid().replace(/-/g, "").slice(0, 16);
  await run(`INSERT INTO send_confirms (id, org_id, recipient, what, created_by, created_by_name) VALUES (?,?,?,?,?,?)`,
    [id, orgId, String(to || "").trim().toLowerCase(), what ? String(what).slice(0, 300) : null,
     (by && by.id) || "unknown", (by && by.name) || null]);
  return id;
}

async function useConfirm(id, orgId, recipients) {
  if (!id || recipients.length !== 1) return false;
  const rows = await query(
    `UPDATE send_confirms SET used_at = NOW()
      WHERE id = ? AND org_id = ? AND recipient = ? AND used_at IS NULL AND created_at > NOW() - INTERVAL '1 day'
      RETURNING id`, [String(id), orgId, recipients[0]]);
  return rows.length === 1;
}

// SEND-GATE-2: the org's switch for each email type (org_mail_types), read
// per send. A missing row is "off since created".
async function typeRow(orgId, typeKey) {
  const [r] = await query(`SELECT is_on, audience FROM org_mail_types WHERE org_id = ? AND type_key = ?`, [orgId, typeKey]);
  return r ? { on: r.is_on === true, audience: r.audience } : null;
}

// The decision, without sending. { send, why, donorIds } or { send: false, off,
// donorId, reason, typeKey }.
//
// SEND-GATE-2 · THE RULE: Donor mail on (asked by the proxy, above this) AND
// the type on AND (who gets it is Everyone and the person is not set to Never,
// OR it is Only donors I choose and the person is set to Always include).
async function decide(opts) {
  const orgId = opts._stewardOrgId;
  const kind = String(opts._stewardKind || "supporter");
  if (EXEMPT_KINDS.has(kind)) return { send: true, why: "exempt" };
  const recipients = recipientsOf(opts);
  if (!recipients.length) return { send: false, off: [], reason: "no_recipient" };
  if (opts._stewardConfirm && await useConfirm(opts._stewardConfirm, orgId, recipients)) return { send: true, why: "staff_confirm" };
  const typeKey = TYPES.typeOfKind(kind);
  const rows = await query(
    `SELECT LOWER(email) AS e, bool_or(auto_email) AS always_, bool_or(auto_email_never) AS never_,
            (array_agg(id ORDER BY auto_email_never DESC, auto_email DESC, created_at ASC))[1] AS id
       FROM donors WHERE org_id = ? AND LOWER(email) = ANY(?::text[]) AND deleted_at IS NULL
      GROUP BY LOWER(email)`, [orgId, recipients]);
  const by = new Map(rows.map(r => [r.e, r]));
  const named = opts._stewardDonorId ? String(opts._stewardDonorId) : null;
  const idOf = e => (by.get(e) && by.get(e).id) || null;
  // Mail that only a person sends (BY_HAND) or a kind in no list: held.
  if (!typeKey) return { send: false, off: recipients, donorId: named || idOf(recipients[0]), reason: "by_hand", typeKey: null };
  const type = await typeRow(orgId, typeKey);
  const skips = new Set((await query(
    `SELECT donor_id FROM mail_skips WHERE org_id = ? AND type_key = ? AND until > NOW() AND donor_id = ANY(?::text[])`,
    [orgId, typeKey, rows.map(r => r.id)])).map(r => r.donor_id));
  let reason = null, heldFor = null;
  for (const e of recipients) {
    const r = by.get(e);
    const mode = r ? TYPES.modeOf({ auto_email: r.always_, auto_email_never: r.never_ }) : "follows";
    const why = TYPES.holdReason({ mailOn: true, type, mode, skipped: !!(r && skips.has(r.id)) });
    if (why) { reason = why; heldFor = e; break; }
  }
  if (!reason) return { send: true, why: "type_on:" + typeKey, typeKey, donorIds: recipients.map(idOf).filter(Boolean) };
  return { send: false, off: [heldFor], donorId: named || idOf(heldFor), reason, typeKey };
}

// The blocked line. One per exact message (a sweep that tries again adds none).
// SEND-GATE-2: with why it was held and which email it is, for Going out's
// Held list and the profile's held line.
function dedupeKeyOf(opts) {
  const kind = String(opts._stewardKind || "supporter");
  const payload = storablePayload(opts);
  return crypto.createHash("sha256")
    .update([kind, recipientsOf(opts).join(","), opts.subject || "", payload.html || payload.text || ""].join("\u0000"))
    .digest("hex");
}
async function recordBlocked(opts, donorId, reason = null, typeKey = null) {
  const orgId = opts._stewardOrgId;
  const kind = String(opts._stewardKind || "supporter");
  const payload = storablePayload(opts);
  const what = String(opts._stewardWhat || (KIND_WORDS[kind] || "Email") + (opts.subject ? `: "${String(opts.subject).slice(0, 120)}"` : "")).slice(0, 300);
  await run(
    `INSERT INTO mail_blocked (id, org_id, donor_id, kind, what, subject, payload, dedupe_key, held_reason, type_key)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id, dedupe_key) DO UPDATE SET held_reason = EXCLUDED.held_reason WHERE mail_blocked.sent_at IS NULL`,
    ["mb_" + uuid().replace(/-/g, "").slice(0, 14), orgId, donorId, kind, what,
     opts.subject ? String(opts.subject).slice(0, 300) : null, JSON.stringify(payload), dedupeKeyOf(opts),
     reason, typeKey || TYPES.typeOfKind(kind)]);
}

// SEND-GATE-2 · Held because Jonathan's switch (Donor mail) is off. Asked by
// the client proxy, which refuses first; recorded so the org sees it in Held.
async function recordOrgOff(opts) {
  try {
    const recipients = recipientsOf(opts);
    if (!opts._stewardOrgId || !recipients.length || EXEMPT_KINDS.has(String(opts._stewardKind || ""))) return;
    let donorId = opts._stewardDonorId ? String(opts._stewardDonorId) : null;
    if (!donorId) {
      const [r] = await query(`SELECT id FROM donors WHERE org_id = ? AND LOWER(email) = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
        [opts._stewardOrgId, recipients[0]]);
      donorId = r ? r.id : null;
    }
    await recordBlocked(opts, donorId, "org_mail_off");
  } catch (e) { console.error("[send-gate] org-off line not written:", e.message); }
}

// SEND-GATE-2 · what an automatic email actually said, kept so Going out's
// Sent list shows exactly what the person received. A held line for the same
// exact message (it waited, then went) is marked as sent on its own.
async function recordSent(opts, d) {
  if (!d || !d.typeKey) return;
  const payload = storablePayload(opts);
  const donorIds = d.donorIds && d.donorIds.length ? d.donorIds : [null];
  for (const donorId of donorIds) {
    await run(
      `INSERT INTO auto_mail_sent (id, org_id, type_key, kind, donor_id, subject, html, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      ["ams_" + uuid().replace(/-/g, "").slice(0, 14), opts._stewardOrgId, d.typeKey, String(opts._stewardKind || ""), donorId,
       opts.subject ? String(opts.subject).slice(0, 300) : null, String(payload.html || payload.text || "").slice(0, 400000),
       "system:send-gate", "Steward"]);
  }
  await run(
    `UPDATE mail_blocked SET sent_at = NOW(), sent_by = 'system:send-gate', sent_by_name = 'Sent on its own once turned on'
      WHERE org_id = ? AND dedupe_key = ? AND sent_at IS NULL`, [opts._stewardOrgId, dedupeKeyOf(opts)]);
}

// THE GATE. `deliver(opts)` is the provider call; it runs only on a yes.
async function sendToDonor(opts, deliver) {
  let d;
  try { d = await decide(opts); }
  catch (e) {
    // Fails closed: a gate that cannot read the switch does not send.
    console.error("[send-gate] could not decide, nothing sent:", e.message);
    return { data: null, error: { name: "send_gate_unreadable", message: "send_gate_unreadable: " + e.message } };
  }
  // HARDEN-1: the arm that let it go, and to whom (ids, never addresses), ride
  // to the email_log row (scripts/auto-mail-switches-readonly.sql reads it).
  if (d.send) {
    const out = await deliver(Object.assign(opts, { _stewardGate: d.why, _stewardGateDonors: d.donorIds || null }));
    if (out && !out.error) {
      try { await recordSent(opts, d); } catch (e) { console.error("[send-gate] sent line not written:", e.message); }
    }
    return out;
  }
  try { await recordBlocked(opts, d.donorId, d.reason, d.typeKey); }
  catch (e) { console.error("[send-gate] blocked line not written:", e.message); }
  const t = d.typeKey ? TYPES.BY_KEY[d.typeKey] : null;
  const why = `${REFUSAL}: ${TYPES.reasonSentence(d.reason, t)}`;
  console.log(`[send-gate] held ${opts._stewardKind || "?"} for org ${opts._stewardOrgId}: ${d.reason}`);
  return { data: null, error: { name: REFUSAL, message: why } };
}

module.exports = { sendToDonor, recordStaffConfirm, decide, recordOrgOff, dedupeKeyOf, recipientsOf, storablePayload, EXEMPT_KINDS, REFUSAL, KIND_WORDS };
