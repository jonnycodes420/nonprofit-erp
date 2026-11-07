// DEVBOARD-3 · /ops's Journey and How-it-works tabs (super-admins only).
//
//   GET /ops/journey   the onboarding steps (what the customer sees, what
//                      Steward does, how it is detected, Open in demo, the
//                      step's Map checks with their last result) and one row
//                      per live customer org: the step it is on, when it
//                      reached each step, and how long it has sat.
//   GET /ops/flow      how a gift flows (ops/flow.json), each box with its
//                      modules, its jobs' last run and its Map area, and the
//                      Machine tab's worker and queue health.
//
// Both are behind GET /ops's door (404 to anyone who is not a live
// super-admin), read-only, and show no donor: counts and timestamps only.
"use strict";
const MAP = require("./opsMap");
const JOURNEY = require("./opsJourney");
const FLOW = require("./opsFlow");
const SOURCES = require("./opsSources");
const STATUS = require("../../scripts/ci/status");

// Every area with each check's last walk result and mark: GET /ops/map's own answer.
async function mapAreas(query) {
  const map = MAP.readMap();
  let board;
  try { board = await require("./opsImports").currentBoard(query); } catch (e) { board = { items: [], walks: [], results: {} }; }   // LEAD-IMPORT-1: with the uploads
  const rows = await require("./opsMapRoutes").readChecks(query);
  return MAP.buildMap(map, board, rows, {});
}

// Each named job's last finished run and what is queued now. Names and counts only.
async function jobFacts(query, names) {
  if (!names.length) return {};
  const rows = await query(`SELECT name, MAX(finished_at) FILTER (WHERE status = 'done') AS last_done,
                                   COUNT(*) FILTER (WHERE status = 'waiting')::int AS waiting,
                                   COUNT(*) FILTER (WHERE status = 'running')::int AS running,
                                   COUNT(*) FILTER (WHERE status = 'dead' AND failed_at > ?)::int AS dead
                              FROM job_queue WHERE name = ANY(?) GROUP BY name`, [new Date(Date.now() - 7 * 86400000).toISOString(), names]);
  const out = {};
  for (const r of rows) out[r.name] = { lastDone: r.last_done ? new Date(r.last_done).toISOString() : null, waiting: r.waiting, running: r.running, dead: r.dead };
  return out;
}

function mount(app, { query, wrap, opsOnly, opsLimiter, healthBody }) {
  app.get("/ops/journey", opsLimiter, opsOnly, wrap(async (req, res) => {
    const now = Date.now();
    const areas = await mapAreas(query).catch(() => []);
    const checkOf = new Map(areas.flatMap(a => a.checks.map(c => [c.id, { ...c, area: a.id }])));
    const steps = JOURNEY.STEPS.map((s, i) => ({
      id: s.id, n: i + 1, title: s.title, sees: s.sees, behind: s.behind, detect: s.detect,
      // The demo's public giving page comes from map.json's demo block (no org in code).
      demo: s.givingPage ? (MAP.DEMO_SLUG ? MAP.demoHref({ open: `/give/${MAP.DEMO_SLUG}`, public: true }) : null)
        : s.open ? MAP.demoHref({ open: s.open }) : null,
      checks: s.checks.map(id => { const c = checkOf.get(id); return c ? { id, says: c.says, walk: c.walk, mark: c.mark, open: !!c.item } : { id, says: null, walk: null, mark: null, open: false }; }),
    }));
    let orgs;
    try {
      const custs = await SOURCES.customerOrgs(query);
      const facts = await JOURNEY.readFacts(query, custs.map(o => o.id));
      orgs = { ok: true, rows: custs.filter(o => facts[o.id]).map(o => JOURNEY.journeyOf(facts[o.id], now))
        .sort((a, b) => a.reachedCount - b.reachedCount || (b.stuckDays || 0) - (a.stuckDays || 0) || a.name.localeCompare(b.name)) };
    } catch (e) {
      console.warn(`[ops] journey could not be read: ${e.message}`);
      orgs = { ok: false, error: "The customers' steps could not be read. Try again in a minute." };
    }
    res.json({ ok: true, steps, stuckDays: JOURNEY.STUCK_DAYS, orgs });
  }));

  app.get("/ops/flow", opsLimiter, opsOnly, wrap(async (req, res) => {
    let flow;
    try { flow = FLOW.readFlow(); } catch (e) { return res.json({ ok: false, error: `The flow file could not be read: ${e.message}` }); }
    const names = [...new Set(flow.boxes.flatMap(b => b.jobs || []))];
    const [jobs, areas] = await Promise.all([jobFacts(query, names).catch(() => ({})), mapAreas(query).catch(() => [])]);
    const h = healthBody();
    const health = { worker: STATUS.workerReport(h.worker, h.buildSha), queue: STATUS.queueReport(h.queue) };
    res.json(FLOW.buildFlow(flow, { jobs, health, areas }));
  }));
}

module.exports = { mount, jobFacts };
