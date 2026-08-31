#!/usr/bin/env node
// scripts/local-preview.js — BUILD-73. The local stand-in for Vercel.
//
// WHY THIS EXISTS
// `vite preview` serves client/dist as static files and nothing else. In
// PRODUCTION, vercel.json rewrites a set of same-origin paths to the Railway
// backend — /portal-api, /account-api, /network-api, /portal-assets and the
// recurring/unsubscribe endpoints — so the donor portal, the donor account
// area and the network directory all talk to the API SAME-ORIGIN and never
// touch CORS.
//
// Locally that proxy did not exist, so those surfaces fetched /portal-api/...
// from :4173, got index.html back, and sat on "Loading…" forever. Every browser
// suite that drives them (portal-visual, and the portal half of the capture
// walks) failed on a timeout that looked like a product bug and was an
// environment gap. This closes it: same rewrites, same origin, pointed at the
// LOCAL API instead of Railway.
//
// Usage:
//   API=http://localhost:5606 PORT=4173 node scripts/local-preview.js
//
// Loopback only, by construction — it serves a local build and proxies to a
// local API. There is no BASE/prod mode to guard, and it writes nothing.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const API = (process.env.API || "http://localhost:5606").replace(/\/+$/, "");
const DIST = path.join(__dirname, "..", "client", "dist");

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(API)) {
  console.error(`REFUSED: API=${API} is not loopback. This is a LOCAL preview only.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`No build at ${DIST}. Run: cd client && VITE_API_URL=${API} npx vite build`);
  process.exit(1);
}

// The vercel.json rewrite table, in the same order, pointed at the local API.
const PROXY = [
  [/^\/portal-api\/(.*)$/,    m => `/portal/${m[1]}`],
  [/^\/account-api\/(.*)$/,   m => `/account/${m[1]}`],
  [/^\/network-api\/(.*)$/,   m => `/network/${m[1]}`],
  [/^\/portal-assets\/(.*)$/, m => `/portal-assets/${m[1]}`],
  [/^\/unsubscribe$/,                 () => "/unsubscribe"],
  [/^\/recurring\/update-card$/,      () => "/recurring/update-card"],
  [/^\/recurring\/proposal$/,         () => "/recurring/proposal"],
  [/^\/recurring\/proposal\/confirm$/, () => "/recurring/proposal/confirm"],
];

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};

const srv = http.createServer(async (req, res) => {
  const [rawPath, search = ""] = req.url.split("?");
  const url = decodeURIComponent(rawPath);

  // 1) Proxy the same-origin API rewrites.
  for (const [re, to] of PROXY) {
    const m = re.exec(url);
    if (!m) continue;
    const target = API + to(m) + (search ? "?" + search : "");
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = { ...req.headers };
      delete headers.host; delete headers["content-length"]; delete headers.connection;
      const upstream = await fetch(target, {
        method: req.method, headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
        redirect: "manual",
      });
      res.statusCode = upstream.status;
      upstream.headers.forEach((v, k) => {
        if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) return;
        res.setHeader(k, v);
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: "local-preview proxy failed", target, detail: String(e).slice(0, 200) }));
    }
    return;
  }

  // 2) Vercel's analytics endpoints do not exist locally. 404 them explicitly —
  //    serving index.html here makes the browser parse HTML as JS and throw
  //    "Unexpected token '<'", which every suite then has to allowlist as noise.
  if (url.startsWith("/_vercel/")) { res.statusCode = 404; return res.end(); }

  // 3) Static files, then the /giving entry, then the SPA catch-all.
  let file = path.join(DIST, url);
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }   // no traversal
  if (url === "/giving") file = path.join(DIST, "giving.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");

  res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
  if (url.startsWith("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  fs.createReadStream(file).pipe(res);
});

srv.listen(PORT, () => {
  console.log(`[local-preview] http://localhost:${PORT} → dist ${DIST}`);
  console.log(`[local-preview] proxying ${PROXY.length} vercel.json rewrites to ${API}`);
});
