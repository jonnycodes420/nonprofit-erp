// engagement.js — ENGAGE-1. Two scores per donor, 0 to 100, relative to the
// organisation's own people: ENGAGEMENT (how close) and GENEROSITY (how much).
//
// ONE ROW BUILDER. `touchRows` and `givingRows` are the only places a touch or a
// gift becomes a scored row. The nightly compute runs them for the whole org;
// "See why" runs them for one person. Same function, same filter, so a part's
// rows ARE the rows it counted, which is what tests/engage1-score-breakdown
// proves. The weights, windows and cut points are in shared/engagementWeights.js
// and nowhere else.
//
// `q(sql, args)` is any query function that takes `?` placeholders and returns
// rows: db.js's `query` on the server, an adapter in scripts/ci/seed-demo.js.
//
// The scores are stored in donor_scores (derived data, never edited by a
// person), so the Donors list can sort by them and the profile can show them
// without recomputing. SCORES-1: a change rescores the people it touched; the
// full pass rescores the org; both write only the rows that changed.

const { meetingsSql } = require("./meetings");
const driftEngine = require("./drift");
const RHYTHM = require("./shared/numbers/rhythm");   // STATUS-1: the one rhythm

let W = null;
async function weights() { if (!W) W = await import("./shared/engagementWeights.js"); return W; }

