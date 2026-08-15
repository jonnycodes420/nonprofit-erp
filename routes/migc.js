// MIGC — Mission Increase Gulf Coast client-website API (2026-08-12).
//
// The MiGulfCoast.org static site (separate repo, separate hosting) posts its
// contact + newsletter forms here and reads its events list from here. It is
// a different product surface that only shares this deployment, so the whole
// route set is namespaced under /api/migc and this router is fully
// self-contained: its own CORS allowlist, its own body parsing, its own rate
// limits, its own tables (migc_* — no foreign keys into any Steward table).
// server.js mounts it BEFORE the SaaS CORS/limiter stack so nothing here can
// interact with Steward's own cross-origin policy in either direction.
//
// Env (all optional — missing values degrade safely, never crash the boot):
//   MIGC_SITE_ORIGIN    comma-separated browser origins allowed to call these
//                       routes (the production site domain). Loopback origins
//                       are always allowed for local dev.
//   MIGC_CONTACT_EMAIL  where contact-form notifications are delivered.
//   MIGC_EMAIL_FROM     Resend from-identity for those notifications (must be
//                       on a Resend-verified domain).
// If any of the mail trio (RESEND_API_KEY + the two above) is unset, contact
// submissions are still stored — the stored row is the source of truth, the
// email is only a notification (same rule as invitation_requests).

const express = require("express");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const { Resend } = require("resend");
const { query, uuid } = require("../db");

const resend = new Resend(process.env.RESEND_API_KEY);
const router = express.Router();

