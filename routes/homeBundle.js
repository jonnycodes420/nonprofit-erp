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
// by path. A query string is allowed; the path must be one of these.
const HOME_READS = new Set([
  "/data-health/notice", "/gift-starts/notice", "/journey-sends/notice", "/recurring/exceptions", "/readouts/latest", "/move",
  "/sequences/home", "/agent/daily-line", "/threads/health", "/org/setup-status", "/me/home-layout",
  "/tasks/counts", "/dashboard/my-stats", "/donors/stage-counts", "/recurring/health", "/impact",
  "/fundraising/overview", "/goals/active", "/drift", "/threads", "/calendar/today", "/calendar/to-log",
  "/mailbox", "/home/calls", "/home/annual-goal", "/ask/pins", "/donors/birthdays-near", "/donors/counts",
  "/dashboard/today", "/metrics/stewardship-summary", "/dashboard/home", "/thank-yous",
  "/dashboard/stewardship-debt/breakdown", "/dashboard/retention/breakdown", "/home/lead",
  // HARDEN-2 item 2: the shell's own reads on every app page (the top bar,
  // the rail's badges, Atlas), asked for in one request while the app's code
  // downloads (client/src/lib/bootReads.js SHELL_READS). All plain GETs.
  "/billing/donor-band", "/atlas/status", "/me/nav-layout", "/people/photos", "/capture/count", "/status/summary",
  "/org/sample-data-status", "/org/welcome", "/atlas/activity", "/changelog/hidden", "/thank-yous/clock",
  "/volunteer-hub/crossover", "/atlas/notes",
  // HARDEN-2: Home's ladder and cards (INSIGHTS-1), asked for on its own at boot.
  "/insights",
  // HOME-4: the right rail's reads (client/src/lib/homeReads.js RAIL_READS), in their own bundle.
  "/mail-types", "/mail-types/status",
]);
const MAX_READS = 40;
// At most this many run at once for one bundle, so one person's Home cannot
// take every database connection from everybody else's.
const LANES = 6;

function mount(ctx) {
const { requireAuth, testMode, wrap } = ctx;
const app = routers.r0;

app.get("/home/bundle", requireAuth, wrap(async (req, res) => {
  const asked = [].concat(req.query.p || []).map(String);
  const paths = [...new Set(asked)].slice(0, MAX_READS);
  const refused = paths.filter(p => !p.startsWith("/") || !HOME_READS.has(p.split("?")[0]));
  if (refused.length) return res.status(400).json({ error: "not_a_home_read", message: "That read is not part of Home.", paths: refused });
  const out = new Array(paths.length);
  const timing = [];   // Server-Timing: how long each read took, for the load harness
  let next = 0;
  const lane = async () => {
    while (next < paths.length) {
      const i = next++;
      const t0 = Date.now();
      const r = await inProcess.get(paths[i], { headers: req.headers, remoteAddress: req.socket && req.socket.remoteAddress });
      // The route's body is already JSON text; it is placed as-is, never
      // parsed and re-written, so nothing about it can change on the way.
      const ok = r.status === 200 && r.body.length > 0 && /json/.test(String(r.headers["content-type"] || ""));
      timing.push(`r${i};dur=${Date.now() - t0};desc="${paths[i].split("?")[0]}"`);
      out[i] = JSON.stringify(paths[i]) + ":{\"status\":" + r.status + (ok ? ",\"body\":" + r.body : "") + "}";
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, paths.length) }, lane));
  res.set("Server-Timing", timing.join(", "));
  res.type("application/json").send("{" + out.join(",") + "}");
}));

// TEST_MODE only: run the nightly comparison now, for the caller's org, so the
// suite can prove a stored answer that disagrees with a fresh one is reported.
// A 404 everywhere else.
app.post("/org-summary/check", requireAuth, wrap(async (req, res) => {
  if (!testMode()) return res.status(404).json({ error: "Not found" });
  const lines = [];
  const out = await require("../orgSummary").checkAll({ orgId: req.user.orgId, log: { error: m => lines.push(m), log: m => lines.push(m) } });
  res.json({ ...out, lines });
}));
}

module.exports = { routers, mount, HOME_READS };
