// DEVBOARD-3 · THE JOURNEY TAB: how a customer gets onboarded, step by step.
//
// STEPS is the real onboarding path, in order. Each step says what the
// customer sees, what Steward does behind it, how the step is detected, the
// demo screen it opens (through opsMap.demoHref, DEVBOARD-2's safe link) and
// the Map checks that cover it.
//
// readFacts() reads ONLY counts and timestamps, one query per fact across every
// customer org at once (no query per org). It never selects a donor's name, an
// email, an address or an amount: the page shows no donor data (the test plants
// a donor name and an amount in every fixture org and looks for them).
//
// journeyOf() is pure, so the route, the page and the test read one answer:
// the current step is the first one not reached; the customer has sat on it
// since the latest step they did reach (or since sign-up), and a sit of more
// than STUCK_DAYS days is "stuck" (brass on the page: overdue is brass).
"use strict";

const DAY_MS = 86400000;
const STUCK_DAYS = 7;

const STEPS = [
  { id: "signup", title: "Signed up",
    sees: "The sign-up page: name, email, password, and the organization's name.",
    behind: "An orgs row and the first user (an admin) are created; the trial starts.",
    detect: "The org's created_at.", open: null, checks: [] },
  { id: "setup", title: "Org set up",
    sees: "Settings → Organization: the name, the time zone and the fiscal year.",
    behind: "The time zone is confirmed (orgs.timezone_confirmed_at); every date and the fiscal year are cut in it.",
    detect: "orgs.timezone_confirmed_at, else the day the org was marked onboarded.",
    open: "/app/settings?section=org", checks: ["Set-A", "Set-D"] },
  { id: "team", title: "Team invited",
    sees: "Settings → Team: invite a colleague by email, with a role.",
    behind: "An invites row; the colleague signs in through the invite link and becomes a user of the org.",
    detect: "The first invite, or the second person on the org, whichever came first.",
    open: "/app/settings?section=team", checks: ["Set-B"] },
  { id: "import", title: "First import",
    sees: "Import: choose a file, check the preview (who is new, who matches), then Done.",
    behind: "The one reader parses the file; people and gifts are written, an imports row records the counts, and Undo is kept.",
    detect: "The first imports row that was not undone (imports.committed_at).",
    open: "/app/settings?section=imports", checks: ["Data-C"] },
  { id: "dupes", title: "Duplicates reviewed",
    sees: "Data health: possible duplicates, each with why it thinks so; Merge or Not the same.",
    behind: "A merge keeps one person with both histories (donor_merges); Not the same is remembered (data_health_dismissals).",
    detect: "The first merge or the first pair marked not the same.",
    open: "/donors?view=health", checks: ["Data-A", "Data-B"] },
  { id: "gift", title: "First gift recorded",
    sees: "Add gift on a person, or a gift arrives from the giving page.",
    behind: "recordGift writes the gift; the after-change step updates the person, and the queue rescores them.",
    detect: "The first gift that did not come from an import or sample data.",
    open: "/app/fundraising?fr=deposits", checks: ["Gift-A", "Gift-B", "Gift-C"] },
  { id: "receipts", title: "Receipts set",
    sees: "Settings → Receipts: the legal name, the EIN and the signature.",
    behind: "Receipts and year-end statements read the legal entity; none is sent without it.",
    detect: "The EIN and the signature name are both filled in; dated by the audit row that set them.",
    open: "/app/settings?section=receipts", checks: ["Rcpt-A", "Rcpt-B"] },
  { id: "giving", title: "Giving page live",
    sees: "A public giving page at /give/<their page>, with their amounts.",
    behind: "A giving_pages row, active; gifts made there come through Stripe Connect into recordGift.",
    detect: "The first active giving page.",
    open: null, givingPage: true, checks: ["Give-A", "Give-B", "Give-C"] },
  { id: "email", title: "Daily email on",
    sees: "Settings → Your email: the morning email switched on, with its hour and sections.",
    behind: "The morning tick sends each person their steps, tasks and meetings in the org's time zone (digest_sends).",
    detect: "A person on the org has the morning email on; dated by its first send.",
    open: "/app/settings?section=myemail", checks: [] },
  { id: "week", title: "First week active",
    sees: "Home, most days: a name, a reason and a step.",
    behind: "Nothing new: this is the habit forming.",
    detect: "Someone on the org signed in or made a change on 5 of 7 consecutive days (the org's own days).",
    open: "/dashboard", checks: ["Home-A", "Home-B"] },
];
const STEP_IDS = STEPS.map(s => s.id);

