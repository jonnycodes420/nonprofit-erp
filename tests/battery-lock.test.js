// tests/battery-lock.test.js: FIX-58 item 8. A BATTERY NEVER DELETES A LOCK
// IT DOES NOT OWN. Pure shell + node, no server, no database.
//
// FIX-57's battery deleted SECURE-2's lock, and SECURE-2's servers then shared
// the scratch Postgres with a second battery. The lock (tests/lib/battery-lock.sh,
// sourced by run-all.sh) is an atomic mkdir holding the owner's pid. The hole
// was the stale takeover: several runs waiting on a dead owner's lock all read
// the same dead pid, the first removed it and took the lock, and the next one,
// still acting on what it had read a moment earlier, removed the new owner's
// lock. Every lock removal now happens under a takeover mutex and re-reads the
// pid inside it, so only a lock whose pid is still the dead one is ever removed.
//
//   §1 eight waiters on one stale lock: at no moment do two of them hold it,
//      and every one of them gets it in turn
//   §2 a lock held by a live pid that is not ours is never removed: not by a
//      waiter, not by lock_release
//   §3 a lock with no pid yet (between mkdir and the pid write) is not stale
//   §4 FIX-60 item 6, the battery's other shared thing: client/dist. A dist
//      built before a merge, a rebase or an uncommitted client edit is STALE
//      (scripts/dist-fresh.js, run against a throwaway git repo and a fake
//      dist), and run-all.sh and the pre-push hook rebuild through it instead
//      of reusing whatever dist is built against the same port. Red on main:
//      the checker did not exist and run-all.sh's only test was that grep.
//
// Red on main's logic (the lock code moved into tests/lib verbatim): §1 saw two
// holders at once. Run: node tests/battery-lock.test.js
const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const LIB = path.join(__dirname, "lib", "battery-lock.sh");
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.error("  ✗ " + name + (extra ? "  " + extra : "")); }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steward-locktest-"));
const sh = (script, opts = {}) => spawn("bash", ["-c", `source "${LIB}"; ${script}`], { stdio: ["ignore", "pipe", "pipe"], ...opts });
const deadPid = () => { const p = Number(execFileSync("bash", ["-c", "sleep 0 & echo $!"]).toString().trim()); return p; };
const done = p => new Promise(r => { let out = ""; p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d); p.on("exit", code => r({ code, out })); });

