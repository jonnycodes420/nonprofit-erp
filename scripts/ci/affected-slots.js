// scripts/ci/affected-slots.js — CI-SPEED-1. THE TWO SLOTS `npm run affected` RUNS IN.
//
// The battery lock (tests/lib/battery-lock.sh) is one machine-wide exclusive
// lock, because two full batteries ran the scratch Postgres out of
// connections. `affected` runs ten minutes of suites against ONE server, so
// two of them at once fit easily. So instead of the battery lock it takes:
//
//   1. its worktree's slot (`affected-wt-<tag>.lock`): a worktree's run boots
//      its own database by name, so two runs in ONE worktree would collide;
//   2. one of SLOTS (2) machine slots (`affected-slot-<n>.lock`).
//
// A lock is a directory made with an atomic mkdir, holding the owner's pid,
// like the battery lock. The rules are the battery lock's (FIX-58):
//   · a lock is released only by the process whose pid is in it;
//   · a stale lock (its pid is gone) is taken over only under a mutex
//     (`<lock>.takeover`) after re-reading its pid inside the mutex, so a lock
//     that changed hands is never removed;
//   · a lock with no pid yet is a run between its mkdir and its pid write and
//     is stale only after EMPTY_S seconds.
//
// It never waits longer than the caller says (2 minutes from affected.js).
// When it would, it gives up and the caller says "skipping to the push".
const fs = require("fs");
const path = require("path");

const EMPTY_S = 10;
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const readPid = dir => { try { return parseInt(fs.readFileSync(path.join(dir, "pid"), "utf8"), 10) || 0; } catch { return 0; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function tryLock(dir, who) {
  try { fs.mkdirSync(dir); } catch { return false; }
  fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
  if (who) fs.writeFileSync(path.join(dir, "who"), who);
  return true;
}

// Removes `dir` only if its pid is still `seen` and dead (or empty for EMPTY_S).
function takeStale(dir, seen) {
  const mutex = dir + ".takeover";
  try { fs.mkdirSync(mutex); } catch {
    const m = readPid(mutex);
    if (m && !alive(m)) fs.rmSync(mutex, { recursive: true, force: true });
    return false;
  }
  let removed = false;
  try {
    fs.writeFileSync(path.join(mutex, "pid"), String(process.pid));
    if (fs.existsSync(dir) && readPid(dir) === seen && !alive(seen)) {
      fs.rmSync(dir, { recursive: true, force: true }); removed = true;
    }
  } finally { fs.rmSync(mutex, { recursive: true, force: true }); }
  return removed;
}

// One pass over a lock: true when we now hold it.
const emptySince = new Map();
function attempt(dir, who) {
  if (tryLock(dir, who)) return true;
  const held = readPid(dir);
  if (held && alive(held)) { emptySince.delete(dir); return false; }
  if (!held) {
    if (!fs.existsSync(dir)) return tryLock(dir, who);
    if (!emptySince.has(dir)) emptySince.set(dir, Date.now());
    if (Date.now() - emptySince.get(dir) < EMPTY_S * 1000) return false;
  }
  return takeStale(dir, held) && tryLock(dir, who);
}

function release(dir) {
  if (dir && readPid(dir) === process.pid) fs.rmSync(dir, { recursive: true, force: true });
}

const who = dir => { try { return fs.readFileSync(path.join(dir, "who"), "utf8").trim(); } catch { return "?"; } };

// acquire({ dir, tag, slots, waitS, pollMs, onWait }) →
//   { ok: true, slot, held: [dirs], waited } or { ok: false, waited, holders }
async function acquire({ dir, tag, slots = 2, waitS = 120, pollMs = 1000, onWait = () => {} }) {
  fs.mkdirSync(dir, { recursive: true });
  const label = `worktree '${tag}' · pid ${process.pid} · started ${new Date().toTimeString().slice(0, 8)}`;
  const wt = path.join(dir, `affected-wt-${tag}.lock`);
  const slotDirs = Array.from({ length: slots }, (_, i) => path.join(dir, `affected-slot-${i + 1}.lock`));
  const t0 = Date.now();
  let haveWt = false, said = "";
  for (;;) {
    if (!haveWt) haveWt = attempt(wt, label);
    if (haveWt) {
      for (let i = 0; i < slotDirs.length; i++) {
        if (attempt(slotDirs[i], label)) {
          const cleanup = () => { release(slotDirs[i]); release(wt); };
          process.on("exit", cleanup);
          return { ok: true, slot: i + 1, held: [slotDirs[i], wt], waited: Math.round((Date.now() - t0) / 1000), release: cleanup };
        }
      }
    }
    const holders = haveWt ? slotDirs.map(who) : [who(wt) + " (this worktree's own run)"];
    const line = holders.join(" | ");
    if (line !== said) { onWait(holders); said = line; }
    if (Date.now() - t0 >= waitS * 1000) {
      if (haveWt) release(wt);
      return { ok: false, waited: Math.round((Date.now() - t0) / 1000), holders };
    }
    await sleep(pollMs);
  }
}

module.exports = { acquire, release, tryLock, takeStale };
