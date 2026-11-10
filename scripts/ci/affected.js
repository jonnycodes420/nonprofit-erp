#!/usr/bin/env node
// scripts/ci/affected.js — CI-SPEED-1. `npm run affected`: ONE COMMAND, TEN MINUTES.
//
// The loop is: build → your new suite plus `npm run affected` → push → CI
// gates → auto-merge. CI runs the full battery on six shards; this is the few
// minutes of it that tell you, before the push, that your change did not
// break what it touches. It is not a local battery and it never grows into one.
//
// 1. WHAT CHANGED: the files that differ from the merge base with origin/main
//    (committed, staged, unstaged and untracked; _briefs/ ignored).
// 2. WHICH SUITES COVER THEM, strongest reason first:
//      own     the suite's own file (or its .spec.js)            always runs
//      import  the suite requires the file (transitively)
//      pin     the suite names the file's path (a source pin)
//      route   the suite calls a route the change touches (paths read from
//              the diff's hunks in server.js / routes/, or from the route
//              files that require a changed module)
//      name    the suite's name carries the file's name
//      broad   a shared surface changed (db.js, tests/helpers.js, package.json
//              …): every suite is relevant, so the fastest ones are a smoke
// 3. WHAT FITS: by the timings CI measured (.generated/suite-timings.json;
//    fetched from the newest CI run when there is none), strongest reason
//    first, fastest first within a reason, until the budget (600 s) is spent.
// 4. HEAVY SUITES NEVER RUN HERE (tenant-matrix, smoke-walk, every browser
//    walk, the load suites, anything over HEAVY_S) unless the change is to
//    that suite's own file. CI runs them.
// 5. It runs them against a server and database of its own (tests/run-all.sh
//    with SHARD_SELF=1), in one of two machine slots (affected-slots.js), not
//    under the battery lock. It never waits more than two minutes for a slot;
//    when it would, it says so and the answer is to push.
//
//   npm run affected                 plan, then run
//   npm run affected -- --dry-run    plan only
//   npm run affected -- --files routes/auctions.js,shared/x.js   (instead of git)
//   npm run affected -- --budget 300 --base origin/main --json
//
// No BASE, no DATABASE_URL of its own, no network but `gh` for timings. Exit 0
// when the suites it ran passed (or it skipped to the push), 1 when one failed.
const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { discover, MARK, needsDist } = require("../../tests/lib/suites");
const slots = require("./affected-slots");

const ROOT = path.resolve(__dirname, "..", "..");
const TESTS = path.join(ROOT, "tests");
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf("--" + name); return i === -1 ? dflt : argv[i + 1]; };
const has = name => argv.includes("--" + name);

