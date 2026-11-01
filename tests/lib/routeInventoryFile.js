// tests/lib/routeInventoryFile.js: ARCH-1 item 3. THE ROUTE INVENTORY IS
// GENERATED, NEVER COMMITTED.
//
// audit/route-inventory.json was changed by 139 briefs and collided in 39
// merges. It now lives in .generated/ (git-ignored). tenant-matrix writes it
// from the live router on every run; a suite that only reads it (security)
// calls load(), which builds a fresh copy when there is none or when a route
// file is newer than it, by booting server.js against the suite's own loopback
// database (scripts/ops/build75-route-inventory.js, on a free port).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const FILE = path.join(ROOT, ".generated", "route-inventory.json");

function newestSource() {
  const files = ["server.js", ...fs.readdirSync(path.join(ROOT, "routes")).map(f => path.join("routes", f))];
  return Math.max(...files.map(f => fs.statSync(path.join(ROOT, f)).mtimeMs));
}

function load() {
  const fresh = fs.existsSync(FILE) && fs.statSync(FILE).mtimeMs >= newestSource();
  if (!fresh) {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "ops", "build75-route-inventory.js")], {
      cwd: ROOT, stdio: "pipe", timeout: 180000,
      // Local defaults only where the suite's env has none: dummy keys, and mail
      // pointed at a dead loopback port, so the boot can never send anything.
      env: {
        JWT_SECRET: "local-test-secret", RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: "http://127.0.0.1:9",
        STRIPE_SECRET_KEY: "sk_test_dummy", TEST_MODE: "1",
        ...process.env, PORT: "0", DISABLE_BACKGROUND_TICKS: "1", ROUTE_INVENTORY_OUT: FILE,
      },
    });
  }
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

module.exports = { FILE, load };
