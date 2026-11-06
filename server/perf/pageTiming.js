// PERF-4 · PAGE TIMING, TIME ONLY.
//
//   POST /perf/page-ready   { page, ms, fresh, part }   a signed-in browser's
//                           page-ready mark (client/src/lib/pageReady.js). 204.
//
// SPEED-3: Settings names its section (`part`, one of SETTINGS_PARTS, else
// none), and the giving page editor is a page of its own, so /ops can say
// which section or editor a slow Settings wait was.
//
// What is kept is the page's name (one of a fixed list, else "other"), the
// milliseconds and whether it was the first page after a page load: no org, no
// person, no address, nothing from the page. It is kept in this process's
// memory, the last KEEP_MS, at most CAP marks, and never written to a table:
// a mark changes nothing, so the audit row is skipped too. /ops (opsRoutes.js)
// shows the summary beside the walk trend; a deploy starts it again.
"use strict";
const express = require("express");

const PAGES = new Set(["home", "donors", "profile", "fundraising", "giving-report", "reports", "journeys", "settings",
  "tasks", "communications", "grants", "finance", "events", "groups", "calendar", "volunteers", "giving-page-editor"]);
// Settings' sections (client/src/components/settings/settingsTabs.js), a fixed list.
const SETTINGS_PARTS = new Set(["org", "team", "connections", "giving", "customization", "words", "journeys", "portal", "automatic",
  "going-out", "receipts", "brandkit", "imports", "atlas", "audit", "privacy", "data", "profile", "account", "myemail", "security"]);
// The seven the walk times, in its order.
const MAIN = ["home", "donors", "profile", "fundraising", "giving-report", "journeys", "settings"];
const KEEP_MS = 24 * 60 * 60 * 1000;
const CAP = 20000;
const MAX_MS = 60000;
const marks = [];   // [at, page, ms, fresh, part]

function record(body, now = Date.now()) {
  const b = body && typeof body === "object" ? body : {};
  const ms = Math.round(Number(b.ms));
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_MS) return false;
  const page = PAGES.has(b.page) ? b.page : "other";
  const part = page === "settings" && SETTINGS_PARTS.has(b.part) ? b.part : null;
  marks.push([now, page, ms, b.fresh === true, part]);
  if (marks.length > CAP) marks.splice(0, marks.length - CAP);
  return true;
}

const pct = (xs, p) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : null);

// Per page: how many marks, the median and the 95th, for the first page of a
// load (a fresh sign-in or a reload) and for a move inside the app.
function summary(now = Date.now()) {
  while (marks.length && now - marks[0][0] > KEEP_MS) marks.shift();
  const of = (page, fresh, part) => marks.filter(m => m[1] === page && m[3] === fresh && (part === undefined || m[4] === part)).map(m => m[2]).sort((a, b) => a - b);
  const row = (page, part) => {
    const f = of(page, true, part), w = of(page, false, part);
    return { page, ...(part !== undefined ? { part } : {}), first: { n: f.length, p50: pct(f, 50), p95: pct(f, 95) }, moved: { n: w.length, p50: pct(w, 50), p95: pct(w, 95) } };
  };
  const pages = [...MAIN, ...[...PAGES].filter(p => !MAIN.includes(p)), "other"].map(page => row(page))
    .filter(r => MAIN.includes(r.page) || r.first.n || r.moved.n);
  // Settings, one row per section that reported, in the tab bar's order.
  const parts = [...SETTINGS_PARTS].map(part => row("settings", part)).filter(r => r.first.n || r.moved.n);
  return { since: marks.length ? new Date(marks[0][0]).toISOString() : null, marks: marks.length, pages, parts };
}

const routers = { r0: express.Router() };
function mount({ requireAuth }) {
  routers.r0.post("/perf/page-ready", requireAuth, (req, res) => {
    if (req.audit && req.audit.skip) req.audit.skip("a page's time, nothing changed");
    record(req.body);
    res.status(204).end();
  });
}

module.exports = { routers, mount, record, summary, MAIN, SETTINGS_PARTS, _reset: () => { marks.length = 0; } };
