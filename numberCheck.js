// NUMBERS-1 · WATCH PROD WITHOUT READING IT.
//
// Once a night (after 05:00 UTC, before the 06:23 Error digest reads the day's
// logs) the server runs scripts/ci/check-numbers.js on every organisation and
// keeps ONLY COUNTS: "Harborlight: 0 problems; Org X: 2 donors where Average
// disagrees". No name, amount or id leaves an org: the line is countLine(),
// which is built from rule names and counts and nothing else. The counts go to
//   · the number_checks table, which the super-admin reads (GET /admin/number-checks),
//   · one error-level log line per night, which the Error digest workflow
//     already collects into the day's digest issue.
// Several processes may run the tick; a try-lock and the day's row make it once.
//
// SCALE-4 · IT STOPS COMPETING WITH CUSTOMERS. It ran on the web's hourly tick,
// eight people at a time with three reads each, outside any request, so the
// per-request cap of five never applied: it could want two dozen connections
// from the web's ten, for as long as the two 25,000-person test orgs took. Now
//   · it is a queued job (numberCheckNightly), so it runs on the worker, never
//     on a process that serves pages (STEWARD_PROCESS=web runs no jobs);
//   · each org is checked on ONE connection (withPinnedClient), one org at a
//     time, with PAUSE_MS between orgs;
//   · orgs marked as a test on /ops are not checked at night. A super-admin
//     checks one on demand from the Numbers card (numberCheckOrg). The digest
//     line keeps its shape: a test org's count is its latest check's.
// The counts per org are exactly what checkOrg says, as before.
const { query, run, withTryAdvisoryLock } = require("./db");

const PAUSE_MS = () => Math.max(0, Number(process.env.NUMBER_CHECK_PAUSE_MS ?? 2000));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let ready = null;
function ensureTable() {
  // NUMBERS-6: the table and its by_rule column are made at boot (server/db/ddl/numbers6.js).
  return ready || (ready = run(`CREATE TABLE IF NOT EXISTS number_checks (
      id BIGSERIAL PRIMARY KEY, ran_on DATE NOT NULL, org_id TEXT NOT NULL, org_name TEXT,
      problems INT NOT NULL, line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), by_rule JSONB,
      UNIQUE (ran_on, org_id))`));
}

// One org, on one connection: its counts, written to today's row.
async function checkOne(id, { screens, sample, ranOn }) {
  const { checkOrg, countLine } = require("./scripts/ci/check-numbers");
  const { withPinnedClient } = require("./server/db/query");
  return withPinnedClient(async () => {
    let r, line, n, byRule = {};
    try {
      r = await checkOrg(id, { screens, sample: sample || 300 });
      n = r.problems.reduce((s, p) => s + p.count, 0);
      line = countLine(r);
      for (const p of r.problems) byRule[p.rule] = p.count;   // NUMBERS-6: counts by rule, for /ops
    } catch (e) { n = 1; line = `${id}: the check could not run`; }
    await run(`INSERT INTO number_checks (ran_on, org_id, org_name, problems, line, by_rule) VALUES (?,?,?,?,?,?::jsonb)
               ON CONFLICT (ran_on, org_id) DO UPDATE SET problems = EXCLUDED.problems, line = EXCLUDED.line, by_rule = EXCLUDED.by_rule, created_at = NOW()`,
      [ranOn, id, r ? r.name : null, n, line, JSON.stringify(byRule)]);
    return { n, line };
  });
}

