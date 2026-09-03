// scripts/lib/routeInventory.js — BUILD-75 B.1: the mechanical route walk.
//
// ONE inventory builder, used by BOTH scripts/build75-route-inventory.js (which
// commits audit/route-inventory.json) and tests/route-coverage.test.js (B.4 —
// which regenerates the inventory from the LIVE router and fails when a route
// exists that the isolation matrix did not exercise). Never hand-maintain a
// route list; the router is the authority, the source scan only annotates it.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

// Known auth/gate middlewares, matched by function NAME first, then by a
// source fingerprint (requirePlan/limiters return anonymous closures).
const GATE_FINGERPRINTS = [
  ["requireAuth", /\brequireAuth\b/],
  ["requireAdmin", /\brequireAdmin\b/],
  ["requireSuperAdmin", /\brequireSuperAdmin\b/],
  ["checkWriteAccess", /\bcheckWriteAccess\b/],
  ["requirePlan", /plan_required|requirePlan/],
  ["requireDonorAccount", /donor_account|requireDonorAccount/],
  ["rateLimiter", /rate.?limit|RateLimit|max:\s*\d+/i],
];

function classifyHandler(fn) {
  if (fn.name && fn.name !== "wrap" && !/^bound /.test(fn.name) && fn.name !== "<anonymous>") return fn.name;
  const src = String(fn);
  for (const [label, re] of GATE_FINGERPRINTS) if (re.test(src)) return label;
  return "handler";
}

// Walk the live Express 4 router. Returns [{method, path, middlewares:[...]}].
function walkRouter(app) {
  const out = [];
  // Express 5 exposes the router as the `app.router` getter; Express 4 as
  // `app._router`. Take whichever exists — the layer shape is the same.
  const router = (app && app._router) || (app && app.router) || null;
  const stack = (router && router.stack) || [];
  for (const layer of stack) {
    if (!layer.route) continue; // app.use middleware — recorded separately below
    const p = layer.route.path;
    const paths = Array.isArray(p) ? p : [p];
    for (const routePath of paths) {
      for (const method of Object.keys(layer.route.methods).filter(m => m !== "_all")) {
        out.push({
          method: method.toUpperCase(),
          path: routePath,
          middlewares: layer.route.stack.map(l => classifyHandler(l.handle)),
        });
      }
    }
  }
  return out;
}

