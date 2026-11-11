// FLAKE-4 fixture, not a suite. @no-retry: it would pass a second time, and must not get one.
const fs = require("fs"); const path = require("path");
const f = path.join(process.env.FLAKE4_STATE, path.basename(__filename));
const n = (Number(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : 0) || 0) + 1;
fs.writeFileSync(f, String(n));
if (n === 1) { console.log("0 passed, 1 failed"); process.exit(1); }
console.log("1 passed, 0 failed");
