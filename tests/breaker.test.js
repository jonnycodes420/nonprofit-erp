// tests/breaker.test.js: HARDEN-1 item 4. The battery runs `<name>.test.js`;
// battery: last — a load-heavy browser leg; in a serial run it goes after the rest so it measures a quiet server.
// the breaker itself is tests/breaker.spec.js. It is a browser leg (Playwright,
// client/dist), so scripts/ci/shard-plan.js pins it to the browser shard.
require("./breaker.spec.js");
