// server/org/integrations.js — API keys and the public API, outbound webhooks, the audit log, Gmail, inbound email and custom fields.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const auditMw = require("../../middleware/auditTrail");
const SEALED_MAIL = require("../mail/sealedMail");   // SECURE-3: a synced email's body opens only here

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  API_KEY_PREFIX, AUDIT_COLS, CF_ENTITIES, INBOUND_EMAIL_DOMAIN, INBOUND_EMAIL_ENABLED, actor, apiLimiter,
  auditDescribe, auditPeople, auditQuery, auditRowOut, cfEvent, cfShape, checkWriteAccess, crypto,
  emitWebhook, hashApiKey, inboundMod, loadCfDefs, mergeCustomValues, orgOwns, orgToday, orgTz, orgTzName,
  query, recordGift, requireAdmin, requireAuth, run, syncGmail, uuid, validateCustomFields, wrap,
  writeAuditLog,
} = ctx;
// ── INT-5 · THE KEY WALL, THE RATE LIMIT AND THE CALL LOG ─────────────────
// One place, because all three are about the same request and separating them
// is how a call gets rate-limited but not logged, or logged but not scoped.
const apiScopesMod = () => import("../../shared/apiScopes.js");
// Per-key, one minute wide. Per KEY rather than per org so one noisy
// integration cannot starve another. SCALE-1: counted in Postgres (one upsert,
// rateLimitStore.js), because a count in this process's memory is a count per
// replica, and a second replica would double every key's allowance.
async function apiRateHit(keyId, perMinute) {
  const r = await require("../../rateLimitStore").hit("apiKey", keyId, 60000);
  if (r.totalHits > perMinute) return { ok: false, retryAfter: Math.max(1, Math.ceil((r.resetTime.getTime() - Date.now()) / 1000)) };
  return { ok: true };
}

/**
 * THE CALL LOG WRITES ON THE WAY OUT, WHATEVER HAPPENED.
 *
 * Hooked to the response rather than called at each return, because a log that
 * has to be remembered at twenty return statements is a log that is missing the
 * twenty-first — and the refusals are the rows somebody debugging most needs.
 */
