// FIX-15 Part 1 — TWO WORKTREES CAN RUN THE BATTERY AT THE SAME TIME.
//
// Every worktree's shards used to be `steward_shard_<n>` on ports 5700+, so a
// second session's battery dropped the first one's databases mid-run (FIX-14
// waited on GIVE-2's). run-all.sh now names the databases, the ports and the
// logs after the worktree. This suite starts TWO sharded runs at once as two
// different worktrees, plus a third worktree's database that is just sitting
// there, and proves:
//   1. both runs pass;
//   2. at one moment both runs' databases exist side by side (they really did
//      overlap, and neither dropped the other's);
//   3. they claimed different port blocks;
//   4. the bystander's database and its row are untouched;
//   5. each run cleaned up its own databases and nothing else.
//
// How it fails: give both runs the same SHARD_DB_PREFIX (the old shape) and
// check 1 or 2 goes red, because each shard drops and recreates its database
// at start. That defect was planted once and watched fail before this was
// trusted (docs/changelog/FIX-15.md).
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ok, summary, q, closeDb } = require("./helpers");

const root = path.join(__dirname, "..");
const A = "fx15a", B = "fx15b", C = "fx15c";
const SUITES = "money-cents pledge-math";
const PLANT_SAME_PREFIX = process.env.FIX15_PLANT === "1";

// The child must not inherit the OUTER shard's identity, or both runs would
// reuse its port base and its prefix and this suite would test nothing.
function childEnv(tag) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(SHARD|SHARDS$|SUITES$|SUITE_LOG_DIR$|BASE$|APP_URL$|MATRIX_PORT$|AUDIT_PORT$|STEWARD_WT_TAG$)/.test(k)) delete env[k];
  }
  // /tmp, not os.tmpdir(): inside a shard TMPDIR can arrive relative, and the
  // copy then lands in the worktree.
  const timings = path.join("/tmp", `fix15-timings-${tag}-${process.pid}.json`);
  fs.copyFileSync(path.join(root, "audit/suite-timings.json"), timings);
  Object.assign(env, {
    STEWARD_WT_TAG: tag, SHARDS: "2", SUITES, SHARD_BUILD_DIST: "0", SHARD_PREVIEW: "0",
    SHARD_TIMINGS: timings,
  });
  if (PLANT_SAME_PREFIX) env.SHARD_DB_PREFIX = "steward_fx15same_shard_";
  return env;
}

function run(tag) {
  return new Promise(resolve => {
    const p = spawn("bash", ["tests/run-all.sh"], { cwd: root, env: childEnv(tag) });
    let out = "";
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { out += d; });
    p.on("close", rc => resolve({ rc, out }));
  });
}

const dbs = async () => (await q("SELECT datname FROM pg_database WHERE datname LIKE 'steward\\_fx15%'")).map(r => r.datname);

(async () => {
  const bystander = `steward_${C}_shard_1`;
  await q(`DROP DATABASE IF EXISTS ${bystander}`);
  await q(`CREATE DATABASE ${bystander}`);
  const { Pool } = require("pg");
  const url = new URL(process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest");
  url.pathname = "/" + bystander;
  const bp = new Pool({ connectionString: url.toString(), ssl: false });
  await bp.query("CREATE TABLE marker (v text)");
  await bp.query("INSERT INTO marker VALUES ('still here')");
  await bp.end();

  let overlap = false, done = false;
  const poll = (async () => {
    while (!done) {
      const names = await dbs();
      if (names.some(n => n.startsWith(`steward_${A}_shard_`)) && names.some(n => n.startsWith(`steward_${B}_shard_`))) overlap = true;
      await new Promise(r => setTimeout(r, 250));
    }
  })();

  const [ra, rb] = await Promise.all([run(A), run(B)]);
  done = true; await poll;

  ok("worktree A's battery passed", ra.rc === 0, ra.out.slice(-1500));
  ok("worktree B's battery passed", rb.rc === 0, rb.out.slice(-1500));
  ok("both runs' databases existed side by side mid-run", overlap);
  const base = o => (o.match(/ports from (\d+)/) || [])[1];
  ok("A named its databases after itself", ra.out.includes(`steward_${A}_shard_`), ra.out.slice(0, 600));
  ok("the two runs claimed different port blocks", base(ra.out) && base(rb.out) && base(ra.out) !== base(rb.out), [base(ra.out), base(rb.out)]);

  const bp2 = new Pool({ connectionString: url.toString(), ssl: false });
  const m = await bp2.query("SELECT v FROM marker").catch(e => ({ rows: [], err: e.message }));
  await bp2.end();
  ok("the bystander worktree's database and row are untouched", m.rows.length === 1 && m.rows[0].v === "still here", m);

  const left = await dbs();
  ok("each run cleaned up only its own databases", left.length === 1 && left[0] === bystander, left);

  await q(`DROP DATABASE IF EXISTS ${bystander}`);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
