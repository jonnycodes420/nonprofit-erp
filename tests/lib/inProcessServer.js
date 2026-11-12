// tests/lib/inProcessServer.js · FLAKE-5 (W-FLAKE-access2-login). A SERVER IN THE
// SUITE'S OWN PROCESS NEVER CLOSES A KEPT-ALIVE SOCKET ON ITS OWN TIMER.
//
// What failed: access2-portfolio's first login, "fetch failed" (ECONNRESET), on CI
// only, after /ready had answered. The suite boots server.js in-process, so the
// server and the suite's fetch share ONE event loop. /ready leaves a kept-alive
// socket in fetch's pool; then the suite walks the live router (buildInventory,
// 1,633 routes), which blocks that loop for ~5.4 s on a CI runner, past Node's
// 5 s keepAliveTimeout. When the loop wakes, the login is written onto the pooled
// socket first, and in the same turn the server's keep-alive timer fires and
// destroys that socket with the request unread: Linux answers with a reset. On a
// runner, a loop blocked 6 s fails every time; under 5 s, never (the FLAKE-5
// diagnostic on CI's Linux). macOS orders it the other way, so it passed locally.
// Not /ready, not the pool, not boot DDL, not the port.
//
// The cure is the server's, for an in-process server only: keepAliveTimeout 0
// (Node: no keep-alive timeout), set before the first request. The server then
// never closes an idle socket; fetch closes its own idle sockets on its own
// timer, which cannot race its own write. A server in another process is left
// as it is (its loop is not the suite's), and nothing in the product changes.
"use strict";
const path = require("path");

const SHARE = path.join(__dirname, "..", "..", "server", "boot", "share.js");

// The http server server.js started in this process on `base`'s port, or null.
function inProcessServer(base) {
  if (!require.cache[SHARE]) return null;
  const srv = require(SHARE).ctx.httpServer;
  if (!srv || typeof srv.address !== "function") return null;
  const addr = srv.address();   // null for the moment between listen() and bound
  return !addr || addr.port === Number(new URL(base).port || 80) ? srv : null;
}

// Called by helpers.untilReady before its first request. Returns whether it applied.
// The first time, it also closes the sockets already idle (a /health probe a suite
// made before untilReady), since each carries the 5 s timer it was given then.
const done = new WeakSet();
function noServerSideIdleClose(base) {
  const srv = inProcessServer(base);
  if (!srv) return false;
  srv.keepAliveTimeout = 0;
  if (!done.has(srv)) { done.add(srv); if (typeof srv.closeIdleConnections === "function") srv.closeIdleConnections(); }
  return true;
}

module.exports = { inProcessServer, noServerSideIdleClose };
