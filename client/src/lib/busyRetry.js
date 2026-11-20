// client/src/lib/busyRetry.js · SCALE-6 item 2. "STEWARD IS BUSY, TRY AGAIN."
//
// When the server cannot get a database connection for a request within 3 s, it
// answers 503 with code "busy" (server/shared/requestLimits.js) instead of
// holding the screen to its 10 s limit. A read (GET or HEAD) is asked again once,
// a second later (the answer's Retry-After); a second busy reaches the screen as
// the server's sentence. A write is never sent twice: a busy answer can arrive
// after some of its statements ran, and a gift must not be recorded twice.
export const BUSY_RETRY_MS = 1000;
export const isBusyAnswer = (status, body) => status === 503 && !!body && body.code === "busy";
export const retriesOnBusy = (method) => {
  const m = String(method || "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
};
export const waitBeforeRetry = (ms = BUSY_RETRY_MS) => new Promise(r => setTimeout(r, ms));
