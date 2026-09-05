// BUILD-79 Part 7.3 — THE DEPLOY ARTIFACT IS A CODE PATH.
//
// BUILD-78 put customFieldShape.js in client/src/lib/ so client, server and
// suites shared it byte-for-byte. The Railway backend deploys a tarball that
// .railwayignore strips client/ out of — the module resolved on every machine
// the battery ever ran on and on NO machine that serves production. 119 suites
// were green against a file that did not exist where the customer is; the first
// prod use (GET /donors/export/csv, Sept 5 19:34 UTC) threw
// ERR_MODULE_NOT_FOUND. This suite makes that class impossible to ship again:
//
//   1. Build the deploy artifact's file list the way `railway up` does
//      (git-tracked files minus .railwayignore patterns — CI deploys a fresh
//      checkout, so tracked-minus-ignored IS the artifact).
//   2. Statically resolve every relative require()/import()/import-from in the
//      server tree, transitively from package.json's main. Every resolved file
//      must be inside the artifact. A path that escapes it fails with the
//      importing file named.
//   3. ESM-marker check: a resolved file using top-level import/export syntax
//      must have a nearest package.json IN THE ARTIFACT declaring
//      "type":"module" (or be .mjs) — the exact secondary failure the fix
//      itself hit (shared/*.js parsed as CJS until shared/package.json landed).
//
// PROVEN ABLE TO FAIL (the BUILD-75 A.6 rule): §4 runs the same checker over a
// synthetic tree carrying the exact BUILD-78 defect (server importing under an
// ignored client/) and over one missing the ESM marker — both must be flagged.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed++; } else { failed++; console.log("  FAIL  " + label); } };

// ── the checker (parameterized by root so §4 can prove it red) ─────────────

function parseIgnore(rootDir) {
  const p = path.join(rootDir, ".railwayignore");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
}

function ignoredBy(patterns, relPath) {
  return patterns.some(pat => {
    if (pat.endsWith("/")) return relPath === pat.slice(0, -1) || relPath.startsWith(pat);
    if (pat.startsWith("*.")) return relPath.endsWith(pat.slice(1));
    return relPath === pat || relPath.startsWith(pat + "/");
  });
}

// The artifact: files present in the deployed checkout minus .railwayignore.
// For the real repo that's `git ls-files`; a synthetic tree walks the disk.
function artifactSet(rootDir, { useGit }) {
  const patterns = parseIgnore(rootDir);
  let files;
  if (useGit) {
    files = execSync("git ls-files", { cwd: rootDir }).toString().trim().split("\n");
  } else {
    files = [];
    const walk = d => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else files.push(path.relative(rootDir, full));
      }
    };
    walk(rootDir);
  }
  return new Set(files.filter(f => !ignoredBy(patterns, f)));
}

