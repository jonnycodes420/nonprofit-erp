// server/outreach/helpers.js — what more than one outreach file reads.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const lapseRule = require("../../lapseRule");   // FIX-49: the one lapse rule
const { orgTzSql, orgDayWindowSql, orgDateOfSql } = require("../../orgTime");
// CLOCK-1: a timestamp inside "the last w days" is tested against the ORG's
// midnights, and a timestamp read as a day is the org's day of it.
const SINCE = (col, org) => orgDayWindowSql(col, orgTzSql(org), "?::date - ?::int", null);
const DAY_OF = (col, org) => orgDateOfSql(col, orgTzSql(org));

function mount(ctx) {
const {
  GR, birthdayMod, journeyMod, maybeStartJourney, orgToday, orgTz, query,
} = ctx;

// ── PARITY-1 Part D · THE MORNING LOOK ─────────────────────────────────────
// Two triggers have no moment of their own to fire from: somebody drifting
// into a group by rule for a reason that is not a gift (their closeness
// warming, a role added), and the anniversary of a first gift. Both are
// noticed by this sweep, hourly so each org gets its own morning, and each is
// idempotent: the group look remembers who it has seen, and every plan holds
// its event key. Latency: a group join that is not a gift is seen within the
// hour; an anniversary fires on the day, within the hour after midnight in
// the org's own timezone. PARITY-3 6a: a birthday fires the same way, on the
// org's own date, for people with a birthday on file (shared/birthday.js).
// `at` is an instant, passed only by a TEST_MODE run of /journeys/run-sweep;
// production's sweep passes none and reads the clock.
async function runJourneySweep(onlyOrgId = null, { at } = {}) {
  const orgs = await query(
    `SELECT DISTINCT org_id FROM cultivation_templates
      WHERE journey_enabled=true AND archived_at IS NULL
        AND trigger_key = ANY(?::text[])
        ${onlyOrgId ? "AND org_id = ?" : ""}`,
    [["joined_group", "giving_anniversary", "birthday", "yearly_date", ...(await journeyMod()).SWEEP_TRIGGER_KEYS], ...(onlyOrgId ? [onlyOrgId] : [])]);
  let fired = 0;
  for (const { org_id: orgId } of orgs) {
    try {
      const org = await orgTz(orgId);
      const today = at ? orgToday(org, at) : orgToday(org);   // ORG_TZ_SEAM_OK
      fired += await GR.dynamicJoins(orgId, { today,
        fire: (did, gid) => maybeStartJourney(orgId, did, "joined_group", { groupId: gid, today }) });
      const [armed] = await query(
        `SELECT 1 FROM cultivation_templates WHERE org_id=? AND trigger_key='giving_anniversary'
            AND journey_enabled=true AND archived_at IS NULL LIMIT 1`, [orgId]);
      if (armed) {
        const due = await query(
          `SELECT g.donor_id FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id AND d.deleted_at IS NULL
            WHERE g.org_id=? AND g.amount > 0
            GROUP BY g.donor_id
           HAVING SUBSTRING(MIN(LEFT(g.date,10)), 6, 5) = ? AND LEFT(MIN(LEFT(g.date,10)), 4) < ?`,
          [orgId, today.slice(5, 10), today.slice(0, 4)]);
        for (const r of due) {
          const out = await maybeStartJourney(orgId, r.donor_id, "giving_anniversary", { today });
          if (out && out.started) fired++;
        }
      }
      // PARITY-3 6a — birthdays, on the org's own date. February 29 is
      // remembered on the 28th in a year without one (shared/birthday.js).
      const [bdArmed] = await query(
        `SELECT 1 FROM cultivation_templates WHERE org_id=? AND trigger_key='birthday'
            AND journey_enabled=true AND archived_at IS NULL LIMIT 1`, [orgId]);
      if (bdArmed) {
        const B = await birthdayMod();
        // DATES-1 · a birthday journey may start some days before (a card in
        // the post a week ahead). Each lead looks at the birthdays that many
        // days from today; the journey's steps count from today.
        const leads = [...new Set((await query(
          `SELECT trigger_filters FROM cultivation_templates WHERE org_id=? AND trigger_key='birthday'
              AND journey_enabled=true AND archived_at IS NULL`, [orgId]))
          .map(t => Number((t.trigger_filters || {}).daysBefore) || 0))];
        for (const lead of leads) {
          const on = lead ? addDaysCivil(today, lead) : today;
          const born = await query(
            `SELECT id, birth_month, birth_day FROM donors
              WHERE org_id=? AND deleted_at IS NULL AND birth_month=? AND birth_day IN (?, 29)`,
            [orgId, Number(on.slice(5, 7)), Number(on.slice(8, 10))]);
          for (const r of born) {
            if (!B.isBirthdayOn(Number(r.birth_month), Number(r.birth_day), on)) continue;
            const out = await maybeStartJourney(orgId, r.id, "birthday", { today, leadDays: lead });
            if (out && out.started) fired++;
          }
        }
      }
      // DATES-1 · A DATE EVERY YEAR. On the journey's month and day, in the
      // org's own date (Feb 29 on the 28th in other years), everyone in its
      // audience goes through the one start path. The year is the event key,
      // so a second run that day, or any later day, starts nobody twice. Who
      // did not start, and why, is written down for the journey's stats.
      fired += await runYearlyDates(orgId, today);
      // JOURNEYS-3 — memberships, monthly gifts, cards, hours, grants, pages.
      fired += await runLifecycleTriggers(orgId, today);
    } catch (e) { console.error(`[journey] sweep ${orgId}:`, e.message); }
  }
  return fired;
}
// ── JOURNEYS-3 · THE MOMENTS A SMALL TEAM MISSES ───────────────────────────
// One definition per trigger of who it touches now, and the event each one is
// about. The hourly sweep fires them; "apply to people who already qualify"
// reads the same rows, so the offer and the trigger are one definition.
// `windowDays` is how far back an event still counts (the sweep looks back a
// fortnight, so a missed hour never loses one; the offer uses its own days).
// Everybody is a live record who may be contacted.
const LIVE_PERSON = `d.deleted_at IS NULL AND d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE`;
async function lifecycleRows(orgId, key, today, windowDays = 14) {
  const J = await journeyMod();
  const w = Math.max(1, Math.min(365, Number(windowDays) || 14));
  const P = (sql, params) => query(sql, params).catch(e => { console.error(`[journey] ${key}:`, e.message); return []; });
  if (key === "membership_ending") {
    return P(`SELECT m.donor_id, 'membership_ending:' || m.id || ':' || m.expires_on AS event_key
                FROM memberships m JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id AND ${LIVE_PERSON}
               WHERE m.org_id=? AND m.status IN ('active','grace') AND COALESCE(m.expires_on,'') <> ''
                 AND m.expires_on::date BETWEEN ?::date AND ?::date + 30`, [orgId, today, today]);
  }
  if (key === "membership_lapsed") {
    return P(`SELECT m.donor_id, 'membership_lapsed:' || m.id || ':' || m.expires_on AS event_key
                FROM memberships m JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id AND ${LIVE_PERSON}
               WHERE m.org_id=? AND m.status NOT IN ('cancelled','canceled') AND COALESCE(m.expires_on,'') <> ''
                 AND m.expires_on::date < ?::date AND m.expires_on::date >= ?::date - ?::int
                 AND NOT EXISTS (SELECT 1 FROM memberships m2 WHERE m2.org_id=m.org_id AND m2.donor_id=m.donor_id AND m2.id<>m.id
                                   AND m2.status IN ('active','grace')
                                   AND (COALESCE(m2.expires_on,'') = '' OR m2.expires_on::date >= ?::date))`,
      [orgId, today, today, w, today]);
  }
  // FIX-49 decision 6 · THE ONE LAPSE RULE, AS TWO MOMENTS. The day a person
  // became lapsed is their last gift plus 365 days; lapsing, plus 9 months.
  // That day must fall inside the sweep's look-back and on or after the day
  // their record was made (the BUILD-25 rule: a file loaded already lapsed is
  // history). The event key is the last gift date, so each lapse fires once
  // and a new gift starts a new episode.
  if (key === "lapsed" || key === "lapsing") {
    const st = require("../../shared/numbers/lapse").sql(key, "LEFT(d.last_gift_date, 10)", today, "d.id");
    const crossed = key === "lapsed" ? `(LEFT(d.last_gift_date, 10)::date + ${lapseRule.LAPSED_DAYS})`
      : `(LEFT(d.last_gift_date, 10)::date + INTERVAL '${lapseRule.LAPSING_MONTHS} months')::date`;
    return P(`SELECT d.id AS donor_id, '${key}:' || d.id || ':' || LEFT(d.last_gift_date, 10) AS event_key
                FROM donors d
               WHERE d.org_id=? AND ${LIVE_PERSON} AND COALESCE(d.gift_count, 0) > 0
                 AND d.last_gift_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND ${st.sql}
                 AND ${crossed} >= ${DAY_OF("d.created_at", "d.org_id")} AND ${crossed} >= ?::date - ?::int`,
      [orgId, ...st.args, today, w]);
  }
  if (key === "recurring_failed") {
    return P(`SELECT rs.donor_id, 'recurring_failed:' || rs.id || ':' || COALESCE(to_char(rs.first_failed_at, 'YYYY-MM-DD'), '') AS event_key
                FROM recurring_subscriptions rs JOIN donors d ON d.id=rs.donor_id AND d.org_id=rs.org_id AND ${LIVE_PERSON}
               WHERE rs.org_id=? AND rs.status IN ('past_due','failed','unpaid','recovering')
                 AND rs.last_failed_at IS NOT NULL AND ${SINCE("rs.last_failed_at", "rs.org_id")}`, [orgId, today, w]);
  }
  if (key === "recurring_cancelled") {
    return P(`SELECT rs.donor_id, 'recurring_cancelled:' || rs.id AS event_key
                FROM recurring_subscriptions rs JOIN donors d ON d.id=rs.donor_id AND d.org_id=rs.org_id AND ${LIVE_PERSON}
               WHERE rs.org_id=? AND rs.status IN ('canceled','cancelled')
                 AND rs.canceled_at IS NOT NULL AND ${SINCE("rs.canceled_at", "rs.org_id")}`, [orgId, today, w]);
  }
  if (key === "card_expiring") {
    // "Next month" in the org's own calendar.
    const [y, m] = String(today).slice(0, 7).split("-").map(Number);
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    return P(`SELECT rs.donor_id, 'card_expiring:' || rs.id || ':' || ?::text AS event_key
                FROM recurring_subscriptions rs JOIN donors d ON d.id=rs.donor_id AND d.org_id=rs.org_id AND ${LIVE_PERSON}
               WHERE rs.org_id=? AND rs.status = ANY(?::text[]) AND rs.card_exp_year=? AND rs.card_exp_month=?`,
      [`${ny}-${String(nm).padStart(2, "0")}`, orgId, GR.ACTIVE_RECURRING_STATUSES, ny, nm]);
  }
  if (key === "volunteer_hours") {
    const rows = await P(
      `SELECT v.person_id AS donor_id,
              COALESCE(SUM(v.hours) FILTER (WHERE v.date::date < ?::date - ?::int), 0)::float AS before,
              COALESCE(SUM(v.hours), 0)::float AS after
         FROM volunteer_shifts v JOIN donors d ON d.id=v.person_id AND d.org_id=v.org_id AND ${LIVE_PERSON}
        WHERE v.org_id=? AND COALESCE(v.date,'') <> '' GROUP BY v.person_id HAVING SUM(v.hours) >= ?`,
      [today, w, orgId, J.HOUR_MILESTONES[0]]);
    return rows.map(r => {
      const crossed = J.HOUR_MILESTONES.filter(m => r.before < m && r.after >= m);
      return crossed.length ? { donor_id: r.donor_id, event_key: `volunteer_hours:${crossed[crossed.length - 1]}`, crossed } : null;
    }).filter(Boolean);
  }
  if (key === "first_event") {
    return P(`SELECT ea.donor_id, 'first_event' AS event_key
                FROM event_attendees ea JOIN events e ON e.id=ea.event_id
                JOIN donors d ON d.id=ea.donor_id AND d.org_id=ea.org_id AND ${LIVE_PERSON}
               WHERE ea.org_id=? AND lower(coalesce(ea.status,'')) = 'attended'
               GROUP BY ea.donor_id
              HAVING MIN(COALESCE(e.date::date, ${DAY_OF("ea.created_at", "ea.org_id")})) >= ?::date - ?::int`, [orgId, today, w]);
  }
  if (key === "grant_awarded") {
    return P(`SELECT g.funder_donor_id AS donor_id, 'grant:' || g.id AS event_key
                FROM grants g JOIN donors d ON d.id=g.funder_donor_id AND d.org_id=g.org_id AND d.deleted_at IS NULL
               WHERE g.org_id=? AND g.status='awarded' AND g.awarded_at IS NOT NULL
                 AND ${SINCE("g.awarded_at", "g.org_id")}`, [orgId, today, w]);
  }
  if (key === "p2p_goal") {
    return P(`SELECT f.person_id AS donor_id, 'p2p_goal:' || f.id AS event_key
                FROM peer_fundraisers f JOIN donors d ON d.id=f.person_id AND d.org_id=f.org_id AND ${LIVE_PERSON}
               WHERE f.org_id=? AND COALESCE(f.personal_goal_amount, 0) > 0
                 AND (SELECT COALESCE(SUM(x.amount),0) FROM gifts x
                       WHERE x.org_id=f.org_id AND x.peer_fundraiser_id=f.id AND x.amount > 0) >= f.personal_goal_amount
                 AND EXISTS (SELECT 1 FROM gifts x WHERE x.org_id=f.org_id AND x.peer_fundraiser_id=f.id
                               AND COALESCE(x.date,'') <> '' AND x.date::date >= ?::date - ?::int)`, [orgId, today, w]);
  }
  // ── JOURNEYS-4 · EVERYTHING ELSE A DONOR DOES ────────────────────────────
  // Each one a row Steward already keeps, its date inside the window, and the
  // thing it is about in the event key so it enrols a person once.
  if (key === "pledge_made") {
    return P(`SELECT p.donor_id, 'pledge:' || p.id AS event_key
                FROM pledges p JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id AND ${LIVE_PERSON}
               WHERE p.org_id=? AND COALESCE(p.status,'open') NOT IN ('cancelled','canceled','written_off')
                 AND p.is_shell IS NOT TRUE AND ${SINCE("p.created_at", "p.org_id")}`, [orgId, today, w]);
  }
  if (key === "pledge_late") {
    return P(`SELECT p.donor_id, 'pledge_late:' || i.id AS event_key
                FROM pledge_installments i JOIN pledges p ON p.id=i.pledge_id AND p.org_id=i.org_id
                JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id AND ${LIVE_PERSON}
               WHERE i.org_id=? AND i.paid_gift_id IS NULL AND p.status='open' AND COALESCE(i.due_date,'') <> ''
                 AND i.due_date::date <= ?::date - 14 AND i.due_date::date >= ?::date - 14 - ?::int`, [orgId, today, today, w]);
  }
  if (key === "pledge_paid") {
    return P(`SELECT p.donor_id, 'pledge_paid:' || p.id AS event_key
                FROM pledges p JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id AND ${LIVE_PERSON}
               WHERE p.org_id=? AND p.status='fulfilled' AND p.fulfilled_at IS NOT NULL
                 AND ${SINCE("p.fulfilled_at", "p.org_id")}`, [orgId, today, w]);
  }
  if (key === "page_first_gift") {
    return P(`SELECT g.donor_id, 'page_first_gift' AS event_key
                FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id AND ${LIVE_PERSON}
               WHERE g.org_id=? AND g.giving_page_id IS NOT NULL AND g.amount > 0 AND COALESCE(g.date,'') <> ''
               GROUP BY g.donor_id HAVING MIN(LEFT(g.date,10))::date >= ?::date - ?::int`, [orgId, today, w]);
  }
  if (key === "p2p_created") {
    return P(`SELECT f.person_id AS donor_id, 'p2p_created:' || f.id AS event_key
                FROM peer_fundraisers f JOIN donors d ON d.id=f.person_id AND d.org_id=f.org_id AND ${LIVE_PERSON}
               WHERE f.org_id=? AND ${SINCE("f.created_at", "f.org_id")}`, [orgId, today, w]);
  }
  // The winner is the top bid by the one ordering (auctionCore TOP_BIDS_SQL),
  // and an item is closed when its own close or the auction's has passed.
  const AUCTION_CLOSE = `LEAST(au.closes_at, COALESCE(ai.closed_at, au.closes_at))`;
  if (key === "auction_won") {
    return P(`SELECT bw.donor_id, 'auction_won:' || ai.id AS event_key
                FROM auction_items ai JOIN auctions au ON au.id=ai.auction_id AND au.org_id=ai.org_id
                JOIN LATERAL (SELECT b.bidder_id FROM auction_bids b WHERE b.org_id=ai.org_id AND b.item_id=ai.id
                               ORDER BY b.amount DESC, b.created_at ASC, b.id ASC LIMIT 1) tb ON true
                JOIN auction_bidders bw ON bw.id=tb.bidder_id AND bw.org_id=ai.org_id
                JOIN donors d ON d.id=bw.donor_id AND d.org_id=ai.org_id AND ${LIVE_PERSON}
               WHERE ai.org_id=? AND ${AUCTION_CLOSE} <= NOW() AND ${SINCE(AUCTION_CLOSE, "ai.org_id")}`, [orgId, today, w]);
  }
  if (key === "auction_lost") {
    return P(`SELECT DISTINCT bd.donor_id, 'auction_lost:' || au.id AS event_key
                FROM auctions au JOIN auction_bids b ON b.auction_id=au.id AND b.org_id=au.org_id
                JOIN auction_bidders bd ON bd.id=b.bidder_id AND bd.org_id=au.org_id
                JOIN donors d ON d.id=bd.donor_id AND d.org_id=au.org_id AND ${LIVE_PERSON}
               WHERE au.org_id=? AND au.closes_at <= NOW() AND ${SINCE("au.closes_at", "au.org_id")}
                 AND NOT EXISTS (SELECT 1 FROM auction_items ai
                                   JOIN LATERAL (SELECT b2.bidder_id FROM auction_bids b2 WHERE b2.org_id=ai.org_id AND b2.item_id=ai.id
                                                  ORDER BY b2.amount DESC, b2.created_at ASC, b2.id ASC LIMIT 1) tb ON true
                                  WHERE ai.auction_id=au.id AND ai.org_id=au.org_id AND tb.bidder_id=bd.id)`, [orgId, today, w]);
  }
  if (key === "auction_donated") {
    return P(`SELECT ai.donor_id, 'auction_donated:' || ai.id AS event_key
                FROM auction_items ai JOIN donors d ON d.id=ai.donor_id AND d.org_id=ai.org_id AND ${LIVE_PERSON}
               WHERE ai.org_id=? AND ${SINCE("ai.created_at", "ai.org_id")}`, [orgId, today, w]);
  }
  if (key === "event_registered") {
    return P(`SELECT DISTINCT ea.donor_id, 'event_registered:' || ea.event_id AS event_key
                FROM event_attendees ea JOIN donors d ON d.id=ea.donor_id AND d.org_id=ea.org_id AND ${LIVE_PERSON}
               WHERE ea.org_id=? AND lower(coalesce(ea.status,'')) NOT IN ('cancelled','invited','declined')
                 AND ${SINCE("ea.created_at", "ea.org_id")}`, [orgId, today, w]);
  }
  if (key === "attended_event") {
    return P(`SELECT DISTINCT ea.donor_id, 'event:' || ea.event_id AS event_key
                FROM event_attendees ea JOIN events e ON e.id=ea.event_id
                JOIN donors d ON d.id=ea.donor_id AND d.org_id=ea.org_id AND ${LIVE_PERSON}
               WHERE ea.org_id=? AND (lower(coalesce(ea.status,'')) = 'attended' OR ea.checked_in_at IS NOT NULL)
                 AND COALESCE(${DAY_OF("ea.checked_in_at", "ea.org_id")}, e.date::date, ${DAY_OF("ea.created_at", "ea.org_id")}) >= ?::date - ?::int`, [orgId, today, w]);
  }
  if (key === "event_no_show") {
    return P(`SELECT DISTINCT ea.donor_id, 'event_no_show:' || ea.event_id AS event_key
                FROM event_attendees ea JOIN events e ON e.id=ea.event_id AND e.org_id=ea.org_id
                JOIN donors d ON d.id=ea.donor_id AND d.org_id=ea.org_id AND ${LIVE_PERSON}
               WHERE ea.org_id=? AND ${EVENT_NO_SHOW_SQL("ea", "e", "?::date")}
                 AND e.date::date >= ?::date - ?::int`, [orgId, today, today, w]);
  }
  if (key === "task_outcome") {
    return P(`SELECT t.donor_id, 'task_outcome:' || t.id AS event_key, t.outcome
                FROM tasks t JOIN donors d ON d.id=t.donor_id AND d.org_id=t.org_id AND ${LIVE_PERSON}
               WHERE t.org_id=? AND t.done=1 AND t.outcome IS NOT NULL AND t.voided_at IS NULL
                 AND ${SINCE("t.completed_at", "t.org_id")}`, [orgId, today, w]);
  }
  if (key === "email_engaged_no_gift") {
    // Opened or clicked, 14 days ago or more (inside the window), and not a
    // gift of any kind from them since the day they opened it.
    const wait = (await journeyMod()).EMAIL_WAIT_DAYS;
    const noGiftSince = col => `NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id AND g.amount > 0
                                  AND COALESCE(g.date,'') <> '' AND LEFT(g.date,10)::date >= ${col})`;
    const steward = await P(
      `SELECT DISTINCT cr.donor_id, 'email_engaged:s:' || cr.campaign_id AS event_key
         FROM campaign_recipients cr JOIN donors d ON d.id=cr.donor_id AND d.org_id=cr.org_id AND ${LIVE_PERSON}
        WHERE cr.org_id=? AND cr.opened_at IS NOT NULL
          AND ${DAY_OF("cr.opened_at", "cr.org_id")} <= ?::date - ?::int AND ${DAY_OF("cr.opened_at", "cr.org_id")} >= ?::date - ?::int - ?::int
          AND ${noGiftSince(DAY_OF("cr.opened_at", "cr.org_id"))}`, [orgId, today, wait, today, wait, w]);
    const mailchimp = await P(
      `SELECT DISTINCT a.donor_id, 'email_engaged:m:' || a.campaign_id AS event_key
         FROM email_marketing_activity a JOIN email_marketing_campaigns c ON c.id=a.campaign_id AND c.org_id=a.org_id
         JOIN donors d ON d.id=a.donor_id AND d.org_id=a.org_id AND ${LIVE_PERSON}
        WHERE a.org_id=? AND (a.opened OR a.clicked) AND COALESCE(a.occurred_at, c.sent_at) IS NOT NULL
          AND ${DAY_OF("COALESCE(a.occurred_at, c.sent_at)", "a.org_id")} <= ?::date - ?::int
          AND ${DAY_OF("COALESCE(a.occurred_at, c.sent_at)", "a.org_id")} >= ?::date - ?::int - ?::int
          AND ${noGiftSince(DAY_OF("COALESCE(a.occurred_at, c.sent_at)", "a.org_id"))}`, [orgId, today, wait, today, wait, w]);
    return [...steward, ...mailchimp];
  }
  return [];
}
// JOURNEYS-4 · WHO DIDN'T COME. Marked as not coming, or registered for an
// event that has passed where the door kept a list (somebody was marked as
// attended or checked in) and this person never was. An event nobody took
// attendance at has no no-shows: Steward cannot see who came.
function EVENT_NO_SHOW_SQL(ea, e, todayExpr) {
  return `(lower(coalesce(${ea}.status,'')) = 'no_show'
           OR (lower(coalesce(${ea}.status,'')) IN ('registered','confirmed') AND ${ea}.checked_in_at IS NULL
               AND ${e}.date IS NOT NULL AND ${e}.date::date < ${todayExpr}
               AND EXISTS (SELECT 1 FROM event_attendees x WHERE x.event_id=${ea}.event_id AND x.org_id=${ea}.org_id
                             AND (lower(coalesce(x.status,'')) = 'attended' OR x.checked_in_at IS NOT NULL))))`;
}
function addDaysCivil(day, n) {
  const [y, m, d] = String(day).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// The people a yearly-date journey is for, on its day. Live records only: the
// start path refuses the deceased and do-not-contact itself, with the reason.
async function yearlyAudienceIds(orgId, tf = {}) {
  const who = tf.who || "everyone";
  if (who === "group") {
    const g = tf.groupId ? await GR.groupById(orgId, tf.groupId) : null;
    if (!g) return [];
    const ids = await GR.memberIds(orgId, g);
    if (!ids.length) return [];
    return (await query(`SELECT id FROM donors WHERE org_id=? AND id = ANY(?::text[]) AND deleted_at IS NULL AND is_sample IS NOT TRUE ORDER BY id`,
      [orgId, ids])).map(r => r.id);
  }
  if (who === "stage") {
    if (!tf.stage) return [];
    return (await query(`SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND is_sample IS NOT TRUE AND lower(stage)=lower(?) ORDER BY id`,
      [orgId, String(tf.stage)])).map(r => r.id);
  }
  if (who === "open_pledge") {
    return (await query(`SELECT d.id FROM donors d WHERE d.org_id=? AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE
        AND EXISTS (SELECT 1 FROM pledges p WHERE p.org_id=d.org_id AND p.donor_id=d.id AND p.status='open' AND p.is_shell IS NOT TRUE)
      ORDER BY d.id`, [orgId])).map(r => r.id);
  }
  return (await query(`SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND is_sample IS NOT TRUE ORDER BY id`, [orgId])).map(r => r.id);
}
// The reasons worth counting on the journey: somebody in its audience who did
// not start. A rerun ("already started it for this date") is not a skip.
const YEARLY_SKIP_KEEP = new Set(["already_in_a_journey", "already_in_this_journey", "in_another_journey", "do_not_contact", "deceased", "do_not_solicit"]);
async function runYearlyDates(orgId, today) {
  const J = await journeyMod();
  const due = (await query(
    `SELECT id, trigger_filters FROM cultivation_templates WHERE org_id=? AND trigger_key='yearly_date'
        AND journey_enabled=true AND archived_at IS NULL ORDER BY priority DESC, id`, [orgId]))
    .filter(t => { const tf = t.trigger_filters || {}; return J.yearlyRunsOn(tf.month, tf.day, today); });
  let fired = 0;
  for (const t of due) {
    const eventKey = `yearly:${today.slice(0, 4)}`;
    for (const id of await yearlyAudienceIds(orgId, t.trigger_filters || {})) {
      const out = await maybeStartJourney(orgId, id, "yearly_date", { today, eventKey, journeyId: t.id })
        .catch(e => { console.error("[journey] yearly_date:", e.message); return null; });
      if (out && out.started) { fired++; continue; }
      if (out && YEARLY_SKIP_KEEP.has(out.reason)) {
        await query(
          `INSERT INTO journey_start_skips (id, org_id, template_id, donor_id, event_key, reason, sentence, on_day, created_by, created_by_name)
           VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (org_id, template_id, donor_id, event_key) DO NOTHING`,
          ["jss_" + require("crypto").randomUUID().replace(/-/g, "").slice(0, 16), orgId, t.id, id, eventKey, out.reason,
           J.skipSentence(out.reason, out.currentName || ""), today, "system:journey", "Steward (journey)"])
          .catch(e => console.error("[journey] skip record:", e.message));
      }
    }
  }
  return fired;
}
async function runLifecycleTriggers(orgId, today) {
  const J = await journeyMod();
  const armed = await query(
    `SELECT DISTINCT trigger_key FROM cultivation_templates
      WHERE org_id=? AND journey_enabled=true AND archived_at IS NULL AND trigger_key = ANY(?::text[])`,
    [orgId, J.SWEEP_TRIGGER_KEYS]);
  let fired = 0;
  for (const { trigger_key: key } of armed) {
    for (const r of await lifecycleRows(orgId, key, today)) {
      const out = await maybeStartJourney(orgId, r.donor_id, key, { today, eventKey: r.event_key, crossed: r.crossed, outcome: r.outcome })
        .catch(e => { console.error(`[journey] ${key}:`, e.message); return null; });
      if (out && out.started) fired += 1 + (out.also || []).length;
    }
  }
  return fired;
}
return { lifecycleRows, runJourneySweep, runLifecycleTriggers };
}

module.exports = { mount };