function logApiCall(req, res, { keyId, orgId, scope }) {
  const started = Date.now();
  res.on("finish", () => {
    run(`INSERT INTO api_call_log (id,org_id,key_id,method,path,status,scope_required,entity_id,ms)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ["acl_" + uuid().slice(0, 12), orgId, keyId || null, req.method,
       // The ROUTE, not the filled path: a log of "/api/v1/people/d_abc123"
       // is a list of donor ids in a table nobody guards. The id, when it
       // matters, is its own column.
       String(req.route?.path || req.path || "").slice(0, 200),
       res.statusCode, scope || null,
       String(req.params?.id || "").slice(0, 64) || null,
       Date.now() - started]).catch(() => {});
  });
}

async function requireApiKey(req, res, next) {
  try {
    const raw = String(req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "")).trim();
    const refuse = () => res.status(401).json({ error: "invalid_api_key", message: "That API key is not valid." });
    if (!raw.startsWith(API_KEY_PREFIX) || raw.length < 20) return refuse();
    const [k] = await query(`SELECT id, org_id, name, scopes, last_used_at FROM api_keys WHERE key_hash=? AND revoked_at IS NULL`, [hashApiKey(raw)]);
    if (!k) return refuse();
    const S = await apiScopesMod();
    const stored = Array.isArray(k.scopes) ? k.scopes : ["read"];
    req.apiKey = { id: k.id, orgId: k.org_id, name: k.name,
                   scopes: S.effectiveScopes(stored), stored };
    logApiCall(req, res, { keyId: k.id, orgId: k.org_id, scope: req.requiredScope });
    const hit = await apiRateHit(k.id, S.RATE_LIMIT_PER_MINUTE);
    if (!hit.ok) {
      res.set("Retry-After", String(hit.retryAfter));
      return res.status(429).json(S.rateLimitBody(hit.retryAfter));
    }
    // Stamp use at most once a minute — a busy integration must not turn
    // every read into a write.
    if (!k.last_used_at || Date.now() - new Date(k.last_used_at).getTime() > 60000)
      run(`UPDATE api_keys SET last_used_at=NOW() WHERE id=?`, [k.id]).catch(() => {});
    next();
  } catch (e) { next(e); }
}

/**
 * THE SCOPE WALL. `requireScope("write:gifts")` after `requireApiKey`.
 *
 * It fails CLOSED on an unknown scope name, so a typo in a route definition
 * refuses every call rather than allowing every call, which is the direction a
 * mistake here has to fail in.
 */
function requireScope(needed) {
  return async function (req, res, next) {
    req.requiredScope = needed;
    const S = await apiScopesMod();
    if (!req.apiKey) return res.status(401).json({ error: "invalid_api_key", message: "That API key is not valid." });
    if (!S.allows(req.apiKey.stored, needed)) return res.status(403).json(S.refusalFor(needed));
    next();
  };
}
let app = routers.r1;

// ── Staff side: make, list and revoke keys (admin only) ────────────────────
app.get("/api-keys", requireAuth, requireAdmin, wrap(async (req, res) => {
  const rows = await query(`SELECT id, name, prefix, scopes, created_by_name, created_at, last_used_at, revoked_at
                              FROM api_keys WHERE org_id=? ORDER BY created_at DESC`, [req.user.orgId]);
  res.json({ keys: rows.map(r => ({ id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes, createdBy: r.created_by_name,
    createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at })) });
}));
app.post("/api-keys", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const S = await apiScopesMod();
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Give the key a name, so you can tell it apart later (for example, Zapier)." });
  // INT-5 — SCOPES ARE CHOSEN, NEVER DEFAULTED TO EVERYTHING. A caller that
  // sends none gets the read set, which is what every key issued before this
  // build already had: the default may narrow over time, never widen.
  const asked = req.body?.scopes === undefined ? S.READ_SCOPES : req.body.scopes;
  const v = S.validateScopes(asked);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const secret = API_KEY_PREFIX + crypto.randomBytes(24).toString("base64url");
  const prefix = secret.slice(0, 10);
  const who = actor(req);
  const [me] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [req.user.userId, req.user.orgId]);
  const id = "ak_" + uuid().slice(0, 12);
  await run(`INSERT INTO api_keys (id,org_id,name,prefix,key_hash,scopes,created_by,created_by_name) VALUES (?,?,?,?,?,?::jsonb,?,?)`,
    [id, req.user.orgId, name, prefix, hashApiKey(secret), JSON.stringify(v.value), who.id, me?.name || who.name]);
  await writeAuditLog(req.user.orgId, who.id, me?.name || who.name, "api_key_created", "api_key", id,
    { scopes: v.value }).catch(() => {});
  res.json({ id, name, prefix, scopes: v.value, key: secret,
    sentence: "This is the only time the whole key is shown. Copy it now; Steward keeps only a fingerprint of it." });
}));

// WHAT A KEY MAY BE GIVEN, for the screen that makes one.
app.get("/api-keys/scopes", requireAuth, requireAdmin, wrap(async (req, res) => {
  const S = await apiScopesMod();
  res.json({
    scopes: S.SCOPE_KEYS.map(k => S.SCOPES[k]),
    defaults: S.READ_SCOPES,
    rateLimitSentence: S.RATE_LIMIT_SENTENCE,
    callLogSentence: S.CALL_LOG_SENTENCE,
    legacySentence: "A key made before permissions existed can read everything it always could, and cannot write. Make a new key to grant writing.",
  });
}));

// THE CALL LOG FOR ONE KEY. Thirty days, ids only.
app.get("/api-keys/:id/calls", requireAuth, requireAdmin, wrap(async (req, res) => {
  const S = await apiScopesMod();
  const [k] = await query(`SELECT id, name FROM api_keys WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!k) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT method, path, status, scope_required, entity_id, ms, created_at
       FROM api_call_log WHERE key_id=? AND org_id=? AND created_at > NOW() - INTERVAL '${S.CALL_LOG_DAYS} days'
      ORDER BY created_at DESC LIMIT 200`, [req.params.id, req.user.orgId]);
  res.json({
    key: { id: k.id, name: k.name },
    calls: rows.map(r => ({
      method: r.method, path: r.path, status: r.status, at: r.created_at, ms: r.ms,
      entityId: r.entity_id || null,
      sentence: S.statusSentence(r.status, r.scope_required),
    })),
    definition: S.CALL_LOG_SENTENCE,
  });
}));
// Revoking is never write-gated: a lapsed org must always be able to shut a door.
app.delete("/api-keys/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const r = await query(`UPDATE api_keys SET revoked_at=COALESCE(revoked_at, NOW()) WHERE id=? AND org_id=? RETURNING id`, [req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

// What the log covers, in one sentence, at the top of the screen. It lives
// here so the screen, the CSV header and anything printed later say the same
// thing: every number has a sentence, and so does a history.
const AUDIT_COVERAGE = "Every change anyone makes in Steward: gifts, pledges and refunds; donors, "
  + "people and merges; receipts and emails sent; funds, campaigns and pages; events, volunteers and "
  + "shifts; imports and undos; downloads of donor data; users, roles and sign-ins; connections, API "
  + "keys and settings; and every action an agent took and who approved it. Rows cannot be edited or "
  + "removed, and they are kept for at least seven years.";

app.get("/audit/log", requireAuth, requireAdmin, wrap(async (req, res) => {
  const rows = await auditQuery(req);
  // The filter choices come from the rows that exist, so a dropdown never
  // offers a type this organisation has never produced.
  const [facets] = await query(
    `SELECT
       (SELECT COALESCE(JSON_AGG(DISTINCT entity_type), '[]') FROM fin_audit_log WHERE org_id=? AND entity_type IS NOT NULL) AS types,
       (SELECT COALESCE(JSON_AGG(DISTINCT action),      '[]') FROM fin_audit_log WHERE org_id=? AND action IS NOT NULL) AS actions,
       (SELECT COALESCE(JSON_AGG(DISTINCT n), '[]') FROM (
          SELECT user_name AS n FROM fin_audit_log WHERE org_id=? AND user_name IS NOT NULL
          UNION SELECT COALESCE(u.name, u.email) FROM users u
           WHERE u.org_id=? AND u.id IN (SELECT user_id FROM fin_audit_log WHERE org_id=? AND user_name IS NULL)) x) AS actors`,
    [req.user.orgId, req.user.orgId, req.user.orgId, req.user.orgId, req.user.orgId]);
  res.json({
    coverage: AUDIT_COVERAGE,
    // Times are shown in the organisation's zone, and the zone is named.
    timezone: await orgTzName(req.user.orgId),
    rows: await auditDescribe(rows, req.user.orgId),
    facets: {
      entityTypes: (facets?.types || []).filter(Boolean).sort(),
      actions: (facets?.actions || []).filter(Boolean).sort(),
      actors: (facets?.actors || []).filter(Boolean).sort(),
    },
  });
}));

// ONE ROW of history, for the "what changed?" panel. Scoped to the org like
// everything else.
app.get("/audit/log/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const rows = await auditMw.resolveAuditNames(await query(`SELECT ${AUDIT_COLS} FROM fin_audit_log WHERE id=? AND org_id=?`,
    [req.params.id, req.user.orgId]), req.user.orgId);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json((await auditDescribe(rows, req.user.orgId))[0]);
}));

// The export of the log is itself a download of who-did-what, so it is logged
// like any other download: the middleware sees Content-Disposition and writes
// the row. Nothing here calls the audit layer by hand.
app.get("/audit/log.csv", requireAuth, requireAdmin, wrap(async (req, res) => {
  const rows = await auditQuery(req);
  const cell = v => {
    const s = v === null || v === undefined ? ""
      : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const people = await auditPeople(rows, req.user.orgId);
  const head = ["When", "Who", "In what capacity", "Description", "Action", "Record type", "Record",
                "Record id", "What changed (before)", "What changed (after)", "Summary",
                "Records touched", "Request", "Result"];
  const lines = [head.join(",")];
  for (const r of rows) {
    const o = auditRowOut(r, people);
    lines.push([
      new Date(r.created_at).toISOString(), r.user_name || "System", r.actor_kind || "", o.description,
      r.action || "", r.entity_type || "", r.entity_label || "", r.entity_id || "",
      o.before, o.after, r.summary || "", r.record_count == null ? "" : r.record_count,
      `${r.request_method || ""} ${r.request_path || ""}`.trim(), r.status_code == null ? "" : r.status_code,
    ].map(cell).join(","));
  }
  const name = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send("﻿" + lines.join("\n") + "\n");
}));

// ── Key side: /api/v1, read only ───────────────────────────────────────────
const apiPage = q => ({ limit: Math.max(1, Math.min(100, parseInt(q.limit, 10) || 50)), offset: Math.max(0, parseInt(q.offset, 10) || 0) });
const apiPerson = d => ({
  id: d.id, name: d.name, email: d.email || null, phone: d.phone || null,
  city: d.city || null, state: d.state || null, zip: d.zip || null,
  types: Array.isArray(d.person_types) ? d.person_types : ["donor"],
  lifetimeGiving: Number(d.total_giving || 0), giftCount: Number(d.gift_count || 0),
  lastGiftDate: d.last_gift_date || null, stage: d.stage || null,
  wealthScreen: d.wealth_screen_source ? { source: d.wealth_screen_source, rating: d.wealth_screen_rating || null,
    capacity: d.wealth_screen_capacity || null, date: d.wealth_screen_date || null } : null,
  sample: !!d.is_sample, createdAt: d.created_at,
});
const API_PERSON_COLS = `id,name,email,phone,city,state,zip,person_types,total_giving,gift_count,last_gift_date,stage,
  wealth_screen_source,wealth_screen_rating,wealth_screen_capacity,wealth_screen_date,is_sample,created_at`;
// `/me` needs no scope: it is how a caller finds out what their key may do,
// and a key that cannot ask that has no way to discover it has been narrowed.
app.get("/api/v1/me", apiLimiter, requireApiKey, wrap(async (req, res) => {
  const [o] = await query(`SELECT name FROM orgs WHERE id=?`, [req.apiKey.orgId]);
  res.json({ organization: o?.name || null, key: req.apiKey.name, scopes: req.apiKey.scopes });
}));
app.get("/api/v1/people", apiLimiter, requireApiKey, requireScope("read:people"), wrap(async (req, res) => {
  const { limit, offset } = apiPage(req.query);
  const rows = await query(`SELECT ${API_PERSON_COLS} FROM donors WHERE org_id=? AND deleted_at IS NULL
                             ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [req.apiKey.orgId, limit, offset]);
  res.json({ data: rows.map(apiPerson), limit, offset });
}));
app.get("/api/v1/people/:id", apiLimiter, requireApiKey, requireScope("read:people"), wrap(async (req, res) => {
  const [d] = await query(`SELECT ${API_PERSON_COLS} FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [req.params.id, req.apiKey.orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  res.json({ data: apiPerson(d) });
}));
app.get("/api/v1/gifts", apiLimiter, requireApiKey, requireScope("read:gifts"), wrap(async (req, res) => {
  const { limit, offset } = apiPage(req.query);
  const rows = await query(
    `SELECT g.id, g.donor_id, g.amount, g.date, g.type, g.payment_method, g.created_at, g.is_sample,
            f.name AS fund_name, COALESCE(c.name, g.campaign) AS campaign_name
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.deleted_at IS NULL
       LEFT JOIN fin_funds f ON f.id=g.fund_id AND f.org_id=g.org_id
       LEFT JOIN campaigns c ON c.id=g.campaign_id AND c.org_id=g.org_id
      WHERE g.org_id=? ORDER BY g.created_at DESC, g.id DESC LIMIT ? OFFSET ?`, [req.apiKey.orgId, limit, offset]);
  res.json({ data: rows.map(g => ({ id: g.id, personId: g.donor_id, amount: Number(g.amount), date: g.date, type: g.type || null,
    paymentMethod: g.payment_method || null, fund: g.fund_name || null, campaign: g.campaign_name || null,
    sample: !!g.is_sample, createdAt: g.created_at })), limit, offset });
}));
// FIX-13: THE FUNDS A GIFT CAN GO TO, so an integration can offer a list of
// names instead of asking for an id somebody has to go and find (the Zapier
// fund dropdown). Id and name only, this org only, behind its own read scope.
app.get("/api/v1/funds", apiLimiter, requireApiKey, requireScope("read:funds"), wrap(async (req, res) => {
  const { limit, offset } = apiPage(req.query);
  const rows = await query(`SELECT id, name FROM fin_funds WHERE org_id=? ORDER BY name ASC, id ASC LIMIT ? OFFSET ?`,
    [req.apiKey.orgId, limit, offset]);
  res.json({ data: rows.map(f => ({ id: f.id, name: f.name })), limit, offset });
}));

// ── INT-5 · WEBHOOKS OUT ──────────────────────────────────────────────────
//
// Steward telling somebody else that something happened. Signed with a
// per-endpoint secret and a timestamp, retried with backoff for a day, and
// every ATTEMPT kept so "it failed four times and then worked" is visible.
const webhookMod = () => import("../../shared/webhookOut.js");

app.get("/webhooks", requireAuth, requireAdmin, wrap(async (req, res) => {
  const W = await webhookMod();
  const rows = await query(
    `SELECT id,url,description,events,paused_at,consecutive_failures,last_delivered_at,last_status,created_at
       FROM webhook_endpoints WHERE org_id=? ORDER BY created_at DESC`, [req.user.orgId]);
  res.json({
    endpoints: rows.map(r => ({
      id: r.id, url: r.url, description: r.description,
      events: Array.isArray(r.events) ? r.events : [],
      paused: !!r.paused_at, consecutiveFailures: r.consecutive_failures || 0,
      lastDeliveredAt: r.last_delivered_at, lastStatus: r.last_status, createdAt: r.created_at,
      sentence: r.paused_at
        ? W.pauseSentence(r.url, r.consecutive_failures || 0)
        : r.last_delivered_at ? `Delivering. Last answered ${r.last_status}.`
        : "Added. Nothing has been sent to it yet.",
    })),
    // The secret is NEVER returned after creation, not even to an admin: it is
    // shown once, exactly like an API key, because a secret a screen can
    // re-display is a secret in every screenshot and support ticket.
    events: W.EVENT_KEYS.map(k => W.EVENTS[k]),
    verifySnippet: W.VERIFY_SNIPPET,
    signatureHeader: W.SIGNATURE_HEADER,
    definition: "Where Steward should post when something happens here. Each delivery is signed with that endpoint's own secret and a timestamp, and retried for a day if it fails.",
  });
}));

app.post("/webhooks", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const W = await webhookMod();
  const v = W.validateEndpoint(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  const id = "whe_" + uuid().slice(0, 12);
  const secret = "whsec_" + crypto.randomBytes(24).toString("base64url");
  const who = actor(req);
  await run(
    `INSERT INTO webhook_endpoints (id,org_id,url,description,events,secret,created_by,created_by_name)
     VALUES (?,?,?,?,?::jsonb,?,?,?)`,
    [id, req.user.orgId, v.value.url, v.value.description, JSON.stringify(v.value.events), secret, who.id, who.name]);
  await writeAuditLog(req.user.orgId, who.id, who.name, "webhook_endpoint_created", "webhook", id,
    { url: v.value.url, events: v.value.events }).catch(() => {});
  res.status(201).json({ id, url: v.value.url, events: v.value.events, secret,
    sentence: "This is the only time the signing secret is shown. Copy it now: Steward signs every delivery with it, and cannot show it again." });
}));

app.delete("/webhooks/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const r = await run(`DELETE FROM webhook_endpoints WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!r.changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, sentence: "Removed. Steward will not post there again, and its delivery history has gone with it." });
}));

