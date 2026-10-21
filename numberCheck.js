// NUMBERS-1 · WATCH PROD WITHOUT READING IT.
//
// Once a night (after 05:00 UTC, before the 06:23 Error digest reads the day's
// logs) the server runs scripts/check-numbers.js on every organisation and
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
  return ready || (ready = run(`CREATE TABLE IF NOT EXISTS number_checks (
      id BIGSERIAL PRIMARY KEY, ran_on DATE NOT NULL, org_id TEXT NOT NULL, org_name TEXT,
      problems INT NOT NULL, line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (ran_on, org_id))`));
}

// Every org, counts only. `opts.screens` is numbers.screens in the server.
async function runAll(opts = {}) {
  await ensureTable();
  const { checkOrg, countLine } = require("./scripts/check-numbers");
  const ranOn = opts.ranOn || new Date().toISOString().slice(0, 10);
  const orgs = await query(`SELECT id FROM orgs ORDER BY id`);
  const lines = [];
  let problems = 0;
  for (const { id } of orgs) {
    let r, line, n;
    try {
      r = await checkOrg(id, { screens: opts.screens, sample: opts.sample || 300 });
      n = r.problems.reduce((s, p) => s + p.count, 0);
      line = countLine(r);
    } catch (e) { n = 1; line = `${id}: the check could not run`; }
    problems += n;
    lines.push(line);
    await run(`INSERT INTO number_checks (ran_on, org_id, org_name, problems, line) VALUES (?,?,?,?,?)
               ON CONFLICT (ran_on, org_id) DO UPDATE SET problems = EXCLUDED.problems, line = EXCLUDED.line, created_at = NOW()`,
      [ranOn, id, r ? r.name : null, n, line]);
  }
  const head = `[numbers] ${ranOn}: ${orgs.length} orgs checked, ${problems} problem${problems === 1 ? "" : "s"}`;
  // One line for the digest; the org lines with problems follow it.
  console.error([head, ...lines.filter(l => !/: 0 problems$/.test(l))].join("\n  "));
  return { ranOn, orgs: orgs.length, problems, lines };
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
