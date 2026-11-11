// server/admin/sales/routesB.js · SALES-1 Part B: /ops/sales email, partners and payouts.
// Mounted by routes.js behind the same door (super-admins only; 404 to anyone else).
//
//   GET    /ops/sales/mailbox                        the connected mailbox, prospect domains, "no reply" days
//   POST   /ops/sales/mailbox/:provider/start        the provider's consent screen (state marked sales)
//   POST   /ops/sales/mailbox/:provider/complete     the code back: sealed with aad "sales", into sales_mailboxes
//   POST   /ops/sales/mailbox/:id/read               read it now (queued on the worker)
//   POST   /ops/sales/mailbox/:id/disconnect         remove the connection; captured mail stays
//   POST   /ops/sales/mailbox/delete-captured        { confirm: "DELETE" } wipes every captured sales email
//   PUT    /ops/sales/mailbox/settings               { prospectDomains, noReplyDays }
//   GET    /ops/sales/emails/:id                     one email, with its body
//   GET    /ops/sales/partners                       every partner, its terms and the partner report
//   POST   /ops/sales/partners   PATCH|DELETE /ops/sales/partners/:id   GET /ops/sales/partners/:id
//   POST   /ops/sales/partners/:id/terms   DELETE /ops/sales/terms/:id
//   POST   /ops/sales/partners/:id/orgs   POST /ops/sales/partners/:id/orgs/remove
//   POST   /ops/sales/deals/:id/partners   DELETE /ops/sales/deal-partners/:id
//   GET    /ops/sales/ledger?partner=      POST /ops/sales/ledger/paid   POST /ops/sales/ledger/unpaid
//   GET    /ops/sales/statement/:partnerId.csv
// Nothing here sends: not to a prospect, not to a partner.
"use strict";
const crypto = require("crypto");
const { newId } = require("../../shared/newId");
const FLOW = require("../../shared/oauthFlow");
const M = require("./model");
const MAIL = require("./email");
const P = require("./partners");
const LINK = require("./stewardLink");

const SALES_NONCE = "sales.";   // a state whose nonce starts so finishes here, not at /oauth/:provider/complete

async function mrrOf(query, ids) {
  const facts = await LINK.facts(query, ids);
  return Object.fromEntries(Object.entries(facts).map(([k, f]) => [k, f.mrrNowCents || 0]));
}
async function ledgerFor(query, opts, now = Date.now()) {
  const lines = await P.lines(query, opts);
  const [mrr, paid] = await Promise.all([mrrOf(query, lines.map(l => l.steward_org_id)),
    lines.length ? query(`SELECT deal_partner_id, month, amount_cents, paid_on::text AS paid_on, note, created_by_name FROM sales_payouts WHERE deal_partner_id = ANY(?)`, [lines.map(l => l.id)]) : []]);
  return { lines, rows: P.ledger(lines, mrr, paid, now) };
}

