// routes/homeLead.js · HOME-2. The lead slot at the top of Home.
//
//   GET  /home/lead            what leads Home for the person signed in, why,
//                              the Today rail's order, and whether Why and
//                              What have anything to say today
//   POST /home/lead/dismiss    "Not now" on one card ({ kind, key })
//
// This file READS the facts and shared/homeLead.js decides. A director (an
// admin) sees the org; anyone else sees their own portfolio first: the people
// assigned to them, and their own calendar. Calendars are always one person's.
//
// "Not now" hides that card for the rest of the day, and after three of one
// kind that kind ranks at half for that person only (home_lead_dismissals).
//
// TEST_MODE only: `?at=<instant>` reads as of that moment, so one suite can
// prove a Tuesday, the morning after a gift and 15 December without three
// servers. Everywhere else `at` is ignored.
"use strict";
const express = require("express");
const inProcess = require("../inProcess");
const { NOT_DELETED } = require("../campaignMatch");   // FIX-52: a deleted person's money is nobody's

const routers = { r0: express.Router() };

function mount(ctx) {
const { query, run, wrap, requireAuth, checkWriteAccess, actor, orgTz, orgToday, orgTime, testMode, uuid, meetingBrief } = ctx;
const app = routers.r0;

const num = v => Number(v) || 0;

function scopeOf(req) {
  return req.user.role === "admin" ? { role: "director", userId: req.user.userId } : { role: "officer", userId: req.user.userId };
}

// The org's own "large": p90 of lifetime giving, the line threadRank uses.
async function orgLine(orgId) {
  const [r] = await query(`SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY total_giving) AS p90 FROM donors
                            WHERE org_id=? AND total_giving > 0 AND deleted_at IS NULL`, [orgId]);
  return num(r && r.p90);
}

// A donor filter for a person's portfolio: `assigned_to = me` for an officer,
// nothing for a director. Returns [sql, args] to splice after a donors alias.
const mine = (scope, alias = "d") => scope.role === "officer" ? [` AND ${alias}.assigned_to = ?`, [scope.userId]] : ["", []];

function whenWords(tz, nowMs, atIso) {
  const today = orgTime.orgToday({ timezone: tz }, new Date(nowMs));
  const day = orgTime.orgToday({ timezone: tz }, new Date(atIso));
  const hm = new Date(atIso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s+/g, " ");
  const hour = Number(new Date(atIso).toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false }));
  if (day === today) return hour < 12 ? `this morning at ${hm}` : `today at ${hm}`;
  if (day === orgTime.addDays(today, -1)) return hour >= 18 ? `${hm} last night` : `yesterday at ${hm}`;
  return `on ${new Date(atIso).toLocaleDateString("en-US", { timeZone: tz, month: "long", day: "numeric" })}`;
}

