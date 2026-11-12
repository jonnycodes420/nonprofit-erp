// routes/homeBundle.js · SCALE-2. Home's first reads in one request.
//
//   GET /home/bundle?p=/impact&p=/drift&...   each named read, answered by its
//                                              own route inside this process,
//                                              as the person asking
//
// Home opened with 25 requests, then six more once it knew the scope. Each one
// paid a full trip and a place in the browser's queue. The client now asks for
// each wave in one request (client/src/api.js prefetch). Every answer is the
// route's own answer, byte for byte, because it IS the route: same middleware,
// same auth, same person. A read not on Home's list is refused, so this is not
// a general proxy.
"use strict";
const express = require("express");
const inProcess = require("../inProcess");

const routers = { r0: express.Router() };

// The reads Home makes when it opens (Dashboard.jsx and the panels inside it),
// and since PERF-4 the other main pages' first reads, by path. A query string is allowed; the path must be one of these.
const HOME_READS = new Set([
  "/data-health/notice", "/gift-starts/notice", "/journey-sends/notice", "/recurring/exceptions", "/readouts/latest", "/move",
  "/sequences/home", "/agent/daily-line", "/threads/health", "/org/setup-status", "/me/home-layout",
  "/tasks/counts", "/dashboard/my-stats", "/donors/stage-counts", "/recurring/health", "/impact",
  "/fundraising/overview", "/goals/active", "/drift", "/threads", "/calendar/today", "/calendar/to-log",
  "/mailbox", "/home/calls", "/home/annual-goal", "/ask/pins", "/donors/birthdays-near", "/donors/counts",
  "/dashboard/today", "/metrics/stewardship-summary", "/dashboard/home", "/thank-yous",
  "/dashboard/stewardship-debt/breakdown", "/dashboard/retention/breakdown", "/home/lead",
  "/home/owners",   // SWEEP-1: the rail's owners card
  // HARDEN-2 item 2: the shell's own reads on every app page (the top bar,
  // the rail's badges, Atlas), asked for in one request while the app's code
  // downloads (client/src/lib/bootReads.js SHELL_READS). All plain GETs.
  "/billing/donor-band", "/atlas/status", "/me/nav-layout", "/people/photos", "/capture/count", "/status/summary",
  "/org/sample-data-status", "/org/welcome", "/atlas/activity", "/changelog/hidden", "/thank-yous/clock",
  "/volunteer-hub/crossover", "/atlas/notes",
  "/me/mfa",   // PERF-2: the idle guard's read (IdleGuard.jsx), in the shell's bundle
  // PERF-2: the app's boot reads (client/src/lib/bootReads.js BOOT_READS), one
  // request instead of seven, so a phone does not queue them behind each other.
  "/org", "/grants", "/volunteers", "/tasks", "/board", "/financials", "/billing/status",
  // HARDEN-2: Home's ladder and cards (INSIGHTS-1), asked for on its own at boot.
  "/insights",
  // HOME-4: the right rail's reads (client/src/lib/homeReads.js RAIL_READS), in their own bundle.
  "/mail-types", "/mail-types/status",
  // PERF-4: the other main pages' first reads (client/src/lib/pageReads.js
  // PAGE_READS), asked for at the boot and parked for the page. All plain GETs;
  // none asks a third party.
  "/privacy", "/me", "/donors/list-setup", "/org/team", "/portfolio/officers", "/custom-fields", "/donors/custom-field-values/all",
  "/giving-pages", "/fundraising/campaigns",
  "/ask/suggestions", "/meetings/by-staff", "/saved-reports", "/dashboards", "/saved-dashboards", "/finance/funds",
  "/reports/top-donors", "/campaigns", "/reports/giving-summary",
  "/journeys", "/auto-send/settings",
  "/people", "/custom-fields/kept-raw", "/org/sending-domain", "/org/voice-samples", "/impact-metrics", "/org/ai-status",
  // PROFILE-SPEED-1: Events, Communications and Finance's first reads (pageReads.js), asked for on the way to the page. All plain GETs.
  "/events", "/sequences/builder", "/communications/hub", "/campaigns/templates", "/campaigns/sent",
  "/finance/accounts", "/finance/summary", "/finance/overview",
]);
const MAX_READS = 40;
// At most this many run at once for one bundle, so one person's Home cannot
// take every database connection from everybody else's.
const LANES = 6;
// PERF-2: the placeholder for Home's scope in a scoped read (see below).
const SCOPE = "{scope}";
// LOAD-1 · A PROFILE OPENS IN TWO REQUESTS. Opening one person fired 37 reads
// at once; each was quick, but together they queued for the web's ten
// connections and a profile took 2 to 4 s under load. The profile now asks
// for what shows above the fold in one request, and for the rest in a second
// once the first has answered (client/src/lib/profileReads.js). Each answer is
// the route's own, as /home/bundle's are. A read must be one of the profile's
// (PROFILE_READS, with this person's id where it names one), so this is not a
// general proxy either.
const PROFILE_READS = [
  "/donors/:id", "/donors/:id/status", "/donors/:id/scores", "/donors/:id/rail", "/donors/:id/relationship",
  "/threads?donorId=:id", "/insights/donor/:id", "/donors/:id/before-meeting", "/donors/:id/blocked-mail", "/people/:id",
  "/atlas/notes?place=person&id=:id", "/donors/:id/plan", "/donors/:id/journeys", "/donors/:id/journey-suggestion",
  "/donors/:id/groups", "/donors/:id/proposals", "/donors/:id/relationships", "/donors/:id/custom-fields", "/donors/:id/events",
  "/donors/:id/attachments", "/donors/:id/tasks", "/donors/:id/volunteer-hours", "/donors/:id/recurring-subscription",
  "/donors/:id/soft-credit", "/donors/:id/moves", "/donors/:id/opportunities", "/donors/:id/move-suggestions",
  "/donors/:id/designations", "/donors/:id/receipts", "/donors/:id/planned-gifts", "/donors/:id/pledges",
  "/donors/:id/materials",   // STALE-2: the Files tab counts uploads from the start, inside the bundle
  "/mailbox", "/sequences", "/org", "/journeys", "/fundraising/campaigns", "/custom-fields?entity=gift",
];