const iso = t => (t ? new Date(t).toISOString() : null);
const earliest = (...ts) => { const v = ts.filter(Boolean).map(t => new Date(t).getTime()).filter(Number.isFinite); return v.length ? new Date(Math.min(...v)).toISOString() : null; };
const latest = (...ts) => { const v = ts.filter(Boolean).map(t => new Date(t).getTime()).filter(Number.isFinite); return v.length ? new Date(Math.max(...v)).toISOString() : null; };

// The first day of the first 7-day window holding 5 active days, as the 5th
// active day (YYYY-MM-DD, the org's own days). Days come sorted and distinct.
function fifthDayInAWeek(days) {
  const t = days.map(d => Date.parse(d + "T12:00:00Z"));
  for (let i = 4; i < t.length; i++) if (t[i] - t[i - 4] <= 6 * DAY_MS) return days[i];
  return null;
}

// One query per fact, every customer org at once. Counts and timestamps only.
async function readFacts(query, orgIds) {
  if (!orgIds.length) return {};
  const ids = [orgIds];
  const safe = p => p.catch(e => { if (e && e.code === "42P01") return []; throw e; });   // a table not made yet: nothing reached
  const [orgs, invites, seconds, imports, merges, notDupes, gifts, auditRcpt, pages, emailOn, emailSent, days] = await Promise.all([
    query(`SELECT id, name, created_at, timezone_confirmed_at, onboarded_at,
                  (COALESCE(TRIM(ein), '') <> '') AS has_ein, (COALESCE(TRIM(receipt_signature_name), '') <> '') AS has_sig
             FROM orgs WHERE id = ANY(?)`, ids),
    safe(query(`SELECT org_id, MIN(created_at) AS t FROM invites WHERE org_id = ANY(?) GROUP BY org_id`, ids)),
    query(`SELECT org_id, (ARRAY_AGG(created_at ORDER BY created_at))[2] AS t FROM users
            WHERE org_id = ANY(?) AND COALESCE(is_super_admin, false) = false GROUP BY org_id`, ids),
    safe(query(`SELECT org_id, MIN(committed_at) AS t FROM imports WHERE org_id = ANY(?) AND reversed_at IS NULL GROUP BY org_id`, ids)),
    safe(query(`SELECT org_id, MIN(created_at) AS t FROM donor_merges WHERE org_id = ANY(?) AND undone_at IS NULL GROUP BY org_id`, ids)),
    safe(query(`SELECT org_id, MIN(created_at) AS t FROM data_health_dismissals WHERE org_id = ANY(?) AND kind = 'pair' GROUP BY org_id`, ids)),
    query(`SELECT org_id, MIN(created_at) AS t FROM gifts
            WHERE org_id = ANY(?) AND import_id IS NULL AND COALESCE(is_sample, false) = false GROUP BY org_id`, ids),
    safe(query(`SELECT org_id,
                       MIN(created_at) FILTER (WHERE changes::text LIKE '%"ein"%') AS ein_t,
                       MIN(created_at) FILTER (WHERE changes::text LIKE '%"receipt_signature_name"%') AS sig_t
                  FROM fin_audit_log WHERE org_id = ANY(?) AND entity_type = 'org'
                 GROUP BY org_id`, ids)),
    safe(query(`SELECT org_id, MIN(created_at) AS t FROM giving_pages WHERE org_id = ANY(?) AND status = 'active' GROUP BY org_id`, ids)),
    query(`SELECT org_id, COUNT(*)::int AS n FROM users
            WHERE org_id = ANY(?) AND deactivated_at IS NULL AND notify_thread_nudge IS NOT FALSE
              AND COALESCE(is_super_admin, false) = false GROUP BY org_id`, ids),
    safe(query(`SELECT org_id, MIN(created_at) AS t FROM digest_sends
                 WHERE org_id = ANY(?) AND digest_type IN ('thread_nudge', 'daily_tasks', 'meeting_brief') GROUP BY org_id`, ids)),
    // A day the org was active: a person (not a super-admin) started a session,
    // was last active in one, or made a change, in the org's own time zone.
    safe(query(`SELECT a.org_id, a.day FROM (
                  SELECT s.org_id, to_char(s.created_at AT TIME ZONE COALESCE(o.timezone, 'America/New_York'), 'YYYY-MM-DD') AS day
                    FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.org_id = s.org_id JOIN orgs o ON o.id = s.org_id
                   WHERE s.org_id = ANY(?) AND COALESCE(u.is_super_admin, false) = false
                  UNION
                  SELECT s.org_id, to_char(s.last_active_at AT TIME ZONE COALESCE(o.timezone, 'America/New_York'), 'YYYY-MM-DD')
                    FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.org_id = s.org_id JOIN orgs o ON o.id = s.org_id
                   WHERE s.org_id = ANY(?) AND s.last_active_at IS NOT NULL AND COALESCE(u.is_super_admin, false) = false
                  UNION
                  SELECT f.org_id, to_char(f.created_at AT TIME ZONE COALESCE(o.timezone, 'America/New_York'), 'YYYY-MM-DD')
                    FROM fin_audit_log f JOIN users u ON u.id = f.user_id AND u.org_id = f.org_id JOIN orgs o ON o.id = f.org_id
                   WHERE f.org_id = ANY(?) AND COALESCE(u.is_super_admin, false) = false
                ) a ORDER BY a.org_id, a.day`, [orgIds, orgIds, orgIds])),
  ]);
  const by = rows => new Map(rows.map(r => [r.org_id, r]));
  const m = { invites: by(invites), seconds: by(seconds), imports: by(imports), merges: by(merges), notDupes: by(notDupes), gifts: by(gifts),
    audit: by(auditRcpt), pages: by(pages), emailOn: by(emailOn), emailSent: by(emailSent) };
  const dayList = new Map();
  for (const r of days) { if (!dayList.has(r.org_id)) dayList.set(r.org_id, []); dayList.get(r.org_id).push(r.day); }
  const out = {};
  for (const o of orgs) {
    const t = (map, k = "t") => (map.get(o.id) || {})[k] || null;
    const week = fifthDayInAWeek(dayList.get(o.id) || []);
    const rc = m.audit.get(o.id) || {};
    out[o.id] = {
      name: o.name,
      signup: { reached: true, at: iso(o.created_at) },
      setup: { reached: !!(o.timezone_confirmed_at || o.onboarded_at), at: iso(o.timezone_confirmed_at || o.onboarded_at) },
      team: { reached: !!(t(m.invites) || t(m.seconds)), at: earliest(t(m.invites), t(m.seconds)) },
      import: { reached: !!t(m.imports), at: iso(t(m.imports)) },
      dupes: { reached: !!(t(m.merges) || t(m.notDupes)), at: earliest(t(m.merges), t(m.notDupes)) },
      gift: { reached: !!t(m.gifts), at: iso(t(m.gifts)) },
      receipts: { reached: !!(o.has_ein && o.has_sig), at: o.has_ein && o.has_sig && rc.ein_t && rc.sig_t ? latest(rc.ein_t, rc.sig_t) : null },
      giving: { reached: !!t(m.pages), at: iso(t(m.pages)) },
      email: { reached: Number(t(m.emailOn, "n") || 0) > 0, at: Number(t(m.emailOn, "n") || 0) > 0 ? iso(t(m.emailSent)) : null },
      week: { reached: !!week, at: week ? `${week}T12:00:00.000Z` : null, day: week },
    };
  }
  return out;
}

// Pure: one org's facts → its row on the page. Names the org; never a donor.
function journeyOf(f, now) {
  const steps = STEP_IDS.map(id => ({ id, reached: !!(f[id] && f[id].reached), at: (f[id] && f[id].at) || null }));
  const cur = steps.find(s => !s.reached) || null;
  const since = latest(...steps.filter(s => s.reached).map(s => s.at)) || (f.signup && f.signup.at) || null;
  const days = cur && since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / DAY_MS)) : null;
  return { name: f.name, steps, reachedCount: steps.filter(s => s.reached).length,
    current: cur ? cur.id : "done", since: cur ? since : null, stuckDays: days, stuck: days != null && days > STUCK_DAYS };
}

module.exports = { STEPS, STEP_IDS, STUCK_DAYS, readFacts, journeyOf, fifthDayInAWeek };