const DAY = 86400000;
const civil = d => (d == null ? null : String(d instanceof Date ? require("./orgTime").civilOf(d) : d).slice(0, 10));
function ageDays(today, date) {
  const a = Date.parse(today + "T00:00:00Z"), b = Date.parse(civil(date) + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / DAY) : Infinity;
}
function addDays(today, n) { return new Date(Date.parse(today + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10); }
const cents = v => Math.round(Number(v || 0) * 100);
const round2 = x => Math.round(x * 100) / 100;

// ── ENGAGEMENT ROWS ─────────────────────────────────────────────────────────
// Every touch in the window, with its points. A row with zero points (older
// than the window) is never returned: it counted nothing.
// SCORES-1: `donorId` is one id, a list of ids (the people a change touched),
// or null for the whole org.
const idsOf = donorId => (donorId == null ? null : [].concat(donorId));
async function touchRows(q, orgId, today, donorId = null) {
  const w = await weights();
  const from = addDays(today, -(w.WINDOW_DAYS - 1));
  const ids = idsOf(donorId);
  const dF = ids ? " AND d.id = ANY(?)" : "";
  const dA = ids ? [ids] : [];
  const out = [];
  const push = (part, r, base, detail) => {
    const date = civil(r.date);
    const pts = round2(base * w.recencyWeight(ageDays(today, date)));
    if (pts > 0) out.push({ part, id: String(r.id), donor_id: r.donor_id, date, points: pts, detail });
  };

  // Meetings: the one source (meetings.js), each person on a calendar meeting.
  // POLISH-1: held meetings only, the same rule as Last met (a calendar meeting
  // later today has not happened yet; its booking line counts below).
  const m = meetingsSql(orgId, { from, to: today, held: true, eachPerson: true });
  const mRows = await q(
    `SELECT m.id, m.donor_id, m.date, m.kind, m.title FROM (${m.sql}) m JOIN donors d ON d.id = m.donor_id AND d.org_id = ?
      WHERE d.deleted_at IS NULL${dF}`, [...m.args, orgId, ...dA]);
  for (const r of mRows) push("meetings", r, w.TOUCH_POINTS.meetings.points, r.kind === "calendar" ? `Calendar: ${r.title || "Meeting"}` : "Meeting, logged");
  // FIX-33: a meeting BOOKED is staff reaching out and the person saying yes,
  // dated the day it was booked. It counts as a meeting at BOOKED_POINTS until
  // it happens (then the meeting itself counts too), and stops counting if it
  // is cancelled (meetingEffects.js marks the booking line cancelled).
  const booked = await q(
    `SELECT i.id, i.donor_id, LEFT(i.date, 10) AS date FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
      WHERE i.org_id = ? AND d.deleted_at IS NULL AND i.type = 'note' AND i.metadata->>'kind' = 'meeting_booked'
        AND COALESCE(i.metadata->>'cancelled', 'false') <> 'true' AND LEFT(i.date, 10) BETWEEN ? AND ?${dF}`,
    [orgId, from, today, ...dA]);
  for (const r of booked) push("meetings", r, w.BOOKED_POINTS, "Meeting booked");
  // POLISH-1: a booking still earns its points under meetings, but it is not a
  // meeting held, so the sentence never says "1 meeting" beside Last met's
  // "Not met yet" (which reads held meetings only). Marked for reasonOf.
  for (let i = out.length - 1; i >= 0 && out[i].detail === "Meeting booked"; i--) out[i].booked = true;

  const calls = await q(
    `SELECT i.id, i.donor_id, LEFT(i.date, 10) AS date FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
      WHERE i.org_id = ? AND d.deleted_at IS NULL AND i.type LIKE 'call%' AND LEFT(i.date, 10) BETWEEN ? AND ?${dF}`,
    [orgId, from, today, ...dA]);
  for (const r of calls) push("calls", r, w.TOUCH_POINTS.calls.points, "Call");

  // A REPLY is mail FROM them: mailbox sync marks it inbound. The newsletter
  // sync's own timeline lines are not replies and are counted under email.
  const replies = await q(
    `SELECT i.id, i.donor_id, LEFT(i.date, 10) AS date FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
      WHERE i.org_id = ? AND d.deleted_at IS NULL AND i.type = 'email' AND i.metadata->>'direction' = 'inbound'
        AND COALESCE(i.created_by, '') NOT LIKE 'system:email-marketing%' AND LEFT(i.date, 10) BETWEEN ? AND ?${dF}`,
    [orgId, from, today, ...dA]);
  for (const r of replies) push("replies", r, w.TOUCH_POINTS.replies.points, "Email reply");

  const events = await q(
    `SELECT a.id, a.donor_id, e.date::text AS date, e.name FROM event_attendees a
       JOIN events e ON e.id = a.event_id JOIN donors d ON d.id = a.donor_id AND d.org_id = e.org_id
      WHERE e.org_id = ? AND d.deleted_at IS NULL AND (a.status = 'attended' OR a.checked_in_at IS NOT NULL)
        AND e.date BETWEEN ?::date AND ?::date${dF}`, [orgId, from, today, ...dA]);
  for (const r of events) push("events", r, w.TOUCH_POINTS.events.points, `Attended ${r.name || "an event"}`);

  const shifts = await q(
    `SELECT s.id, s.person_id AS donor_id, LEFT(s.date, 10) AS date, s.hours FROM volunteer_shifts s
       JOIN donors d ON d.id = s.person_id AND d.org_id = s.org_id
      WHERE s.org_id = ? AND d.deleted_at IS NULL AND LEFT(s.date, 10) BETWEEN ? AND ?${dF}`, [orgId, from, today, ...dA]);
  for (const r of shifts) push("volunteering", r, w.TOUCH_POINTS.volunteering.points, `Volunteer shift${r.hours ? `, ${Number(r.hours)} hours` : ""}`);

  const email = await q(
    `SELECT a.id, a.donor_id, (a.occurred_at AT TIME ZONE 'UTC')::date::text AS date, a.clicked, c.name FROM email_marketing_activity a
       JOIN email_marketing_campaigns c ON c.id = a.campaign_id JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id
      WHERE a.org_id = ? AND d.deleted_at IS NULL AND (a.opened OR a.clicked) AND a.occurred_at IS NOT NULL
        AND (a.occurred_at AT TIME ZONE 'UTC')::date BETWEEN ?::date AND ?::date${dF}`, [orgId, from, today, ...dA]);
  for (const r of email) push("email", r, r.clicked ? w.TOUCH_POINTS.email.points : w.OPEN_POINTS, `${r.clicked ? "Clicked" : "Opened"} ${r.name || "a newsletter"}`);

  // Named survey answers (SURVEY-1). The table may not exist yet on an old
  // database; a missing table is "no answers", never an error. Asked first
  // rather than caught, because a failed statement inside a transaction (the
  // seed's) would poison every statement after it.
  const [{ t: hasSurveys } = {}] = await q(`SELECT to_regclass('survey_responses') IS NOT NULL AS t`, []);
  const surveys = !hasSurveys ? [] : await q(
    `SELECT r.id, r.donor_id, (r.submitted_at AT TIME ZONE 'UTC')::date::text AS date, s.title FROM survey_responses r
       JOIN surveys s ON s.id = r.survey_id JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id
      WHERE r.org_id = ? AND d.deleted_at IS NULL AND r.donor_id IS NOT NULL
        AND (r.submitted_at AT TIME ZONE 'UTC')::date BETWEEN ?::date AND ?::date${dF}`, [orgId, from, today, ...dA]);
  for (const r of surveys) push("surveys", r, w.TOUCH_POINTS.surveys.points, `Answered ${r.title || "a survey"}`);

  // WIRE-1 addendum · WHAT THEY DO FOR YOU. Each from its own table, org-scoped
  // on both sides of every join, so a row can only be this org's.
  // A peer-to-peer page they run: one row per page that is live or has raised
  // money, dated by its latest gift (the page's creation when it has none yet).
  const pages = await q(
    `SELECT pf.id, pf.person_id AS donor_id, pf.name,
            COALESCE((SELECT MAX(LEFT(g.date, 10)) FROM gifts g WHERE g.org_id = pf.org_id AND g.peer_fundraiser_id = pf.id AND g.amount > 0),
                     (pf.created_at AT TIME ZONE 'UTC')::date::text) AS date,
            (SELECT COALESCE(SUM(g.amount), 0)::text FROM gifts g WHERE g.org_id = pf.org_id AND g.peer_fundraiser_id = pf.id AND g.amount > 0) AS raised
       FROM peer_fundraisers pf JOIN donors d ON d.id = pf.person_id AND d.org_id = pf.org_id
      WHERE pf.org_id = ? AND d.deleted_at IS NULL${dF}
        AND (pf.status = 'active' OR EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = pf.org_id AND g.peer_fundraiser_id = pf.id AND g.amount > 0))`,
    [orgId, ...dA]);
  for (const r of pages) {
    if (!(r.date >= from)) continue;   // a page made "tomorrow" in UTC is today's: a negative age counts in full
    const raised = cents(r.raised);
    push("fundraising", r, w.TOUCH_POINTS.fundraising.points,
      `Ran a peer-to-peer page${raised > 0 ? `, raised $${(raised / 100).toLocaleString("en-US", { minimumFractionDigits: raised % 100 ? 2 : 0, maximumFractionDigits: 2 })}` : ""}`);
  }

  // A ticket or registration for an event they have not (yet) been marked at.
  // Bought on the day it was made, or the event day if that came first.
  const tickets = await q(
    `SELECT a.id, a.donor_id, LEAST(e.date::date, (a.created_at AT TIME ZONE 'UTC')::date, ?::date)::text AS date, e.name FROM event_attendees a
       JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id
      WHERE a.org_id = ? AND d.deleted_at IS NULL AND a.status IN ('registered','confirmed') AND a.checked_in_at IS NULL
        AND LEAST(e.date::date, (a.created_at AT TIME ZONE 'UTC')::date, ?::date) >= ?::date${dF}`, [today, orgId, today, from, ...dA]);
  for (const r of tickets) push("tickets", r, w.TOUCH_POINTS.tickets.points, `Ticket for ${r.name || "an event"}`);

  // An auction they bid in: one row per auction, dated by their latest bid.
  const bids = await q(
    `SELECT b.id, b.donor_id, LEAST(MAX((x.created_at AT TIME ZONE 'UTC')::date), ?::date)::text AS date, COUNT(x.id)::int AS n, a.title
       FROM auction_bidders b JOIN auction_bids x ON x.bidder_id = b.id AND x.org_id = b.org_id
       JOIN auctions a ON a.id = b.auction_id AND a.org_id = b.org_id
       JOIN donors d ON d.id = b.donor_id AND d.org_id = b.org_id
      WHERE b.org_id = ? AND d.deleted_at IS NULL${dF}
      GROUP BY b.id, b.donor_id, a.title
     HAVING MAX((x.created_at AT TIME ZONE 'UTC')::date) >= ?::date`, [today, orgId, ...dA, from]);
  for (const r of bids) push("auctions", r, w.TOUCH_POINTS.auctions.points, `${r.n} ${r.n === 1 ? "bid" : "bids"} in ${r.title || "an auction"}`);

  // A membership year: each joining or renewal is its own row.
  const members = await q(
    `SELECT m.id, m.donor_id, LEFT(COALESCE(m.starts_on, m.joined_on), 10) AS date, l.name FROM memberships m
       JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id
       LEFT JOIN membership_levels l ON l.id = m.level_id AND l.org_id = m.org_id
      WHERE m.org_id = ? AND d.deleted_at IS NULL AND m.status <> 'cancelled'
        AND LEFT(COALESCE(m.starts_on, m.joined_on), 10) BETWEEN ? AND ?${dF}`, [orgId, from, today, ...dA]);
  for (const r of members) push("memberships", r, w.TOUCH_POINTS.memberships.points, `Membership${r.name ? `, ${r.name}` : ""}`);

  return out.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.id.localeCompare(b.id));
}

