// server/admin/sales/scoreboard.js · SALES-2 item 11. THE SCOREBOARD.
//
// Weekly activity against goals Jonathan sets (defaults: 50 dials, 8 conversations, 3 meetings
// booked a week), this week and the 8 before it, in Jonathan's weeks (Monday to Sunday, New
// York). Every number is a list of rows, and every number opens them (rows()).
//   dials            calls logged, by when they were made
//   connects         calls ending Connected – not now, Connected – interested, or Meeting booked
//   meetings booked  meetings logged, by when they were BOOKED (written)
//   meetings held    meetings whose time fell in the week and has passed
//   deals won        deals that reached a won stage in the week
//   MRR added        the monthly value of those deals
// Conversion runs step to step over the nine weeks. By source: the deals made in the nine
// weeks, by their source. By list: the calls made from each prospect list.
//
// build(facts, now, tz, goals) is pure; load() reads its facts in a fixed number of statements.
//
// THE PLANTED DEFECT (SALES2_PLANT=scoreweek on the server, tests only): weeks are cut in UTC, so
// a call made at 9 PM on a Sunday in New York counts in the next week. tests/sales2-inbound.test.js §11.
"use strict";
const { civil, addDays } = require("./today");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES2_PLANT || "" : "";
const TZ = "America/New_York";
const WEEKS = 9;
const DEFAULT_GOALS = { dials: 50, connects: 8, meetingsBooked: 3 };
const CONNECT = ["not_now", "interested", "meeting_booked"];
const METRICS = ["dials", "connects", "meetingsBooked", "meetingsHeld", "dealsWon", "mrrAdded"];
const SENTENCES = {
  dials: "Calls logged in the week (Monday to Sunday, New York), by when they were made.",
  connects: "Calls that ended Connected – not now, Connected – interested, or Meeting booked.",
  meetingsBooked: "Meetings logged in the week, counted on the day they were booked.",
  meetingsHeld: "Meetings whose time fell in the week and has passed.",
  dealsWon: "Deals that reached a won stage in the week.",
  mrrAdded: "The monthly value of the deals won in the week.",
  conversion: "Each step over the one before it, across the nine weeks shown.",
  bySource: "Deals made in the nine weeks, by their source: how many, how many had a meeting, how many were won.",
  byList: "Calls made from each prospect list in the nine weeks: dials, connects, and meetings booked on the call.",
};

const weekStart = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const dayIn = (t, tz) => civil(t, PLANT === "scoreweek" ? "UTC" : tz);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

function cleanGoals(g) {
  const out = {};
  for (const k of Object.keys(DEFAULT_GOALS)) { const n = Math.round(Number(g && g[k])); out[k] = Number.isFinite(n) && n >= 0 && n <= 10000 ? n : DEFAULT_GOALS[k]; }
  return out;
}

// facts: { calls: [{ id, at, outcome, list_id }], meetings: [{ id, at, created_at }], deals: [{ id, source, created_at, won_at, value_cents, met }], lists: [{ id, name }] }
function build(facts, now, tz = TZ, goals = DEFAULT_GOALS) {
  const thisWeek = weekStart(dayIn(now, tz));
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(thisWeek, -7 * (WEEKS - 1 - i)));
  const first = weeks[0];
  const cell = () => ({ ids: [], n: 0 });
  const by = Object.fromEntries(weeks.map(w => [w, Object.fromEntries(METRICS.map(m => [m, cell()]))]));
  const put = (w, m, id, n = 1) => { if (!by[w]) return; by[w][m].ids.push(id); by[w][m].n += n; };
  for (const c of facts.calls || []) {
    const w = weekStart(dayIn(c.at, tz));
    put(w, "dials", c.id);
    if (CONNECT.includes(c.outcome)) put(w, "connects", c.id);
  }
  for (const m of facts.meetings || []) {
    put(weekStart(dayIn(m.created_at, tz)), "meetingsBooked", m.id);
    if (new Date(m.at).getTime() <= now) put(weekStart(dayIn(m.at, tz)), "meetingsHeld", m.id);
  }
  for (const d of facts.deals || []) if (d.won_at) { const w = weekStart(dayIn(d.won_at, tz)); put(w, "dealsWon", d.id); put(w, "mrrAdded", d.id, Number(d.value_cents || 0)); }
  const total = m => weeks.reduce((n, w) => n + by[w][m].n, 0);
  const conversion = [["dials", "connects"], ["connects", "meetingsBooked"], ["meetingsBooked", "meetingsHeld"], ["meetingsHeld", "dealsWon"]]
    .map(([a, b]) => ({ from: a, to: b, fromN: total(a), toN: total(b), pct: pct(total(b), total(a)) }));
  const inWindow = t => t && dayIn(t, tz) >= first;
  const sources = new Map();
  for (const d of (facts.deals || []).filter(x => inWindow(x.created_at))) {
    const k = d.source || "(no source)";
    const s = sources.get(k) || { key: k, deals: [], met: [], won: [] };
    s.deals.push(d.id); if (d.met) s.met.push(d.id); if (d.won_at) s.won.push(d.id);
    sources.set(k, s);
  }
  const listName = new Map((facts.lists || []).map(l => [l.id, l.name]));
  const lists = new Map();
  for (const c of (facts.calls || []).filter(x => x.list_id && inWindow(x.at))) {
    const s = lists.get(c.list_id) || { key: c.list_id, name: listName.get(c.list_id) || "(a deleted list)", dials: [], connects: [], meetings: [] };
    s.dials.push(c.id); if (CONNECT.includes(c.outcome)) s.connects.push(c.id); if (c.outcome === "meeting_booked") s.meetings.push(c.id);
    lists.set(c.list_id, s);
  }
  return {
    thisWeek, weeks: weeks.map(w => ({ week: w, to: addDays(w, 6), ...Object.fromEntries(METRICS.map(m => [m, by[w][m]])) })).reverse(),
    goals: cleanGoals(goals), conversion,
    bySource: [...sources.values()].sort((a, b) => b.deals.length - a.deals.length).map(s => ({ ...s, meetingPct: pct(s.met.length, s.deals.length), wonPct: pct(s.won.length, s.deals.length) })),
    byList: [...lists.values()].sort((a, b) => b.dials.length - a.dials.length).map(s => ({ ...s, connectPct: pct(s.connects.length, s.dials.length), meetingPct: pct(s.meetings.length, s.dials.length) })),
    sentences: SENTENCES,
  };
}

