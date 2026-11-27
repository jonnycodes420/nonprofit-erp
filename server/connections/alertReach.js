// server/connections/alertReach.js · HONEST-3 item 2 (W-1126-Integrations-02). A CONNECTION THAT STOPS
// WORKING TELLS SOMEONE, OR SAYS PLAINLY THAT NOBODY WILL HEAR.
//
// "Givebutter has been silent 68 days ... Home and a HIGH task now surface it, but the 'A connection
// stops working' email checkbox is unchecked and staff email is off org-wide, so the alert still
// reaches nobody by email." The quiet sweep emails the admin it assigns the task to, through
// notifyUserOnce, which asks the same two things this file asks: is the org's staff email on, and
// does that admin have "A connection stops working" on. When either is no, Home's line and the task
// say so in one sentence, from here. Staff mail, never donor mail.
"use strict";

const STAFF_OFF = "Steward isn't emailing anyone about this because staff email is off. Turn it on in Settings → Notifications.";
const DEMO = "Steward isn't emailing anyone about this: email is off in the demo.";
const NOT_YET = "Steward isn't emailing anyone about this yet: staff email starts once setup is finished.";
const PREF_OFF = "Steward isn't emailing anyone about this: nobody has \"A connection stops working\" turned on in Settings → Notifications.";

// The sentence, or null when the quiet sweep's email will reach the admin it assigns.
async function alertReach(query, orgId) {
  const mailPolicy = require("../../mailPolicy");
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  const d = mailPolicy.orgMailDecision(org || null, mailPolicy.CATEGORY.STAFF);
  if (!d.send) return d.reason === "demo_org" ? DEMO : d.reason === "not_onboarded" ? NOT_YET : STAFF_OFF;
  // The admin the sweep assigns (helpers-1 sweepQuietConnections: the first active admin).
  const [admin] = await query(
    `SELECT notify_connection_alerts FROM users WHERE org_id=? AND role='admin' AND deactivated_at IS NULL
      ORDER BY created_at ASC LIMIT 1`, [orgId]);
  if (!admin || admin.notify_connection_alerts !== true) return PREF_OFF;
  return null;
}

// HONEST-3 item 2: in a NEW org, the first owner or admin starts with "A connection stops working"
// on. Called where an org and its first admin are created; existing orgs are never changed.
async function newOrgAlertDefaults(run, userId) {
  await run("UPDATE users SET notify_connection_alerts = true WHERE id = ?", [userId]);
}

module.exports = { alertReach, newOrgAlertDefaults, STAFF_OFF, PREF_OFF, DEMO, NOT_YET };