async function readFacts(req, nowMs) {
  const orgId = req.user.orgId, scope = scopeOf(req);
  const org = await orgTz(orgId);
  const tz = org.timezone || "America/New_York";
  const nowIso = new Date(nowMs).toISOString();
  const today = orgToday(org, new Date(nowMs));   // ORG_TZ_SEAM_OK
  const line = await orgLine(orgId);
  const [M, Ma] = mine(scope);

  // ── Meetings: the rest of today on this person's own calendar, with a person.
  const dayEnd = orgTime.localToInstant(`${orgTime.addDays(today, 1)}T00:00`, tz).toISOString();
  const cal = await query(`SELECT id, title, starts_at, location, person_ids FROM calendar_events
                            WHERE org_id=? AND owner_user_id=? AND dismissed_at IS NULL AND starts_at > ? AND starts_at < ?
                              AND cardinality(person_ids) > 0 ORDER BY starts_at LIMIT 3`, [orgId, scope.userId, nowIso, dayEnd]);
  const meetings = [];
  for (const c of cal) {
    const [p] = await query(`SELECT id, name FROM donors WHERE org_id=? AND id=? AND deleted_at IS NULL`, [orgId, c.person_ids[0]]);
    if (!p) continue;
    // A brief that cannot be read leaves the card without its lines, never Home without its lead.
    const brief = meetingBrief ? await Promise.resolve().then(() => meetingBrief(orgId, p.id, new Date(c.starts_at).toISOString())).catch(() => null) : null;
    meetings.push({ id: c.id, title: c.title, startsAt: new Date(c.starts_at).toISOString(), location: c.location || null,
      time: new Date(c.starts_at).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s+/g, " "),
      person: { id: p.id, name: p.name }, brief });
  }

  // ── A gift that arrived in the last 36 hours, live (not from a file), not thanked.
  const since = new Date(nowMs - 36 * 3600e3).toISOString();
  const giftRows = await query(
    `SELECT g.id, g.donor_id, g.amount, g.date, g.received_at, g.created_at, d.name,
            (SELECT MAX(p.amount) FROM gifts p WHERE p.org_id=g.org_id AND p.donor_id=g.donor_id AND p.id<>g.id AND p.date <= g.date) AS prior_max,
            (SELECT COUNT(*) FROM gifts p WHERE p.org_id=g.org_id AND p.donor_id=g.donor_id AND p.id<>g.id AND p.date <= g.date)::int AS prior_count,
            t.id AS draft_id, t.body AS draft
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
       LEFT JOIN thank_you_drafts t ON t.org_id=g.org_id AND t.gift_id=g.id AND t.sent_at IS NULL AND t.skipped_at IS NULL
      WHERE g.org_id=? AND g.import_id IS NULL AND g.is_sample IS NOT TRUE AND g.amount > 0
        AND COALESCE(g.acknowledgement_sent,false)=false AND g.thanked_at IS NULL
        AND COALESCE(g.received_at, g.created_at) > ? AND COALESCE(g.received_at, g.created_at) <= ?
        AND g.date >= ? AND g.date <= ?
        AND COALESCE(g.created_by,'') <> ?
        AND d.deleted_at IS NULL${M}
      ORDER BY g.amount DESC LIMIT 3`, [orgId, since, nowIso, orgTime.addDays(today, -1), today, scope.userId, ...Ma]);
  // When it arrived: its own arrival time when it has one (a webhook, a
  // capture), its write time when that is on its own date, else just the day.
  const civil = d => (d instanceof Date ? orgToday(org, d) : String(d).slice(0, 10));   // ORG_TZ_SEAM_OK
  const arrivedWords = g => {
    const at = g.received_at || (g.created_at && civil(g.created_at) === civil(g.date) ? g.created_at : null);
    if (at) return whenWords(tz, nowMs, new Date(at).toISOString());
    const day = civil(g.date);
    return day === today ? "today" : day === orgTime.addDays(today, -1) ? "yesterday" : `on ${day}`;
  };
  const gifts = giftRows.map(g => ({ giftId: g.id, donorId: g.donor_id, donorName: g.name, amount: num(g.amount),
    priorMax: num(g.prior_max), priorCount: num(g.prior_count), when: arrivedWords(g),
    draftId: g.draft_id || null, draft: g.draft ? String(g.draft).slice(0, 220) : null }));

  // ── To confirm: money cards waiting (CAPTURE-1). A director sees them all;
  // an officer sees the ones whose person is theirs.
  const capRows = await query(
    `SELECT c.kind, c.source, (c.proposal->'amount'->>'cents')::bigint AS cents, COALESCE(c.donor_id, c.proposal->'donor'->>'id') AS donor_id,
            COALESCE(d.name, c.proposal->'donor'->>'name') AS donor_name
       FROM capture_items c LEFT JOIN donors d ON d.org_id=c.org_id AND d.id=COALESCE(c.donor_id, c.proposal->'donor'->>'id')
      WHERE c.org_id=? AND c.status='waiting' AND c.stakes='money' AND COALESCE(c.received_at, c.created_at) <= ?
        ${scope.role === "officer" ? "AND d.assigned_to = ?" : ""}
      ORDER BY cents DESC NULLS LAST`, [orgId, nowIso, ...(scope.role === "officer" ? [scope.userId] : [])]);
  let toConfirm = null;
  if (capRows.length) {
    const byKind = {};
    for (const c of capRows) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    const words = { check: ["check photographed", "checks photographed"], pledge: ["pledge form", "pledge forms"], daf_grant: ["grant letter from a donor-advised fund", "grant letters from donor-advised funds"] };
    const from = Object.entries(byKind).map(([k, n]) => `${n} ${(words[k] || [k.replace(/_/g, " "), k.replace(/_/g, " ") + "s"])[n === 1 ? 0 : 1]}`);
    toConfirm = { count: capRows.length, cents: capRows.reduce((s, c) => s + num(c.cents), 0),
      from: from.length > 1 ? from.slice(0, -1).join(", ") + " and " + from.slice(-1) : from[0],
      lines: capRows.slice(0, 2).map(c => ({ label: `${(words[c.kind] || [c.kind])[0].split(" ")[0].replace(/^./, x => x.toUpperCase())} · ${c.donor_name || "not matched yet"}`, amount: num(c.cents) / 100 })),
      more: capRows.length > 2 ? { count: capRows.length - 2, amount: capRows.slice(2).reduce((s, c) => s + num(c.cents), 0) / 100 } : null };
  }

  // ── Drift: the one definition, read through its own route as this person.
  let drift = [], driftCount = 0;
  const dr = await inProcess.get("/drift", { headers: req.headers }).catch(() => null);
  if (dr && dr.status === 200) {
    const body = JSON.parse(dr.body);
    const list = (body.list || []).filter(r => r.confidence === "high" && !r.meetingSet && (scope.role !== "officer" || r.assignedTo === scope.userId));
    drift = list.slice(0, 1).map(r => ({ donorId: r.donorId, donorName: r.donorName, reason: r.reason, usualGift: num(r.usualGift) }));
    driftCount = list.length;
  }

  // ── A failed monthly card.
  const failedCards = (await query(
    `SELECT s.id, s.donor_id, s.amount, s.interval, COALESCE(s.dunning_step,0) AS step, d.name FROM recurring_subscriptions s
       JOIN donors d ON d.id=s.donor_id AND d.org_id=s.org_id
      WHERE s.org_id=? AND s.status IN ('past_due','recovering') AND d.deleted_at IS NULL${M}
      ORDER BY s.amount DESC LIMIT 1`, [orgId, ...Ma]))
    .map(s => ({ subId: s.id, donorId: s.donor_id, donorName: s.name, amount: num(s.amount), interval: s.interval || "month", dunningStep: num(s.step) }));

  // ── The season: November and December, a year-end campaign with a goal.
  let season = null;
  const month = Number(today.slice(5, 7));
  if (month >= 11) {
    const [c] = await query(
      `SELECT id, name, goal_amount, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date FROM campaigns
        WHERE org_id=? AND status='active' AND goal_amount > 0 AND end_date >= ? AND end_date <= ?
          AND (name ~* 'year[- ]{0,1}end' OR to_char(end_date::date,'MM-DD')='12-31')
        ORDER BY (name ~* 'year[- ]{0,1}end') DESC, end_date, goal_amount DESC LIMIT 1`, [orgId, today, orgTime.addDays(today, 60)]);
    if (c) {
      const end = String(c.end_date).slice(0, 10), start = String(c.start_date || `${today.slice(0, 4)}-11-01`).slice(0, 10);
      const lastYear = d => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
      // Raised is the campaign's own gifts; the comparison is like for like:
      // everything given since the season began, this year against the same
      // days last year.
      // HARDEN-1: the season against the same days last year is the one
      // comparison every screen reads (numbers.vsLastYear).
      const [[r], vs, [lyAll]] = await Promise.all([
        query(`SELECT COALESCE(SUM(amount),0) AS n FROM gifts g WHERE g.org_id=? AND ${NOT_DELETED("g")} AND campaign_id=? AND date <= ?`, [orgId, c.id, today]),
        require("../numbers").vsLastYear(orgId, start, end, today),
        query(`SELECT COALESCE(SUM(amount),0) AS n FROM gifts g WHERE g.org_id=? AND ${NOT_DELETED("g")} AND date >= ? AND date <= ?`, [orgId, lastYear(start), lastYear(end)]),
      ]);
      const ly = { n: vs ? vs.lastYear : 0 }, ty = { n: vs ? vs.thisYear : 0 };
      const y = Number(today.slice(0, 4)) - 1;
      const lapsedRows = await query(
        `SELECT d.id, d.name, SUM(g.amount) AS amount FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
          WHERE g.org_id=? AND g.date >= ? AND g.date <= ? AND d.deleted_at IS NULL AND d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE${M}
            AND NOT EXISTS (SELECT 1 FROM gifts n WHERE n.org_id=g.org_id AND n.donor_id=g.donor_id AND n.date >= ? AND n.date <= ?)
          GROUP BY d.id, d.name ORDER BY SUM(g.amount) DESC, d.id`, [orgId, `${y}-12-01`, `${y}-12-31`, ...Ma, `${y + 1}-01-01`, today]);
      const after = num(lyAll.n) - num(ly.n);
      season = {
        campaignId: c.id, label: c.name, goal: num(c.goal_amount), raised: num(r.n), seasonThisYear: num(ty.n), lastYearByToday: num(ly.n),
        since: new Date(start + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }),
        daysLeft: orgTime.daysBetween(today, end), lapsedSeason: "December",
        shareLine: num(lyAll.n) > 0 && after > 0 ? `Last year ${Math.round((after / num(lyAll.n)) * 100)}% of this season's giving came after ${new Date(lastYear(today) + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}.` : null,
        lapsed: { count: lapsedRows.length, total: lapsedRows.reduce((s, x) => s + num(x.amount), 0),
          top: lapsedRows.slice(0, 3).map(x => ({ donorId: x.id, name: x.name, amount: num(x.amount) })) },
      };
    }
  }

  // ── An event in the next seven days.
  const events = (await query(
    `SELECT e.id, e.name, to_char(e.date,'YYYY-MM-DD') AS date, e.capacity,
            COALESCE((SELECT SUM(COALESCE(a.quantity,1)) FROM event_attendees a WHERE a.event_id=e.id AND a.org_id=e.org_id AND ${NOT_DELETED("a")} AND a.status IN ('registered','confirmed','attended')),0)::int AS guests,
            COALESCE((SELECT COUNT(*) FROM event_attendees a WHERE a.event_id=e.id AND a.org_id=e.org_id AND ${NOT_DELETED("a")} AND a.status IN ('registered','confirmed') AND COALESCE(a.gift_amount,0) > 0 AND a.registration_gift_id IS NULL),0)::int AS unpaid,
            COALESCE((SELECT SUM(a.gift_amount) FROM event_attendees a WHERE a.event_id=e.id AND a.org_id=e.org_id AND ${NOT_DELETED("a")} AND a.status IN ('registered','confirmed') AND COALESCE(a.gift_amount,0) > 0 AND a.registration_gift_id IS NULL),0) AS unpaid_amount
       FROM events e WHERE e.org_id=? AND e.is_sample IS NOT TRUE AND COALESCE(e.status,'') NOT IN ('cancelled','canceled','completed')
        AND e.date >= ? AND e.date <= ? ORDER BY e.date LIMIT 1`, [orgId, today, orgTime.addDays(today, 7)]))
    .map(e => ({ id: e.id, name: e.name, capacity: num(e.capacity) || null, guests: num(e.guests), unpaid: num(e.unpaid), unpaidAmount: num(e.unpaid_amount),
      daysAway: orgTime.daysBetween(today, String(e.date).slice(0, 10)),
      dayName: new Date(String(e.date).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) }));

  // ── A quiet day: three people worth a note, the largest givers of the last
  // two years nobody has been in touch with for three months.
  const quiet = (await query(
    `SELECT d.id, d.name FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL AND d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE AND d.total_giving > 0${M}
        AND d.last_gift_date >= ?
        AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.org_id=d.org_id AND i.donor_id=d.id AND i.date >= ?)
      ORDER BY d.total_giving DESC, d.id LIMIT 3`, [orgId, ...Ma, orgTime.addDays(today, -730), orgTime.addDays(today, -90)]))
    .map(d => ({ donorId: d.id, name: d.name }));

  // ── Why and What: this year against the same point last year.
  let compare = null;
  if (season) compare = { label: `Giving since ${season.since}`, thisYear: season.seasonThisYear, lastYear: season.lastYearByToday, question: { why: "Why is year-end giving behind last year?", what: "What is working in year-end giving?" } };
  else {
    // NUMBERS-2: "this year" is the org's own fiscal year (orgTz carries its start month).
    // HARDEN-1: against the same days last year, through the one computation
    // Fundraising and the Board read (numbers.vsLastYear), so the three agree.
    const fy = orgTime.orgPeriodBounds(org, "fiscal_year", 0, new Date(nowMs));   // ORG_TZ_SEAM_OK
    const vs = await require("../numbers").vsLastYear(orgId, fy.start, fy.end, today);
    compare = vs ? { label: "Giving this year", question: { why: "Why is giving behind last year?", what: "What is working this year?" }, thisYear: vs.thisYear, lastYear: vs.lastYear,
      span: { from: vs.from, to: vs.to, lastFrom: vs.lastFrom, lastTo: vs.lastTo }, source: vs.differenceSource } : null;
  }

  // ── Dismissals: this person's "Not now"s.
  const dRows = await query(`SELECT kind, card_key, created_at FROM home_lead_dismissals WHERE org_id=? AND user_id=? AND created_at > ?`,
    [orgId, scope.userId, new Date(nowMs - 90 * 864e5).toISOString()]);
  const dismissals = {}, hiddenToday = new Set();
  for (const r of dRows) {
    dismissals[r.kind] = (dismissals[r.kind] || 0) + 1;
    if (orgToday(org, new Date(r.created_at)) === today) hiddenToday.add(r.card_key);   // ORG_TZ_SEAM_OK
  }

  return { now: nowIso, today, line, role: scope.role, meetings, gifts, toConfirm, drift, driftCount, failedCards, season, events, quiet, compare, dismissals, hiddenToday };
}

