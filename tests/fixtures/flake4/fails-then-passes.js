// FLAKE-4 fixture, not a suite: red on its first run, green on its second.
// The run count lives in $FLAKE4_STATE/<this file's name>.
const fs = require("fs"); const path = require("path");
const f = path.join(process.env.FLAKE4_STATE, path.basename(__filename));
const n = (Number(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : 0) || 0) + 1;
fs.writeFileSync(f, String(n));
if (n === 1) { console.log("  FAIL  timed out waiting for the row"); console.log("0 passed, 1 failed"); process.exit(1); }
console.log("1 passed, 0 failed");