// Every org, counts only. `opts.screens` is numbers.screens in the server.
// `opts.skipTest` (the nightly): orgs marked as a test are not checked; their
// latest check stands in the digest line. `opts.onlyOrg`: one org, on demand.
async function runAll(opts = {}) {
  await ensureTable();
  const ranOn = opts.ranOn || new Date().toISOString().slice(0, 10);
  // NUMBERS-6: an org a super-admin marked as a test (/ops) is counted apart in the digest line.
  // `opts.orgIds`: these orgs only (a suite's own, in a shared database).
  const ids = opts.onlyOrg ? [opts.onlyOrg] : opts.orgIds || null;
  const orgs = await query(`SELECT id, COALESCE(is_test_org, false) AS is_test FROM orgs ${ids ? "WHERE id = ANY(?)" : ""} ORDER BY id`, ids ? [ids] : []);
  const lines = [], split = [];
  let problems = 0, checked = 0;
  for (const { id, is_test } of orgs) {
    let n, line;
    if (is_test && opts.skipTest) {
      // SCALE-4: not checked tonight; its latest check (on demand from /ops) stands.
      const [last] = await query(`SELECT problems, line FROM number_checks WHERE org_id = ? ORDER BY ran_on DESC LIMIT 1`, [id]);
      if (!last) continue;
      n = Number(last.problems); line = last.line;
    } else {
      if (checked++ && PAUSE_MS()) await sleep(PAUSE_MS());   // a breath between orgs
      ({ n, line } = await checkOne(id, { screens: opts.screens, sample: opts.sample, ranOn }));
    }
    problems += n;
    lines.push({ line, isTest: is_test });
    split.push({ isTest: is_test, problems: n });
  }
  // NUMBERS-6: "real orgs: 30 problems in 3 orgs; test orgs: 1,247", real orgs' lines first.
  const head = `[numbers] ${ranOn}: ${orgs.length} orgs checked, ${problems} problem${problems === 1 ? "" : "s"} · ${require("./server/admin/opsNumbers").splitLine(split)}`;
  // One line for the digest; the org lines with problems follow it.
  const shown = [...lines.filter(l => !l.isTest), ...lines.filter(l => l.isTest).map(l => ({ ...l, line: `(test) ${l.line}` }))]
    .map(l => l.line).filter(l => !/: 0 problems$/.test(l));
  if (!opts.onlyOrg) console.error([head, ...shown].join("\n  "));
  return { ranOn, orgs: orgs.length, problems, lines: lines.map(l => l.line), head, checked };
}

async function nightlyTick(screens, now = new Date()) {
  if (now.getUTCHours() < 5) return null;
  await ensureTable();
  const today = now.toISOString().slice(0, 10);
  // The night is done once a real org has today's row (an on-demand check of a test org is not the night).
  const done = `SELECT 1 FROM number_checks nc JOIN orgs o ON o.id = nc.org_id WHERE nc.ran_on = ? AND NOT COALESCE(o.is_test_org, false) LIMIT 1`;
  const [already] = await query(done, [today]);
  if (already) return null;
  return withTryAdvisoryLock("numbers-nightly", async () => {
    const [again] = await query(done, [today]);
    return again ? null : runAll({ screens, ranOn: today, skipTest: true });
  });
}

// SCALE-4: the queue's two jobs (defined in server/boot/steps-2.js). The nightly
// looks every hour and runs once a day after 05:00 UTC. Both are long jobs:
// they run in jobQueue's long lanes, never in the lane kept for short jobs.
function defineJobs(JQ, screens) {
  JQ.define("numberCheckNightly", { everyMs: 60 * 60 * 1000, firstMs: 5 * 60 * 1000, long: true, timeoutMs: 4 * 60 * 60 * 1000,
    run: () => nightlyTick(screens()) });
  JQ.handle("numberCheckOrg", async ({ orgId }) => runAll({ screens: screens(), onlyOrg: orgId }), { long: true, timeoutMs: 60 * 60 * 1000 });
}

async function latest() {
  await ensureTable();
  return query(`SELECT ran_on, org_id, org_name, problems, line FROM number_checks
                 WHERE ran_on = (SELECT MAX(ran_on) FROM number_checks) ORDER BY problems DESC, org_id`);
}

module.exports = { runAll, nightlyTick, latest, defineJobs, checkOne, PAUSE_MS };