// ── GENEROSITY ROWS ─────────────────────────────────────────────────────────
// Gifts in cents (by the one conversion), and the recurring gifts running now.
// NUMBERS-4: money is shared/numbers/money.js's MONEY (a soft or matching
// credit row is not money; a refund comes off). The parts are dated rows the
// drawer opens, so an imported total with no rows behind it is not a part.
async function givingRows(q, orgId, donorId = null) {
  const ids = idsOf(donorId);
  const dF = ids ? " AND d.id = ANY(?)" : "";
  const dA = ids ? [ids] : [];
  const gifts = (await q(
    `SELECT g.id, g.donor_id, LEFT(g.date, 10) AS date, g.amount::text AS amount FROM gifts g
       JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date IS NOT NULL AND g.date <> '' AND ${require("./shared/numbers/money").MONEY("g")}${dF}`, [orgId, ...dA]))
    .map(r => ({ id: String(r.id), donor_id: r.donor_id, date: civil(r.date), cents: cents(r.amount) }));
  const subs = (await q(
    `SELECT s.id, s.donor_id, s.amount::text AS amount, s.interval, s.created_at FROM recurring_subscriptions s
       JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
      WHERE s.org_id = ? AND d.deleted_at IS NULL AND s.status = 'active'${dF}`, [orgId, ...dA]))
    .map(r => ({ id: String(r.id), donor_id: r.donor_id, date: civil(r.created_at), cents: cents(r.amount), interval: r.interval }));
  return { gifts, subs };
}

