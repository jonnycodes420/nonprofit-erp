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
function runPinnedOrContinue(file) {
  if (process.env.STEWARD_TEST_OFFSET_MS) return true;
  if (process.env.FLAKE1_PINNED_CHILD === "1") throw new Error("pinnedStack: the child has no clock offset");
  main(file).then(code => process.exit(code), e => { console.error("pinnedStack:", e); process.exit(1); });
  return false;
}

async function main(file) {
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
  const at = asked !== null ? asked : nextNoon();
  const offset = at - testNow();
  console.log(`  pinned clock: ${new RealDate(at).toISOString()} (${asked !== null ? "PINNED_STACK_AT" : "noon in New York"}), a stack of its own on database ${dbName}`);

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

module.exports = { runPinnedOrContinue, nextNoon };