function mount(app, { query, run, wrap, door, salesLimiter, whoOf, send }) {
  const ctx = { query, run };

  // ── The mailbox ───────────────────────────────────────────────────────────
  app.get("/ops/sales/mailbox", salesLimiter, door, wrap(async (req, res) => {
    const O = await import("../../../shared/oauth.js");
    const [boxes, domains, days] = await Promise.all([MAIL.mailboxes(query), query(`SELECT value FROM sales_settings WHERE key = 'prospect_domains'`), MAIL.noReplyDays(query)]);
    const ready = ["microsoft", "google"].map(k => { const { values } = FLOW.oauthEnv(k, O.ENV_VARS); return { provider: k, configured: !!(values.clientId && values.clientSecret && values.redirectUri) }; });
    const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM sales_emails`);
    res.json({ ok: true, mailboxes: boxes, providers: ready, prospectDomains: (domains[0] && domains[0].value) || [], noReplyDays: days, captured: n,
      sentence: "Only mail to or from a sales contact's address, or at a prospect domain, is stored. Nothing is sent from here." });
  }));

  app.post("/ops/sales/mailbox/:provider/start", salesLimiter, door, wrap(async (req, res) => {
    const O = await import("../../../shared/oauth.js");
    const key = String(req.params.provider || "");
    if (!["microsoft", "google"].includes(key) || !O.isProvider(key)) return res.status(404).json({ error: "unknown_provider" });
    const { values } = FLOW.oauthEnv(key, O.ENV_VARS);
    if (!values.clientId || !values.clientSecret || !values.redirectUri)
      return res.status(503).json({ error: "not_configured", message: O.providerUnavailableSentence(O.PROVIDERS[key].label) });
    const nonce = SALES_NONCE + crypto.randomBytes(16).toString("base64url");
    const raw = O.encodeState({ orgId: req.user.orgId, userId: req.user.userId, nonce });
    const state = `${raw}.${FLOW.signState(raw)}`;
    const verifier = O.PROVIDERS[key].pkce ? crypto.randomBytes(48).toString("base64url") : null;
    const challenge = verifier ? crypto.createHash("sha256").update(verifier).digest("base64url") : null;
    await run(`INSERT INTO oauth_states (state,org_id,user_id,provider,code_verifier,redirect_uri,expires_at) VALUES (?,?,?,?,?,?, NOW() + INTERVAL '15 minutes')`,
      [state, req.user.orgId, req.user.userId, key, verifier, values.redirectUri]);
    res.json({ url: O.authorizeUrl(key, { clientId: values.clientId, redirectUri: values.redirectUri, state, codeChallenge: challenge }) });
  }));

  app.post("/ops/sales/mailbox/:provider/complete", salesLimiter, door, wrap(async (req, res) => {
    const O = await import("../../../shared/oauth.js");
    const key = String(req.params.provider || "");
    if (!["microsoft", "google"].includes(key)) return res.status(404).json({ error: "unknown_provider" });
    const refuse = (error, message) => res.status(400).json({ error, message });
    const state = String((req.body || {}).state || "");
    const [raw, sig] = state.split(".");
    if (!raw || !sig || !FLOW.stateMatches(raw, sig)) return refuse("bad_state", "That sign-in did not come from Steward. Nothing was connected.");
    const claim = O.decodeState(raw);
    if (!claim || !String(claim.nonce).startsWith(SALES_NONCE) || claim.userId !== req.user.userId)
      return refuse("state_mismatch", "That sign-in was started by somebody else. Nothing was connected.");
    const claimed = await query(`UPDATE oauth_states SET used_at=NOW() WHERE state=? AND user_id=? AND provider=? AND used_at IS NULL AND expires_at > NOW() RETURNING code_verifier, redirect_uri`,
      [state, req.user.userId, key]);
    if (!claimed.length) return refuse("state_spent", "That sign-in has already been used or has expired. Start again.");
    const code = String((req.body || {}).code || "");
    if (!code) return refuse("no_code", "The provider did not send a code back. Nothing was connected.");
    const { values } = FLOW.oauthEnv(key, O.ENV_VARS);
    const spec = O.tokenRequest(key, { code, redirectUri: claimed[0].redirect_uri || values.redirectUri, clientId: values.clientId, clientSecret: values.clientSecret, codeVerifier: claimed[0].code_verifier });
    let tokens = null;
    try {
      const r = await fetch(spec.url, { method: "POST", headers: { ...spec.headers, ...(spec.basic ? { Authorization: "Basic " + Buffer.from(spec.basic).toString("base64") } : {}) }, body: spec.body });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { console.error(`[sales-mail] ${key} token endpoint answered ${r.status}`); throw new Error(b?.error_description || b?.error || "the provider did not accept the request"); }
      tokens = O.readTokens(b);
      if (!tokens) throw new Error("the provider sent no access token");
    } catch (e) { return res.status(502).json({ error: "exchange_failed", message: `${O.PROVIDERS[key].label} refused to finish the connection: ${e.message}. Nothing was connected.` }); }
    const address = await FLOW.mailboxAddress(key, tokens.accessToken);
    if (!address) return res.status(502).json({ error: "address_unknown", message: "The provider approved but would not say which mailbox it is. Try again." });
    const { sealBag } = await import("../../../shared/secretBox.js");
    const sealed = sealBag({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, scope: tokens.scope || null }, { aad: "sales" });
    const who = whoOf(req);
    const expires = tokens.expiresInSeconds ? new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString() : null;
    await run(`INSERT INTO sales_mailboxes (id, provider, address, user_id, status, credentials_sealed, token_expires_at, created_by, created_by_name)
               VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
               ON CONFLICT (provider, address) WHERE status <> 'disconnected'
               DO UPDATE SET credentials_sealed = EXCLUDED.credentials_sealed, token_expires_at = EXCLUDED.token_expires_at, status = 'active', last_error = NULL, updated_at = NOW()`,
      [newId("smb"), key, address, req.user.userId, sealed, expires, who.id, who.name]);
    const [mb] = await query(`SELECT id FROM sales_mailboxes WHERE provider = ? AND address = ? AND status = 'active'`, [key, address]);
    if (mb) await require("../../../jobQueue").enqueue({ name: "salesMailboxRead", key: "salesMailboxRead:" + mb.id, payload: { mailboxId: mb.id }, priority: 2 }).catch(() => null);
    if (req.audit) req.audit.label(`sales mailbox connected: ${address}`);
    res.json({ ok: true, address, sentence: `${address} is connected for Sales. Steward holds the permission encrypted and reads only mail with your sales contacts.` });
  }));

  app.post("/ops/sales/mailbox/:id/read", salesLimiter, door, wrap(async (req, res) => {
    const [mb] = await query(`SELECT id FROM sales_mailboxes WHERE id = ? AND status <> 'disconnected'`, [req.params.id]);
    if (!mb) return res.status(404).json({ error: "not_found" });
    const q = await require("../../../jobQueue").enqueue({ name: "salesMailboxRead", key: "salesMailboxRead:" + mb.id, payload: { mailboxId: mb.id }, priority: 2 }).catch(() => null);
    res.json({ ok: true, queued: !!q, sentence: "Reading now. New mail with your sales contacts shows on their records in a minute." });
  }));
  app.post("/ops/sales/mailbox/:id/disconnect", salesLimiter, door, wrap(async (req, res) => send(res, await MAIL.disconnect(ctx, req.params.id, whoOf(req)))));
  app.post("/ops/sales/mailbox/delete-captured", salesLimiter, door, wrap(async (req, res) => {
    if ((req.body || {}).confirm !== "DELETE") return res.status(400).json({ error: "invalid", message: "Confirm by typing DELETE." });
    const r = await MAIL.deleteCaptured(ctx);
    if (req.audit) req.audit.label(`sales mailbox: deleted ${r.emails} captured emails`);
    res.json(r);
  }));
  app.put("/ops/sales/mailbox/settings", salesLimiter, door, wrap(async (req, res) => {
    const b = req.body || {}, who = whoOf(req);
    const put = (key, value) => run(`INSERT INTO sales_settings (key, value, created_by, created_by_name, updated_by, updated_by_name) VALUES (?, ?::jsonb, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name`, [key, JSON.stringify(value), who.id, who.name, who.id, who.name]);
    if ("prospectDomains" in b) {
      const list = M.listOf(b.prospectDomains).map(M.domainOf);
      if (list.some(d => !d)) return res.status(400).json({ error: "invalid", message: "Each prospect domain is a domain, like harborlight.org." });
      await put("prospect_domains", [...new Set(list)].slice(0, 500));
    }
    if ("noReplyDays" in b) {
      const n = Math.round(Number(b.noReplyDays));
      if (!(n >= 1 && n <= 90)) return res.status(400).json({ error: "invalid", message: "No reply is between 1 and 90 days." });
      await put("no_reply_days", n);
    }
    res.json({ ok: true });
  }));
  app.get("/ops/sales/emails/:id", salesLimiter, door, wrap(async (req, res) => {
    const e = await MAIL.body(query, req.params.id);
    if (!e) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, email: e });
  }));

  // ── Partners ──────────────────────────────────────────────────────────────
  app.get("/ops/sales/partners", salesLimiter, door, wrap(async (req, res) => {
    const [partners, terms] = await Promise.all([
      query(`SELECT id, name, company, contact_name, contact_email, phone, terms_stack FROM sales_partners WHERE deleted_at IS NULL ORDER BY name`),
      query(`SELECT id, partner_id, kind, custom_name, percent, flat_cents, recurring, months, cap_cents FROM sales_partner_terms WHERE deleted_at IS NULL ORDER BY created_at`)]);
    const { lines, rows } = await ledgerFor(query, {});
    res.json({ ok: true, partners: partners.map(p => ({ ...p, terms: terms.filter(t => t.partner_id === p.id).map(t => ({ ...t, name: P.termName(t), says: P.termWords(t) })) })),
      report: P.report(partners, lines, rows), sentences: P.REPORT_SENTENCES });
  }));
  app.post("/ops/sales/partners", salesLimiter, door, wrap(async (req, res) => send(res, await P.createPartner(ctx, req.body || {}, whoOf(req)), 201)));
  app.patch("/ops/sales/partners/:id", salesLimiter, door, wrap(async (req, res) => send(res, await P.updatePartner(ctx, req.params.id, req.body || {}, whoOf(req)))));
  app.delete("/ops/sales/partners/:id", salesLimiter, door, wrap(async (req, res) => send(res, await P.removePartner(ctx, req.params.id, whoOf(req)))));
  app.get("/ops/sales/partners/:id", salesLimiter, door, wrap(async (req, res) => {
    const [p] = await query(`SELECT id, name, company, contact_name, contact_email, phone, notes, terms_stack, created_at, created_by_name FROM sales_partners WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
    if (!p) return res.status(404).json({ error: "not_found" });
    const [terms, orgs] = await Promise.all([
      query(`SELECT id, kind, custom_name, percent, flat_cents, recurring, months, cap_cents FROM sales_partner_terms WHERE partner_id = ? AND deleted_at IS NULL ORDER BY created_at`, [p.id]),
      query(`SELECT o.id, o.name, o.domain FROM sales_links l JOIN sales_orgs o ON o.id = l.b_id AND o.deleted_at IS NULL WHERE l.a_type = 'partner' AND l.a_id = ? AND l.b_type = 'org' ORDER BY o.name`, [p.id])]);
    const { lines, rows } = await ledgerFor(query, { partnerId: p.id });
    res.json({ ok: true, partner: p, terms: terms.map(t => ({ ...t, name: P.termName(t), says: P.termWords(t) })), orgs, ledger: rows,
      report: P.report([p], lines, rows)[0], sentences: P.REPORT_SENTENCES });
  }));
  app.post("/ops/sales/partners/:id/terms", salesLimiter, door, wrap(async (req, res) => send(res, await P.addTerm(ctx, req.params.id, req.body || {}, whoOf(req)), 201)));
  app.delete("/ops/sales/terms/:id", salesLimiter, door, wrap(async (req, res) => send(res, await P.removeTerm(ctx, req.params.id))));
  app.post("/ops/sales/partners/:id/orgs", salesLimiter, door, wrap(async (req, res) => {
    const who = whoOf(req), orgId = String((req.body || {}).org_id || "");
    const [[p], [o]] = await Promise.all([query(`SELECT id FROM sales_partners WHERE id = ? AND deleted_at IS NULL`, [req.params.id]), query(`SELECT id FROM sales_orgs WHERE id = ? AND deleted_at IS NULL`, [orgId])]);
    if (!p || !o) return res.status(404).json({ error: "not_found" });
    await run(`INSERT INTO sales_links (id, a_type, a_id, b_type, b_id, label, created_by, created_by_name) VALUES (?, 'partner', ?, 'org', ?, ?, ?, ?) ON CONFLICT (a_type, a_id, b_type, b_id) DO NOTHING`,
      [newId("sli"), p.id, o.id, M.clean((req.body || {}).label), who.id, who.name]);
    res.json({ ok: true });
  }));
  app.post("/ops/sales/partners/:id/orgs/remove", salesLimiter, door, wrap(async (req, res) => {
    const r = await run(`DELETE FROM sales_links WHERE a_type = 'partner' AND a_id = ? AND b_type = 'org' AND b_id = ?`, [req.params.id, String((req.body || {}).org_id || "")]);
    send(res, r.changes ? { ok: true } : { error: "not_found" });
  }));
  app.post("/ops/sales/deals/:id/partners", salesLimiter, door, wrap(async (req, res) => send(res, await P.attach(ctx, req.params.id, req.body || {}, whoOf(req)))));
  app.delete("/ops/sales/deal-partners/:id", salesLimiter, door, wrap(async (req, res) => send(res, await P.detach(ctx, req.params.id))));

  // ── The ledger, the statement ─────────────────────────────────────────────
  app.get("/ops/sales/ledger", salesLimiter, door, wrap(async (req, res) => {
    const { rows } = await ledgerFor(query, { partnerId: req.query.partner ? String(req.query.partner) : null });
    res.json({ ok: true, ledger: rows, sentence: P.REPORT_SENTENCES.ledger });
  }));
  app.post("/ops/sales/ledger/paid", salesLimiter, door, wrap(async (req, res) => {
    const b = req.body || {};
    // The amount is the ledger's own for that month, never the browser's.
    const { rows } = await ledgerFor(query, {});
    const line = rows.find(r => r.lineId === String(b.lineId || ""));
    const m = line && line.months.find(x => x.month === String(b.month || ""));
    if (!line || !m) return res.status(404).json({ error: "not_found", message: "That month isn't owed on this line." });
    send(res, await P.markPaid(ctx, { lineId: line.lineId, month: m.month, paid_on: b.paid_on, note: b.note, amount_cents: m.owedCents }, whoOf(req)));
  }));
  app.post("/ops/sales/ledger/unpaid", salesLimiter, door, wrap(async (req, res) => send(res, await P.unmarkPaid(ctx, String((req.body || {}).lineId || ""), String((req.body || {}).month || "")))));
  app.get("/ops/sales/statement/:partnerId", salesLimiter, door, wrap(async (req, res) => {
    const [p] = await query(`SELECT id, name FROM sales_partners WHERE id = ?`, [req.params.partnerId]);
    if (!p) return res.status(404).json({ error: "not_found" });
    const { rows } = await ledgerFor(query, { partnerId: p.id });
    const cell = v => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const out = [["Month", "Deal", "Term", "Owed", "Paid on", "Note"].join(",")];
    for (const r of rows) for (const m of r.months) out.push([m.month, r.deal, r.term, (m.owedCents / 100).toFixed(2), m.paid ? m.paid.on : "", m.paid ? m.paid.note || "" : ""].map(cell).join(","));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="partner-statement-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv"`);
    res.send(out.join("\r\n") + "\r\n");
  }));
}

// The worker's job: read the sales mailbox every 30 minutes, and when asked.
function defineJobs(ctx) {
  require("../../../jobQueue").define("salesMailboxRead", { everyMs: 30 * 60 * 1000, firstMs: 90000,
    run: async job => {
      const id = job && job.payload && job.payload.mailboxId;
      const boxes = await ctx.query(`SELECT id, provider, address, credentials_sealed, token_expires_at FROM sales_mailboxes WHERE status = 'active' ${id ? "AND id = ?" : ""}`, id ? [id] : []);
      for (const mb of boxes) await MAIL.readNow(ctx, mb).catch(e => console.error("[sales-mail] read failed:", e.message));
    } });
}

module.exports = { mount, defineJobs, SALES_NONCE, ledgerFor };
