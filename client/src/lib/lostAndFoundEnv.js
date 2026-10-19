// AUDIT-2 · drift.js reads its tuning seam from `process.env.DRIFT_*` when it
// loads. A browser worker has no `process`, so this gives it an empty one,
// which means Drift runs with its own defaults, the same numbers Steward uses.
// Imported FIRST by the worker so it runs before drift.js does.
if (typeof globalThis.process === "undefined") globalThis.process = { env: {} };