const BUDGET_S = parseInt(flag("budget", process.env.AFFECTED_BUDGET_S || "600"), 10);
const BOOT_S = 30;                                    // a fresh database + a server boot
const HEAVY_S = 240;                                  // one suite this long is CI's, not a laptop's
const HEAVY_NAMED = ["tenant-matrix", "tenant-isolation", "smoke-walk", "scale1-load"];
const BROWSER = /require\([^)]*playwright|chromium\.launch\(|webkit\.launch\(|PLAYWRIGHT_DIR|require\(\s*["'`][^"'`]*lib\/dist["'`]/;
const WAIT_S = parseInt(process.env.AFFECTED_WAIT_S || "120", 10);
const SLOT_DIR = process.env.AFFECTED_SLOT_DIR || `/tmp/steward-affected-${process.getuid ? process.getuid() : 0}`;
const TIMINGS = path.resolve(ROOT, flag("timings", process.env.SHARD_TIMINGS || ".generated/suite-timings.json"));
// Files that every suite leans on: a change here makes every suite relevant.
const BROAD = /^(db\.js|server\.js|auth\.js|tests\/helpers\.js|tests\/run-all\.sh|tests\/shard\.sh|package(-lock)?\.json|middleware\/.*|shared\/numbers\/.*)$/;
const IGNORE = /^(_briefs\/|docs\/|audit\/|\.claude\/|.*\.md$)/;
const TIERS = ["own", "import", "pin", "route", "name", "broad"];
const GENERIC = new Set(["index", "utils", "util", "helpers", "helper", "shared", "server", "routes", "route", "test", "tests", "spec", "lib", "main", "config", "client", "src", "components", "pages", "scripts", "the", "and"]);

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { return ""; } };

// A route file is any server-side file that registers a route: server.js,
// routes/*.js and the server/<domain>/ modules (108 of them in Nov 2026).
const ROUTE_TEST = /\b(?:app|router)\.(?:get|post|put|patch|delete|all)\(\s*["'`]\//;
const isRouteFile = f => f === "server.js" || (/^(routes|server)\/.+\.js$/.test(f) && ROUTE_TEST.test(read(f)));

// ── 1. what changed ────────────────────────────────────────────────────────
function changedFiles() {
  if (flag("files", "")) return { base: "(fixture)", files: flag("files", "").split(",").map(s => s.trim()).filter(Boolean) };
  const ref = flag("base", "origin/main");
  let base;
  try { base = sh("git", ["merge-base", ref, "HEAD"]).trim(); }
  catch { console.error(`affected: no merge base with ${ref} (git fetch first?)`); process.exit(2); }
  const files = new Set([
    ...sh("git", ["diff", "--name-only", base]).split("\n"),
    ...sh("git", ["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ].filter(Boolean));
  return { base, files: [...files] };
}

// ── the local require graph ────────────────────────────────────────────────
// `require("./x")`, `require("../x")`, and require(path.join(__dirname, "..", "x")).
const REQ = /require\(\s*["'`](\.{1,2}\/[^"'`]+)["'`]\s*\)/g;
// (the argument list is taken whole, then its strings picked out: no nested quantifier)
const REQ_JOIN = /require\(\s*path\.(?:join|resolve)\(\s*__dirname\s*,([^()]*)\)\s*\)/g;
function resolveFrom(fromFile, spec) {
  const abs = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  for (const c of [abs, abs + ".js", abs + ".jsx", path.join(abs, "index.js")]) {
    try { if (fs.statSync(c).isFile()) return path.relative(ROOT, c); } catch { /* next */ }
  }
  return null;
}
const depCache = new Map();
function directDeps(file) {
  if (depCache.has(file)) return depCache.get(file);
  const src = read(file), out = new Set();
  for (const m of src.matchAll(REQ)) { const r = resolveFrom(file, m[1]); if (r) out.add(r); }
  for (const m of src.matchAll(REQ_JOIN)) {
    const parts = [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map(x => x[1]);
    const r = resolveFrom(file, path.join(...parts)); if (r) out.add(r);
  }
  depCache.set(file, out);
  return out;
}
// The walk stops AT server.js and at any other file that registers routes: a
// suite that boots the app in-process, or borrows one helper from a route
// module, reaches every route behind it, which says nothing about which route
// it tests (the route tier answers that). The route file itself still counts.
function closure(file) {
  const seen = new Set(), stack = [file];
  while (stack.length) {
    const f = stack.pop();
    if (f !== file && isRouteFile(f)) continue;
    for (const d of directDeps(f)) if (!seen.has(d)) { seen.add(d); stack.push(d); }
  }
  return seen;
}

// ── route paths a change touches ──────────────────────────────────────────
const ROUTE = /\b(?:app|router)\.(?:get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]*)["'`]/g;
function routePrefixes(text) {
  const out = new Set();
  for (const m of text.matchAll(ROUTE)) {
    const p = m[1].split(/\/:|\*|\(/)[0].replace(/\/$/, "");
    if (p.length >= 4) out.add(p);
  }
  return out;
}
function touchedRoutes(file, base) {
  // The hunks with forty lines either side: the handler the change sits in.
  if (base && base !== "(fixture)") {
    try {
      const hunk = sh("git", ["diff", "-U40", base, "--", file]);
      const p = routePrefixes(hunk);
      if (p.size || file === "server.js") return p;
    } catch { /* fall through to the whole file */ }
  }
  return file === "server.js" ? new Set() : routePrefixes(read(file));
}
let routeFilesCache = null;
function routeFilesRequiring(file) {
  if (!routeFilesCache) {
    const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
      .flatMap(e => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".js") ? [`${d}/${e.name}`] : []));
    routeFilesCache = [...walk("routes"), ...walk("server")].filter(f => f !== "server.js" && isRouteFile(f));
  }
  return routeFilesCache.filter(r => closure(r).has(file));
}

const tokens = f => path.basename(f).replace(/\.(test|spec)?\.?[jt]sx?$/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()
  .split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !GENERIC.has(t));

// ── 2. which suites, and why ──────────────────────────────────────────────
function relevance(files, base, suites) {
  const why = new Map();   // suite → { tier, reason }
  const give = (s, tier, reason) => {
    const cur = why.get(s);
    if (!cur || TIERS.indexOf(tier) < TIERS.indexOf(cur.tier)) why.set(s, { tier, reason });
  };
  const src = Object.fromEntries(suites.map(s => {
    const spec = read(`tests/${s}.spec.js`);
    return [s, read(`tests/${s}.test.js`) + "\n" + spec];
  }));
  const deps = Object.fromEntries(suites.map(s => {
    const d = closure(`tests/${s}.test.js`);
    if (fs.existsSync(path.join(TESTS, `${s}.spec.js`))) for (const x of closure(`tests/${s}.spec.js`)) d.add(x);
    return [s, d];
  }));
  let broad = [];
  for (const f of files) {
    if (IGNORE.test(f)) continue;
    const own = f.match(/^tests\/([^/]+)\.(test|spec)\.js$/);
    if (own && suites.includes(own[1])) { give(own[1], "own", f); continue; }
    if (BROAD.test(f)) broad.push(f);
    const base_ = path.basename(f), dir = path.dirname(f);
    const prefixes = isRouteFile(f) ? touchedRoutes(f, base) : new Set();
    if (!isRouteFile(f) && /\.js$/.test(f) && !f.startsWith("tests/") && !f.startsWith("client/")) {
      const via = routeFilesRequiring(f);
      if (via.length && via.length <= 5) for (const r of via) for (const p of routePrefixes(read(r))) prefixes.add(p);
    }
    const toks = tokens(f);
    for (const s of suites) {
      if (deps[s].has(f)) { give(s, "import", f); continue; }
      const text = src[s];
      if (text.includes(f) || (text.includes(base_) && dir !== "." && text.includes(path.basename(dir)))) { give(s, "pin", f); continue; }
      const hit = [...prefixes].find(p => new RegExp(`["'\`]${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/?"'\`$]|$)`).test(text));
      if (hit) { give(s, "route", `${f} → ${hit}`); continue; }
      if (toks.some(t => s.includes(t))) give(s, "name", f);
    }
  }
  if (broad.length) for (const s of suites) give(s, "broad", broad.join(", "));
  return why;
}

// ── timings ────────────────────────────────────────────────────────────────
function loadTimings() {
  const fresh = () => { try { return (Date.now() - fs.statSync(TIMINGS).mtimeMs) < 3 * 86400e3; } catch { return false; } };
  if (!fresh() && !has("no-fetch") && !flag("timings", "")) {
    // The newest CI run that kept its timings (each PR run uploads them).
    try {
      const runs = JSON.parse(execFileSync("gh", ["run", "list", "--workflow", "CI", "--status", "success", "--limit", "8", "--json", "databaseId"],
        { cwd: ROOT, encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"] }));
      const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "affected-timings-"));
      for (const r of runs) {
        try {
          execFileSync("gh", ["run", "download", String(r.databaseId), "--name", "suite-timings", "--dir", tmp], { cwd: ROOT, timeout: 30000, stdio: "ignore" });
          fs.mkdirSync(path.dirname(TIMINGS), { recursive: true });
          fs.copyFileSync(path.join(tmp, "suite-timings.json"), TIMINGS);
          console.log(`[affected] timings from CI run ${r.databaseId}`);
          break;
        } catch { /* that run kept none */ }
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch { /* no gh, or offline: the old file, or none */ }
  }
  try { const raw = JSON.parse(fs.readFileSync(TIMINGS, "utf8")); return raw.suites || raw; } catch { return {}; }
}

// ── 3. the plan ─────────────────────────────────────────────────────────────
function heavyReason(s, secs) {
  if (HEAVY_NAMED.includes(s)) return "heavy";
  const m = read(`tests/${s}.test.js`).match(MARK);
  if (m && m[1] === "last") return "load";
  // A browser walk: the suite, its spec or a test helper it requires launches
  // Playwright or reads the built client. Narrower than
  // the planner's needsDist, whose wide net only costs a dist; here a false
  // hit would send a plain suite to CI.
  if (needsDist(s, TESTS)) {
    const own = [`tests/${s}.test.js`, `tests/${s}.spec.js`];
    const helpers = own.flatMap(f => [...closure(f)]).filter(f => f.startsWith("tests/"));
    if ([...own, ...helpers].some(f => BROWSER.test(read(f)))) return "browser";
  }
  if (secs >= HEAVY_S) return `${secs}s`;
  return "";
}
function plan({ files, base }) {
  const suites = discover(TESTS).run;
  const timings = loadTimings();
  const known = suites.map(s => timings[s]).filter(Number.isFinite).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 10;
  const secsOf = s => (Number.isFinite(timings[s]) ? timings[s] : median);
  const why = relevance(files, base, suites);
  const rows = [...why.entries()].map(([s, w]) => ({ suite: s, ...w, secs: secsOf(s), heavy: heavyReason(s, secsOf(s)) }))
    .sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.secs - b.secs || a.suite.localeCompare(b.suite));
  const run = [], skipped = [];
  let spent = BOOT_S;
  for (const r of rows) {
    if (r.tier === "own") { run.push(r); spent += r.secs; continue; }          // its own suite always runs
    if (r.heavy) { skipped.push({ ...r, because: `heavy (${r.heavy}): CI runs it` }); continue; }
    if (spent + r.secs > BUDGET_S) { skipped.push({ ...r, because: "past the budget: CI runs it" }); continue; }
    run.push(r); spent += r.secs;
  }
  return { base, files, run, skipped, estimate: spent, budget: BUDGET_S, timed: known.length };
}

function print(p) {
  const code = p.files.filter(f => !IGNORE.test(f));
  console.log(`[affected] ${p.files.length} changed file(s) against ${p.base.slice(0, 12)} (${code.length} that suites can see) · budget ${p.budget}s · ${p.timed} suites timed`);
  if (!p.run.length && !p.skipped.length) { console.log("[affected] no suite covers these files. CI will run the rest."); return; }
  console.log(`[affected] will run ${p.run.length} suite(s), est ${p.estimate}s with the boot:`);
  for (const r of p.run) console.log(`   run   ${r.suite.padEnd(34)} ${String(r.secs).padStart(4)}s  ${r.tier}: ${r.reason}`);
  const shown = p.skipped.slice(0, 25);
  if (p.skipped.length) console.log(`[affected] skipping ${p.skipped.length}:`);
  for (const r of shown) console.log(`   skip  ${r.suite.padEnd(34)} ${String(r.secs).padStart(4)}s  ${r.tier} · ${r.because}`);
  if (p.skipped.length > shown.length) console.log(`   … and ${p.skipped.length - shown.length} more`);
}

// ── 4. run it ─────────────────────────────────────────────────────────────
function tag() {
  return (process.env.STEWARD_WT_TAG || path.basename(ROOT).toLowerCase().replace(/[^a-z0-9\n]/g, "_").replace(/^steward_/, "").replace(/_*$/, "").slice(0, 30)) || "wt";
}
async function main() {
  const p = plan(changedFiles());
  if (has("json")) { console.log(JSON.stringify({ ...p, run: p.run.map(r => r.suite), skipped: p.skipped.map(r => ({ suite: r.suite, because: r.because })) }, null, 1)); }
  else print(p);
  if (has("dry-run") && !process.env.AFFECTED_HOLD_MS) { console.log("[affected] dry run. CI will run the rest."); return 0; }

  const t = tag();
  const got = await slots.acquire({
    dir: SLOT_DIR, tag: t, slots: 2, waitS: WAIT_S, pollMs: 1000,
    onWait: h => console.log(`[affected] both slots are busy (${h.join(" | ")}); waiting up to ${WAIT_S}s`),
  });
  if (!got.ok) {
    console.log(`[affected] no slot after ${got.waited}s. Skipping to the push: CI will run these and the rest.`);
    return 0;
  }
  console.log(`[affected] slot ${got.slot} of 2${got.waited ? ` after ${got.waited}s` : ""}`);
  if (process.env.AFFECTED_HOLD_MS) {         // test seam: hold the slot, run nothing
    await new Promise(r => setTimeout(r, parseInt(process.env.AFFECTED_HOLD_MS, 10)));
    got.release(); console.log("[affected] held and released"); return 0;
  }
  if (!p.run.length) { got.release(); console.log("[affected] nothing to run. CI will run the rest."); return 0; }

  if (!fs.existsSync(path.join(ROOT, "client", "node_modules"))) {
    console.log("[affected] note: no client/node_modules in this worktree; the suites that read client source need `npm ci --prefix client`");
  }
  const t0 = Date.now();
  const env = { ...process.env, SUITES: p.run.map(r => r.suite).join(" "), SHARDS: "1", BATTERY_LOCK: "0" };
  // Its own server and database unless BASE is given: a server that happens
  // to be up on :5601 may be another worktree's, running other code.
  if (!process.env.BASE) Object.assign(env, { SHARD_SELF: "1", SHARD_BUILD_DIST: "0", SHARD_PREVIEW: "0" });
  const rc = await new Promise(res => spawn("bash", ["tests/run-all.sh"], { cwd: ROOT, env, stdio: "inherit" }).on("exit", c => res(c ?? 1)));
  got.release();
  const took = Math.round((Date.now() - t0) / 1000);
  console.log(`[affected] ran ${p.run.length} suite(s) in ${took}s (${rc === 0 ? "green" : "RED"}); skipped ${p.skipped.length}. CI will run the rest.`);
  return rc === 0 ? 0 : 1;
}

if (require.main === module) main().then(c => process.exit(c), e => { console.error(e); process.exit(2); });
module.exports = { plan, relevance, heavyReason };
