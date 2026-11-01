#!/usr/bin/env node
// scripts/ci/builder-access-check.js · SECURE-3 item 5. BUILDERS CAN'T REACH PROD.
//
// A build tab needs to push to GitHub and read CI. It must not hold a way into
// production: a Railway token (logs, env vars, redeploys), the prod database's
// connection string, or a Supabase key or access token
// (docs/security/builder-access.md says what goes where).
//
//   node scripts/ci/builder-access-check.js      exit 1 on a FAILURE, 0 otherwise
//
// tests/script-guards.test.js runs it in the battery (the test job in CI, and
// every local battery), with the battery's own environment, and plants each
// failure in a child's environment to prove it goes red.
//
// FAILURES (in the environment of the process that runs it):
//   · a Railway token variable (RAILWAY_TOKEN, RAILWAY_API_TOKEN,
//     RAILWAY_PROJECT_TOKEN, any RAILWAY_*TOKEN*);
//   · a Supabase secret variable (SUPABASE_ACCESS_TOKEN,
//     SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_KEY, SUPABASE_DB_PASSWORD,
//     SUPABASE_JWT_SECRET);
//   · ANY variable whose value holds a postgres:// URL to a host that is not
//     loopback (supabase.co, pooler.supabase.com, rlwy.net, railway.internal,
//     or anything else), and a PGHOST that is not loopback.
// Only the variable's NAME is ever printed, never its value.
//
// WARNINGS (this machine's own logins, found in the home folder):
//   · the Railway CLI logged in as a user (~/.railway/config.json user token):
//     a full-account login that reads logs and env vars of every project;
//   · a Railway MCP server in ~/.claude.json, which acts through that login;
//   · the Supabase CLI logged in (~/.supabase/access-token or
//     ~/.config/supabase/access-token);
//   · the Vercel CLI logged in (its auth.json), which deploys past CI.
// They are present on Jonathan's machine today, so a fatal check would turn
// every local battery red. MACHINE_LOGIN_FATAL turns them into failures.

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

// Jonathan flips this to true once he has run `railway logout` on the build
// machine and removed the railway MCP server from ~/.claude.json
// (docs/security/builder-access.md, steps 2 and 3). From then on a build
// machine that logs back in fails the battery.
const MACHINE_LOGIN_FATAL = false;

const TOKEN_NAMES = [
  /^RAILWAY_[A-Z0-9_]*TOKEN[A-Z0-9_]*$/,
  /^SUPABASE_(ACCESS_TOKEN|SERVICE_ROLE_KEY|SERVICE_KEY|DB_PASSWORD|JWT_SECRET)$/,
];
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);
const PG_URL = /postgres(?:ql)?:\/\/[^\s'"]+/gi;
const isLoopbackHost = h => LOOPBACK.has(String(h || "").toLowerCase()) || /^127\./.test(h || "") || String(h).startsWith("/");

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

// Pure: { env, home, machineFatal } -> { failures: [sentences], warnings: [sentences] }
function check({ env = process.env, home = os.homedir(), machineFatal = MACHINE_LOGIN_FATAL } = {}) {
  const failures = [];
  const warnings = [];

  for (const name of Object.keys(env).sort()) {
    const value = env[name];
    if (value == null || value === "") continue;
    if (TOKEN_NAMES.some(re => re.test(name))) {
      failures.push(`${name} is set: a build environment never holds a Railway token or a Supabase secret (docs/security/builder-access.md).`);
      continue;
    }
    for (const m of String(value).match(PG_URL) || []) {
      const h = hostOf(m);
      if (h === null || !isLoopbackHost(h)) {
        failures.push(`${name} holds a postgres URL to a host that is not loopback: a build environment never holds a remote database's connection string.`);
        break;
      }
    }
  }
  if (env.PGHOST && !isLoopbackHost(env.PGHOST)) failures.push("PGHOST names a host that is not loopback.");

  const machine = [];
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
  const rw = readJson(path.join(home, ".railway", "config.json"));
  if (rw && rw.user && (rw.user.token || rw.user.accessToken || rw.user.refreshToken)) {
    machine.push("The Railway CLI on this machine is logged in as a user (~/.railway/config.json): that login reads every project's logs and variables. Run `railway logout` (docs/security/builder-access.md step 2).");
  }
  const cj = readJson(path.join(home, ".claude.json"));
  if (cj) {
    const servers = [["", cj.mcpServers], ...Object.entries(cj.projects || {}).map(([p, v]) => [p, v && v.mcpServers])];
    for (const [where, s] of servers) {
      for (const [k, v] of Object.entries(s || {})) {
        const cmd = [v && v.command, ...((v && v.args) || []), v && v.url].filter(Boolean).join(" ");
        if (/railway/i.test(k) || /\brailway\b|railway\.(app|com)/i.test(cmd)) {
          machine.push(`~/.claude.json configures a Railway MCP server ("${k}"${where ? " for " + where : ""}), which acts through the Railway login. Remove it (docs/security/builder-access.md step 3).`);
        }
      }
    }
  }
  for (const f of [path.join(home, ".supabase", "access-token"), path.join(home, ".config", "supabase", "access-token")]) {
    if (fs.existsSync(f)) machine.push(`The Supabase CLI on this machine is logged in (${f.replace(home, "~")}). Run \`supabase logout\` (docs/security/builder-access.md step 4).`);
  }
  for (const f of [path.join(home, "Library", "Application Support", "com.vercel.cli", "auth.json"), path.join(home, ".local", "share", "com.vercel.cli", "auth.json")]) {
    const v = readJson(f);
    if (v && v.token) machine.push(`The Vercel CLI on this machine is logged in (${f.replace(home, "~")}): it can deploy the frontend past CI and read its variables. Run \`vercel logout\` (docs/security/builder-access.md step 5).`);
  }
  (machineFatal ? failures : warnings).push(...machine);
  return { failures, warnings };
}

if (require.main === module) {
  const { failures, warnings } = check();
  for (const w of warnings) console.log("  WARNING  " + w);
  for (const f of failures) console.log("  FAIL     " + f);
  if (!failures.length) console.log(`builder access: no prod credential in this environment${warnings.length ? ` (${warnings.length} machine-level warning(s) above; MACHINE_LOGIN_FATAL is ${MACHINE_LOGIN_FATAL})` : ""}`);
  process.exit(failures.length ? 1 : 0);
}

module.exports = { check, MACHINE_LOGIN_FATAL };
