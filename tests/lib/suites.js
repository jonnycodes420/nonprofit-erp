// tests/lib/suites.js: ARCH-1 item 3. THE BATTERY FINDS ITS SUITES BY ITSELF.
//
// tests/run-all.sh used to list every suite by hand (CORE=( … )). It was
// changed by 148 briefs and collided in 50 merges, and a suite left off the
// list never ran (IMPORT-5's import5.test.js, FIX-58). Now every
// tests/*.test.js is a suite. A suite the battery cannot run says so on one
// line in its own file, with its reason:
//
//   // battery: skip — <reason, at least 15 characters>
//
// and a suite that must run after the others (the load-heavy ones) says
//
//   // battery: last — <reason>
//
// A <name>.spec.js is run by its <name>.test.js wrapper. run-all.sh,
// tests/affected.sh and tests/every-test-runs.test.js all read this module.
//   node tests/lib/suites.js            the battery's suite names, in run order
//   node tests/lib/suites.js --skipped  the skipped files and their reasons
const fs = require("fs");
const path = require("path");

const TESTS = path.join(__dirname, "..");
const MARK = /^\s*\/\/\s*battery:\s*(skip|last)\s*[—–-]+\s*(.*)$/m;

function discover(dir = TESTS) {
  const suites = [], last = [], skipped = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".test.js")).sort()) {
    const name = f.replace(/\.test\.js$/, "");
    const m = fs.readFileSync(path.join(dir, f), "utf8").match(MARK);
    if (m && m[1] === "skip") skipped.push({ file: f, reason: m[2].trim() });
    else if (m && m[1] === "last") last.push(name);
    else suites.push(name);
  }
  return { run: [...suites, ...last], skipped };
}

// A browser suite walks a built client (client/dist). The shard planner gives
// its shard a dist (CI-2), and `npm run affected` leaves it to CI (CI-SPEED-1).
// Detected by reading the suite file, never a hand-kept list. The net is wide
// on purpose: a non-browser suite flagged here only costs a dist.
const NEEDS_DIST = /playwright|client\/dist|"client",\s*"dist"|lib\/dist/;
function needsDist(name, dir = TESTS) {
  try { return NEEDS_DIST.test(fs.readFileSync(path.join(dir, `${name}.test.js`), "utf8")); }
  catch { return false; }
}

module.exports = { discover, MARK, NEEDS_DIST, needsDist };

if (require.main === module) {
  const d = discover();
  if (process.argv.includes("--skipped")) for (const s of d.skipped) console.log(`${s.file}\t${s.reason}`);
  else console.log(d.run.join("\n"));
}
