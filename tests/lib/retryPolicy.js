// tests/lib/retryPolicy.js · FLAKE-4. MAY A SUITE THAT JUST FAILED RUN ONCE MORE?
//
// tests/lib/run-suite.sh asks this only after a red run, so a green battery
// never pays for it. A real bug fails twice; a flake passes the second time
// and is named (flaky.json, the PR comment, the nightly list), never hidden.
//
// NEVER RETRIED, because a second chance there would hide what they guard:
//   · tenant-matrix and security, by name (one org reading another's rows, an
//     auth hole: a red that comes and goes is still a hole)
//   · any suite whose file says `@no-retry` (say why on the same line)
//
//   node tests/lib/retryPolicy.js <name> <file>
//     exit 0: retry it · exit 3: never, and the reason on stdout
//   require: mayRetry(name, source) → { retry, why }
const fs = require("fs");

const NEVER = Object.freeze({
  "tenant-matrix": "tenant-matrix is never retried",
  "security": "security is never retried",
});
const TAG = /@no-retry\b/;

function mayRetry(name, source) {
  if (NEVER[name]) return { retry: false, why: NEVER[name] };
  if (TAG.test(source || "")) return { retry: false, why: `${name} is tagged @no-retry` };
  return { retry: true, why: "" };
}

if (require.main === module) {
  const [name, file] = process.argv.slice(2);
  let src = "";
  // An unreadable file is not retried: the safe answer is the old one.
  try { src = fs.readFileSync(file, "utf8"); } catch { console.log(`${name}: its file could not be read`); process.exit(3); }
  const r = mayRetry(name, src);
  if (!r.retry) { console.log(r.why); process.exit(3); }
  process.exit(0);
}

module.exports = { mayRetry, NEVER };
