-- scripts/auto-mail-switches-readonly.sql · READ-ONLY. Once check c of the
-- nightly check (removed): no automatic donor mail past a switch that is off.
-- Over the last 25 hours of email_log (it keeps 30 days; widen the interval to
-- look further back), per org, three counts of sent donor messages:
--   to_switch_off  went to a person whose Automatic emails switch was off when
--                  it went (gate not 'exempt' or 'staff_confirm');
--   org_mail_off   went out while the org's Donor mail is off (express_link,
--                  sendGate.js EXEMPT_KINDS, is allowed);
--   no_gate        never passed the gate (no arm recorded), once the gate
--                  records its arm at all.
-- Donor mail is every kind NOT in the list below: mailPolicy.js KIND_CATEGORY's
-- kinds whose category is not DONOR, as of NIGHTLY-OFF (2026-10-27). If a
-- staff or account kind is added there, add it here.
-- Org id and counts only: no names, no addresses, no donor data.
BEGIN TRANSACTION READ ONLY;
WITH not_donor(kind) AS (VALUES ('digest'),('week_in_review'),('officer_report'),('meeting_brief'),('staff_notice'),
       ('staff_alert'),('task_notice'),('gift_alert'),('workflow_staff'),('board_pack'),('campaign_test'),('password_reset'),
       ('magic_link'),('two_factor'),('team_invite'),('email_change'),('account'),('mail_test'),('billing_receipt'),
       ('trial_ending'),('billing'),('tier_notice'),('founder_signup'),('demo_request'),('ops_alert'),('onboarding_drip'),('onboarding')),
     sent AS (
       SELECT e.* FROM email_log e
        WHERE e.status = 'sent' AND e.org_id IS NOT NULL AND e.created_at >= NOW() - INTERVAL '25 hours'
          AND COALESCE(e.kind, '') NOT IN (SELECT kind FROM not_donor))
SELECT o.id AS org_id,
       (SELECT COUNT(DISTINCT s.id) FROM sent s JOIN donors d ON d.org_id = s.org_id AND d.id = ANY(s.donor_ids)
         WHERE s.org_id = o.id AND COALESCE(s.gate, '') NOT IN ('exempt', 'staff_confirm')
           AND d.auto_email IS NOT TRUE AND (d.auto_email_at IS NULL OR d.auto_email_at < s.created_at))::int AS to_switch_off,
       (SELECT COUNT(*) FROM sent s WHERE s.org_id = o.id AND o.emails_enabled = FALSE
           AND COALESCE(s.kind, '') <> 'express_link')::int AS org_mail_off,
       (SELECT COUNT(*) FROM sent s WHERE s.org_id = o.id AND s.gate IS NULL
           AND s.created_at > (SELECT MIN(created_at) FROM email_log WHERE gate IS NOT NULL))::int AS no_gate
  FROM orgs o
 WHERE EXISTS (SELECT 1 FROM sent s WHERE s.org_id = o.id)
 ORDER BY o.id;
ROLLBACK;