// Turning a paused endpoint back on, and resending what is still waiting.
app.post("/webhooks/:id/resume", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [e] = await query(`SELECT id FROM webhook_endpoints WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!e) return res.status(404).json({ error: "Not found" });
  await run(`UPDATE webhook_endpoints SET paused_at=NULL, consecutive_failures=0, updated_at=NOW() WHERE id=?`, [e.id]);
  const r = await run(
    `UPDATE webhook_deliveries SET next_attempt_at=NOW(), gave_up_at=NULL
      WHERE endpoint_id=? AND delivered_at IS NULL`, [e.id]);
  res.json({ ok: true, requeued: (r && r.changes) || 0,
    sentence: "Back on. Anything that was still waiting will be tried again within the minute." });
}));

// THE DELIVERY LOG, every attempt.
app.get("/webhooks/:id/deliveries", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [e] = await query(`SELECT id, url FROM webhook_endpoints WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!e) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT id,event,attempt,status,outcome,error,created_at,delivered_at,gave_up_at,next_attempt_at
       FROM webhook_deliveries WHERE endpoint_id=? AND org_id=? ORDER BY created_at DESC LIMIT 200`,
    [e.id, req.user.orgId]);
  res.json({
    endpoint: { id: e.id, url: e.url },
    deliveries: rows.map(r => ({
      id: r.id, event: r.event, attempt: r.attempt, status: r.status, outcome: r.outcome,
      error: r.error, at: r.created_at, deliveredAt: r.delivered_at,
      gaveUpAt: r.gave_up_at, nextAttemptAt: r.next_attempt_at,
      sentence: r.delivered_at ? `Delivered on attempt ${r.attempt}.`
        : r.gave_up_at ? `Gave up after ${r.attempt} attempts.`
        : `Attempt ${r.attempt} answered ${r.status || "nothing"}. Trying again.`,
    })),
  });
}));

// RESEND ONE, by hand.
app.post("/webhooks/deliveries/:id/resend", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [d] = await query(
    `SELECT id, endpoint_id, event, payload FROM webhook_deliveries WHERE id=? AND org_id=?`,
    [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Not found" });
  const id = "whd_" + uuid().slice(0, 12);
  await run(
    `INSERT INTO webhook_deliveries (id,org_id,endpoint_id,event,payload,attempt,next_attempt_at)
     VALUES (?,?,?,?,?::jsonb,0,NOW())`,
    [id, req.user.orgId, d.endpoint_id, d.event, JSON.stringify(d.payload)]);
  res.status(201).json({ ok: true, id, sentence: "Queued. Steward will try it again within the minute." });
}));

// ── INT-5 · THE WRITE HALF OF THE PUBLIC API ──────────────────────────────
//
// EVERY WRITE GOES THROUGH THE FUNCTION THE APP USES. Not "similar code": the
// same `recordGift`, the same person rules. A second writer would eventually
// disagree with the first about a fund, a rollup, a receipt or a duplicate,
// and the half that lost would be the one nobody was watching.
//
// A key is scoped per verb and per thing, so "record gifts" does not carry
// "add people" with it.
app.post("/api/v1/people", apiLimiter, requireApiKey, requireScope("write:people"), wrap(async (req, res) => {
  const orgId = req.apiKey.orgId;
  const name = String(req.body?.name || "").trim().slice(0, 200);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200) || null;
  if (!name) return res.status(422).json({ error: "invalid_request", message: "A person needs a name." });
  if (email && !email.includes("@")) return res.status(422).json({ error: "invalid_request", message: "That email address is not usable." });

  // AN EXISTING PERSON IS UPDATED, NOT DUPLICATED. An integration posting the
  // same supporter every night must not build a thousand records, so the match
  // is on email within this org, which is the same rule the importer uses.
  if (email) {
    const [existing] = await query(
      `SELECT id FROM donors WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL LIMIT 1`, [orgId, email]);
    if (existing) {
      await run(`UPDATE donors SET name=COALESCE(NULLIF(?, ''), name), phone=COALESCE(?, phone),
                        city=COALESCE(?, city), state=COALESCE(?, state), zip=COALESCE(?, zip)
                  WHERE id=? AND org_id=?`,
        [name, req.body?.phone || null, req.body?.city || null, req.body?.state || null,
         req.body?.zip || null, existing.id, orgId]);
      await emitWebhook(orgId, "person.updated", { personId: existing.id, email }).catch(() => {});
      const [row] = await query(`SELECT ${API_PERSON_COLS} FROM donors WHERE id=?`, [existing.id]);
      return res.status(200).json({ data: apiPerson(row), created: false });
    }
  }
  const id = "d_" + uuid().slice(0, 12);
  await run(
    `INSERT INTO donors (id,org_id,name,email,phone,city,state,zip,stage,person_types,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?, 'prospect', '["donor"]'::jsonb, ?, ?)`,
    [id, orgId, name, email, req.body?.phone || null, req.body?.city || null,
     req.body?.state || null, req.body?.zip || null,
     // THE ACTOR STAMP, and it names the KEY: "which integration created this
     // person" is the first question anybody asks of a record they did not
     // expect, and `system:api` alone cannot answer it.
     `system:api/${req.apiKey.id}`, `API key: ${req.apiKey.name}`]);
  await emitWebhook(orgId, "person.created", { personId: id, email }).catch(() => {});
  const [row] = await query(`SELECT ${API_PERSON_COLS} FROM donors WHERE id=?`, [id]);
  res.status(201).json({ data: apiPerson(row), created: true });
}));

app.post("/api/v1/gifts", apiLimiter, requireApiKey, requireScope("write:gifts"), wrap(async (req, res) => {
  const orgId = req.apiKey.orgId;
  const personId = String(req.body?.personId || "").trim();
  const amount = Number(req.body?.amount);
  const date = String(req.body?.date || "").slice(0, 10);
  if (!personId) return res.status(422).json({ error: "invalid_request", message: "A gift needs a personId." });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(422).json({ error: "invalid_request", message: "A gift needs a positive amount." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(422).json({ error: "invalid_request", message: "A gift needs a date as YYYY-MM-DD." });
  const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [personId, orgId]);
  if (!d) return res.status(404).json({ error: "not_found", message: "Steward has no such person for this organization." });

  // IDEMPOTENT BY THE CALLER'S OWN KEY. An integration that retries after a
  // timeout must not record the gift twice, and the caller is the only party
  // who knows the two requests were the same intent.
  const idemKey = String(req.body?.idempotencyKey || "").trim().slice(0, 120) || null;
  const written = await recordGift({
    orgId, donorId: personId, amount, date,
    type: String(req.body?.type || "cash").slice(0, 40),
    campaign: String(req.body?.campaign || "").slice(0, 120),
    notes: String(req.body?.notes || "").slice(0, 2000),
    fundId: req.body?.fundId || null,
    paymentMethod: req.body?.paymentMethod || null,
    idempotencyKey: idemKey, conflict: idemKey ? "idempotency" : undefined,
    actorId: `system:api/${req.apiKey.id}`, actorName: `API key: ${req.apiKey.name}`,
    source: "public_api",
  });
  if (written.duplicate) {
    const [dup] = await query(`SELECT id, amount, date FROM gifts WHERE org_id=? AND idempotency_key=?`, [orgId, idemKey]);
    return res.status(200).json({ data: dup ? { id: dup.id, personId, amount: Number(dup.amount), date: dup.date } : null, duplicate: true });
  }
  const g = written.gift;
  await emitWebhook(orgId, "gift.created", { giftId: g.id, personId, amount: Number(g.amount), date: g.date }).catch(() => {});
  res.status(201).json({ data: { id: g.id, personId, amount: Number(g.amount), date: g.date } });
}));

app.post("/api/v1/notes", apiLimiter, requireApiKey, requireScope("write:notes"), wrap(async (req, res) => {
  const orgId = req.apiKey.orgId;
  const personId = String(req.body?.personId || "").trim();
  const note = String(req.body?.note || "").trim().slice(0, 4000);
  if (!personId || !note) return res.status(422).json({ error: "invalid_request", message: "A note needs a personId and a note." });
  const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [personId, orgId]);
  if (!d) return res.status(404).json({ error: "not_found", message: "Steward has no such person for this organization." });
  const type = ["call", "meeting", "email", "note"].includes(String(req.body?.type)) ? req.body.type : "note";
  const id = "int_" + uuid().slice(0, 8);
  await run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by) VALUES (?,?,?,?,?,?,?)`,
    [id, orgId, personId, type, note,
     String(req.body?.date || "").slice(0, 10) || orgToday(await orgTz(orgId)),   // ORG_TZ_SEAM_OK
     `system:api/${req.apiKey.id}`]);
  res.status(201).json({ data: { id, personId, type } });
}));
const cfDefOut = d => ({
  id: d.id, entity: d.entity, key: d.key, label: d.label, type: d.type,
  options: Array.isArray(d.options) ? d.options : JSON.parse(d.options || "[]"),
  position: d.position, showInDirectory: !!d.show_in_directory,
  archivedAt: d.archived_at || null, createdBy: d.created_by || null,
  createdByName: d.created_by_name || null, createdSource: d.created_source || null,
  createdAt: d.created_at,
});

