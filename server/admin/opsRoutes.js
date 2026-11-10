// DEVBOARD-1 · /ops: ONE PAGE THAT SHOWS THE WHOLE MACHINE (super-admins only).
//
//   GET /ops           what the page reads: prod health, the board, builds, the
//                      walk trend, page timing (PERF-4) and customers, in one answer
//   /ops/map, /ops/checks   DEVBOARD-2, the Map tab (opsMapRoutes.js)
//   /ops/imports       LEAD-IMPORT-1, upload a walk report or the lead's summary (opsImportRoutes.js)
//   /ops/journey, /ops/flow DEVBOARD-3, the Journey and How-it-works tabs (opsJourneyRoutes.js)
//   /ops/onboarding    ONBOARD-2, the Onboarding tab (server/onboard/opsBoardRoutes.js)
//
// GET /ops is read-only. It never writes a row (the worker's opsBoardRefresh writes the one
// cached snapshot), never shows a donor, a secret, an address or a connection
// string. Anyone who is not a live super-admin gets 404, not 403: the page does
// not exist for them. Each section carries its own ok/error, so a source that
// cannot be read says so and the rest still shows.
"use strict";
const express = require("express");
const BOARD = require("./board");
const IMPORTS = require("./opsImports");
const SOURCES = require("./opsSources");
const STATUS = require("../../scripts/ci/status");

const { rateLimit } = require("../../rateLimitStore");   // shared by every replica

const routers = { r0: express.Router() };
// The page reads once and then every two minutes; this is per IP, before the door.
const opsLimiter = rateLimit("opsLimiter", {
  windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1",
});
const STALE_MS = 15 * 60 * 1000;

function mount(ctx) {
  const { query, run, wrap, healthBody, buildSha } = ctx;
  const { requireAuth404 } = require("../../auth");
  const app = routers.r0;

  // The door: a signed-in session (requireAuth404 answers 404 for none, a bad
  // or an expired token), not a support session, and is_super_admin read live
  // from the users row, never from the token alone (BUILD-37 §A5).
  const notFound = res => res.status(404).json({ error: "not_found" });
  const opsOnly = (req, res, next) => requireAuth404(req, res, err => {
    if (err) return next(err);
    if (!req.user || req.user.support || !req.user.isSuperAdmin) return notFound(res);
    query("SELECT is_super_admin FROM users WHERE id = ?", [req.user.userId])
      .then(rows => (rows.length && rows[0].is_super_admin === true ? next() : notFound(res)), next);
  });

  app.get("/ops", opsLimiter, opsOnly, wrap(async (req, res) => {
    const now = Date.now();
    const h = healthBody();
    const snap = await SOURCES.readSnapshot(query).catch(() => null);
    const s = (snap && snap.body) || {};
    const gh = s.github || {};
    const none = { ok: false, error: "Not collected yet: the worker refreshes this every five minutes." };

    // Prod health: the same checks as npm run status, on this process's own /health.
    const fe = s.frontend || none;
    const workerSha = h.worker && h.worker.buildSha;
    const shas = { web: h.buildSha || null, worker: workerSha || null, frontend: fe.ok ? fe.sha : null };
    const known = Object.values(shas).filter(Boolean);
    const health = {
      shas,
      aligned: known.length === 3 ? new Set(known).size === 1 : null,
      frontendError: fe.ok ? null : fe.error,
      worker: STATUS.workerReport(h.worker, h.buildSha),
      ci: gh.ci || none,
      queue: STATUS.queueReport(h.queue),
      pool: STATUS.poolReport(h.pool, h.worker && h.worker.pool),
      load: gh.load || none,
      mailbox: STATUS.mailboxReport(h.mailboxSync, { now }),
      guards: { ok: h.guardsOk, failed: h.guardsFailed || [] },
    };

    let board;
    // DEVBOARD-2: Jonathan's own checks (ops_checks) are merged into the walk's board.
    const checks = await require("./opsMapRoutes").readChecks(query).catch(() => []);
    // LEAD-IMPORT-1: and every report uploaded on this page (ops_imports), applied in date order.
    const imports = await IMPORTS.readImports(query).catch(() => []);
    let morning = null;
    try {
      const merged = require("./opsMap").mergeBoard(IMPORTS.deriveBoard(BOARD.readBoard(), imports), checks);
      board = { ok: true, ...BOARD.summarize(merged), importProblems: merged.importProblems || [] };
      morning = IMPORTS.morning(merged, imports);
    } catch (e) { board = { ok: false, error: `The board file could not be read: ${e.message}` }; }
    const builds = gh.builds || none;
    if (board.ok && builds.ok) {
      const prOf = new Map(builds.rows.filter(r => r.build).map(r => [r.build, r.url]));
      for (const g of board.builds) g.url = g.build ? prOf.get(g.build) || null : null;
    }

    const cust = s.customers || none;
    let customers = cust;
    if (cust.ok) {
      const items = board.ok ? board.builds.flatMap(g => g.items) : [];
      const initials = n => n.split(/[^A-Za-z0-9]+/).filter(w => /^[A-Z0-9]/.test(w)).map(w => w[0]).join("").toUpperCase();
      const isFrom = (it, c) => { const w = String(it.customer || "").trim().toLowerCase(); if (!w) return false;
        return w === c.name.toLowerCase() || w === String(c.slug || "").toLowerCase() || c.name.toLowerCase().includes(w) || w === initials(c.name).toLowerCase(); };
      customers = { ok: true, rows: cust.rows.map(c => ({ name: c.name, lastLogin: c.lastLogin,
        open: items.filter(it => (it.state === "open" || it.state === "reopened") && isFrom(it, c)).length })) };
    }

    res.json({
      refreshedAt: snap ? snap.refreshedAt : null,
      stale: snap ? now - new Date(snap.refreshedAt).getTime() > STALE_MS : true,
      githubAt: gh.collectedAt || null,
      health, board, builds, customers, morning,
      // PERF-4: the page-ready marks this web process has had (time only)
      pageTiming: require("../perf/pageTiming").summary(now),
      // SCALE-3: the capacity gauge (server/perf/capacity.js), with the nightly load result beside it
      capacity: await require("../perf/capacity").read(query, gh.load || null, now),
    });
  }));

  // DEVBOARD-2: the Map tab and Jonathan's checks, behind this same door.
  require("./opsMapRoutes").mount(app, { query, run, wrap, opsOnly, opsLimiter });
  // LEAD-IMPORT-1: "Import a walk report", behind this same door.
  require("./opsImportRoutes").mount(app, { query, run, wrap, opsOnly, opsLimiter });
  // STAGE-1: the Ship to customers card, behind this same door.
  require("./shipRoutes").mount(app, { query, run, wrap, opsOnly, opsLimiter, buildSha });
  // DEVBOARD-3: the Journey and How-it-works tabs, behind this same door.
  require("./opsJourneyRoutes").mount(app, { query, wrap, opsOnly, opsLimiter, healthBody });
  // ONBOARD-2: the Onboarding tab, behind this same door, and its worker job.
  require("../onboard/opsBoardRoutes").mount(app, { query, run, wrap, opsOnly, opsLimiter });
  require("../onboard/jobs").define(ctx);

  // The worker's job: refresh the cached snapshot every five minutes. Queued,
  // so it runs on the worker (or the one process locally), never in a request.
  require("../../jobQueue").define("opsBoardRefresh", { everyMs: 5 * 60 * 1000, firstMs: 45000,
    run: () => SOURCES.refreshSnapshot({ query, run, buildSha }) });
}

module.exports = { routers, mount };
