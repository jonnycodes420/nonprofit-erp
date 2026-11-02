#!/usr/bin/env node
// scripts/ci/dist-for-shard.js: CI-2. A COPY OF client/dist FOR ANOTHER SHARD'S API.
//
// A local dist is built against one API (scripts/ops/build-local-dist.sh bakes
// VITE_API_URL and its four siblings, all `$API/...`, into the bundle). A
// sharded battery on one machine runs a server per shard on its own port, and
// every shard that holds a browser suite needs a dist that calls ITS server.
// Building the client once per shard costs a minute each; this copies the one
// fresh build and rewrites the API origin in it, which is the only thing the
// build env changes. It then proves the result: the old origin appears
// nowhere in the copy, and the new one does.
//
//   node scripts/ci/dist-for-shard.js --from client/dist --to .generated/dist/shard-3 \
//        --api-from http://localhost:6110 --api-to http://localhost:6130
//
// Loopback only (both origins), and it writes only under --to, which must be
// inside .generated/. No database, no network.
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf("--" + n); return i === -1 ? "" : argv[i + 1] || ""; };
const ROOT = path.join(__dirname, "..", "..");
const from = path.resolve(ROOT, flag("from") || "client/dist");
const to = path.resolve(ROOT, flag("to"));
const apiFrom = flag("api-from").replace(/\/+$/, ""), apiTo = flag("api-to").replace(/\/+$/, "");
const LOOP = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;
const die = m => { console.error(`[dist-for-shard] ${m}`); process.exit(2); };

if (!LOOP.test(apiFrom) || !LOOP.test(apiTo)) die(`both APIs must be loopback with a port (got ${apiFrom || "none"} → ${apiTo || "none"})`);
if (!flag("to") || !to.startsWith(path.join(ROOT, ".generated") + path.sep)) die("--to must be a folder inside .generated/");
if (!fs.existsSync(path.join(from, "index.html"))) die(`no build at ${from}`);

// The host as the bundle spells it: "localhost:6110". A port is four digits
// here, so "localhost:6110" never matches inside a longer one, but the match
// still refuses a following digit to be sure.
const hostFrom = apiFrom.replace(/^https?:\/\//, ""), hostTo = apiTo.replace(/^https?:\/\//, "");
const re = new RegExp(hostFrom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?!\\d)", "g");
const TEXT = /\.(js|mjs|html|css|json|map|txt|webmanifest|svg)$/i;

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
let files = 0, swaps = 0, left = 0, seen = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!TEXT.test(e.name)) continue;
    const src = fs.readFileSync(p, "utf8");
    const n = (src.match(re) || []).length;
    if (n) { fs.writeFileSync(p, src.replace(re, hostTo)); files++; swaps += n; }
    const out = n ? src.replace(re, hostTo) : src;
    if (re.test(out)) left++;
    re.lastIndex = 0;
    if (out.includes(hostTo)) seen++;
  }
})(to);
if (!swaps) die(`${from} never names ${hostFrom}: it was not built against that API`);
if (left) die(`${left} file(s) still name ${hostFrom} after the rewrite`);
if (!seen) die(`no file names ${hostTo} after the rewrite`);
// The freshness stamp (scripts/ci/dist-fresh.js) names the API it was built for.
const stamp = path.join(to, ".steward-build.json");
try { const j = JSON.parse(fs.readFileSync(stamp, "utf8")); j.api = apiTo; j.copiedFrom = apiFrom; fs.writeFileSync(stamp, JSON.stringify(j)); } catch { /* no stamp: nothing to say */ }
console.log(`[dist-for-shard] ${path.relative(ROOT, to)}: ${hostFrom} → ${hostTo} (${swaps} in ${files} files)`);