app.get("/custom-fields", requireAuth, wrap(async (req, res) => {
  const entity = String(req.query.entity || "donor").toLowerCase();
  if (!CF_ENTITIES.includes(entity)) return res.status(400).json({ error: "entity must be donor or gift" });
  const defs = await loadCfDefs(entity, req.user.orgId, { includeArchived: req.query.includeArchived === "1" });
  res.json(defs.map(cfDefOut));
}));

// BUILD-80 Part 10 — the KEPT-RAW surface (BUILD-78's named gap): every
// stored custom value that does not coerce under its field's current type,
// listed with donor, field and value so an admin can fix it in place (the
// fix goes through the normal validated donor-update path). The population
// is a frozen migration artifact — no write path can add to it — but it must
// not sit there quietly forever.
app.get("/custom-fields/kept-raw", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { coerceCustomValue } = await cfShape();
  const orgId = req.user.orgId;
  const defs = await loadCfDefs("donor", orgId, {});
  const byKey = new Map(defs.map(d => [d.key, d]));
  const rows = await query(
    "SELECT id, name, custom_fields FROM donors WHERE org_id=? AND deleted_at IS NULL AND custom_fields IS NOT NULL", [orgId]);
  const keptRaw = [];
  for (const r of rows) {
    let cf = r.custom_fields;
    if (typeof cf === "string") { try { cf = JSON.parse(cf); } catch { continue; } }
    if (!cf || typeof cf !== "object") continue;
    for (const [k, v] of Object.entries(cf)) {
      const def = byKey.get(k);
      if (!def) { keptRaw.push({ donorId: r.id, donorName: r.name, key: k, label: k, value: v, problem: "no field definition" }); continue; }
      const c = coerceCustomValue(def, v);
      if (!c.ok) keptRaw.push({ donorId: r.id, donorName: r.name, key: k, label: def.label, type: def.type, value: v, problem: c.errors?.[0] || "does not match the field's type" });
    }
    if (keptRaw.length >= 500) break;
  }
  res.json({ keptRaw, count: keptRaw.length });
}));

