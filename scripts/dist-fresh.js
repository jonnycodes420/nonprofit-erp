#!/usr/bin/env node
// scripts/dist-fresh.js: FIX-60 item 6. IS client/dist BUILT FROM THE CODE
// THAT IS HERE NOW? The one place the battery (tests/run-all.sh) and the
// pre-push hook (.githooks/pre-push) ask that question.
//
// Twice in one week a battery reused a client/dist built before a merge: the
// old check only asked whether the dist had been built against the same API
// port, so a dist from before the merge passed it and the browser legs walked
// the old screens, green. A dist is now fresh only when ALL of these hold:
//
//   1. it exists (client/dist/index.html)
//   2. it was built against the API we are about to test (--api), when given
//   3. it was built from HEAD: the stamp file's head, or, for a dist with no
//      stamp, the <meta name="build-sha"> vite.config.js writes
//   4. the client's inputs have no uncommitted change since the build: the
//      stamp records a hash of `git diff HEAD` plus the untracked files over
//      INPUTS, and a dist with no stamp is fresh only on a clean tree
//
// The stamp (client/dist/.steward-build.json) is written by
// scripts/build-local-dist.sh, with the fingerprint taken BEFORE the build, so
// an edit made while vite runs makes the dist stale rather than hiding.
//
//   node scripts/dist-fresh.js [--api http://localhost:N] [--dist DIR] [--repo DIR]
//       prints "[dist-fresh] fresh: …" (exit 0) or "[dist-fresh] stale: <why>" (exit 1)
//   node scripts/dist-fresh.js --rebuild --api http://localhost:N
//       rebuilds through scripts/build-local-dist.sh when stale (exit 0 when
//       the dist is fresh afterwards, 2 when the build failed)
//   … --rebuild --if-present --api URL
//       the same, except a dist that is missing or built against another API
//       is left alone (the pre-push hook: it tests against a server already
//       running and must not retarget a dist somebody built for another port)
//   node scripts/dist-fresh.js --fingerprint      prints the current fingerprint
//   node scripts/dist-fresh.js --stamp FP [--api URL] [--dist DIR]
//       writes the stamp (build-local-dist.sh's last step)
//
// No BASE, no DATABASE_URL, no network. Its only write is the stamp, and the
// rebuild it delegates to build-local-dist.sh (loopback API only, brand guard
// included: that script runs `npm run build`, never a bare vite build).
const { execFileSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// What the client bundle is built from. client/ is the app; the rest are the
// files outside it that client/src imports or globs (shared/, the three root
// CommonJS modules Lost & Found bundles, pricing.json, the changelog entries).
const INPUTS = ["client", "shared", "lapseRule.js", "drift.js", "orgTime.js", "pricing.json", "docs/changelog"];
const STAMP = ".steward-build.json";

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
}

// HEAD plus a hash of every uncommitted change to the inputs ("" when clean).
function fingerprint(repo) {
  const head = git(repo, ["rev-parse", "HEAD"]).toString().trim();
  const h = crypto.createHash("sha256");
  const diff = git(repo, ["diff", "HEAD", "--binary", "--", ...INPUTS]);
  h.update(diff);
  const untracked = git(repo, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...INPUTS])
    .toString().split("\0").filter(Boolean).sort();
  for (const f of untracked) {
    h.update("\0untracked\0" + f + "\0");
    try { h.update(fs.readFileSync(path.join(repo, f))); } catch { h.update("<unreadable>"); }
  }
  const dirty = diff.length || untracked.length ? h.digest("hex").slice(0, 16) : "";
  return { head, dirty };
}

const short = s => (s || "none").slice(0, 10);