// One donor's generosity parts from their own rows. `rows` per part are what
// that part counted; `raw` is the number its percentile is taken of.
async function generosityParts(today, gifts, subs) {
  const w = await weights();
  const Y = Number(today.slice(0, 4));
  const lifetime = gifts;
  const recent = gifts.filter(g => ageDays(today, g.date) < w.WINDOW_DAYS && ageDays(today, g.date) >= 0);
  const byYear = new Map();
  for (const g of gifts) { const y = Number(String(g.date || "").slice(0, 4)); if (y > Y - w.CONSISTENCY_YEARS && y <= Y) byYear.set(y, (byYear.get(y) || 0) + g.cents); }
  const yearRows = [...byYear.entries()].filter(([, c]) => c > 0).sort((a, b) => b[0] - a[0])
    .map(([y, c]) => ({ id: `year:${y}`, date: `${y}-12-31`, cents: c, detail: `Gave in ${y}` }));
  const last = gifts.filter(g => { const a = ageDays(today, g.date); return a >= 0 && a < w.UPGRADE_DAYS; });
  const prior = gifts.filter(g => { const a = ageDays(today, g.date); return a >= w.UPGRADE_DAYS && a < 2 * w.UPGRADE_DAYS; });
  const lastC = last.reduce((s, g) => s + g.cents, 0), priorC = prior.reduce((s, g) => s + g.cents, 0);
  const upgradeRaw = priorC > 0 ? Math.max(0, lastC - priorC) : 0;
  const sum = rs => rs.reduce((s, g) => s + g.cents, 0);
  return {
    lifetime: { raw: Math.max(0, sum(lifetime)), rows: lifetime.map(g => ({ ...g, detail: "Gift" })) },
    recent: { raw: Math.max(0, sum(recent)), rows: recent.map(g => ({ ...g, detail: "Gift in the last 24 months" })) },
    consistency: { raw: yearRows.length, rows: yearRows },
    monthly: { raw: subs.length ? 1 : 0, rows: subs.map(s => ({ ...s, detail: `Recurring gift, every ${s.interval || "month"}` })) },
    // The two windows, the earlier one SIGNED NEGATIVE, so the rows add up to
    // the growth they explain when there is growth to explain.
    upgrade: { raw: upgradeRaw, rows: upgradeRaw > 0 ? [
      ...last.map(g => ({ ...g, detail: "Last 12 months" })),
      ...prior.map(g => ({ ...g, cents: -g.cents, detail: "The 12 months before, subtracted" })),
    ] : [] },
  };
}

