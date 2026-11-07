// server/org/inviteMail.js · COMMS-1 item 2. A STAFF INVITE ARRIVES.
//
// Muse's walk (Set 5): an invite in an org with no SMTP of its own was
// link-only, and Resend only showed the note again. A staff invite is an
// account email, not donor mail, so it never depends on the org's own mail
// setup: it goes from Steward's own address through Resend, tagged as the
// account kind `team_invite` (mailPolicy.js) with its org, so the client's
// gates (steps-1.js: the permanent mail block, then the org gate, which lets
// account mail through) decide it like every other send. The send used to
// carry no kind at all, which mailPolicy reads as donor mail, and fell back
// to Resend's sandbox sender.
//
//   · at most 20 invite emails per org per day (DAILY_CAP)
//   · Resend really sends again, at most once every 10 minutes per invite
//   · each send is a row in invite_sends; a bounce (routes/webhooks.js) marks
//     it, and the Invited list says so.
//
// The email goes to the invited address and to nobody else.
"use strict";

const DAILY_CAP = 20;
const RESEND_GAP_MS = 10 * 60 * 1000;
const KIND = "team_invite";

const stewardFrom = () => process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const newId = () => "isd_" + require("crypto").randomBytes(9).toString("hex");

// "3:42 PM" in the org's own zone.
function clockTime(at, tz) {
  try { return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz || "America/New_York" }); }
  catch { return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
}

async function sentToday(query, orgId) {
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM invite_sends WHERE org_id = ? AND sent_at > NOW() - INTERVAL '1 day'`, [orgId]);
  return (r && r.n) || 0;
}
async function lastSend(query, orgId, inviteId) {
  const [r] = await query(`SELECT sent_at, bounced_at FROM invite_sends WHERE org_id = ? AND invite_id = ? ORDER BY sent_at DESC LIMIT 1`, [orgId, inviteId]);
  return r ? { ...r, too_soon: Date.now() - new Date(r.sent_at).getTime() < RESEND_GAP_MS } : null;
}

// Send one invite. `actor` is { id, name } of whoever pressed Invite or Resend.
// Returns { sent, reason, sentAt, message }. Never throws for a mail failure.
async function sendInvite({ query, run, resend }, { orgId, inviteId, email, role, link, orgName, tz, actor, again = false }) {
  const to = String(email || "").trim().toLowerCase();
  if (!to) return { sent: false, reason: "no_address", message: "This invite has no email address." };
  if (again) {
    const last = await lastSend(query, orgId, inviteId);
    if (last && last.too_soon) {
      const next = new Date(new Date(last.sent_at).getTime() + RESEND_GAP_MS);
      return { sent: false, reason: "too_soon", retryAt: next.toISOString(),
        message: `Sent to ${to} at ${clockTime(last.sent_at, tz)}. You can send it again after ${clockTime(next, tz)}.` };
    }
  }
  if (await sentToday(query, orgId) >= DAILY_CAP) {
    return { sent: false, reason: "daily_cap", message: `Steward sends at most ${DAILY_CAP} invites a day for your organization. Copy the link and send it to ${to}, or try again tomorrow.` };
  }
  if (!process.env.RESEND_API_KEY || !resend) return { sent: false, reason: "no_provider", message: `The invite was not emailed. Copy the link and send it to ${to}.` };
  let out;
  try {
    out = await resend.emails.send({
      from: stewardFrom(),
      to,
      subject: `You've been invited to join ${orgName} on Steward`,
      html: `<p>You've been invited to join <strong>${esc(orgName)}</strong> on Steward as a <strong>${esc(role)}</strong>.</p>
             <p><a href="${esc(link)}" style="background:#C9A84C;color:#0F1A12;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;margin:16px 0">Accept Invitation</a></p>
             <p>This link expires in 7 days.</p>`,
      text: `You've been invited to join ${orgName} on Steward as a ${role}.\n\nAccept the invitation: ${link}\n\nThis link expires in 7 days.`,
      _stewardKind: KIND, _stewardOrgId: orgId,
    });
  } catch (e) { out = { error: { message: e && e.message } }; }
  if (!out || out.error) {
    console.error("[invite] not sent:", (out && out.error && (out.error.name || out.error.message)) || "no answer");
    return { sent: false, reason: "provider_error", message: `The invite was not emailed. Copy the link and send it to ${to}.` };
  }
  const sentAt = new Date();
  await run(`INSERT INTO invite_sends (id, org_id, invite_id, email, provider_id, sent_at, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?)`,
    [newId(), orgId, inviteId, to, (out.data && out.data.id) || null, sentAt.toISOString(), (actor && actor.id) || "system:invite", (actor && actor.name) || null]);
  return { sent: true, reason: null, sentAt: sentAt.toISOString(),
    message: again ? `Sent again to ${to} at ${clockTime(sentAt, tz)}.` : `Sent to ${to} at ${clockTime(sentAt, tz)}.` };
}

// The Invited list's line about the email: last sent, and whether it bounced.
async function sendStateByInvite(query, orgId) {
  const rows = await query(`SELECT DISTINCT ON (invite_id) invite_id, sent_at, bounced_at FROM invite_sends
                             WHERE org_id = ? ORDER BY invite_id, sent_at DESC`, [orgId]);
  return new Map(rows.map(r => [r.invite_id, { lastSentAt: r.sent_at, bounced: !!r.bounced_at }]));
}

// A Resend bounce for an invite email (routes/webhooks.js). By the provider's
// message id when it has one, else the newest unbounced send to that address.
async function markBounced(query, run, { providerId, email }) {
  if (providerId) {
    const r = await run(`UPDATE invite_sends SET bounced_at = NOW() WHERE provider_id = ? AND bounced_at IS NULL`, [providerId]);
    if (r && r.changes) return r.changes;
  }
  if (!email) return 0;
  const r = await run(`UPDATE invite_sends SET bounced_at = NOW() WHERE id IN (
                         SELECT id FROM invite_sends WHERE lower(email) = lower(?) AND bounced_at IS NULL
                          AND sent_at > NOW() - INTERVAL '3 days' ORDER BY sent_at DESC LIMIT 1)`, [email]);
  return (r && r.changes) || 0;
}

module.exports = { sendInvite, sendStateByInvite, markBounced, sentToday, DAILY_CAP, RESEND_GAP_MS, KIND, clockTime };
