// tests/perf-app.test.js: HARDEN-2 item 2. The battery runs `<name>.test.js`;
// battery: last — a load-heavy browser leg; in a serial run it goes after the rest so it measures a quiet server.
// the budgets live in tests/perf-app.spec.js. It is a browser leg (Playwright,
// client/dist), so scripts/ci/shard-plan.js pins it to the browser shard.
require("./perf-app.spec.js");
