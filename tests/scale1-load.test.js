// SCALE-1 · the 200-org load run, as a pass/fail. NOT in the battery: it needs
// the load cluster and takes minutes. `npm run test:load`.
//
// Needs: a loopback database seeded by scripts/load/seed-many.js and a server
// on it (bash scripts/load/up.sh starts both stand-ins and the server). Fails if
//   · Home, the donors list, a donor profile, Drift or the giving summary has a
//     p95 over 800 ms for a large org, 20 users at once (SCALE-2)
//   · the app shell's p95 is over 1 s, or its first load is over 1 MB (SCALE-2)
//   · one full pass of the five-minute jobs across all orgs is over 4 minutes
//   · a 10,000-row gift import (request plus its background work) is over 60 s
// Env as scripts/load/measure.js: BASE, DATABASE_URL, DURATION, USERS.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Pool } = require("pg");

const ROOT = path.join(__dirname, "..");
const DB = process.env.DATABASE_URL || "postgresql://steward@localhost:5546/steward_scale1";
const OUT = path.join(os.tmpdir(), `scale1-load-${process.pid}.json`);
const results = [];
const ok = (name, pass, extra) => { results.push(pass); console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`); };
const node = (args, env = {}) => execFileSync(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 << 20 }).toString();

(async () => {
  const p = new Pool({ connectionString: DB, ssl: false, max: 1 });
  const [{ n }] = (await p.query(`SELECT COUNT(*)::int n FROM orgs WHERE id LIKE 'org_load%'`)).rows;
  ok("the 200 load orgs are seeded", n === 200, `found ${n}; run scripts/load/seed-many.js`);
  if (n !== 200) { await p.end(); process.exit(1); }

  node(["scripts/load/measure.js", "latency"], { OUT, DURATION: process.env.DURATION || "60" });
  const lat = JSON.parse(fs.readFileSync(OUT, "utf8")).latency;
  // SCALE-2's targets: the screens a person waits on, under 800 ms at the
  // 95th percentile with 20 people on large orgs at once, and the app shell
  // (everything the client loads before the first screen) under 1 MB and 1 s.
  for (const screen of ["home", "donors", "profile", "drift", "giving"])
    ok(`${screen} p95 under 800 ms at 20 users`, lat[screen] && lat[screen].p95 <= 800, lat[screen] && `p50 ${lat[screen].p50} p95 ${lat[screen].p95}`);
  ok("the app shell p95 under 1 s at 20 users", lat.shell && lat.shell.p95 <= 1000, lat.shell && `p50 ${lat.shell.p50} p95 ${lat.shell.p95}`);
  ok("the app shell's first load under 1 MB for a large org", lat.shell && lat.shell.bytes <= 1000000, lat.shell && `${Math.round(lat.shell.bytes / 1024)} KB`);

  // The five-minute pass: enqueue every five-minute job now, and time until
  // the queue holds none of them waiting or running.
  await p.query(`UPDATE job_schedule SET next_run_at = NOW() WHERE every_ms <= 300000`);
  const t0 = Date.now();
  await new Promise(r => setTimeout(r, 15000));   // the scheduler looks every 10 s
  for (;;) {
    const [{ left }] = (await p.query(`SELECT COUNT(*)::int AS left FROM job_queue
       WHERE status IN ('waiting','running') AND created_at >= to_timestamp($1 / 1000.0)`, [t0])).rows;
    if (!left || Date.now() - t0 > 10 * 60 * 1000) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  const tickMs = Date.now() - t0;
  ok("one five-minute pass across all orgs under 4 minutes", tickMs <= 4 * 60 * 1000, `${(tickMs / 1000).toFixed(1)}s`);

  const pid = fs.readFileSync(path.join(os.homedir(), "steward-scale-pg", "server.pid"), "utf8").trim();
  const t1 = Date.now();
  const imp = JSON.parse(node(["scripts/load/import-drive.js", "load021"], { SERVER_PID: pid }).trim().split("\n").pop());
  for (;;) {
    const [{ left }] = (await p.query(`SELECT COUNT(*)::int AS left FROM import_recent_jobs WHERE org_id='org_load021'
       AND (status='running' OR (status='done' AND finished_at IS NULL))`)).rows;
    if (!left || Date.now() - t1 > 5 * 60 * 1000) break;
    await new Promise(r => setTimeout(r, 500));
  }
  const impMs = Date.now() - t1;
  ok("a 10,000-row import, with its background work, under 60 s", impMs <= 60000 && imp.giftsInserted === 10000,
    `${(impMs / 1000).toFixed(1)}s, request ${imp.seconds}s, peak ${imp.rssPeakMb} MB, ${imp.giftsInserted} gifts`);
  await p.end();
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
