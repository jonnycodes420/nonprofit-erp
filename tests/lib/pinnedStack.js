// tests/lib/pinnedStack.js · FLAKE-1. A SUITE ON A CLOCK OF ITS OWN.
//
// House rule (house.md, CLOCK-1): no test reads the real clock. A shard's
// clock can be pinned for the whole shard (tests/shard.sh, STEWARD_TEST_NOW),
// but CI runs shards on the real clock, so a suite whose answer depends on
// the civil day ran at whatever hour CI happened to start it.
// surfaces-agree went red that way (4 Nov 22:07 and 5 Nov 23:10 New York,
// when New York and UTC are on different days) on changes that touched none
// of its surfaces.
//
// runPinnedOrContinue(file) gives the suite a stack of its own, on one
// instant: a database beside the shard's on the same Postgres, whose now() is
// moved by the offset (the testclock schema shard.sh installs), and a
// server.js on a free port with tests/clock.js preloaded at the same offset.
// It runs `file` again as a child against that stack, then stops the server
// and drops the database. The instant is the next noon in New York (never
// earlier than the real clock: clock.js says why), when New York and UTC
// share a day and no midnight is near.
//
// A run that already pinned its own clock (STEWARD_TEST_OFFSET_MS, the
// 00:30 / 21:00 / noon proof runs) is left on that clock: the instant was
// chosen on purpose. Sends nothing: the server's mail and Stripe point at a
// port nothing listens on.
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { nyNoon, civilDay, dayOffset, testNow, RealDate } = require("../clock");

const ROOT = path.join(__dirname, "..", "..");
const CLOCK = path.join(ROOT, "tests", "clock.js");
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// FLAKE-2: the next h:00 in New York at least a minute from now (21 for the
// 9 PM Eastern cases, when New York and UTC are on different days).
function nextNyHour(h, now = testNow()) {
  for (let d = 0; d <= 2; d++) {
    const day = dayOffset(d, now);
    const t = nyNoon(day) + (h - 12) * 3600e3;   // h:00 that New York day (no DST change falls in the evening)
    if (t >= now + 60000) return t;
  }
  throw new Error(`pinnedStack: no ${h}:00 in New York in the next two days`);
}

// The next noon in New York at least a minute from now.
// (Only an unpinned run gets here, so testNow() is the machine's own now.)
function nextNoon(now = testNow()) {
  const t = nyNoon(civilDay(now));
  return t >= now + 60000 ? t : nyNoon(dayOffset(1, now));
}

async function pg(url, sqls) {
  const { Client } = require(path.join(ROOT, "node_modules", "pg"));
  const ssl = process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(url) ? false : undefined;
  const c = new Client({ connectionString: url, ssl });
  await c.connect();
  try { const out = []; for (const s of sqls) out.push((await c.query(s)).rows); return out; } finally { await c.end(); }
}

// Returns true when the caller should go on and run its checks here (this
// process IS the pinned child, or the run is already pinned). Otherwise it
// runs the pinned child, exits with its code, and returns false.
//
// FLAKE-2: a suite can name its own instant, `{ at: () => nextNyHour(21) }`,
// and only that suite runs at it: the run's clock, and every other suite's,
// is untouched. A suite that names its instant keeps it even when the run is
// pinned (the run's pin is then the "now" its instant is counted from), so
// its hour never depends on when, or how, the battery started.
function runPinnedOrContinue(file, { at = null } = {}) {
  if (process.env.FLAKE1_PINNED_CHILD === "1") {
    if (!process.env.STEWARD_TEST_OFFSET_MS) throw new Error("pinnedStack: the child has no clock offset");
    return true;
  }
  if (process.env.STEWARD_TEST_OFFSET_MS && !at) return true;
  main(file, at).then(code => process.exit(code), e => { console.error("pinnedStack:", e); process.exit(1); });
  return false;
}