app.get("/home/lead", requireAuth, wrap(async (req, res) => {
  let nowMs = Date.now();
  if (testMode() && req.query.at) { const t = Date.parse(String(req.query.at)); if (Number.isFinite(t)) nowMs = t; }
  const facts = await readFacts(req, nowMs);
  const HL = await import("../shared/homeLead.js");
  const out = HL.rankLead(facts);
  // A card set aside today stays aside today; the next one up takes its place.
  if (facts.hiddenToday.size) {
    const left = out.ranked.filter(c => !facts.hiddenToday.has(c.key) && c.score >= HL.LEAD_FLOOR);
    const keep = left.filter((c, i) => left.findIndex(x => x.kind === c.kind) === i).slice(0, 2);
    out.lead = keep.length ? keep : HL.rankLead({ ...facts, meetings: [], gifts: [], toConfirm: null, drift: [], failedCards: [], season: null, events: [] }).lead;
  }
  const screen = HL.forScreen(out);
  // TEST_MODE: the order of every candidate, so a suite can see a rank move.
  if (testMode() && req.query.explain) screen.ranked = out.ranked.map(c => ({ kind: c.kind, key: c.key, score: c.score }));
  res.json({ role: facts.role, today: facts.today, ...screen });
}));

app.post("/home/lead/dismiss", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const HL = await import("../shared/homeLead.js");
  const kind = String((req.body || {}).kind || ""), key = String((req.body || {}).key || "").slice(0, 200);
  if (!HL.KINDS.includes(kind) || kind === "quiet" || !key) return res.status(400).json({ error: "bad_card", message: "That card can't be set aside." });
  const a = actor(req);
  await run(`INSERT INTO home_lead_dismissals (id, org_id, user_id, kind, card_key, created_by, created_by_name) VALUES (?,?,?,?,?,?,?)`,
    ["hld_" + uuid().slice(0, 12), req.user.orgId, req.user.userId, kind, key, a.id, a.name]);
  res.json({ ok: true });
}));
}

module.exports = { routers, mount };