function mount(ctx) {
const { requireAuth, testMode, wrap } = ctx;
const { query } = require("../db");   // REDTEAM-1: the profile bundle checks the person is this org's
const app = routers.r0;

// Each named read, answered by its own route inside this process as the person
// asking, at most LANES at once. The answer is one JSON object keyed by path:
// { "<path>": { status, body } }, each body the route's own text.
async function answer(req, res, paths) {
  const out = new Array(paths.length);
  const timing = [];   // Server-Timing: how long each read took, for the load harness
  // ACCESS-2B: someone who sees only their own people has most routes closed;
  // a closed part is answered 404 here and its route is never run, so asking
  // a bundle makes no call to a closed route (server/auth/portfolio.js).
  const PF = require("../server/auth/portfolio");
  const closedHere = path => PF.isScoped(req.user) && !PF.isOpenPath(req.app, req.user, "GET", path);
  const read = async (i, path) => {
    const t0 = Date.now();
    const r = closedHere(path) ? { status: 404, body: "", headers: {} }
      : await inProcess.get(path, { headers: req.headers, remoteAddress: req.socket && req.socket.remoteAddress });
    // The route's body is already JSON text; it is placed as-is, never
    // parsed and re-written, so nothing about it can change on the way.
    const ok = r.status === 200 && r.body.length > 0 && /json/.test(String(r.headers["content-type"] || ""));
    timing.push(`r${i};dur=${Date.now() - t0};desc="${path.split("?")[0]}"`);
    out[i] = JSON.stringify(path) + ":{\"status\":" + r.status + (ok ? ",\"body\":" + r.body : "") + "}";
    return r;
  };
  // PERF-2: a read written with {scope} is Home's scoped read, and the scope is
  // Home's own first rule (client/src/lib/homeReads.js initialScope): "mine"
  // when this person has a portfolio (/dashboard/my-stats), else "all". It runs
  // here once my-stats is in, and answers under the path it resolved to, so a
  // phone no longer waits a whole round trip to ask for it.
  const scoped = paths.map((p, i) => i).filter(i => paths[i].includes(SCOPE));
  const plain = paths.map((p, i) => i).filter(i => !paths[i].includes(SCOPE));
  const statsAt = paths.indexOf("/dashboard/my-stats");
  let stats = null, statsIn;
  const statsReady = new Promise(r => { statsIn = r; });
  const noteStats = r => { try { stats = r.status === 200 ? JSON.parse(r.body) : null; } catch { stats = null; } statsIn(); };
  let next = 0;
  const lane = async () => {
    while (next < plain.length) {
      const i = plain[next++];
      const r = await read(i, paths[i]);
      if (i === statsAt) noteStats(r);
    }
  };
  const scopedReads = async () => {
    if (!scoped.length) return;
    if (statsAt < 0) noteStats(await inProcess.get("/dashboard/my-stats", { headers: req.headers, remoteAddress: req.socket && req.socket.remoteAddress }));
    await statsReady;
    const scope = ((stats && stats.portfolioCount) || 0) > 0 ? "mine" : "all";
    await Promise.all(scoped.map(i => read(i, paths[i].split(SCOPE).join(scope))));
  };
  // PERF-2: in TEST_MODE the bundle also says how many statements its reads
  // sent (db.countRoundTrips), so a harness can hold Home to no query per row.
  const { trips } = await require("../db").countRoundTrips(() => Promise.all([
    ...Array.from({ length: Math.min(LANES, plain.length) }, lane), scopedReads()]));
  if (trips != null) timing.push(`trips;desc="${trips}"`);
  res.set("Server-Timing", timing.join(", "));
  res.type("application/json").send("{" + out.join(",") + "}");
}

app.get("/home/bundle", requireAuth, wrap(async (req, res) => {
  const asked = [].concat(req.query.p || []).map(String);
  const paths = [...new Set(asked)].slice(0, MAX_READS);
  const refused = paths.filter(p => !p.startsWith("/") || !HOME_READS.has(p.split("?")[0]));
  if (refused.length) return res.status(400).json({ error: "not_a_home_read", message: "That read is not part of Home.", paths: refused });
  await answer(req, res, paths);
}));

app.get("/donors/:id/bundle", requireAuth, wrap(async (req, res) => {
  const id = String(req.params.id);
  const allowed = new Set(PROFILE_READS.map(p => p.split(":id").join(encodeURIComponent(id))));
  const paths = [...new Set([].concat(req.query.p || []).map(String))].slice(0, MAX_READS);
  const refused = paths.filter(p => !allowed.has(p));
  if (refused.length) return res.status(400).json({ error: "not_a_profile_read", message: "That read is not part of this profile.", paths: refused });
  // REDTEAM-1: another org's person is a 404 for the whole bundle, not a 200 of refusals.
  const [mine] = await query(`SELECT 1 FROM donors WHERE id=? AND org_id=?`, [id, req.user.orgId]);
  if (!mine) return res.status(404).json({ error: "Not found" });
  await answer(req, res, paths);
}));

// PROFILE-SPEED-1: the profile's first screen in one request (server/donors/profileBundle.js).
require("../server/donors/profileBundle").mount({ app, requireAuth, wrap, answer, query });

// TEST_MODE only: run the nightly comparison now, for the caller's org, so the
// suite can prove a stored answer that disagrees with a fresh one is reported.
// A 404 everywhere else.
app.post("/org-summary/check", requireAuth, wrap(async (req, res) => {
  if (!testMode()) return res.status(404).json({ error: "Not found" });
  const lines = [];
  const out = await require("../orgSummary").checkAll({ orgId: req.user.orgId, log: { error: m => lines.push(m), log: m => lines.push(m) } });
  res.json({ ...out, lines });
}));
// REPORTS-SPEED-1, TEST_MODE only: the nightly pass over Retention, Annual and
// SYBUNT for the caller's org (recompute, compare with what was stored, store).
app.post("/org-summary/stored-reports/check", requireAuth, wrap(async (req, res) => {
  if (!testMode()) return res.status(404).json({ error: "Not found" });
  const lines = [];
  const out = await require("../server/reports/storedReports").nightly({ orgId: req.user.orgId, log: { error: m => lines.push(m), log: m => lines.push(m) } });
  res.json({ ...out, lines });
}));
}

module.exports = { routers, mount, HOME_READS, PROFILE_READS };
