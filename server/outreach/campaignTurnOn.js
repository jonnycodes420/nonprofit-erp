// server/outreach/campaignTurnOn.js · COMMS-1 item 1. WHERE CAMPAIGN EMAILS
// ARE TURNED ON.
//
// Muse's walk (Comm 2): a campaign to 1,218 people said "0 can get this email:
// 1,213 wait until Campaign emails are on", and nothing on that screen said
// where they are turned on, or what turning them on means. Wherever the
// audience waits on that switch, the answer now carries one sentence and,
// for an admin (only an admin can turn it on: POST /mail-types/:key is
// requireAdmin), the link to the switch. Anyone else is told to ask an admin.
//
// Turning it on sends nothing: it lets a campaign reach people when someone
// presses Send or Schedule on it (mailTypes.js, the "campaign" type).
"use strict";

const SETTINGS_HREF = "/app/settings?section=automatic";
const OFF_SENTENCE = "Campaign emails are off for your organization.";
const LINK_LABEL = "Turn them on in Settings → Automatic email";
const ASK = "Ask an admin to turn them on.";

// The note for one viewer, or null when campaign emails are not what's waiting.
function turnOnNote({ off, isAdmin }) {
  if (!off) return null;
  return isAdmin
    ? { sentence: OFF_SENTENCE, link: { label: LINK_LABEL, href: SETTINGS_HREF }, ask: null }
    : { sentence: OFF_SENTENCE, link: null, ask: ASK };
}

// Is the org's Campaign emails switch off? (org_mail_types, as sendGate reads it.)
async function campaignEmailsOff(query, orgId) {
  const [r] = await query(`SELECT is_on FROM org_mail_types WHERE org_id = ? AND type_key = 'campaign'`, [orgId]);
  return !(r && r.is_on === true);
}

const isAdminReq = req => !!(req && req.user && req.user.role === "admin");

module.exports = { turnOnNote, campaignEmailsOff, isAdminReq, SETTINGS_HREF, OFF_SENTENCE, LINK_LABEL, ASK };
