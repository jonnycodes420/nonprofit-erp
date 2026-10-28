// tests/perf-app.test.js: HARDEN-2 item 2. The battery runs `<name>.test.js`;
// the budgets live in tests/perf-app.spec.js. It is a browser leg (Playwright,
// client/dist), so scripts/shard-plan.js pins it to the browser shard.
require("./perf-app.spec.js");