async function main(file, atFn = null) {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DATABASE_URL is not set");
  const u = new URL(baseUrl);
  if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) throw new Error(`refusing a non-loopback database: ${u.hostname}`);
  const dbName = `${u.pathname.slice(1).slice(0, 40)}_pin${process.pid}`.replace(/[^a-z0-9_]/gi, "_");
  const pinUrl = new URL(baseUrl); pinUrl.pathname = "/" + dbName;
  // MONEY-3: PINNED_STACK_AT=<ISO instant> pins another instant (the 11:30 PM
  // New York proof runs); never earlier than the real clock, as above.
  const asked = process.env.PINNED_STACK_AT ? RealDate.parse(process.env.PINNED_STACK_AT) : null;
  if (asked !== null && !(Number.isFinite(asked) && asked >= testNow() + 60000)) throw new Error(`pinnedStack: PINNED_STACK_AT must be an instant at least a minute ahead: ${process.env.PINNED_STACK_AT}`);
  const own = atFn ? atFn() : null;
  if (own !== null && !(Number.isFinite(own) && own >= testNow() + 60000)) throw new Error(`pinnedStack: the suite's own instant must be at least a minute ahead: ${own}`);
  const at = own !== null ? own : asked !== null ? asked : nextNoon();
  // The offset is from the REAL clock: the database's now() and the child's
  // clock.js both add it to the machine's time.
  // (testNow() less the run's own offset is the machine's time.)
  const offset = at - (testNow() - (Number(process.env.STEWARD_TEST_OFFSET_MS) || 0));
  console.log(`  pinned clock: ${new RealDate(at).toISOString()} (${own !== null ? "the suite's own instant" : asked !== null ? "PINNED_STACK_AT" : "noon in New York"}), a stack of its own on database ${dbName}`);

  // Created and dropped from the server's maintenance database, so the drop
  // works even when the shard's own database has gone first.
  const adminUrl = new URL(baseUrl); adminUrl.pathname = "/postgres";
  const [[tz]] = await pg(baseUrl, ["SHOW timezone"]);
  await pg(adminUrl.toString(), [`DROP DATABASE IF EXISTS "${dbName}"`, `CREATE DATABASE "${dbName}"`]);
  await pg(pinUrl.toString(), [
    "CREATE SCHEMA IF NOT EXISTS testclock",
    `CREATE OR REPLACE FUNCTION testclock.now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT pg_catalog.now() + interval '${offset} milliseconds' $$`,
    `CREATE OR REPLACE FUNCTION testclock.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT pg_catalog.clock_timestamp() + interval '${offset} milliseconds' $$`,
    `ALTER DATABASE "${dbName}" SET search_path = public, testclock, pg_catalog`,
    `ALTER DATABASE "${dbName}" SET timezone = '${String(tz.TimeZone || tz.timezone || "UTC").replace(/'/g, "")}'`,
  ]);

  const port = await freePort();
  const nodeOptions = `${process.env.NODE_OPTIONS || ""} -r ${CLOCK}`.trim();
  const clockEnv = { TEST_MODE: "1", STEWARD_TEST_OFFSET_MS: String(offset), NODE_OPTIONS: nodeOptions };
  const logFile = path.join(process.env.SUITE_LOG_DIR || os.tmpdir(), `pinned-server-${process.pid}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.openSync(logFile, "w");
  const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: ["ignore", log, log],
    env: { ...process.env, ...clockEnv, PORT: String(port), DATABASE_URL: pinUrl.toString(), DISABLE_BACKGROUND_TICKS: "1",
      SESSION_CACHE_TTL_MS: "0", JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", SENTRY_DSN: "",
      RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: "http://localhost:9",
      STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_API_BASE: "http://localhost:9", STRIPE_BILLING_API_BASE: "http://localhost:9" },
  });
  const exited = new Promise(r => server.on("exit", r));
  let code = 1;
  try {
    const base = `http://localhost:${port}`;
    let up = false;
    for (let i = 0; i < 1200 && !up; i++) {   // the schema build on a new database; up to five minutes
      up = await fetch(`${base}/ready`).then(r => r.ok, () => false);
      if (!up) { if (server.exitCode != null) break; await sleep(250); }
    }
    if (!up) { console.error(fs.readFileSync(logFile, "utf8").slice(-2000)); throw new Error(`the pinned server on :${port} did not start`); }
    const child = spawn(process.execPath, [file], { cwd: ROOT, stdio: "inherit",
      env: { ...process.env, ...clockEnv, FLAKE1_PINNED_CHILD: "1", DATABASE_URL: pinUrl.toString(), BASE: base } });
    code = await new Promise(r => child.on("exit", c => r(c == null ? 1 : c)));
  } finally {
    server.kill("SIGTERM");
    if (await Promise.race([exited.then(() => true), sleep(30000).then(() => false)]) === false) { server.kill("SIGKILL"); await exited; }
    fs.closeSync(log);
    await pg(adminUrl.toString(), [`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`]).catch(e => console.error(`could not drop ${dbName}: ${e.message}`));
  }
  return code;
}

// PIPE-1: run `file` once on a stack of its own at the instant `at` (ms, at
// least a minute ahead), and resolve with its exit code. A suite that must hold
// at several fixed dates calls this once per date.
const runAt = (file, at, extraEnv = {}) => {
  const saved = {};
  for (const [k, v] of Object.entries(extraEnv)) { saved[k] = process.env[k]; process.env[k] = v; }
  return main(file, () => at).finally(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
};

// PIPE-1: noon in New York on the next `mm-dd` at least a minute ahead (this
// year's, else next year's): a fixed calendar date that is never in the past.
function nextCalendarNoon(mmdd, now = testNow()) {
  const y = Number(civilDay(now).slice(0, 4));
  for (const year of [y, y + 1]) { const t = nyNoon(`${year}-${mmdd}`); if (t >= now + 60000) return t; }
  throw new Error(`pinnedStack: no ${mmdd} ahead`);
}

module.exports = { runPinnedOrContinue, nextNoon, nextNyHour, runAt, nextCalendarNoon };
