// scripts/lib/prodGuard.js — the two-layer prod-write guard (BUILD-55 Part 1).
//
// Born from the 2026-08-15 incident: seed-build50-demo.js defaulted BASE to prod,
// a bare run meant for the local capture fixture silently re-PUT prod org_creo's
// theme, and the replaced banner asset was reference-count pruned — no undo.
// Recovery depended on an incidental local copy of the bytes, not on any backup.
//
// THE RULE (load-bearing, pinned by tests/script-guards.test.js):
//   Layer 1 — every script that can WRITE through BASE defaults to loopback.
//             Prod is ALWAYS an explicit BASE= opt-in.
//   Layer 2 — a non-loopback BASE additionally requires --i-know-this-is-prod.
//             A typo'd or copy-pasted BASE= alone is NOT enough to write to prod.
//   Layer 3 — before overwriting remote state, log (and save) what is there now.
//             The saved bytes were the whole recovery last time.
//
// Usage in a writer script:
//   const { writerBase, logOverwrite } = require("./lib/prodGuard");
//   const BASE = writerBase("http://localhost:5601");
//   ...
//   if (guard.isRemote) await logOverwrite("portal-settings-" + slug, currentRow);
//
// Read-only scripts (landing verifies, consistency-audit, pure captures whose only
// POST is /auth/login) deliberately do NOT use writerBase — they may default to
// prod because they change nothing. tests/script-guards.test.js enumerates them.

const fs = require("fs");
const path = require("path");

const CONFIRM_FLAG = "--i-know-this-is-prod";
const LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i;

function isLoopback(url) {
  return LOOPBACK_RE.test(String(url || ""));
}

// Resolve BASE for a WRITING script. `def` must itself be loopback — a writer
// script can never ship a prod default again.
function writerBase(def, opts = {}) {
  const env = opts.env || process.env;
  const argv = opts.argv || process.argv;
  if (!isLoopback(def)) {
    throw new Error(`prodGuard.writerBase: default "${def}" is not loopback — writer scripts must default to the scratch stack`);
  }
  const base = (env.BASE || def).replace(/\/+$/, "");
  if (!isLoopback(base)) {
    if (!argv.includes(CONFIRM_FLAG)) {
      console.error(
        `\nREFUSED: BASE=${base} is not loopback.\n` +
        `Writing to a remote host requires BOTH an explicit BASE= AND ${CONFIRM_FLAG}.\n` +
        `(Two layers on purpose — a typo in BASE must not be enough to write to prod.)\n`
      );
      if (opts.noExit) { const e = new Error("prod_confirm_required"); e.code = "prod_confirm_required"; throw e; }
      process.exit(1);
    }
    console.error(`\n*** WRITING TO REMOTE HOST: ${base} ***`);
    console.error(`*** Log/save anything you are about to overwrite — there is no server-side undo. ***\n`);
  }
  writerBase.lastBase = base;
  return base;
}

// True when the resolved BASE points off-box.
function isRemote(base) {
  return !isLoopback(base ?? writerBase.lastBase);
}

// Layer 3: record current remote state before overwriting it. Console summary
// always; a JSON snapshot file only for remote targets (local runs stay quiet).
// Snapshots land in docs/prod-write-backups/ — committed on purpose: they are
// the recovery bytes AND an auditable trail of every prod overwrite.
function logOverwrite(label, current, opts = {}) {
  const base = opts.base ?? writerBase.lastBase;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const summary = typeof current === "string" ? current.slice(0, 400) : JSON.stringify(current)?.slice(0, 400);
  console.log(`[overwrite] ${label} — current state before write: ${summary || "(empty)"}`);
  if (!isLoopback(base)) {
    const dir = opts.dir || path.join(__dirname, "..", "..", "docs", "prod-write-backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${stamp}-${label.replace(/[^a-z0-9_-]+/gi, "_")}.json`);
    fs.writeFileSync(file, JSON.stringify({ base, label, savedAt: new Date().toISOString(), current }, null, 2));
    console.log(`[overwrite] saved pre-write snapshot: ${file}`);
    return file;
  }
  return null;
}

// Same two-layer rule for scripts that write to the DATABASE directly.
function writerDbUrl(opts = {}) {
  const env = opts.env || process.env;
  const argv = opts.argv || process.argv;
  const url = env.DATABASE_URL || "";
  if (!url) {
    console.error("Set DATABASE_URL first (scratch: postgresql://steward@localhost:5544/steward_loadtest).");
    if (opts.noExit) { const e = new Error("db_url_required"); e.code = "db_url_required"; throw e; }
    process.exit(1);
  }
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    if (!argv.includes(CONFIRM_FLAG)) {
      console.error(
        `\nREFUSED: DATABASE_URL points at a remote database.\n` +
        `Writing to a remote DB requires ${CONFIRM_FLAG} in addition to DATABASE_URL.\n`
      );
      if (opts.noExit) { const e = new Error("prod_confirm_required"); e.code = "prod_confirm_required"; throw e; }
      process.exit(1);
    }
    console.error(`\n*** WRITING TO REMOTE DATABASE ***\n`);
  }
  return url;
}

module.exports = { writerBase, writerDbUrl, logOverwrite, isLoopback, isRemote, CONFIRM_FLAG };