// The fix-in-place: one donor, one key, one corrected value — validated
// through the SAME seam every other custom-field write uses.
app.put("/custom-fields/kept-raw/:donorId", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: "key required" });
  const [donor] = await query("SELECT id, custom_fields FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.donorId, orgId]);
  if (!donor) return res.status(404).json({ error: "donor not found" });
  const v = await validateCustomFields("donor", orgId, { [key]: value });
  if (!v.ok) return res.status(422).json({ error: "invalid value", details: v.errors });
  let cf = donor.custom_fields;
  if (typeof cf === "string") { try { cf = JSON.parse(cf); } catch { cf = {}; } }
  cf = { ...(cf || {}), ...v.values };
  if (value === "" || value === null) delete cf[key];
  await run("UPDATE donors SET custom_fields=?, updated_at=NOW() WHERE id=?", [JSON.stringify(cf), donor.id]);
  res.json({ ok: true, stored: v.values[key] ?? null });
}));

app.post("/custom-fields", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { CF_TYPES, CF_LIMITS, generateFieldKey } = await cfShape();
  const entity = String(req.body.entity || "donor").toLowerCase();
  if (!CF_ENTITIES.includes(entity)) return res.status(400).json({ error: "entity must be donor or gift" });
  const label = String(req.body.label || "").trim();
  const type = String(req.body.type || req.body.fieldType || "").trim();
  if (!label) return res.status(400).json({ error: "label required" });
  if (label.length > CF_LIMITS.LABEL_MAX) return res.status(400).json({ error: `label is over the ${CF_LIMITS.LABEL_MAX}-character limit` });
  if (!CF_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${CF_TYPES.join(", ")}` });
  const wantsOptions = type === "select" || type === "multi_select";
  const options = [...new Set((Array.isArray(req.body.options) ? req.body.options : []).map(o => String(o).trim()).filter(Boolean))];
  if (wantsOptions && !options.length) return res.status(400).json({ error: "select fields need at least one option" });
  if (!wantsOptions && options.length) return res.status(400).json({ error: `a ${type} field does not take options` });
  if (options.length > CF_LIMITS.OPTIONS_PER_SELECT)
    return res.status(400).json({ error: `that is ${options.length} options, the limit is ${CF_LIMITS.OPTIONS_PER_SELECT}. Past that a select is free text wearing a costume; consider a text field.` });

  // The 40-field cap counts LIVE fields; archiving frees a slot, and restore
  // is never blocked by the cap (restore must always work — spec 1.6).
  const live = await query(`SELECT COUNT(*)::int AS n FROM custom_field_defs WHERE org_id=? AND entity=? AND archived_at IS NULL`, [req.user.orgId, entity]);
  if (live[0].n >= CF_LIMITS.FIELDS_PER_ENTITY)
    return res.status(400).json({ error: `this org already has ${live[0].n} ${entity} fields, the limit is ${CF_LIMITS.FIELDS_PER_ENTITY}. Archive fields you no longer use to make room.` });

  const existingKeys = (await query(`SELECT key FROM custom_field_defs WHERE org_id=? AND entity=?`, [req.user.orgId, entity])).map(r => r.key);
  const key = generateFieldKey(label, existingKeys);   // immutable forever from here
  const maxPos = await query(`SELECT COALESCE(MAX(position),0) AS mp FROM custom_field_defs WHERE org_id=? AND entity=?`, [req.user.orgId, entity]);
  const id = "cfd_" + uuid().slice(0, 12);
  const source = req.body.source ? String(req.body.source).slice(0, 200) : null;
  await run(
    `INSERT INTO custom_field_defs (id,org_id,entity,key,label,type,options,position,created_by,created_by_name,created_source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, entity, key, label, type, JSON.stringify(options), (maxPos[0]?.mp || 0) + 1,
     actor(req).id, actor(req).name, source]
  );
  await cfEvent(req, req.user.orgId, entity, "definition_created", { fieldId: id, detail: { key, label, type, source } });
  const [field] = await query(`SELECT * FROM custom_field_defs WHERE id=?`, [id]);
  res.json(cfDefOut(field));
}));