(async () => {
  // ── §1 eight waiters, one stale lock (four rounds: main's race showed in
  //    about two rounds in five) ─────────────────────────────────────────
  for (let round = 1; round <= 4; round++) {
    const dir = path.join(tmp, `s1-${round}.lock`);
    fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "pid"), String(deadPid()) + "\n");
    const log = path.join(tmp, `s1-${round}.log`);
    // Each waiter takes the lock, records enter, holds it 0.3s, records leave.
    const kids = [];
    for (let i = 0; i < 8; i++) {
      kids.push(done(sh(`LOCK_POLL_S=0.1 lock_acquire "${dir}" "w${i}"; echo "in $$" >>"${log}"; sleep 0.3; echo "out $$" >>"${log}"; lock_release "${dir}"`)));
    }
    const res = await Promise.all(kids);
    const lines = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
    let inside = 0, worst = 0;
    for (const l of lines) { inside += l.startsWith("in ") ? 1 : -1; worst = Math.max(worst, inside); }
    ok(`§1 round ${round}: never two holders at once`, worst === 1, `peak ${worst} holders · ${lines.join(" | ")}`);
    ok(`§1 round ${round}: every waiter got the lock in turn`, lines.filter(l => l.startsWith("in ")).length === 8 && res.every(r => r.code === 0));
    ok(`§1 round ${round}: the last holder released it`, !fs.existsSync(dir));
  }

  // ── §2 a live owner's lock is never removed ───────────────────────────
  {
    const dir = path.join(tmp, "s2.lock");
    const owner = spawn("sleep", ["30"]);
    fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "pid"), owner.pid + "\n");
    const waiter = sh(`LOCK_POLL_S=0.1 lock_acquire "${dir}" w`);
    await new Promise(r => setTimeout(r, 2500));
    ok("§2 a waiter leaves a live owner's lock alone", fs.readFileSync(path.join(dir, "pid"), "utf8").trim() === String(owner.pid));
    waiter.kill("SIGTERM");
    await done(sh(`lock_release "${dir}"`));
    ok("§2 lock_release leaves a lock it does not own", fs.existsSync(dir) && fs.readFileSync(path.join(dir, "pid"), "utf8").trim() === String(owner.pid));
    owner.kill("SIGTERM");
  }

  // ── §3 a lock with no pid yet is not stale ────────────────────────────
  {
    const dir = path.join(tmp, "s3.lock");
    fs.mkdirSync(dir);   // a run between its mkdir and its pid write
    const waiter = sh(`LOCK_POLL_S=0.1 lock_acquire "${dir}" w`);
    await new Promise(r => setTimeout(r, 1500));
    const marker = path.join(dir, "mine");
    ok("§3 a just-made lock with no pid is not taken in the first moments", fs.existsSync(dir) && !fs.existsSync(path.join(dir, "who")));
    fs.writeFileSync(path.join(dir, "pid"), process.pid + "\n");  // the writer catches up: a live pid
    fs.writeFileSync(marker, "");
    await new Promise(r => setTimeout(r, 1500));
    ok("§3 once its pid is written, the lock stays its owner's", fs.existsSync(marker));
    waiter.kill("SIGTERM");
  }

  // ── §4 a client/dist from before a merge is stale (FIX-60 item 6) ─────
  {
    const root = path.join(__dirname, "..");
    const CHECK = path.join(root, "scripts", "dist-fresh.js");
    const repo = path.join(tmp, "s4-repo"), dist = path.join(tmp, "s4-dist");
    const g = (...a) => execFileSync("git", a, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    const put = (f, body) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), body); };
    const run = (...a) => {
      try { return { code: 0, out: execFileSync("node", [CHECK, "--repo", repo, "--dist", dist, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString() }; }
      catch (e) { return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; }
    };
    const fakeDist = (sha, api = "http://localhost:6110") => {
      fs.rmSync(dist, { recursive: true, force: true });
      fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
      fs.writeFileSync(path.join(dist, "index.html"), `<html><head><meta name="build-sha" content="${sha}"></head></html>`);
      fs.writeFileSync(path.join(dist, "assets", "index-abc.js"), `const API="${api}";`);
    };
    const haveChecker = fs.existsSync(CHECK);
    ok("§4 scripts/dist-fresh.js exists (the one freshness check)", haveChecker);
    if (haveChecker) {
      fs.mkdirSync(repo);
      g("init", "-q"); g("config", "user.email", "t@example.org"); g("config", "user.name", "t");
      put("client/src/a.js", "export const a = 1;\n"); put("shared/b.js", "module.exports = 2;\n"); put("tests/t.test.js", "// not a client input\n");
      g("add", "-A"); g("commit", "-qm", "one");
      const old = g("rev-parse", "HEAD");
      put("client/src/a.js", "export const a = 2;\n"); g("commit", "-qam", "two (the merge)");
      const head = g("rev-parse", "HEAD");
      const api = ["--api", "http://localhost:6110"];

      let r;
      fs.rmSync(dist, { recursive: true, force: true });
      r = run(...api); ok("§4 no dist at all is stale", r.code === 1 && /stale: no client build/.test(r.out), r.out);
      fakeDist(old);
      r = run(...api); ok("§4 a dist stamped with the commit before the merge is stale, though it is built against the same port", r.code === 1 && /stale: built from/.test(r.out), r.out);
      fakeDist(head);
      r = run(...api); ok("§4 a dist stamped with HEAD on a clean tree is fresh", r.code === 0 && /fresh:/.test(r.out), r.out);
      r = run("--api", "http://localhost:6120"); ok("§4 a dist built against another API port is stale", r.code === 1 && /another API/.test(r.out), r.out);
      put("tests/t.test.js", "// edited\n");
      r = run(...api); ok("§4 an uncommitted edit outside the client's inputs leaves it fresh", r.code === 0, r.out);
      put("client/src/a.js", "export const a = 3;\n");
      r = run(...api); ok("§4 an uncommitted client edit makes a dist built at HEAD stale", r.code === 1 && /uncommitted/.test(r.out), r.out);

      // The stamp build-local-dist.sh writes: the fingerprint taken before the build.
      const fp = execFileSync("node", [CHECK, "--repo", repo, "--fingerprint"]).toString().trim();
      ok("§4 the fingerprint is HEAD plus a hash of the uncommitted edit", fp.startsWith(head + "+") && fp.length > 41, fp);
      execFileSync("node", [CHECK, "--repo", repo, "--dist", dist, "--stamp", fp, ...api]);
      r = run(...api); ok("§4 a dist stamped with the fingerprint of these very edits is fresh", r.code === 0, r.out);
      put("client/src/a.js", "export const a = 4;\n");
      r = run(...api); ok("§4 another edit after that build makes it stale again", r.code === 1 && /uncommitted/.test(r.out), r.out);
      put("shared/new.js", "module.exports = 5;\n");
      g("checkout", "-q", "--", "client/src/a.js");
      r = run(...api); ok("§4 a new untracked file in shared/ makes it stale", r.code === 1, r.out);
      fs.rmSync(path.join(repo, "shared", "new.js"));
      r = run(...api); ok("§4 a stamped dist whose edits were reverted is stale (it holds code that is gone)", r.code === 1, r.out);
      execFileSync("node", [CHECK, "--repo", repo, "--dist", dist, "--stamp", head, ...api]);
      r = run(...api); ok("§4 a clean stamp at HEAD on a clean tree is fresh", r.code === 0, r.out);
      put("client/src/a.js", "export const a = 9;\n"); g("commit", "-qam", "three");
      r = run(...api); ok("§4 a commit after the build makes the stamped dist stale", r.code === 1 && /stale: built from/.test(r.out), r.out);

      // --rebuild never builds anything but the repo's own client/dist, and
      // --if-present leaves a dist that is not ours alone.
      r = run("--rebuild", ...api); ok("§4 --rebuild refuses a dist path it would not build into", r.code === 2, r.out);
      fs.rmSync(dist, { recursive: true, force: true });
      r = run("--rebuild", "--if-present", ...api); ok("§4 --rebuild --if-present leaves a missing dist alone", r.code === 0 && /left alone/.test(r.out), r.out);
    }

    // The two callers ask it, and the port-only reuse is gone.
    const runAll = fs.readFileSync(path.join(root, "tests", "run-all.sh"), "utf8");
    const prePush = fs.readFileSync(path.join(root, ".githooks", "pre-push"), "utf8");
    const bld = fs.readFileSync(path.join(root, "scripts", "build-local-dist.sh"), "utf8");
    ok("§4 run-all.sh rebuilds the browser shard's dist through dist-fresh.js", /node scripts\/dist-fresh\.js --rebuild --api "http:\/\/localhost:\$bapi"/.test(runAll));
    ok("§4 run-all.sh no longer reuses any dist built against the same port", !/grep -rqs "localhost:\$bapi" client\/dist/.test(runAll));
    ok("§4 the pre-push hook checks the dist before running suites on a live server", /node scripts\/dist-fresh\.js --rebuild --if-present --api "\$hbase"/.test(prePush));
    ok("§4 build-local-dist.sh stamps the fingerprint it took before the build", /FP="\$\(node \.\.\/scripts\/dist-fresh\.js --fingerprint/.test(bld) && /--stamp "\$FP"/.test(bld) && bld.indexOf("--fingerprint") < bld.indexOf("npm run build"));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
