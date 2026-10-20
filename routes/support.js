// routes/support.js · SUPPORT-1. THE SUPPORT AGENT: ANSWERS, AND A WAY TO JONATHAN.
//
//   POST /support/chat              signed in: answer from Steward's sources and the org's own facts
//   POST /support/handoff           signed in: send the whole conversation to Jonathan
//   POST /support/site/chat         a visitor on the website: sources only, no org data
//   POST /support/site/handoff      a visitor: the conversation and their email to Jonathan
//   GET  /admin/support/unanswered  super-admin: what it could not answer, most asked first
//
// IT ONLY READS. The judgement is support/engine.js, whose SUPPORT_TOOLS is
// empty; the model call below passes no tools. Nothing here changes a donor,
// a gift, a setting or a plan. The writes are the question log (the question
// and which sources answered it, never donor data), and a hand-off, which is
// a support ticket and one email to Jonathan.
//
// TENANT-SCOPED. Every fact is read with req.user.orgId. A volunteer
// coordinator does not see giving (auth.js), so for that role the agent reads
// no connections, imports or giving counts: only the help sources.
"use strict";
const express = require("express");
const E = require("../support/engine");

const routers = { r0: express.Router() };

const HANDOFF_TO = () => process.env.SUPPORT_HANDOFF_EMAIL || E.JONATHAN;
const REPLY_PROMISE = () => process.env.SUPPORT_REPLY_PROMISE || "within one business day";
const COORDINATOR = "volunteer_coordinator";

// The conversation as the client sends it: [{ role: "user"|"assistant", text }].
// Trimmed and capped here, so nothing longer reaches the model or an email.
function cleanMessages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(-20).map(m => ({ role: m && m.role === "assistant" ? "assistant" : "user", text: String((m && m.text) || "").trim().slice(0, 2000) }))
    .filter(m => m.text);
}

