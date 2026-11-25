// server/mail/staleMailboxes.js · BGWORK-1. WHICH MAILBOX CONNECTIONS ARE STALE.
//
// The [mailbox-stale] alarm (refreshMailboxSyncHealth, server/boot/helpers-7.js)
// logs one ERROR line per connection this returns, every check. SCALE-5 stopped
// reading the mail of orgs nobody uses (routes/jobs.js reads live orgs only), so
// a test org's connection went stale on purpose and the alarm fired for it every
// five minutes. Now the check reads the same live-org set as the mail read
// (server/orgs/liveOrgs.js): a skipped org is never stale, and a test org whose
// "Run background work" switch is on is read and checked like any other.
"use strict";

// { rows: every connection checked, stale: those not read within staleMs or refused }
async function staleMailboxes(query, { staleMs, now = Date.now() }) {
  const live = await require("../orgs/liveOrgs").liveOrgIds(query);
  const rows = await query(
    `SELECT m.id, m.org_id, m.provider, m.status, m.created_at,
            (SELECT MAX(r.finished_at) FROM mailbox_sync_runs r
              WHERE r.user_id = m.user_id AND r.provider = m.provider AND r.kind = 'mail' AND r.ok) AS last_ok
       FROM mailbox_connections m
      WHERE m.status IN ('active','error') AND m.paused IS NOT TRUE AND m.credentials_sealed IS NOT NULL
        AND m.org_id = ANY(?::text[])`, [live]);
  const stale = rows.filter(r => r.status === "error"
    || (r.last_ok ? now - new Date(r.last_ok).getTime() > staleMs : now - new Date(r.created_at).getTime() > staleMs));
  return { rows, stale };
}

module.exports = { staleMailboxes };
