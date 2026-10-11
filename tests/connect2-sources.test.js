// tests/connect2-sources.test.js: CONNECT-2. FIVE CONNECTIONS, ONE BAR.
//
// Givebutter, Square and Zeffy read gifts in; Constant Contact reads who
// asked to stop; Xero receives one bank transaction per gift when somebody
// presses Sync. Each part lives in tests/connect2/<part>.js and exports
// run(ctx); this file runs them in order against one booted server.
//
// Nothing real is contacted. Every provider is a local stand-in built from
// that provider's documented responses, reached through the server's own
// *_API_BASE seams (tests/shard.sh and the run-all.sh header):
//   GIVEBUTTER_API_BASE, ZEFFY_API_BASE, SQUARE_API_BASE and
//   CONSTANT_CONTACT_API_BASE share the calendar mock's port under their own
//   paths; XERO_API_BASE is the accounting mock's port.
//
// What each part guards is written at the top of its file, with the defect
// that turns it red.

const { ok, summary, login, api, q, closeDb } = require("./helpers");

const PARTS = ["sources", "constantcontact", "xero"];

(async () => {
  const ctx = {
    BASE: process.env.BASE || "http://localhost:5601",
    ok, login, api, q,
    mockPort: Number(process.env.CALENDAR_MOCK_PORT || 5618),
    ccPort: Number(process.env.CONSTANT_CONTACT_MOCK_PORT || process.env.CALENDAR_MOCK_PORT || 5618),
    xeroPort: Number(process.env.XERO_MOCK_PORT || 5633),
  };
  for (const name of PARTS) {
    let part = null;
    try { part = require(`./connect2/${name}.js`); }
    catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; }
    if (!part) { ok(`part ${name} is present`, false, "tests/connect2/" + name + ".js is missing"); continue; }
    console.log(`\n── ${name} ──`);
    try { await part.run(ctx); }
    catch (e) { ok(`${name}: ran to the end`, false, e.stack || e.message); }
  }
  await closeDb();
  summary();
})();