// Source annotation: for each route registration in server.js, slice the
// handler region (this registration → the next one) and extract every
// req.params/req.query/req.body reference, including destructuring.
function sourceParamMap(serverSrc) {
  const regRe = /app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  const regs = [];
  let m;
  while ((m = regRe.exec(serverSrc))) regs.push({ method: m[1].toUpperCase(), path: m[2], at: m.index });
  const map = new Map();
  for (let i = 0; i < regs.length; i++) {
    const slice = serverSrc.slice(regs[i].at, regs[i + 1] ? regs[i + 1].at : regs[i].at + 20000);
    const params = { path: new Set(), query: new Set(), body: new Set() };
    // The auth chain, from the REGISTRATION LINE itself — middleware closures
    // (requireAdmin, wrap(...), requirePlan("team")) are anonymous at runtime,
    // so the source registration is the only place the chain is legible. The
    // runtime walk stays the authority for WHICH routes exist; this annotates.
    const regLine = slice.slice(0, Math.min(slice.length, slice.indexOf("=>") + 1 || 400, 400));
    const gates = [];
    for (const gm of regLine.matchAll(/\b(requireAuth|requireAdmin|requireSuperAdmin|checkWriteAccess|requireDonorAccount|requirePortalSession|verifyStripeSignature)\b|\brequirePlan\(\s*["'](\w+)["']\s*\)|\b(\w*[lL]imiter)\b|\b(rawParser|urlencodedParser)\b/g)) {
      if (gm[1]) gates.push(gm[1]);
      else if (gm[2]) gates.push(`requirePlan(${gm[2]})`);
      else if (gm[3]) gates.push(gm[3]);
      else if (gm[4]) gates.push(gm[4]);
    }
    for (const pm of slice.matchAll(/req\.params\.(\w+)/g)) params.path.add(pm[1]);
    for (const pm of slice.matchAll(/req\.query\.(\w+)/g)) params.query.add(pm[1]);
    for (const pm of slice.matchAll(/req\.body\.(\w+)/g)) params.body.add(pm[1]);
    for (const dm of slice.matchAll(/const\s*\{([^}]+)\}\s*=\s*req\.(body|query|params)/g)) {
      const bucket = dm[2] === "params" ? "path" : dm[2];
      for (const name of dm[1].split(",").map(x => x.split(/[:=]/)[0].trim()).filter(Boolean))
        params[bucket].add(name);
    }
    const key = `${regs[i].method} ${regs[i].path}`;
    const prev = map.get(key);
    const merged = prev || { path: new Set(), query: new Set(), body: new Set(), gates: [], line: serverSrc.slice(0, regs[i].at).split("\n").length };
    for (const b of ["path", "query", "body"]) for (const v of params[b]) merged[b].add(v);
    if (!merged.gates.length) merged.gates = gates;
    map.set(key, merged);
  }
  return map;
}

const IDENTIFIER_RE = /(^|_)(id|ids)$|Id[s]?$|^(org|donor|campaign|fund|gift|grant|user|account|subscription|invite|token|slug|email)/i;

// Frontend reference scan: does any client/src file mention the route's
// literal prefix? (":param" segments stripped; very short prefixes skipped —
// they'd match everything and prove nothing.)
function frontendRefs(routePath, clientFiles) {
  const firstSeg = routePath.split("/").filter(Boolean);
  const literalSegs = [];
  for (const seg of firstSeg) { if (seg.startsWith(":")) break; literalSegs.push(seg); }
  const probe = "/" + literalSegs.join("/");
  if (probe.length < 4) return { probe, referenced: null }; // too generic to conclude anything
  const referenced = clientFiles.some(({ src }) => src.includes(probe));
  return { probe, referenced };
}

function loadClientFiles() {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/\.(jsx?|html)$/.test(e.name)) out.push({ f: fp, src: fs.readFileSync(fp, "utf8") });
    }
  };
  walk(path.join(ROOT, "client", "src"));
  const rootHtml = path.join(ROOT, "client", "index.html");
  if (fs.existsSync(rootHtml)) out.push({ f: rootHtml, src: fs.readFileSync(rootHtml, "utf8") });
  const vjson = path.join(ROOT, "vercel.json"); // proxies count as references
  if (fs.existsSync(vjson)) out.push({ f: vjson, src: fs.readFileSync(vjson, "utf8") });
  return out;
}

function buildInventory(app) {
  const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const routes = walkRouter(app);
  const paramMap = sourceParamMap(serverSrc);
  const clientFiles = loadClientFiles();
  return routes.map(r => {
    const pm = paramMap.get(`${r.method} ${r.path}`) || { path: new Set(), query: new Set(), body: new Set(), gates: null, line: null };
    // path params from the route pattern itself always count
    for (const seg of r.path.split("/")) if (seg.startsWith(":")) pm.path.add(seg.slice(1).replace(/\?$/, ""));
    const params = { path: [...pm.path].sort(), query: [...pm.query].sort(), body: [...pm.body].sort() };
    const identifiers = [...new Set([...params.path, ...params.query, ...params.body])].filter(n => IDENTIFIER_RE.test(n)).sort();
    const fr = frontendRefs(r.path, clientFiles);
    return {
      method: r.method, path: r.path, line: pm.line,
      // gates from the source registration (legible names); layerCount from the
      // live router (cross-check that the registration was actually found)
      auth: pm.gates || [],
      sourceSeen: pm.gates !== null,
      layerCount: r.middlewares.length,
      params, identifiers,
      frontend: fr, // { probe, referenced: true|false|null }
    };
  });
}

module.exports = { buildInventory, walkRouter, sourceParamMap, IDENTIFIER_RE };
