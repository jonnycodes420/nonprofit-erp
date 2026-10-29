// NUMBERS-1 · ONE WAY TO COMPUTE EACH NUMBER.
//
// Jonathan added a $25,000 gift to Margaret Chen on prod (21 Oct). Lifetime,
// This year and Last gift moved; Average still said $14,423.08 "of 13 gifts"
// and Largest $15,000, because the header drew those three from a SECOND read
// (GET /donors/:id/status) that not every door refreshes. And the gift counted
// toward GivingTuesday 2026, a campaign that had not started, because no
// campaign total looked at the campaign's dates.
//
// So the rules live here, once:
//   · donorGlance: First, Largest and Average for one person, the same figure
//     sources the drawers open. GET /donors/:id carries them beside Lifetime,
//     so every tile in the header comes from one read and one refresh.
//   · CAMPAIGN_GIFT_MATCH: which gifts count toward a campaign. Attributed by
//     campaign_id (or the legacy name), from a person who is not deleted, and
//     dated inside the campaign's own start and end. A gift dated outside the
//     window keeps its attribution on the row and counts toward nothing.
//   · campaignWindowRefusal: the sentence a write gets when it tries to credit
//     a campaign with a gift dated outside the window.
const FS = require("./figureSources");
const orgTime = require("./orgTime");
const money = require("./money");
const { query } = require("./db");

const { CAMPAIGN_GIFT_MATCH, PUBLIC_BAR_GRANTS, inWindow, campaignWindowRefusal } = require("./campaignMatch");

