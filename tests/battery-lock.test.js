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

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
