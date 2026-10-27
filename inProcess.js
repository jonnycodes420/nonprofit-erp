// SCALE-2 · ONE ROUTE, CALLED INSIDE THE PROCESS.
//
// Home used to open with 25 requests. Each one paid the whole trip (the
// network, the auth check, a place in the browser's queue of six), and on a
// busy server each waited its turn for a database connection. GET /home/bundle
// now asks for them in one request and answers each one by running the SAME
// route here, through the same middleware, as the same signed-in person. The
// numbers cannot differ from the separate calls because they are the separate
// calls, minus the trip.
//
// The per-org summary (orgSummary.js) uses the same door to recompute a stored
// answer off the request path.
"use strict";
const http = require("http");
const net = require("net");

let app = null;
function configure(expressApp) { app = expressApp; }

// Headers that would change what a route answers for reasons that belong to
// the outer request, not this one (a conditional GET, a compressed body).
const DROP = new Set(["content-length", "content-type", "if-none-match", "if-modified-since", "accept-encoding", "transfer-encoding", "connection"]);

// GET `path` as the person behind `headers` (their Authorization travels with
// it). Resolves { status, body } where body is the exact text the route sent.
function get(path, { headers = {}, remoteAddress = "127.0.0.1", mark = null, marks = null } = {}) {
  if (!app) return Promise.reject(new Error("inProcess not configured"));
  return new Promise((resolve) => {
    const sock = new net.Socket();
    Object.defineProperty(sock, "remoteAddress", { value: remoteAddress });
    const req = new http.IncomingMessage(sock);
    req.method = "GET";
    req.url = path;
    req.headers = {};
    for (const [k, v] of Object.entries(headers)) if (!DROP.has(k.toLowerCase())) req.headers[k.toLowerCase()] = v;
    if (mark) req[mark] = true;
    for (const m of marks || []) req[m] = true;   // HARDEN-1: the nightly check marks fresh AND no-store
    req.push(null);
    const res = new http.ServerResponse(req);
    const chunks = [];
    let done = false;
    const add = (c, enc) => { if (c != null && typeof c !== "function") chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c), typeof enc === "string" ? enc : "utf8")); };
    res.write = (c, enc, cb) => { add(c, enc); const f = typeof enc === "function" ? enc : cb; if (f) f(); return true; };
    res.end = (c, enc, cb) => {
      add(c, enc);
      if (done) return res;
      done = true;
      const f = typeof c === "function" ? c : typeof enc === "function" ? enc : cb;
      resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8"), headers: res.getHeaders() });
      res.emit("finish");
      if (f) f();
      return res;
    };
    app.handle(req, res, (err) => {
      if (done) return;
      done = true;
      resolve({ status: err ? 500 : 404, body: JSON.stringify({ error: err ? "internal" : "not_found" }), headers: {} });
    });
  });
}

module.exports = { configure, get };