// Every relative specifier a server file can pull in: require("./x"),
// import("./x"), import … from "./x", export … from "./x".
const SPEC_RE = /(?:require\(\s*|import\(\s*|(?:^|\s)import\s+(?:[\w${}\s,*]+\s+from\s+)?|(?:^|\s)export\s+(?:[\w${}\s,*]+\s+)?from\s+)["'](\.{1,2}\/[^"']+)["']/gm;

function resolveSpec(rootDir, fromRel, spec) {
  const base = path.join(path.dirname(fromRel), spec);
  for (const cand of [base, base + ".js", base + ".mjs", base + ".cjs", path.join(base, "index.js")]) {
    if (fs.existsSync(path.join(rootDir, cand))) return cand.split(path.sep).join("/");
  }
  return null;
}

function usesEsmSyntax(src) {
  return /^\s*(import\s|export\s)/m.test(src.replace(/\/\/[^\n]*/g, ""));
}

function nearestPkgTypeModule(rootDir, fileRel, artifact) {
  let dir = path.dirname(fileRel);
  while (true) {
    const pkgRel = dir === "." ? "package.json" : dir + "/package.json";
    if (artifact.has(pkgRel)) {
      try { return JSON.parse(fs.readFileSync(path.join(rootDir, pkgRel), "utf8")).type === "module"; }
      catch { return false; }
    }
    if (dir === ".") return false;
    dir = path.dirname(dir);
  }
}

// checkDeployShape(rootDir, entryRel) → { escapes:[{from,spec}], unresolved:[...], esmUnmarked:[...] , visited:N }
function checkDeployShape(rootDir, entryRel, { useGit } = {}) {
  const artifact = artifactSet(rootDir, { useGit });
  const escapes = [], unresolved = [], esmUnmarked = [];
  const seen = new Set();
  const queue = [entryRel];
  while (queue.length) {
    const fileRel = queue.shift();
    if (seen.has(fileRel)) continue;
    seen.add(fileRel);
    const abs = path.join(rootDir, fileRel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    if (fileRel.endsWith(".js") && usesEsmSyntax(src) && !nearestPkgTypeModule(rootDir, fileRel, artifact)) {
      esmUnmarked.push(fileRel);
    }
    let m;
    SPEC_RE.lastIndex = 0;
    while ((m = SPEC_RE.exec(src))) {
      const resolved = resolveSpec(rootDir, fileRel, m[1]);
      if (!resolved) { unresolved.push({ from: fileRel, spec: m[1] }); continue; }
      if (!artifact.has(resolved)) { escapes.push({ from: fileRel, spec: m[1], resolved }); continue; }
      queue.push(resolved);
    }
  }
  return { escapes, unresolved, esmUnmarked, visited: seen.size };
}

(async () => {
  console.log("— §1 · the real artifact contains every server import —");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const entry = pkg.main || "server.js";
  const r = checkDeployShape(ROOT, entry, { useGit: true });
  ok(r.visited > 5, `resolver actually walked the server tree (visited ${r.visited} files)`);
  ok(r.escapes.length === 0,
    `every server-tree import resolves INSIDE the deploy artifact — escapes: ${JSON.stringify(r.escapes)}`);
  ok(r.unresolved.length === 0,
    `every relative specifier in the server tree resolves to a real file — unresolved: ${JSON.stringify(r.unresolved)}`);

  console.log("— §2 · the shared modules are in the artifact, with their ESM marker —");
  const artifact = artifactSet(ROOT, { useGit: true });
  ok(artifact.has("shared/customFieldShape.js"), "shared/customFieldShape.js is in the deploy artifact");
  ok(artifact.has("shared/importShape.js"), "shared/importShape.js is in the deploy artifact");
  ok(artifact.has("shared/package.json"), "shared/package.json (the type:module marker) is in the deploy artifact");
  ok(r.esmUnmarked.length === 0,
    `every ESM-syntax server-tree file has an in-artifact type:module marker — unmarked: ${JSON.stringify(r.esmUnmarked)}`);

  console.log("— §3 · the ignore file still strips what it must (the guard reads the REAL rules) —");
  const patterns = parseIgnore(ROOT);
  ok(ignoredBy(patterns, "client/src/lib/anything.js"), "client/ is excluded from the artifact (frontend deploys via Vercel)");
  ok(!ignoredBy(patterns, "shared/customFieldShape.js"), "shared/ is NOT excluded");
  ok(!artifact.has("client/src/components/Donors.jsx"), "a client file is genuinely outside the computed artifact");

  console.log("— §4 · proven able to fail: the BUILD-78 defect on a synthetic tree —");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-shape-"));
  fs.writeFileSync(path.join(tmp, ".railwayignore"), "client/\n");
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ main: "server.js" }));
  fs.writeFileSync(path.join(tmp, "server.js"),
    'async function cfShape() { return import("./client/src/lib/customFieldShape.js"); }\nmodule.exports = { cfShape };\n');
  fs.mkdirSync(path.join(tmp, "client/src/lib"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "client/src/lib/customFieldShape.js"), "export const x = 1;\n");
  const bad = checkDeployShape(tmp, "server.js", { useGit: false });
  ok(bad.escapes.length === 1 && bad.escapes[0].resolved === "client/src/lib/customFieldShape.js",
    `the checker FLAGS the exact BUILD-78 defect (server import under an ignored client/) — got ${JSON.stringify(bad.escapes)}`);

  // the secondary defect: shared module in-artifact but no type:module marker
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-shape-"));
  fs.writeFileSync(path.join(tmp2, ".railwayignore"), "client/\n");
  fs.writeFileSync(path.join(tmp2, "package.json"), JSON.stringify({ main: "server.js" }));
  fs.writeFileSync(path.join(tmp2, "server.js"), 'import("./shared/x.js");\n');
  fs.mkdirSync(path.join(tmp2, "shared"));
  fs.writeFileSync(path.join(tmp2, "shared/x.js"), "export const x = 1;\n");
  const bad2 = checkDeployShape(tmp2, "server.js", { useGit: false });
  ok(bad2.escapes.length === 0 && bad2.esmUnmarked.includes("shared/x.js"),
    `the checker FLAGS an in-artifact ESM file with no type:module marker — got ${JSON.stringify(bad2.esmUnmarked)}`);
  // and goes green once the marker exists (the fix is what makes it pass)
  fs.writeFileSync(path.join(tmp2, "shared/package.json"), '{"type":"module"}');
  const good2 = checkDeployShape(tmp2, "server.js", { useGit: false });
  ok(good2.esmUnmarked.length === 0, "the marker fix turns the synthetic tree green");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(tmp2, { recursive: true, force: true });

  console.log(`deploy-shape: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