async function load(query, now = Date.now()) {
  const since = new Date(now - (WEEKS * 7 + 2) * 86400000).toISOString();
  const [calls, meetings, deals, lists, goals] = await Promise.all([
    query(`SELECT id, at, outcome, list_id FROM sales_activities WHERE kind = 'call' AND deleted_at IS NULL AND at > ?`, [since]),
    query(`SELECT id, at, created_at FROM sales_activities WHERE kind = 'meeting' AND deleted_at IS NULL AND (created_at > ? OR at > ?)`, [since, since]),
    query(`SELECT d.id, d.source, d.created_at, d.won_at, d.value_cents,
                  EXISTS (SELECT 1 FROM sales_activity_links l JOIN sales_activities a ON a.id = l.activity_id AND a.kind = 'meeting' AND a.deleted_at IS NULL
                           WHERE l.record_type = 'deal' AND l.record_id = d.id) AS met
             FROM sales_deals d WHERE d.deleted_at IS NULL AND (d.created_at > ? OR d.won_at > ?)`, [since, since]),
    query(`SELECT id, name FROM sales_lists`),
    query(`SELECT value FROM sales_settings WHERE key = 'scoreboard_goals'`),
  ]);
  return { calls, meetings, deals, lists, goals: goals[0] ? goals[0].value : DEFAULT_GOALS };
}

// The rows behind one number: { metric, week } or { group: "source"|"list", key, metric }.
async function rows(query, facts, sb, sel) {
  let ids = [];
  if (sel.group === "source") { const s = sb.bySource.find(x => x.key === sel.key); ids = s ? s[sel.metric] || [] : []; }
  else if (sel.group === "list") { const s = sb.byList.find(x => x.key === sel.key); ids = s ? s[sel.metric] || [] : []; }
  else { const w = sb.weeks.find(x => x.week === sel.week); ids = w && w[sel.metric] ? w[sel.metric].ids : []; }
  if (!ids.length) return [];
  const isDeal = sel.group === "source" || ["dealsWon", "mrrAdded"].includes(sel.metric);
  if (isDeal) {
    const ds = await query(`SELECT d.id, d.name, d.source, d.value_cents, d.won_at, d.created_at FROM sales_deals d WHERE d.id = ANY(?)`, [ids]);
    return ds.map(d => ({ type: "deal", id: d.id, name: d.name, at: d.won_at || d.created_at, says: `${d.source || "no source"}${d.won_at ? ` · won, $${(Number(d.value_cents) / 100).toLocaleString("en-US")}/mo` : ""}` }));
  }
  const acts = await require("./activities").withRecords(query, await query(`SELECT a.id, a.kind, a.at, a.body, a.outcome FROM sales_activities a WHERE a.id = ANY(?) ORDER BY a.at DESC`, [ids]));
  return acts.map(a => { const r = a.records.find(x => x.type === "contact") || a.records[0] || null; return { type: r ? r.type : null, id: r ? r.id : null, name: r ? r.name : "(no record)", at: a.at, says: a.body }; });
}

module.exports = { DEFAULT_GOALS, METRICS, SENTENCES, cleanGoals, build, load, rows, weekStart, PLANT };