// ── ARITHMETIC ──────────────────────────────────────────────────────────────
// Where a value stands in the population, 0-100, by MID-RANK: everyone below
// it, plus half of everyone tied with it. Seventy people with the same single
// email open share the middle of their group instead of all claiming its top.
// Zero is always 0.
function pctAtOrBelow(v, sortedAsc) {
  if (!(v > 0) || !sortedAsc.length) return 0;
  const firstAbove = x => { let lo = 0, hi = sortedAsc.length; while (lo < hi) { const m = (lo + hi) >> 1; if (x(sortedAsc[m])) hi = m; else lo = m + 1; } return lo; };
  const below = firstAbove(y => y >= v), upTo = firstAbove(y => y > v);
  return (100 * (below + (upTo - below) / 2)) / sortedAsc.length;
}
// Largest remainder: integers in proportion to `xs` that add to exactly `total`.
function apportion(total, xs) {
  const X = xs.reduce((s, x) => s + Math.max(0, x), 0);
  if (!(X > 0) || !(total > 0)) return xs.map(() => 0);
  const exact = xs.map(x => (total * Math.max(0, x)) / X);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((s, x) => s + x, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}

function reasonOf(w, byPart, lastDate, today) {
  const counted = w.ENGAGEMENT_PARTS.map(k => ({ k, n: byPart[k].count, pts: byPart[k].raw })).filter(x => x.n > 0)
    .sort((a, b) => b.pts - a.pts);
  if (!counted.length) return "No meeting, call, reply, event, ticket, fundraising page, auction bid, membership or volunteer shift in the last 24 months.";
  const say = x => {
    const b = (byPart[x.k] && byPart[x.k].booked) || 0, held = x.n - b;
    if (x.k === "meetings" && b) return held ? `${held} ${held === 1 ? "meeting" : "meetings"} (${b} more booked)` : `${b} ${b === 1 ? "meeting" : "meetings"} booked`;
    return `${x.n} ${x.n === 1 ? w.TOUCH_POINTS[x.k].one : w.TOUCH_POINTS[x.k].many}`;
  };
  const top = counted.slice(0, 2).map(say).join(" and ");
  return `${top.charAt(0).toUpperCase() + top.slice(1)} in the last 24 months${latestWords(lastDate, today)}.`;
}
// FIX-24 2b: "the most recent touch N days ago" was baked into the stored
// reason on the day the scores ran, so a week later the profile said "16 days
// ago" about something 23 days old. The stored reason ends with these words for
// the day it ran; reasonFor re-says them for the day it is read.
function latestWords(lastDate, today) {
  if (!lastDate) return "";
  const ago = ageDays(today, lastDate);
  return `, the most recent touch ${ago <= 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`}`;
}
function reasonFor(row, today) {
  const r = row && row.reason;
  if (!r) return null;
  const last = row.last_touch ? civil(row.last_touch) : null;
  return r.replace(/, the (?:latest|most recent touch) [^.,]*\.$/, `${latestWords(last, today)}.`);
}

// ── THEIR OWN RHYTHM (WIRE-1 addendum) ───────────────────────────────────────
// Where their giving stands against their own usual gap, by drift.js's one
// rule (assessDrift: their median gap, or their giving season). 'on_track' is
// inside it, 'drifting' and 'lapsed' are past it, null is fewer than two gifts
// (no rhythm to judge against). Refunds are not gifts here.
// STATUS-1: on track is the one rhythm's on time (shared/numbers/rhythm.js:
// their expected next gift has not passed, and they have not lapsed), never
// drift's "not yet far enough past to flag". FIX-33's "already gave their
// usual year" is in that expected date. A person past it is 'late' (or
// 'lapsed'), so the sentence can never say on track while the date has gone.
function patternOf(gifts, today) {
  const gs = gifts.filter(g => g.cents > 0).map(g => ({ date: g.date, amount: g.cents / 100 }));
  const r = RHYTHM.rhythmFor(gs, today);
  if (!r.hasPattern) return null;
  if (r.onTime) return "on_track";
  return r.lapsed ? "lapsed" : "late";
}

// STATUS-1: the last day they are on time, stored for the lists (donor_scores
// .on_time_through, beside donor_rhythm.expected_next, which afterChange.js
// writes): their expected next gift, or the day before a year with no gift,
// whichever comes first. A date, so it never goes stale as days pass; only a
// gift moves it, and a gift recomputes both. shared/numbers/lapse.js reads the
// newer of the two.
function onTimeThrough(gifts, today) {
  const r = RHYTHM.rhythmFor(gifts.filter(g => g.cents > 0).map(g => ({ date: g.date, amount: g.cents / 100 })), today);
  if (!r.hasPattern) return null;
  const yearEnds = require("./orgTime").addDays(r.lastGiftDate, 364);
  return r.onTimeThrough < yearEnds ? r.onTimeThrough : yearEnds;
}

// FIX-34 · THE CLOSENESS WORD ON READ. The profile's closeness line and the
// score card's band word were reading donor_scores.pattern, written the night
// the scores ran, while the drift badge is computed on read: a gift in between
// and the two disagreed. Both now read this, from the gifts as they are now.
async function closenessNow(q, orgId, donorId, today, bandKey) {
  const w = await weights();
  const DS = require("./donorStatus");
  const { gifts } = await givingRows(q, orgId, donorId);
  // FIX-60: a person held by a pledge (lapseRule.js pledgeHold) is on track,
  // the same as donorStatus.closenessSql says for lists.
  const LR = require("./lapseRule");
  const held = LR.pledgeHold(await require("./shared/numbers/lapse").pledgesFor(q, orgId, donorId, today), today) === "hold";   // past due is not on track
  const pattern = held ? "on_track" : patternOf(gifts.filter(g => g.date && g.date <= today), today);
  const [fs] = await q(`SELECT ${DS.firstSeenSql("d.")} AS first FROM donors d WHERE d.id = ? AND d.org_id = ?`, [donorId, orgId]);
  const isNew = !!(fs && fs.first && String(fs.first).slice(0, 10) >= DS.windowsFor(today).newFrom);
  return { key: w.closenessFor(bandKey || "distant", { isNew, pattern }), pattern };
}

// ── THE COMPUTE ─────────────────────────────────────────────────────────────
// Every person in the org, both scores, parts that add to each score.
// SCORES-1: in three steps, so one person can be scored by the same code as
// the whole org: each person's raw values (rawsOf), the population they are
// ranked in (populationOf), and the score against it (scoreAgainst).
async function rawsOf(q, orgId, today, people, { whole = false } = {}) {
  const w = await weights();
  if (!people.length) return new Map();
  const only = whole ? null : people;
  const touches = await touchRows(q, orgId, today, only);
  const { gifts, subs } = await givingRows(q, orgId, only);
  const tBy = new Map(), gBy = new Map(), sBy = new Map();
  for (const t of touches) (tBy.get(t.donor_id) || tBy.set(t.donor_id, []).get(t.donor_id)).push(t);
  for (const g of gifts) (gBy.get(g.donor_id) || gBy.set(g.donor_id, []).get(g.donor_id)).push(g);
  for (const s of subs) (sBy.get(s.donor_id) || sBy.set(s.donor_id, []).get(s.donor_id)).push(s);

  const per = new Map();
  for (const id of people) {
    const ts = tBy.get(id) || [];
    const byPart = Object.fromEntries(w.ENGAGEMENT_PARTS.map(k => [k, { raw: 0, count: 0, booked: 0 }]));
    for (const t of ts) { byPart[t.part].raw = round2(byPart[t.part].raw + t.points); byPart[t.part].count++; if (t.booked) byPart[t.part].booked++; }
    const engRaw = round2(ts.reduce((s, t) => s + t.points, 0));
    const gen = await generosityParts(today, gBy.get(id) || [], sBy.get(id) || []);
    per.set(id, { byPart, engRaw, gen, lastTouch: ts[0] ? ts[0].date : null, pattern: patternOf(gBy.get(id) || [], today), onTimeThrough: onTimeThrough(gBy.get(id) || [], today) });
  }
  return per;
}

// The population a score is ranked in: the engagement of everyone with any,
// and each generosity part's value for everyone who has given. Sorted.
async function populationOf(values) {
  const w = await weights();
  const vs = [...values];
  const eng = vs.map(p => p.eng).filter(v => v > 0).sort((a, b) => a - b);
  const givers = vs.filter(p => p.gen.lifetime > 0);
  const gen = Object.fromEntries(Object.keys(w.GENEROSITY_PARTS).map(k => [k, givers.map(p => p.gen[k]).sort((a, b) => a - b)]));
  return { eng, gen };
}
const valuesOf = p => ({ eng: p.engRaw, gen: Object.fromEntries(Object.entries(p.gen).map(([k, x]) => [k, x.raw])) });

async function scoreAgainst(id, p, pop, today) {
  const w = await weights();
  const engagement = p.engRaw > 0 ? Math.max(1, Math.round(pctAtOrBelow(p.engRaw, pop.eng))) : 0;
  const engPts = apportion(engagement, w.ENGAGEMENT_PARTS.map(k => p.byPart[k].raw));
  const genKeys = Object.keys(w.GENEROSITY_PARTS);
  const giver = p.gen.lifetime.raw > 0;
  const pcts = genKeys.map(k => (giver ? pctAtOrBelow(p.gen[k].raw, pop.gen[k]) : 0));
  const contrib = genKeys.map((k, i) => w.GENEROSITY_PARTS[k].weight * pcts[i]);
  const generosity = giver ? Math.max(1, Math.round(contrib.reduce((s, x) => s + x, 0))) : 0;
  const genPts = apportion(generosity, contrib);
  return {
    donorId: id, engagement, generosity, band: w.bandFor(engagement).key, pattern: p.pattern, onTimeThrough: p.onTimeThrough,
    reason: reasonOf(w, p.byPart, p.lastTouch, today), lastTouch: p.lastTouch,
    parts: {
      engagement: w.ENGAGEMENT_PARTS.map((k, i) => ({ key: k, points: engPts[i], raw: p.byPart[k].raw, count: p.byPart[k].count })),
      generosity: genKeys.map((k, i) => ({ key: k, points: genPts[i], raw: p.gen[k].raw, pct: Math.round(pcts[i]), count: p.gen[k].rows.length })),
    },
  };
}

async function scoreOrg(q, orgId, today) {
  const people = (await q(`SELECT id FROM donors WHERE org_id = ? AND deleted_at IS NULL`, [orgId])).map(r => r.id);
  const per = await rawsOf(q, orgId, today, people, { whole: true });
  const pop = await populationOf([...per.values()].map(valuesOf));
  const out = [];
  for (const [id, p] of per) out.push(await scoreAgainst(id, p, pop, today));
  return out;
}

// ── THE STORED POPULATION (SCORES-1) ────────────────────────────────────────
// THE RULE. A percentile needs the org's population. The population is what
// donor_scores holds: each live person's raw values as of their row's last
// write (parts[].raw; engagement is the sum of its parts). The full pass
// (recomputeOrgScores: the six-hour schedule, and once after an import)
// recomputes everyone against a fresh population. Between passes, a change
// rescores ONLY the people it touched (scorePeople), against the stored
// population with their own old values taken out and their new ones put in,
// so their own score is exactly what a full pass would give them if nobody
// else had changed. Everyone else keeps their row: when a change would move
// someone else's percentile (a cut point), that waits for the next full pass.
async function storedPopulation(q, orgId) {
  const rows = await q(
    `SELECT s.donor_id,
            (SELECT COALESCE(SUM((e->>'raw')::numeric), 0) FROM jsonb_array_elements(COALESCE(s.parts->'engagement', '[]'::jsonb)) e)::float8 AS eng,
            (SELECT jsonb_object_agg(g->>'key', (g->>'raw')::float8) FROM jsonb_array_elements(COALESCE(s.parts->'generosity', '[]'::jsonb)) g) AS gen
       FROM donor_scores s JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id AND d.deleted_at IS NULL
      WHERE s.org_id = ?`, [orgId]);
  const w = await weights();
  const by = new Map(rows.map(r => {
    const g = (typeof r.gen === "string" ? JSON.parse(r.gen) : r.gen) || {};
    return [r.donor_id, { eng: Number(r.eng) || 0, gen: Object.fromEntries(Object.keys(w.GENEROSITY_PARTS).map(k => [k, Number(g[k]) || 0])) }];
  }));
  return { by, pop: await populationOf(by.values()) };
}
// Take one value out of a sorted list (the nearest, within half a cent:
// engagement is summed from its parts) and put one in.
function takeOut(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  const near = [lo - 1, lo].filter(i => i >= 0 && i < sorted.length).sort((a, b) => Math.abs(sorted[a] - v) - Math.abs(sorted[b] - v))[0];
  if (near != null && Math.abs(sorted[near] - v) < 0.005) sorted.splice(near, 1);
}
function putIn(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  sorted.splice(lo, 0, v);
}

// The people a change touched, scored against the stored population (the rule
// above). Read-only: the profile uses it for a person with no row yet.
// `gone` are the ids that are no longer live people (deleted, merged away).
async function scorePeople(q, orgId, today, donorIds) {
  const want = [...new Set((donorIds || []).filter(Boolean))];
  if (!want.length) return { scores: [], gone: [] };
  const live = (await q(`SELECT id FROM donors WHERE org_id = ? AND deleted_at IS NULL AND id = ANY(?)`, [orgId, want])).map(r => r.id);
  const per = await rawsOf(q, orgId, today, live);
  const { by, pop } = await storedPopulation(q, orgId);
  const w = await weights();
  const keys = Object.keys(w.GENEROSITY_PARTS);
  for (const [id, p] of per) {
    const old = by.get(id), now = valuesOf(p);
    if (old) {
      if (old.eng > 0) takeOut(pop.eng, old.eng);
      if (old.gen.lifetime > 0) for (const k of keys) takeOut(pop.gen[k], old.gen[k]);
    }
    if (now.eng > 0) putIn(pop.eng, now.eng);
    if (now.gen.lifetime > 0) for (const k of keys) putIn(pop.gen[k], now.gen[k]);
  }
  const scores = [];
  for (const [id, p] of per) scores.push(await scoreAgainst(id, p, pop, today));
  return { scores, gone: want.filter(id => !per.has(id)) };
}

// Who a change to these people touches: themselves, their household and the
// person linked to them as spouse or household.
async function pooledWith(q, orgId, donorIds) {
  const ids = [...new Set((donorIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const rows = await q(
    `SELECT d2.id FROM donors d1 JOIN donors d2 ON d2.org_id = d1.org_id AND d2.household_id = d1.household_id
      WHERE d1.org_id = ? AND d1.id = ANY(?) AND d1.household_id IS NOT NULL
     UNION SELECT CASE WHEN r.donor_id_a = ANY(?) THEN r.donor_id_b ELSE r.donor_id_a END FROM donor_relationships r
      WHERE r.org_id = ? AND r.relationship_type IN ('spouse', 'household') AND (r.donor_id_a = ANY(?) OR r.donor_id_b = ANY(?))`,
    [orgId, ids, ids, orgId, ids, ids]);
  return [...new Set([...ids, ...rows.map(r => r.id).filter(Boolean)])];
}

// ── THE WRITE (SCORES-1) ────────────────────────────────────────────────────
// Upserts in batches of 500, and only a row whose value changed. The reason's
// closing "the most recent touch N days ago" is said for the day it is read
// (reasonFor), so a new day alone is not a change. A row is also rewritten
// when the person's rhythm row (afterChange.js) is newer than it, because
// lapse.js ON_TIME_THROUGH reads the newer of the two. computed_for is the
// day the row's values last changed. A recompute that changes nothing writes
// nothing. Returns the number of rows written.
const TAIL_SQL = col => `regexp_replace(COALESCE(${col}, ''), ', the (latest|most recent touch) [^.,]*\\.$', '.')`;
async function writeScores(q, orgId, today, scores) {
  let written = 0;
  for (let i = 0; i < scores.length; i += 500) {
    const chunk = scores.slice(i, i + 500);
    const rows = await q(
      `INSERT INTO donor_scores AS s (org_id, donor_id, engagement, generosity, band, pattern, on_time_through, reason, last_touch, parts, computed_for, computed_at, created_by, created_by_name)
       SELECT ?, x.donor_id, x.engagement, x.generosity, x.band, x.pattern, x.on_time_through, x.reason, x.last_touch, x.parts::jsonb, ?, NOW(), 'system:engagement', 'Steward (scores)'
         FROM jsonb_to_recordset(?::jsonb) AS x(donor_id text, engagement int, generosity int, band text, pattern text, on_time_through text, reason text, last_touch text, parts text)
       ON CONFLICT (org_id, donor_id) DO UPDATE SET engagement = EXCLUDED.engagement, generosity = EXCLUDED.generosity, band = EXCLUDED.band,
         pattern = EXCLUDED.pattern, on_time_through = EXCLUDED.on_time_through, reason = EXCLUDED.reason, last_touch = EXCLUDED.last_touch,
         parts = EXCLUDED.parts, computed_for = EXCLUDED.computed_for, computed_at = NOW()
       WHERE (s.engagement, s.generosity, s.band, s.pattern, s.on_time_through, ${TAIL_SQL("s.reason")}, s.last_touch, s.parts)
             IS DISTINCT FROM (EXCLUDED.engagement, EXCLUDED.generosity, EXCLUDED.band, EXCLUDED.pattern, EXCLUDED.on_time_through, ${TAIL_SQL("EXCLUDED.reason")}, EXCLUDED.last_touch, EXCLUDED.parts)
          OR s.computed_at < (SELECT rr.computed_at FROM donor_rhythm rr WHERE rr.org_id = s.org_id AND rr.donor_id = s.donor_id)
       RETURNING s.donor_id`,
      [orgId, today, JSON.stringify(chunk.map(s => ({ donor_id: s.donorId, engagement: s.engagement, generosity: s.generosity,
        band: s.band, pattern: s.pattern, on_time_through: s.onTimeThrough, reason: s.reason, last_touch: s.lastTouch, parts: JSON.stringify(s.parts) })))]);
    written += rows.length;
  }
  return written;
}

// THE FULL PASS. Everyone against a fresh population; changed rows only. The
// one delete is the rows of people who are no longer live (deleted, merged
// away), by their ids. No org-wide delete (SCORES-1; arch-check score-deletes).
async function recomputeOrgScores(q, orgId, today) {
  const scores = await scoreOrg(q, orgId, today);
  const written = await writeScores(q, orgId, today, scores);
  await q(`DELETE FROM donor_scores s WHERE s.org_id = ? AND NOT (s.donor_id = ANY(?))`, [orgId, scores.map(s => s.donorId)]);
  if (written) console.log(`[scores] ${orgId}: full pass, ${written} of ${scores.length} rows changed`);
  return scores.length;
}

// A CHANGE. The people it touched (and those pooled with them), scored by the
// rule above, written if changed; a person no longer live loses their own row.
async function recomputePeopleScores(q, orgId, today, donorIds) {
  const ids = await pooledWith(q, orgId, donorIds);
  const { scores, gone } = await scorePeople(q, orgId, today, ids);
  const written = await writeScores(q, orgId, today, scores);
  if (gone.length) await q(`DELETE FROM donor_scores WHERE org_id = ? AND donor_id = ANY(?)`, [orgId, gone]);
  return { people: scores.length, written, removed: gone.length };
}

// One person's part rows, as figure rows (id, type, donor_id, name, date,
// amount, detail). Engagement rows carry POINTS in `amount`; generosity money
// parts carry DOLLARS; years and recurring gifts carry 1 each (they are counts).
async function partRows(q, orgId, donorId, today, score, part) {
  const w = await weights();
  if (score === "engagement") {
    const rows = (await touchRows(q, orgId, today, donorId)).filter(r => r.part === part);
    return rows.map(r => ({ id: r.id, type: part, donor_id: donorId, name: w.TOUCH_POINTS[part].label, date: r.date, amount: r.points, detail: r.detail }));
  }
  const { gifts, subs } = await givingRows(q, orgId, donorId);
  const g = (await generosityParts(today, gifts, subs))[part];
  if (!g) return [];
  const money = part === "lifetime" || part === "recent" || part === "upgrade";
  return g.rows.map(r => ({ id: r.id, type: part, donor_id: donorId, name: w.GENEROSITY_PARTS[part].label, date: r.date,
    amount: money ? r.cents / 100 : null, detail: r.detail }));
}

// ── SUGGESTED ASK, from their own gifts only ────────────────────────────────
// PROSPECT-1 — when the caller may see screening results and hands them in
// (`opts.screening`, prospect.js shapeScreening), a capacity range whose low end
// is at least five times their largest gift moves the ask one friendly step up,
// and the sentence says so and names the file. Without screening the ask is
// their own gifts' alone, exactly as before.
//
// WIRE-1 addendum, ONE STORY WITH ROOM TO GIVE. A rising donor's ask steps one
// rung up only when Room to give has something to say (Some or Strong, from
// their own file plus a screening file only when the caller may see it). When
// Room to give is Not yet known the ask stays at their own level and the
// sentence says so. `opts.monthly` sizes a MONTHLY ask instead, from their own
// year (usual gift times their own rhythm, drift.js), never from a one-time
// gift: the ask beside "ask about monthly giving".
async function suggestedAsk(q, orgId, donorId, opts = {}) {
  // NUMBERS-4: the one rule's gifts and inputs (shared/numbers/ask.js): a
  // refund or a credit row never sets "largest".
  const ASK = require("./shared/numbers/ask");
  const rows = await q(ASK.GIFTS_SQL, [orgId, donorId]);
  if (!rows.length) return null;
  const { largestCents, lastThreeCents } = ASK.inputsOf(rows);
  const SA = await ASK.ready;
  if (opts.monthly) {
    const [{ timezone } = {}] = await q(`SELECT timezone FROM orgs WHERE id = ?`, [orgId]);
    const today = require("./orgTime").orgToday({ timezone });
    const a = driftEngine.assessDrift(rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || "")).map(r => ({ date: r.date, amount: Number(r.amount) })), today);
    if (a.cadenceDays > 0 && a.usualGift > 0) {
      const m = SA.monthlyAskCents({ usualGiftCents: cents(a.usualGift), giftsPerYear: 365 / a.cadenceDays,
        cadenceWords: a.seasonal && a.seasonal.kind === "month" ? "once a year" : driftEngine.humanCadence(a.cadenceDays) });
      if (m) return { ...m, largestCents };
    }
  }
  let own = SA.suggestedAskCents({ largestCents, lastThreeCents });
  // NUMBERS-5: held at their own level until Room to give is known, the one
  // rule Home's cards read too (shared/numbers/ask.js).
  if (own && own.rising && !(await ASK.roomKnown(q, orgId, [donorId], new Map([[donorId, opts.screening || null]]))).has(donorId)) {
    own = SA.suggestedAskCents({ largestCents, lastThreeCents, stepUp: false, holdWords: ASK.HOLD_WORDS });
  }
  const s = opts.screening;
  if (!own || !s || s.capacityLowCents == null) return own;
  const RT = await import("./shared/roomToGive.js");
  const range = RT.rangeText(s.capacityLowCents, s.capacityHighCents);
  if (s.capacityLowCents < RT.STRONG_CAPACITY_MULTIPLE * own.largestCents) {
    return { ...own, screening: true, sentence: `${own.sentence} The screening file (${s.provider}, ${s.screenedOn}) puts capacity at ${range}, which does not move the ask.` };
  }
  const up = SA.nextFriendlyAbove ? SA.nextFriendlyAbove(own.askCents) : own.askCents;
  return { ...own, askCents: up, screening: true,
    sentence: `${own.sentence.replace(/: ask \$[\d,.]+(?:, [^.]*)?\.$/, "")}; the screening file (${s.provider}, ${s.screenedOn}) puts capacity at ${range}, so one step up: ask ${RT.dollars(up)}.` };
}

module.exports = { touchRows, givingRows, generosityParts, patternOf, onTimeThrough, closenessNow, scoreOrg, recomputeOrgScores, partRows,
  scorePeople, recomputePeopleScores, pooledWith, storedPopulation, writeScores, suggestedAsk, apportion, pctAtOrBelow, weights, reasonFor };