// First, Largest and Average for one person: each is the figure source its
// drawer opens, so the tile and the rows are one computation. The average also
// says what it leaves out (refunds, an imported total) from the same gifts.
const GLANCE = [
  ["first", "donor-first-gift"],
  ["largest", "donor-largest-gift"],
  ["average", "donor-average-gift"],
];
async function donorGlance(query, orgId, donorId) {
  const src = k => ({ key: k, params: { donor: donorId } });
  const [figs, [r], lifetime] = await Promise.all([
    Promise.all(GLANCE.map(async ([name, key]) => {
      const f = await FS.figure(orgId, src(key), {}, { pageSize: 1 });
      const count = f.measure === "per_gift" ? f.giftCount : f.totalRows;
      return [name, { source: src(key), label: f.label, sentence: f.sentence, value: count ? f.value : null,
        cents: count ? f.cents : null, date: f.rows[0] ? f.rows[0].date : null, count }];
    })),
    query(
      `SELECT (COUNT(*) FILTER (WHERE g.amount < 0))::int AS refunds,
              COALESCE(SUM(g.amount) FILTER (WHERE g.amount < 0), 0)::text AS refunded,
              COALESCE(SUM(g.amount), 0)::text AS itemized
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id = ? AND g.donor_id = ? AND d.deleted_at IS NULL`, [orgId, donorId]),
    FS.figureValue(orgId, src("donor-lifetime"), {}),
  ]);
  // NUMBERS-2: the imported total, its source and the last day it covers.
  const [imp] = await query(
    `SELECT imported_total::text AS t, imported_through, imported_source, imported_on FROM donors
      WHERE org_id = ? AND id = ? AND imported_total IS NOT NULL`, [orgId, donorId]);
  const out = Object.fromEntries(figs);
  const lifetimeCents = lifetime.totalRows ? lifetime.cents : null;
  Object.assign(out.average, {
    refunds: r.refunds,
    refundCents: -(money.toCents(String(r.refunded)) ?? 0),
    importedCents: imp ? (money.toCents(imp.t) ?? 0) : 0,
  });
  // IMPORT-4: gifts with no date count in Lifetime and the average and in no
  // figure for a span of time; the profile says so beside those figures.
  const [ud] = await query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(g.amount), 0)::text AS t
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND g.donor_id = ? AND d.deleted_at IS NULL AND g.date IS NULL`, [orgId, donorId]);
  out.undated = ud && ud.n ? { count: ud.n, cents: money.toCents(ud.t) ?? 0, source: src("donor-undated-gifts"), words: undatedWords(ud.n) } : null;
  out.imported = imp ? { cents: money.toCents(imp.t) ?? 0, through: imp.imported_through, source: imp.imported_source || "your old system",
                         on: imp.imported_on || null, words: importedWords(imp) } : null;
  return out;
}

// "1 gift with no date not counted": said beside every figure for a span of
// time (This year, a goal, retention) when there are undated gifts behind it.
function undatedWords(n) {
  n = Number(n) || 0;
  return n ? `${n.toLocaleString("en-US")} ${n === 1 ? "gift" : "gifts"} with no date not counted` : "";
}

// "Includes $50,000 from your old system (before Mar 2025)": the line under
// Lifetime. "Before <month>" when the covered days end on a month's last day,
// "up to <day>" otherwise, so it never claims days it does not cover.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function importedWords(imp) {
  const cents = money.toCents(String(imp.t ?? imp.cents ?? "0")) ?? 0;
  const t = String(imp.imported_through || imp.through || "").slice(0, 10);
  let when = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, m, d] = t.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    when = d === last ? ` (before ${MON[m % 12]} ${m === 12 ? y + 1 : y})` : ` (up to ${d} ${MON[m - 1]} ${y})`;
  }
  return `Includes ${money.formatCentsPlain(cents)} from your old system${when}`;
}

// Raised and donors per goal'd campaign: gift payments at the full amount the
// donor paid (FIX-49: a covered fee is part of the gift), counted by CAMPAIGN_GIFT_MATCH. Fundraising's cards, the overview's
// roll-up and the checker all read this one query. Rows: { cid, raised, donor_count }.
function campaignGiftTotals(query, orgId) {
  return query(
    `SELECT c.id AS cid,
            COALESCE(SUM(g.amount), 0) AS raised,
            COUNT(DISTINCT g.donor_id) AS donor_count
       FROM campaigns c
       LEFT JOIN gifts g ON g.org_id = c.org_id AND ${CAMPAIGN_GIFT_MATCH("g", "c")}
      WHERE c.org_id = ? AND c.goal_amount IS NOT NULL AND c.goal_amount > 0
      GROUP BY c.id`, [orgId]);
}

// FIX-49 · A PARENT GOAL'S RAISED: the gifts given to it directly plus the
// gifts given to its child goals, each gift once however many of those
// campaigns it matches (Jonathan, 25 Oct). Rows: { pid, raised } for every
// goal'd campaign that has a goal'd child. Grants are added by the caller:
// each grant names one campaign, so they cannot overlap.
// Each gift is matched to its campaigns ONCE, then paired with that campaign
// and with the campaign's parent; UNION keeps one (parent, gift) pair, so a
// gift matching the parent and a child counts once. (The first version asked
// "is this gift in the set?" per gift per parent, and took 74 seconds on the
// demo; this takes as long as campaignGiftTotals.)
function goalRollupGiftTotals(query, orgId) {
  return query(
    `WITH matched AS MATERIALIZED (
            SELECT c.id AS cid, c.parent_goal_id AS parent, g.id AS gid, g.amount
              FROM campaigns c JOIN gifts g ON g.org_id = c.org_id AND ${CAMPAIGN_GIFT_MATCH("g", "c")}
             WHERE c.org_id = ? AND c.goal_amount > 0),
          pairs AS (
            SELECT cid AS pid, gid, amount FROM matched
            UNION
            SELECT parent AS pid, gid, amount FROM matched WHERE parent IS NOT NULL)
     SELECT p.id AS pid, COALESCE(SUM(x.amount), 0) AS raised
       FROM campaigns p
       LEFT JOIN pairs x ON x.pid = p.id
      WHERE p.org_id = ? AND p.goal_amount > 0
        AND EXISTS (SELECT 1 FROM campaigns k WHERE k.org_id = p.org_id AND k.parent_goal_id = p.id AND k.goal_amount > 0)
      GROUP BY p.id`, [orgId, orgId]);
}

// FIX-49 · WHAT A CAMPAIGN'S PUBLIC BAR SAYS: its gifts (CAMPAIGN_GIFT_MATCH)
// plus its awarded grants, unless "Leave grants off the public bar" is on.
// The giving page's bar and the checker read this one function.
async function publicBarRaised(query, orgId, campaignId) {
  const [r] = await query(
    `SELECT COALESCE((SELECT SUM(g.amount) FROM gifts g WHERE g.org_id = c.org_id AND ${CAMPAIGN_GIFT_MATCH("g", "c")}), 0)
            + ${PUBLIC_BAR_GRANTS("c")} AS raised
       FROM campaigns c WHERE c.org_id = ? AND c.id = ?`, [orgId, campaignId]);
  return r ? Number(r.raised) || 0 : null;
}

// HARDEN-1 · ONE "VS LAST YEAR". Home said "Giving this year is $63,984
// behind last year at this point" (the same days last year) while Fundraising
// said "↓ $210,535.51 vs last period" (this year so far against ALL of last
// year): two answers to one question. Every screen that compares giving with
// last year reads this, and its sentence says which days it compares.
//   from, to   the window this year (a running window is cut at today)
//   today      the org's civil today
// The span is orgTime.samePointLastYear, the Board's rule (FIX-3 E); both
// sides are the `gifts` figure source, so each half opens its rows.
function lastYearSpan(from, to, today) {
  const w = orgTime.samePointLastYear(from, to, today);
  if (!w) return null;
  const cur = { from, to: w.through }, prev = { from: w.from, to: w.to };
  return {
    thisSource: { key: "gifts", params: cur },
    lastSource: { key: "gifts", params: prev },
    differenceSource: { key: "giving-difference", params: { ...cur, prevFrom: prev.from, prevTo: prev.to } },
    from: cur.from, to: cur.to, lastFrom: prev.from, lastTo: prev.to,
  };
}
const civilWords = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
async function vsLastYear(orgId, from, to, today) {
  const s = lastYearSpan(from, to, today);
  if (!s) return null;
  const [a, b] = await Promise.all([FS.figureValue(orgId, s.thisSource), FS.figureValue(orgId, s.lastSource)]);
  const thisYear = Number(a.value) || 0, lastYear = Number(b.value) || 0;
  return {
    ...s, thisYear, lastYear, difference: Math.round((thisYear - lastYear) * 100) / 100,
    sentence: `Giving ${civilWords(s.from)} to ${civilWords(s.to)}, against the same days last year, ${civilWords(s.lastFrom)} to ${civilWords(s.lastTo)}.`,
  };
}

// HOME-3 · "RAISED" THE WAY SHE SAYS IT. Allie said the Finding Joy Dinner
// raised $124,290 on Oct 22; the report said $45,340 for October, because it
// counted received gifts only. Both are right, so both are said:
//   "Finding Joy Dinner: $124,290 raised ($45,340 received, $78,950 pledged)"
// raised = received (event-received) + pledged for the event's year
// (event-pledged); installments due in later years are said apart (later).
// The event page, the first look and Reports read this one function, and each
// figure carries the source that opens its rows.
//   opts.ids     only these events
//   opts.from/to only events dated in this window
//   opts.withMoney  leave out events with nothing received or pledged
//   opts.limit   the most recent N
async function eventsRaised(orgId, { ids = null, from = null, to = null, withMoney = false, limit = null } = {}) {
  const args = [orgId];
  let where = "";
  if (ids) { where += " AND e.id = ANY(?)"; args.push(ids); }
  if (from) { where += " AND e.date >= ?::date AND e.date_unknown IS NOT TRUE"; args.push(from); }
  if (to) { where += " AND e.date <= ?::date"; args.push(to); }
  const pledgeSum = later => `(SELECT COALESCE(SUM(i.amount), 0) FROM pledges p
       JOIN pledge_installments i ON i.pledge_id = p.id AND i.org_id = p.org_id
      WHERE p.org_id = e.org_id AND p.event_id = e.id AND ${FS.EVENT_PLEDGE_OPEN("i", "p", "e", later)})::text`;
  const rows = await query(
    `SELECT e.id, e.name, LEFT(e.date::text, 10) AS date, e.date_unknown,
            (SELECT COALESCE(SUM(g.amount), 0) FROM gifts g WHERE g.org_id = e.org_id AND ${FS.EVENT_GIFT_MATCH("g", "e")})::text AS received,
            ${pledgeSum(false)} AS pledged, ${pledgeSum(true)} AS later
       FROM events e WHERE e.org_id = ?${where}
      ORDER BY e.date DESC, e.id`, args);
  const out = rows.map(r => {
    const c = v => money.toCents(String(v)) ?? 0;
    const receivedCents = c(r.received), pledgedCents = c(r.pledged), laterCents = c(r.later);
    const raisedCents = receivedCents + pledgedCents;
    const src = (key, extra) => ({ key, params: { event: r.id, ...(extra || {}) } });
    const m = money.formatCentsPlain;
    return {
      id: r.id, name: r.name, date: r.date_unknown ? null : r.date,
      raised: raisedCents / 100, received: receivedCents / 100, pledged: pledgedCents / 100, later: laterCents / 100,
      raisedCents, receivedCents, pledgedCents, laterCents,
      sources: { raised: src("event-raised"), received: src("event-received"), pledged: src("event-pledged"), later: src("event-pledged", { later: true }) },
      definitions: {
        raised: "What this event raised: every gift received for it, and every unpaid installment pledged at it that falls due within a year of it.",
        received: "Every gift attributed to this event that has been received. A refund comes off.",
        pledged: "Promised at this event and not yet paid, falling due within a year of it. A pledge of so much a year counts its first year here.",
        later: "Installments pledged at this event that fall due in later years. Not counted in what the event raised.",
      },
      words: `${r.name}: ${m(raisedCents)} raised (${m(receivedCents)} received, ${m(pledgedCents)} pledged)`
        + (laterCents ? `, and ${m(laterCents)} more pledged for later years` : ""),
    };
  }).filter(e => !withMoney || e.receivedCents || e.pledgedCents || e.laterCents);
  return limit ? out.slice(0, limit) : out;
}

const EVENT_GUEST_DEFINITIONS = {
  cameNoGift: "Marked as attending, with no gift or pledge tied to this event for them or anyone in their household.",
  cameGave: "Marked as attending, with a gift or pledge tied to this event for them or someone in their household.",
  invitedNoShow: "On the event's list and not marked as attending. Shown once the event's day has passed.",
};
// IMPORT-5 · WHO CAME AND DIDN'T GIVE. One answer for the event page, Home's
// Grow moves, Ask and Atlas. A guest "gave" when a gift (the event's own gift
// match) or a pledge is tied to the event for them or anyone in their
// household: a couple's gift sits on one of the two. "Invited, didn't come" is
// everyone on the list who was not marked as attending, once the event is past.
async function eventGuests(orgId, { ids = null, asOf = null } = {}) {
  const args = [orgId];
  let where = "";
  if (ids) { where = " AND e.id = ANY(?)"; args.push(ids); }
  const rows = await query(
    `SELECT DISTINCT ON (e.id, d.id) e.id AS event_id, e.name AS event_name, LEFT(e.date::text, 10) AS date, e.date_unknown,
            d.id AS donor_id, d.name, a.status,
            ${FS.EVENT_GUEST_GAVE("d", "e")} AS gave
       FROM event_attendees a
       JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id
       JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id AND d.deleted_at IS NULL
      WHERE a.org_id = ? AND a.status <> 'cancelled'${where}
      ORDER BY e.id, d.id, (a.status = 'attended') DESC`, args);
  const byEvent = new Map();
  for (const r of rows) {
    const ev = byEvent.get(r.event_id) || byEvent.set(r.event_id, { id: r.event_id, name: r.event_name, date: r.date_unknown ? null : r.date,
      past: r.date_unknown || !asOf || r.date <= asOf, cameGave: [], cameNoGift: [], invitedNoShow: [] }).get(r.event_id);
    const person = { id: r.donor_id, name: r.name };
    if (r.status === "attended") (r.gave ? ev.cameGave : ev.cameNoGift).push(person);
    else if (ev.past) ev.invitedNoShow.push(person);
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  return [...byEvent.values()].map(ev => {
    for (const k of ["cameGave", "cameNoGift", "invitedNoShow"]) ev[k].sort(byName);
    return { ...ev, definitions: EVENT_GUEST_DEFINITIONS };
  });
}

// FUNDRAISING-2 · THE NIGHT'S STORY: what the event raised (eventsRaised),
// who came, who gave or pledged there, and who came and did not give. The
// event page and Fundraising's lead card read this one function; each count
// opens its people.
async function eventStory(orgId, eventId) {
  const [money] = await eventsRaised(orgId, { ids: [eventId] });
  if (!money) return null;
  const src = key => ({ key, params: { event: eventId } });
  // "Came, didn't give" is IMPORT-5's one answer (event-guests, household-aware).
  const noGift = { key: "event-guests", params: { event: eventId, list: "cameNoGift" } };
  const [attended, gave, cameDidntGive] = await Promise.all(
    [src("event-attended"), src("event-gave"), noGift].map(s => FS.figureValue(orgId, s)));
  const n = f => Number(f.value) || 0;
  return {
    ...money,
    attended: n(attended), gave: n(gave), cameDidntGive: n(cameDidntGive),
    pledgedAll: Math.round((money.pledgedCents + money.laterCents)) / 100, pledgedAllCents: money.pledgedCents + money.laterCents,
    sources: { ...money.sources, pledgedAll: { key: "event-pledged", params: { event: eventId, all: true } }, attended: src("event-attended"), gave: src("event-gave"), cameDidntGive: noGift },
    definitions: {
      ...money.definitions,
      pledgedAll: "Every unpaid installment of an open pledge made at this event, in every year it falls due.",
      attended: "Each person marked as having come to this event.",
      gave: "Each person with a gift for this event or a pledge made at it, once.",
      cameDidntGive: EVENT_GUEST_DEFINITIONS.cameNoGift,
    },
  };
}

// FUNDRAISING-2 · PLEDGES, ONE WAY. What is still to come on open pledges,
// what of it falls due by the end of the fiscal year, and what is already
// past due. Fundraising's Overview, its Pledges view and Home read these three
// figure sources, and a profile's dueThisYear counts to the same day.
//   yearEnd  the last day of this fiscal year (finPeriodBounds(...).end)
//   today    the org's today
async function pledgeSummary(orgId, { yearEnd, today }) {
  const sources = {
    open: { key: "pledges-open", params: {} },
    dueThisYear: { key: "pledges-due", params: { to: yearEnd } },
    overdue: { key: "pledges-overdue", params: { before: today } },
  };
  const [open, due, overdue] = await Promise.all(Object.values(sources).map(s => FS.figureValue(orgId, s)));
  const val = f => Math.round((Number(f.value) || 0) * 100) / 100;
  return {
    open: val(open), dueThisYear: val(due), overdue: val(overdue), yearEnd, today, sources,
    definitions: {
      open: "What is still to come on every open pledge, over all its years. A pledge part-paid counts only the remainder.",
      dueThisYear: "The unpaid installments of open pledges due by the end of this fiscal year, overdue ones included.",
      overdue: "The unpaid installments of open pledges whose due date has passed.",
    },
  };
}

// The screens that live inside a route file register here when the server
// mounts them, so the checker running in the server reads the very function a
// screen draws (scripts/check-numbers.js). Empty in a bare script.
const screens = {};

module.exports = { importedWords, undatedWords, CAMPAIGN_GIFT_MATCH, inWindow, campaignWindowRefusal, donorGlance, campaignGiftTotals, goalRollupGiftTotals, publicBarRaised, lastYearSpan, vsLastYear, eventsRaised, eventGuests, screens, eventStory, pledgeSummary };
