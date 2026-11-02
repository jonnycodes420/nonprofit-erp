// server/shared/fileLimiter.js — the private file doors' rate limit.
//
// SPLIT-1: moved from routes/crm.js's module scope, unchanged. Two domains
// open a private file (grant documents, conversation attachments), and they
// share this one limiter, as they did when both lived in one file.
const { rateLimit } = require("../../rateLimitStore");   // SCALE-1: shared by every replica
// FIX-20 Part 0: the private file doors (conversation attachments, grant
// documents). Signed-in staff open a handful at a time; this is per IP.
const fileLimiter = rateLimit("fileLimiter", {
  windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1",
});

module.exports = { fileLimiter };
