#!/usr/bin/env node
// scripts/ci/route-diff.js — SPLIT-1: did this tree change the routes?
//
// It boots server.js against a loopback database (never prod: booting runs
// schema init), walks the live Express stack the way scripts/lib/routeInventory.js
// does, and compares two walks:
//   1. the set of routes: method + path + the middleware chain (each layer's
//      name and a hash of its function's source), line for line;
//   2. the order: any two routes that can answer the same request keep the
//      order they had, and every route has the same app.use() layers above it;
//   3. with --against, the stitched source (readSource("server.js")), which a
//      move that changed nothing leaves byte for byte the same.
//
// Usage (loopback DATABASE_URL only):
//   node scripts/ci/route-diff.js --write <out.json> [--root <dir>]
//   node scripts/ci/route-diff.js <base.json> <head.json>
//   node scripts/ci/route-diff.js --against <git-ref> [--strict]
// Prints the differences and exits 0. With --strict (a move-only build: CI
// passes it on a branch named split-*), any difference exits 1.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; };
const sha = t => crypto.createHash("sha1").update(t).digest("hex").slice(0, 12);
// A function's source, with a relative require()/import() read as the file's
// own name: a handler moved to server/<domain>/ reads "../../x" for the "../x"
// it had, or "../../routes/x" for "./x", and that is the same file.
const fnSrc = fn => String(fn).replace(/\b(require|import)\((\s*)(["'`])(\.\.?\/[^"'`]*)/g, (m, kw, sp, q, spec) => kw + "(" + sp + q + spec.split("/").pop());

// ── the walk ────────────────────────────────────────────────────────────────
function layerName(fn) {
  return fn.name && fn.name !== "<anonymous>" ? fn.name.replace(/^bound /, "") : "anonymous";
}
function walk(app) {
  const router = (app && app._router) || (app && app.router) || null;
  const out = [];
  let uses = 0;
  const visit = (stack, prefix) => {
    for (const l of stack) {
      if (l.route) {
        const paths = Array.isArray(l.route.path) ? l.route.path : [l.route.path];
        for (const p of paths) for (const m of Object.keys(l.route.methods).filter(k => k !== "_all")) {
          out.push({ kind: "route", method: m.toUpperCase(), path: prefix + p, uses,
            chain: l.route.stack.map(s => layerName(s.handle) + "#" + sha(fnSrc(s.handle))) });
        }
        continue;
      }
      const slash = l.slash === true || (l.regexp && l.regexp.fast_slash);
      if (l.name === "router" && l.handle && l.handle.stack) {
        // a router at "/" is the same as its routes declared in place (FIX-1, SPLIT-1)
        if (slash) visit(l.handle.stack, prefix);
        else { out.push({ kind: "use", name: "router", path: prefix + String(l.regexp) }); uses++; visit(l.handle.stack, prefix + String(l.regexp) + "|"); }
        continue;
      }
      out.push({ kind: "use", name: layerName(l.handle), path: slash ? prefix + "/" : prefix + String(l.regexp), src: sha(fnSrc(l.handle)) });
      uses++;
    }
  };
  visit((router && router.stack) || [], "");
  return out;
}

async function write(outFile, root) {
  const url = process.env.DATABASE_URL || "";
  if (!/localhost|127\.0\.0\.1/.test(url)) { console.error("REFUSED: booting server.js runs schema init. Loopback DATABASE_URL only."); process.exit(1); }
  Object.assign(process.env, {
    JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local",
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "sk_test_dummy", TEST_MODE: "1",
    RESEND_BASE_URL: "http://127.0.0.1:9", PORT: "0", DISABLE_BACKGROUND_TICKS: "1",
  });
  process.chdir(root);
  const app = require(path.join(root, "server.js"));
  // crm's routes register at the end of boot; wait until the walk stops growing
  let last = -1, same = 0;
  for (let t = 0; t < 120 && same < 3; t++) {
    await new Promise(r => setTimeout(r, 1000));
    const n = walk(app).length;
    same = n === last && n > 0 ? same + 1 : 0; last = n;
  }
  const w = walk(app);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(w, null, 1));
  console.log(`wrote ${w.filter(x => x.kind === "route").length} routes, ${w.filter(x => x.kind === "use").length} app.use layers → ${outFile}`);
  process.exit(0);
}

// ── the comparison ──────────────────────────────────────────────────────────
function segs(p) { return p.toLowerCase().replace(/\/+$/, "").split("/").slice(1); }
function variants(p) {
  let out = [[]];
  for (const s of segs(p)) out = /^:[^/]*\?$/.test(s) ? out.flatMap(v => [v, v.concat(s)]) : out.map(v => v.concat(s));
  return out;
}
const wild = s => /[:*(]/.test(s);
// Can one request reach both? Conservative: a param, a star or a regex part
// matches any segment, so a "yes" may be wrong but a "no" is not.
function overlap(a, b) {
  const meth = a.method === b.method || a.method === "ALL" || b.method === "ALL"
    || (a.method === "GET" && b.method === "HEAD") || (a.method === "HEAD" && b.method === "GET");
  if (!meth) return false;
  if (/[*]|\/\^/.test(a.path) || /[*]|\/\^/.test(b.path)) return true;
  for (const va of variants(a.path)) for (const vb of variants(b.path)) {
    if (va.length === vb.length && va.every((s, k) => wild(s) || wild(vb[k]) || s === vb[k])) return true;
  }
  return false;
}
const keyed = w => {
  const n = new Map();
  return w.filter(x => x.kind === "route").map((r, i) => {
    const k = `${r.method} ${r.path}  [${r.chain.join(" > ")}]`;
    n.set(k, (n.get(k) || 0) + 1);
    return { ...r, i, key: n.get(k) > 1 ? `${k} (#${n.get(k)})` : k };
  });
};

function compare(base, head) {
  const lines = [];
  const B = keyed(base), H = keyed(head);
  const hb = new Map(H.map(r => [r.key, r]));
  const bb = new Map(B.map(r => [r.key, r]));
  for (const r of B) if (!hb.has(r.key)) lines.push(`- ${r.key}`);
  for (const r of H) if (!bb.has(r.key)) lines.push(`+ ${r.key}`);
  // the app.use() layers, in order
  const U = w => w.filter(x => x.kind === "use").map(u => `${u.name} ${u.path} ${u.src || ""}`);
  const ub = U(base), uh = U(head);
  if (ub.join("\n") !== uh.join("\n")) {
    for (const u of ub) if (!uh.includes(u)) lines.push(`- use ${u}`);
    for (const u of uh) if (!ub.includes(u)) lines.push(`+ use ${u}`);
    if (!lines.some(l => l.includes(" use "))) lines.push("~ the app.use() layers are the same set in a different order");
  }
  // every route keeps the app.use() layers above it
  for (const r of B) { const h = hb.get(r.key); if (h && h.uses !== r.uses) lines.push(`~ ${r.key}: ${r.uses} app.use() layers above it, now ${h.uses}`); }
  // two routes that can answer one request keep their order
  let pairs = 0;
  for (let x = 0; x < B.length; x++) for (let y = x + 1; y < B.length; y++) {
    if (!overlap(B[x], B[y])) continue;
    const hx = hb.get(B[x].key), hy = hb.get(B[y].key);
    if (!hx || !hy) continue;
    pairs++;
    if (hx.i > hy.i) lines.push(`~ order: ${B[x].method} ${B[x].path} came before ${B[y].method} ${B[y].path}, now after`);
  }
  return { lines, routes: [B.length, H.length], pairs };
}

function stitched(root) {
  const code = `process.stdout.write(require("crypto").createHash("sha1").update(require(${JSON.stringify(path.join(root, "scripts/lib/readSource.js"))}).readSource("server.js")).digest("hex"))`;
  return execFileSync(process.execPath, ["-e", code], { cwd: root, encoding: "utf8" });
}

function bootWalk(root, out) {
  execFileSync(process.execPath, [__filename, "--write", out, "--root", root], { cwd: root, stdio: ["ignore", "inherit", "inherit"], timeout: 300000, env: process.env });
}

async function main() {
  if (opt("--write")) return write(path.resolve(opt("--write")), path.resolve(opt("--root") || ROOT));
  const strict = args.includes("--strict");
  let base, head, src = null;
  if (opt("--against")) {
    const ref = opt("--against");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "route-diff-"));
    const wt = path.join(tmp, "base");
    execFileSync("git", ["worktree", "add", "--detach", wt, ref], { cwd: ROOT, stdio: "ignore" });
    try {
      for (const nm of ["node_modules", "client/node_modules"]) if (fs.existsSync(path.join(ROOT, nm))) fs.symlinkSync(path.join(ROOT, nm), path.join(wt, nm));
      bootWalk(wt, path.join(tmp, "base.json"));
      bootWalk(ROOT, path.join(tmp, "head.json"));
      base = JSON.parse(fs.readFileSync(path.join(tmp, "base.json"), "utf8"));
      head = JSON.parse(fs.readFileSync(path.join(tmp, "head.json"), "utf8"));
      src = [stitched(wt), stitched(ROOT)];
    } finally {
      execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: ROOT, stdio: "ignore" });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } else if (args.length >= 2) {
    base = JSON.parse(fs.readFileSync(args[0], "utf8"));
    head = JSON.parse(fs.readFileSync(args[1], "utf8"));
  } else {
    console.error("usage: route-diff.js --write <out> | <base.json> <head.json> | --against <ref> [--strict]");
    process.exit(2);
  }
  const { lines, routes, pairs } = compare(base, head);
  if (src) lines.push(...(src[0] === src[1] ? [] : [`~ the stitched source (readSource("server.js")) differs: ${src[0].slice(0, 12)} → ${src[1].slice(0, 12)}`]));
  console.log(`routes: ${routes[0]} → ${routes[1]}; ${pairs} pairs of routes that can answer the same request, order checked`);
  if (src) console.log(`stitched source: ${src[0] === src[1] ? "identical" : "different"}`);
  if (!lines.length) { console.log("route diff: empty"); return; }
  console.log(`route diff: ${lines.length} line(s)`);
  for (const l of lines) console.log("  " + l);
  if (strict) process.exit(1);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { walk, compare, overlap };