// reorder MUST be before /:id
app.put("/custom-fields/reorder", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { ids } = req.body;
  const entity = String(req.body.entity || "donor").toLowerCase();
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
  for (let i = 0; i < ids.length; i++) {
    await run(`UPDATE custom_field_defs SET position=? WHERE id=? AND org_id=? AND entity=?`, [i + 1, ids[i], req.user.orgId, entity]);
  }
  await cfEvent(req, req.user.orgId, entity, "definition_reordered", { detail: { ids } });
  res.json({ ok: true });
}));

app.put("/custom-fields/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { CF_LIMITS } = await cfShape();
  const [field] = await query(`SELECT * FROM custom_field_defs WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!field) return res.status(404).json({ error: "Not found" });
  // Type is IMMUTABLE after creation (spec 5.3): changing a type is a data
  // migration wearing a dropdown, and the honest version of it is out of
  // scope. The key never changes, period (1.2).
  if ((req.body.type || req.body.fieldType) && String(req.body.type || req.body.fieldType) !== field.type)
    return res.status(400).json({ error: "a field's type cannot change after creation, archive this field and create a new one" });
  if (req.body.key && req.body.key !== field.key)
    return res.status(400).json({ error: "a field's key never changes" });

  const label = req.body.label !== undefined ? String(req.body.label || "").trim() : field.label;
  if (!label) return res.status(400).json({ error: "label required" });
  if (label.length > CF_LIMITS.LABEL_MAX) return res.status(400).json({ error: `label is over the ${CF_LIMITS.LABEL_MAX}-character limit` });

  let options = Array.isArray(field.options) ? field.options : JSON.parse(field.options || "[]");
  if (req.body.options !== undefined) {
    const next = [...new Set((Array.isArray(req.body.options) ? req.body.options : []).map(o => String(o).trim()).filter(Boolean))];
    if (field.type !== "select" && field.type !== "multi_select") {
      if (next.length) return res.status(400).json({ error: `a ${field.type} field does not take options` });
    } else {
      // Options can be ADDED, never removed or renamed here — a removed
      // option orphans every value that holds it. (An honest option
      // migration is future work; recorded in the findings.)
      const missing = options.filter(o => !next.includes(o));
      if (missing.length) return res.status(400).json({ error: `options cannot be removed: ${missing.join(", ")}: stored values still point at them` });
      if (next.length > CF_LIMITS.OPTIONS_PER_SELECT)
        return res.status(400).json({ error: `that is ${next.length} options: the limit is ${CF_LIMITS.OPTIONS_PER_SELECT}` });
      options = next;
    }
  }
  const showInDirectory = req.body.showInDirectory !== undefined ? !!req.body.showInDirectory : field.show_in_directory;
  await run(`UPDATE custom_field_defs SET label=?, options=?, show_in_directory=? WHERE id=? AND org_id=?`,
    [label, JSON.stringify(options), showInDirectory, req.params.id, req.user.orgId]);
  if (label !== field.label)
    await cfEvent(req, req.user.orgId, field.entity, "definition_renamed", { fieldId: field.id, detail: { from: field.label, to: label, key: field.key } });
  else
    await cfEvent(req, req.user.orgId, field.entity, "definition_updated", { fieldId: field.id, detail: { key: field.key } });
  const [updated] = await query(`SELECT * FROM custom_field_defs WHERE id=?`, [req.params.id]);
  res.json(cfDefOut(updated));
}));

app.post("/custom-fields/:id/archive", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [field] = await query(`SELECT * FROM custom_field_defs WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!field) return res.status(404).json({ error: "Not found" });
  if (!field.archived_at) {
    await run(`UPDATE custom_field_defs SET archived_at=NOW() WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
    await cfEvent(req, req.user.orgId, field.entity, "definition_archived", { fieldId: field.id, detail: { key: field.key, label: field.label } });
  }
  const [updated] = await query(`SELECT * FROM custom_field_defs WHERE id=?`, [req.params.id]);
  res.json(cfDefOut(updated));
}));

app.post("/custom-fields/:id/restore", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [field] = await query(`SELECT * FROM custom_field_defs WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!field) return res.status(404).json({ error: "Not found" });
  if (field.archived_at) {
    await run(`UPDATE custom_field_defs SET archived_at=NULL WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
    await cfEvent(req, req.user.orgId, field.entity, "definition_restored", { fieldId: field.id, detail: { key: field.key, label: field.label } });
  }
  const [updated] = await query(`SELECT * FROM custom_field_defs WHERE id=?`, [req.params.id]);
  res.json(cfDefOut(updated));   // restored — every value comes back with it, because none ever left
}));

// (the pre-BUILD-78 DELETE /custom-fields/:id is deliberately GONE — it
// deleted every stored value with the definition. Archive, never delete.)

app.get("/donors/:id/custom-fields", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered
  const [donor] = await query(`SELECT custom_fields FROM donors WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  const vals = donor?.custom_fields || {};
  const defs = await loadCfDefs("donor", req.user.orgId);
  res.json(defs.map(d => ({ ...cfDefOut(d), value: vals[d.key] !== undefined ? vals[d.key] : null })));
}));

app.put("/donors/:id/custom-fields", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [donor] = await query(`SELECT id, custom_fields FROM donors WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });
  const v = await validateCustomFields("donor", req.user.orgId, req.body.values || {});
  if (!v.ok) return res.status(422).json({ error: "some values were refused", errors: v.errors });
  const merged = mergeCustomValues(donor.custom_fields, v.values);
  await run(`UPDATE donors SET custom_fields=?::jsonb WHERE id=? AND org_id=?`, [JSON.stringify(merged), req.params.id, req.user.orgId]);
  await cfEvent(req, req.user.orgId, "donor", "values_written", { entityId: req.params.id, detail: { keys: Object.keys(v.values) } });
  res.json({ ok: true, customFields: merged });
}));

app.get("/gifts/:id/custom-fields", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("gifts", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Gift not found" });
  const [gift] = await query(`SELECT custom_fields FROM gifts WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  const vals = gift?.custom_fields || {};
  const defs = await loadCfDefs("gift", req.user.orgId);
  res.json(defs.map(d => ({ ...cfDefOut(d), value: vals[d.key] !== undefined ? vals[d.key] : null })));
}));

