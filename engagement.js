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
// rows: db.js's `query` on the server, an adapter in scripts/seed-demo.js.
//
// The scores are stored in donor_scores (derived data: rebuilt whole for an org
// each time, never edited by a person), so the Donors list can sort by them and
// the profile can show them without recomputing.

const { meetingsSql } = require("./meetings");
const driftEngine = require("./drift");

let W = null;
async function weights() { if (!W) W = await import("./shared/engagementWeights.js"); return W; }

const DAY = 86400000;
const civil = d => (d == null ? null : String(d instanceof Date ? d.toISOString() : d).slice(0, 10));
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
async function touchRows(q, orgId, today, donorId = null) {
  const w = await weights();
  const from = addDays(today, -(w.WINDOW_DAYS - 1));
  const dF = donorId ? " AND d.id = ?" : "";
  const dA = donorId ? [donorId] : [];
  const out = [];
  const push = (part, r, base, detail) => {
    const date = civil(r.date);
    const pts = round2(base * w.recencyWeight(ageDays(today, date)));
    if (pts > 0) out.push({ part, id: String(r.id), donor_id: r.donor_id, date, points: pts, detail });
  };

  // Meetings: the one source (meetings.js), each person on a calendar meeting.
  const m = meetingsSql(orgId, { from, to: today, eachPerson: true });
  const mRows = await q(
    `SELECT m.id, m.donor_id, m.date, m.kind, m.title FROM (${m.sql}) m JOIN donors d ON d.id = m.donor_id AND d.org_id = ?
      WHERE d.deleted_at IS NULL${dF}`, [...m.args, orgId, ...dA]);
  for (const r of mRows) push("meetings", r, w.TOUCH_POINTS.meetings.points, r.kind === "calendar" ? `Calendar: ${r.title || "Meeting"}` : "Meeting, logged");

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
async function givingRows(q, orgId, donorId = null) {
  const dF = donorId ? " AND d.id = ?" : "";
  const dA = donorId ? [donorId] : [];
  const gifts = (await q(
    `SELECT g.id, g.donor_id, LEFT(g.date, 10) AS date, g.amount::text AS amount FROM gifts g
       JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date IS NOT NULL AND g.date <> ''${dF}`, [orgId, ...dA]))
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
  for (const g of gifts) { const y = Number(g.date.slice(0, 4)); if (y > Y - w.CONSISTENCY_YEARS && y <= Y) byYear.set(y, (byYear.get(y) || 0) + g.cents); }
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
  const say = x => `${x.n} ${x.n === 1 ? w.TOUCH_POINTS[x.k].one : w.TOUCH_POINTS[x.k].many}`;
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
function patternOf(gifts, today) {
  const a = driftEngine.assessDrift(gifts.filter(g => g.cents > 0).map(g => ({ date: g.date, amount: g.cents / 100 })), today);
  if (a.state === "ok") return "on_track";
  if (a.state === "drifting" || a.state === "lapsed") return a.state;
  return null;
}

// ── THE COMPUTE ─────────────────────────────────────────────────────────────
// Every person in the org, both scores, parts that add to each score.
async function scoreOrg(q, orgId, today) {
  const w = await weights();
  const people = (await q(`SELECT id FROM donors WHERE org_id = ? AND deleted_at IS NULL`, [orgId])).map(r => r.id);
  const touches = await touchRows(q, orgId, today);
  const { gifts, subs } = await givingRows(q, orgId);
  const tBy = new Map(), gBy = new Map(), sBy = new Map();
  for (const t of touches) (tBy.get(t.donor_id) || tBy.set(t.donor_id, []).get(t.donor_id)).push(t);
  for (const g of gifts) (gBy.get(g.donor_id) || gBy.set(g.donor_id, []).get(g.donor_id)).push(g);
  for (const s of subs) (sBy.get(s.donor_id) || sBy.set(s.donor_id, []).get(s.donor_id)).push(s);

  const per = new Map();
  for (const id of people) {
    const ts = tBy.get(id) || [];
    const byPart = Object.fromEntries(w.ENGAGEMENT_PARTS.map(k => [k, { raw: 0, count: 0 }]));
    for (const t of ts) { byPart[t.part].raw = round2(byPart[t.part].raw + t.points); byPart[t.part].count++; }
    const engRaw = round2(ts.reduce((s, t) => s + t.points, 0));
    const gen = await generosityParts(today, gBy.get(id) || [], sBy.get(id) || []);
    per.set(id, { byPart, engRaw, gen, lastTouch: ts[0] ? ts[0].date : null, pattern: patternOf(gBy.get(id) || [], today) });
  }
  const engPop = [...per.values()].map(p => p.engRaw).filter(v => v > 0).sort((a, b) => a - b);
  const givers = [...per.values()].filter(p => p.gen.lifetime.raw > 0);
  const genPop = Object.fromEntries(Object.keys(w.GENEROSITY_PARTS).map(k => [k, givers.map(p => p.gen[k].raw).sort((a, b) => a - b)]));

  const out = [];
  for (const [id, p] of per) {
    const engagement = p.engRaw > 0 ? Math.max(1, Math.round(pctAtOrBelow(p.engRaw, engPop))) : 0;
    const engPts = apportion(engagement, w.ENGAGEMENT_PARTS.map(k => p.byPart[k].raw));
    const genKeys = Object.keys(w.GENEROSITY_PARTS);
    const giver = p.gen.lifetime.raw > 0;
    const pcts = genKeys.map(k => (giver ? pctAtOrBelow(p.gen[k].raw, genPop[k]) : 0));
    const contrib = genKeys.map((k, i) => w.GENEROSITY_PARTS[k].weight * pcts[i]);
    const generosity = giver ? Math.max(1, Math.round(contrib.reduce((s, x) => s + x, 0))) : 0;
    const genPts = apportion(generosity, contrib);
    out.push({
      donorId: id, engagement, generosity, band: w.bandFor(engagement).key, pattern: p.pattern,
      reason: reasonOf(w, p.byPart, p.lastTouch, today), lastTouch: p.lastTouch,
      parts: {
        engagement: w.ENGAGEMENT_PARTS.map((k, i) => ({ key: k, points: engPts[i], raw: p.byPart[k].raw, count: p.byPart[k].count })),
        generosity: genKeys.map((k, i) => ({ key: k, points: genPts[i], raw: p.gen[k].raw, pct: Math.round(pcts[i]), count: p.gen[k].rows.length })),
      },
    });
  }
  return out;
}

// Compute and store. The org's rows are replaced as one set, so a donor's
// number is never compared against a half-updated population.
async function recomputeOrgScores(q, orgId, today) {
  const scores = await scoreOrg(q, orgId, today);
  await q(`DELETE FROM donor_scores WHERE org_id = ?`, [orgId]);
  for (let i = 0; i < scores.length; i += 500) {
    const chunk = scores.slice(i, i + 500);
    await q(
      `INSERT INTO donor_scores (org_id, donor_id, engagement, generosity, band, pattern, reason, last_touch, parts, computed_for, computed_at, created_by, created_by_name)
       SELECT ?, x.donor_id, x.engagement, x.generosity, x.band, x.pattern, x.reason, x.last_touch, x.parts::jsonb, ?, NOW(), 'system:engagement', 'Steward (scores)'
         FROM jsonb_to_recordset(?::jsonb) AS x(donor_id text, engagement int, generosity int, band text, pattern text, reason text, last_touch text, parts text)`,
      [orgId, today, JSON.stringify(chunk.map(s => ({ donor_id: s.donorId, engagement: s.engagement, generosity: s.generosity,
        band: s.band, pattern: s.pattern, reason: s.reason, last_touch: s.lastTouch, parts: JSON.stringify(s.parts) })))]);
  }
  return scores.length;
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
  const rows = await q(
    `SELECT LEFT(g.date, 10) AS date, g.amount::text AS amount FROM gifts g WHERE g.org_id = ? AND g.donor_id = ? AND g.amount > 0
      ORDER BY g.date DESC NULLS LAST, g.id DESC`, [orgId, donorId]);
  if (!rows.length) return null;
  const all = rows.map(r => cents(r.amount));
  const SA = await import("./shared/smartAmounts.js");
  if (opts.monthly) {
    const [{ timezone } = {}] = await q(`SELECT timezone FROM orgs WHERE id = ?`, [orgId]);
    const today = require("./orgTime").orgToday({ timezone });
    const a = driftEngine.assessDrift(rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || "")).map(r => ({ date: r.date, amount: Number(r.amount) })), today);
    if (a.cadenceDays > 0 && a.usualGift > 0) {
      const m = SA.monthlyAskCents({ usualGiftCents: cents(a.usualGift), giftsPerYear: 365 / a.cadenceDays,
        cadenceWords: a.seasonal && a.seasonal.kind === "month" ? "once a year" : driftEngine.humanCadence(a.cadenceDays) });
      if (m) return { ...m, largestCents: Math.max(...all) };
    }
  }
  let own = SA.suggestedAskCents({ largestCents: Math.max(...all), lastThreeCents: all.slice(0, 3) });
  if (own && own.rising) {
    const P = require("./prospect");
    const RT = await import("./shared/roomToGive.js");
    const f = (await P.loadFacts(orgId, [donorId], q)).get(donorId);
    const word = f ? RT.assess({ ...f, screening: opts.screening || null }).word : "unknown";
    if (word === "unknown") {
      own = SA.suggestedAskCents({ largestCents: Math.max(...all), lastThreeCents: all.slice(0, 3), stepUp: false,
        holdWords: "their own level, because Room to give is not yet known" });
    }
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

module.exports = { touchRows, givingRows, generosityParts, patternOf, scoreOrg, recomputeOrgScores, partRows, suggestedAsk, apportion, pctAtOrBelow, weights, reasonFor };