// A visitor has no org and so no AI budget; the website's chat answers in the
// template sentences, and this limiter keeps one address from leaning on it.
const visitorHits = new Map();
function visitorLimited(req) {
  if (process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1") return false;
  const key = String(req.ip || "?"), now = Date.now(), win = 15 * 60 * 1000;
  const h = (visitorHits.get(key) || []).filter(t => now - t < win);
  h.push(now); visitorHits.set(key, h);
  if (visitorHits.size > 5000) visitorHits.clear();
  return h.length > 40;
}

function mount(ctx) {
const { query, run, wrap, requireAuth, requireSuperAdmin, aiGate, anthropicFor, recordAiFallback, resend, uuid, actor, AGENT_MODEL } = ctx;
const app = routers.r0;

// ── WHAT THE AGENT MAY KNOW ABOUT THIS ORG ─────────────────────────────────
// Connections and their last sync, the three most recent imports, and two
// counts. No donor names, no amounts, nothing from another org.
async function orgFacts(orgId, role) {
  if (role === COORDINATOR) return { role, connections: [], imports: [], counts: null };
  const { PROVIDERS } = await import("../shared/givingSources.js");
  const [sources, books, [org], imports, [counts]] = await Promise.all([
    query(`SELECT provider, display_name, status, last_synced_at, last_error FROM giving_sources WHERE org_id=? ORDER BY created_at`, [orgId]),
    query(`SELECT vendor, status, last_sent_at, last_error FROM bookkeeping_connections WHERE org_id=?`, [orgId]).catch(() => []),
    query(`SELECT stripe_connected, stripe_account_id FROM orgs WHERE id=?`, [orgId]),
    query(`SELECT name, TO_CHAR(committed_at, 'YYYY-MM-DD') AS committed_on, rows_in, gifts_created, donors_created, rows_set_aside, rows_errored
             FROM imports WHERE org_id=? AND COALESCE(shape,'') <> 'source' ORDER BY committed_at DESC NULLS LAST LIMIT 3`, [orgId]),
    query(`SELECT (SELECT COUNT(*)::int FROM donors WHERE org_id=? AND deleted_at IS NULL) AS donors,
                  (SELECT COUNT(*)::int FROM gifts WHERE org_id=?) AS gifts`, [orgId, orgId]),
  ]);
  const label = p => (PROVIDERS[p] && PROVIDERS[p].label) || p;
  const connections = sources.filter(s => s.status !== "disconnected").map(s => ({
    name: label(s.provider), provider: s.provider,
    status: s.last_error && s.status === "error" ? "broken" : "healthy",
    lastSyncedAt: s.last_synced_at ? new Date(s.last_synced_at).toISOString() : null,
    lastError: s.status === "error" ? s.last_error : null,
  }));
  for (const b of books.filter(b => b.status !== "disconnected"))
    connections.push({ name: b.vendor === "xero" ? "Xero" : "QuickBooks", provider: b.vendor,
      status: b.last_error ? "broken" : "healthy", lastSyncedAt: b.last_sent_at ? new Date(b.last_sent_at).toISOString() : null, lastError: b.last_error || null });
  // A provider the org has not connected is a fact too: "PayPal is not
  // connected" is the answer to "why aren't my PayPal gifts showing".
  for (const [key, p] of Object.entries(PROVIDERS)) {
    if (key === "stripe" && org && org.stripe_connected && org.stripe_account_id) continue;
    if (!connections.some(c => c.provider === key)) connections.push({ name: p.label, provider: key, status: "not_connected", lastSyncedAt: null, lastError: null });
  }
  return {
    role,
    connections,
    imports: imports.map(i => ({ name: i.name, committedOn: i.committed_on, rowsIn: Number(i.rows_in) || 0, giftsCreated: Number(i.gifts_created) || 0,
      donorsCreated: Number(i.donors_created) || 0, rowsSetAside: Number(i.rows_set_aside) || 0, rowsErrored: Number(i.rows_errored) || 0 })),
    counts: counts ? { donors: counts.donors, gifts: counts.gifts } : null,
  };
}

// The question and the ids of the sources that answered it. Never the answer,
// never anything the person did not type, never a donor.
async function logQuestion(surface, orgId, question, reply) {
  const sources = (reply.citations || []).map(c => c.id).join(",") || null;
  await run(`INSERT INTO question_log (surface, question, topic, answered, org_id, sources) VALUES (?,?,?,?,?,?)`,
    // "Answered" means Steward had something to say: a deliberate hand-off
    // (cancelling, billing) is not a gap in the help; "not covered" is.
    [surface, String(question).slice(0, 1000), reply.handoff || (reply.citations[0] && reply.citations[0].link) || null,
     !!reply.covered || (!!reply.handoff && reply.handoff !== "not_covered"), orgId || null, sources])
    .catch(e => console.error("[support] question log:", e.message));
}

async function modelAnswer(orgId, prep, messages) {
  const prompt = E.buildSupportPrompt({ messages, passages: prep.passages, facts: prep.facts });
  const client = anthropicFor(orgId);
  // No `tools`: the support agent has none (E.SUPPORT_TOOLS), so the model
  // has nothing to call. Thinking off, so a short answer cannot run out.
  const r = await client.messages.create({ model: AGENT_MODEL, max_tokens: 600, thinking: { type: "disabled" }, system: prompt.system, messages: prompt.messages });
  if (r.stop_reason && r.stop_reason !== "end_turn") return null;
  return (r.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim() || null;
}

async function mailJonathan(subject, text, replyTo) {
  if (!process.env.RESEND_API_KEY) { console.warn("[support] RESEND_API_KEY not set; hand-off not emailed:", subject); return false; }
  const { isBlockedAddress } = require("../mailBlock");
  if (isBlockedAddress(HANDOFF_TO())) return false;
  try {
    const out = await resend.emails.send({ from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev", to: HANDOFF_TO(), ...(replyTo ? { replyTo } : {}), subject, text });
    if (out && out.error) { console.error("[support] hand-off mail refused:", out.error.message); return false; }
    return true;
  } catch (e) { console.error("[support] hand-off mail:", e.message); return false; }
}

app.post("/support/chat", requireAuth, wrap(async (req, res) => {
  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") return res.status(400).json({ error: "Ask a question in a few words." });
  req.audit && req.audit.skip("a help question, logged as text only");
  const orgId = req.user.orgId;
  const screen = String((req.body && req.body.screen) || "").slice(0, 80) || null;
  const facts = await orgFacts(orgId, req.user.role);
  // "3 days ago" is counted from this moment, not from the org's midnight.
  const prep = E.prepare({ messages, screen, ctx: facts, today: new Date().toISOString() });
  let modelText = null, aiOff = false;
  if (prep.covered && !(prep.handoff && !prep.handoff.answer)) {
    const gate = await aiGate(orgId);
    if (!gate.ok) aiOff = true;
    else {
      try { modelText = await modelAnswer(orgId, prep, messages); }
      catch (e) { aiOff = e && e.code === "ai_off"; await recordAiFallback(orgId, "support/chat", e); }
    }
  }
  const reply = E.compose(prep, { modelText, aiOff });
  await logQuestion("support", orgId, prep.question, reply);
  res.json({ ...reply, aiOff, replyPromise: REPLY_PROMISE() });
}));

app.post("/support/handoff", requireAuth, wrap(async (req, res) => {
  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages.length) return res.status(400).json({ error: "Tell us what you need, in a sentence or two." });
  const screen = String((req.body && req.body.screen) || "").slice(0, 80) || null;
  const reason = String((req.body && req.body.reason) || "").replace(/[^a-z_]/g, "").slice(0, 30) || null;
  const [u] = await query(`SELECT id, name, email, role FROM users WHERE id=? AND org_id=?`, [req.user.userId, req.user.orgId]);
  const [o] = await query(`SELECT id, name FROM orgs WHERE id=?`, [req.user.orgId]);
  if (!u || !o) return res.status(404).json({ error: "not_found" });
  const mail = E.handoffEmail({ messages, org: o, user: u, screen, reason });
  // The hand-off is a ticket in the super-admin list, so Jonathan's reply
  // reaches them from there, and the email tells him it arrived.
  const id = "tkt_" + uuid().slice(0, 10), who = actor(req);
  await run(`INSERT INTO support_tickets (id,org_id,user_id,user_email,user_name,subject,screen,browser,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, o.id, u.id, u.email, u.name, mail.subject.replace(/^\[Support\] [^:]*: /, "").slice(0, 140), screen, String(req.headers["user-agent"] || "").slice(0, 300), who.id, who.name]);
  await run(`INSERT INTO support_ticket_messages (id,ticket_id,from_kind,body,created_by,created_by_name) VALUES (?,?,?,?,?,?)`,
    ["tkm_" + uuid().slice(0, 10), id, "customer", mail.text.slice(0, 6000), who.id, who.name]);
  const emailed = await mailJonathan(`[${id}] ${mail.subject}`, mail.text, u.email);
  if (!emailed) console.error(`[support] hand-off ${id} stored, but the email to Jonathan was not delivered`);
  res.status(201).json({ id, emailed, sentence: `Sent to Jonathan, with this whole conversation. He is a person, not this assistant, and he will reply to ${u.email} ${REPLY_PROMISE()}.` });
}));

// ── THE WEBSITE ─────────────────────────────────────────────────────────────
// No sign-in, so no org: the facts are empty and the answer is the sources'
// own words. Nothing here reads an org, a user or a donor table.
app.post("/support/site/chat", wrap(async (req, res) => {
  if (visitorLimited(req)) return res.status(429).json({ error: "That is a lot of questions at once. Write to jonathan@stewardapp.dev and a person will answer." });
  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") return res.status(400).json({ error: "Ask a question in a few words." });
  req.audit && req.audit.skip("a website help question, logged as text only");
  const prep = E.prepare({ messages, screen: null, ctx: null, visitor: true });
  const reply = E.compose(prep, { visitor: true });
  await logQuestion("site", null, prep.question, reply);
  res.json({ ...reply, replyPromise: REPLY_PROMISE() });
}));

app.post("/support/site/handoff", wrap(async (req, res) => {
  if (visitorLimited(req)) return res.status(429).json({ error: "Write to jonathan@stewardapp.dev and a person will answer." });
  const messages = cleanMessages(req.body && req.body.messages);
  const email = String((req.body && req.body.email) || "").trim().slice(0, 200);
  const name = String((req.body && req.body.name) || "").trim().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Add the email address Jonathan should reply to." });
  if (!messages.length) return res.status(400).json({ error: "Tell us what you need, in a sentence or two." });
  req.audit && req.audit.skip("a website visitor asked for a person");
  const mail = E.handoffEmail({ messages, visitor: { email, name }, screen: String((req.body && req.body.page) || "").slice(0, 120) || "the website" });
  const emailed = await mailJonathan(mail.subject, mail.text, email);
  res.status(201).json({ emailed, sentence: `Sent to Jonathan, with this conversation. He is a person, not this assistant, and he will reply to ${email} ${REPLY_PROMISE()}.` });
}));

// ── THE LEARNING LOOP ───────────────────────────────────────────────────────
// What the support agent could not answer, the same question counted once
// however it was capitalised, most asked first. The help articles to write
// next, and the features people expect.
app.get("/admin/support/unanswered", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const rows = await query(
    `SELECT LOWER(REGEXP_REPLACE(TRIM(question), '[[:space:]?!.]+$', '')) AS key, COUNT(*)::int AS n,
            (ARRAY_AGG(question ORDER BY created_at DESC))[1] AS question,
            ARRAY_AGG(DISTINCT surface) AS surfaces, MAX(created_at) AS last_asked,
            COUNT(DISTINCT org_id)::int AS orgs
       FROM question_log
      WHERE surface IN ('support','site') AND answered = false AND created_at > NOW() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY n DESC, last_asked DESC LIMIT 200`);
  const [t] = await query(`SELECT COUNT(*)::int AS asked, COUNT(*) FILTER (WHERE answered)::int AS answered
                             FROM question_log WHERE surface IN ('support','site') AND created_at > NOW() - INTERVAL '30 days'`);
  res.json({
    unanswered: rows.map(r => ({ question: r.question, times: r.n, orgs: r.orgs, surfaces: r.surfaces, lastAsked: r.last_asked })),
    last30: t,
    sentence: "Questions the help assistant could not answer from Steward's sources, in the app and on the website, most asked first, kept twelve months. The question text only, never the answer or any donor data.",
  });
}));
}

module.exports = { routers, mount, cleanMessages };