app.put("/gifts/:id/custom-fields", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [gift] = await query(`SELECT id, custom_fields FROM gifts WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!gift) return res.status(404).json({ error: "Gift not found" });
  const v = await validateCustomFields("gift", req.user.orgId, req.body.values || {});
  if (!v.ok) return res.status(422).json({ error: "some values were refused", errors: v.errors });
  const merged = mergeCustomValues(gift.custom_fields, v.values);
  await run(`UPDATE gifts SET custom_fields=?::jsonb WHERE id=? AND org_id=?`, [JSON.stringify(merged), req.params.id, req.user.orgId]);
  await cfEvent(req, req.user.orgId, "gift", "values_written", { entityId: req.params.id, detail: { keys: Object.keys(v.values) } });
  res.json({ ok: true, customFields: merged });
}));

// POST /gmail/auth-url — returns OAuth URL for frontend to redirect to
// ── INT-4 · THE OLD GMAIL HANDSHAKE IS GONE ────────────────────────────────
//
// What used to be here was `/gmail/auth-url` and a public `GET /gmail/callback`,
// and it had three problems that INT-OAUTH had already solved for every other
// provider:
//
//   1. THE STATE WAS THE BARE USER ID, UNSIGNED, and the callback trusted it.
//      Whoever completed a Google consent decided, by typing a different id in
//      the URL, whose Steward record the mailbox was filed against. Nothing
//      proved the person finishing the flow was the person who started it.
//   2. IT WROTE ON A GET, against the standing rule, from a route with no
//      session at all.
//   3. IT ASKED FOR `gmail.send`, a permission this product must never use.
//
// The flow now runs through `shared/oauth.js` like everything else: a signed
// state carrying the org, the user and a nonce; the provider lands the person
// on the APP; the app finishes with an authenticated POST; the tokens are
// sealed. Connect and disconnect are `/oauth/google/start`, `/oauth/google/complete`
// and `/oauth/google/disconnect`; the rest of the mailbox lives under /mailbox.
//
// `/gmail/status` and `/gmail/sync` are kept as thin readers over the new table
// so the Settings screen and the manual button keep working.
// THE OLD REDIRECT URI STILL WORKS, AND WRITES NOTHING.
//
// `GOOGLE_REDIRECT_URI` and the Google console both still name this path, and a
// deploy that broke every existing Gmail connection because a URL moved would
// be a self-inflicted outage. So this stays as a FORWARD-ONLY route: it reads
// nothing, writes nothing, and hands the query to the app, which finishes the
// handshake with an authenticated POST exactly as it does for every other
// provider. The token exchange replays the same redirect_uri that was stored
// when the flow started, so the value Google sees never disagrees with itself.
app.get("/gmail/callback", wrap(async (req, res) => {
  res.redirect(302, require("../../publicUrl").oauthLandingUrl("google", req.query));
}));

app.get("/gmail/status", requireAuth, wrap(async (req, res) => {
  const [row] = await query(
    `SELECT address, status, paused, last_synced_at FROM mailbox_connections
      WHERE user_id=? AND org_id=? AND provider='google' AND status <> 'disconnected'`,
    [req.user.userId, req.user.orgId]);
  res.json({
    connected: !!row, email: row?.address || null, status: row?.status || null,
    paused: row?.paused === true, lastSyncedAt: row?.last_synced_at || null,
  });
}));

app.post("/gmail/sync", requireAuth, wrap(async (req, res) => {
  const [row] = await query(
    `SELECT id, paused FROM mailbox_connections
      WHERE user_id=? AND org_id=? AND provider='google' AND status='active'`,
    [req.user.userId, req.user.orgId]);
  if (!row) return res.status(404).json({ error: "No Gmail connection found" });
  if (row.paused === true) return res.status(400).json({ error: "paused",
    sentence: "Logging is paused. Turn it back on and Steward will pick up from where it stopped." });
  syncGmail(req.user.userId, req.user.orgId).catch(e => console.error("[gmail-manual-sync]", e.message));
  res.json({ ok: true, message: "Sync started" });
}));

app.delete("/gmail/disconnect", requireAuth, wrap(async (req, res) => {
  const r = await run(
    `UPDATE mailbox_connections SET status='disconnected', credentials_sealed=NULL, token_expires_at=NULL,
            paused=false, updated_at=NOW()
      WHERE user_id=? AND org_id=? AND provider='google' AND status <> 'disconnected'`,
    [req.user.userId, req.user.orgId]);
  if (r && r.changes === 0) return res.status(404).json({ error: "No Gmail connection found" });
  res.json({ ok: true,
    sentence: "Disconnected. Steward will not read anything else from that mailbox, and the conversations already logged are still on the records." });
}));

// GET /gmail/thread/:donorId — last 20 email interactions for AI context
app.get("/gmail/thread/:donorId", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.donorId, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B
  // SECURE-3: her own screen's email history, so it opens (the one reader).
  const rows = SEALED_MAIL.openInteractions(await query(
    `SELECT id, org_id, type, note, body_sealed, body_key_id, date, created_at, metadata FROM interactions WHERE org_id=? AND donor_id=? AND type='email' ORDER BY created_at DESC LIMIT 20`,
    [req.user.orgId, req.params.donorId]
  ));
  res.json(rows.map(r => {
    const meta = r.metadata ? (typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata) : {};
    const m = (r.note || "").match(/^Subject: (.+?)(?:\n\n([\s\S]*))?$/);
    return {
      id: r.id,
      date: r.date,
      created_at: r.created_at,
      subject: m ? m[1] : "",
      snippet: m ? (m[2] || "").slice(0, 200) : (r.note || "").slice(0, 200),
      direction: meta.direction || "inbound",
      note: r.note || "",
    };
  }));
}));

// GET /settings/inbound-email — the address, the held messages, the drop count.
// Readable with the flag OFF: the Settings card has to be able to say "this is
// not switched on yet" rather than 404 at the surface a human is reading.
app.get("/settings/inbound-email", requireAuth, wrap(async (req, res) => {
  const IE = await inboundMod();
  const orgRows = await query(
    "SELECT org_slug, inbound_email_enabled FROM orgs WHERE id = ?", [req.user.orgId]);
  const slug = orgRows[0]?.org_slug || "";
  const address = INBOUND_EMAIL_DOMAIN ? IE.loggingAddress(slug, INBOUND_EMAIL_DOMAIN) : "";
  const held = await query(
    `SELECT id, kind, from_email, to_emails, subject, body, message_date, candidates, created_at
       FROM inbound_email_unmatched WHERE org_id = ? ORDER BY created_at DESC LIMIT 100`,
    [req.user.orgId]);
  const drops = await query(
    "SELECT COUNT(*)::int AS n FROM inbound_email_drops WHERE org_id = ?", [req.user.orgId]);
  // FIX-11 Part 5 — TWO gates, reported separately, because "off" for a
  // deployment reason and "off because this organisation is the demo" are
  // different sentences to put on a screen.
  const orgOn = orgRows[0]?.inbound_email_enabled !== false;
  res.json({
    enabled: INBOUND_EMAIL_ENABLED && orgOn,
    deploymentEnabled: INBOUND_EMAIL_ENABLED,
    orgEnabled: orgOn,
    address,
    // ONE address for the organisation, and Steward knows which staff member
    // sent a message because the sender has to be one of its users. Said out
    // loud so nobody BCCs it expecting a private inbox.
    sentence: !INBOUND_EMAIL_ENABLED
      ? "BCC logging is not switched on for this Steward yet."
      : !orgOn
        ? "BCC logging is off for this organization."
        : `BCC ${address} on an email to a donor and Steward files it on their record. `
          + "It is one address for the whole organization, and Steward knows it came from you because you sent it. "
          + "A message that names nobody on file is held for you to place, or stored nowhere at all.",
    unmatched: held.map(h => ({
      id: h.id, kind: h.kind, from: h.from_email, to: h.to_emails, subject: h.subject,
      body: h.body, date: h.message_date,
      candidates: Array.isArray(h.candidates) ? h.candidates : [],
      receivedAt: h.created_at,
    })),
    droppedCount: drops[0]?.n || 0,
  });
}));

// POST /settings/inbound-email/assign — a human files a held message on a
// donor. The id travels in the BODY, not the path: no new parameterized route,
// and the org scope is in both WHERE clauses, which is where it belongs.
app.post("/settings/inbound-email/assign", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { id, donorId } = req.body || {};
  const rows = await query("SELECT * FROM inbound_email_unmatched WHERE id = ? AND org_id = ?", [String(id || ""), req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const donors = await query("SELECT id FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL", [String(donorId || ""), req.user.orgId]);
  if (!donors.length) return res.status(404).json({ error: "Not found" });
  const m = rows[0];
  const iid = "int_" + uuid().slice(0, 8);
  const note = (m.subject || "") + (m.body ? "\n\n" + m.body : "");
  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  await run(
    "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata) VALUES (?,?,?,?,?,?,?,?,?)",
    // ORG_TZ_SEAM_OK (BUILD-72 Part 4) — the fallback day is the ORG's civil
    // today, never the process clock's.
    [iid, req.user.orgId, donors[0].id, "email", note, m.message_date || orgToday(await orgTz(req.user.orgId)),
     req.user.userId, userRow[0]?.name || "",
     JSON.stringify({ via: "inbound_email", from: m.from_email, to: m.to_emails, subject: m.subject, direction: "outbound" })]
  );
  await run("DELETE FROM inbound_email_unmatched WHERE id = ? AND org_id = ?", [m.id, req.user.orgId]);
  res.json({ ok: true, interactionId: iid, donorId: donors[0].id });
}));

// POST /settings/inbound-email/discard — the message was not worth filing.
app.post("/settings/inbound-email/discard", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { id } = req.body || {};
  const rows = await query("SELECT id FROM inbound_email_unmatched WHERE id = ? AND org_id = ?", [String(id || ""), req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  await run("DELETE FROM inbound_email_unmatched WHERE id = ? AND org_id = ?", [rows[0].id, req.user.orgId]);
  res.json({ ok: true });
}));
}

module.exports = { routers, mount };
