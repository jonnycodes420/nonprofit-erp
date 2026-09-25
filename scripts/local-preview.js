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
// A missing build stops the PREVIEW, not a caller that only wants the rewrite
// table. deploy-shape requires this file for loadRewrites, and CI runs the
// battery before any client build exists — a module-level exit here killed
// that suite in CI while passing on every machine that had a dist lying
// around. So the check lives with the server start, below.

// ── THE REWRITE TABLE IS DERIVED FROM vercel.json, NEVER COPIED ────────────
// This used to be a hand-kept transcription of vercel.json's rewrites, which
// is a copy of a list that changes — and it diverged exactly the way copies
// do. BUILD-94 added /person-photos to production and not to this file, so a
// donor photo rendered as initials in every local browser check while the
// suites (which call the API directly) stayed green. The environment gap this
// script's own header exists to close had quietly reopened.
//
// So it reads the real table. One list, one order, no transcription.
function loadRewrites() {
  const vjPath = path.join(__dirname, "..", "vercel.json");
  let rules = [];
  try { rules = (JSON.parse(fs.readFileSync(vjPath, "utf8")).rewrites) || []; }
  catch (e) { console.error("[local-preview] could not read vercel.json:", e.message); return []; }
  const out = [];
  for (const r of rules) {
    const src = String(r.source || ""), dest = String(r.destination || "");
    // The SPA catch-all and the static ones are this server's own job, not the
    // backend's — they are handled below, after the proxy table.
    if (!/^https?:\/\//.test(dest)) continue;
    const destPath = dest.replace(/^https?:\/\/[^/]+/, "");
    // :path* → a greedy capture; :name → one segment.
    const toRe = p => "^" + p
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:[A-Za-z_]+\*/g, "(.*)")
      .replace(/:[A-Za-z_]+/g, "([^/]+)") + "$";
    const groups = [];
    destPath.replace(/:[A-Za-z_]+\*?/g, m => { groups.push(m); return m; });
    out.push([
      new RegExp(toRe(src)),
      m => {
        let i = 1, p = destPath;
        for (const g of groups) p = p.replace(g, m[i++] ?? "");
        return p;
      },
    ]);
  }
  return out;
}
const PROXY = loadRewrites();
if (!PROXY.length) console.error("[local-preview] WARNING: no backend rewrites loaded — same-origin API paths will 404.");

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

// BUILD-96 Part 6 — LISTEN ONLY WHEN RUN, EXPORT WHEN REQUIRED.
//
// `loadRewrites` is the thing worth asserting against: the comment above says
// the table is derived and never copied, and the only way to prove that is for
// a test to call this exact function rather than re-implement the derivation —
// a test that re-implemented it would be a second copy of the list, which is
// the failure mode the derivation exists to prevent.
//
// So the server starts only under `node scripts/local-preview.js`. Requiring
// the file gets the functions and binds no port.
if (require.main === module) {
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    console.error(`No build at ${DIST}. Run: cd client && VITE_API_URL=${API} npx vite build`);
    process.exit(1);
  }
  srv.listen(PORT, () => {
    console.log(`[local-preview] http://localhost:${PORT} → dist ${DIST}`);
    console.log(`[local-preview] proxying ${PROXY.length} vercel.json rewrites to ${API}`);
  });
}

module.exports = { loadRewrites, PROXY, API, PORT };
