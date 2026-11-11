// FLAKE-4 fixture, not a suite: red every time, the way a real bug is.
const fs = require("fs"); const path = require("path");
const f = path.join(process.env.FLAKE4_STATE, path.basename(__filename));
fs.writeFileSync(f, String((Number(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : 0) || 0) + 1));
console.log("0 passed, 1 failed");
process.exit(1);
