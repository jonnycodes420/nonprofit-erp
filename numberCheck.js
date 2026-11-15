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
const { query, run, withTryAdvisoryLock } = require("./db");

let ready = null;
function ensureTable() {
  // NUMBERS-6: the table and its by_rule column are made at boot (server/db/ddl/numbers6.js).
  return ready || (ready = run(`CREATE TABLE IF NOT EXISTS number_checks (
      id BIGSERIAL PRIMARY KEY, ran_on DATE NOT NULL, org_id TEXT NOT NULL, org_name TEXT,
      problems INT NOT NULL, line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), by_rule JSONB,
      UNIQUE (ran_on, org_id))`));
}

// Every org, counts only. `opts.screens` is numbers.screens in the server.
async function runAll(opts = {}) {
  await ensureTable();
  const { checkOrg, countLine } = require("./scripts/ci/check-numbers");
  const ranOn = opts.ranOn || new Date().toISOString().slice(0, 10);
  // NUMBERS-6: an org a super-admin marked as a test (/ops) is counted apart in the digest line.
  const orgs = await query(`SELECT id, COALESCE(is_test_org, false) AS is_test FROM orgs ORDER BY id`);
  const lines = [], split = [];
  let problems = 0;
  for (const { id, is_test } of orgs) {
    let r, line, n, byRule = {};
    try {
      r = await checkOrg(id, { screens: opts.screens, sample: opts.sample || 300 });
      n = r.problems.reduce((s, p) => s + p.count, 0);
      line = countLine(r);
      for (const p of r.problems) byRule[p.rule] = p.count;   // NUMBERS-6: counts by rule, for /ops
    } catch (e) { n = 1; line = `${id}: the check could not run`; }
    problems += n;
    lines.push({ line, isTest: is_test });
    split.push({ isTest: is_test, problems: n });
    await run(`INSERT INTO number_checks (ran_on, org_id, org_name, problems, line, by_rule) VALUES (?,?,?,?,?,?::jsonb)
               ON CONFLICT (ran_on, org_id) DO UPDATE SET problems = EXCLUDED.problems, line = EXCLUDED.line, by_rule = EXCLUDED.by_rule, created_at = NOW()`,
      [ranOn, id, r ? r.name : null, n, line, JSON.stringify(byRule)]);
  }
  // NUMBERS-6: "real orgs: 30 problems in 3 orgs; test orgs: 1,247", real orgs' lines first.
  const head = `[numbers] ${ranOn}: ${orgs.length} orgs checked, ${problems} problem${problems === 1 ? "" : "s"} · ${require("./server/admin/opsNumbers").splitLine(split)}`;
  // One line for the digest; the org lines with problems follow it.
  const shown = [...lines.filter(l => !l.isTest), ...lines.filter(l => l.isTest).map(l => ({ ...l, line: `(test) ${l.line}` }))]
    .map(l => l.line).filter(l => !/: 0 problems$/.test(l));
  console.error([head, ...shown].join("\n  "));
  return { ranOn, orgs: orgs.length, problems, lines: lines.map(l => l.line) };
}

async function nightlyTick(screens) {
  const now = new Date();
  if (now.getUTCHours() < 5) return null;
  await ensureTable();
  const today = now.toISOString().slice(0, 10);
  const [done] = await query(`SELECT 1 FROM number_checks WHERE ran_on = ? LIMIT 1`, [today]);
  if (done) return null;
  return withTryAdvisoryLock("numbers-nightly", async () => {
    const [again] = await query(`SELECT 1 FROM number_checks WHERE ran_on = ? LIMIT 1`, [today]);
    return again ? null : runAll({ screens, ranOn: today });
  });
}

async function latest() {
  await ensureTable();
  return query(`SELECT ran_on, org_id, org_name, problems, line FROM number_checks
                 WHERE ran_on = (SELECT MAX(ran_on) FROM number_checks) ORDER BY problems DESC, org_id`);
}

module.exports = { runAll, nightlyTick, latest };