// ── Schema (idempotent, lazy) ──────────────────────────────────────────────
// Mirrors migrations/2026-08-12-migc-tables.sql. Running it here on first use
// means scratch/CI/local environments need no manual migration step; prod can
// apply the .sql file explicitly or just let this run — same statements.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = query(`
      CREATE TABLE IF NOT EXISTS migc_contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        org TEXT,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS migc_subscribers (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS migc_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        date DATE NOT NULL,
        time TEXT,
        location TEXT,
        description TEXT,
        is_published BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_migc_events_published_date
        ON migc_events (date) WHERE is_published;
    `).catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// ── CORS ───────────────────────────────────────────────────────────────────
// Allowlist = MIGC_SITE_ORIGIN (comma-separated, e.g. the production domain)
// plus loopback for local dev. Anything else gets no ACAO header, so browsers
// block it. No credentials — these are anonymous public forms; keeping
// credentials off means the allowlist is the only thing this CORS policy has
// to get right.
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const siteOrigins = (process.env.MIGC_SITE_ORIGIN || "")
  .split(",").map(o => o.trim().replace(/\/+$/, "")).filter(Boolean);
router.use(cors({
  origin(origin, cb) {
    // No Origin header = same-origin or non-browser (curl, server-to-server);
    // CORS is a browser concept, nothing to allow or deny.
    if (!origin) return cb(null, false);
    cb(null, siteOrigins.includes(origin) || LOOPBACK.test(origin));
  },
}));

// Mounted before the global middleware stack, so parse our own bodies. The
// biggest legitimate payload is a 5,000-char message; 25kb leaves headroom.
router.use(express.json({ limit: "25kb" }));

// ── Rate limiting ──────────────────────────────────────────────────────────
// Same 429 shape as the main API's rateLimitHandler (not exported — small
// enough to mirror). Separate limiter instances per route so a burst of
// newsletter signups from a shared/NAT'd IP can't exhaust the contact form's
// budget (house rule — see fundraiserManageLimiter's comment in server.js).
function migc429(req, res) {
  const resetMs = req.rateLimit?.resetTime ? req.rateLimit.resetTime.getTime() - Date.now() : 60000;
  res.set("Retry-After", String(Math.max(1, Math.ceil(resetMs / 1000))));
  res.status(429).json({ error: "rate_limited", message: "Too many requests. Please try again later." });
}
const rateLimitDisabled = () => process.env.DISABLE_RATE_LIMIT === "1";
const limiterOpts = {
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: migc429,
  skip: rateLimitDisabled,
};
const contactLimiter = rateLimit({ ...limiterOpts });
const subscribeLimiter = rateLimit({ ...limiterOpts });

// ── Helpers ────────────────────────────────────────────────────────────────
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Honeypot: the site forms include a visually hidden "website" input. Humans
// leave it empty; bots that fill it get a fake success and nothing is stored
// (matching the convention the MIGC site's earlier standalone backend used).
const isBot = body => typeof body?.website === "string" && body.website.trim() !== "";

// ── POST /api/migc/contact ─────────────────────────────────────────────────
router.post("/contact", contactLimiter, wrap(async (req, res) => {
  if (isBot(req.body)) return res.json({ ok: true });

  const name = clean(req.body?.name, 201);
  const email = clean(req.body?.email, 321).toLowerCase();
  const org = clean(req.body?.org, 201);
  const message = String(req.body?.message ?? "").trim();

  if (!name) return res.status(400).json({ error: "Please tell us your name." });
  if (name.length > 200) return res.status(400).json({ error: "Name is too long." });
  if (!email || !EMAIL_RE.test(email) || email.length > 320) return res.status(400).json({ error: "Please enter a valid email address." });
  if (org.length > 200) return res.status(400).json({ error: "Organization name is too long." });
  if (!message) return res.status(400).json({ error: "Please include a short message." });
  if (message.length > 5000) return res.status(400).json({ error: "Message is too long (5,000 character max)." });

  await ensureSchema();
  await query(
    "INSERT INTO migc_contacts (id, name, email, org, message) VALUES (?, ?, ?, ?, ?)",
    [uuid(), name, email, org || null, message]
  );

  // Notify the team — fire-and-forget; the stored row is the source of truth,
  // a mail failure must never fail the request.
  const to = process.env.MIGC_CONTACT_EMAIL;
  const from = process.env.MIGC_EMAIL_FROM;
  if (process.env.RESEND_API_KEY && to && from) {
    resend.emails.send({
      from,
      to,
      replyTo: email, // resend 6.x key — snake_case reply_to is silently dropped
      subject: `MiGulfCoast.org contact — ${name}`,
      html: `<div style="font-family:Georgia,serif;line-height:1.7;color:#232f3d">
        <p><strong>${esc(name)}</strong> (${esc(email)})${org ? "<br/>" + esc(org) : ""}</p>
        <p style="white-space:pre-wrap">${esc(message)}</p>
        <p style="color:#4c5a6c;font-size:13px">Sent from the MiGulfCoast.org contact form. Reply goes straight to the sender.</p>
      </div>`,
    }).catch(err => console.error("[migc] contact notify failed:", err?.message || err));
  } else {
    console.log("[migc] contact stored; notification email skipped (RESEND_API_KEY/MIGC_CONTACT_EMAIL/MIGC_EMAIL_FROM not all set)");
  }

  res.json({ ok: true });
}));

// ── POST /api/migc/subscribe ───────────────────────────────────────────────
router.post("/subscribe", subscribeLimiter, wrap(async (req, res) => {
  if (isBot(req.body)) return res.json({ ok: true });

  const email = clean(req.body?.email, 321).toLowerCase();
  if (!email || !EMAIL_RE.test(email) || email.length > 320) return res.status(400).json({ error: "Please enter a valid email address." });

  await ensureSchema();
  // Idempotent by design: re-subscribing is a success, not a duplicate error —
  // the form should never tell a visitor "you already signed up" (that would
  // also leak who is on the list).
  await query(
    "INSERT INTO migc_subscribers (id, email) VALUES (?, ?) ON CONFLICT (email) DO NOTHING",
    [uuid(), email]
  );
  res.json({ ok: true });
}));

// ── GET /api/migc/events ───────────────────────────────────────────────────
router.get("/events", wrap(async (req, res) => {
  await ensureSchema();
  // date::text keeps the DATE column a plain "YYYY-MM-DD" string — node-pg
  // would otherwise hydrate it into a JS Date at local midnight, which
  // serializes into an ISO timestamp that can land on the previous day in the
  // visitor's timezone.
  const events = await query(`
    SELECT id, title, date::text AS date, time, location, description
    FROM migc_events
    WHERE is_published
    ORDER BY date ASC, created_at ASC
  `);
  res.set("Cache-Control", "public, max-age=300");
  res.json({ events });
}));

// Errors from wrap() land here instead of the app-level handler so the
// response shape stays consistent for the site's fetch code and nothing about
// an internal failure leaks to an anonymous caller.
router.use((err, req, res, next) => {
  if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
    return res.status(400).json({ error: "Invalid request." });
  }
  console.error("[migc] error:", err?.message || err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

module.exports = { router };