function check({ repo, dist, api }) {
  const index = path.join(dist, "index.html");
  if (!fs.existsSync(index)) return { fresh: false, why: `no client build at ${dist}` };
  if (api) {
    const port = (String(api).match(/:(\d+)\/?$/) || [])[1];
    const needle = port ? `localhost:${port}` : String(api);
    const assets = path.join(dist, "assets");
    const hit = fs.existsSync(assets) && fs.readdirSync(assets).some(f => {
      try { return fs.readFileSync(path.join(assets, f), "utf8").includes(needle); } catch { return false; }
    });
    if (!hit) return { fresh: false, why: `built against another API (no ${needle} in ${assets})` };
  }
  let now;
  try { now = fingerprint(repo); } catch (e) { return { fresh: false, why: `cannot read git state in ${repo}` }; }
  let stamp = null;
  try { stamp = JSON.parse(fs.readFileSync(path.join(dist, STAMP), "utf8")); } catch { /* no stamp */ }
  if (stamp) {
    if (stamp.head !== now.head) return { fresh: false, why: `built from ${short(stamp.head)}, HEAD is ${short(now.head)}` };
    if ((stamp.dirty || "") !== now.dirty) {
      return { fresh: false, why: now.dirty ? `the client's inputs have uncommitted changes since the build (${now.dirty})` : "built from uncommitted edits that are no longer there" };
    }
    return { fresh: true, why: `built from HEAD ${short(now.head)}${now.dirty ? " with these uncommitted edits" : ""}` };
  }
  const html = fs.readFileSync(index, "utf8");
  const meta = (html.match(/<meta[^>]*name="build-sha"[^>]*content="([^"]*)"/) || [])[1] || "";
  if (meta !== now.head) return { fresh: false, why: `built from ${short(meta)}, HEAD is ${short(now.head)}` };
  if (now.dirty) return { fresh: false, why: "the client's inputs have uncommitted changes and the build has no fingerprint" };
  return { fresh: true, why: `built from HEAD ${short(now.head)} on a clean tree` };
}

module.exports = { check, fingerprint, INPUTS, STAMP };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const repo = path.resolve(arg("--repo") || path.join(__dirname, ".."));
  const defaultDist = path.join(repo, "client", "dist");
  const dist = path.resolve(arg("--dist") || defaultDist);
  const api = arg("--api");

  if (argv.includes("--fingerprint")) {
    const fp = fingerprint(repo);
    process.stdout.write(fp.head + (fp.dirty ? "+" + fp.dirty : "") + "\n");
    process.exit(0);
  }
  if (argv.includes("--stamp")) {
    const [head, dirty = ""] = String(arg("--stamp") || "").split("+");
    if (!/^[0-9a-f]{40}$/.test(head)) { console.error("dist-fresh: --stamp needs the fingerprint taken before the build"); process.exit(2); }
    fs.writeFileSync(path.join(dist, STAMP), JSON.stringify({ head, dirty, api: api || null, builtAt: new Date().toISOString() }) + "\n");
    process.exit(0);
  }

  const first = check({ repo, dist, api });
  const notOurs = /^no client build|^built against another API/.test(first.why);
  if (!first.fresh && argv.includes("--rebuild") && argv.includes("--if-present") && notOurs) {
    console.log(`[dist-fresh] left alone: ${first.why}`);
    process.exit(0);
  }
  if (first.fresh || !argv.includes("--rebuild")) {
    console.log(`[dist-fresh] ${first.fresh ? "fresh" : "stale"}: ${first.why}`);
    process.exit(first.fresh ? 0 : 1);
  }
  if (dist !== defaultDist) { console.error(`[dist-fresh] stale: ${first.why} (and --rebuild only builds ${defaultDist})`); process.exit(2); }
  console.log(`[dist-fresh] stale: ${first.why} — rebuilding client/dist against ${api || "http://localhost:5601"}`);
  const env = { ...process.env };
  if (api) env.API = api;
  const quiet = process.env.DIST_FRESH_VERBOSE !== "1";
  const r = spawnSync("bash", [path.join(repo, "scripts", "build-local-dist.sh")], { cwd: repo, env, stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (r.status !== 0) {
    if (quiet) process.stderr.write(String(r.stdout || "").split("\n").slice(-20).join("\n") + String(r.stderr || "").split("\n").slice(-20).join("\n"));
    // A failed build must not leave the OLD dist behind for the legs to walk:
    // with no dist they skip (and REQUIRE_BROWSER=1 turns that red in CI).
    fs.rmSync(dist, { recursive: true, force: true });
    console.error("[dist-fresh] the client build failed; removed client/dist so nothing tests old code");
    process.exit(2);
  }
  const after = check({ repo, dist, api });
  console.log(`[dist-fresh] ${after.fresh ? "fresh" : "stale"}: ${after.why}`);
  process.exit(after.fresh ? 0 : 2);
}
